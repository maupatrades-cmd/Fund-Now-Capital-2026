# Partner branding assets

Referral-partner logos used on the invoices they raise against FNC (SPEC S11.2,
Phase C4 `partner_invoices` PDFs).

## Bright Destiny (Doctor) — `bright-destiny-finance-partners-logo.jpg`

Owner-supplied logo for the referral partner **Bright Destiny Finance Partners**
(`referral_partners` business name **"Bright Destiny"**; the logo art reads
"Bright Destiny — FINANCE PARTNERS"). Gold "BD" monogram + rising-sun crest on
black.

Staged here (committed, version-controlled) by the DOCTOR-INVOICING / C4 lane so
the branded-PDF follow-up PR can base64-inline it into
`supabase/functions/generate-partner-invoice-pdf/logo.ts` — mirroring the FNC
logo in `generate-invoice-pdf/logo.ts`.

## Branded partner-invoice PDF — planned follow-up PR (this lane)

The C4 invoice **lifecycle** (generate → submit → approve → pay → settle) and its
partner + owner UIs ship first with an inline detail view. The branded PDF is the
immediate next PR because it is a self-contained unit that needs its own owner
deploy + smoke test:

1. `partner_invoices.pdf_storage_path text` column.
2. A private storage bucket for the rendered partner-invoice PDFs, path
   `{referral_partner_id}/{invoice_number}.pdf`, with RLS: owner all; partner
   reads only their own folder (`(storage.foldername(name))[1] = current_partner_id()::text`).
   Plus the S11.2 `partner-branding` bucket (`{partner_id}/logo.{ext}`) if the
   owner prefers uploading logos over the inlined base64.
3. `supabase/functions/generate-partner-invoice-pdf/` — a Deno + pdf-lib renderer
   mirroring `generate-invoice-pdf`, with the **partner** as the "FROM" (BD logo
   header) and **FNC** as "INVOICE TO". Line items show the fictional funder
   name + the partner's take only; the description reads "Referral partner
   commission per Referral Agreement" — **no tier / gross / pool math on the PDF**
   (S7C).
4. `invoke_generate_partner_invoice_pdf(uuid)` (pg_net, WEBHOOK_SECRET), fired
   from `partner_submit_invoice`, writing `pdf_storage_path` back.
5. A "Download PDF" button on the partner + owner invoice detail (owner-/partner-
   session signed URL — no service-role secret in the browser).
