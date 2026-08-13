// generate-legal-document-pdf — deterministic A4 renderer for FNC legal documents
// (spec PR 6, §8.4). Renders an agreement instance (or a bare template version for
// preview) to a multi-page branded PDF: running header + footer with Page X of Y,
// a title block, a frozen-party table, the template body (markdown headings /
// paragraphs / bullets), the mandate fee summary, signature blocks kept whole, and
// — for an executed document — an execution-certificate page. Returns the SHA-256
// of the rendered bytes; optionally stores to a private legal-* bucket.
//
// MACHINERY ONLY (spec §3.2): it renders whatever content_markdown the template
// version carries. Real clause wording arrives when the approved PDFs are ingested;
// this layout engine renders placeholder or owner-supplied content identically.
//
// Deterministic: pdf-lib is pure-JS + runtime-deterministic, and we pin the PDF
// metadata dates/producer to a STABLE value derived from the input, so the same
// input renders byte-identical output (and thus a stable hash) on every run.
//
// Auth: shared X-Webhook-Secret header (same pattern as generate-invoice-pdf).
// Deployed verify_jwt=false. Env: WEBHOOK_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
//
// Rendered with pdf-lib (NOT jsPDF) — jsPDF's image embedding is unreliable under
// the Deno edge runtime (see generate-invoice-pdf).

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, PDFImage } from "pdf-lib";
import { FNC_LOGO_JPEG } from "./logo.ts";

const LOGO_BYTES: Uint8Array = Uint8Array.from(
  atob(FNC_LOGO_JPEG.split(",")[1]),
  (c) => c.charCodeAt(0),
);

const FNC = {
  name: "Fund Now Capital (Pty) Ltd",
  tagline: "Many funders. More approvals.",
  cipc: "2026/066284/07",
  web: "www.fundnowcapital.africa",
  confidentiality: "CONFIDENTIAL",
};

type RGB = [number, number, number];
const NAVY: RGB = [26, 58, 82];
const TEAL: RGB = [45, 168, 184];
const GREEN: RGB = [93, 186, 93];
const INK: RGB = [30, 51, 70];
const MUTED: RGB = [138, 160, 179];
const WHITE: RGB = [255, 255, 255];
const PANEL: RGB = [245, 248, 250];
const HAIR: RGB = [225, 232, 238];
const col = (c: RGB) => rgb(c[0] / 255, c[1] / 255, c[2] / 255);

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 56; // ~20mm margins
const HEADER_BOTTOM = 96; // content starts below the running header
const FOOTER_TOP = PAGE_H - 64; // content must stop above the running footer

// Helvetica/WinAnsi can only encode ASCII + Latin-1 + a few typographic marks.
// Any glyph outside that set (e.g. Š, Ž, non-Latin scripts, €) cannot be drawn —
// substitute a VISIBLE "?" marker rather than silently deleting it, so an altered
// legal name is never invisible on a binding document.
const safe = (s: unknown): string =>
  String(s ?? "").replace(
    /[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…]/g,
    "?",
  );

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

type Party = {
  party_role: string;
  party_order: number;
  legal_name: string;
  represented_party: string | null;
  capacity: string | null;
  email: string | null;
  is_fnc: boolean;
};

type RenderInput = {
  reference: string;
  title: string;
  documentType: string;
  legalEntity: string;
  jurisdiction: string;
  templateVersion: string;
  effectiveDate: string | null;
  contentMarkdown: string;
  parties: Party[];
  feeSummary: Record<string, unknown> | null;
  mode: "preview" | "executed";
  // executed-only evidence
  executedSha256: string | null;
  unsignedSha256: string | null;
  certificateReference: string | null;
  executedAt: string | null;
  stableDate: Date;
};

// Mutable render cursor across pages.
type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number; // top-down cursor (distance from top)
  reg: PDFFont;
  bold: PDFFont;
  ital: PDFFont;
  logo: PDFImage; // embedded ONCE in renderPdf and reused on every page
  input: RenderInput;
};

function fontOf(ctx: Ctx, f: "reg" | "bold" | "ital"): PDFFont {
  return f === "bold" ? ctx.bold : f === "ital" ? ctx.ital : ctx.reg;
}

function drawText(
  ctx: Ctx,
  str: unknown,
  x: number,
  yTop: number,
  o: { size?: number; font?: "reg" | "bold" | "ital"; color?: RGB; align?: "left" | "right" | "center" } = {},
) {
  const { size = 10, font = "reg", color = INK, align = "left" } = o;
  const f = fontOf(ctx, font);
  const s = safe(str);
  const w = f.widthOfTextAtSize(s, size);
  const xx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  ctx.page.drawText(s, { x: xx, y: PAGE_H - yTop, size, font: f, color: col(color) });
}

function rect(ctx: Ctx, x: number, yTop: number, w: number, h: number, color: RGB) {
  ctx.page.drawRectangle({ x, y: PAGE_H - (yTop + h), width: w, height: h, color: col(color) });
}

function hline(ctx: Ctx, x1: number, yTop: number, x2: number, thickness: number, color: RGB) {
  ctx.page.drawLine({ start: { x: x1, y: PAGE_H - yTop }, end: { x: x2, y: PAGE_H - yTop }, thickness, color: col(color) });
}

function splitText(ctx: Ctx, str: unknown, font: "reg" | "bold" | "ital", size: number, maxW: number): string[] {
  const f = fontOf(ctx, font);
  const lines: string[] = [];
  for (const rawLine of safe(str).split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(t, size) <= maxW) cur = t;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [""];
}

async function drawRunningHeader(ctx: Ctx) {
  // Reuse the single embedded logo handle (embedded once in renderPdf). pdf-lib
  // does not de-duplicate images, so re-embedding per page bloats the PDF.
  const LZ = 30;
  ctx.page.drawImage(ctx.logo, { x: M, y: PAGE_H - (44 + LZ - 8), width: LZ, height: LZ });
  drawText(ctx, FNC.name, M + LZ + 8, 52, { size: 10, font: "bold", color: NAVY });
  drawText(ctx, `CIPC ${FNC.cipc}`, M + LZ + 8, 64, { size: 7, color: MUTED });
  drawText(ctx, ctx.input.reference, PAGE_W - M, 52, { size: 9, font: "bold", color: NAVY, align: "right" });
  drawText(ctx, ctx.input.documentType.replace(/_/g, " "), PAGE_W - M, 64, { size: 7, color: MUTED, align: "right" });
  hline(ctx, M, 78, PAGE_W - M, 1, TEAL);
}

async function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  await drawRunningHeader(ctx);
  ctx.y = HEADER_BOTTOM;
}

async function ensureSpace(ctx: Ctx, h: number) {
  if (ctx.y + h > FOOTER_TOP) await newPage(ctx);
}

const CONTENT_W = PAGE_W - 2 * M;

async function drawHeading(ctx: Ctx, text: string, level: number) {
  const size = level <= 1 ? 15 : level === 2 ? 12 : 10.5;
  await ensureSpace(ctx, size + 14);
  ctx.y += level <= 1 ? 10 : 8;
  const lines = splitText(ctx, text, "bold", size, CONTENT_W);
  for (const l of lines) {
    await ensureSpace(ctx, size + 6);
    drawText(ctx, l, M, ctx.y + size, { size, font: "bold", color: NAVY });
    ctx.y += size + 4;
  }
  ctx.y += 4;
}

async function drawParagraph(ctx: Ctx, text: string, opts: { bullet?: boolean } = {}) {
  const size = 9.5;
  const lead = 13;
  const indent = opts.bullet ? 14 : 0;
  const lines = splitText(ctx, text, "reg", size, CONTENT_W - indent);
  for (let i = 0; i < lines.length; i++) {
    await ensureSpace(ctx, lead);
    if (opts.bullet && i === 0) drawText(ctx, "•", M, ctx.y + size, { size, color: TEAL });
    drawText(ctx, lines[i], M + indent, ctx.y + size, { size, color: INK });
    ctx.y += lead;
  }
  ctx.y += 4;
}

// Render a simple markdown subset: # / ## / ### headings, - / * bullets, blank-line
// separated paragraphs. (Pipe-table + rich formatting support is a follow-up; the
// approved-PDF ingestion supplies structured schedules later.)
async function drawBody(ctx: Ctx, md: string) {
  const rawLines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = async () => {
    if (para.length) { await drawParagraph(ctx, para.join(" ")); para = []; }
  };
  for (const line of rawLines) {
    const t = line.trim();
    if (t === "") { await flush(); continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) { await flush(); await drawHeading(ctx, h[2], h[1].length); continue; }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b) { await flush(); await drawParagraph(ctx, b[1], { bullet: true }); continue; }
    para.push(t);
  }
  await flush();
}

async function drawPartyTable(ctx: Ctx, parties: Party[]) {
  if (!parties.length) return;
  await drawHeading(ctx, "Parties", 2);
  const rowH = 30;
  for (const p of [...parties].sort((a, b) => a.party_order - b.party_order)) {
    await ensureSpace(ctx, rowH + 4);
    rect(ctx, M, ctx.y, CONTENT_W, rowH, ctx.input.mode === "preview" ? PANEL : WHITE);
    hline(ctx, M, ctx.y + rowH, PAGE_W - M, 0.5, HAIR);
    const roleLabel = p.is_fnc ? "FNC (countersignatory)" : p.party_role.replace(/_/g, " ");
    drawText(ctx, roleLabel.toUpperCase(), M + 8, ctx.y + 12, { size: 7, font: "bold", color: MUTED });
    drawText(ctx, p.legal_name, M + 8, ctx.y + 24, { size: 10, font: "bold", color: NAVY });
    const rightBits = [p.capacity, p.represented_party].filter(Boolean).join(" · ");
    if (rightBits) drawText(ctx, rightBits, PAGE_W - M - 8, ctx.y + 24, { size: 8.5, color: INK, align: "right" });
    ctx.y += rowH;
  }
  ctx.y += 8;
}

async function drawFeeSummary(ctx: Ctx, fee: Record<string, unknown> | null) {
  if (!fee || fee["configured"] === false) return;
  await drawHeading(ctx, "Success fee summary", 2);
  const plain = typeof fee["plain_language"] === "string" ? (fee["plain_language"] as string) : null;
  if (plain) await drawParagraph(ctx, plain);
  const ex = fee["illustrative_example"] as Record<string, unknown> | null;
  if (ex && ex["note"]) {
    await ensureSpace(ctx, 30);
    rect(ctx, M, ctx.y, CONTENT_W, 24, PANEL);
    drawText(ctx, "ILLUSTRATIVE ONLY", M + 8, ctx.y + 10, { size: 7, font: "bold", color: TEAL });
    drawText(ctx, String(ex["note"]), M + 8, ctx.y + 20, { size: 8, color: INK });
    ctx.y += 32;
  }
}

async function drawSignatureBlocks(ctx: Ctx, parties: Party[]) {
  await drawHeading(ctx, "Signatures", 2);
  const blockH = 78;
  for (const p of [...parties].sort((a, b) => a.party_order - b.party_order)) {
    // Keep each signature block whole on one page (§8.4).
    await ensureSpace(ctx, blockH);
    const label = p.is_fnc ? "For Fund Now Capital (Pty) Ltd" : "Signatory";
    drawText(ctx, label, M, ctx.y + 10, { size: 8, font: "bold", color: MUTED });
    ctx.y += 34;
    hline(ctx, M, ctx.y, M + 220, 0.75, INK);
    hline(ctx, PAGE_W - M - 150, ctx.y, PAGE_W - M, 0.75, INK);
    drawText(ctx, "Signature", M, ctx.y + 12, { size: 7.5, color: MUTED });
    drawText(ctx, "Date", PAGE_W - M - 150, ctx.y + 12, { size: 7.5, color: MUTED });
    ctx.y += 22;
    drawText(ctx, p.legal_name, M, ctx.y + 10, { size: 9.5, font: "bold", color: NAVY });
    const cap = [p.capacity, p.represented_party].filter(Boolean).join(", ");
    if (cap) drawText(ctx, cap, M, ctx.y + 22, { size: 8, color: INK });
    ctx.y += blockH - 34 - 22 + 18;
  }
}

async function drawCertificatePage(ctx: Ctx) {
  await newPage(ctx);
  await drawHeading(ctx, "Execution Certificate", 1);
  await drawParagraph(
    ctx,
    "This certificate accompanies the executed agreement and records its integrity and execution evidence. " +
      "Network and identity details are retained privately in the platform's evidence record.",
  );
  const rows: [string, string][] = [
    ["Document reference", ctx.input.reference],
    ["Certificate reference", ctx.input.certificateReference || "—"],
    ["Template version", ctx.input.templateVersion],
    ["Executed at", formatDate(ctx.input.executedAt)],
    ["Unsigned SHA-256", ctx.input.unsignedSha256 || "—"],
    ["Executed SHA-256", ctx.input.executedSha256 || "—"],
  ];
  for (const [k, v] of rows) {
    await ensureSpace(ctx, 22);
    drawText(ctx, k, M, ctx.y + 12, { size: 8.5, color: MUTED });
    const lines = splitText(ctx, v, "bold", 8.5, CONTENT_W - 160);
    drawText(ctx, lines[0], M + 160, ctx.y + 12, { size: 8.5, font: "bold", color: INK });
    ctx.y += 18;
    for (let i = 1; i < lines.length; i++) { await ensureSpace(ctx, 14); drawText(ctx, lines[i], M + 160, ctx.y + 10, { size: 8.5, font: "bold", color: INK }); ctx.y += 14; }
    ctx.y += 2;
  }
  ctx.y += 6;
  await drawHeading(ctx, "Parties & methods", 3);
  await drawPartyTable(ctx, ctx.input.parties);
}

function drawFooters(doc: PDFDocument, reg: PDFFont, input: RenderInput) {
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    const foot = `${FNC.confidentiality}  ·  ${input.reference}  ·  v${input.templateVersion}`;
    page.drawLine({ start: { x: M, y: PAGE_H - (FOOTER_TOP + 6) }, end: { x: PAGE_W - M, y: PAGE_H - (FOOTER_TOP + 6) }, thickness: 0.5, color: col(HAIR) });
    page.drawText(safe(foot), { x: M, y: PAGE_H - (FOOTER_TOP + 20), size: 7, font: reg, color: col(MUTED) });
    const pageStr = `Page ${i + 1} of ${total}`;
    const w = reg.widthOfTextAtSize(pageStr, 7);
    page.drawText(pageStr, { x: PAGE_W - M - w, y: PAGE_H - (FOOTER_TOP + 20), size: 7, font: reg, color: col(MUTED) });
  });
}

async function renderPdf(input: RenderInput): Promise<{ bytes: Uint8Array; sha256: string; pages: number }> {
  const doc = await PDFDocument.create();
  // Determinism: pin metadata to a stable date + fixed producer/creator so the same
  // input renders byte-identical output.
  doc.setCreationDate(input.stableDate);
  doc.setModificationDate(input.stableDate);
  doc.setProducer("Fund Now Capital CRM");
  doc.setCreator("generate-legal-document-pdf");
  doc.setTitle(`${input.title} (${input.reference})`);

  const ctx: Ctx = {
    doc,
    page: null as unknown as PDFPage,
    y: HEADER_BOTTOM,
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    ital: await doc.embedFont(StandardFonts.HelveticaOblique),
    logo: await doc.embedJpg(LOGO_BYTES), // embed once; reused on every page
    input,
  };
  await newPage(ctx);

  // Preview banner (§8.4: preview is visibly not-for-signature).
  if (input.mode === "preview") {
    rect(ctx, M, ctx.y, CONTENT_W, 22, GREEN);
    drawText(ctx, "PREVIEW — NOT FOR SIGNATURE", PAGE_W / 2, ctx.y + 15, { size: 10, font: "bold", color: WHITE, align: "center" });
    ctx.y += 34;
  }

  // Title block.
  await ensureSpace(ctx, 60);
  drawText(ctx, input.title, M, ctx.y + 18, { size: 18, font: "bold", color: NAVY });
  ctx.y += 26;
  drawText(ctx, `${input.legalEntity}  ·  ${input.jurisdiction}  ·  Effective ${formatDate(input.effectiveDate)}`, M, ctx.y + 10, { size: 8.5, color: MUTED });
  ctx.y += 22;
  hline(ctx, M, ctx.y, PAGE_W - M, 0.75, HAIR);
  ctx.y += 14;

  await drawPartyTable(ctx, input.parties);
  await drawBody(ctx, input.contentMarkdown || "_No content has been attached to this template version yet._");
  await drawFeeSummary(ctx, input.feeSummary);
  await drawSignatureBlocks(ctx, input.parties);
  if (input.mode === "executed") await drawCertificatePage(ctx);

  drawFooters(doc, ctx.reg, input);

  const bytes = await doc.save();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { bytes, sha256, pages: doc.getPages().length };
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;
const err = (msg: string, status: number) => new Response(JSON.stringify({ error: msg }), { status, headers: JSON_HEADERS });

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Webhook-Secret") !== secret) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err("bad request", 400); }
  const agreementId = typeof body.agreement_id === "string" ? body.agreement_id : null;
  const templateVersionId = typeof body.template_version_id === "string" ? body.template_version_id : null;
  const reqMode = body.mode === "executed" ? "executed" : "preview";
  const store = body.store === true;
  const returnBase64 = body.return_base64 !== false; // default true
  if (!agreementId && !templateVersionId) return err("agreement_id or template_version_id required", 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let input: RenderInput;
  try {
    if (agreementId) {
      const { data: ai, error: aiErr } = await supabase
        .from("agreement_instances")
        .select("reference, document_type, title_snapshot, state, template_version_id, unsigned_sha256, executed_sha256, executed_at, created_at, frozen_at")
        .eq("id", agreementId).single();
      if (aiErr || !ai) return err(aiErr?.message ?? "agreement not found", 404);

      const { data: tv } = await supabase.from("legal_document_template_versions")
        .select("version, effective_date, content_markdown, template_id").eq("id", ai.template_version_id).single();
      const { data: tpl } = tv ? await supabase.from("legal_document_templates")
        .select("title, legal_entity, jurisdiction").eq("id", tv.template_id).single() : { data: null };
      const { data: parties } = await supabase.from("agreement_party_snapshots")
        .select("party_role, party_order, legal_name, represented_party, capacity, email, is_fnc").eq("agreement_id", agreementId);
      const { data: vars } = await supabase.from("agreement_variable_snapshots").select("fee_summary").eq("agreement_id", agreementId).maybeSingle();
      const { data: exec } = await supabase.from("executed_document_artifacts").select("certificate_reference, executed_pdf_sha256, executed_at, unsigned_sha256").eq("agreement_id", agreementId).maybeSingle();

      const isExecuted = ai.state === "executed";
      const mode = reqMode === "executed" && isExecuted ? "executed" : "preview";
      input = {
        reference: ai.reference,
        title: ai.title_snapshot,
        documentType: ai.document_type,
        legalEntity: tpl?.legal_entity ?? FNC.name,
        jurisdiction: tpl?.jurisdiction ?? "ZA",
        templateVersion: tv?.version ?? "—",
        effectiveDate: tv?.effective_date ?? null,
        contentMarkdown: tv?.content_markdown ?? "",
        parties: (parties as Party[]) ?? [],
        feeSummary: (vars?.fee_summary as Record<string, unknown>) ?? null,
        mode,
        executedSha256: exec?.executed_pdf_sha256 ?? ai.executed_sha256 ?? null,
        unsignedSha256: exec?.unsigned_sha256 ?? ai.unsigned_sha256 ?? null,
        certificateReference: exec?.certificate_reference ?? null,
        executedAt: exec?.executed_at ?? ai.executed_at ?? null,
        stableDate: new Date((ai.frozen_at ?? ai.created_at ?? "2026-01-01T00:00:00Z")),
      };
    } else {
      const { data: tv, error: tvErr } = await supabase.from("legal_document_template_versions")
        .select("version, effective_date, content_markdown, template_id").eq("id", templateVersionId).single();
      if (tvErr || !tv) return err(tvErr?.message ?? "template version not found", 404);
      const { data: tpl } = await supabase.from("legal_document_templates")
        .select("title, legal_entity, jurisdiction, document_type").eq("id", tv.template_id).single();
      input = {
        reference: "PREVIEW",
        title: tpl?.title ?? "Legal document",
        documentType: tpl?.document_type ?? "agreement",
        legalEntity: tpl?.legal_entity ?? FNC.name,
        jurisdiction: tpl?.jurisdiction ?? "ZA",
        templateVersion: tv.version,
        effectiveDate: tv.effective_date,
        contentMarkdown: tv.content_markdown ?? "",
        parties: [],
        feeSummary: null,
        mode: "preview",
        executedSha256: null, unsignedSha256: null, certificateReference: null, executedAt: null,
        stableDate: new Date(tv.effective_date ?? "2026-01-01T00:00:00Z"),
      };
    }
  } catch (e) {
    return err(`load failed: ${String((e as Error)?.message ?? e)}`, 500);
  }

  let rendered: { bytes: Uint8Array; sha256: string; pages: number };
  try { rendered = await renderPdf(input); } catch (e) { return err(`render failed: ${String((e as Error)?.message ?? e)}`, 500); }

  const resp: Record<string, unknown> = { ok: true, mode: input.mode, sha256: rendered.sha256, pages: rendered.pages };

  if (store) {
    const bucket = input.mode === "executed" ? "legal-executed" : "legal-generated-drafts";
    const path = `${input.mode === "executed" ? "executed" : "preview"}/${input.reference}-${rendered.sha256.slice(0, 12)}.pdf`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, rendered.bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return err(`upload failed: ${upErr.message}`, 500);
    resp.bucket = bucket;
    resp.path = path;
  }
  if (returnBase64) {
    let bin = "";
    for (let i = 0; i < rendered.bytes.length; i++) bin += String.fromCharCode(rendered.bytes[i]);
    resp.pdf_base64 = btoa(bin);
  }
  return new Response(JSON.stringify(resp), { headers: JSON_HEADERS });
});
