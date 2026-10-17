-- Staff build: owner-only setting for the sender address of confirmation emails to clients and
-- partners. Sending stays OFF (sending_enabled=false) until the owner links the email domain;
-- nothing in the database sends mail from this setting yet. Separate from Codex's
-- crm_integration_settings so the two lanes never edit the same table.
create table if not exists public.staff_notification_settings (
  singleton boolean primary key default true check (singleton),
  confirmation_sender text not null default 'admin@fundnowcapital.africa'
    check (confirmation_sender ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  sending_enabled boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.staff_notification_settings (singleton) values (true) on conflict do nothing;
alter table public.staff_notification_settings enable row level security;
revoke all on table public.staff_notification_settings from anon, authenticated;
create policy staff_notification_settings_owner_select on public.staff_notification_settings
  for select to authenticated using (public.is_owner());
grant select on table public.staff_notification_settings to authenticated;

create or replace function public.owner_set_confirmation_sender(p_sender text, p_enabled boolean)
returns public.staff_notification_settings
language plpgsql security definer set search_path = '' as $$
declare v_row public.staff_notification_settings;
begin
  if not public.is_owner() then raise exception 'Only the Owner can change this' using errcode = '42501'; end if;
  update public.staff_notification_settings
     set confirmation_sender = lower(btrim(p_sender)), sending_enabled = coalesce(p_enabled, false),
         updated_by = (select auth.uid()), updated_at = now()
   where singleton returning * into v_row;
  if not found then raise exception 'Settings row missing'; end if;
  perform public.staff_audit_write('settings', null, 'confirmation_sender_changed', null,
    jsonb_build_object('sender', v_row.confirmation_sender, 'sending_enabled', v_row.sending_enabled));
  return v_row;
end $$;
revoke all on function public.owner_set_confirmation_sender(text, boolean) from public, anon;
grant execute on function public.owner_set_confirmation_sender(text, boolean) to authenticated;
