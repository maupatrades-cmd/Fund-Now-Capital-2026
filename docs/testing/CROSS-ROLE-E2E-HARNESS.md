# Cross-role E2E harness foundation

This lane composes the repository's existing role, client, calendar, offer,
reward and money smoke coverage. It does not create users, send email, call an
Edge Function or write to Supabase.

## Fast zero-write gate

```powershell
npm run test:cross-role-e2e
node --test tests/cross-role-e2e-harness.test.mjs
```

The command covers Owner, client, partner, contractor, direct lead-referrer and
partner-linked sub-agent contracts. It also verifies that every database smoke
fixture is transaction-wrapped. The SQL suites are intentionally not executed
by the default command.

## Database proof on an disposable environment

Only use a local or disposable Supabase preview database. Never use production.
Run these in order with `ON_ERROR_STOP=1`:

1. `supabase/tests/client_backend_wave_smoke.sql`
2. `supabase/tests/partner_view_leak_tests.sql`
3. `supabase/tests/money_lifecycle_smoke.sql`

Each suite finishes with `ROLLBACK`, so synthetic profiles, clients, leads,
deals, invoices and rewards are removed. The partner leak suite is the required
two-tenant denial proof: partner A must not read partner B's lead, and the same
assertion is repeated in the opposite direction.

## Controlled browser phase

Use six disposable `@example.invalid` identities in a Vercel preview connected
to a disposable Supabase preview. Walk each role's own navigation and confirm a
role cannot open another role's route. For partner and partner-linked sub-agent,
create two separate partner organisations and confirm neither can find the
other organisation's client, lead, deal, document, earning or activity IDs.

The runner rejects known production URLs through `FNC_E2E_TARGET_URL`. This is a
guardrail, not permission to use any unknown shared environment. Delete the
preview environment after evidence is captured.
