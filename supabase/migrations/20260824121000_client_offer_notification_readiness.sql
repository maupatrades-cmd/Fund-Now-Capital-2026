-- Runs after PR #260's 20260824120000 offer migration. Enum values are committed separately from the trigger migration because
-- PostgreSQL cannot safely use a newly-added enum value in the same transaction.
alter type public.notification_event_type add value if not exists 'CLIENT_OFFER_PUBLISHED';
alter type public.notification_event_type add value if not exists 'CLIENT_OFFER_ACCEPTED';
alter type public.notification_event_type add value if not exists 'CLIENT_OFFER_DECLINED';
