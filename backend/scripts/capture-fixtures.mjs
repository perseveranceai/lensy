#!/usr/bin/env node
// Captures scoring fixtures for the two-score readiness tests
// (docs/two-score-readiness/tasks.md 2.1, spec §9.1).
//
// For each page it runs the reference prototype (docs/two-score-readiness/prototype.mjs)
// with every fetch() recorded: the HTML, the Accept: text/markdown response, the .md
// URL, robots.txt, sitemap files, llms.txt and the sampled llms.txt link statuses.
// Then it re-runs the prototype offline against what was saved and keeps that
// output as the expected per-check points. Both runs must agree, or the fixture
// is not a faithful copy of what the prototype saw.
//
// Usage (needs open internet, so run it on a laptop or in GitHub Actions, not in Lambda):
//   node backend/scripts/capture-fixtures.mjs               # every page below
//   node backend/scripts/capture-fixtures.mjs stripe-payments react-learn
//   node backend/scripts/capture-fixtures.mjs --url https://example.com/docs --name example
//
// Output: backend/lambda/agent-handler/tools/__tests__/fixtures/<name>/
//   responses.json.gz   every request and response, gzipped
//   expected.json       prototype output when replayed from responses.json.gz
//   live.json           prototype output from the live run (for the §5 comparison)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const prototype = path.join(repo, 'docs', 'two-score-readiness', 'prototype.mjs');
const hook = path.join(here, 'fixture-fetch-hook.mjs');
const outRoot = path.join(repo, 'backend', 'lambda', 'agent-handler', 'tools', '__tests__', 'fixtures');

// The 9 pages in spec §5 and the test URLs U-1, U-2, U-4 to U-7 (§12).
export const PAGES = [
  { name: 'vitepress-getting-started', url: 'https://vitepress.dev/guide/getting-started' },
  { name: 'vitest-guide', url: 'https://vitest.dev/guide/' },
  { name: 'mintlify-quickstart', url: 'https://mintlify.com/docs/quickstart' },
  { name: 'fern-overview', url: 'https://buildwithfern.com/learn/docs/getting-started/overview' },
  { name: 'stripe-payments', url: 'https://docs.stripe.com/payments' },
  { name: 'docusaurus-docs', url: 'https://docusaurus.io/docs' },
  { name: 'react-learn', url: 'https://react.dev/learn' },
  { name: 'branch-home', url: 'https://help.branch.io/' },
  { name: 'branch-onboarding', url: 'https://help.branch.io/account-hub/onboarding-guide' },
  { name: 'u1-stripe-api', url: 'https://docs.stripe.com/api' },
  { name: 'u2-github-rest', url: 'https://docs.github.com/en/rest' },
  { name: 'u4-redoc', url: 'https://redocly.github.io/redoc/' },
  { name: 'u5-lua-manual', url: 'https://www.lua.org/manual/5.4/manual.html' },
  { name: 'u6-reddit-api', url: 'https://www.reddit.com/dev/api' },
  { name: 'u7-zoom-library', url: 'https://library.zoom.com' },
];

function runPrototype(url, mode, file) {
  const r = spawnSync(process.execPath, ['--import', hook, prototype, url], {
    env: { ...process.env, FIXTURE_MODE: mode, FIXTURE_FILE: file },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`prototype (${mode}) failed for ${url}: ${r.stderr}`);
  return { out: JSON.parse(r.stdout), stderr: r.stderr };
}

// Per-check points only; the details carry the page age, which moves with the clock.
const points = (o) => Object.fromEntries(['coding', 'search'].flatMap(b =>
  Object.entries(o[b]?.checks || {}).map(([k, v]) => [`${b}:${k}`, v.pts])));

function capture({ name, url }) {
  const dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'responses.json.gz');
  const live = runPrototype(url, 'record', file).out;
  const replay = runPrototype(url, 'replay', file);
  fs.writeFileSync(path.join(dir, 'live.json'), JSON.stringify(live, null, 1) + '\n');
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({ url, ...replay.out }, null, 1) + '\n');
  const a = points(live), b = points(replay.out);
  const diffs = Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]);
  const netErrors = (live.netErrors || []).length;
  console.log(`${name}: coding ${live.coding?.total} search ${live.search?.total} gate ${live.gate?.state}` +
    `${netErrors ? ` NET ERRORS ${netErrors}` : ''}${diffs.length ? ` REPLAY DIFFERS: ${diffs.join(', ')}` : ''}` +
    `${replay.stderr.trim() ? `\n  ${replay.stderr.trim().split('\n').join('\n  ')}` : ''}`);
  return { name, ok: !diffs.length && !netErrors };
}

const args = process.argv.slice(2);
let targets = PAGES;
if (args.includes('--url')) {
  const url = args[args.indexOf('--url') + 1];
  const name = args.includes('--name') ? args[args.indexOf('--name') + 1] : new URL(url).hostname.replace(/\W+/g, '-');
  targets = [{ name, url }];
} else if (args.length) {
  targets = PAGES.filter(p => args.includes(p.name));
}

const results = targets.map(t => {
  try { return capture(t); } catch (e) { console.log(`${t.name}: FAILED ${e.message}`); return { name: t.name, ok: false }; }
});
const bad = results.filter(r => !r.ok).map(r => r.name);
if (bad.length) { console.log(`\nNeeds a re-run: ${bad.join(' ')}`); process.exit(1); }
