// PDF report for people (H-001). Built in the browser with jsPDF, which is
// loaded only when someone asks for a PDF, together with the embedded Plus
// Jakarta Sans font (the site font). Always light, A4, real selectable text.
//
// Layout rule: every row (a signal, a citation, a recommendation card) is
// measured before it is drawn and moved whole to the next page if it would
// not fit, so nothing is split across pages.
import type { ExportReport, ExportRec, ExportSignal } from "./exportReport";
import { citationsSummary, formatUtc } from "./exportReport";
import type { ReportSignalStatus } from "./reportModel";

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  ink: [20, 20, 20],
  soft: [85, 88, 90],
  muted: [107, 110, 112],
  accent: [105, 112, 117],
  line: [214, 214, 212],
  surface: [244, 244, 243],
  panel: [20, 20, 20],
  panelFg: [244, 244, 243],
  white: [255, 255, 255],
};

const PAGE_W = 210;
const PAGE_H = 297;
const M = 18; // side margin
const TOP = 22; // first line under the running header
const BOTTOM = PAGE_H - 18; // last usable line above the footer
const W = PAGE_W - M * 2;
const PT = 0.3528; // mm per point
const LH = 1.4; // line height factor

export interface PdfOptions {
  /** Embedded TTF data (base64). Omit to use the built-in Helvetica. */
  fonts?: { regular: string; bold: string } | null;
}

export async function renderPdf(data: ExportReport, options: PdfOptions = {}): Promise<any> {
  const jspdfModule: any = await import("jspdf");
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default;
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  let family = "helvetica";
  if (options.fonts) {
    try {
      doc.addFileToVFS("PlusJakartaSans-Regular.ttf", options.fonts.regular);
      doc.addFont("PlusJakartaSans-Regular.ttf", "Jakarta", "normal");
      doc.addFileToVFS("PlusJakartaSans-Bold.ttf", options.fonts.bold);
      doc.addFont("PlusJakartaSans-Bold.ttf", "Jakarta", "bold");
      doc.setFont("Jakarta", "normal");
      family = "Jakarta";
    } catch {
      family = "helvetica";
    }
  }
  // Built-in fonts only cover WinAnsi; the embedded font covers Latin scripts.
  // Characters outside that would print as garbage, so they become "?". The
  // Markdown download always keeps the exact text.
  const clean = (text: string, mono = false) => {
    const t = String(text ?? "")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, "...")
      // U+2212 MINUS SIGN is in neither font, so "(−1)" printed as "(?1)" (REG-23).
      .replace(/\u2212/g, "-")
      .replace(/ /g, " ")
      .replace(/\t/g, "  ");
    const allowed = mono || family === "helvetica" ? /[^\n\x20-\x7E -ÿ–—•]/g : /[^\n\x20-\x7E -ɏ‐-‧←-↓]/g;
    return t.replace(allowed, "?");
  };

  doc.setProperties({
    title: `Lensy AI readiness report: ${data.hostname}`,
    subject: data.url,
    creator: "Lensy by Perseverance AI",
    author: "Lensy",
  });

  let y = TOP;
  const font = (size: number, weight: "normal" | "bold" = "normal", color: RGB = C.ink, mono = false) => {
    doc.setFont(mono ? "courier" : family, mono ? "normal" : weight);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const lineH = (size: number) => size * PT * LH;
  const wrap = (text: string, width: number, mono = false) => doc.splitTextToSize(clean(text, mono), width) as string[];
  const newPage = () => {
    doc.addPage();
    y = TOP;
  };
  const ensure = (height: number) => {
    if (y + height > BOTTOM) newPage();
  };
  // Draw already-wrapped lines starting at the current y (baseline-aware).
  const drawLines = (lines: string[], x: number, size: number, opts: { url?: string } = {}) => {
    const h = lineH(size);
    lines.forEach((line, i) => {
      const baseline = y + h * i + size * PT;
      if (opts.url) doc.textWithLink(line, x, baseline, { url: opts.url });
      else doc.text(line, x, baseline);
    });
    y += h * lines.length;
  };
  const paragraph = (text: string, size = 9.5, color: RGB = C.soft, weight: "normal" | "bold" = "normal", indent = 0, after = 1.5) => {
    font(size, weight, color);
    const lines = wrap(text, W - indent);
    for (const line of lines) {
      ensure(lineH(size));
      drawLines([line], M + indent, size);
    }
    y += after;
  };
  const rule = (gapBefore = 2, gapAfter = 4) => {
    y += gapBefore;
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    doc.line(M, y, PAGE_W - M, y);
    y += gapAfter;
  };
  // keepWith: height of what follows the title, so a title never ends a page
  // on its own (REG-24).
  const sectionTitle = (title: string, status?: ReportSignalStatus, keepWith = 0) => {
    ensure(18 + keepWith);
    y += 4;
    font(14, "bold", C.ink);
    const x = status ? M + 6.5 : M;
    if (status) statusIcon(status, M + 2.2, y + 2.9, 2.2);
    drawLines([clean(title)], x, 14);
    rule(1, 4);
  };
  const eyebrowH = lineH(7.5) + 1.5;
  const eyebrow = (text: string, keepWith = 0) => {
    ensure(lineH(7.5) + 3 + keepWith);
    font(7.5, "bold", C.muted);
    doc.setCharSpace(0.4);
    drawLines([clean(text.toUpperCase())], M, 7.5);
    doc.setCharSpace(0);
    y += 1.5;
  };

  // Status marks are drawn, not typed: fonts have no ✓/✗ glyphs.
  function statusIcon(status: ReportSignalStatus, cx: number, cy: number, r = 1.8) {
    doc.setLineWidth(0.35);
    doc.setDrawColor(...C.accent);
    doc.setFillColor(...C.accent);
    if (status === "pass") {
      doc.circle(cx, cy, r, "F");
      doc.setDrawColor(...C.white);
      doc.setLineWidth(0.4);
      doc.line(cx - r * 0.45, cy + r * 0.02, cx - r * 0.1, cy + r * 0.38);
      doc.line(cx - r * 0.1, cy + r * 0.38, cx + r * 0.5, cy - r * 0.35);
    } else if (status === "warn") {
      doc.triangle(cx, cy - r, cx - r * 1.05, cy + r * 0.8, cx + r * 1.05, cy + r * 0.8, "S");
      doc.line(cx, cy - r * 0.35, cx, cy + r * 0.2);
      doc.circle(cx, cy + r * 0.5, 0.12, "F");
    } else if (status === "neutral") {
      doc.circle(cx, cy, r, "S");
      doc.line(cx - r * 0.5, cy, cx + r * 0.5, cy);
    } else {
      doc.circle(cx, cy, r, "S");
      doc.line(cx - r * 0.45, cy - r * 0.45, cx + r * 0.45, cy + r * 0.45);
      doc.line(cx - r * 0.45, cy + r * 0.45, cx + r * 0.45, cy - r * 0.45);
    }
  }

  // ── Page 1: title, scores, page check ──────────────────────────────────
  eyebrow("Lensy scan / AI readiness report");
  font(24, "bold", C.ink);
  drawLines(wrap(data.hostname || "AI readiness report", W), M, 24);
  y += 1;
  font(9.5, "normal", C.accent);
  drawLines(wrap(data.url, W), M, 9.5, { url: /^https?:\/\//.test(data.url) ? data.url : undefined });
  y += 1;
  const meta = [
    data.scannedAt ? `Scanned ${formatUtc(data.scannedAt)}` : `Downloaded ${formatUtc(data.downloadedAt)}`,
    data.readinessSeconds !== undefined ? `AI readiness completed in ${data.readinessSeconds.toFixed(1)}s` : "",
    data.reportId ? `Report ID ${data.reportId}` : "",
  ].filter(Boolean).join("   ·   ");
  font(8, "normal", C.muted);
  drawLines(wrap(meta, W), M, 8);
  y += 6;

  // Two score boxes side by side, like the two cards on the results page.
  const boxW = (W - 4) / 2;
  const boxH = 34;
  doc.setFillColor(...C.panel);
  doc.roundedRect(M, y, boxW, boxH, 2.5, 2.5, "F");
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.3);
  doc.setFillColor(...C.white);
  doc.roundedRect(M + boxW + 4, y, boxW, boxH, 2.5, 2.5, "S");
  const boxText = (x: number, dark: boolean, label: string, big: string, small: string) => {
    const fg = dark ? C.panelFg : C.ink;
    font(8, "normal", dark ? [185, 189, 190] : C.muted);
    doc.text(clean(label), x + 6, y + 8);
    font(26, "bold", fg);
    doc.text(clean(big), x + 6, y + 21);
    font(8, "normal", dark ? [185, 189, 190] : C.soft);
    const lines = wrap(small, boxW - 12).slice(0, 2);
    lines.forEach((line, i) => doc.text(line, x + 6, y + 27 + i * lineH(8)));
  };
  const toImprove = (n: number) => n ? `${n} check${n === 1 ? "" : "s"} to improve` : "Every check passes";
  if (data.scoring) {
    boxText(M, true, "AI search", `${data.scoring.search.score}/100`, toImprove(data.scoring.search.toImprove));
    boxText(M + boxW + 4, false, "Coding agents", `${data.scoring.coding.score}/100`, toImprove(data.scoring.coding.toImprove));
  } else {
    boxText(M, true, "AI readiness", data.score !== null ? `${data.score}/100` : "-", `${data.signalsToImprove} signal${data.signalsToImprove === 1 ? "" : "s"} to improve across ${data.categoriesToImprove} categor${data.categoriesToImprove === 1 ? "y" : "ies"}`);
    boxText(
      M + boxW + 4,
      false,
      "AI citations",
      data.citations.state === "done" ? `${data.citations.cited}/${data.citations.total}` : data.citations.state === "failed" ? "Could not run" : data.citations.state === "not_run" ? "Not run" : data.citations.state === "off" ? "Off" : "No results",
      citationsSummary(data.citations),
    );
  }
  y += boxH + 6;

  if (data.docCheck) {
    eyebrow("Page check");
    paragraph(data.docCheck.label, 10, C.ink, "bold", 0, 1);
    for (const s of data.docCheck.signals) paragraph(`•  ${s}`, 8.5, C.soft, "normal", 2, 0.4);
    y += 2;
  }

  // ── Reachability (two scores) or AI bot access (older reports) ─────────
  sectionTitle(data.bots.title);
  paragraph(data.bots.banner, 10, C.ink, "bold", 0, 1);
  font(8.5, "normal", C.accent);
  if (data.bots.robotsUrl) {
    ensure(lineH(8.5));
    drawLines([clean(data.bots.robotsUrl)], M, 8.5, { url: data.bots.robotsUrl });
  } else {
    paragraph("No robots.txt found", 8.5, C.muted, "normal", 0, 0);
  }
  y += 1.5;
  if (data.bots.note) paragraph(data.bots.note, 8.5, C.soft);
  if (data.bots.list.length) {
    const cols = 3;
    const colW = W / cols;
    const rowH = 6;
    const rows = Math.ceil(data.bots.list.length / cols);
    ensure(rows * rowH + 2);
    data.bots.list.forEach((bot, i) => {
      const cx = M + (i % cols) * colW;
      const cy = y + Math.floor(i / cols) * rowH;
      statusIcon(bot.allowed ? "pass" : "fail", cx + 1.8, cy + 2.2, 1.6);
      font(9, "normal", C.ink);
      const name = clean(bot.name);
      const nameW = doc.getTextWidth(name);
      doc.text(name, cx + 5, cy + 3.3);
      font(7.5, "normal", C.muted);
      doc.text(bot.allowed ? "Allowed" : "Blocked", cx + 5 + nameW + 2, cy + 3.3);
    });
    y += rows * rowH + 2;
  }

  // ── Signals ─────────────────────────────────────────────────────────────
  const signalLayout = (sig: ExportSignal) => {
    const textW = W - 6.5;
    const metaText = [sig.points ? `${sig.points} points` : "", sig.evidence, sig.audience, sig.impact ? `${sig.impact} impact` : ""].filter(Boolean).join("  ·  ");
    font(10, "bold");
    const labelLines = wrap(sig.label, textW);
    font(7.5);
    const metaLines = metaText ? wrap(metaText, textW) : [];
    font(9);
    const detailLines = wrap(sig.detail, textW);
    const fixLines = sig.fix ? wrap(`Fix: ${sig.fix}`, textW) : [];
    font(8);
    const noteLines = sig.note ? wrap(sig.note, textW) : [];
    const height = labelLines.length * lineH(10) + metaLines.length * lineH(7.5) + detailLines.length * lineH(9) + fixLines.length * lineH(9) + noteLines.length * lineH(8) + 4;
    return { labelLines, metaLines, detailLines, fixLines, noteLines, height: Math.min(height, BOTTOM - TOP) };
  };
  const signalRow = (sig: ExportSignal) => {
    const textX = M + 6.5;
    const { labelLines, metaLines, detailLines, fixLines, noteLines, height } = signalLayout(sig);
    ensure(height);
    statusIcon(sig.status, M + 2.2, y + 2.4, 1.8);
    font(10, "bold", C.ink);
    drawLines(labelLines, textX, 10);
    if (metaLines.length) {
      font(7.5, "normal", C.muted);
      drawLines(metaLines, textX, 7.5);
    }
    y += 0.5;
    font(9, "normal", C.soft);
    drawLines(detailLines, textX, 9);
    if (fixLines.length) {
      // "Fix:" in bold, the rest regular, as on the page.
      const first = fixLines[0];
      font(9, "bold", C.ink);
      const fixLabelW = doc.getTextWidth("Fix:");
      doc.text("Fix:", textX, y + 9 * PT);
      font(9, "normal", C.ink);
      doc.text(first.replace(/^Fix:/, ""), textX + fixLabelW, y + 9 * PT);
      y += lineH(9);
      if (fixLines.length > 1) drawLines(fixLines.slice(1), textX, 9);
    }
    if (noteLines.length) {
      font(8, "normal", C.muted);
      drawLines(noteLines, textX, 8);
    }
    y += 3.5;
  };

  if (data.groups.length) {
    for (const group of data.groups) {
      const first = group.sections.find((sec) => sec.signals.length);
      const firstH = first ? (first.title ? eyebrowH : 0) + signalLayout(first.signals[0]).height : 0;
      sectionTitle(group.title, group.status, firstH);
      for (const section of group.sections) {
        if (section.title) eyebrow(section.title, section.signals.length ? signalLayout(section.signals[0]).height : 0);
        section.signals.forEach(signalRow);
      }
    }
  }

  // ── What an agent receives (two-score reports) ──────────────────────────
  if (data.scoring?.preview) {
    sectionTitle("What an agent receives");
    paragraph(`${data.scoring.preview}.`, 9.5, C.ink, "bold", 0, 1);
    if (data.scoring.previewUrl) paragraph(`Fetched from ${data.scoring.previewUrl}`, 8.5, C.soft);
  }

  // ── AI citations ────────────────────────────────────────────────────────
  if (data.citations.state !== "off") {
    sectionTitle("AI citations");
    paragraph(citationsSummary(data.citations), 9.5, C.ink, "bold", 0, 1);
    if (data.citations.seconds !== undefined) paragraph(`AI citations check completed in ${data.citations.seconds.toFixed(1)}s`, 8, C.muted);
    y += 1;
    for (const row of data.citations.rows) {
      const pillW = 20;
      const textW = W - pillW - 4;
      font(10, "normal");
      const q = wrap(`"${row.query}"`, textW);
      font(7.5);
      const metaLine = [row.tier, row.engine].filter(Boolean).join("  ·  ");
      font(8.5);
      const cited = row.citedUrl ? wrap(`Cited URL: ${row.citedUrl}`, textW) : [];
      const instead = row.competingDomains.length ? wrap(`Cited instead: ${row.competingDomains.join(", ")}`, textW) : [];
      const height = q.length * lineH(10) + lineH(7.5) + (cited.length + instead.length) * lineH(8.5) + 6;
      ensure(height);
      const top = y;
      font(10, "normal", C.ink);
      drawLines(q, M, 10);
      font(7.5, "normal", C.muted);
      drawLines([clean(metaLine)], M, 7.5);
      font(8.5, "normal", C.soft);
      if (cited.length) drawLines(cited, M, 8.5);
      if (instead.length) drawLines(instead, M, 8.5);
      // Cited / Not cited pill on the right.
      const label = row.cited ? "Cited" : "Not cited";
      doc.setLineWidth(0.25);
      doc.setDrawColor(...C.line);
      if (row.cited) {
        doc.setFillColor(...C.panel);
        doc.roundedRect(PAGE_W - M - pillW, top + 0.5, pillW, 5.5, 2.75, 2.75, "F");
        font(7.5, "bold", C.panelFg);
      } else {
        doc.roundedRect(PAGE_W - M - pillW, top + 0.5, pillW, 5.5, 2.75, 2.75, "S");
        font(7.5, "normal", C.soft);
      }
      doc.text(label, PAGE_W - M - pillW / 2, top + 4.2, { align: "center" });
      y += 2;
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.2);
      doc.line(M, y, PAGE_W - M, y);
      y += 3;
    }
    for (const note of data.citations.notes) {
      paragraph(note.issue, 9.5, C.ink, "bold", 0, 0.5);
      paragraph(note.fix, 9, C.soft);
    }
  }

  // ── Recommendations ─────────────────────────────────────────────────────
  const pad = 4;
  const innerW = W - pad * 2;
  const recLayout = (rec: ExportRec) => {
    font(10.5, "bold");
    const title = wrap(rec.issue, innerW);
    const chips = [rec.impact, rec.effort, rec.category, rec.points && `Points ${rec.points}`].filter(Boolean) as string[];
    font(9);
    // A tip has no fix line (REG-25).
    const fix = rec.fix ? wrap(rec.fix, innerW) : [];
    font(7.5, "normal", C.ink, true);
    const code = rec.codeSnippet ? (wrap(rec.codeSnippet, innerW - 6, true) as string[]) : [];
    const codeH = code.length ? code.length * lineH(7.5) + 6 : 0;
    const height = pad + title.length * lineH(10.5) + 7 + fix.length * lineH(9) + (codeH ? codeH + 3 : 0) + pad;
    return { title, chips, fix, code, codeH, height };
  };
  const recCard = (rec: ExportRec) => {
    const { title, chips, fix, code, codeH, height } = recLayout(rec);
    // A card taller than a page (a huge snippet) starts on a fresh page and
    // then flows; anything smaller always stays whole.
    ensure(Math.min(height, BOTTOM - TOP));
    const top = y;
    y += pad;
    font(10.5, "bold", C.ink);
    drawLines(title, M + pad, 10.5);
    y += 1;
    // Chips
    let cx = M + pad;
    font(7, "normal", C.soft);
    for (const chip of chips) {
      const t = clean(chip);
      const w = doc.getTextWidth(t) + 5;
      doc.setFillColor(...C.surface);
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.2);
      doc.roundedRect(cx, y, w, 4.6, 2.3, 2.3, "FD");
      doc.text(t, cx + 2.5, y + 3.2);
      cx += w + 2;
    }
    y += 6.5;
    font(9, "normal", C.soft);
    drawLines(fix, M + pad, 9);
    if (code.length) {
      y += 2;
      const fits = y + codeH <= BOTTOM;
      if (fits) {
        doc.setFillColor(...C.surface);
        doc.roundedRect(M + pad, y, innerW, codeH, 1.5, 1.5, "F");
        y += 3;
        font(7.5, "normal", C.ink, true);
        drawLines(code, M + pad + 3, 7.5);
        y += 3;
      } else {
        font(7.5, "normal", C.ink, true);
        for (const line of code) {
          ensure(lineH(7.5));
          drawLines([line], M + pad + 3, 7.5);
        }
      }
    }
    y += pad;
    // Card border, only when the card stayed on one page.
    if (y > top) {
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.roundedRect(M, top, W, y - top, 2, 2, "S");
    }
    y += 3;
  };

  // Card heights are capped like recCard does, so a huge card never asks for
  // more than a page.
  const recH = (rec?: ExportRec) => (rec ? Math.min(recLayout(rec).height, BOTTOM - TOP - 18 - eyebrowH) : 0);
  const firstRecs = [data.recommendations.quickWins, data.recommendations.deeper, data.recommendations.watch].find((r) => r.length);
  sectionTitle(`All recommendations (${data.recommendations.total})`, undefined, firstRecs ? eyebrowH + recH(firstRecs[0]) : 0);
  if (!data.recommendations.total) paragraph("No recommendations. This page is well-optimized for AI tools.");
  const recGroup = (title: string, recs: ExportRec[]) => {
    if (!recs.length) return;
    eyebrow(title, recH(recs[0]));
    recs.forEach(recCard);
    y += 2;
  };
  recGroup("Quick Wins", data.recommendations.quickWins);
  recGroup("Deeper Improvements", data.recommendations.deeper);
  recGroup(data.scoring ? "Also worth knowing (not scored)" : "Things to Watch", data.recommendations.watch);

  if (data.helpLinks.length) {
    sectionTitle("Need help?");
    for (const link of data.helpLinks) {
      ensure(lineH(9.5) + 1);
      font(9.5, "normal", C.ink);
      drawLines([clean(link.label)], M, 9.5, { url: link.href });
      y += 0.8;
    }
  }

  y += 4;
  paragraph(`Lensy checked this one page, not the whole site.${data.citations.state !== "off" ? " AI citation results change from run to run." : ""}`, 8, C.muted, "normal", 0, 0.5);
  font(8, "normal", C.accent);
  ensure(lineH(8));
  drawLines(["Made with Lensy by Perseverance AI · perseveranceai.com"], M, 8, { url: "https://perseveranceai.com" });

  // ── Running header and footer on every page ─────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    font(7.5, "bold", C.ink);
    doc.text("Lensy", M, 11);
    font(7.5, "normal", C.muted);
    doc.text(clean(`AI readiness report  ·  ${data.hostname}`), PAGE_W - M, 11, { align: "right" });
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    doc.line(M, 13.5, PAGE_W - M, 13.5);
    doc.line(M, PAGE_H - 12, PAGE_W - M, PAGE_H - 12);
    font(7, "normal", C.muted);
    doc.text(clean(data.reportId ? `Report ID ${data.reportId}` : "Lensy by Perseverance AI"), M, PAGE_H - 8);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - M, PAGE_H - 8, { align: "right" });
  }
  return doc;
}
