# Staff build, Batch 3: delegated calendars, conflict protection, confirmations, check-in reminders

Status (updated 10 Oct 2026): **merged into `codex/integration-repair` (#282) and applied to the live database; not deployed to production; not click-tested as real roles.** See `docs/STAFF-BUILD-RUNBOOK-2026-10-10.md` for the current state of the whole build.
Branch: `claude/staff-build-batch3`, stacked on `claude/staff-build-batch2` (PR #281), which stacks on Batch 1 (PR #279). Merge in that order.

## Inventory

| Item | Source | Merged | Applied live | Deployed | Role-tested live |
|---|---|---|---|---|---|
| `20261007102000_calendar_delegation.sql` | yes | no | no | n/a | no |
| `20261007103000_staff_checkin_cron.sql` (schedules a pg_cron job) | yes | no | no | n/a | no |
| Diary calendar + check-in panels, call follow-through | yes | no | n/a | no | no |
| Owner `/calendar/access` page | yes | no | n/a | no | no |
| PGlite test `tests/sql/calendar-delegation.test.mjs` | yes | no | n/a | n/a | isolated DB only |

Apply order: Batch 1 migrations (90000 to 95000), Batch 2 (100000, 101000), then 102000. The cron file (103000) is separate so the integrator can apply the schema first and decide on scheduling; applying it creates a scheduled job (weekdays 04:30 UTC) that only creates in-app reminders.

## The four calendar permissions (enforced in the database)

Granted by the Owner per calendar and per person, effective-dated, revocable. **None implies another.**

| Permission | What it allows |
|---|---|
| view availability | busy and open blocks only: no titles, categories or links |
| create | add bookings to that calendar |
| change own | reschedule or cancel bookings the person created |
| manage others | reschedule or cancel anyone's booking on that calendar |

Revocation applies on the very next call. A grantee must be an enabled staff member. Scope is the calendar (a profile), so the same table covers the Founder's diary and a Team Leader's or staff member's calendar. Public booking requests (`crm_bookings`) stay Owner-decided.

Privacy: a booking title is shown only to its creator, or when the Owner marked the event `public` (then only the public title). Everything else reads **Busy** or **Private**. A Coordinator managing the Founder's diary therefore sees times and can move bookings but not private titles or notes.

## Conflict protection

- Delegated bookings take the same advisory lock the Owner RPCs use (`owner-calendar:<owner>`), then check overlap including a buffer (default 15 minutes per calendar, Owner-configurable), against events and active public bookings. The existing database exclusion constraint on events remains the backstop.
- Business hours (default 08:00 to 20:00 Africa/Johannesburg), weekends and an explicit holiday table apply to staff bookings. **The holiday table starts empty: the Owner must enter public holidays.** The existing 14:00 to 20:00 consultation rule is reused.
- Idempotency: one key per person; a retry returns the same booking.
- Open availability slots a booking occupies are closed, as on the Owner path.

## Confirmations (no real sender in this batch)

- One queued notice per (booking, recipient, revision). A reschedule supersedes unsent older notices and queues one fresh notice; a cancel does the same. Claim/record functions (service role only) mirror the existing booking outbox: a sent notice cannot be claimed again, a duplicate row is refused by a unique constraint.
- **Nothing sends these yet.** The existing `send-booking-confirmation` function is bound to public bookings, so a sender for this outbox is not built. Notices stay `queued` and the screens say "queued, not sent yet". No state beyond what a provider call recorded is ever shown, and provider delivery receipts are not integrated.
- Meetings booked with under 24 hours' notice are flagged `short_notice`; the diary shows them until someone with change rights records how they were handled. This flags the exception; it does not claim compliance.

## Check-in reminders

- Team Leader check-in weekly, organisation every two weeks, generated as in-app reminders for the Coordinator, one per (subject, period). A team with no current leader or an inactive team or organisation stops generating and its open reminders are skipped. Completing records who, when and a safe note.
- The Friday due date is a default. The Team Leader Friday 16:00 submission deadline is a separate input and is not modelled here.
- Not built: sending any notice to a Team Leader or partner (needs the outbox sender and an agreed safe-fields template), and day 3 / day 7 document reminders (Batch 4).

## Task completion returns to the originating call

`staff_call_tasks(call)` returns the tasks created from a call with status and who closed them; the call log shows it under "Show follow-through" for routed calls.

## Tests so far

`node --test tests/sql/calendar-delegation.test.mjs` covers: grant rules, availability projection shape, per-calendar scoping, partner and un-enabled staff denial, create rules (hours, weekend, holiday, buffer, unsafe text, bad email, past time), idempotent retry, exclusion-constraint backstop, diary title rules, change rights and immediate revocation, append-only change history, notice supersede/queue, claim guard and no duplicate notice, short-notice flag and handling, check-in generation/dedup/completion/stop, call follow-through, no direct table access. Repository tests, `tsc -b`, `oxlint` and the contract check pass.

**Not proven:** true concurrent bookings from two live sessions (the isolated database is single-connection; the lock and the exclusion constraint are in place but not raced), browser behaviour, time zones for people outside SAST (the form converts the browser's local time), live schema behaviour, the cron job, and any message delivery.

## Live smoke test (after apply)

1. Owner: `/calendar/access`, grant a Switchboard user view + create + change own on the Founder calendar and the Coordinator manage others. Try to grant someone not yet switched on: expect refusal.
2. Switchboard: book a call with an attendee email. Try an overlapping time, a weekend, a time outside hours: expect refusals. Retry the same booking: expect the same booking back, not a second.
3. Coordinator: see the Switchboard booking as Busy, reschedule it, cancel another. Confirm only one fresh queued notice exists per change.
4. Owner revokes manage others: the Coordinator's next change is refused.
5. Race test (needs two browsers): both try to book the same slot at the same moment: exactly one succeeds.
6. Owner: run `owner_run_checkin_generation()`; Coordinator sees check-ins; running again adds none.
7. Confirm no email or message was sent anywhere.

## Rollback

Revoke grants (`/calendar/access`) or revoke execute on the `staff_*calendar*` functions. Unschedule the cron job (`cron.unschedule('staff-checkin-reminders')`). Never drop the tables or edit applied migrations; ship a forward migration. History tables are append-only by design.
