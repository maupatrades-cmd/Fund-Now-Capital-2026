// generate-contractor-invoice-pdf — renders a branded CONTRACTOR → FNC invoice
// PDF (an FNC direct contractor billing Fund Now Capital for the flat-tier
// commission FNC owes them once the funder has paid) and returns it INLINE as
// base64. Build 9 / CONTRACTOR portal + privacy rules.
//
// WHY INLINE (no storage bucket, no pdf_storage_path):
//   Unlike the funder + partner invoice PDFs (rendered async via pg_net on
//   submit and persisted to a private bucket + a pdf_storage_path column), the
//   Build 8 contractor_invoices table has NO pdf_storage_path column and no
//   render trigger. Build 9 adds no migration, so the PDF is generated ON
//   DEMAND when the contractor (or owner) clicks Download and streamed straight
//   back to the browser. Nothing is stored server-side.
//
// AUTH MODEL — caller-authenticated (mirrors admin-invite-user, NOT the
// webhook-secret pattern of the trigger-invoked PDF functions):
//   This is invoked from the CONTRACTOR'S (or owner's) BROWSER, so it must
//   authenticate the *caller*. Deployed verify_jwt=false so it can answer the
//   CORS preflight and return clean JSON errors itself. It:
//     1. reads the caller's Bearer JWT (functions.invoke attaches the session
//        token automatically),
//     2. builds a user-scoped client with that JWT — every read then runs under
//        the caller's own RLS, so the DB is the single authority on access:
//        contractor_invoices RLS returns the row only to the owner or the owning
//        contractor, and list_contractor_invoice_line_items re-checks the same.
//   No service-role key is used here — RLS + the DEFINER list RPC are the gate.
//
// S7C / privacy (ABSOLUTE): a contractor-facing artifact. It prints the
// contractor's TAKE ONLY (contractor_invoice_line_items.amount = the flat-tier
// contractor share) and neutral deal/client references. It NEVER prints FNC
// gross, company retention, the pool, the tier band, the tier %, or any funder
// name/rate (contractor tier rows carry no funder submission at all).
//
// Rendered with pdf-lib (pure-JS, runtime-deterministic under Deno — embeds the
// JPEG logo identically in Node and Deno). Mirrors generate-partner-invoice-pdf.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected).

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { FNC_LOGO_JPEG } from "./logo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Decode the embedded JPEG to raw bytes once, at module load.
const LOGO_BYTES: Uint8Array = Uint8Array.from(
  atob(FNC_LOGO_JPEG.split(",")[1]),
  (c) => c.charCodeAt(0),
);

// ---- FNC = the RECIPIENT here (the contractor invoices FNC) ------------------
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
  contractor_id: string;
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
};

async function renderPdf(inv: InvoiceRow, contractorName: string, items: LineItem[]): Promise<Uint8Array> {
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

  // ---- header: FNC logo + contractor block (FROM) + INVOICE ----
  const LOGO = 46;
  const TX = M + LOGO + 12;
  const logo = await doc.embedJpg(LOGO_BYTES);
  page.drawImage(logo, { x: M, y: H - (y - 8 + LOGO), width: LOGO, height: LOGO });
  text(contractorName, TX, y + 6, { size: 16, font: "bold", color: NAVY });
  text("Independent Contractor", TX, y + 20, { size: 9, font: "ital", color: TEAL });

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

  // ---- line items table (paginated — never overflow the page) ----
  const boxW = W - 2 * M;
  const FOOTER_H = 46;
  const CONTENT_BOTTOM = H - FOOTER_H - 14; // content must never reach the footer band

  const drawFooter = () => {
    rect(0, H - FOOTER_H, W, FOOTER_H, NAVY);
    const thanks = "Thank you.";
    text(thanks, W / 2 - bold.widthOfTextAtSize(thanks, 10) / 2, H - 28, { size: 10, font: "bold", color: WHITE });
    const foot = `${safe(contractorName)}  |  Independent Contractor  |  Invoice to ${FNC_BILL_TO.name}`;
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
    ensureRoom(40); // dealRef (12) + optional client sub (12) + neutral note (16)
    const dealRef = li.deal_reference || "Deal";
    const sub = li.client_business_name || "";
    text(ellipsize(dealRef, "bold", 9.5, descMaxW), M + 10, y, { size: 9.5, font: "bold", color: NAVY });
    text(formatR(li.amount), amtColX, y, { size: 10, font: "bold", color: NAVY, align: "right" });
    y += 12;
    if (sub) {
      text(ellipsize(sub, "reg", 8.5, descMaxW), M + 10, y, { size: 8.5, color: MUTED });
      y += 12;
    }
    text("Contractor commission per Independent Contractor Agreement", M + 10, y, { size: 7.5, font: "ital", color: MUTED });
    y += 16;
    hline(M, y - 6, W - M, 0.5, HAIR);
  }

  // ---- total due + note (kept together on one page) ----
  const note = splitText(
    "This invoice reflects contractor commission earned per the Independent Contractor Agreement. " +
      "Payment is made by EFT to the contractor's banking details on file.",
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---- authorize caller ----------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  // User-scoped client: every read below runs under the caller's RLS, so the DB
  // is the single authority on access (owner OR owning contractor).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

  let invoiceId: string | undefined;
  try {
    const body = await req.json();
    invoiceId = body?.contractor_invoice_id;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!invoiceId) return json({ error: "Missing contractor_invoice_id" }, 400);

  // RLS scopes this to the owner or the owning contractor; anyone else gets no row.
  const { data: inv, error: invErr } = await userClient
    .from("contractor_invoices")
    .select(
      "id, contractor_id, invoice_number, invoice_period_start, invoice_period_end, " +
        "total_amount, state, submitted_at, generated_at",
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return json({ error: `invoice lookup failed: ${invErr.message}` }, 500);
  if (!inv) return json({ error: "Invoice not found or not visible to you" }, 404);

  // Contractor name for the "FROM" block. profiles RLS lets the owner read any
  // profile and a contractor read their own — both callers here qualify.
  const { data: profile } = await userClient
    .from("profiles")
    .select("full_name")
    .eq("id", inv.contractor_id)
    .maybeSingle();
  const contractorName = profile?.full_name?.trim() || "Independent Contractor";

  // Enriched line items via the DEFINER RPC — it re-authorizes owner-or-owning
  // contractor and returns only the contractor take + neutral references (S7C).
  const { data: liRows, error: liErr } = await userClient.rpc("list_contractor_invoice_line_items", {
    p_invoice_id: invoiceId,
  });
  if (liErr) return json({ error: `line items failed: ${liErr.message}` }, 500);

  type RawLi = { amount: string | number; deal_reference: string | null; client_business_name: string | null };
  const items: LineItem[] = ((liRows ?? []) as RawLi[]).map((r) => ({
    amount: r.amount,
    deal_reference: r.deal_reference,
    client_business_name: r.client_business_name,
  }));

  let pdf: Uint8Array;
  try {
    pdf = await renderPdf(inv as InvoiceRow, contractorName, items);
  } catch (e) {
    return json({ error: `render failed: ${String((e as Error)?.message ?? e)}` }, 500);
  }

  // Return the PDF inline as base64 (nothing is persisted server-side).
  let bin = "";
  for (let i = 0; i < pdf.length; i++) bin += String.fromCharCode(pdf[i]);
  return json({ ok: true, invoice_number: inv.invoice_number, pdf_base64: btoa(bin) });
});
