# PR280 application association repair — 7 October 2026

Qodo's follow-up finding4206618860 identified that client-portal form creation omitted deal_id while the owner's document checklist required a deal association.

- Clients explicitly select an existing application from their safe progress RPC, or keep a new/unlinked enquiry. New responses persist the selected deal_id.
- Draft reads and cache keys include client, product and deal. A new enquiry queries only NULL deal_id; superseded records are excluded. Changing product preserves the selected deal and changing application resets the form. Background refresh does not overwrite unsaved input.
- The existing database relationship trigger verifies the deal belongs to the client and preserves immutable form identity and submitted responses. No existing answers are edited or backfilled.
- Owners see unlinked enquiries separately, including the client-selected product, without automatically using them as this deal's funding route. The owner can confirm and configure the route using the existing controls.

Verification:11 targeted tests passed, including actual PostgreSQL relationship triggers against a minimal isolated schema, plus portal contracts. This is not a real browser session or proof of production deployment. Release CI must rerun after publication.

Coordination: live ledger now includes staff_roles_enum20261007120348 and staff_access_and_audit20261007121025. The owner confirmed Claude is still applying staff migrations. No live changes or migration renames were performed here. Reconcile the final ledger and pending integration filenames after that operation finishes. Do not use a blind db push or replay already-applied migrations.
