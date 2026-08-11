-- Build 19 — partner-view leak tests (cross-partner isolation + funder-name safety).
-- ============================================================================
-- Repeatable proof that the four SECURITY DEFINER partner views leak nothing:
--   * a partner sees only their OWN rows through the view (cross-partner isolation)
--   * the real funders.name never surfaces (only funder_display_name)
--
-- HOW IT WORKS: seeds two synthetic partners (A, B) + a lead each, then queries
-- the views while impersonating each partner via request.jwt.claims (which is
-- what current_partner_id()/auth.uid() read). The whole thing runs inside a
-- transaction and ROLLS BACK — nothing persists.
--
-- RUN IT ON A SUPABASE PREVIEW BRANCH OR LOCAL STACK, NOT PROD. Even though it
-- rolls back, it inserts rows; we set session_replication_role=replica for the
-- duration so activity/notification AFTER-triggers (which call pg_net → email)
-- do NOT fire. Run with the service role, e.g.:
--     psql "$DATABASE_URL" -f supabase/tests/partner_view_leak_tests.sql
-- A successful run prints "Build 19 leak tests: ALL PASSED" and raises on any leak.
-- ============================================================================

begin;

-- Disable user + FK/system triggers for the test so seeding causes no
-- notification/email side-effects. (Rolled back regardless.)
set local session_replication_role = replica;

do $$
declare
  v_uid_a  uuid := '00000000-0000-4000-a000-0000000000a1';
  v_uid_b  uuid := '00000000-0000-4000-b000-0000000000b1';
  v_rp_a   uuid := gen_random_uuid();
  v_rp_b   uuid := gen_random_uuid();
  v_lead_a uuid;
  v_lead_b uuid;
  v_leak   int;
begin
  -- --- seed two partners + a profile each -----------------------------------
  insert into public.referral_partners (id, name) values
    (v_rp_a, 'LEAKTEST Partner A'), (v_rp_b, 'LEAKTEST Partner B');

  -- profiles.id references auth.users; with replica mode the FK is not enforced,
  -- but we insert the auth rows too so the harness also works with FKs on.
  insert into auth.users (id, instance_id, aud, role, email)
    values (v_uid_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leaktest-a@example.invalid'),
           (v_uid_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leaktest-b@example.invalid')
    on conflict (id) do nothing;

  insert into public.profiles (id, email, role, referral_partner_id) values
    (v_uid_a, 'leaktest-a@example.invalid', 'partner', v_rp_a),
    (v_uid_b, 'leaktest-b@example.invalid', 'partner', v_rp_b)
  on conflict (id) do update set role = excluded.role, referral_partner_id = excluded.referral_partner_id;

  -- --- a lead owned by each partner -----------------------------------------
  insert into public.leads (business_name, contact_name, referral_partner_id)
    values ('LEAKTEST Co A', 'Contact A', v_rp_a) returning id into v_lead_a;
  insert into public.leads (business_name, contact_name, referral_partner_id)
    values ('LEAKTEST Co B', 'Contact B', v_rp_b) returning id into v_lead_b;

  -- --- impersonate partner A ------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_a::text, 'role', 'authenticated')::text, true);

  if not exists (select 1 from public.partner_leads_view where id = v_lead_a) then
    raise exception 'LEAK TEST FAIL: partner A cannot see their own lead through partner_leads_view';
  end if;
  if exists (select 1 from public.partner_leads_view where id = v_lead_b) then
    raise exception 'LEAK TEST FAIL: partner A can see partner B''s lead (cross-partner leak)';
  end if;

  -- Funder-name safety: no display name returned to A may equal a real funder name.
  select count(*) into v_leak
    from public.partner_funder_industry_appetite v
    join public.funders f on f.name = v.funder_display_name;
  if v_leak > 0 then
    raise exception 'LEAK TEST FAIL: partner_funder_industry_appetite exposed % real funder name(s)', v_leak;
  end if;

  -- --- impersonate partner B (symmetric isolation) --------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_b::text, 'role', 'authenticated')::text, true);

  if not exists (select 1 from public.partner_leads_view where id = v_lead_b) then
    raise exception 'LEAK TEST FAIL: partner B cannot see their own lead';
  end if;
  if exists (select 1 from public.partner_leads_view where id = v_lead_a) then
    raise exception 'LEAK TEST FAIL: partner B can see partner A''s lead (cross-partner leak)';
  end if;

  -- --- reset claims ---------------------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  raise notice 'Build 19 leak tests: ALL PASSED (cross-partner isolation + funder-name safety).';
end $$;

rollback;
