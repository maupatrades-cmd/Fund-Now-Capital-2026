# Production drift preflight

The repository contract preflight catches one high-risk class of deployment drift before merge: frontend code that names an RPC or Edge Function without committing its server-side source.

Run it from the repository root:

```powershell
npm run test:repository-contracts
```

The command is read-only. It scans `src/` for literal `supabase.rpc(...)` and `supabase.functions.invoke(...)` calls, then verifies that:

- each literal RPC name appears in a `create function` statement under `supabase/migrations/`;
- each literal Edge Function has `supabase/functions/<name>/index.ts`;
- non-literal/dynamic calls are listed for manual inspection instead of being silently accepted.

A pass proves repository-source completeness only. It does **not** prove that a migration was applied, an Edge Function was deployed, permissions are correct, or production is healthy.

## Manual live verification after merge

Only the designated single migration/deployment actor performs these checks. Do not run concurrent live changes.

1. Record the exact merged commit and confirm the deployment is built from that commit.
2. Compare repository migration versions with the linked production migration ledger.
3. For each newly referenced RPC, query the production catalog for its exact name and signature.
4. Verify RPC grants and RLS with the least-privileged applicable roles; include a cross-tenant denial test.
5. Compare `supabase/functions/*/index.ts` directories with the production Edge Function list.
6. For each newly referenced Edge Function, confirm the deployed version and run one authenticated success case plus one unauthorized denial case.
7. Exercise the user-facing flow in production and inspect the browser console, network response, audit/activity record, and expected database side effect.
8. Record any mismatch as deployment drift; do not mark the feature complete until repository, ledger, live objects, deployment, and smoke result agree.

The broader `scripts/ops/sync-and-audit-fnc-main.ps1` remains the migration inventory and static security report. This preflight is intentionally narrower and CI-friendly; the two checks complement rather than replace each other.
