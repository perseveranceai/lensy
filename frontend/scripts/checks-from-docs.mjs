#!/usr/bin/env node
// Writes frontend/src/checks.json, the check list the docs pages show
// (/docs/checks and one page per check at /docs/checks/<slug>), from
// packages/docs/checks.md. That file is generated from the engine's check
// registry (backend/lambda/agent-handler/tools/check-registry.ts) by
// `cd packages && npm run docs:checks`, and a CLI test fails when it's stale.
// scripts/site-content.test.mjs fails when checks.json doesn't match it.
//
// usage: node frontend/scripts/checks-from-docs.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, '..', '..', 'packages', 'docs', 'checks.md');
const OUT = path.join(here, '..', 'src', 'checks.json');

/** The text of the "## <title>" section, up to the next "## ". */
function section(md, title) {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`checks.md has no "## ${title}" section`);
  const rest = md.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Table rows of a section, as arrays of cells. */
function table(text, title) {
  const rows = [];
  for (const line of text.split('\n').slice(1)) {
    if (line.startsWith('### ')) break;
    if (!line.startsWith('|') || /^\|\s*(ID|---)/.test(line)) continue;
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
  }
  if (!rows.length) throw new Error(`no rows under "## ${title}"`);
  return rows;
}

/** The paragraph before the table: how the score is counted. */
function intro(text) {
  const lines = text.split('\n').slice(1);
  const out = [];
  for (const line of lines) {
    if (line.startsWith('|') || line.startsWith('### ')) break;
    if (line.trim()) out.push(line.trim());
  }
  return out.join(' ');
}

/** "**Label:** text" fields and the evidence links under "### <id> ...". */
function details(text, id) {
  const head = text.split('\n').findIndex((l) => l.startsWith(`### ${id} `));
  if (head < 0) throw new Error(`checks.md has no "### ${id}" section`);
  const lines = text.split('\n').slice(head + 1);
  const end = lines.findIndex((l) => l.startsWith('### ') || l.startsWith('## '));
  const body = end < 0 ? lines : lines.slice(0, end);
  const field = (label) => {
    const line = body.find((l) => l.startsWith(`**${label}:**`));
    return line ? line.slice(label.length + 5).trim() : undefined;
  };
  const evidence = body
    .map((l) => /^- \[(.+)\]\((https?:\/\/[^)]+)\)$/.exec(l.trim()))
    .filter(Boolean)
    .map(([, title, url]) => ({ title, url }));
  const out = { measures: field('What it measures'), why: field('Why it matters') };
  const host = field('Depends on your hosting');
  if (host) out.host = host;
  out.evidence = evidence;
  if (!out.measures || !out.why) throw new Error(`"### ${id}" is missing what it measures or why it matters`);
  return out;
}

/** URL slug for a check: lowercase, so /docs/checks/s1 and /docs/checks/llms-txt-exists. */
export const slugFor = (id) => id.toLowerCase();

export function checksFromDocs(md) {
  const ca = section(md, 'Coding agents (AFDocs)');
  const fb = section(md, 'Coding agents without AFDocs (C1-C6)');
  const ai = section(md, 'AI search');
  return {
    source: 'packages/docs/checks.md',
    intro: { codingAgents: intro(ca), fallback: intro(fb), aiSearch: intro(ai) },
    codingAgents: table(ca, 'Coding agents (AFDocs)').map(([id, label, source, weight]) => ({ id, slug: slugFor(id), label, source, weight: Number(weight), ...details(ca, id) })),
    fallback: table(fb, 'Coding agents without AFDocs (C1-C6)').map(([id, label, points]) => ({ id, slug: slugFor(id), label, points: Number(points), ...details(fb, id) })),
    aiSearch: table(ai, 'AI search').map(([id, label, points]) => ({ id, slug: slugFor(id), label, points: Number(points), ...details(ai, id) })),
  };
}

export function render() {
  return JSON.stringify(checksFromDocs(fs.readFileSync(DOCS, 'utf8')), null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const next = render();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== next) { console.error('[Checks] frontend/src/checks.json is stale; run node frontend/scripts/checks-from-docs.mjs'); process.exit(1); }
    console.log('[Checks] frontend/src/checks.json matches packages/docs/checks.md');
  } else {
    fs.writeFileSync(OUT, next);
    console.log(`[Checks] wrote frontend/src/checks.json`);
  }
}
