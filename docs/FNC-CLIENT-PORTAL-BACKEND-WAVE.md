# FNC Client Portal Backend Wave

Backend-first delivery record. Frontend starts only after the required backend PRs are reviewed, merged, migrated and verified.

## Owner overrides

- Working capital supports requests up to R100 million.
- Asset-backed finance is a supported product.
- Client forms will later populate owner-uploaded funder and legal templates.
- Document requirements combine the selected product, Owner decisions and selected funder requirements.
- The visual prototype is design inspiration only, not production source.

## Delivery order

- [x] Build 74A: client role and isolated CRM identity foundation (this PR)
- [ ] Build 74B: client magic-link request and callback backend
- [ ] Build 76: canonical public application intake and three-way referrer capture
- [ ] Build 77: revocable per-role invite tokens and analytics
- [ ] Build 78: Path B lead-referrer to partner attribution
- [ ] Build 79: verified client account bootstrap and welcome email
- [ ] Backend forms: canonical business/person/product answer model
- [ ] Document rule engine: product plus funder plus Owner overrides
- [ ] Form-template field mapping and immutable generated-document snapshots
- [ ] Backend migration/RLS/integration smoke test
- [ ] Client portal frontend wave

## Build 74A security boundary

Client users are linked to one CRM client through profiles.client_id. The resolver requires role=client and an active profile. Clients receive read-only access to their own business and contacts only. Public signup remains disabled. No invitation or application endpoint is opened by this PR.