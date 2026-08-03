-- C4.2 (Doctor Invoicing FNC) — branded partner-invoice PDF plumbing.
-- ============================================================================
-- Mirrors the C1.1 funder-invoice PDF pipeline (generate-invoice-pdf +
-- invoke_generate_invoice_pdf + private bucket) for the PARTNER → FNC invoice.
--
--   * partner_invoices.pdf_storage_path — where the rendered PDF lives.
--   * private `partner-invoices` bucket — owner reads all; a partner reads ONLY
--     their own folder (path = {referral_partner_id}/{invoice_number}.pdf).
--   * invoke_generate_partner_invoice_pdf(uuid) — pg_net POST to the Edge
--     Function (WEBHOOK_SECRET + edge_base_url from Vault), internal-only.
--   * a trigger renders the PDF when an invoice is SUBMITTED (the content is
--     final at that point — the owner reviews the PDF, the partner keeps a copy).
--     Decoupled AFTER-UPDATE trigger, so the C4.1 lifecycle RPCs are untouched.
--
-- S7C: the Edge Function renders the partner as the "FROM" (Bright Destiny logo),
-- FNC as "INVOICE TO", the FICTIONAL funder name per line, and the partner's take
-- only — no tier/gross/pool math. (The render lives in the function, not here.)
-- ============================================================================

-- 1. pdf_storage_path column ----------------------------------------------------
alter table public.partner_invoices add column if not exists pdf_storage_path text;

comment on column public.partner_invoices.pdf_storage_path is
  'Path of the rendered branded PDF in the private partner-invoices bucket ({referral_partner_id}/{invoice_number}.pdf). Written by generate-partner-invoice-pdf. Null until first rendered (on submit).';

-- 2. private bucket + RLS mirror ------------------------------------------------
insert into storage.buckets (id, name, public) values ('partner-invoices', 'partner-invoices', false)
  on conflict (id) do nothing;

-- Owner: full. Partner: SELECT only, and only inside their own {partner_id}/ folder.
-- Uploads are service-role (the Edge Function), so no partner INSERT policy.
drop policy if exists partner_invoices_bucket_owner_all on storage.objects;
create policy partner_invoices_bucket_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'partner-invoices' and public.is_owner())
  with check (bucket_id = 'partner-invoices' and public.is_owner());

drop policy if exists partner_invoices_bucket_partner_read_own on storage.objects;
create policy partner_invoices_bucket_partner_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'partner-invoices'
    and public.current_partner_id() is not null
    and (storage.foldername(name))[1] = public.current_partner_id()::text
  );

-- 3. pg_net invoker (mirrors invoke_generate_invoice_pdf) -----------------------
--    Internal only — EXECUTE revoked from every API role. Best-effort: a pg_net
--    or undeployed-function failure warns but never breaks the calling txn.
create or replace function public.invoke_generate_partner_invoice_pdf(p_partner_invoice_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_base_url text;
  v_secret   text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into v_secret   from vault.decrypted_secrets where name = 'webhook_secret';
  if v_base_url is null or v_secret is null then
    return;
  end if;
  begin
    perform net.http_post(
      url     := v_base_url || '/functions/v1/generate-partner-invoice-pdf',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', v_secret),
      body    := jsonb_build_object('partner_invoice_id', p_partner_invoice_id)
    );
  exception when others then
    raise warning 'invoke_generate_partner_invoice_pdf failed for %: %', p_partner_invoice_id, sqlerrm;
  end;
end $$;

revoke all on function public.invoke_generate_partner_invoice_pdf(uuid) from public, anon, authenticated;

-- 4. Render-on-submit trigger ---------------------------------------------------
--    Fires when an invoice enters 'submitted' — the content is final (the partner
--    can no longer edit it) so the PDF is a faithful record. Decoupled from the
--    C4.1 RPCs (no function-body duplication). SECURITY DEFINER to read Vault.
create or replace function public.partner_invoice_generate_pdf()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'submitted' and old.state is distinct from new.state then
    perform public.invoke_generate_partner_invoice_pdf(new.id);
  end if;
  return null;
end $$;

drop trigger if exists partner_invoice_generate_pdf on public.partner_invoices;
create trigger partner_invoice_generate_pdf
  after update of state on public.partner_invoices
  for each row execute function public.partner_invoice_generate_pdf();

-- 5. Assertions -----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='partner_invoices' and column_name='pdf_storage_path') then
    raise exception 'C4.2 assert FAIL: pdf_storage_path column missing'; end if;
  if not exists (select 1 from storage.buckets where id='partner-invoices') then
    raise exception 'C4.2 assert FAIL: partner-invoices bucket missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='partner_invoices_bucket_partner_read_own') then
    raise exception 'C4.2 assert FAIL: partner read-own storage policy missing'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='invoke_generate_partner_invoice_pdf') then
    raise exception 'C4.2 assert FAIL: invoke_generate_partner_invoice_pdf missing'; end if;
  if has_function_privilege('authenticated','public.invoke_generate_partner_invoice_pdf(uuid)','execute') then
    raise exception 'C4.2 assert FAIL: authenticated can execute internal invoke fn'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.partner_invoices'::regclass
      and tgname='partner_invoice_generate_pdf' and not tgisinternal) then
    raise exception 'C4.2 assert FAIL: render-on-submit trigger missing'; end if;
  raise notice 'C4.2 assertions passed: pdf_storage_path + bucket + RLS + invoke fn + render-on-submit trigger.';
end $$;

notify pgrst, 'reload schema';
