// SPDX-License-Identifier: MIT
// The HTML report, for people (Req 3.2). One self-contained file: inline CSS,
// no <script>, no external URLs (fonts, images, links), so it opens offline and
// loads nothing. Website colours, light and dark via prefers-color-scheme, and
// print styles. Everything from the scanned site is escaped.
import type { DocPage, ReportDoc } from './report-doc';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `
:root{--bg:#ffffff;--ink:#141414;--muted:#6b6f73;--accent:#697075;--line:#e6e6e6;--surface:#f7f7f7;--pass:#2f7d4f;--warn:#9a6a00;--fail:#b3261e;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0f1011;--ink:#ededed;--muted:#9a9ea3;--accent:#a3a9ae;--line:#2a2c2f;--surface:#17181a;--pass:#6cc58f;--warn:#e0b44c;--fail:#f08a80}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 24px 64px}
h1{font-size:28px;letter-spacing:-.03em;margin:0 0 4px}
h2{font-size:20px;letter-spacing:-.02em;margin:48px 0 8px;padding-top:24px;border-top:1px solid var(--line);overflow-wrap:anywhere}
h3{font-size:13px;text-transform:none;color:var(--muted);margin:28px 0 8px;font-weight:600}
.meta{color:var(--muted);font-size:13px}
.scores{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
.score{border:1px solid var(--line);border-radius:10px;padding:14px 18px;min-width:200px;background:var(--surface)}
.score b{display:block;font-size:30px;letter-spacing:-.04em}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
th{color:var(--muted);font-weight:600}
.s{font-weight:600;white-space:nowrap}
.PASS{color:var(--pass)}.WARN{color:var(--warn)}.FAIL{color:var(--fail)}.UNKNOWN,.SKIPPED,.INFO{color:var(--muted)}
ul{padding-left:20px}
li{margin:6px 0}
.fix{color:var(--muted)}
.msg{border:1px solid var(--line);border-radius:10px;padding:12px 16px;background:var(--surface)}
@media print{body{background:#fff;color:#000;font-size:12px}main{padding:0;max-width:none}h2{break-before:page;border:0}h2:first-of-type{break-before:auto}.score,.msg{background:none}tr{break-inside:avoid}}
`.trim();

function meta(d: ReportDoc): string {
  const m = d.meta;
  const tags: [string, string][] = [
    ['reportVersion', String(m.reportVersion)], ['tool', m.tool], ['toolVersion', m.toolVersion],
    ['engineCommit', m.engineCommit], ['checkedAt', m.checkedAt], ['mode', m.mode], ['pages', JSON.stringify(m.pages)],
  ];
  return tags.map(([k, v]) => `<meta name="lensy:${k}" content="${esc(v)}">`).join('\n');
}

function table(head: string[], rows: string[][]): string {
  return `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map(r => `<tr>${r.map((c, i) => `<td${head[i] === 'Status' ? ` class="s ${esc(c)}"` : ''}>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function renderPage(p: DocPage): string {
  const out = [`<section><h2>${esc(p.url)}</h2>`];
  if (p.message) {
    out.push(`<p class="msg">${esc(p.message)}</p></section>`);
    return out.join('\n');
  }
  const s = p.summary!;
  out.push('<h3>Summary</h3>', `<div class="scores"><div class="score">Coding agents<b>${esc(s.codingAgents)}</b></div><div class="score">AI search<b>${esc(s.aiSearch)}</b></div></div>`);
  if (s.banner) out.push(`<p>${esc(s.banner)}</p>`);
  if (s.preview) out.push(`<p>What an agent receives: ${esc(s.preview)}</p>`);
  for (const g of p.groups) {
    out.push(`<h3>${esc(g.title)}</h3>`, table(['ID', 'Check', 'Status', 'Points', 'Max', 'Finding', 'Source'], g.rows.map(r => [r.id, r.check, r.status, r.points, r.max, r.finding, r.source])));
  }
  out.push('<h3>Fixes</h3>');
  out.push(p.fixes.length
    ? `<ul>${p.fixes.map(f => `<li><b>${esc(f.id)}</b> (+${f.gain} points) ${esc(f.issue)}<br><span class="fix">Fix: ${esc(f.fix)}</span></li>`).join('')}</ul>`
    : '<p>Every check passes.</p>');
  if (p.tips.length) out.push('<h3>Tips</h3>', `<ul>${p.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`);
  if (p.skipped.length) out.push('<h3>Skipped and unknown checks</h3>', table(['ID', 'Check', 'Status', 'Reason'], p.skipped.map(k => [k.id, k.check, k.status, k.reason])));
  if (p.notes.length) out.push('<h3>Notes</h3>', `<ul>${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`);
  out.push('</section>');
  return out.join('\n');
}

export function renderHtml(d: ReportDoc): string {
  const title = d.pages.length === 1 ? `Lensy report: ${d.pages[0].url}` : `Lensy report: ${d.pages.length} pages`;
  const m = d.meta;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${meta(d)}
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>${esc(title)}</h1>
<p class="meta">Checked ${esc(m.checkedAt)} by lensy ${esc(m.toolVersion)} (engine ${esc(m.engineCommit)}), report version ${m.reportVersion}, mode ${esc(m.mode)}.</p>
</header>
${d.pages.map(renderPage).join('\n')}
</main>
</body>
</html>
`;
}
