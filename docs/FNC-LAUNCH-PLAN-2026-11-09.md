# FNC launch plan and pay rules: owner decisions of 21 October 2026

Saved from the owner's messages of 21 Oct 2026 and the "CRM Build Spec" tab of the owner's document
**FNC Roles, Duties & Workflows** (claude.ai artifact `Xe1RKxopEYB4r2njgr3Jxd`, PDF copy uploaded the same day).
That document is the full source; this file records what the CRM build must follow. Where this file and an older
spec disagree, **this file wins** (see "What this replaces" at the end).

Launch: staff start **Monday 9 November 2026** at The Aloes, Burgersfort; paid training **9 to 13 November**.
First capture period **9 November to 6 December 2026**. First pay date for salaries: **Friday 27 November 2026**
(pro-rata from 9 November). December 2026 is paid on **Thursday 24 December**.

## 1. Ownership (changed 21 Oct 2026)

**Claude Code owns, from now on:** the incentives engine, the payroll cycle (including payslips, Batch 5c), the R100
reward logic, and the whole commission and agent-invoice chain. Codex has stopped work on these, so the pay logic lives
in one place and nothing can be paid twice.

Codex's existing work in these areas stays in place and is now maintained by Claude:
- Commission Picker / estimator (`PICKER.md`, `CommissionPickerWidget`): the Director types in the amounts, sees the
  estimate, and locks the final commission.
- Owner manual commission editor and `owner_commission_entries`, adjustments, flags and deal totals.
- Restricted commission notices (`commission_notice_snapshots`, `owner_issue_commission_notice`).
- Manual payment evidence (`owner_commission_payments`, `owner_record_commission_payment`, `commission-payment-proofs`).
- R100 reward locks and payout batches (`qualified_reward_*`, `complete_document_reward_locks`).
- The automatic ledger (`calculate_commission`, `commission_records`, contractor and partner invoices).
At the last check (21 Oct) Codex had no open pull request; its last pay work merged on 17 Oct.

## 2. Priority order for the launch

| # | Work | Deadline |
|---|---|---|
| 1 | Fix the bugs blocking sub-agent enrolment | before 6 Nov |
| 2 | Staff role logins and landing pages: Office Administrator, Sales Coordinator, Switchboard, HR, **Field Supervisor**, **field consultant**. Fix the history-role gap (Administrator actions saved as Sales Coordinator). Each landing page shows own tasks (accept/decline), own leads, own earnings and **targets against month-to-date**; the Director sees all roles on one screen | before 6 Nov |
| 3 | Lead capture and assignment; client file with required documents and approval (R100 reward line on approval) | before 6 Nov |
| 4 | Auto-CC the Director on **all** Sales Coordinator internal messages and **all** messages from agents, sub-agents and Team Leaders | by 13 Nov |
| 5 | Agent invoice chain, incentives engine, payroll cycle, payslips (tested against the spreadsheet figures) | **before 4 Dec** |

Also by 13 November (CRM Build Spec): onboarding records and statuses; notice forms; tasks with accept/decline.

**Deferred until after launch:** petty cash, visitor log, stationery alerts, bills diary, records-quality check, and
roadmap Phases C to F. December onwards: calendar and bookings polish, staff hours and leave, reports, field module.

Until the payroll cycle is live, pay runs on a spreadsheet; the first cycle closes on 6 December.

## 3. Owner decisions

1. **R100 submission fee / document reward:** released on **Verified**: documents approved by the Director, or by the
   Office Administrator as back-up. Not on Complete. Created whether the deal is later approved or declined. At most
   one per client per 6 months. Not payable before the person has cleared iFacts and has an Agent Code.
2. **Commission records:** the **agent's invoice is the payable record** and must be **linked to the Director's
   commission notice**. Payment only when both are linked and approved through the chain
   Agent → HR → Office Administrator → Director. Proof of payment must be viewable by staff in the chain and by the agent.
3. **Payslips:** Director → Office Administrator → HR → staff member (the Director approves first).
4. **Outbound routing:** lead → Sales Coordinator assigns it to its owner; if unowned → New Leads → Office
   Administrator → Director (already built, Batch 2).
5. **PO deals and deals of R1M and above:** no fixed rate is hard-coded in `calculate_commission`. The Director uses the
   **Commission Picker estimator**: she fills in the amount, sees the estimate, and the final commission is set (locked)
   at the end. (Answers the two open questions in CLAUDE.md "Open decisions" #3.)

## 4. Contract terms the CRM must enforce

Each agent record stores its **contract type** and is paid on **its own contract's schedule** (signed contracts set
their own pay dates until amended in writing).

| Term | Sub-agent (FNC-SAA-01, Bright Destiny) | Direct agent (FNC-DRA-01) | Team Leader | Field Supervisor / consultant | Office staff |
|---|---|---|---|---|---|
| Per submission or lead | R100 per Complete Submission once FNC confirms it (Verified); max one per client per 6 months | Same | Own submissions as an agent | R100 (supervisor) / R150 (consultant) per lead marked Ready for sale | Sales Coordinator R25 per closed file |
| Commission | Only on **approved deals of R1M+**: **40%** of FNC's Net Fee Received (R1M–R4.99M), **50%** (R5M–R9.99M), **65%** (R10M+). Below R1M: R100 submission fee only. One pool shared with the Principal Referral Partner | **40%** of Net Fee Received on every closed deal, no minimum; in a team **28% member + 12% Team Leader** | 12% of net fee on team deals | 2% / 2.3% on closed field deals (base still to confirm) | Switchboard 0.05% of FNC revenue per office deal |
| Retainer or allowance | Tier 1 R2,000 (R1M+ deal), Tier 2 R5,000 (R5M+), Tier 3 R20,000 (R10M+), 3 months each, grace month on step-down from Tier 2 and 3. One tier at a time | Weekly bonus R1,000 (5 complete submissions in a week, different clients); activity allowance R4,500 for the first 2 months with 4 qualifying weeks; Tier 1 R10,000 (R5M closed in 3 months), Tier 2 R15,000 (R20M+), 3 months each, no grace month. One retainer or allowance per month | Basic R6,000–R25,000 by level (employee) | Field Supervisor R4,500 activity allowance | Salaries: Office Administrator R7,500, Sales Coordinator R6,000, Switchboard R5,000 allowance |
| When paid | Submission fees and retainers by the 15th of the following month; commission within 14 days of FNC's cleared fee | Same as sub-agent | Staff cycle (27th) | Staff cycle | Salary 27th (current month); incentives one month in arrears |
| Not payable | Before Agent Code is issued; fraud or breach; unpaid or clawed-back fee | Same | — | Before verification | — |
| Statement and queries | Monthly statement; queries within 30 days | Same | — | Queries by the 11th | Queries by the 11th |

Further rules: commission and tiers are calculated on FNC's **Net Fee Received**; earners never see the fee itself.
Advances, overpayments and clawbacks are set off against the next amounts due.

**Still open (owner):** agent payment dates: **Option A** per contract (fees and retainers by the 15th, commission within
14 days of FNC's cleared fee) or **Option B** the staff 27th cycle once contract amendments are signed. Until the owner
chooses, build for Option A, because it is what the signed contracts say.

## 5. Payroll cycle (staff, and agents once on the 27th cycle)

- Capture period **7th to 6th**; calculation from the 7th (Office Administrator and HR); queries close on the **11th**
  (payroll closes; later items move to the next cycle); pay run on the **27th**, or the last working day before it if
  the 27th is a weekend or public holiday.
- Statuses: Open (7th–6th) → Calculating → Query window (to the 11th) → Closed → Paid (27th). Office Administrator and
  HR calculate; the Director closes and pays.
- **Salary** is paid for the **current calendar month** (pro-rata in the first month; BCEA s32). **Commission, file
  fees, lead fees and bonuses** are paid **one month in arrears**.
- Earning lines are created only once the **client's payment has cleared** (in FNC's account by the 6th). A reversal or
  refund creates a **negative clawback line** in the next cycle.
- Earners see lines as "pending" until the cycle closes on the 11th, then "payable", then "paid" on the 27th.
- Agent commission invoices: agent to HR by the 8th; HR checks by the 9th; Office Administrator by the 10th; Director
  approves by the 11th.
- Leave, overtime and deductions are captured up to the 6th and adjusted in that month's pay.
- Reminders: the 6th (capture closes), the 9th (two days left for queries), the 11th (payroll closed), the 27th (paid).

## 6. Incentives (created automatically from status changes)

| Earning line | Trigger | Amount | Paid to | Approved by |
|---|---|---|---|---|
| File fee | Client file handled by the Sales Coordinator → Closed (funded or declined) | R25 | Sales Coordinator | Office Administrator |
| Field Supervisor lead fee | Field lead → Ready for sale | R100 | Field Supervisor | Sales Coordinator confirms, Office Administrator approves |
| Field consultant lead fee | Own lead → Ready for sale | R150 | Field consultant | Sales Coordinator confirms, Office Administrator approves |
| Document reward | Client file → Documents approved (Verified) | R100 | Submitting agent | Director (Office Administrator back-up) |
| Deal bonus | Any office deal → Client paid | 0.05% of FNC's revenue on the deal | Each Switchboard Assistant | Director |
| Field commission | Field deal → Client paid | 2% (supervisor, team's deals) / 2.3% (consultant, own deals) | Field Supervisor / consultant | Director |
| Agent and Team Leader commission | Deal → Client paid | Per the contract terms above | Agent, Team Leader | Chain to Director |
| Company performance bonus | Payroll cycle → Closed, net profit entered by the Director | One pool of **0.5% of monthly net profit** (after all costs, including salaries, allowances, commissions, rent and running costs); no profit means no bonus | Shared by performance across all office staff and contracted field agents | Director |

Staff never see funders, FNC's fee, net profit or the pool size; each person sees only their own rand amounts.

**Still open (owner):** (a) the base for the 2% / 2.3% field commission (FNC's fee or the funded amount); (b) how
performance splits the bonus pool (for example by leads, files or closed deals handled).

## 7. Targets per role (shown on landing pages against month-to-date)

| Role | Monthly target | Status |
|---|---|---|
| Team Leader, months 1–3 | 3+ active consultants (4+ complete submissions each); 50+ team complete submissions; 50%+ pass FNC's credit screen; own 2+ qualifying weeks; replace inactive consultants within 30 days; weekly team report by Monday 12:00; zero fraud | DRA-01 Part E (signed) |
| Team Leader, month 4 on | 5+ active consultants; 80+ team complete submissions; R5M team closed value per rolling 3 months; same quality rules | DRA-01 Part E (signed) |
| Direct agent | Qualifying week = 5 complete submissions (different clients); 4 qualifying weeks a month earns the R4,500 allowance; Tier 1 at R5M closed in 3 months | DRA-01 Parts B and D (signed) |
| Sub-agent | At least 1 complete submission every 3 months (else termination); tiers by approved deal size | SAA-01 clause 19, Schedule 1 (signed) |
| Field consultant | 40 leads captured; 12 marked ready for sale; 3 field days a week | Proposed, Director to confirm |
| Field Supervisor | 5+ active field consultants; 150 team leads, 45 ready for sale; daily field report by 17:00 | Proposed |
| Sales Coordinator | 60 client files opened; documents complete within 7 days on 70% of files; 08:00 sales call daily; weekly sales report every Friday | Proposed |
| Switchboard Assistant | Every call logged the same day; missed calls returned within 2 hours; required-documents email within 1 hour of a request; 30 leads captured | Proposed |
| Office Administrator | Admin-fee invoice within 1 working day of a signed mandate; 80% collected within 7 days; payroll figures ready by the 9th | Proposed |

## 8. Other rules from the build spec

- Workflows move one status at a time; only the named role moves them forward; every move is logged. Lead: Captured →
  Assigned (or New Leads) → Contacted → Ready for sale → Converted to client file / Dropped. Client file: Opened →
  Documents requested → received → checked → approved → Submitted → Approved / Declined → Funded → Client paid → Closed.
  Agent commission invoice: Client paid → Invoice sent to agent → Agent invoiced → HR checked → Office Admin checked →
  Director approved → Paid → Proof of payment sent. Onboarding: Contract sent → signed → Courtesy call done → Documents
  uploaded → checked → Sent to iFacts → Cleared / Not cleared → Agent Code issued → Active.
- Admin-fee defaults: **R1,896 + VAT (purchase order)**, **R2,899 + VAT (working capital)**, editable per client.
  (Batch 5b built amount-per-file with no VAT; the defaults and VAT line follow in a later change once FNC's VAT
  registration is confirmed.)
- Nobody earns commission, the R100 reward or the R200 headshot allowance until iFacts has cleared and they have an
  Agent Code.
- Overdue alerts: admin-fee invoice unpaid after its due date; documents outstanding after 5 working days; onboarding
  stuck at one step for 7 days.
- POPIA: ID numbers and bank details visible only to HR, the Director and the person; never in lists or file names;
  bulk emails BCC.

## What this replaces

- CLAUDE.md "Ownership": Codex no longer owns commission, payroll, R100 or payment routes (section 1 above).
- CLAUDE.md "Open decisions" #3 (PO tier and R1M+ rate): answered by decision 5 above.
- `docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md` §3 (R100 on approval): confirmed as Verified; §4 commission flow: the
  agent invoice is now the payable record, linked to the notice.
- `docs/CLAUDE-TO-CODEX-HANDOVER-2026-10-17.md` §6 questions 1 and 2: answered by decision 2 above.
