-- Add a ticket range (min/max funding size a funder will consider) to funders.
-- Nullable — existing funders start with no range set; the owner fills these in
-- via the funder edit form. Money is numeric(14,2) like everywhere else.
alter table public.funders
  add column ticket_min numeric(14,2),
  add column ticket_max numeric(14,2);

alter table public.funders
  add constraint funders_ticket_min_nonneg_ck
    check (ticket_min is null or ticket_min >= 0),
  add constraint funders_ticket_max_nonneg_ck
    check (ticket_max is null or ticket_max >= 0),
  add constraint funders_ticket_range_ck
    check (ticket_min is null or ticket_max is null or ticket_max >= ticket_min);
