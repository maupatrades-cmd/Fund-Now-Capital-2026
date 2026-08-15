-- Build 3 reconciliation — make client legal document types usable.
--
-- Authority & Consent was added as a legal_document_type by Build 3, but the
-- template registry's dedicated role enum still contained only onboarding
-- roles. Without `client`, the Owner Document Studio cannot create a correctly
-- scoped client Authority & Consent template (or any other client template).
--
-- Forward fix only. This does not create templates, ingest wording or PDF bytes,
-- apply migrations, or change any existing template row.

alter type public.legal_document_role add value if not exists 'client';

comment on column public.legal_document_templates.role is
  'Agreement-bearing role (partner/contractor/lead_referrer/client) — a dedicated enum, NOT the platform user_role.';

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typnamespace = 'public'::regnamespace
       and t.typname = 'legal_document_role'
       and e.enumlabel = 'client'
  ) then
    raise exception 'assert FAIL: legal_document_role is missing value client';
  end if;

  raise notice 'Build 3 reconciliation: legal_document_role now supports client templates.';
end $$;

notify pgrst, 'reload schema';
