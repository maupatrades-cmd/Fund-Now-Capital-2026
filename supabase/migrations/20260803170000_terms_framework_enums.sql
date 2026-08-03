-- Terms & Conditions Acceptance Framework (Sprint 4, Lane 4d) — part 1 of 2: enum.
-- ============================================================================
-- Adds the TERMS_UPDATED notification event. Split into its own migration so the
-- new enum value is COMMITTED before part 2's trigger fires it — Postgres forbids
-- using a freshly-added enum value in the same transaction that adds it
-- (unsafe_new_enum_value_usage / 55P04). This mirrors the house pattern used by
-- every recent enum-then-use migration (lead_submit, picker_backend,
-- contractor_application).
--
-- TERMS_UPDATED fires when the owner publishes a new / newly-current terms
-- version (part 2's terms_versions_notify_updated trigger), notifying every
-- active user whose role must accept that version.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_event_type' and e.enumlabel = 'TERMS_UPDATED'
  ) then
    alter type public.notification_event_type add value 'TERMS_UPDATED';
  end if;
end $$;

-- Structural assertion — the value must exist after this migration.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_event_type' and e.enumlabel = 'TERMS_UPDATED'
  ) then
    raise exception 'assert: TERMS_UPDATED not present in notification_event_type';
  end if;
  raise notice 'Terms framework enum assertion passed (TERMS_UPDATED present).';
end $$;

notify pgrst, 'reload schema';
