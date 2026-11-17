-- Agent file, part 2 (CLAUDE.md FK rule): run OUTSIDE a transaction, one statement at a time. Builds the one-profile-per-
-- sub-agent unique index without a write-blocking lock, then validates the NOT VALID constraints added in 20261117110000.
create unique index concurrently if not exists payee_payment_profiles_lead_referrer_uniq
  on public.payee_payment_profiles(lead_referrer_id) where lead_referrer_id is not null;

alter table public.payee_payment_profiles validate constraint payee_payment_profiles_lead_referrer_fk;
alter table public.payee_payment_profiles validate constraint payee_payment_profiles_captured_by_fk;
alter table public.payee_payment_profiles validate constraint payee_payment_profiles_one_subject_ck;
