export const contractSuites = [
  "tests/role-onboarding-smoke.test.mjs",
  "tests/client-portal-smoke.test.mjs",
  "tests/calendar-booking-rules.test.mjs",
  "tests/client-funding-offers-contract.test.mjs",
  "tests/client-offer-notification-readiness.test.mjs",
  "tests/contractor-document-chase.test.mjs",
  "tests/lead-referrer-operations.test.mjs",
  "tests/partner-subagent-operations.test.mjs",
  "tests/team-onboarding.test.mjs",
]

export const transactionalSqlSuites = [
  "supabase/tests/partner_view_leak_tests.sql",
  "supabase/tests/client_backend_wave_smoke.sql",
  "supabase/tests/money_lifecycle_smoke.sql",
]

export const journeys = [
  { role: "owner", proof: ["role-onboarding", "calendar", "offer-follow-up"] },
  { role: "client", proof: ["portal", "offer", "notification"] },
  { role: "partner", proof: ["role-gate", "sub-agent-directory", "cross-tenant-denial"] },
  { role: "contractor", proof: ["role-gate", "document-chase", "money-lifecycle"] },
  { role: "lead_referrer", proof: ["role-gate", "own-leads", "own-deals"] },
  { role: "partner_sub_agent", proof: ["parent-partner-attribution", "own-leads", "cross-tenant-denial"] },
]
