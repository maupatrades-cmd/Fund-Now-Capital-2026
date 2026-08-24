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

## Authenticated disposable mode

Authenticated mode is opt-in and is never run by CI or the default command. It
requires an exact host allow-list, an explicit arming phrase, and a fixture
adapter owned by the disposable environment. The runner generates a unique
`fnc-e2e-*` namespace, signs in all six roles, executes allow and denial checks,
and calls cleanup in a `finally` block. Cleanup must confirm that it removed the
same namespace or the run fails.

```powershell
$env:FNC_E2E_AUTHENTICATED = "1"
$env:FNC_E2E_ARMED = "I_UNDERSTAND_THIS_CREATES_DISPOSABLE_FIXTURES"
$env:FNC_E2E_TARGET_URL = "https://fnc-pr-123.example.test"
$env:FNC_E2E_SUPABASE_URL = "https://fnc-db-pr-123.example.test"
$env:FNC_E2E_ALLOWED_HOSTS = "fnc-pr-123.example.test,fnc-db-pr-123.example.test"
$env:FNC_E2E_PRODUCTION_HOSTS = "fund-now-capital-2026.vercel.app,production-db.example.test"
$env:FNC_E2E_SUPABASE_ANON_KEY = "<preview anon key>"
$env:FNC_E2E_FIXTURE_ADAPTER = "C:\secure\fnc-preview-fixture-adapter.mjs"
npm run test:cross-role-e2e
```

The adapter exports `setup(context)` and `cleanup(context)`. `setup` must return
`disposable: true`, the unchanged namespace, credentials for owner, client,
partner, contractor, direct lead-referrer and partner sub-agent, plus REST
checks for each role. Every non-owner role needs at least one `kind: "denial"`
check. A denial passes only with HTTP 401/403/404 or an RLS-filtered empty array.
`cleanup` must return `{ namespace, removed: true }` after deleting only rows and
users labelled with that namespace. Never put a service-role key in this runner,
the repository, or CI; keep fixture administration inside the adapter's secure
preview-only environment.
