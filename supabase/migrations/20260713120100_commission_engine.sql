-- Commission engine — the single server-side source of truth for the split.
--
-- Every funded deal produces a gross commission X. It splits as:
--   company_retention = 40% of X, rounded to cents
--   partner_pool      = X - company_retention   (the remainder, so the three
--                       outputs always sum to X exactly to the cent)
--   tier%             = 40% for Purchase Order deals; otherwise by gross band:
--                         R0        – R80,000   -> 29%
--                         R80,001   – R150,000  -> 30%
--                         R150,001  – R500,000  -> 33%
--                         R500,001+             -> 25%
--   partner_share     = partner_pool * tier%, rounded to cents
--   owner_share       = partner_pool - partner_share
--
-- Invariant: company_retention + partner_share + owner_share = X.
-- (All tier %s sit inside the 20%–45% contract range.)

create type public.commission_breakdown as (
  tier_pct numeric,
  company_retention numeric,
  partner_pool numeric,
  partner_share numeric,
  owner_share numeric
);

-- Tier percentage of the partner pool, by deal type and gross-commission band.
create or replace function public.commission_tier_pct(
  gross_commission numeric,
  is_purchase_order boolean
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when is_purchase_order then 0.40
    when gross_commission <= 80000 then 0.29
    when gross_commission <= 150000 then 0.30
    when gross_commission <= 500000 then 0.33
    else 0.25
  end;
$$;

-- Full breakdown. Shared by the calculator screen (via RPC) and the deal save
-- path (via the commission_records trigger below).
create or replace function public.calculate_commission(
  gross_commission numeric,
  is_purchase_order boolean
)
returns public.commission_breakdown
language plpgsql
immutable
set search_path = ''
as $$
declare
  result public.commission_breakdown;
  v_gross numeric;
  v_tier numeric;
  v_retention numeric;
  v_pool numeric;
  v_partner numeric;
begin
  if gross_commission is null or gross_commission < 0 then
    raise exception 'gross_commission must be non-negative, got %', gross_commission;
  end if;

  v_gross := round(gross_commission, 2);
  v_tier := public.commission_tier_pct(v_gross, is_purchase_order);
  v_retention := round(v_gross * 0.40, 2);
  v_pool := v_gross - v_retention;          -- remainder keeps the sum exact
  v_partner := round(v_pool * v_tier, 2);

  result.tier_pct := v_tier;
  result.company_retention := v_retention;
  result.partner_pool := v_pool;
  result.partner_share := v_partner;
  result.owner_share := v_pool - v_partner;
  return result;
end;
$$;

-- Recompute the split on every insert/update. The browser may show a live
-- preview, but persisted money is never trusted from the client (security
-- rule #5) — it is always derived here from gross_commission + is_purchase_order.
create or replace function public.commission_records_recompute()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  b public.commission_breakdown;
begin
  b := public.calculate_commission(new.gross_commission, new.is_purchase_order);
  new.tier_pct := b.tier_pct;
  new.company_retention := b.company_retention;
  new.partner_pool := b.partner_pool;
  new.partner_share := b.partner_share;
  new.owner_share := b.owner_share;
  new.computed_at := now();
  return new;
end;
$$;

create trigger commission_records_recompute
  before insert or update on public.commission_records
  for each row execute function public.commission_records_recompute();
