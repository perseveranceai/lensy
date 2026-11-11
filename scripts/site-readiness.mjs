#!/usr/bin/env node
// Adds one daily run of `lensy check --json` to the site's readiness history.
// Used by .github/workflows/site-readiness.yml; the home page chart reads the
// result from /readiness/history.json.
//
// To keep the file small (the home page loads it), each run stores only the two
// site-wide scores. The latest run also keeps each page's scores, for working out
// a drop. A day where any page couldn't be checked isn't recorded at all, so the
// chart only shows complete days.
//
// usage: node scripts/site-readiness.mjs --report report.json --history history.json --out history.json
// Writes nothing to --out when the day isn't recorded.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_RUNS = 1100; // about three years of daily runs

const log = (...a) => console.log('[SiteReadiness]', ...a);

/** One history row from a lensy JSON report, or { skipped } when a page couldn't be checked. */
export function runFromReport(report) {
  if (!report || !Array.isArray(report.pages)) throw new Error('report has no pages');
  const pages = [];
  const failed = [];
  for (const p of report.pages) {
    const ca = p?.report?.scores?.codingAgents?.score;
    const ai = p?.report?.scores?.aiSearch?.score;
    const path = new URL(p.url).pathname;
    if (p.status !== 'ok' || typeof ca !== 'number' || typeof ai !== 'number') { failed.push(path); continue; }
    pages.push({ path, codingAgents: Math.round(ca), aiSearch: Math.round(ai) });
  }
  if (!pages.length) throw new Error('no page could be checked, so there is nothing to record');
  if (failed.length) return { skipped: failed.sort() };
  const mean = (k) => Math.round(pages.reduce((s, p) => s + p[k], 0) / pages.length);
  const checkedAt = report.checkedAt || new Date().toISOString();
  return {
    date: checkedAt.slice(0, 10),
    checkedAt,
    cli: report.toolVersion || 'unknown',
    engine: report.engineCommit || 'unknown',
    codingAgents: mean('codingAgents'),
    aiSearch: mean('aiSearch'),
    pages: pages.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** History with `run` added. A second run on the same date replaces the first. Only the newest run keeps its pages. */
export function addRun(history, run) {
  const base = history && Array.isArray(history.runs) ? history : { version: 1, site: 'https://perseveranceai.com', runs: [] };
  const runs = base.runs.filter((r) => r.date !== run.date).concat(run)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_RUNS)
    .map((r, i, all) => {
      if (i === all.length - 1) return r;
      const { pages, checkedAt, ...rest } = r;
      return rest;
    });
  return { ...base, version: 1, runs };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const reportFile = arg('--report');
  const historyFile = arg('--history');
  const outFile = arg('--out');
  if (!reportFile || !historyFile || !outFile) {
    console.error('usage: site-readiness.mjs --report <file> --history <file> --out <file>');
    process.exit(2);
  }
  const run = runFromReport(JSON.parse(fs.readFileSync(reportFile, 'utf8')));
  if (run.skipped) {
    log(`not recorded: these pages couldn't be checked today: ${run.skipped.join(', ')}`);
    process.exit(0);
  }
  const history = addRun(JSON.parse(fs.readFileSync(historyFile, 'utf8')), run);
  fs.writeFileSync(outFile, JSON.stringify(history) + '\n');
  log(`${run.date}: Coding agents ${run.codingAgents}, AI search ${run.aiSearch} on ${run.pages.length} pages; ${history.runs.length} runs in history`);
}
