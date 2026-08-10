-- Build 19 — partner-view hardening + formal re-affirmation.
-- ============================================================================
-- OWNER DECISION (2026-08-10): KEEP the four partner surfaces as SECURITY
-- DEFINER views. They are the COLUMN-SAFE partner boundary — each embeds a
-- current_partner_id() row filter AND projects only partner-safe columns
-- (funder_display_name, never the real funders.name; stakeholder name/roles/
-- shareholding, never ID numbers/contact PII). Partners have NO direct SELECT
-- on the base tables.
--
-- Why NOT security_invoker + base-table RLS (the "textbook" fix): RLS is
-- ROW-level only, so a partner granted direct base-table SELECT could read
-- OWNER-ONLY COLUMNS (real funder names, the full commission split) that these
-- views strip out — a privacy REGRESSION that breaks S7C + funder anonymisation.
-- The definer view is deliberately the safer pattern here. The advisor's
-- SECURITY DEFINER ERROR on these four is therefore an ACCEPTED, DOCUMENTED
-- exception (AUDIT F5), not an oversight.
--
-- This migration adds NO behaviour. It (1) re-affirms the decision as executable
-- catalog assertions that TRIP if a future change regresses the invariants
-- (a real funder-name column appears on a partner view, a view is flipped to
-- security_invoker, a base table loses RLS, or the stakeholder view starts
-- leaking structured PII), and (2) is paired with
-- supabase/tests/partner_view_leak_tests.sql — the repeatable cross-partner
-- isolation + column-safety proof (run on a Supabase preview branch). All four
-- views already carry security_barrier=true (verified live 2026-08-10).
-- ============================================================================

do $$
declare
  v_views text[] := array['partner_leads_view','partner_submission_view',
                           'partner_funder_industry_appetite','partner_stakeholders_view'];
  v_name text; v_opts text[]; v_cols text[];
begin
  -- 1. Each view exists, is security_barrier, and stays SECURITY DEFINER.
  foreach v_name in array v_views loop
    select c.reloptions into v_opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname=v_name and c.relkind='v';
    if not found then
      raise exception 'assert FAIL: partner view public.% is missing', v_name; end if;
    if v_opts is null or not ('security_barrier=true' = any(v_opts)) then
      raise exception 'assert FAIL: public.% must keep security_barrier=true', v_name; end if;
    if v_opts is not null and ('security_invoker=true' = any(v_opts)) then
      raise exception 'assert FAIL: public.% must stay SECURITY DEFINER (owner decision, Build 19)', v_name; end if;
  end loop;

  -- 2. Column-safety tripwire: the real funder name must NEVER surface on a
  --    partner view; only the anonymised display name may.
  select array_agg(column_name) into v_cols from information_schema.columns
    where table_schema='public' and table_name='partner_submission_view';
  if v_cols && array['name','funder_name'] then
    raise exception 'assert FAIL: partner_submission_view exposes a real funder-name column'; end if;
  if not ('funder_display_name' = any(v_cols)) then
    raise exception 'assert FAIL: partner_submission_view must expose funder_display_name'; end if;

  select array_agg(column_name) into v_cols from information_schema.columns
    where table_schema='public' and table_name='partner_funder_industry_appetite';
  if v_cols && array['name','funder_name'] then
    raise exception 'assert FAIL: partner_funder_industry_appetite exposes a real funder-name column'; end if;
  if not ('funder_display_name' = any(v_cols)) then
    raise exception 'assert FAIL: partner_funder_industry_appetite must expose funder_display_name'; end if;

  -- 3. Stakeholder view must not leak structured PII (ID/passport/contact/DOB).
  select array_agg(column_name) into v_cols from information_schema.columns
    where table_schema='public' and table_name='partner_stakeholders_view';
  if v_cols && array['id_number','passport_number','id_or_passport_number','tax_number',
                     'email','phone','contact_number','date_of_birth','residential_address'] then
    raise exception 'assert FAIL: partner_stakeholders_view exposes structured PII'; end if;

  -- 4. Base tables must keep RLS enabled — the definer view is the ONLY partner
  --    path; if a base table lost RLS, partners could read it directly.
  foreach v_name in array array['leads','deal_funder_submissions','funder_industry_preferences',
                                'client_stakeholders','funders'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname=v_name and c.relrowsecurity) then
      raise exception 'assert FAIL: base table public.% must have RLS enabled', v_name; end if;
  end loop;

  raise notice 'Build 19: partner views re-affirmed (definer + security_barrier + column-safe); asserts passed.';
end $$;

-- Formal documentation of the accepted exception, on each view.
comment on view public.partner_leads_view is
  'Partner surface for leads. SECURITY DEFINER + security_barrier by owner decision (Build 19, 2026-08-10): column-safe projection + current_partner_id() row filter; partners have no base-table access. The advisor SECURITY DEFINER ERROR is an accepted, documented exception (converting would regress S7C column safety). Isolation proof: supabase/tests/partner_view_leak_tests.sql.';
comment on view public.partner_submission_view is
  'Partner surface for funder submissions. SECURITY DEFINER + security_barrier by owner decision (Build 19). Exposes funder_display_name only (never the real funders.name). Accepted advisor exception; see supabase/tests/partner_view_leak_tests.sql.';
comment on view public.partner_funder_industry_appetite is
  'Partner surface for funder industry appetite. SECURITY DEFINER + security_barrier by owner decision (Build 19). Anonymised funder_display_name only. Accepted advisor exception; see supabase/tests/partner_view_leak_tests.sql.';
comment on view public.partner_stakeholders_view is
  'Partner surface for client/lead stakeholders. SECURITY DEFINER + security_barrier by owner decision (Build 19). Name/roles/shareholding only — no ID numbers or contact PII. Accepted advisor exception; see supabase/tests/partner_view_leak_tests.sql.';
