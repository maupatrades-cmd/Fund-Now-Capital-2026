# Client backend PR 4 - role invitation links

Independent from PR 3 and based directly on Build 74A. Raw tokens are returned once and never
stored. The database stores a keyed hash, revocation/expiry/use controls, and append-only analytics.
The private consume function is callable only by `service_role` and has a pinned search path.

Logical migration order: identity, application intake, invitations, attribution. Review may happen in parallel.