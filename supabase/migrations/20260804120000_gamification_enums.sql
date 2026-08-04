-- ============================================================================
-- GAMIFICATION (Sprint 5 Lane 5c) — enums
-- ============================================================================
-- Badges + milestones for contractors + partners (Duolingo/Strava-style
-- motivational infrastructure). This migration adds ONLY the enum values so
-- they are committed before the badges schema/RPC migration uses them — an
-- ADD VALUE cannot be *used* in the same transaction it is added in (PG rule).
--
-- notification_event_type.BADGE_EARNED already exists (original A11 enum,
-- 20260714150000_notifications.sql) — verified live 2026-08-04 — so it is NOT
-- re-added here; the badge award notification reuses it.
--
-- activity_event_type gains BADGE_AWARDED so award_badge() writes a first-class,
-- searchable audit row (CLAUDE.md rule 8: every new feature writes activity_logs).
-- ADD VALUE is safe inside this migration transaction because activity_event_type
-- predates it; the value is only *used* by award_badge() in the NEXT migration.

alter type public.activity_event_type add value if not exists 'BADGE_AWARDED';
