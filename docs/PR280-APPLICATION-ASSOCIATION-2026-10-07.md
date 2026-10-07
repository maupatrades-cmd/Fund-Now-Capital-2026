# PR280 application association repair — 7 October 2026

Qodo's follow-up finding4206618860 identified that client-portal form creation omitted deal_id while the owner's document checklist required a deal association.

- Clients explicitly select an existing application from their safe progress RPC, or keep a new/unlinked enquiry. New responses persist the selected deal_id.
- Draft reads and cache keys include client, product and deal. A new enquiry queries only NULL deal_id; superseded records are excluded. Changing product preserves the selected deal and changing application resets the form. Background refresh does not overwrite unsaved input.
- The existing database relationship trigger verifies the deal belongs to the client and preserves immutable form identity and submitted responses. No existing answers are edited or backfilled.
- Owners see unlinked enquiries separately, including the client-selected product, without automatically using them as this deal's funding route. The owner can confirm and configure the route using the existing controls.

Verification:11 targeted tests passed, including actual PostgreSQL relationship triggers against a minimal isolated schema, plus portal contracts. This is not a real browser session or proof of production deployment. Release CI must rerun after publication.

Coordination: live ledger now includes staff_roles_enum20261007120348 and staff_access_and_audit20261007121025. The owner confirmed Claude is still applying staff migrations. No live changes or migration renames were performed here. Reconcile the final ledger and pending integration filenames after that operation finishes. Do not use a blind db push or replay already-applied migrations.

## Follow-up Qodo review

Commit102a746 published and Release CI Gate37620619160 passed. Qodo review5442239917 found three additional client-flow defects.

The form now discovers saved responses within the selected client/deal scope before loading answers. A single matching response resumes its own product; multiple responses require an explicit selection by response ID. New products have an explicit start-new path, existing inactive product codes remain attached to their saved response, and changing deals clears the previous product/response selection. Choice queries are invalidated after saving.

Completed deals are excluded from the selector, and progress is refreshed and checked immediately before linked saves. Unlinked enquiries do not require progress-service availability. These checks protect the UI flow; the existing database trigger still enforces client/deal ownership and immutable response identity. It does not yet provide an atomic terminal-deal write restriction for direct API callers; that separate backend hardening remains pending and must not be claimed deployed.

Twelve targeted tests pass, including executable relationship guards and choice/eligibility regressions. No live migration or staff object changed in this follow-up.
