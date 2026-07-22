-- Add a nullable phone column to funders for funder contact numbers.
--
-- WHY: contracted-funder records carry a contact/switchboard number sourced from the
-- signed agreement (e.g. Merchant Capital +27 11 217 2880). There was no home for it on
-- the funders table. This is a plain nullable text column with no default, so on
-- PostgreSQL 11+ it is a metadata-only change (no table rewrite, no blocking lock) — safe
-- on the small, populated funders table.
--
-- SCOPE: phone is NOT part of the C1.1 invoice "INVOICE TO" block (which uses legal_name,
-- billing_address, company_registration, vat_registration, accounts_email). It is captured
-- for general funder contact reference only.
--
-- RLS: funders already has RLS; a new column inherits the table's existing policies.
-- Partner-facing surfaces select explicit anonymised columns via views (display_name_for_partner),
-- never the raw funders row, so this column is not exposed to partners.

ALTER TABLE public.funders ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.funders.phone IS
  'Funder contact phone number (nullable, e.g. +27 11 217 2880). Owner-only; not part of the invoice INVOICE TO block.';
