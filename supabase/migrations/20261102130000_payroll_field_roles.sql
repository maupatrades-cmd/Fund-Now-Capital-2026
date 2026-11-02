-- Launch (staff start 4 Nov 2026): the Field Supervisor and field consultants are paid through the staff payroll cycle
-- (launch plan section 4: "Staff cycle (27th)"), so they get payslips like the office staff. Only the payee list changes;
-- who prepares, approves and sees payslips is unchanged. Team Leaders stay out: they are DRA-01 contract agents.
create or replace function public.payroll_payee_roles()
returns text[]
language sql immutable set search_path = '' as $$
  select array['administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant'];
$$;
revoke all on function public.payroll_payee_roles() from public, anon, authenticated;

-- Tidy-up from the 21 Oct live verification: these two trigger functions kept the default PUBLIC execute grant.
revoke all on function public.payroll_row_guard() from public, anon, authenticated;
revoke all on function public.payslip_lines_insert_guard() from public, anon, authenticated;
