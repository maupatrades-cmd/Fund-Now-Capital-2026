-- Client Database — richer client + contact fields.
-- (Structured Industry Classification comes in a later PR; `sector` is free text
-- for now.)

-- Rename to the domain names used by the UI. Safe: no client rows yet.
alter table public.clients rename column registration_number to cipc_number;
alter table public.clients rename column industry to sector;

alter table public.clients
  add column monthly_turnover numeric(14,2),
  add column address text;

alter table public.clients
  add constraint clients_monthly_turnover_nonneg_ck
    check (monthly_turnover is null or monthly_turnover >= 0);

comment on column public.clients.cipc_number is 'CIPC company registration number.';
comment on column public.clients.sector is 'Free-text sector; structured industry classification arrives in a later PR.';

-- Client contacts: directors carry an ID number and a primary-director flag.
alter table public.client_contacts rename column is_primary to is_primary_director;
alter table public.client_contacts add column id_number text;
