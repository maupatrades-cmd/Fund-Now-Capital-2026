import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("presentation is the only booking type with the governed afternoon window", async () => {
  const [migration, ownerPage, sharedCalendar] = await Promise.all([
    read("supabase/migrations/20260816214614_booking_standalone_and_presentation_rule.sql"),
    read("src/pages/OwnerCalendarPage.tsx"),
    read("src/components/calendar/SharedBookingCalendar.tsx"),
  ]);
  assert.match(migration, /p_booking_type='presentation'.*calendar_is_presentation_window/s);
  assert.match(migration, /p_category='presentation'.*calendar_is_presentation_window/s);
  assert.doesNotMatch(migration, /p_booking_type='consultation'.*calendar_is_presentation_window/s);
  assert.match(ownerPage, /category === "presentation"/);
  assert.match(sharedCalendar, /Presentations run from 14:00 to 20:00/);
});

test("standalone bookings require a name and purpose but no CRM reference", async () => {
  const [migration, hook, calendar] = await Promise.all([
    read("supabase/migrations/20260816214614_booking_standalone_and_presentation_rule.sql"),
    read("src/hooks/useBookingPortal.ts"),
    read("src/components/calendar/SharedBookingCalendar.tsx"),
  ]);
  assert.match(migration, /request_owner_booking_v3/);
  assert.match(migration, /Add a client or person name for a standalone booking/);
  assert.match(migration, /A brief meeting purpose is required/);
  assert.match(hook, /request_owner_booking_v3/);
  assert.match(calendar, /Standalone booking — no CRM record/);
  assert.match(calendar, /Client or person name/);
});

test("lead detail invitation preserves the source lead", async () => {
  const [leadPage, panel, edge, migration] = await Promise.all([
    read("src/pages/LeadDetailPage.tsx"),
    read("src/components/leads/LeadClientInvitationPanel.tsx"),
    read("supabase/functions/bootstrap-client-account/index.ts"),
    read("supabase/migrations/20260816214614_booking_standalone_and_presentation_rule.sql"),
  ]);
  assert.match(leadPage, /<LeadClientInvitationPanel/);
  assert.match(panel, /lead_id: leadId/);
  assert.match(edge, /service_create_quick_client_invitation_for_lead/);
  assert.match(migration, /source_lead_id uuid references public\.leads/);
});

test("Owner event creation uses a scalar optional task id", async () => {
  const migration = await read("supabase/migrations/20260816214614_booking_standalone_and_presentation_rule.sql");
  assert.match(migration, /v_task_id uuid/);
  assert.match(migration, /returning id into v_task_id/);
  assert.match(migration, /p_client_id,p_lead_id,p_deal_id,v_task_id,v_owner/);
});
