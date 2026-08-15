-- Wave 8 — token-scoped signing packet read contract.
-- Returns only the exact frozen document and the current signer's own metadata.
-- No raw token/hash, email, mobile, IP evidence, storage path, internal variables,
-- or another party's data is exposed.

create or replace function public.open_signature_request_packet(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_req public.signature_requests;
  v_agreement public.agreement_instances;
  v_party public.agreement_party_snapshots;
  v_version public.legal_document_template_versions;
  v_template public.legal_document_templates;
  v_consents jsonb;
  v_opened jsonb;
begin
  if v_uid is null then raise exception 'Sign in before opening this agreement'; end if;
  v_req := public.resolve_signature_request(p_token);

  select * into v_agreement from public.agreement_instances where id = v_req.agreement_id;
  if v_agreement.id is null then raise exception 'Agreement not found'; end if;

  select * into v_party from public.agreement_party_snapshots
   where id = v_req.party_snapshot_id and agreement_id = v_req.agreement_id;
  if v_party.id is null then raise exception 'Signing party not found'; end if;
  if v_party.profile_id is not null and v_party.profile_id <> v_uid then
    raise exception 'This signing link belongs to another account';
  end if;

  select * into v_version from public.legal_document_template_versions
   where id = v_agreement.template_version_id;
  if v_version.id is null then raise exception 'Agreement template version not found'; end if;
  select * into v_template from public.legal_document_templates where id = v_version.template_id;
  if v_template.id is null then raise exception 'Agreement template not found'; end if;

  -- Record the view only after the linked-account check above. The nested RPC is
  -- idempotent for an already-viewed agreement and shares this transaction.
  v_opened := public.open_signature_request(p_token);

  select coalesce(jsonb_agg(cr.consent_kind order by cr.consent_kind), '[]'::jsonb)
    into v_consents from public.consent_records cr
   where cr.agreement_id = v_agreement.id and cr.party_snapshot_id = v_party.id and cr.accepted;

  return jsonb_build_object(
    'agreement_id', v_agreement.id,
    'reference', v_agreement.reference,
    'title', v_agreement.title_snapshot,
    'document_type', v_agreement.document_type,
    'state', v_opened->>'state',
    'expires_at', v_req.expires_at,
    'consumed_at', v_req.consumed_at,
    'party_legal_name', v_party.legal_name,
    'party_capacity', v_party.capacity,
    'represented_party', v_party.represented_party,
    'template_version', v_version.version,
    'effective_date', v_version.effective_date,
    'content_sha256', v_version.content_sha256,
    'content_markdown', v_version.content_markdown,
    'content_available', v_version.content_markdown is not null,
    'accepted_consents', v_consents
  );
end
$$;

comment on function public.open_signature_request_packet(text) is
  'Authenticated, token-scoped signing read. Exact inline wording and own party metadata only.';

revoke all on function public.open_signature_request_packet(text) from public, anon;
grant execute on function public.open_signature_request_packet(text) to authenticated, service_role, postgres;

do $$
begin
  if to_regprocedure('public.open_signature_request_packet(text)') is null then
    raise exception 'assert: open_signature_request_packet(text) missing';
  end if;
  if has_function_privilege('anon', 'public.open_signature_request_packet(text)', 'EXECUTE') then
    raise exception 'assert: anon must not execute open_signature_request_packet';
  end if;
  if not has_function_privilege('authenticated', 'public.open_signature_request_packet(text)', 'EXECUTE') then
    raise exception 'assert: authenticated must execute open_signature_request_packet';
  end if;
end
$$;

notify pgrst, 'reload schema';
