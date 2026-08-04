// generate-partner-invoice-pdf — renders a branded PARTNER → FNC invoice PDF
// (Doctor / Bright Destiny billing Fund Now Capital for his commission) and
// stores it in the private `partner-invoices` bucket, then writes the path back
// onto the partner_invoices row. Invoked async via pg_net from the
// partner_invoice_generate_pdf trigger (on submit). C4.2 / SPEC S8 + S11 + S7C.
//
// Auth: validates a shared X-Webhook-Secret header (same pattern as
// generate-invoice-pdf / send-notification-email). Deployed verify_jwt=false.
// Env: WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Rendered with pdf-lib (NOT jsPDF) — pure-JS, runtime-deterministic under Deno,
// embeds the JPEG logo identically in Node and Deno. Mirrors generate-invoice-pdf.
//
// S7C (ABSOLUTE): this is a PARTNER-facing artifact. It shows the FICTIONAL
// funder name (funders.display_name_for_partner) and the partner's TAKE ONLY
// (partner_invoice_line_items.amount). It NEVER prints FNC gross, company
// retention, the partner pool, the tier band, the tier %, or the funder's rate.
// The line description is the neutral "Referral partner commission per Referral
// Agreement" — no tier math on the PDF.

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BD_LOGO_JPEG } from "./logo.ts";

// Decode the embedded JPEG to raw bytes once, at module load.
const LOGO_BYTES: Uint8Array = Uint8Array.from(
  atob(BD_LOGO_JPEG.split(",")[1]),
  (c) => c.charCodeAt(0),
);

// ---- FNC = the RECIPIENT here (partner invoices FNC) --------------------------
const FNC_BILL_TO = {
  name: "Fund Now Capital (Pty) Ltd",
  address: "Cedarwood House, 128 Ballyclare Drive, Bryanston, Sandton, 2191",
  cipc: "2026/066284/07",
  email: "thapelol@fundnowcapital.africa",
};

type RGB = [number, number, number];
const NAVY: RGB = [26, 58, 82]; // #1a3a52
const TEAL: RGB = [45, 168, 184]; // #2da8b8
const INK: RGB = [30, 51, 70];
const MUTED: RGB = [138, 160, 179];
const WHITE: RGB = [255, 255, 255];
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

// Strip characters the WinAnsi standard fonts can't encode.
const safe = (s: unknown): string =>
  String(s ?? "").replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, "");

type InvoiceRow = {
  id: string;
  referral_partner_id: string;
  invoice_number: string;
  invoice_period_start: string;
  invoice_period_end: string;
  total_amount: string | number;
  state: string;
  submitted_at: string | null;
  generated_at: string;
};

type LineItem = {
  amount: string | number;
  deal_reference: string | null;
  client_business_name: string | null;
  funder_display_name: string | null; // FICTIONAL (S7C)
};

async function renderPdf(inv: InvoiceRow, partnerName: string, items: LineItem[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const A4: [number, number] = [595.28, 841.89]; // A4 pt
  let page = doc.addPage(A4); // reassigned when content paginates onto a new page
  const W = page.getWidth();
  const H = page.getHeight();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const fontOf = (f: string) => (f === "bold" ? bold : f === "ital" ? ital : reg);

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
  const ellipsize = (str: string, font: string, size: number, maxW: number): string => {
    const f = fontOf(font);
    let s = safe(str);
    if (f.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length > 1 && f.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
    return s + "…";
  };

  const M = 40;
  let y = 48;

  // ---- header: BD logo + partner block (FROM) + INVOICE ----
  const LOGO = 46;
  const TX = M + LOGO + 12;
  const logo = await doc.embedJpg(LOGO_BYTES);
  page.drawImage(logo, { x: M, y: H - (y - 8 + LOGO), width: LOGO, height: LOGO });
  text(partnerName, TX, y + 6, { size: 16, font: "bold", color: NAVY });
  text("Referral Partner", TX, y + 20, { size: 9, font: "ital", color: TEAL });

  text("INVOICE", W - M, y + 6, { size: 22, font: "bold", color: NAVY, align: "right" });
  const rMeta: [string, string][] = [
    ["Invoice Number", inv.invoice_number],
    ["Invoice Date", formatDate(inv.submitted_at ?? inv.generated_at)],
    ["Period", `${formatDate(inv.invoice_period_start)} – ${formatDate(inv.invoice_period_end)}`],
  ];
  let ry = y + 24;
  for (const [k, v] of rMeta) {
    text(k, W - M - 220, ry, { size: 9, color: MUTED });
    text(String(v), W - M, ry, { size: 9, font: "bold", color: INK, align: "right" });
    ry += 14;
  }

  y += 70;
  hline(M, y, W - M, 1.5, TEAL);
  y += 22;

  // ---- INVOICE TO (FNC) ----
  text("INVOICE TO", M, y, { size: 9, font: "bold", color: MUTED });
  y += 15;
  text(FNC_BILL_TO.name, M, y, { size: 11, font: "bold", color: NAVY });
  y += 14;
  text(FNC_BILL_TO.address, M, y, { size: 9, color: INK });
  y += 12;
  text(`Company Registration: ${FNC_BILL_TO.cipc}`, M, y, { size: 9, color: INK });
  y += 24;

  // ---- line items table (paginated — Macroscope: never overflow the page) ----
  const boxW = W - 2 * M;
  const FOOTER_H = 46;
  const CONTENT_BOTTOM = H - FOOTER_H - 14; // content must never reach the footer band

  const drawFooter = () => {
    rect(0, H - FOOTER_H, W, FOOTER_H, NAVY);
    const thanks = "Thank you.";
    text(thanks, W / 2 - bold.widthOfTextAtSize(thanks, 10) / 2, H - 28, { size: 10, font: "bold", color: WHITE });
    const foot = `${safe(partnerName)}  |  Referral Partner  |  Invoice to ${FNC_BILL_TO.name}`;
    text(foot, W / 2 - reg.widthOfTextAtSize(safe(foot), 7.5) / 2, H - 14, { size: 7.5, color: FOOT });
  };
  const drawTableHeader = () => {
    rect(M, y, boxW, 20, NAVY);
    text("DESCRIPTION", M + 10, y + 13, { size: 8.5, font: "bold", color: WHITE });
    text("AMOUNT (ZAR)", W - M - 10, y + 13, { size: 8.5, font: "bold", color: WHITE, align: "right" });
    y += 28;
  };
  // When the next block wouldn't fit above the footer, finalize the current page
  // (draw its footer) and start a fresh one with a "continued" line + table header.
  const newContentPage = () => {
    drawFooter();
    page = doc.addPage(A4);
    y = 48;
    text(`Invoice ${inv.invoice_number} — continued`, M, y, { size: 9, font: "ital", color: MUTED });
    y += 18;
    drawTableHeader();
  };
  const ensureRoom = (needed: number) => {
    if (y + needed > CONTENT_BOTTOM) newContentPage();
  };

  drawTableHeader();

  const amtColX = W - M - 10;
  const descMaxW = boxW - 150;
  for (const li of items) {
    ensureRoom(40); // dealRef (12) + optional sub (12) + neutral note (16)
    const dealRef = li.deal_reference || "Deal";
    const sub = [li.client_business_name, li.funder_display_name].filter(Boolean).join("  ·  ");
    text(ellipsize(dealRef, "bold", 9.5, descMaxW), M + 10, y, { size: 9.5, font: "bold", color: NAVY });
    text(formatR(li.amount), amtColX, y, { size: 10, font: "bold", color: NAVY, align: "right" });
    y += 12;
    if (sub) {
      text(ellipsize(sub, "reg", 8.5, descMaxW), M + 10, y, { size: 8.5, color: MUTED });
      y += 12;
    }
    text("Referral partner commission per Referral Agreement", M + 10, y, { size: 7.5, font: "ital", color: MUTED });
    y += 16;
    hline(M, y - 6, W - M, 0.5, HAIR);
  }

  // ---- total due + note (kept together on one page) ----
  const note = splitText(
    "This invoice reflects referral commission earned per the Referral Agreement. " +
      "Payment is made by EFT to the referral partner's banking details on file.",
    "reg",
    7.5,
    boxW,
  );
  ensureRoom(10 + 34 + note.length * 10 + 6);
  y += 10;
  text("TOTAL DUE", M + 10, y, { size: 12, font: "bold", color: NAVY });
  text(formatR(inv.total_amount), W - M - 10, y, { size: 15, font: "bold", color: NAVY, align: "right" });
  y += 34;
  for (const l of note) {
    text(l, M, y, { size: 7.5, color: MUTED });
    y += 10;
  }

  // Footer on the final page.
  drawFooter();

  return await doc.save();
}

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
    invoiceId = reqBody?.partner_invoice_id;
    returnBase64 = reqBody?.return_base64 === true;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!invoiceId) return new Response("Missing partner_invoice_id", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inv, error: invErr } = await supabase
    .from("partner_invoices")
    .select(
      "id, referral_partner_id, invoice_number, invoice_period_start, invoice_period_end, " +
        "total_amount, state, submitted_at, generated_at",
    )
    .eq("id", invoiceId)
    .single();
  if (invErr || !inv) {
    return new Response(JSON.stringify({ error: invErr?.message ?? "invoice not found" }), { status: 404, headers: JSON_HEADERS });
  }

  const { data: partner } = await supabase
    .from("referral_partners")
    .select("name")
    .eq("id", inv.referral_partner_id)
    .single();
  const partnerName = partner?.name ?? "Referral Partner";

  // Line items: partner take + client + FICTIONAL funder name (S7C). Service role
  // bypasses RLS, so the anonymisation is explicit — select display_name_for_partner,
  // NEVER funders.name.
  const { data: liRows, error: liErr } = await supabase
    .from("partner_invoice_line_items")
    .select(
      "amount, deal:deals!left(reference, client:clients!left(business_name)), " +
        "commission:commission_records!left(submission:deal_funder_submissions!left(" +
        "funder:funders!left(display_name_for_partner)))",
    )
    .eq("invoice_id", invoiceId)
    .order("added_at", { ascending: true });
  if (liErr) {
    return new Response(JSON.stringify({ error: `line items failed: ${liErr.message}` }), { status: 500, headers: JSON_HEADERS });
  }

  type RawLi = {
    amount: string | number;
    deal?: { reference?: string | null; client?: { business_name?: string | null } | null } | null;
    commission?: { submission?: { funder?: { display_name_for_partner?: string | null } | null } | null } | null;
  };
  const items: LineItem[] = (liRows ?? []).map((r: RawLi) => ({
    amount: r.amount,
    deal_reference: r.deal?.reference ?? null,
    client_business_name: r.deal?.client?.business_name ?? null,
    funder_display_name: r.commission?.submission?.funder?.display_name_for_partner ?? null,
  }));

  let pdf: Uint8Array;
  try {
    pdf = await renderPdf(inv as InvoiceRow, partnerName, items);
  } catch (e) {
    return new Response(JSON.stringify({ error: `render failed: ${String((e as Error)?.message ?? e)}` }), { status: 500, headers: JSON_HEADERS });
  }

  // Path embeds the partner id so the partner-read RLS ({partner_id}/…) resolves.
  const path = `${inv.referral_partner_id}/${inv.invoice_number}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("partner-invoices")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    return new Response(JSON.stringify({ error: `upload failed: ${upErr.message}` }), { status: 500, headers: JSON_HEADERS });
  }

  const { data: updated, error: updErr } = await supabase
    .from("partner_invoices")
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
