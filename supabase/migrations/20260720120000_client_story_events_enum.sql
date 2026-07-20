-- B4.1 (part 1 of 4) — client-story migration activity-event enum value.
--
-- STORY_MIGRATED_LEAD_TO_CLIENT is logged (owner-only, once per migrated story
-- row) when qualify_lead moves a lead's pre-qualification story onto its client
-- (part 4). It lives in its OWN migration because a newly-added enum value
-- cannot be *used* in the same transaction it is added — so this commits first,
-- then 20260720120300 references the literal.

alter type public.activity_event_type add value if not exists 'STORY_MIGRATED_LEAD_TO_CLIENT';
