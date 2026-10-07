# Signing integration repair — 7 October 2026

The pending signing migration now validates the signature evidence at the RPC boundary. Typed signatures require a nonblank adopted name and cannot attach an image. Drawn/uploaded signatures require a fingerprint and an existing object in the private signature bucket, under the authenticated signer's folder and the exact agreement. Signers cannot choose the owner/system-applied method.

This repairs the existing, **not yet applied** `20260816000000_signing_identity_binding.sql` in the integration branch. The live RPC still lacks the identity guard and storage existence check as verified on 7 October. Do not claim production is fixed or rewrite this migration after it has been applied.

## Evidence

`tests/sql/signing-access.test.mjs` executes the actual signing migration functions and retained packet RPC in isolated PostgreSQL/PGlite using `authenticated` and `anon` roles. It checks wrong-account read/sign/consent/open denial, internal resolver denial, anonymous denial, token format/not-found/expiry/revocation, required consent, immutable first consent, all-signers completion, replay rejection, safe legacy packet fields, and signature evidence validation.

The three isolated SQL suites and all 80 existing repository tests passed. These tests use a minimal synthetic prerequisite schema. They do not prove live migration compatibility, concurrent sessions, browser interactions or uploaded byte content. PostgreSQL verifies the object exists in the correct location; its supplied SHA-256 is still a client assertion, not a server download-and-hash verification of the bytes.

## Release boundaries

- Claude staff PR #279 is based on integration commit `ba57f567` and targets `codex/integration-repair`, not `main`.
- Reserve Claude's migration range `20261007090000` through `20261007094000` and its staff/intake/team objects. Do not apply its files concurrently with another migration actor.
- No production migrations were applied in this repair session. Review and coordinate exact files before applying.
- Existing financial migrations still require reconciliation with the Owner's manual commission entry instruction and current contract terms. Passing their technical tests does not authorize automatic commission or obsolete payout dates.
- Qodo review was not run. GitHub connector PR creation returned403; browser fallback timed out. Publication/review remains a separate release gate.
- Vercel work is paused at the Owner's request.
