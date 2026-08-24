-- Activity audit values used by the client funding-offer workflow.
-- Kept in a separate transaction because PostgreSQL cannot safely use a newly
-- added enum value until the transaction that adds it has committed.
alter type public.activity_event_type add value if not exists 'CLIENT_OFFER_DRAFTED';
alter type public.activity_event_type add value if not exists 'CLIENT_OFFER_PUBLISHED';
alter type public.activity_event_type add value if not exists 'CLIENT_OFFER_ACCEPTED';
alter type public.activity_event_type add value if not exists 'CLIENT_OFFER_DECLINED';
