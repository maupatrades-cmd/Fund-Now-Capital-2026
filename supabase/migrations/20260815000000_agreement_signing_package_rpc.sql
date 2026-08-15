-- ===========================================================================
-- Build 8.1 — get_agreement_signing_package(p_token)
--
-- WHY THIS EXISTS
-- The e-sign backend (PR #200/#214) gives a signer everything except the one
-- thing they actually need in order to sign: the words. `legal_document_
-- template_versions` is owner-only RLS (`legal_template_versions_owner_all`),
-- so a partner / contractor / lead-referrer holding a valid signing token can
-- open the link (`open_signature_request`) and see the title — but cannot read
-- the execution copy they are about to be bound by. Signing a document you
-- cannot read is not a defensible electronic signature (ECTA §13 intent, and
-- the §7.2 `reviewed_document` acknowledgement would be a lie).
--
-- This RPC closes that hole: the TOKEN is the credential, exactly as it is for
-- the other signer-facing RPCs, and a SECURITY DEFINER read returns the frozen
-- package for that token and nothing else.
--
-- DESIGN NOTES
--  * READ-ONLY. It writes no rows and emits no events. The `sent -> viewed`
--    transition and its ledger event stay in `open_signature_request`, so a
--    signer refreshing the page cannot spam the append-only evidence ledger.
--  * Returns the content EXACTLY as the renderer draws it (raw markdown, no
--    variable substitution) so what the signer reads on screen is what lands
--    in the executed PDF. Do not "helpfully" interpolate here without changing
--    generate-legal-document-pdf in the same breath.
--  * Grants match the house posture: authenticated + service_role + postgres,
--    anon explicitly revoked (see the schema-migration assertions that fail if
--    any e-sign object is reachable by anon).
-- ===========================================================================

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
  -- Validates format, existence, revocation and expiry; raises otherwise.
  v_req := public.resolve_signature_request(p_token);

  select * into v_ai    from public.agreement_instances          where id = v_req.agreement_id;
  select * into v_party from public.agreement_party_snapshots    where id = v_req.party_snapshot_id;
  select * into v_ver   from public.legal_document_template_versions where id = v_ai.template_version_id;
  select * into v_vars  from public.agreement_variable_snapshots where agreement_id = v_ai.id;

  -- Acknowledgements already recorded for THIS party, as {kind: accepted}.
  -- consent_records is append-only, so this is the immutable truth, not a draft.
  select coalesce(jsonb_object_agg(consent_kind, accepted), '{}'::jsonb)
    into v_consents
    from public.consent_records
   where agreement_id = v_req.agreement_id
     and party_snapshot_id = v_req.party_snapshot_id;

  -- The other parties, so the signer can see who else is on the document.
  -- Deliberately name/role/capacity only — never emails, mobiles or profile ids.
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
      'id',              v_ai.id,
      'reference',       v_ai.reference,
      'document_type',   v_ai.document_type,
      'title',           v_ai.title_snapshot,
      'state',           v_ai.state,
      'sent_at',         v_ai.sent_at,
      'expires_at',      v_req.expires_at,
      'unsigned_sha256', v_ai.unsigned_sha256,
      'decline_reason',  v_ai.decline_reason
    ),
    'party', jsonb_build_object(
      'id',                v_party.id,
      'party_role',        v_party.party_role,
      'legal_name',        v_party.legal_name,
      'represented_party', v_party.represented_party,
      'capacity',          v_party.capacity,
      'is_fnc',            v_party.is_fnc
    ),
    'other_parties', v_others,
    'document', jsonb_build_object(
      -- May be null when the version is source-file-backed rather than inline
      -- markdown; the UI must refuse to collect a signature in that case.
      'content_markdown',   v_ver.content_markdown,
      'content_sha256',     v_ver.content_sha256,
      'version',            v_ver.version,
      'effective_date',     v_ver.effective_date,
      'has_source_file',    (v_ver.source_storage_path is not null),
      'source_filename',    v_ver.source_filename
    ),
    'variables',   coalesce(v_vars.variables, '{}'::jsonb),
    'fee_summary', v_vars.fee_summary,
    'consents',    v_consents,
    -- Derived flags so the client never re-implements the state machine.
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

comment on function public.get_agreement_signing_package(text) is
  'Token-gated read-only signing package: frozen agreement + party + execution-copy markdown + recorded acknowledgements. The token is the credential (same posture as the other signer RPCs). Writes nothing — the viewed transition stays in open_signature_request.';

-- ---------------------------------------------------------------------------
-- Grants (FIX-A posture): token-gated signer RPC, anon stays revoked.
-- ---------------------------------------------------------------------------
revoke all on function public.get_agreement_signing_package(text) from public, anon;
grant execute on function public.get_agreement_signing_package(text) to authenticated;
grant execute on function public.get_agreement_signing_package(text) to service_role;
grant execute on function public.get_agreement_signing_package(text) to postgres;

-- ===========================================================================
-- Behavioural assertions — full rollback. Builds a published template + a sent
-- agreement under the owner's auth context, then proves the package reads back
-- the content, tracks consents, flips can_sign after signing, and rejects a
-- garbage token. All rows are rolled back.
-- ===========================================================================
do $$
declare
  v_owner uuid; v_tid uuid; v_ver uuid; v_ai uuid; v_res jsonb; v_token text; v_pkg jsonb; v_kind text;
begin
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  if v_owner is null then
    raise notice 'Build 8.1 signing package: assertions skipped (no owner profile).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    v_tid := (public.create_legal_document_template(
      'nda'::public.legal_document_type, 'partner'::public.legal_document_role,
      'Fund Now Capital (Pty) Ltd', 'Build 8.1 Rollback NDA', 'ZA', 'signing package test')).id;
    v_ver := (public.create_legal_template_version(v_tid, '1.0', '# Rollback execution copy' || chr(10) || 'Body text.')).id;
    perform public.publish_legal_template_version(v_ver);

    v_ai := (public.create_agreement_instance(v_ver, null, null, null, v_owner)).id;
    perform public.add_agreement_party(v_ai, 'signer'::public.agreement_party_role, 'Package Test Signer', 1);
    perform public.add_agreement_party(v_ai, 'countersignatory'::public.agreement_party_role, 'FNC Signatory', 2,
                                       null, null, null, null, null, true);
    perform public.set_agreement_variables(v_ai, jsonb_build_object('sample', 'value'));

    v_res := public.send_agreement(v_ai, 7);
    v_token := v_res#>>'{tokens,0,token}';
    if v_token is null then raise exception 'assert: no raw token returned'; end if;

    -- The package must expose the execution copy and allow signing.
    v_pkg := public.get_agreement_signing_package(v_token);
    if (v_pkg#>>'{document,content_markdown}') not like '# Rollback execution copy%' then
      raise exception 'assert: execution copy not returned in the package';
    end if;
    if (v_pkg->>'can_sign')::boolean is not true then
      raise exception 'assert: can_sign should be true on a freshly sent agreement (%)', v_pkg->>'can_sign';
    end if;
    if (v_pkg->>'already_signed')::boolean is not false then
      raise exception 'assert: already_signed should be false before signing';
    end if;
    if jsonb_array_length(v_pkg->'other_parties') <> 1 then
      raise exception 'assert: expected exactly one counterparty in the package';
    end if;
    -- The counterparty block must never leak contact details.
    if (v_pkg#>'{other_parties,0}') ? 'email' then
      raise exception 'assert: counterparty block leaked an email';
    end if;

    -- Consents are reflected as they are recorded.
    foreach v_kind in array array['signer_identity','reviewed_document','intent_to_bind','electronic_delivery'] loop
      perform public.record_agreement_consent(v_token, v_kind, 'v1.0', true);
    end loop;
    v_pkg := public.get_agreement_signing_package(v_token);
    if (v_pkg#>>'{consents,intent_to_bind}')::boolean is not true then
      raise exception 'assert: recorded consent not reflected in the package';
    end if;

    -- After signing, the link is consumed and the package says so.
    perform public.submit_agreement_signature(v_token, 'typed'::public.signature_method, null, null, 'Package Test Signer');
    v_pkg := public.get_agreement_signing_package(v_token);
    if (v_pkg->>'already_signed')::boolean is not true then
      raise exception 'assert: already_signed should be true after signing';
    end if;
    if (v_pkg->>'can_sign')::boolean is not false then
      raise exception 'assert: can_sign should be false after signing';
    end if;

    -- A malformed token is rejected by resolve_signature_request.
    begin
      perform public.get_agreement_signing_package('not-a-token');
      raise exception 'assert: malformed token was accepted';
    exception when others then
      if sqlerrm like 'assert:%' then raise; end if;
      if sqlerrm not ilike '%Invalid signing token%' then
        raise exception 'assert: wrong malformed-token error: %', sqlerrm;
      end if;
    end;

    raise notice 'Build 8.1 signing package: assertions passed (content read, consents tracked, can_sign lifecycle, counterparty PII excluded, token validation).';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
end $$;

-- Structural assertions (persisted, not rolled back).
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_agreement_signing_package'
  ) then
    raise exception 'assert: get_agreement_signing_package was not created';
  end if;

  if has_function_privilege('anon', 'public.get_agreement_signing_package(text)', 'execute') then
    raise exception 'assert: signing package must not be granted to anon';
  end if;

  if not has_function_privilege('authenticated', 'public.get_agreement_signing_package(text)', 'execute') then
    raise exception 'assert: signing package must be executable by authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
