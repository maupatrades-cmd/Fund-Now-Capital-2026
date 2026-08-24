# Production activation — 2026-08-24

Project: `hvxruwkgmhjoypepffgv`

## Applied in dependency order

1. Contractor document checklist (hardened grants/assertions)
2. Lead-referrer commission engine (current money-schema compatible)
3. Doctor network projection
4. Client legal template role
5. Token-scoped signing packet read
6. Lead-referrer operational pipeline
7. Client-offer activity event values
8. Client funding offers and immutable decisions
9. Client-offer notification event values and triggers
10. Partner/sub-agent operations
11. Contractor document chase workspace
12. Governed document task automation
13. Secure role earnings/network RPC replacement
14. Canonical funder phone/billing reconciliation

Every migration was applied by one actor and followed by an object or security
verification before proceeding. Failed attempts were transactional and did not
leave partial objects.

## Edge Functions deployed

- `change-user-password` version 1 — custom bearer-session validation; an
  unauthenticated POST returned HTTP 401.
- `generate-legal-document-pdf` version 1 — webhook-secret validation; a POST
  without the secret returned HTTP 401.

Both functions intentionally use `verify_jwt=false` because their function
bodies enforce the existing custom authentication contract.

## Verification

- Release activation controller tests: 7/7
- Repository contract tests: 3/3
- Cross-role source-contract tests: 38/38
- Supabase security advisor after activation: zero `ERROR` findings
- New client-offer and contractor/lead-referrer tables have RLS enabled and
  direct authenticated writes are blocked where RPC-only access is required.

## Ledger note

Many historical migrations were applied through a management API that assigned
different live timestamps. They must be reconciled by normalized logical name,
not replayed by filename timestamp. Older index migrations were verified against
`pg_class`/`to_regclass` and were already present, so they were not rerun.
