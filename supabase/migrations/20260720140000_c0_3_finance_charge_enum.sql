-- C0.3 Schema Alignment (part 1 of 2) — add the new funder_rate_type value.
-- Reference: ROADMAP Phase C0 · SPEC S7A · owner decision (2026-07-20, Option A).
--
-- Pollen Finance (and other finance-charge funders) earn FNC a % of the CLIENT's
-- finance charge on a facility — NOT a % of the funded amount. Real invoice INV-0031:
-- R140,000 finance charge × 10% = R14,000 commission. This adds the rate_type value.
--
-- WHY ITS OWN MIGRATION FILE: Postgres forbids USING a new enum value in the same
-- transaction that adds it ("unsafe use of new value ... must be committed first").
-- So the value is added and committed here; part 2 (20260720140100) references it.
-- ALTER TYPE ... ADD VALUE is idempotent-guarded with IF NOT EXISTS.

alter type public.funder_rate_type add value if not exists 'percent_of_finance_charge';
