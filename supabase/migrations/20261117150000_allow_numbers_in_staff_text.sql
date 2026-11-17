-- Owner decision (17 Nov 2026): staff may type numbers of any length (phone, ID, account numbers and so on) in free
-- text: task titles and notes, call logs, messages, notices, meeting notes, complaints and every other field guarded by
-- staff_text_is_safe. The guard (20261007100000: reject a run of 9+ digits after removing spaces and dashes) is turned
-- off by making it always true. Every check constraint and RPC that calls it keeps working unchanged, so the rule can be
-- switched back on later by redefining this one function. Structured personal data (agent ID numbers, bank details)
-- stays encrypted and masked exactly as before; only free text is affected.
create or replace function public.staff_text_is_safe(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select true;
$$;
