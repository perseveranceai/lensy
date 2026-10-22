// Markdown report for coding agents (H-001). Plain ASCII status words, no
// HTML, no images, no emoji: every agent and terminal reads it the same way.
import type { ExportReport, ExportRec, ExportSignal } from "./exportReport";
import { STATUS_WORD, citationsSummary, formatUtc } from "./exportReport";

// Keep table cells on one line and stop a stray "|" from splitting a column.
const cell = (text: string) => text.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
// Front-matter values are always quoted so URLs and colons stay valid YAML.
const yamlString = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function fence(code: string): string {
  // A snippet that itself contains ``` needs a longer fence.
  const longest = Math.max(2, ...(code.match(/`+/g) || []).map((m) => m.length));
  const ticks = "`".repeat(longest + 1);
  const trimmed = code.replace(/\s+$/, "");
  const lang = /^\s*</.test(trimmed) ? "html" : /^\s*[{[]/.test(trimmed) ? "json" : "";
  return `${ticks}${lang}\n${trimmed}\n${ticks}`;
}

function signalMeta(sig: ExportSignal): string {
  const meta = [sig.points && `Points: ${sig.points}`, sig.evidence && `Evidence: ${sig.evidence}`, sig.audience && `Audience: ${sig.audience}`, sig.impact && `Impact: ${sig.impact}`].filter(Boolean);
  return meta.length ? ` (${meta.join("; ")})` : "";
}

function recBlock(rec: ExportRec, checkbox: boolean): string {
  const lines = [`${checkbox ? "- [ ] " : "- "}**${rec.issue}**`];
  lines.push(`  - ${[rec.impact, rec.effort, rec.category].filter(Boolean).join(" · ")}`);
  lines.push(`  - Fix: ${rec.fix}`);
  if (rec.codeSnippet) lines.push("", fence(rec.codeSnippet).split("\n").map((l) => `  ${l}`).join("\n"));
  return lines.join("\n");
}

export function renderMarkdown(data: ExportReport): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const citationsValue = data.citations.state === "done" ? `${data.citations.cited}/${data.citations.total}` : data.citations.state;
  const citationsOn = data.citations.state !== "off";
  const sc = data.scoring;
  const toImprove = (n: number) => n ? `${n} check${n === 1 ? "" : "s"} to improve` : "every check passes";

  push(
    "---",
    `url: ${yamlString(data.url)}`,
    `scanned_at: ${data.scannedAt ? yamlString(data.scannedAt) : "null"}`,
    `downloaded_at: ${yamlString(data.downloadedAt)}`,
    `report_id: ${data.reportId ? yamlString(data.reportId) : "null"}`,
    ...(sc
      ? ["scoring_version: 2", `ai_search_score: ${sc.search.score}`, `coding_agents_score: ${sc.coding.score}`, `reachability: ${yamlString(sc.reachability)}`]
      : [`readiness_score: ${data.score ?? "null"}`]),
    ...(citationsOn ? [`citations: ${yamlString(citationsValue)}`] : []),
    "generator: \"Lensy (perseveranceai.com)\"",
    "---",
    "",
    "# Lensy AI readiness report",
    "",
    `**Page:** ${data.url}  `,
    data.scannedAt ? `**Scanned:** ${formatUtc(data.scannedAt)}  ` : `**Downloaded:** ${formatUtc(data.downloadedAt)}  `,
    ...(data.reportId ? [`**Report ID:** ${data.reportId}  `] : []),
    ...(data.readinessSeconds !== undefined ? [`**AI readiness completed in:** ${data.readinessSeconds.toFixed(1)}s`] : []),
    "",
    "## How to use this file",
    "",
    "This is an AI readiness report for the page above, made by Lensy. If you are a coding agent working in this site's docs repository:",
    "",
    "1. Work through the open items under **Fixes**, top to bottom. Quick Wins come first.",
    "2. Each item names the check, what Lensy found, and the fix. Apply the fix to the docs source, not to generated output.",
    "3. Do not change anything marked PASS.",
    "4. Status words: PASS (good), WARN (needs improvement), FAIL (missing or blocking), INFO (optional, not scored).",
    "",
    "## Summary",
    "",
    ...(sc
      ? [
          `- AI search: ${sc.search.score}/100, ${toImprove(sc.search.toImprove)}`,
          `- Coding agents: ${sc.coding.score}/100, ${toImprove(sc.coding.toImprove)}`,
          `- ${data.bots.banner}`,
          ...(sc.preview ? [`- What an agent receives: ${sc.preview}`] : []),
        ]
      : [`- AI readiness: ${data.score !== null ? `${data.score}/100` : "not available"}, ${data.signalsToImprove} signal${data.signalsToImprove === 1 ? "" : "s"} to improve across ${data.categoriesToImprove} categor${data.categoriesToImprove === 1 ? "y" : "ies"}`]),
    ...(citationsOn ? [`- AI citations: ${citationsSummary(data.citations)}`] : []),
    ...(data.docCheck ? [`- Page check: ${data.docCheck.label}`] : []),
    ...(sc ? [] : [`- ${/^bot access/i.test(data.bots.banner) ? data.bots.banner : `Bot access: ${data.bots.banner}`}`]),
    "",
  );

  // ── Fixes checklist: every non-passing signal, then every recommendation ──
  push(`## Fixes (${data.recommendations.total} recommendation${data.recommendations.total === 1 ? "" : "s"})`, "");
  const openSignals = data.groups.flatMap((g) => g.sections.flatMap((s) => s.signals.filter((sig) => sig.status === "warn" || sig.status === "fail").map((sig) => ({ group: g.title, sig }))));
  const anyRecs = data.recommendations.total > 0;
  if (!openSignals.length && !anyRecs) push("Nothing to fix. This page is well-optimized for AI tools.", "");
  if (data.recommendations.quickWins.length) push("### Quick Wins", "", ...data.recommendations.quickWins.map((r) => recBlock(r, true)), "");
  if (data.recommendations.deeper.length) push("### Deeper Improvements", "", ...data.recommendations.deeper.map((r) => recBlock(r, true)), "");
  if (openSignals.length) {
    push("### Signals to improve", "");
    for (const { group, sig } of openSignals) {
      push(`- [ ] **${group}: ${sig.label}** [${STATUS_WORD[sig.status]}]${signalMeta(sig)}`, `  - Found: ${sig.detail}`);
      if (sig.fix) push(`  - Fix: ${sig.fix}`);
    }
    push("");
  }
  if (data.recommendations.watch.length) push("### Things to Watch (best practice, not scored)", "", ...data.recommendations.watch.map((r) => recBlock(r, false)), "");

  // ── Full report ──
  push("## Page check", "");
  if (data.docCheck) {
    push(`${data.docCheck.label}`, "");
    if (data.docCheck.signals.length) push(...data.docCheck.signals.map((s) => `- ${s}`), "");
  } else {
    push("Not available for this report.", "");
  }

  push(`## ${data.bots.title}`, "", data.bots.banner, "");
  push(data.bots.robotsUrl ? `robots.txt: ${data.bots.robotsUrl}` : "No robots.txt found.", "");
  if (data.bots.note) push(data.bots.note, "");
  if (data.bots.list.length) {
    push("| Bot | Access |", "|---|---|", ...data.bots.list.map((b) => `| ${cell(b.name)} | ${b.allowed ? "Allowed" : "Blocked"} |`), "");
  }
  if (sc?.preview) {
    push("## What an agent receives", "", sc.preview + ".", "");
    if (sc.previewUrl) push(`Fetched from: ${sc.previewUrl}`, "");
  }

  push("## Signals", "");
  for (const group of data.groups) {
    push(`### ${group.title} [${STATUS_WORD[group.status]}]`, "");
    for (const section of group.sections) {
      if (section.title) push(`#### ${section.title}`, "");
      for (const sig of section.signals) {
        push(`- **${sig.label}** [${STATUS_WORD[sig.status]}]${signalMeta(sig)}`, `  - ${sig.detail}`);
        if (sig.fix) push(`  - Fix: ${sig.fix}`);
        if (sig.note) push(`  - Note: ${sig.note}`);
      }
      push("");
    }
  }

  if (citationsOn) push("## AI citations", "", citationsSummary(data.citations), "");
  if (citationsOn && data.citations.seconds !== undefined) push(`AI citations check completed in ${data.citations.seconds.toFixed(1)}s.`, "");
  if (data.citations.rows.length) {
    push(
      `| Query | Intent | ${cell(data.citations.engine || "Result")} | Cited URL | Cited instead |`,
      "|---|---|---|---|---|",
      ...data.citations.rows.map((r) => `| ${cell(r.query)} | ${r.tier || ""} | ${r.cited ? "Cited" : "Not cited"} | ${cell(r.citedUrl || "")} | ${cell(r.competingDomains.join(", "))} |`),
      "",
    );
  }
  if (data.citations.notes.length) push(...data.citations.notes.map((n) => `- **${n.issue}** ${n.fix}`), "");

  if (data.helpLinks.length) push("## Need help?", "", ...data.helpLinks.map((h) => `- ${h.label}: ${h.href}`), "");

  push(
    "---",
    "",
    `Lensy checked this one page, not the whole site.${citationsOn ? " AI citation results change from run to run." : ""} Made with Lensy by Perseverance AI: https://perseveranceai.com`,
    "",
  );
  return out.join("\n");
}
