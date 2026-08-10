# Client backend PR 3 - canonical application intake

This PR is independently based on `codex/client-build-74a-identity`.
It adds the canonical application record, application event history, a R100 million ceiling,
asset-backed and additional funding products, referral-claim capture, and a public Edge intake.

The referral claim is deliberately pending and untrusted. PR 4 verifies invitation tokens and
PR 5 supplies Path B lead-referrer attribution. Merge order remains PR 3, then PR 4, then PR 5.
Migrations are committed but are not applied by this publisher.