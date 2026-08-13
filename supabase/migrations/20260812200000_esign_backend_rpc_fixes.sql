-- PR A follow-up — E-Sign Evidence Backend RPC fixes (forward-only hotfix).
-- ============================================================================
-- Fixes the four review findings raised on PR #200 (the e-sign backend) BEFORE
-- that backend is exercised in production. Forward-only: CREATE OR REPLACE of the
-- four affected RPCs, so it corrects them wherever 20260812090100 has landed
-- without rewriting merged migration history. Must apply AFTER the e-sign
-- schema + RPC migrations (20260812090000 / 20260812090100).
--
--   1. expire_due_agreements — no longer sweeps 'countersign_pending'. A fully
--      signed agreement awaiting the owner's countersignature must not auto-expire
--      on the signer's link clock (that would orphan captured signature/consent
--      evidence). Countersignature is owner-paced, not link-timed.
--   2. submit_agreement_signature — only advances to 'countersign_pending' once
--      EVERY signer party has a signature artifact; otherwise the agreement stays
--      'in_progress' so remaining signers' links keep working. Previously the
--      first signer locked the others out on multi-signer packages.
--   3. decline_signature_request — rejects a decline once the link has been
--      consumed by signing, so a signed agreement can't be flipped to 'declined'
--      via a replayed token.
--   4. create_agreement_instance — advisory-locks on the idempotency key so
--      concurrent retries with the same key serialize and return the same row
--      instead of one hitting the unique index and raising.
-- ============================================================================

do $$
begin
  if to_regclass('public.agreement_instances') is null then
    raise exception
      'e-sign backend tables are missing — apply 20260812090000 + 20260812090100 before this fix migration';
  end if;
end $$;

-- ===========================================================================
-- Fix 4 — create_agreement_instance: advisory lock on the idempotency key.
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

  -- §13 idempotency: serialize concurrent retries on the key BEFORE the existence
  -- check, so a repeated key is a clean no-op instead of a unique-index violation.
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtext('agreement_idem:' || v_key));
    select * into v_row from public.agreement_instances where idempotency_key = v_key;
    if v_row.id is not null then return v_row; end if;
  end if;

  if num_nonnulls(p_client_id, p_subject_profile_id, p_lead_id) < 1 then
    raise exception 'An agreement needs at least one subject (client, subject profile, or lead)';
  end if;

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
-- Fix 2 — submit_agreement_signature: advance to countersign_pending only once
--         ALL signer parties have signed; otherwise stay in_progress.
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
declare
  v_req public.signature_requests; v_ai public.agreement_instances; v_ok int; v_hash text;
  v_signer_total int; v_signed_total int; v_new_state public.agreement_state;
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

  insert into public.signature_events (agreement_id, event_type, party_snapshot_id, signature_method, ip_hash, user_agent_hash)
  values (v_req.agreement_id, 'signer_signed', v_req.party_snapshot_id, p_method, p_ip_hash, p_user_agent_hash);

  -- Advance to countersign_pending ONLY when every signer party has signed;
  -- otherwise keep the agreement open (in_progress) for the remaining signers.
  select count(*) into v_signer_total from public.agreement_party_snapshots
   where agreement_id = v_req.agreement_id and party_role = 'signer';
  select count(distinct sa.party_snapshot_id) into v_signed_total
    from public.signature_artifacts sa
    join public.agreement_party_snapshots p on p.id = sa.party_snapshot_id
   where sa.agreement_id = v_req.agreement_id and p.party_role = 'signer';

  if v_signed_total >= v_signer_total then
    update public.agreement_instances
       set state = 'countersign_pending', signer_signed_at = now(), countersign_pending_at = now()
     where id = v_req.agreement_id;
    insert into public.signature_events (agreement_id, event_type, party_snapshot_id)
    values (v_req.agreement_id, 'countersign_pending', v_req.party_snapshot_id);
    v_new_state := 'countersign_pending';
  else
    update public.agreement_instances
       set state = 'in_progress'
     where id = v_req.agreement_id and state in ('sent','viewed','in_progress');
    insert into public.signature_events (agreement_id, event_type, party_snapshot_id, detail)
    values (v_req.agreement_id, 'in_progress', v_req.party_snapshot_id,
            jsonb_build_object('signed', v_signed_total, 'of', v_signer_total));
    v_new_state := 'in_progress';
  end if;

  return jsonb_build_object('was_transitioned', true, 'state', v_new_state, 'agreement_id', v_req.agreement_id);
end $$;

-- ===========================================================================
-- Fix 3 — decline_signature_request: reject once the link has been consumed.
-- ===========================================================================
create or replace function public.decline_signature_request(p_token text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_req public.signature_requests; v_state public.agreement_state;
begin
  v_req := public.resolve_signature_request(p_token);
  if v_req.consumed_at is not null then
    raise exception 'This signing link has already been used to sign and cannot be declined';
  end if;
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
-- Fix 1 — expire_due_agreements: do NOT sweep countersign_pending.
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
            where state in ('sent','viewed','in_progress','approved_for_send')
              and expires_at is not null and expires_at < now() loop
    update public.agreement_instances set state = 'expired', terminal_at = now()
     where id = r.id and state in ('sent','viewed','in_progress','approved_for_send');
    update public.signature_requests set revoked_at = now()
     where agreement_id = r.id and revoked_at is null and consumed_at is null;
    insert into public.signature_events (agreement_id, event_type, detail)
    values (r.id, 'expired', jsonb_build_object('swept_at', now()));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ===========================================================================
-- Re-assert the grants matrix for the replaced functions (unchanged signatures,
-- but CREATE OR REPLACE preserves grants — this is belt-and-braces).
-- ===========================================================================
do $$
declare fn text;
  fns constant text[] := array[
    'create_agreement_instance(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid)',
    'submit_agreement_signature(text, public.signature_method, text, text, text, text, text)',
    'decline_signature_request(text, text)',
    'expire_due_agreements()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
    execute format('grant execute on function public.%s to postgres', fn);
  end loop;
end $$;

-- ===========================================================================
-- Behavioural assertions — rolled back. Covers the two deterministic logic
-- fixes: multi-signer stays in_progress until all sign, and a signed link
-- cannot be replayed to decline. Skips if no owner profile.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_tid uuid; v_ver uuid; v_ai uuid; v_res jsonb;
  v_t1 text; v_t2 text; v_kind text;
begin
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  if v_owner is null then
    raise notice 'e-sign RPC fixes: behavioural assertions skipped (no owner profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    v_tid := (public.create_legal_document_template(
      'nda'::public.legal_document_type, 'partner'::public.legal_document_role,
      'Fund Now Capital (Pty) Ltd', 'PR A Fix Rollback NDA', 'ZA', 'esign fix test')).id;
    v_ver := (public.create_legal_template_version(v_tid, '1.0', '# Placeholder (fix test)')).id;
    perform public.publish_legal_template_version(v_ver);

    -- Two signer parties.
    v_ai := (public.create_agreement_instance(v_ver, null, null, null, v_owner, null, 'esign-fix-idem-1')).id;
    perform public.add_agreement_party(v_ai, 'signer'::public.agreement_party_role, 'Signer One', 1);
    perform public.add_agreement_party(v_ai, 'signer'::public.agreement_party_role, 'Signer Two', 2);
    v_res := public.send_agreement(v_ai, 7);
    v_t1 := v_res#>>'{tokens,0,token}';
    v_t2 := v_res#>>'{tokens,1,token}';
    if v_t1 is null or v_t2 is null then raise exception 'assert: expected two signer tokens'; end if;

    -- First signer signs → agreement stays in_progress (NOT countersign_pending).
    perform public.open_signature_request(v_t1);
    foreach v_kind in array array['signer_identity','reviewed_document','intent_to_bind','electronic_delivery'] loop
      perform public.record_agreement_consent(v_t1, v_kind, 'v1.0', true);
    end loop;
    v_res := public.submit_agreement_signature(v_t1, 'typed'::public.signature_method, null, null, 'Signer One');
    if (v_res->>'state') <> 'in_progress' then
      raise exception 'assert: first of two signers should leave state in_progress (got %)', v_res->>'state'; end if;

    -- Second signer signs → now countersign_pending.
    perform public.open_signature_request(v_t2);
    foreach v_kind in array array['signer_identity','reviewed_document','intent_to_bind','electronic_delivery'] loop
      perform public.record_agreement_consent(v_t2, v_kind, 'v1.0', true);
    end loop;
    v_res := public.submit_agreement_signature(v_t2, 'typed'::public.signature_method, null, null, 'Signer Two');
    if (v_res->>'state') <> 'countersign_pending' then
      raise exception 'assert: all signers signed should reach countersign_pending (got %)', v_res->>'state'; end if;

    -- A consumed (signed) link can no longer decline.
    begin
      perform public.decline_signature_request(v_t1, 'changed my mind');
      raise exception 'assert: decline after signing was allowed';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%already been used to sign%' then
        raise exception 'assert: wrong decline-after-sign error: %', sqlerrm; end if;
    end;

    raise notice 'e-sign RPC fixes: behavioural assertions passed (multi-signer gating, decline-after-sign block).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
