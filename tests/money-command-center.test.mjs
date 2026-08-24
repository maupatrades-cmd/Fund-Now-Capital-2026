import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/MoneyCommandCenterPage.tsx", import.meta.url), "utf8");
const dispatchHook = readFileSync(new URL("../src/hooks/useInvoiceDispatches.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("owner money centre covers the canonical four-step lifecycle", () => {
  assert.match(page, /Funded, needs invoice/);
  assert.match(page, /Draft funder invoices/);
  assert.match(page, /Awaiting funder receipt/);
  assert.match(page, /Payable downstream/);
  assert.match(app, /path="\/money"/);
});

test("dispatch writes use the canonical idempotent RPC rather than direct table inserts", () => {
  assert.match(dispatchHook, /rpc\("queue_funder_invoice_dispatch"/);
  assert.doesNotMatch(dispatchHook, /from\("funder_invoice_dispatches"\)[\s\S]*\.insert\(/);
  assert.match(dispatchHook, /p_retry_of/);
});

test("owner orchestration links existing settlement screens and states its privacy boundary", () => {
  assert.match(page, /\/invoices\/partner-approvals/);
  assert.match(page, /\/invoices\/contractor-approvals/);
  assert.match(page, /Amounts on this page are owner-private/);
});
