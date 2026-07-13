-- Reference data seed (idempotent).
--
-- This runs as a migration (not seed.sql) so the data also lands in production
-- on deploy, not just local dev resets.

-- Referral partner (Phase 1 has exactly one).
insert into public.referral_partners (name)
values ('Bright Destiny')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Funders (21). Real name is owner-only; display_name_for_partner is the
-- fictional first name shown to partners (anonymisation).
-- ---------------------------------------------------------------------------
insert into public.funders (name, display_name_for_partner, funder_type, agreement_status) values
  ('Merchant Capital',          'Rachel',    'MCA',              'signed'),
  ('Pollen Finance',            'Marcus',    'working_capital',  'signed'),
  ('Swype Financial',           'Thomas',    'MCA',              'signed'),
  ('Business Partners',         'Elizabeth', 'property_secured', 'signed'),
  ('Bridgement',                'Sipho',     'invoice_discount', 'signed'),
  ('Funding Hub',               'Nicholas',  'working_capital',  'signed'),
  ('Brighton Capital',          'Amara',     'working_capital',  'signed'),
  ('Lula',                      'Grace',     'working_capital',  'signed'),
  ('RM Capital',                'Benjamin',  'po_finance',       'signed'),
  ('Sourcefin',                 'Themba',    'po_finance',       'signed'),
  ('Better Banc',               'Ryan',      'working_capital',  'signed'),
  ('Growise Capital',           'Palesa',    'working_capital',  'signed'),
  ('PrefCap',                   'Ethan',     'working_capital',  'signed'),
  ('Flow48',                    'Chloe',     'invoice_discount', 'verbal'),
  ('Unahina Solutions',         'Zanele',    'po_finance',       'verbal'),
  ('Steed Finance',             'William',   'asset_finance',    'pending'),
  ('GenFin',                    'Isabelle',  'working_capital',  'verbal'),
  ('Rockfin',                   'Alexander', 'working_capital',  'pending'),
  ('Centrafin',                 'Lerato',    'asset_finance',    'estimated'),
  ('Retail Capital / GoTyme',   'Sophie',    'working_capital',  'pending'),
  ('Paragon Finance',           'Nadia',     'property_secured', 'pending')
on conflict (name) do nothing;
