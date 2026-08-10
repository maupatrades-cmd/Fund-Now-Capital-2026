# FNC Client Portal Backend Wave

Backend-first delivery record. Frontend starts only after the required backend PRs are reviewed, merged, migrated and verified.

## Owner overrides

- Working capital supports requests up to R100 million.
- Asset-backed finance is a supported product.
- Client forms will later populate owner-uploaded funder and legal templates.
- Document requirements combine the selected product, Owner decisions and selected funder requirements.
- The visual prototype is design inspiration only, not production source.

## Delivery order

- [ ] PR 1 / Build 74A: client role and isolated CRM identity foundation (this PR)
- [ ] PR 2 / Build 74B: client magic-link request and callback backend
- [ ] PR 3 / Build 76: canonical public application intake and referrer capture
- [ ] PR 4 / Build 77: revocable per-role invitation tokens and analytics
- [ ] PR 5 / Build 78: Path B lead-referrer to partner attribution
- [ ] PR 6 / Build 79: verified client account bootstrap and welcome email
- [ ] PR 7: canonical business, person and product form answers
- [ ] PR 8: product/funder/Owner document requirement rule engine
- [ ] PR 9: form-template field mapping and immutable generated-document snapshots
- [ ] PR 10: R100 complete-document reward lock and payroll-cycle ledger
- [ ] PR 11: role-scoped potential-earnings waterfall calculator
- [ ] PR 12: backend migration, RLS and integration smoke harness

PRs 2-12 are dependent stacked PRs during review. They merge in numerical order only. At every merge, the next PR must be rebased or retargeted to current main and re-reviewed before merge. Production migrations run only after all applicable review fixes are merged, in migration timestamp order.
- [ ] Client portal frontend wave

## Build 74A security boundary

Client users are linked to one CRM client through profiles.client_id. The resolver requires role=client and an active profile. Clients receive read-only access to their own business and contacts only. Public signup remains disabled. No invitation or application endpoint is opened by this PR.
