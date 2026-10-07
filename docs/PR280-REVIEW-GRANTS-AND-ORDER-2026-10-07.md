# PR280 remaining review repairs — 7 October 2026

The signer-facing get_agreement_signing_package and submit_agreement_signature RPCs now explicitly revoke service_role execution. Authenticated signers retain access, subject to identity and consent checks; postgres administration remains available. Repository Edge Functions contain no callers of these two RPCs. The isolated database test verifies permission denial for service_role, anonymous denial, wrong-account denial, and the successful authenticated signer flow.

The live ledger was checked through staff_checkin_cron20261007125651. None of the three integration migration logical names was present. Only these unapplied files were moved into official CLI-generated files:

- 20260814000000_lead_referrer_path_a_support.sql → 20261007161245_lead_referrer_path_a_support.sql
- 20260816000000_signing_identity_binding.sql → 20261007161251_signing_identity_binding.sql
- 20260824164115_r100_reward_payroll_workspace.sql → 20261007161254_r100_reward_payroll_workspace.sql

The Path-A and payroll SQL content is unchanged by the moves. Signing additionally contains the grant repair above. Test and documentation references were updated. No applied migration was renamed, replayed, or manually recorded in the live ledger. Staff migrations remain Claude's responsibility.

The CLI uses a workspace-local SUPABASE_HOME. It generated local files only; no login, database push, migration apply, or deployment was performed.

Release restrictions remain: compare the integration's financial writers against the newly live owner commission editor and current contract reward policy before activation. Do not overwrite manual commission behavior merely because the file order and isolated tests pass. The database-level completed-deal application restriction and real-session verification are separate outstanding work.
