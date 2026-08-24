# Release CI gate

`.github/workflows/release-ci.yml` is the repository's read-only merge gate. It runs on every pull request and every push to `main`.

The workflow installs the committed lockfile, builds and lints the application, verifies frontend-to-database and Edge Function contracts, checks that the generated build register is current, validates the read-only release activation planner, and runs the zero-write cross-role and money command-centre contract suites.

## Safety boundary

- GitHub permissions are limited to `contents: read`.
- The workflow does not read environment secrets.
- It does not connect to Supabase or Vercel.
- It never applies migrations, deploys Edge Functions, or executes the transaction-wrapped SQL smoke files.
- The cross-role runner only validates those SQL fixtures for `BEGIN`/`ROLLBACK` safety; it does not execute them.

Production activation remains a separately approved, single-actor operation after merge. CI proves repository readiness only; it is not evidence that migrations or functions are live.

Run the same gate locally with the individual `npm run` commands shown in the workflow. Run `npm run test:release-ci` after changing the workflow itself.
