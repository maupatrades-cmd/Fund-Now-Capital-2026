-- LEAD-SUBMIT lane — carve 'other' out of document versioning.
--
-- CROSS-LANE NOTE: this touches the shared B3.1 documents core
-- (documents_apply_versioning), which is a stretch for a "lead submission" PR.
-- It's included deliberately because the lead-submission portal uploads every
-- supporting document as document_type = 'other' (there is no per-file type on
-- the submitter form), and the versioning trigger supersedes by
-- (owning_entity, document_type). Without this carve-out, a submission with N
-- supporting docs collapses into a single "current" document (each new 'other'
-- supersedes the previous), and an owner's own 'other' doc on that lead would be
-- silently superseded too. Shipping that = shipping a bug users hit on day one.
--
-- SAFETY: verified 0 rows of document_type = 'other' exist live (2026-08-02), so
-- there is no data to migrate and no existing supersede chain to disturb. All
-- other flows are unchanged: period-scoped types (bank_statement, financial_
-- statements, …) and every named type keep their exact versioning behaviour —
-- only 'other', a catch-all bucket rather than a versioned document identity, is
-- exempted so multiple 'other' documents on one entity coexist as independent v1s.
--
-- The body below is identical to the live function except for the early-return
-- branch for 'other'; everything else (advisory lock, expiry default, period vs
-- non-period supersede, the fnc.documents_superseding guard) is preserved verbatim.

create or replace function public.documents_apply_versioning()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owning uuid := coalesce(new.client_id, new.lead_id);
  v_period boolean := public.document_type_is_period_scoped(new.document_type);
  v_next integer;
begin
  if new.expiry_date is null then
    new.expiry_date := public.document_default_expiry(new.document_type,
      coalesce(new.created_at::date, current_date), new.period_end);
  end if;

  -- 'other' is a catch-all bucket, not a versioned document identity: multiple
  -- 'other' documents on the same entity must COEXIST (e.g. a batch of portal
  -- supporting docs), so they never supersede one another. Each is its own v1.
  if new.document_type = 'other' then
    new.version_number := 1;
    new.is_current_version := true;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_owning::text || '|' || new.document_type::text));
  perform set_config('fnc.documents_superseding', 'on', true);
  if v_period then
    select coalesce(max(d.version_number), 0) + 1 into v_next from public.documents d
     where d.owning_entity_id = v_owning and d.document_type = new.document_type
       and d.period_start is not distinct from new.period_start
       and d.period_end is not distinct from new.period_end;
    update public.documents d set is_current_version = false, superseded_by = new.id
     where d.owning_entity_id = v_owning and d.document_type = new.document_type
       and d.period_start is not distinct from new.period_start
       and d.period_end is not distinct from new.period_end and d.is_current_version;
  else
    select coalesce(max(d.version_number), 0) + 1 into v_next from public.documents d
     where d.owning_entity_id = v_owning and d.document_type = new.document_type;
    update public.documents d set is_current_version = false, superseded_by = new.id
     where d.owning_entity_id = v_owning and d.document_type = new.document_type and d.is_current_version;
  end if;
  perform set_config('fnc.documents_superseding', 'off', true);
  new.version_number := v_next;
  new.is_current_version := true;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Unique-index carve-out (completes the 'other' change above)
-- ---------------------------------------------------------------------------
-- The versioning trigger now leaves every 'other' row is_current_version=true.
-- But documents_current_nonperiod_uq enforces ONE current non-period doc per
-- (owning_entity_id, document_type) — and 'other' is non-period — so a second
-- 'other' doc on the same entity would raise a unique violation. Exclude 'other'
-- from that index so multiple current 'other' docs coexist.
--
-- Plain DROP + CREATE (not CONCURRENTLY) is deliberate and owner-approved: the
-- documents table is tiny (single-digit rows) and not yet exercised by this
-- feature, so the write-blocking-lock concern behind the CONCURRENTLY rule does
-- not apply; doing the swap inside this one migration transaction keeps the
-- whole 'other' carve-out atomic (clean rollback on any failure) and avoids the
-- brief two-index window a CONCURRENTLY split would open.
drop index if exists public.documents_current_nonperiod_uq;
create unique index documents_current_nonperiod_uq
  on public.documents (owning_entity_id, document_type)
  where (is_current_version and not is_period_scoped and document_type <> 'other'::public.document_type);

-- ---------------------------------------------------------------------------
-- Self-check: the carve-out is present in both the trigger body and the index.
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_get_functiondef('public.documents_apply_versioning'::regproc) not like '%''other''%' then
    raise exception 'documents_apply_versioning: other-type carve-out missing';
  end if;
  if (select pg_get_indexdef('public.documents_current_nonperiod_uq'::regclass)) not like '%<> ''other''%' then
    raise exception 'documents_current_nonperiod_uq: other-type exclusion missing';
  end if;
end;
$$;
