// generate-invoice-pdf — renders a branded FNC → funder "TAX INVOICE" PDF and
// stores it in the private `invoices` bucket, then writes the path back onto the
// funder_invoices row. Invoked async via pg_net from issue_funder_invoice()
// (see public.invoke_generate_invoice_pdf). C1.1 / SPEC S7.
//
// Auth: validates a shared X-Webhook-Secret header (same pattern as
// send-notification-email). Deployed verify_jwt=false.
// Env: WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Rendered with pdf-lib (NOT jsPDF): jsPDF's image embedding is unreliable under
// the Deno edge runtime (the logo embedded invisibly, then crashed on raw bytes).
// pdf-lib is pure-JS and runtime-deterministic, so it embeds the JPEG logo
// identically in Node and Deno — the local rasterized render predicts production.
//
// The FNC company/banking constants below are the real business truth (owner-
// locked, INV-0031). VAT is intentionally OFF (FNC is not VAT-registered).

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { FNC_LOGO_JPEG } from "./logo.ts";

// Decode the embedded JPEG to raw bytes once, at module load.
const LOGO_BYTES: Uint8Array = Uint8Array.from(
  atob(FNC_LOGO_JPEG.split(",")[1]),
  (c) => c.charCodeAt(0),
);

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

type RGB = [number, number, number];
const NAVY: RGB = [26, 58, 82]; // #1a3a52
const TEAL: RGB = [45, 168, 184]; // #2da8b8
const INK: RGB = [30, 51, 70];
const MUTED: RGB = [138, 160, 179];
const WHITE: RGB = [255, 255, 255];
const PANEL: RGB = [245, 248, 250];
const FOOT: RGB = [200, 214, 224];
const HAIR: RGB = [225, 232, 238];
const col = (c: RGB) => rgb(c[0] / 255, c[1] / 255, c[2] / 255);

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

// Strip characters the WinAnsi standard fonts can't encode (keeps dynamic client/
// funder data from throwing at draw time).
const safe = (s: unknown): string =>
  String(s ?? "").replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, "");

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

async function renderPdf(inv: InvoiceRow, funder: FunderRow): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 pt
  const W = page.getWidth();
  const H = page.getHeight();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const fontOf = (f: string) => (f === "bold" ? bold : f === "ital" ? ital : reg);

  // top-down drawing helpers (pdf-lib origin is bottom-left → flip y)
  const text = (
    str: unknown,
    x: number,
    yTop: number,
    o: { size?: number; font?: string; color?: RGB; align?: "left" | "right" } = {},
  ) => {
    const { size = 9, font = "reg", color = INK, align = "left" } = o;
    const f = fontOf(font);
    const s = safe(str);
    const xx = align === "right" ? x - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: xx, y: H - yTop, size, font: f, color: col(color) });
  };
  const rect = (x: number, yTop: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({ x, y: H - (yTop + h), width: w, height: h, color: col(color) });
  const hline = (x1: number, yTop: number, x2: number, thickness: number, color: RGB) =>
    page.drawLine({ start: { x: x1, y: H - yTop }, end: { x: x2, y: H - yTop }, thickness, color: col(color) });
  const splitText = (str: unknown, font: string, size: number, maxW: number): string[] => {
    const f = fontOf(font);
    const words = safe(str).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(t, size) <= maxW) cur = t;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  const M = 40;
  let y = 48;

  // ---- header: logo + company block + TAX INVOICE ----
  const LOGO = 46;
  const TX = M + LOGO + 12;
  const logo = await doc.embedJpg(LOGO_BYTES);
  page.drawImage(logo, { x: M, y: H - (y - 8 + LOGO), width: LOGO, height: LOGO });
  text(FNC.name, TX, y + 4, { size: 16, font: "bold", color: NAVY });
  text(FNC.tagline, TX, y + 18, { size: 9, font: "ital", color: TEAL });
  text(FNC.address, TX, y + 32, { size: 8, color: INK });
  text(`CIPC: ${FNC.cipc}  |  Tel: ${FNC.tel}  |  Mobile: ${FNC.mobile}`, TX, y + 44, { size: 8, color: INK });
  text(`Email: ${FNC.email}  |  Web: ${FNC.web}`, TX, y + 56, { size: 8, color: INK });

  text("TAX INVOICE", W - M, y + 6, { size: 22, font: "bold", color: NAVY, align: "right" });
  const rMeta: [string, string][] = [
    ["Invoice Number", inv.invoice_number],
    ["Invoice Date", formatDate(inv.issued_date)],
    ["Payment Terms", inv.payment_terms],
  ];
  let ry = y + 24;
  for (const [k, v] of rMeta) {
    text(k, W - M - 150, ry, { size: 9, color: MUTED });
    text(String(v), W - M, ry, { size: 9, font: "bold", color: INK, align: "right" });
    ry += 14;
  }

  y += 76;
  hline(M, y, W - M, 1.5, TEAL);
  y += 22;

  // ---- INVOICE TO ----
  text("INVOICE TO", M, y, { size: 9, font: "bold", color: MUTED });
  y += 15;
  text(funder.legal_name || funder.name, M, y, { size: 11, font: "bold", color: NAVY });
  y += 14;
  if (funder.billing_address) {
    text(funder.billing_address, M, y, { size: 9, color: INK });
    y += 12;
  }
  const regBits: string[] = [];
  if (funder.company_registration) regBits.push(`Company Registration: ${funder.company_registration}`);
  if (funder.vat_registration) regBits.push(`VAT Registration: ${funder.vat_registration}`);
  if (regBits.length) {
    text(regBits.join("  |  "), M, y, { size: 9, color: INK });
    y += 12;
  }
  y += 12;

  // ---- reference row: Client (wide) / Facility / Finance charge --------------
  // The client-reference column gets more width; long client names clip/shrink so
  // they never overflow into the amount columns.
  const boxW = W - 2 * M;
  const showFinance = inv.finance_charge_amount !== null && inv.finance_charge_amount !== undefined;
  const cols: { label: string; value: string; w: number }[] = showFinance
    ? [
        { label: "CLIENT REFERENCE", value: inv.client_reference, w: boxW * 0.46 },
        { label: "FACILITY ADVANCED", value: formatR(inv.facility_advanced), w: boxW * 0.27 },
        { label: "FINANCE CHARGE", value: formatR(inv.finance_charge_amount), w: boxW * 0.27 },
      ]
    : [
        { label: "CLIENT REFERENCE", value: inv.client_reference, w: boxW * 0.6 },
        { label: "FACILITY ADVANCED", value: formatR(inv.facility_advanced), w: boxW * 0.4 },
      ];
  rect(M, y, boxW, 44, PANEL);
  let cx = M;
  for (const c of cols) {
    const innerX = cx + 10;
    const innerW = c.w - 16;
    text(c.label, innerX, y + 16, { size: 7.5, font: "bold", color: MUTED });
    let size = 10;
    let lines = splitText(c.value, "bold", size, innerW);
    if (lines.length > 1) {
      size = 8;
      lines = splitText(c.value, "bold", size, innerW);
    }
    text(lines[0], innerX, y + 30, { size, font: "bold", color: NAVY });
    if (lines[1]) text(lines[1], innerX, y + 40, { size, font: "bold", color: NAVY });
    cx += c.w;
  }
  y += 62;

  // ---- description header + line ----
  rect(M, y, boxW, 20, NAVY);
  text("DESCRIPTION", M + 10, y + 13, { size: 8.5, font: "bold", color: WHITE });
  text("AMOUNT (ZAR)", W - M - 10, y + 13, { size: 8.5, font: "bold", color: WHITE, align: "right" });
  y += 30;

  text("Lead Provider Commission", M + 10, y, { size: 9.5, font: "bold", color: NAVY });
  text(formatR(inv.commission_amount), W - M - 10, y, { size: 10, font: "bold", color: NAVY, align: "right" });
  const narr = splitText(inv.commission_description, "reg", 8.5, boxW - 130);
  let ny = y + 14;
  for (const l of narr) {
    text(l, M + 10, ny, { size: 8.5, color: INK });
    ny += 11;
  }
  y = ny + 6;

  hline(M, y, W - M, 0.75, HAIR);
  y += 22;

  // ---- total due ----
  text("TOTAL DUE", M + 10, y, { size: 12, font: "bold", color: NAVY });
  text(formatR(inv.total_amount), W - M - 10, y, { size: 15, font: "bold", color: NAVY, align: "right" });
  text("Not VAT registered", W - M - 10, y + 12, { size: 7.5, font: "ital", color: MUTED, align: "right" });
  y += 34;

  // ---- payment instructions ----
  rect(M, y, boxW, 96, PANEL);
  text("PAYMENT INSTRUCTIONS", M + 10, y + 16, { size: 8.5, font: "bold", color: MUTED });
  const pay: [string, string][] = [
    ["Account Name", FNC.bank.accountName],
    ["Bank", FNC.bank.bank],
    ["Branch", FNC.bank.branch],
    ["Branch Code", FNC.bank.branchCode],
    ["Account Number", FNC.bank.accountNumber],
    ["Reference", inv.payment_reference_expected],
  ];
  let py = y + 30;
  for (const [k, v] of pay) {
    text(k, M + 10, py, { size: 8.5, color: MUTED });
    text(v, M + 150, py, { size: 8.5, font: "bold", color: INK });
    py += 11;
  }
  y += 112;

  // ---- disclaimer ----
  const disc = splitText(
    `Note: ${FNC.vatDisclaimer} The ${formatR(inv.total_amount)} amount is the gross commission per the Lead Provider ` +
      `Agreement. For queries please contact ${FNC.ownerName} on ${FNC.mobile} or ${FNC.email}.`,
    "reg",
    7.5,
    boxW,
  );
  for (const l of disc) {
    text(l, M, y, { size: 7.5, color: MUTED });
    y += 10;
  }

  // ---- footer band ----
  rect(0, H - 46, W, 46, NAVY);
  const thanks = "Thank you for your business.";
  text(thanks, W / 2 - bold.widthOfTextAtSize(thanks, 10) / 2, H - 28, { size: 10, font: "bold", color: WHITE });
  const foot = `${FNC.name}  |  CIPC ${FNC.cipc}  |  ${FNC.web}`;
  text(foot, W / 2 - reg.widthOfTextAtSize(foot, 7.5) / 2, H - 14, { size: 7.5, color: FOOT });

  return await doc.save();
}

// Every JSON response (success and error) carries this so callers see a truthful
// content-type — plain `new Response(JSON.stringify(...))` would default to text/plain.
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Webhook-Secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let invoiceId: string | undefined;
  let returnBase64 = false;
  try {
    const reqBody = await req.json();
    invoiceId = reqBody?.invoice_id;
    // Optional: also return the rendered PDF inline (base64). Used to verify the
    // render without a storage round-trip; the C1.2 preview flow can reuse it.
    returnBase64 = reqBody?.return_base64 === true;
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
    return new Response(JSON.stringify({ error: invErr?.message ?? "invoice not found" }), { status: 404, headers: JSON_HEADERS });
  }

  const { data: funder, error: fErr } = await supabase
    .from("funders")
    .select("name, legal_name, billing_address, company_registration, vat_registration")
    .eq("id", inv.funder_id)
    .single();
  if (fErr || !funder) {
    return new Response(JSON.stringify({ error: fErr?.message ?? "funder not found" }), { status: 404, headers: JSON_HEADERS });
  }

  let pdf: Uint8Array;
  try {
    pdf = await renderPdf(inv as InvoiceRow, funder as FunderRow);
  } catch (e) {
    return new Response(JSON.stringify({ error: `render failed: ${String((e as Error)?.message ?? e)}` }), { status: 500, headers: JSON_HEADERS });
  }
  const path = `funder-invoices/${inv.invoice_number}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    return new Response(JSON.stringify({ error: `upload failed: ${upErr.message}` }), { status: 500, headers: JSON_HEADERS });
  }

  const { data: updated, error: updErr } = await supabase
    .from("funder_invoices")
    .update({ pdf_storage_path: path })
    .eq("id", invoiceId)
    .select("id");
  if (updErr || !updated || updated.length !== 1) {
    return new Response(JSON.stringify({ error: `path write failed: ${updErr?.message ?? "no row"}` }), { status: 500, headers: JSON_HEADERS });
  }

  const respBody: Record<string, unknown> = { ok: true, path };
  if (returnBase64) {
    let bin = "";
    for (let i = 0; i < pdf.length; i++) bin += String.fromCharCode(pdf[i]);
    respBody.pdf_base64 = btoa(bin);
  }
  return new Response(JSON.stringify(respBody), { headers: JSON_HEADERS });
});
