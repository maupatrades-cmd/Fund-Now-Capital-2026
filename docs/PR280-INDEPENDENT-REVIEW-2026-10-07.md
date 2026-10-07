# Independent review — PR280 — 7 October 2026

This follow-up was based on reading the current code, not new Qodo findings.

1. ClientApplicationPage dropped blank answers from its upsert. Clearing a previously saved field silently retained its old value. All known fields now write their trimmed value, including the empty string. The canonical answers schema permits empty JSON strings; required-field validation still blocks submission with missing required inputs.
2. Draft and submission updates checked only the API error. A zero-row update could appear successful. Both updates now require a returned ID with single(), so a missing or inaccessible response fails instead of claiming a save/submission.
3. Completed-deal eligibility was only checked in the client. A new pending migration adds a database trigger guarding form and answer inserts/updates for funded, invoiced, commission_paid and declined deals. It preserves the existing ownership and submitted-form validation triggers. Unlinked enquiries remain allowed.
4. Answer-write validation read draft status without locking the parent response. The new guard locks the response before validating status, then locks the deal in share mode while checking stage. This serializes answer writes against response submission and deal-stage updates. Multi-session concurrency still needs verification outside the isolated single-session test environment.

Evidence:14 targeted portal/application checks passed, including actual PostgreSQL trigger execution for all four terminal states, linked and unlinked writes, immutable identity, submitted-answer rejection, and clearing stored answer text. Static wiring checks cover the browser update cardinality and inclusion of blank answers. No real client record was changed.

New migration:20261007163650_client_application_open_deal_guard.sql, generated with the official CLI. Not applied. No merge, deployment, staff migration change or commission-policy change. Existing financial integration still needs comparison against Claude's live owner commission editor before activation.
