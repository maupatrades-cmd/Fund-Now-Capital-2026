-- ===========================================================================
-- Signing identity binding — a signing link is usable only by the named account.
--
-- WHY
-- The magic-link token was, on its own, a bearer credential: anyone who held it
-- AND was signed in to any FNC account could sign. Since a role signer is always
-- a platform user, we can do better — bind the link to the party's account.
-- This idea comes from the parallel Wave-8 signing implementation (PR #246);
-- it is the one thing that implementation did better, so it is kept here while
-- the rest of that duplicate surface is retired in favour of the merged one.
--
-- The rule is deliberately conditional: `profile_id` is NULL for a party who has
-- no platform account (an external client signatory), and those must keep
-- working exactly as before. Only a LINKED party is bound to their account.
--
-- Enforced in two places, because a read gate alone is decoration:
--   * get_agreement_signing_package — so the wrong account cannot even READ the
--     document (it is the counterparty's private contract).
--   * submit_agreement_signature    — the gate that actually matters. Without
--     this, a forwarded link could still be signed by the wrong person.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared guard. SECURITY DEFINER so it can read the snapshot regardless of the
-- caller's RLS view; raises rather than returning false so no call site can
-- forget to check the result.
-- ---------------------------------------------------------------------------
create or replace function public.assert_signing_party_is_caller(p_party_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile uuid; v_uid uuid := (select auth.uid());
begin
  select profile_id into v_profile
    from public.agreement_party_snapshots where id = p_party_snapshot_id;

  -- Unlinked party (external signatory): the token remains the sole credential.
  if v_profile is null then return; end if;

  if v_uid is null then
    raise exception 'Sign in to open this agreement';
  end if;
  if v_profile <> v_uid then
    raise exception 'This signing link belongs to another account';
  end if;
end $$;

revoke all on function public.assert_signing_party_is_caller(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-create the package read with the guard. Body is otherwise unchanged from
-- 20260815000000 — see that migration for the design notes.
-- ---------------------------------------------------------------------------
create or replace function public.get_agreement_signing_package(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req      public.signature_requests;
  v_ai       public.agreement_instances;
  v_party    public.agreement_party_snapshots;
  v_ver      public.legal_document_template_versions;
  v_vars     public.agreement_variable_snapshots;
  v_consents jsonb;
  v_others   jsonb;
begin
  v_req := public.resolve_signature_request(p_token);
  perform public.assert_signing_party_is_caller(v_req.party_snapshot_id);

  select * into v_ai    from public.agreement_instances          where id = v_req.agreement_id;
  select * into v_party from public.agreement_party_snapshots    where id = v_req.party_snapshot_id;
  select * into v_ver   from public.legal_document_template_versions where id = v_ai.template_version_id;
  select * into v_vars  from public.agreement_variable_snapshots where agreement_id = v_ai.id;

  select coalesce(jsonb_object_agg(consent_kind, accepted), '{}'::jsonb)
    into v_consents
    from public.consent_records
   where agreement_id = v_req.agreement_id
     and party_snapshot_id = v_req.party_snapshot_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'party_role', p.party_role,
           'legal_name', p.legal_name,
           'represented_party', p.represented_party,
           'capacity', p.capacity,
           'is_fnc', p.is_fnc
         ) order by p.party_order), '[]'::jsonb)
    into v_others
    from public.agreement_party_snapshots p
   where p.agreement_id = v_req.agreement_id
     and p.id <> v_req.party_snapshot_id;

  return jsonb_build_object(
    'agreement', jsonb_build_object(
      'id', v_ai.id, 'reference', v_ai.reference, 'document_type', v_ai.document_type,
      'title', v_ai.title_snapshot, 'state', v_ai.state, 'sent_at', v_ai.sent_at,
      'expires_at', v_req.expires_at, 'unsigned_sha256', v_ai.unsigned_sha256,
      'decline_reason', v_ai.decline_reason
    ),
    'party', jsonb_build_object(
      'id', v_party.id, 'party_role', v_party.party_role, 'legal_name', v_party.legal_name,
      'represented_party', v_party.represented_party, 'capacity', v_party.capacity,
      'is_fnc', v_party.is_fnc
    ),
    'other_parties', v_others,
    'document', jsonb_build_object(
      'content_markdown', v_ver.content_markdown,
      'content_sha256',   v_ver.content_sha256,
      'version',          v_ver.version,
      'effective_date',   v_ver.effective_date,
      'has_source_file',  (v_ver.source_storage_path is not null),
      'source_filename',  v_ver.source_filename
    ),
    'variables',   coalesce(v_vars.variables, '{}'::jsonb),
    'fee_summary', v_vars.fee_summary,
    'consents',    v_consents,
    'already_signed', (v_req.consumed_at is not null),
    'can_sign', (
      v_req.consumed_at is null
      and v_ai.state in ('sent', 'viewed', 'in_progress')
      and v_ver.content_markdown is not null
    ),
    'required_consent_kinds', jsonb_build_array(
      'signer_identity', 'reviewed_document', 'intent_to_bind', 'electronic_delivery'
    )
  );
end $$;

revoke all on function public.get_agreement_signing_package(text) from public, anon;
grant execute on function public.get_agreement_signing_package(text) to authenticated, service_role, postgres;

-- ---------------------------------------------------------------------------
-- The gate that matters: signing itself. Body unchanged from
-- 20260812090100 / 20260812200000 apart from the guard on the second line.
-- ---------------------------------------------------------------------------
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
  perform public.assert_signing_party_is_caller(v_req.party_snapshot_id);

  if v_req.consumed_at is not null then raise exception 'This signing link has already been used to sign'; end if;
  perform pg_advisory_xact_lock(hashtext('agreement:' || v_req.agreement_id::text));
  select * into v_ai from public.agreement_instances where id = v_req.agreement_id;
  if v_ai.state not in ('sent', 'viewed', 'in_progress') then
    raise exception 'Agreement % is not open for signing (state %)', v_ai.reference, v_ai.state;
  end if;

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

revoke all on function public.submit_agreement_signature(text, public.signature_method, text, text, text, text, text) from public, anon;
grant execute on function public.submit_agreement_signature(text, public.signature_method, text, text, text, text, text) to authenticated, service_role, postgres;

-- ---------------------------------------------------------------------------
-- Behavioural assertions — rolled back. Proves a LINKED party's link is refused
-- for a different account, and that an UNLINKED party still signs on the token
-- alone (the external-signatory path must not regress).
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid; v_other uuid; v_tid uuid; v_ver uuid; v_ai uuid;
  v_res jsonb; v_token text; v_kind text;
begin
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  select id into v_other from public.profiles where role <> 'owner' limit 1;
  if v_owner is null or v_other is null then
    raise notice 'Signing identity binding: assertions skipped (need an owner + one other profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    v_tid := (public.create_legal_document_template(
      'nda'::public.legal_document_type, 'partner'::public.legal_document_role,
      'Fund Now Capital (Pty) Ltd', 'Identity Binding Rollback NDA', 'ZA', 'identity binding test')).id;
    v_ver := (public.create_legal_template_version(v_tid, '1.0', '# Rollback copy' || chr(10) || 'Body.')).id;
    perform public.publish_legal_template_version(v_ver);

    -- Party LINKED to v_other.
    v_ai := (public.create_agreement_instance(v_ver, null, null, null, v_owner)).id;
    perform public.add_agreement_party(v_ai, 'signer'::public.agreement_party_role, 'Linked Signer', 1,
                                       null, null, null, null, v_other, false);
    perform public.add_agreement_party(v_ai, 'countersignatory'::public.agreement_party_role, 'FNC', 2,
                                       null, null, null, null, null, true);
    v_res := public.send_agreement(v_ai, 7);
    v_token := v_res#>>'{tokens,0,token}';

    -- The owner is NOT the linked party: both read and sign must refuse.
    begin
      perform public.get_agreement_signing_package(v_token);
      raise exception 'assert: wrong account was allowed to read the package';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%belongs to another account%' then
        raise exception 'assert: wrong read-refusal error: %', sqlerrm; end if;
    end;
    begin
      perform public.submit_agreement_signature(v_token, 'typed'::public.signature_method, null, null, 'X');
      raise exception 'assert: wrong account was allowed to sign';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not like '%belongs to another account%' then
        raise exception 'assert: wrong sign-refusal error: %', sqlerrm; end if;
    end;

    -- UNLINKED party: unchanged behaviour (token alone still works).
    v_ai := (public.create_agreement_instance(v_ver, null, null, null, v_owner)).id;
    perform public.add_agreement_party(v_ai, 'signer'::public.agreement_party_role, 'External Signer', 1);
    perform public.add_agreement_party(v_ai, 'countersignatory'::public.agreement_party_role, 'FNC', 2,
                                       null, null, null, null, null, true);
    v_res := public.send_agreement(v_ai, 7);
    v_token := v_res#>>'{tokens,0,token}';

    if (public.get_agreement_signing_package(v_token)->>'can_sign')::boolean is not true then
      raise exception 'assert: unlinked party lost read access';
    end if;
    foreach v_kind in array array['signer_identity','reviewed_document','intent_to_bind','electronic_delivery'] loop
      perform public.record_agreement_consent(v_token, v_kind, 'v1.0', true);
    end loop;
    v_res := public.submit_agreement_signature(v_token, 'typed'::public.signature_method, null, null, 'External Signer');
    if (v_res->>'state') <> 'countersign_pending' then
      raise exception 'assert: unlinked party could no longer sign (%)', v_res; end if;

    raise notice 'Signing identity binding: assertions passed (linked party bound to its account; unlinked external signatory unchanged).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

do $$
begin
  if to_regprocedure('public.assert_signing_party_is_caller(uuid)') is null then
    raise exception 'assert: guard function missing'; end if;
  if has_function_privilege('anon','public.get_agreement_signing_package(text)','EXECUTE') then
    raise exception 'assert: package read must not be granted to anon'; end if;
  if has_function_privilege('anon','public.submit_agreement_signature(text, public.signature_method, text, text, text, text, text)','EXECUTE') then
    raise exception 'assert: submit must not be granted to anon'; end if;
end $$;

notify pgrst, 'reload schema';
