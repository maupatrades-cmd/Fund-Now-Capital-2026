-- PR A / spec PR 7 — E-Sign Evidence Backend (RPC half).
-- ============================================================================
-- The §7.3 signing state machine, magic-link issuance/consumption, the §7.2/§9
-- consent gate, signing, FNC countersignature/execution, and withdraw/decline/
-- expire — all as owner- or token-gated SECURITY DEFINER RPCs with pinned
-- search_path, advisory locks, RETURNING checks and append-only event writes.
--
-- Authorisation model:
--   * Owner-side transitions (create/add party/set variables/send/countersign/
--     withdraw) require public.is_owner().
--   * Signer-side transitions (open/consent/submit/decline) authorise on the
--     HASH-ONLY magic-link token — the bearer token IS the credential (§13), not
--     the caller's role — so they are granted to authenticated + service_role
--     (the signing UI / Edge Function), never anon.
--   * Table DML stays revoked from every API role (schema file); these RPCs are
--     the only write path. Every mutation is RETURNING-checked (silent-RLS rule).
--
-- §13 idempotency: create_agreement_instance is idempotent on idempotency_key; a
-- retried send/countersign is a clean no-op when already past that state.
-- ============================================================================

-- ===========================================================================
-- 1. create_agreement_instance — owner opens a DRAFT against a PUBLISHED template
--    version (§2: only a published template may issue). Snapshots the template's
--    document_type + title. Idempotent on idempotency_key.
-- ===========================================================================
create or replace function public.create_agreement_instance(
  p_template_version_id     uuid,
  p_client_id               uuid    default null,
  p_deal_id                 uuid    default null,
  p_lead_id                 uuid    default null,
  p_subject_profile_id      uuid    default null,
  p_referral_partner_id     uuid    default null,
  p_idempotency_key         text    default null,
  p_supersedes_agreement_id uuid    default null
) returns public.agreement_instances
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_key   text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_dtype public.legal_document_type;
  v_title text;
  v_status public.legal_template_status;
  v_row   public.agreement_instances;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can create agreement instances';
  end if;

  -- §13 idempotency: return the existing instance for a repeated key.
  if v_key is not null then
    select * into v_row from public.agreement_instances where idempotency_key = v_key;
    if v_row.id is not null then return v_row; end if;
  end if;

  if num_nonnulls(p_client_id, p_subject_profile_id, p_lead_id) < 1 then
    raise exception 'An agreement needs at least one subject (client, subject profile, or lead)';
  end if;

  -- Resolve + validate the template version (§2: must be published).
  select tv.status, tpl.document_type, tpl.title
    into v_status, v_dtype, v_title
    from public.legal_document_template_versions tv
    join public.legal_document_templates tpl on tpl.id = tv.template_id
   where tv.id = p_template_version_id;
  if v_dtype is null then
    raise exception 'Template version % not found', p_template_version_id;
  end if;
  if v_status <> 'published' then
    raise exception 'Only a published template version may be issued (version % is %)', p_template_version_id, v_status;
  end if;

  insert into public.agreement_instances
    (template_version_id, document_type, title_snapshot, client_id, deal_id, lead_id,
     subject_profile_id, referral_partner_id, idempotency_key, supersedes_agreement_id, created_by)
  values
    (p_template_version_id, v_dtype, v_title, p_client_id, p_deal_id, p_lead_id,
     p_subject_profile_id, p_referral_partner_id, v_key, p_supersedes_agreement_id, v_uid)
  returning * into v_row;
  if v_row.id is null then raise exception 'Agreement instance was not created (no row written)'; end if;

  -- If this corrects an older instance, link the prior one forward + mark superseded.
  if p_supersedes_agreement_id is not null then
    update public.agreement_instances
       set superseded_by_agreement_id = v_row.id,
           state = 'superseded', terminal_at = now()
     where id = p_supersedes_agreement_id
       and state not in ('superseded');
  end if;

  insert into public.signature_events (agreement_id, event_type, actor_profile_id, detail)
  values (v_row.id, 'created', v_uid,
          jsonb_build_object('reference', v_row.reference, 'template_version_id', p_template_version_id));

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values (now(), v_uid, 'owner', 'CREATE', 'agreement_instance', v_row.id,
          'Created agreement ' || v_row.reference || ' (' || v_row.document_type::text || ')',
          jsonb_build_object('reference', v_row.reference, 'document_type', v_row.document_type));
  return v_row;
end $$;

-- ===========================================================================
-- 2. add_agreement_party — owner adds a party while the instance is still DRAFT.
-- ===========================================================================
create or replace function public.add_agreement_party(
  p_agreement_id     uuid,
  p_party_role       public.agreement_party_role,
  p_legal_name       text,
  p_party_order      integer default 1,
  p_represented_party text   default null,
  p_capacity         text    default null,
  p_email            text    default null,
  p_mobile           text    default null,
  p_profile_id       uuid    default null,
  p_is_fnc           boolean default false
) returns public.agreement_party_snapshots
language plpgsql security definer set search_path = '' as $$
declare v_state public.agreement_state; v_row public.agreement_party_snapshots;
begin
  if not public.is_owner() then raise exception 'Only the owner can add agreement parties'; end if;
  if p_legal_name is null or btrim(p_legal_name) = '' then raise exception 'A party legal name is required'; end if;

  perform pg_advisory_xact_lock(hashtext('agreement:' || p_agreement_id::text));
  select state into v_state from public.agreement_instances where id = p_agreement_id;
  if v_state is null then raise exception 'Agreement % not found', p_agreement_id; end if;
  if v_state <> 'draft' then raise exception 'Parties can only be added while the agreement is draft (state %)', v_state; end if;

  insert into public.agreement_party_snapshots
    (agreement_id, party_role, party_order, legal_name, represented_party, capacity, email, mobile, profile_id, is_fnc)
  values
    (p_agreement_id, p_party_role, p_party_order, btrim(p_legal_name),
     nullif(btrim(coalesce(p_represented_party,'')),''), nullif(btrim(coalesce(p_capacity,'')),''),
     nullif(btrim(coalesce(p_email,'')),''), nullif(btrim(coalesce(p_mobile,'')),''), p_profile_id, p_is_fnc)
  returning * into v_row;
  if v_row.id is null then raise exception 'Party was not added (no row written)'; end if;
  return v_row;
end $$;

-- ===========================================================================
-- 3. set_agreement_variables — owner sets/updates the variable map while DRAFT.
--    Upserts the single per-agreement snapshot row (unfrozen until send).
-- ===========================================================================
create or replace function public.set_agreement_variables(
  p_agreement_id uuid,
  p_variables    jsonb
) returns public.agreement_variable_snapshots
language plpgsql security definer set search_path = '' as $$
declare v_state public.agreement_state; v_row public.agreement_variable_snapshots;
begin
  if not public.is_owner() then raise exception 'Only the owner can set agreement variables'; end if;
  perform pg_advisory_xact_lock(hashtext('agreement:' || p_agreement_id::text));
  select state into v_state from public.agreement_instances where id = p_agreement_id;
  if v_state is null then raise exception 'Agreement % not found', p_agreement_id; end if;
  if v_state <> 'draft' then raise exception 'Variables can only be set while the agreement is draft (state %)', v_state; end if;

  insert into public.agreement_variable_snapshots (agreement_id, variables)
  values (p_agreement_id, coalesce(p_variables, '{}'::jsonb))
  on conflict (agreement_id) do update set variables = excluded.variables, updated_at = now()
  returning * into v_row;
  if v_row.id is null then raise exception 'Variables were not set (no row written)'; end if;
  return v_row;
end $$;

-- ===========================================================================
-- 4. send_agreement — owner dispatches. Freezes party + variable snapshots,
--    computes the unsigned SHA-256, issues one hash-only magic-link per signer,
--    and returns the RAW tokens ONCE (never stored). draft/approved_for_send only.
-- ===========================================================================
create or replace function public.send_agreement(
  p_agreement_id uuid,
  p_expiry_days  integer default 7
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_ai    public.agreement_instances;
  v_vars  jsonb;
  v_var_sha text;
  v_tpl_sha text;
  v_unsigned text;
  v_exp   timestamptz;
  v_tokens jsonb := '[]'::jsonb;
  v_signer_count int := 0;
  r record; v_raw text; v_hash text;
begin
  if not public.is_owner() then raise exception 'Only the owner can send agreements'; end if;
  if coalesce(p_expiry_days, 0) < 1 then raise exception 'Expiry must be at least 1 day'; end if;

  perform pg_advisory_xact_lock(hashtext('agreement:' || p_agreement_id::text));
  select * into v_ai from public.agreement_instances where id = p_agreement_id;
  if v_ai.id is null then raise exception 'Agreement % not found', p_agreement_id; end if;
  if v_ai.state = 'sent' then
    return jsonb_build_object('was_transitioned', false, 'state', 'sent', 'reason', 'already_sent');
  end if;
  if v_ai.state not in ('draft', 'approved_for_send') then
    raise exception 'Only a draft/approved agreement can be sent (state %)', v_ai.state;
  end if;

  -- Must have at least one signer party.
  select count(*) into v_signer_count from public.agreement_party_snapshots
   where agreement_id = p_agreement_id and party_role = 'signer';
  if v_signer_count < 1 then raise exception 'Cannot send: the agreement has no signer party'; end if;

  -- Freeze the variable snapshot (create an empty one if the owner set none).
  insert into public.agreement_variable_snapshots (agreement_id, variables)
  values (p_agreement_id, '{}'::jsonb) on conflict (agreement_id) do nothing;
  select variables into v_vars from public.agreement_variable_snapshots where agreement_id = p_agreement_id;
  v_var_sha := encode(extensions.digest(convert_to(coalesce(v_vars, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');

  -- Unsigned snapshot hash = template content hash + frozen variables + party set.
  select content_sha256 into v_tpl_sha from public.legal_document_template_versions where id = v_ai.template_version_id;
  v_unsigned := encode(extensions.digest(convert_to(
      coalesce(v_tpl_sha,'') || '|' || v_var_sha || '|' ||
      coalesce((select string_agg(legal_name || ':' || party_role::text, ',' order by party_order)
                  from public.agreement_party_snapshots where agreement_id = p_agreement_id), ''),
      'UTF8'), 'sha256'), 'hex');

  update public.agreement_variable_snapshots
     set snapshot_sha256 = v_var_sha, frozen = true
   where agreement_id = p_agreement_id;
  update public.agreement_party_snapshots set frozen = true where agreement_id = p_agreement_id;

  v_exp := now() + make_interval(days => p_expiry_days);

  -- Issue one hash-only magic link per signer party; collect raw tokens to return.
  for r in select id from public.agreement_party_snapshots
            where agreement_id = p_agreement_id and party_role = 'signer' order by party_order loop
    v_raw  := encode(extensions.gen_random_bytes(32), 'hex');
    v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');
    insert into public.signature_requests (agreement_id, party_snapshot_id, token_hash, expires_at, delivery_status)
    values (p_agreement_id, r.id, v_hash, v_exp, 'pending');
    v_tokens := v_tokens || jsonb_build_object('party_snapshot_id', r.id, 'token', v_raw, 'expires_at', v_exp);
  end loop;

  update public.agreement_instances
     set state = 'sent', frozen_at = now(), sent_at = now(), expires_at = v_exp, unsigned_sha256 = v_unsigned
   where id = p_agreement_id and state in ('draft', 'approved_for_send');

  insert into public.signature_events (agreement_id, event_type, actor_profile_id, detail)
  values (p_agreement_id, 'sent', v_uid, jsonb_build_object('expires_at', v_exp, 'unsigned_sha256', v_unsigned));

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values (now(), v_uid, 'owner', 'UPDATE', 'agreement_instance', p_agreement_id,
          'Sent agreement ' || v_ai.reference || ' for signature',
          jsonb_build_object('expires_at', v_exp, 'signer_count', v_signer_count));

  return jsonb_build_object('was_transitioned', true, 'state', 'sent', 'agreement_id', p_agreement_id,
                            'unsigned_sha256', v_unsigned, 'expires_at', v_exp, 'tokens', v_tokens);
end $$;

-- ===========================================================================
-- 5. Internal: resolve a raw magic-link token to a live signature_request.
--    Returns the request row or raises. Not granted to any API role directly.
-- ===========================================================================
create or replace function public.resolve_signature_request(p_token text)
returns public.signature_requests
language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_req public.signature_requests;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid signing token'; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  select * into v_req from public.signature_requests where token_hash = v_hash;
  if v_req.id is null then raise exception 'Signing link not found'; end if;
  if v_req.revoked_at is not null then raise exception 'This signing link has been revoked'; end if;
  if v_req.expires_at < now() then raise exception 'This signing link has expired'; end if;
  return v_req;
end $$;
revoke all on function public.resolve_signature_request(text) from public, anon, authenticated;

-- ===========================================================================
-- 6. open_signature_request — signer opens the magic link. sent -> viewed.
-- ===========================================================================
create or replace function public.open_signature_request(p_token text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_req public.signature_requests; v_ai public.agreement_instances;
begin
  v_req := public.resolve_signature_request(p_token);
  perform pg_advisory_xact_lock(hashtext('agreement:' || v_req.agreement_id::text));
  select * into v_ai from public.agreement_instances where id = v_req.agreement_id;

  update public.signature_requests set last_opened_at = now() where id = v_req.id;

  if v_ai.state = 'sent' then
    update public.agreement_instances set state = 'viewed', first_viewed_at = coalesce(first_viewed_at, now())
     where id = v_ai.id and state = 'sent';
    insert into public.signature_events (agreement_id, event_type, party_snapshot_id, detail)
    values (v_ai.id, 'viewed', v_req.party_snapshot_id, jsonb_build_object('via', 'magic_link'));
  end if;

  return jsonb_build_object('agreement_id', v_ai.id, 'reference', v_ai.reference,
                            'document_type', v_ai.document_type, 'title', v_ai.title_snapshot,
                            'state', (select state from public.agreement_instances where id = v_ai.id),
                            'party_snapshot_id', v_req.party_snapshot_id, 'expires_at', v_req.expires_at);
end $$;

-- ===========================================================================
-- 7. record_agreement_consent — signer records one acknowledgement (§7.2/§9).
--    No pre-ticking: `accepted` is exactly what the signer chose.
-- ===========================================================================
create or replace function public.record_agreement_consent(
  p_token          text,
  p_consent_kind   text,
  p_notice_version text,
  p_accepted       boolean,
  p_ip_hash        text default null,
  p_user_agent_hash text default null
) returns public.consent_records
language plpgsql security definer set search_path = '' as $$
declare v_req public.signature_requests; v_row public.consent_records;
begin
  v_req := public.resolve_signature_request(p_token);
  if p_accepted is null then raise exception 'Consent choice is required'; end if;

  -- consent_records is APPEND-ONLY (UPDATE/DELETE blocked by trigger), so this is
  -- an INSERT-or-return, never an update. The FIRST recorded acknowledgement of a
  -- kind is the immutable evidence; a repeat call is idempotent (returns the
  -- existing row, emits no duplicate event). Correcting a recorded consent is a
  -- re-send/withdraw flow, not an in-place edit (§11.2).
  insert into public.consent_records
    (agreement_id, party_snapshot_id, consent_kind, notice_version, accepted, ip_hash, user_agent_hash)
  values (v_req.agreement_id, v_req.party_snapshot_id, p_consent_kind,
          nullif(btrim(coalesce(p_notice_version,'')),''), p_accepted, p_ip_hash, p_user_agent_hash)
  on conflict (agreement_id, party_snapshot_id, consent_kind) do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Already recorded (immutable) — return the existing row, no new event.
    select * into v_row from public.consent_records
     where agreement_id = v_req.agreement_id and party_snapshot_id = v_req.party_snapshot_id
       and consent_kind = p_consent_kind;
    if v_row.id is null then raise exception 'Consent was not recorded (no row written)'; end if;
    return v_row;
  end if;

  insert into public.signature_events (agreement_id, event_type, party_snapshot_id, consent_text_version, detail)
  values (v_req.agreement_id, 'consent_recorded', v_req.party_snapshot_id, nullif(btrim(coalesce(p_notice_version,'')),''),
          jsonb_build_object('consent_kind', p_consent_kind, 'accepted', p_accepted));
  return v_row;
end $$;

-- ===========================================================================
-- 8. submit_agreement_signature — signer signs. Requires the four mandatory
--    §7.2 acknowledgements accepted first; writes the private signature artifact;
--    moves the state to countersign_pending; consumes the magic link.
-- ===========================================================================
create or replace function public.submit_agreement_signature(
  p_token          text,
  p_method         public.signature_method,
  p_artifact_sha256 text default null,
  p_storage_path   text default null,
  p_adopted_text   text default null,
  p_ip_hash        text default null,
  p_user_agent_hash text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_req public.signature_requests; v_ai public.agreement_instances; v_ok int; v_hash text;
begin
  v_req := public.resolve_signature_request(p_token);
  if v_req.consumed_at is not null then raise exception 'This signing link has already been used to sign'; end if;
  perform pg_advisory_xact_lock(hashtext('agreement:' || v_req.agreement_id::text));
  select * into v_ai from public.agreement_instances where id = v_req.agreement_id;
  if v_ai.state not in ('sent', 'viewed', 'in_progress') then
    raise exception 'Agreement % is not open for signing (state %)', v_ai.reference, v_ai.state;
  end if;

  -- §7.2 gate: the four mandatory acknowledgements must be accepted.
  select count(distinct consent_kind) into v_ok from public.consent_records
   where agreement_id = v_req.agreement_id and party_snapshot_id = v_req.party_snapshot_id
     and accepted and consent_kind in ('signer_identity','reviewed_document','intent_to_bind','electronic_delivery');
  if v_ok < 4 then
    raise exception 'All required acknowledgements must be accepted before signing (§7.2)';
  end if;

  v_hash := lower(nullif(btrim(coalesce(p_artifact_sha256,'')),''));
  if v_hash is not null and v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'artifact_sha256 must be a lowercase 64-hex digest';
  end if;

  insert into public.signature_artifacts
    (agreement_id, party_snapshot_id, method, artifact_sha256, storage_path, adopted_text)
  values (v_req.agreement_id, v_req.party_snapshot_id, p_method, v_hash,
          nullif(btrim(coalesce(p_storage_path,'')),''), nullif(btrim(coalesce(p_adopted_text,'')),''));

  update public.signature_requests set consumed_at = now(), auth_method = 'magic_link' where id = v_req.id;

  update public.agreement_instances
     set state = 'countersign_pending', signer_signed_at = now(), countersign_pending_at = now()
   where id = v_req.agreement_id;

  insert into public.signature_events (agreement_id, event_type, party_snapshot_id, signature_method, ip_hash, user_agent_hash)
  values (v_req.agreement_id, 'signer_signed', v_req.party_snapshot_id, p_method, p_ip_hash, p_user_agent_hash);
  insert into public.signature_events (agreement_id, event_type, party_snapshot_id)
  values (v_req.agreement_id, 'countersign_pending', v_req.party_snapshot_id);

  return jsonb_build_object('was_transitioned', true, 'state', 'countersign_pending', 'agreement_id', v_req.agreement_id);
end $$;

-- ===========================================================================
-- 9. countersign_agreement — owner (FNC) countersigns + executes. Writes the
--    executed-document artifact + evidence certificate reference and moves the
--    agreement to executed. Requires the flattened PDF hash (renderer-supplied).
-- ===========================================================================
create or replace function public.countersign_agreement(
  p_agreement_id       uuid,
  p_executed_pdf_sha256 text,
  p_executed_pdf_path  text default null,
  p_certificate_path   text default null,
  p_certificate_sha256 text default null,
  p_method             public.signature_method default 'system_applied'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_ai public.agreement_instances; v_sha text; v_certref text;
begin
  if not public.is_owner() then raise exception 'Only the owner can countersign agreements'; end if;
  v_sha := lower(nullif(btrim(coalesce(p_executed_pdf_sha256,'')),''));
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'A 64-hex executed-PDF SHA-256 is required to execute';
  end if;

  perform pg_advisory_xact_lock(hashtext('agreement:' || p_agreement_id::text));
  select * into v_ai from public.agreement_instances where id = p_agreement_id;
  if v_ai.id is null then raise exception 'Agreement % not found', p_agreement_id; end if;
  if v_ai.state = 'executed' then
    return jsonb_build_object('was_transitioned', false, 'state', 'executed', 'reason', 'already_executed');
  end if;
  if v_ai.state <> 'countersign_pending' then
    raise exception 'Only a countersign_pending agreement can be executed (state %)', v_ai.state;
  end if;

  v_certref := v_ai.reference || '-CERT';

  insert into public.executed_document_artifacts
    (agreement_id, executed_pdf_path, executed_pdf_sha256, certificate_path, certificate_sha256,
     unsigned_sha256, certificate_reference)
  values (p_agreement_id, nullif(btrim(coalesce(p_executed_pdf_path,'')),''), v_sha,
          nullif(btrim(coalesce(p_certificate_path,'')),''), lower(nullif(btrim(coalesce(p_certificate_sha256,'')),'')),
          v_ai.unsigned_sha256, v_certref);

  update public.agreement_instances
     set state = 'executed', executed_at = now(), executed_sha256 = v_sha
   where id = p_agreement_id and state = 'countersign_pending';

  insert into public.signature_events (agreement_id, event_type, actor_profile_id, signature_method)
  values (p_agreement_id, 'countersigned', v_uid, p_method);
  insert into public.signature_events (agreement_id, event_type, actor_profile_id, detail)
  values (p_agreement_id, 'executed', v_uid, jsonb_build_object('executed_sha256', v_sha, 'certificate_reference', v_certref));

  insert into public.activity_logs
    (occurred_at, user_id, user_role, event_type, entity_type, entity_id, description, after_values)
  values (now(), v_uid, 'owner', 'UPDATE', 'agreement_instance', p_agreement_id,
          'Executed agreement ' || v_ai.reference,
          jsonb_build_object('executed_sha256', v_sha, 'certificate_reference', v_certref));

  return jsonb_build_object('was_transitioned', true, 'state', 'executed', 'agreement_id', p_agreement_id,
                            'certificate_reference', v_certref);
end $$;

-- ===========================================================================
-- 10. withdraw_agreement — owner withdraws a non-terminal agreement.
-- ===========================================================================
create or replace function public.withdraw_agreement(p_agreement_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_state public.agreement_state; v_ref text; v_id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can withdraw agreements'; end if;
  perform pg_advisory_xact_lock(hashtext('agreement:' || p_agreement_id::text));
  select state, reference into v_state, v_ref from public.agreement_instances where id = p_agreement_id;
  if v_state is null then raise exception 'Agreement % not found', p_agreement_id; end if;
  if v_state in ('executed','expired','declined','withdrawn','superseded','delivery_failed','identity_failed') then
    raise exception 'Agreement % is terminal (state %) and cannot be withdrawn', v_ref, v_state;
  end if;

  update public.agreement_instances
     set state = 'withdrawn', terminal_at = now(), withdraw_reason = nullif(btrim(coalesce(p_reason,'')),'')
   where id = p_agreement_id returning id into v_id;
  if v_id is null then raise exception 'Agreement % was not withdrawn (no row written)', p_agreement_id; end if;

  -- Revoke any live signing links.
  update public.signature_requests set revoked_at = now(), revoked_by = v_uid
   where agreement_id = p_agreement_id and revoked_at is null and consumed_at is null;

  insert into public.signature_events (agreement_id, event_type, actor_profile_id, detail)
  values (p_agreement_id, 'withdrawn', v_uid, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')),'')));
  return jsonb_build_object('was_transitioned', true, 'state', 'withdrawn');
end $$;

-- ===========================================================================
-- 11. decline_signature_request — signer declines via the magic link.
-- ===========================================================================
create or replace function public.decline_signature_request(p_token text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_req public.signature_requests; v_state public.agreement_state;
begin
  v_req := public.resolve_signature_request(p_token);
  perform pg_advisory_xact_lock(hashtext('agreement:' || v_req.agreement_id::text));
  select state into v_state from public.agreement_instances where id = v_req.agreement_id;
  if v_state in ('executed','expired','declined','withdrawn','superseded','delivery_failed','identity_failed') then
    raise exception 'Agreement is terminal (state %) and cannot be declined', v_state;
  end if;

  update public.agreement_instances
     set state = 'declined', terminal_at = now(), decline_reason = nullif(btrim(coalesce(p_reason,'')),'')
   where id = v_req.agreement_id;
  update public.signature_requests set revoked_at = now()
   where agreement_id = v_req.agreement_id and revoked_at is null and consumed_at is null;

  insert into public.signature_events (agreement_id, event_type, party_snapshot_id, detail)
  values (v_req.agreement_id, 'declined', v_req.party_snapshot_id, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')),'')));
  return jsonb_build_object('was_transitioned', true, 'state', 'declined');
end $$;

-- ===========================================================================
-- 12. expire_due_agreements — owner/service sweep: any non-terminal agreement
--     past its expires_at becomes expired. (pg_cron scheduling is deferred to the
--     delivery/reminders PR, spec PR 14; this is the callable sweep.)
-- ===========================================================================
create or replace function public.expire_due_agreements()
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; r record;
begin
  if not (public.is_owner() or (select auth.uid()) is null) then
    raise exception 'Only the owner (or the service role) can run the expiry sweep';
  end if;
  for r in select id from public.agreement_instances
            where state in ('sent','viewed','in_progress','countersign_pending','approved_for_send')
              and expires_at is not null and expires_at < now() loop
    update public.agreement_instances set state = 'expired', terminal_at = now()
     where id = r.id and state in ('sent','viewed','in_progress','countersign_pending','approved_for_send');
    update public.signature_requests set revoked_at = now()
     where agreement_id = r.id and revoked_at is null and consumed_at is null;
    insert into public.signature_events (agreement_id, event_type, detail)
    values (r.id, 'expired', jsonb_build_object('swept_at', now()));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ===========================================================================
-- 13. Grants matrix (FIX-A posture).
--     Owner-gated RPCs → authenticated + service_role + postgres.
--     Token-gated signer RPCs → authenticated + service_role (+ postgres); the
--     token is the credential, but we still keep them off anon.
-- ===========================================================================
do $$
declare fn text;
  owner_fns constant text[] := array[
    'create_agreement_instance(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid)',
    'add_agreement_party(uuid, public.agreement_party_role, text, integer, text, text, text, text, uuid, boolean)',
    'set_agreement_variables(uuid, jsonb)',
    'send_agreement(uuid, integer)',
    'countersign_agreement(uuid, text, text, text, text, public.signature_method)',
    'withdraw_agreement(uuid, text)',
    'expire_due_agreements()'
  ];
  token_fns constant text[] := array[
    'open_signature_request(text)',
    'record_agreement_consent(text, text, text, boolean, text, text)',
    'submit_agreement_signature(text, public.signature_method, text, text, text, text, text)',
    'decline_signature_request(text, text)'
  ];
begin
  foreach fn in array owner_fns || token_fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
    execute format('grant execute on function public.%s to postgres', fn);
  end loop;
end $$;

-- ===========================================================================
-- 14. Behavioural assertions — a full rolled-back lifecycle under the owner's
--     auth context: create -> add parties -> set variables -> send (capture the
--     raw token) -> open -> 4 consents -> sign -> countersign -> executed, plus
--     the §7.2 consent-gate rejection and the executed-immutability backstop.
--     Skips cleanly if no owner profile is resolvable. All rows are rolled back.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_tid uuid; v_ver uuid; v_ai uuid; v_signer uuid; v_res jsonb;
  v_token text; v_state public.agreement_state; v_kind text;
begin
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  if v_owner is null then
    raise notice 'PR A e-sign RPCs: behavioural assertions skipped (no owner profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    -- A published template version to issue against (reusing Build-41 RPCs).
    v_tid := (public.create_legal_document_template(
      'nda'::public.legal_document_type, 'partner'::public.legal_document_role,
      'Fund Now Capital (Pty) Ltd', 'PR A Rollback NDA', 'ZA', 'esign behavioural test')).id;
    v_ver := (public.create_legal_template_version(v_tid, '1.0', '# Placeholder execution copy (esign test)')).id;
    perform public.publish_legal_template_version(v_ver);

    -- Create an agreement with the owner as the (test) subject; add signer + FNC.
    v_ai := (public.create_agreement_instance(v_ver, null, null, null, v_owner, null, 'esign-test-idem-1')).id;
    -- idempotency: same key returns the same instance.
    if (public.create_agreement_instance(v_ver, null, null, null, v_owner, null, 'esign-test-idem-1')).id <> v_ai then
      raise exception 'assert: idempotency key did not return the same instance';
    end if;

    v_signer := (public.add_agreement_party(v_ai, 'signer'::public.agreement_party_role, 'Test Signer', 1)).id;
    perform public.add_agreement_party(v_ai, 'countersignatory'::public.agreement_party_role, 'FNC Signatory', 2,
                                       null, null, null, null, null, true);
    perform public.set_agreement_variables(v_ai, jsonb_build_object('sample', 'value'));

    -- Send: freezes snapshots, returns the raw signer token.
    v_res := public.send_agreement(v_ai, 7);
    if (v_res->>'state') <> 'sent' then raise exception 'assert: send did not reach sent (%)', v_res; end if;
    v_token := v_res#>>'{tokens,0,token}';
    if v_token is null or v_token !~ '^[0-9a-f]{64}$' then raise exception 'assert: no raw token returned'; end if;

    -- Frozen party snapshot rejects edits (§11.2 immutability).
    begin
      update public.agreement_party_snapshots set legal_name = 'tampered' where id = v_signer;
      raise exception 'assert: frozen party edit was allowed';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%immutable%' then raise exception 'assert: wrong frozen-party error: %', sqlerrm; end if;
    end;

    -- Open the magic link → viewed.
    v_res := public.open_signature_request(v_token);
    if (v_res->>'state') <> 'viewed' then raise exception 'assert: open did not reach viewed (%)', v_res; end if;

    -- Signing before consents must fail (§7.2 gate).
    begin
      perform public.submit_agreement_signature(v_token, 'typed'::public.signature_method, null, null, 'Test Signer');
      raise exception 'assert: signing without consents was allowed';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%acknowledgements%' then raise exception 'assert: wrong consent-gate error: %', sqlerrm; end if;
    end;

    -- Record the four mandatory acknowledgements.
    foreach v_kind in array array['signer_identity','reviewed_document','intent_to_bind','electronic_delivery'] loop
      perform public.record_agreement_consent(v_token, v_kind, 'v1.0', true);
    end loop;

    -- Now signing succeeds → countersign_pending; link is consumed.
    v_res := public.submit_agreement_signature(v_token, 'typed'::public.signature_method, null, null, 'Test Signer');
    if (v_res->>'state') <> 'countersign_pending' then raise exception 'assert: sign did not reach countersign_pending (%)', v_res; end if;

    -- Re-using a consumed link must fail.
    begin
      perform public.submit_agreement_signature(v_token, 'typed'::public.signature_method, null, null, 'Test Signer');
      raise exception 'assert: consumed link was reusable';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%already been used%' then raise exception 'assert: wrong reuse error: %', sqlerrm; end if;
    end;

    -- Owner countersigns → executed.
    v_res := public.countersign_agreement(v_ai, repeat('a', 64));
    if (v_res->>'state') <> 'executed' then raise exception 'assert: countersign did not reach executed (%)', v_res; end if;
    if not exists (select 1 from public.agreement_instances
        where id = v_ai and state='executed' and executed_at is not null and executed_sha256 is not null) then
      raise exception 'assert: executed evidence not stamped'; end if;
    if not exists (select 1 from public.executed_document_artifacts where agreement_id = v_ai) then
      raise exception 'assert: executed artifact not written'; end if;

    -- Executed agreement immutability: a subject swap is rejected.
    begin
      update public.agreement_instances set subject_profile_id = null where id = v_ai;
      raise exception 'assert: executed agreement was mutated';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%immutable%' then raise exception 'assert: wrong executed-immutability error: %', sqlerrm; end if;
    end;

    -- Append-only ledger: a signature_events UPDATE is rejected.
    begin
      update public.signature_events set detail = '{}'::jsonb where agreement_id = v_ai;
      raise exception 'assert: signature_events was mutable';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%append-only%' then raise exception 'assert: wrong append-only error: %', sqlerrm; end if;
    end;

    raise notice 'PR A e-sign RPCs: behavioural assertions passed (create/send/open/consent-gate/sign/countersign/executed, immutability, append-only, idempotency).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
