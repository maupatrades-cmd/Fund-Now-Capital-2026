// generate-invoice-pdf — renders a branded FNC → funder "TAX INVOICE" PDF and
// stores it in the private `invoices` bucket, then writes the path back onto the
// funder_invoices row. Invoked async via pg_net from issue_funder_invoice()
// (see public.invoke_generate_invoice_pdf). C1.1 / SPEC S7.
//
// Auth: validates a shared X-Webhook-Secret header (same pattern as
// send-notification-email). Deployed verify_jwt=false.
// Env: WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// The FNC company/banking constants below are the real business truth (owner-
// locked, INV-0031). VAT is intentionally OFF (FNC is not VAT-registered).

import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import { FNC_LOGO_PNG } from "./logo.ts";

// ---- locked FNC business constants (INV-0031) -------------------------------
const FNC = {
  name: "Fund Now Capital (Pty) Ltd",
  tagline: "Many funders. More Approvals",
  address: "Cedarwood House, 128 Ballyclare Drive, Bryanston, Sandton, 2191",
  cipc: "2026/066284/07",
  tel: "010 102 0534",
  mobile: "076 803 8987",
  email: "thapelol@fundnowcapital.africa",
  web: "www.fundnowcapital.africa",
  ownerName: "Thapelo Lekgoro",
  bank: {
    accountName: "Fund Now Capital (Pty) Ltd",
    bank: "Absa Bank Limited",
    branch: "Absa Universal Branch",
    branchCode: "632005",
    accountNumber: "4125798855",
  },
  vatDisclaimer: "Fund Now Capital (Pty) Ltd is not currently registered for VAT.",
};

const NAVY: [number, number, number] = [26, 58, 82]; // #1a3a52
const TEAL: [number, number, number] = [45, 168, 184]; // #2da8b8
const INK: [number, number, number] = [30, 51, 70];
const MUTED: [number, number, number] = [138, 160, 179];

function formatR(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "R 0.00";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "R 0.00";
  return "R " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

type InvoiceRow = {
  id: string;
  invoice_number: string;
  funder_id: string;
  client_reference: string;
  facility_advanced: string | number;
  finance_charge_amount: string | number | null;
  commission_amount: string | number;
  total_amount: string | number;
  commission_description: string;
  contract_reference: string | null;
  payment_reference_expected: string;
  issued_date: string;
  payment_terms: string;
  due_date: string;
};

type FunderRow = {
  name: string;
  legal_name: string | null;
  billing_address: string | null;
  company_registration: string | null;
  vat_registration: string | null;
};

function renderPdf(inv: InvoiceRow, funder: FunderRow): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40; // margin
  let y = 48;

  // ---- header: FNC brand mark + company block (left) + TAX INVOICE (right) ---
  // Gradient "n" mark, top-left; the company text sits to its right (matches INV-0031).
  const LOGO = 46; // pt (~16mm) square
  const TX = M + LOGO + 12; // company-text left edge, beside the mark
  doc.addImage(FNC_LOGO_PNG, "PNG", M, y - 8, LOGO, LOGO);
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...NAVY);
  doc.text(FNC.name, TX, y);
  doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(...TEAL);
  doc.text(FNC.tagline, TX, y + 14);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...INK);
  doc.text(FNC.address, TX, y + 30);
  doc.text(`CIPC: ${FNC.cipc}  |  Tel: ${FNC.tel}  |  Mobile: ${FNC.mobile}`, TX, y + 42);
  doc.text(`Email: ${FNC.email}  |  Web: ${FNC.web}`, TX, y + 54);

  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(...NAVY);
  doc.text("TAX INVOICE", W - M, y + 2, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
  const rMeta = [
    ["Invoice Number", inv.invoice_number],
    ["Invoice Date", formatDate(inv.issued_date)],
    ["Payment Terms", inv.payment_terms],
  ];
  let ry = y + 22;
  for (const [k, v] of rMeta) {
    doc.setTextColor(...MUTED).text(k, W - M - 150, ry);
    doc.setFont("helvetica", "bold").setTextColor(...INK).text(String(v), W - M, ry, { align: "right" });
    doc.setFont("helvetica", "normal");
    ry += 14;
  }

  y += 76;
  doc.setDrawColor(...TEAL).setLineWidth(1.5).line(M, y, W - M, y);
  y += 22;

  // ---- INVOICE TO (null-safe) ------------------------------------------------
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...MUTED).text("INVOICE TO", M, y);
  y += 15;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NAVY);
  doc.text(funder.legal_name || funder.name, M, y);
  y += 14;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
  if (funder.billing_address) {
    doc.text(funder.billing_address, M, y);
    y += 12;
  }
  const reg: string[] = [];
  if (funder.company_registration) reg.push(`Company Registration: ${funder.company_registration}`);
  if (funder.vat_registration) reg.push(`VAT Registration: ${funder.vat_registration}`);
  if (reg.length) {
    doc.text(reg.join("  |  "), M, y);
    y += 12;
  }
  y += 12;

  // ---- reference row: Client / Facility / Finance charge ---------------------
  const showFinance = inv.finance_charge_amount !== null && inv.finance_charge_amount !== undefined;
  const cols: [string, string][] = [
    ["CLIENT REFERENCE", inv.client_reference],
    ["FACILITY ADVANCED", formatR(inv.facility_advanced)],
  ];
  if (showFinance) cols.push(["FINANCE CHARGE", formatR(inv.finance_charge_amount)]);
  doc.setFillColor(245, 248, 250).rect(M, y, W - 2 * M, 44, "F");
  const colW = (W - 2 * M) / cols.length;
  cols.forEach(([label, val], i) => {
    const cx = M + i * colW + 10;
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...MUTED).text(label, cx, y + 16);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...NAVY).text(val, cx, y + 32);
  });
  y += 62;

  // ---- description / amount --------------------------------------------------
  doc.setFillColor(...NAVY).rect(M, y, W - 2 * M, 20, "F");
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(255, 255, 255);
  doc.text("DESCRIPTION", M + 10, y + 13);
  doc.text("AMOUNT (ZAR)", W - M - 10, y + 13, { align: "right" });
  y += 30;

  doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(...NAVY);
  doc.text("Lead Provider Commission", M + 10, y);
  y += 14;
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...INK);
  const narrative = doc.splitTextToSize(inv.commission_description, W - 2 * M - 130);
  doc.text(narrative, M + 10, y);
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...NAVY);
  doc.text(formatR(inv.commission_amount), W - M - 10, y, { align: "right" });
  y += narrative.length * 11 + 16;

  doc.setDrawColor(225, 232, 238).setLineWidth(0.75).line(M, y, W - M, y);
  y += 22;

  // ---- total due -------------------------------------------------------------
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...NAVY);
  doc.text("TOTAL DUE", M + 10, y);
  doc.setFontSize(15);
  doc.text(formatR(inv.total_amount), W - M - 10, y, { align: "right" });
  doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(...MUTED);
  doc.text("Not VAT registered", W - M - 10, y + 12, { align: "right" });
  y += 34;

  // ---- payment instructions --------------------------------------------------
  doc.setFillColor(245, 248, 250).rect(M, y, W - 2 * M, 96, "F");
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...MUTED).text("PAYMENT INSTRUCTIONS", M + 10, y + 16);
  const pay: [string, string][] = [
    ["Account Name", FNC.bank.accountName],
    ["Bank", FNC.bank.bank],
    ["Branch", FNC.bank.branch],
    ["Branch Code", FNC.bank.branchCode],
    ["Account Number", FNC.bank.accountNumber],
    ["Reference", inv.payment_reference_expected],
  ];
  let py = y + 30;
  doc.setFontSize(8.5);
  for (const [k, v] of pay) {
    doc.setFont("helvetica", "normal").setTextColor(...MUTED).text(k, M + 10, py);
    doc.setFont("helvetica", "bold").setTextColor(...INK).text(v, M + 150, py);
    py += 11;
  }
  y += 112;

  // ---- disclaimer ------------------------------------------------------------
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
  const disc = doc.splitTextToSize(
    `Note: ${FNC.vatDisclaimer} The ${formatR(inv.total_amount)} amount is the gross commission per the Lead Provider ` +
      `Agreement. For queries please contact ${FNC.ownerName} on ${FNC.mobile} or ${FNC.email}.`,
    W - 2 * M,
  );
  doc.text(disc, M, y);
  y += disc.length * 10 + 8;

  // ---- footer band -----------------------------------------------------------
  const H = doc.internal.pageSize.getHeight();
  doc.setFillColor(...NAVY).rect(0, H - 46, W, 46, "F");
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(255, 255, 255);
  doc.text("Thank you for your business.", W / 2, H - 28, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(200, 214, 224);
  doc.text(`${FNC.name}  |  CIPC ${FNC.cipc}  |  ${FNC.web}`, W / 2, H - 14, { align: "center" });

  return new Uint8Array(doc.output("arraybuffer"));
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Webhook-Secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let invoiceId: string | undefined;
  try {
    invoiceId = (await req.json())?.invoice_id;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!invoiceId) return new Response("Missing invoice_id", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inv, error: invErr } = await supabase
    .from("funder_invoices")
    .select(
      "id, invoice_number, funder_id, client_reference, facility_advanced, finance_charge_amount, " +
        "commission_amount, total_amount, commission_description, contract_reference, " +
        "payment_reference_expected, issued_date, payment_terms, due_date",
    )
    .eq("id", invoiceId)
    .single();
  if (invErr || !inv) {
    return new Response(JSON.stringify({ error: invErr?.message ?? "invoice not found" }), { status: 404 });
  }

  const { data: funder, error: fErr } = await supabase
    .from("funders")
    .select("name, legal_name, billing_address, company_registration, vat_registration")
    .eq("id", inv.funder_id)
    .single();
  if (fErr || !funder) {
    return new Response(JSON.stringify({ error: fErr?.message ?? "funder not found" }), { status: 404 });
  }

  const pdf = renderPdf(inv as InvoiceRow, funder as FunderRow);
  const path = `funder-invoices/${inv.invoice_number}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    return new Response(JSON.stringify({ error: `upload failed: ${upErr.message}` }), { status: 500 });
  }

  const { data: updated, error: updErr } = await supabase
    .from("funder_invoices")
    .update({ pdf_storage_path: path })
    .eq("id", invoiceId)
    .select("id");
  if (updErr || !updated || updated.length !== 1) {
    return new Response(JSON.stringify({ error: `path write failed: ${updErr?.message ?? "no row"}` }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, path }), {
    headers: { "Content-Type": "application/json" },
  });
});
