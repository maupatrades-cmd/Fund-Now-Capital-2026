-- In-house lead source (owner, 18 Nov 2026), 1/4: a fourth intake channel, 'inhouse' (Fund Now Capital itself: an
-- employee, an office, or an online / direct referral). Its own migration because a new enum value cannot be used in
-- the transaction that adds it.
alter type public.submission_channel add value if not exists 'inhouse';
