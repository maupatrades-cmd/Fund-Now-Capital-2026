# Release activation controller

`scripts/ops/plan-release-activation.mjs` creates a deterministic, read-only migration/function activation plan. It never connects to Supabase, links a project, applies a migration, deploys a function or reads an environment variable.

## 1. Capture a sanitized live inventory

The designated single migration/deployment actor queries the approved production project using the existing authenticated operational process. Create a local JSON file outside version control containing only:

```json
{
  "captured_at": "2026-08-24T10:00:00Z",
  "baseline_commit": "70b34d8",
  "applied_migration_versions": ["20260713120000"],
  "deployed_edge_functions": ["send-notification-email"]
}
```

List every applied 14-digit migration version and every deployed Edge Function name. Do not include project URLs, project refs, keys, tokens, headers, emails or command output containing credentials. The controller rejects unknown fields.

## 2. Generate the plan

```powershell
npm run plan:release-activation -- --inventory C:\secure-temp\fnc-live-inventory.json --output C:\secure-temp\FNC-ACTIVATION-PLAN.md --json-output C:\secure-temp\FNC-ACTIVATION-PLAN.json
```

Exit code `0` means the inventory has no repository/live-only blockers. Exit code `2` means drift was found and activation must stop. A clear report may still contain ordered pending work; it is a plan, not authorization.

## 3. Execute with one actor

After PR review and explicit owner approval, one named actor executes migrations in the exact reported order. After each migration, that actor verifies object existence and rechecks ledger/schema agreement before proceeding. Edge Functions deploy only after their migration dependencies, one at a time, with authenticated-success and unauthorized-denial checks. Then run every reported smoke command and the role-specific manual journey.

If another actor is applying or deploying, stop. If the live inventory changes, discard the plan, recapture inventory and regenerate it. Never repair or rewrite migration history merely to make the report green.
