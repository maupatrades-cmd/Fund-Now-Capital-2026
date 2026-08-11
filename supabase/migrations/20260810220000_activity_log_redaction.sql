-- Build 20 — POPIA activity-log redaction.
-- ============================================================================
-- The audit trail (public.activity_logs) captures whole-row before/after
-- snapshots via log_activity() and via manual inserts. Those snapshots can
-- carry client/contact PII (SA ID numbers, contact channels, addresses,
-- banking + tax identifiers). POPIA data-minimisation says the AUDIT TRAIL must
-- retain OPERATIONAL EVIDENCE (who did what, to which row, which fields changed,
-- when) while NOT hoarding the sensitive VALUES of those fields.
--
-- This migration:
--   1. public.is_sensitive_activity_key(text)  -- the ONE owner-adjustable
--      source of truth for "which snapshot keys are sensitive".
--   2. public.redact_activity_snapshot(jsonb)   -- replaces sensitive VALUES
--      with the sentinel "[REDACTED]", preserving structure + non-sensitive
--      keys; recurses into nested objects/arrays; idempotent.
--   3. A BEFORE INSERT trigger on public.activity_logs so EVERY write path
--      (the generic log_activity() trigger AND any manual insert) is redacted
--      on the way in. It touches only before_values / after_values — never
--      changed_fields (field NAMES are evidence) or related_entity_ids.
--   4. A one-time, targeted, idempotent backfill of existing rows.
--
-- WHAT IS PRESERVED (operational evidence, never redacted):
--   entity_type, entity_id, event_type, user_id/email/role, occurred_at,
--   description, changed_fields (the NAMES of changed fields), related_entity_ids,
--   session_id, ip_address, user_agent, notes — and every NON-sensitive key
--   inside the snapshots (stage, status, amounts, reference, business_name, ...).
--
-- OWNER REVIEW GATE (data-retention review — see is_sensitive_activity_key):
--   The sensitive-key set is deliberately scoped to direct identifiers, contact
--   channels, addresses and financial/tax identifiers. It intentionally does
--   NOT redact display NAMES (full_name, contact_name, business_name,
--   account_holder_name), business registration (cipc_number), country of
--   passport (passport_country), or free-text notes — these read as the
--   "who / what" of the audit event and are frequently already embedded in the
--   immutable `description`. If the owner's POPIA review decides any of those
--   must also be redacted, add the key to is_sensitive_activity_key and re-run
--   the backfill block at the bottom — both are written to make that a one-line,
--   idempotent change.
-- ============================================================================

-- ===========================================================================
-- 1. Sensitive-key predicate — the SINGLE, owner-adjustable source of truth.
--    Case-insensitive. Matches on the KEY name only (never on values), so
--    field NAMES in changed_fields / array-of-strings are unaffected.
--    To adjust the policy, edit ONLY this function (and re-run the backfill).
-- ===========================================================================
create or replace function public.is_sensitive_activity_key(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p_key) = any (array[
    -- government / identity numbers
    'id_number', 'sa_id_number', 'contact_id_number', 'national_id',
    'passport_number', 'date_of_birth', 'dob',
    -- contact channels
    'email', 'contact_email', 'phone', 'phone_number', 'cell', 'contact_cell',
    'contact_number', 'mobile', 'telephone', 'whatsapp_number',
    -- physical / postal addresses
    'address', 'physical_address', 'registered_address', 'residential_address',
    'postal_address', 'street_address',
    -- banking + tax identifiers
    'branch_code', 'account_number', 'bank_account_number', 'account_last_four',
    'tax_number', 'vat_number', 'tax_reference', 'income_tax_number'
  ])
  -- suffix patterns catch encrypted blobs and *_id_number / *account_number
  -- variants without needing an exact entry (e.g. account_number_ciphertext,
  -- tax_number_ciphertext, vat_number_ciphertext on payee_payment_profiles).
  or lower(p_key) like '%\_ciphertext' escape '\'
  or lower(p_key) like '%\_enc'        escape '\'
  or lower(p_key) like '%\_encrypted'  escape '\'
  or lower(p_key) like '%id\_number'   escape '\'
  or lower(p_key) like '%account\_number' escape '\';
$$;

comment on function public.is_sensitive_activity_key(text) is
  'Build 20 (POPIA): single source of truth for which activity_logs snapshot '
  'keys are sensitive PII and must have their VALUES redacted. Owner-adjustable — '
  'edit this list then re-run the redaction backfill.';

-- ===========================================================================
-- 2. Redactor — returns the snapshot with sensitive VALUES replaced by the
--    "[REDACTED]" sentinel, preserving structure + non-sensitive keys.
--    * recurses into nested objects and arrays;
--    * null / json-null values on a sensitive key are LEFT as null (so the log
--      never implies data existed where it did not, and re-redaction is a no-op);
--    * already-redacted values ("[REDACTED]") map to themselves -> idempotent.
--    SECURITY DEFINER + revoked from API roles: only the trigger / owner run it.
-- ===========================================================================
create or replace function public.redact_activity_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_key  text;
  v_val  jsonb;
  v_out  jsonb;
  v_elem jsonb;
begin
  if p_snapshot is null then
    return null;
  end if;

  case jsonb_typeof(p_snapshot)
    when 'object' then
      v_out := '{}'::jsonb;
      for v_key, v_val in select key, value from jsonb_each(p_snapshot)
      loop
        if public.is_sensitive_activity_key(v_key) then
          if v_val is null or jsonb_typeof(v_val) = 'null' then
            -- keep genuine nulls as-is; do not fabricate "[REDACTED]".
            v_out := v_out || jsonb_build_object(v_key, v_val);
          else
            v_out := v_out || jsonb_build_object(v_key, to_jsonb(text '[REDACTED]'));
          end if;
        else
          -- non-sensitive key: recurse so nested sensitive keys are still caught.
          v_out := v_out || jsonb_build_object(v_key, public.redact_activity_snapshot(v_val));
        end if;
      end loop;
      return v_out;

    when 'array' then
      v_out := '[]'::jsonb;
      for v_elem in select value from jsonb_array_elements(p_snapshot)
      loop
        v_out := v_out || jsonb_build_array(public.redact_activity_snapshot(v_elem));
      end loop;
      return v_out;

    else
      -- scalars (string/number/bool/null) carry no key context -> unchanged.
      return p_snapshot;
  end case;
end;
$$;

comment on function public.redact_activity_snapshot(jsonb) is
  'Build 20 (POPIA): returns an activity_logs snapshot with sensitive VALUES '
  '(per is_sensitive_activity_key) replaced by "[REDACTED]", preserving '
  'structure + non-sensitive operational fields. Recursive + idempotent.';

-- ===========================================================================
-- 3. BEFORE INSERT trigger — redacts before_values / after_values on the way
--    in, covering BOTH the log_activity() generic-trigger path and any manual
--    insert. changed_fields (field NAMES) and related_entity_ids are evidence
--    and are left intact. Idempotent, so it never double-redacts.
-- ===========================================================================
create or replace function public.redact_activity_log_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.before_values := public.redact_activity_snapshot(new.before_values);
  new.after_values  := public.redact_activity_snapshot(new.after_values);
  return new;
end;
$$;

comment on function public.redact_activity_log_row() is
  'Build 20 (POPIA): BEFORE INSERT trigger fn on activity_logs — redacts '
  'before_values/after_values via redact_activity_snapshot on every write path.';

drop trigger if exists redact_activity_log_row on public.activity_logs;
create trigger redact_activity_log_row
  before insert on public.activity_logs
  for each row execute function public.redact_activity_log_row();

-- ===========================================================================
-- 4. Least-privilege. The helpers must not be callable by the API roles; the
--    trigger fn runs SECURITY DEFINER (as owner) so the trigger fires for
--    authenticated/anon inserts without granting them the redactor directly.
--    RLS on activity_logs is unchanged (owner-only, already enforced).
-- ===========================================================================
revoke all on function public.is_sensitive_activity_key(text)  from public, anon, authenticated;
revoke all on function public.redact_activity_snapshot(jsonb)  from public, anon, authenticated;
revoke all on function public.redact_activity_log_row()        from public, anon, authenticated;

-- ===========================================================================
-- 5. One-time backfill — redact existing snapshots. Targeted (only rows whose
--    redaction actually differs from what is stored) and idempotent (running it
--    again is a no-op, since redact(redacted) = redacted). Re-run this exact
--    statement after any change to is_sensitive_activity_key.
-- ===========================================================================
update public.activity_logs
   set before_values = public.redact_activity_snapshot(before_values),
       after_values  = public.redact_activity_snapshot(after_values)
 where before_values is distinct from public.redact_activity_snapshot(before_values)
    or after_values  is distinct from public.redact_activity_snapshot(after_values);

-- ===========================================================================
-- 6. Assertions — structural + a rolled-back behavioural check that an insert
--    carrying a sensitive key comes back redacted while a non-sensitive field
--    survives, and that the backfill left no sensitive VALUES behind.
-- ===========================================================================
do $$
declare
  v_id      uuid;
  v_after   jsonb;
  v_leftover int;
begin
  -- structural: helpers + trigger present.
  if to_regprocedure('public.is_sensitive_activity_key(text)') is null
     or to_regprocedure('public.redact_activity_snapshot(jsonb)') is null
     or to_regprocedure('public.redact_activity_log_row()') is null then
    raise exception 'Build 20 assert FAIL: a redaction function is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'redact_activity_log_row'
      and tgrelid = 'public.activity_logs'::regclass
      and not tgisinternal
  ) then
    raise exception 'Build 20 assert FAIL: redact_activity_log_row trigger not attached';
  end if;

  -- pure-function sanity: sensitive value redacted, non-sensitive preserved,
  -- nested + null handled, field-name array untouched.
  if public.redact_activity_snapshot(
       jsonb_build_object(
         'id_number', '9001015800088',
         'email', 'client@example.com',
         'branch_code', '250655',
         'business_name', 'Mama Mabase JV',
         'stage', 'Funded',
         'phone', null,
         'nested', jsonb_build_object('contact_cell', '0821234567', 'position', 'Director')
       )
     ) is distinct from
       jsonb_build_object(
         'id_number', '[REDACTED]',
         'email', '[REDACTED]',
         'branch_code', '[REDACTED]',
         'business_name', 'Mama Mabase JV',
         'stage', 'Funded',
         'phone', null,
         'nested', jsonb_build_object('contact_cell', '[REDACTED]', 'position', 'Director')
       ) then
    raise exception 'Build 20 assert FAIL: redact_activity_snapshot output mismatch';
  end if;

  -- idempotency: redacting an already-redacted snapshot is a no-op.
  if public.redact_activity_snapshot(jsonb_build_object('email', '[REDACTED]', 'stage', 'x'))
     is distinct from jsonb_build_object('email', '[REDACTED]', 'stage', 'x') then
    raise exception 'Build 20 assert FAIL: redaction is not idempotent';
  end if;

  -- field-NAME arrays (changed_fields shape) must survive verbatim.
  if public.redact_activity_snapshot('["email","phone","stage"]'::jsonb)
     is distinct from '["email","phone","stage"]'::jsonb then
    raise exception 'Build 20 assert FAIL: array-of-field-names was altered';
  end if;

  -- behavioural: a live INSERT with a sensitive key comes back redacted, a
  -- non-sensitive field survives (rolled back — leaves no test row behind).
  begin
    insert into public.activity_logs (event_type, entity_type, entity_id, after_values)
    values (
      'CREATE', 'redaction_selftest', gen_random_uuid(),
      jsonb_build_object('email', 'x@y.z', 'id_number', '9001015800088', 'stage', 'New Lead')
    )
    returning id, after_values into v_id, v_after;

    if v_after->>'email' <> '[REDACTED]' or v_after->>'id_number' <> '[REDACTED]' then
      raise exception 'Build 20 assert FAIL: insert trigger did not redact sensitive keys';
    end if;
    if v_after->>'stage' <> 'New Lead' then
      raise exception 'Build 20 assert FAIL: insert trigger clobbered a non-sensitive field';
    end if;

    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;

  -- post-backfill: no existing row still holds a sensitive VALUE (a sensitive
  -- key whose value is neither null nor the sentinel).
  select count(*) into v_leftover
  from public.activity_logs al
  cross join lateral (
    select key, value from jsonb_each(al.before_values) where jsonb_typeof(al.before_values) = 'object'
    union all
    select key, value from jsonb_each(al.after_values)  where jsonb_typeof(al.after_values)  = 'object'
  ) kv(key, value)
  where public.is_sensitive_activity_key(kv.key)
    and jsonb_typeof(kv.value) <> 'null'
    and kv.value <> to_jsonb(text '[REDACTED]');
  if v_leftover > 0 then
    raise exception 'Build 20 assert FAIL: % existing sensitive value(s) survived the backfill', v_leftover;
  end if;

  raise notice 'Build 20: activity-log redaction helpers + trigger created; backfill + asserts passed.';
end $$;
