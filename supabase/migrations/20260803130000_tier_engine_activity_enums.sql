-- TIER ENGINE (Sprint 1, Lane 1b) — part 1 of 4: activity_event_type values.
-- ============================================================================
-- Own migration so the new enum labels are COMMITTED before any later migration
-- (or its behavioural DO-block) references them. Postgres will not let a value
-- added by `ALTER TYPE ... ADD VALUE` be USED in the same transaction, so the
-- picker lane split its enums out the same way (20260803120000). We mirror that
-- discipline exactly.
--
-- These three are the tier engine's own audit vocabulary — they do NOT touch the
-- picker lane's COMMISSION_PICKER_SET / COMMISSION_PICKER_UPDATED /
-- COMMISSION_STATE_TRANSITION values (already live), only add alongside them:
--   * DEAL_ATTRIBUTION_SET        — owner sets/updates which entity earned a deal.
--   * COMMISSION_TIER_APPLIED     — apply_tier_on_lock wrote (or could not write)
--                                   a commission_record on LOCK.
--   * CONTRACTOR_MANUAL_AMOUNT_SET— owner entered an R1M+ contractor amount by hand
--                                   (prominent, high-value audit trail).
-- ============================================================================

alter type public.activity_event_type add value if not exists 'DEAL_ATTRIBUTION_SET';
alter type public.activity_event_type add value if not exists 'COMMISSION_TIER_APPLIED';
alter type public.activity_event_type add value if not exists 'CONTRACTOR_MANUAL_AMOUNT_SET';
