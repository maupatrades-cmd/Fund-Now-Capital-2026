-- B5.2 (part 1 of 3) — qualification activity-event enum values.
--
-- Two new activity_event_type values used by the qualify_lead visibility gate
-- (part 2). They are added in THEIR OWN migration because a newly-added enum
-- value cannot be *used* in the same transaction it is added — so this commits
-- first, then 20260720110100 references the literals.
--
--   QUALIFIED_ONTO_EXISTING_CLIENT — the lead qualified onto a pre-existing
--     client (match_kind 'cipc' or 'name' in the meta). The 'name' case closes
--     the pre-existing silent-attach gap (name matches always attached quietly).
--   QUALIFIED_NEW_CLIENT — the lead qualified into a genuinely new client.

alter type public.activity_event_type add value if not exists 'QUALIFIED_ONTO_EXISTING_CLIENT';
alter type public.activity_event_type add value if not exists 'QUALIFIED_NEW_CLIENT';
