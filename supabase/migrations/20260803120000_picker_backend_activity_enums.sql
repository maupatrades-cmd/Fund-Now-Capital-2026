-- Commission Picker BACKEND (Sprint 1, Lane 1a) — part 1 of 3: activity events.
--
-- Three new activity_event_type values the picker's state RPCs write. They live
-- in THEIR OWN migration because a newly-added enum value cannot be *used* in the
-- same transaction it is added (Postgres "unsafe use of new value"): this file
-- commits first, then 20260803120100 references the literals from its RPC bodies
-- and its behavioural DO-block assertions.
--   (Same discipline as 20260720110000_qualification_event_enums.sql.)
--
--   COMMISSION_PICKER_SET        — owner first picks A/B/C/D on a deal (→ POTENTIAL).
--   COMMISSION_PICKER_UPDATED    — owner edits the picker during POTENTIAL / PENDING.
--   COMMISSION_STATE_TRANSITION  — POTENTIAL → PENDING → LOCKED (and the LOCKED →
--                                  PENDING owner-override unlock).

alter type public.activity_event_type add value if not exists 'COMMISSION_PICKER_SET';
alter type public.activity_event_type add value if not exists 'COMMISSION_PICKER_UPDATED';
alter type public.activity_event_type add value if not exists 'COMMISSION_STATE_TRANSITION';
