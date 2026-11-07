// SPDX-License-Identifier: MIT
// The Markdown report, for coding agents (Req 3.3-3.6). YAML front matter with
// the metadata, then per page: Summary, Both audiences, Coding agents,
// AI search, Fixes (- [ ] items), Tips, Skipped and unknown checks, Notes.
// Page content (findings, URLs) is untrusted, so table cells and text are escaped.
import type { DocPage, ReportDoc } from './report-doc';

// JSON strings are valid YAML scalars, so values can't break the front matter.
const y = (v: unknown) => JSON.stringify(v);
// Text from the scanned site must not become Markdown or HTML structure.
const text = (s: string) => s.replace(/\r?\n/g, ' ').replace(/([\\`*_[\]<>|])/g, '\\$1');
const cell = (s: string) => text(s);
/** The same escaping, for the other Markdown files Lensy writes (history.md). */
export { text as mdText };

function frontMatter(d: ReportDoc): string {
  const m = d.meta;
  const lines = [
    '---',
    `reportVersion: ${m.reportVersion}`,
    `tool: ${y(m.tool)}`,
    `toolVersion: ${y(m.toolVersion)}`,
    `engineCommit: ${y(m.engineCommit)}`,
    `checkedAt: ${y(m.checkedAt)}`,
    `mode: ${y(m.mode)}`,
    'pages:',
    ...m.pages.flatMap(p => [
      `  - url: ${y(p.url)}`,
      `    status: ${y(p.status)}`,
      `    codingAgents: ${p.codingAgents ?? 'null'}`,
      `    aiSearch: ${p.aiSearch ?? 'null'}`,
    ]),
    '---',
  ];
  return lines.join('\n');
}

function renderPage(p: DocPage): string {
  const out = [`## ${text(p.url)}`];
  if (p.message) {
    out.push('', text(p.message));
    return out.join('\n');
  }
  const s = p.summary!;
  out.push('', '### Summary', '', `- Coding agents: ${text(s.codingAgents)}`, `- AI search: ${text(s.aiSearch)}`);
  if (s.banner) out.push(`- ${text(s.banner)}`);
  if (s.preview) out.push(`- What an agent receives: ${text(s.preview)}`);

  for (const g of p.groups) {
    out.push('', `### ${g.title}`, '', '| ID | Check | Status | Points | Max | Finding | Source |', '|---|---|---|---|---|---|---|');
    for (const r of g.rows) out.push(`| ${cell(r.id)} | ${cell(r.check)} | ${r.status} | ${cell(r.points)} | ${cell(r.max)} | ${cell(r.finding)} | ${cell(r.source)} |`);
  }

  out.push('', '### Fixes', '');
  if (!p.fixes.length) out.push('Every check passes.');
  for (const f of p.fixes) out.push(`- [ ] **${text(f.id)}** (+${f.gain} points) ${text(f.issue)}`, `  Fix: ${text(f.fix)}`);

  if (p.tips.length) out.push('', '### Tips', '', ...p.tips.map(t => `- ${text(t)}`));
  if (p.skipped.length) {
    out.push('', '### Skipped and unknown checks', '', '| ID | Check | Status | Reason |', '|---|---|---|---|');
    for (const k of p.skipped) out.push(`| ${cell(k.id)} | ${cell(k.check)} | ${k.status} | ${cell(k.reason)} |`);
  }
  if (p.notes.length) out.push('', '### Notes', '', ...p.notes.map(n => `- ${text(n)}`));
  return out.join('\n');
}

export function renderMarkdown(d: ReportDoc): string {
  const title = d.pages.length === 1 ? `# Lensy report: ${text(d.pages[0].url)}` : `# Lensy report: ${d.pages.length} pages`;
  return [frontMatter(d), '', title, '', ...d.pages.map(renderPage).flatMap(p => [p, '']), ''].join('\n').replace(/\n{3,}/g, '\n\n');
}
