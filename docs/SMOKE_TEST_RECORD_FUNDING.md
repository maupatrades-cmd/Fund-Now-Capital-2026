# Record Funding — smoke test

This check confirms the missing bridge between a funded deal and its funder
invoice. Use a test deal or a verified real disbursement. Never substitute the
requested or quoted amount for the amount actually paid out.

## Before merging

- Run `npm run build`.
- Run `npm run lint`; unrelated existing warnings may remain, but this feature
  must add no warning or error.
- Confirm the PR changes only the Deal Detail funding flow and this documentation.

## Owner workflow

1. Open a deal that has a non-declined funder submission without a funded amount.
2. In **Funder submissions**, select **Record funding** for the correct funder.
3. Enter the actual disbursed amount and funding date. Add the finance charge
   only when it is known.
4. Select **Confirm funding**.
5. Confirm the submission displays the funded amount and date.
6. Confirm the deal is in **Funded** (an already **Invoiced** deal must not move
   backwards).
7. In **Invoices**, confirm **Generate invoice — [Funder]** is now available.
8. Generate the draft and verify that **Facility advanced** equals the exact
   amount recorded in step 3.
9. Refresh the Deal Detail, Pipeline, Dashboard, and Invoices pages and confirm
   the values remain consistent.

## Safety checks

- A declined submission must not show **Record funding**.
- A funded submission must show its amount/date and must not expose edit,
  delete, or a second **Record funding** action.
- Double-submitting must not overwrite an existing funded amount.
- Recording one funded submission must not modify another submission on a
  multi-funder deal.
- No invoice is created automatically: the owner still reviews and generates
  the draft, then separately issues it.

## DEAL-013

For DEAL-013, first obtain the actual Merchant Capital disbursement amount and
funding date. Its R350,000 quote is not proof that R350,000 was disbursed.
