import { Fragment, type ReactNode } from "react";

/*
 * Tiny, dependency-free markdown renderer for the Terms & Conditions content.
 *
 * Deliberately NOT a full markdown library: the T&C content is authored by the
 * owner and uses a small, known subset (headings, paragraphs, bold, italic,
 * bullet lists). Adding react-markdown + its transitive deps during a parallel
 * sprint isn't worth it for one document (same reasoning as REPORTS-V1 declining
 * recharts). It is also XSS-safe by construction: we only ever emit React text
 * nodes and a fixed set of elements — raw HTML in the source is rendered as
 * literal text, never injected.
 *
 * Supported: `#`/`##`/`###` headings, `- ` bullet lists, blank-line-separated
 * paragraphs, `**bold**`, `_italic_`. Anything else renders as plain text.
 */

// Inline: split a line into **bold** / _italic_ / plain text spans.
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Match **bold** or _italic_ (non-greedy).
  const re = /(\*\*([^*]+)\*\*|_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    if (m[2] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(<em key={`${keyBase}-i${i}`}>{m[3]}</em>);
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last)}</Fragment>);
  return nodes;
}

export function TermsMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    blocks.push(
      <p key={`p${key++}`} className="text-sm leading-relaxed text-slate-700">
        {renderInline(text, `p${key}`)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul${key++}`} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
        {list.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li${key}-${idx}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(<h3 key={`h${key++}`} className="mt-4 text-sm font-semibold text-brand-navy">{renderInline(line.slice(4), `h${key}`)}</h3>);
    } else if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(<h2 key={`h${key++}`} className="mt-5 text-base font-semibold text-brand-navy">{renderInline(line.slice(3), `h${key}`)}</h2>);
    } else if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push(<h1 key={`h${key++}`} className="text-lg font-bold text-brand-navy">{renderInline(line.slice(2), `h${key}`)}</h1>);
    } else if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();

  return <div className="space-y-3">{blocks}</div>;
}
