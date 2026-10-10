-- Enforce the existing client progress terminal states on direct form/answer writes.
-- Lock the parent response before the deal to serialize answers with submission.
create or replace function public.guard_client_application_open_deal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_deal_id uuid;
  v_stage text;
  v_status text;
begin
  if tg_table_name = 'client_form_answers' then
    select r.deal_id, r.status into v_deal_id, v_status
      from public.client_form_responses r where r.id = new.response_id for update;
    if not found or v_status <> 'draft' then
      raise exception 'Answers can only be changed while the form is a draft';
    end if;
  else
    v_deal_id := new.deal_id;
  end if;
  if v_deal_id is not null then
    select d.stage::text into v_stage from public.deals d where d.id = v_deal_id for share;
    if not found then raise exception 'Application deal is unavailable'; end if;
    if v_stage in ('funded', 'invoiced', 'commission_paid', 'declined') then
      raise exception 'Completed deals cannot accept application changes';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_client_application_open_deal() from public, anon, authenticated, service_role;
create trigger guard_client_application_open_deal
  before insert or update on public.client_form_responses
  for each row execute function public.guard_client_application_open_deal();
create trigger guard_client_application_open_deal
  before insert or update on public.client_form_answers
  for each row execute function public.guard_client_application_open_deal();
