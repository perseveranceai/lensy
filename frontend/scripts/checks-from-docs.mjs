#!/usr/bin/env node
// Writes frontend/src/checks.json, the check list the How it works page shows,
// from packages/docs/checks.md. That file is generated from the engine's check
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

/** Table rows under the first "## <title>" heading, as arrays of cells. */
function table(md, title) {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`checks.md has no "## ${title}" section`);
  const rows = [];
  for (const line of md.slice(start + 1).split('\n').slice(1)) {
    if (line.startsWith('## ') || line.startsWith('### ')) break;
    if (!line.startsWith('|') || /^\|\s*(ID|---)/.test(line)) continue;
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
  }
  if (!rows.length) throw new Error(`no rows under "## ${title}"`);
  return rows;
}

export function checksFromDocs(md) {
  return {
    source: 'packages/docs/checks.md',
    codingAgents: table(md, 'Coding agents (AFDocs)').map(([id, label, source, weight]) => ({ id, label, source, weight: Number(weight) })),
    aiSearch: table(md, 'AI search').map(([id, label, points]) => ({ id, label, points: Number(points) })),
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
