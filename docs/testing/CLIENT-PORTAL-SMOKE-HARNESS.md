# Client portal smoke harness

This harness is a fast, zero-write contract smoke test for the client portal. It uses Node's built-in test runner, so it adds no browser framework or package dependency.

## Run

```bash
npm run test:client-portal-smoke
```

Run it with the normal quality gates:

```bash
npm run lint
npm run build
```

## What it protects

- `/client/*` stays nested behind the authenticated client-role gate.
- Quick invitations require a syntactically valid email and explicit authorised-email confirmation.
- Dashboard links and embedded application-progress, meeting and messaging workspaces remain present.
- Application draft/save/submit/lock behavior remains wired.
- Document upload remains governed by the server checklist, uses private storage, cleans up failed registrations and issues short-lived download URLs.
- Messaging keeps validation and closed-thread read-only behavior.
- Meeting requests remain SAST-based and only pending requests expose cancellation.
- Progress uses client-safe stages; the outcomes route continues to describe only Owner-published outcomes.

## Safety and limitations

The automated suite reads source files only. It does not authenticate real users, invoke Edge Functions, write to Supabase, upload files, send email, book meetings or accept an offer. It contains no credentials.

The suite is intentionally a contract smoke gate, not a substitute for browser or production smoke testing. The `/client/appointments`, `/client/messages`, `/client/progress` and `/client/offers` route pages are still lightweight route surfaces; the live meeting, messaging and progress widgets currently appear on the client overview. Outcomes remain informational until an Owner-published outcome backend is connected.

For a release candidate, use a disposable test client in the Vercel preview and manually verify:

1. Open an invitation link while signed out and sign in as that client.
2. Confirm `/client` opens and a non-client account is redirected to its own role home.
3. Save an application draft, reload it, complete required fields and submit it once.
4. Upload one non-sensitive sample PDF against an available checklist item; verify its review status and signed download.
5. Send a test message and confirm the Owner can reply; verify a closed thread cannot be replied to.
6. Request a future meeting in SAST, cancel it while pending and confirm non-pending requests do not show cancellation.
7. Verify application progress renders only client-safe labels.
8. Open Outcomes and confirm it does not expose internal funder notes or unpublished decisions.

Delete the disposable sample data through the approved owner/admin workflow after the test.
