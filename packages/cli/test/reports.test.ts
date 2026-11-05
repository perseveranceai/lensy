// SPDX-License-Identifier: MIT
// --html and --md (Req 3.2-3.6): one structure, golden files lock it at
// reportVersion 1, the HTML loads nothing, and page content is escaped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkFromPage } from '@perseverance-ai/lensy-core';
import { buildReportDoc, DocInput } from '../src/report-doc';
import { renderHtml } from '../src/render-html';
import { renderMarkdown } from '../src/render-md';
import { EXIT, Io, run } from '../src/main';
import { ALL_CHECKS, explainCheck } from '../src/explain';
import { replayAfdocs } from '../../core/test/afdocs-replay';
import { loadFixture, pageInputFromFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const TOOL = { version: '0.0.0-test', engineCommit: 'test', checkedAt: '2026-10-22T12:00:00.000Z' };
const GOLDEN = path.join(__dirname, 'golden');

async function inputs(): Promise<DocInput[]> {
  const out: DocInput[] = [];
  for (const name of ['stripe-payments', 'vitest-guide']) {
    const { entries, expected } = loadFixture(name);
    out.push({ url: expected.url, report: await checkFromPage(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: NOW, loadAfdocs: replayAfdocs(name) }) });
  }
  out.push({ url: 'https://blocked.example.com/docs', report: { ...out[0].report!, status: 'blocked', gate: { state: 'blocked', honestStatus: 403, robotsBlocks: [] } } });
  return out;
}

function golden(name: string, actual: string) {
  const file = path.join(GOLDEN, name);
  if (process.env.LENSY_UPDATE_GOLDEN === '1') { fs.mkdirSync(GOLDEN, { recursive: true }); fs.writeFileSync(file, actual); }
  expect(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `${name} changed: if this is intended and reportVersion 1 stays compatible, rerun with LENSY_UPDATE_GOLDEN=1`).toBe(actual);
}

describe('report structure (reportVersion 1)', () => {
  test('Markdown matches the golden file', async () => {
    golden('report.md', renderMarkdown(buildReportDoc(await inputs(), TOOL)));
  });
  test('HTML matches the golden file', async () => {
    golden('report.html', renderHtml(buildReportDoc(await inputs(), TOOL)));
  });

  test('sections come in the required order for each checked page', async () => {
    // vitest-guide has tips, so every section appears.
    const md = renderMarkdown(buildReportDoc((await inputs()).slice(1, 2), TOOL));
    const order = ['### Summary', '### Both audiences', '### Coding agents', '### AI search', '### Fixes', '### Tips'].map(h => md.indexOf(h));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('metadata: front matter in Markdown, meta tags in HTML', async () => {
    const doc = buildReportDoc(await inputs(), TOOL);
    const md = renderMarkdown(doc);
    expect(md.startsWith('---\nreportVersion: 1\ntool: "lensy"\ntoolVersion: "0.0.0-test"\nengineCommit: "test"\ncheckedAt: "2026-10-22T12:00:00.000Z"\nmode: "url"\npages:\n')).toBe(true);
    expect(md).toContain('  - url: "https://blocked.example.com/docs"\n    status: "blocked"\n    codingAgents: null');
    const html = renderHtml(doc);
    for (const k of ['reportVersion', 'tool', 'toolVersion', 'engineCommit', 'checkedAt', 'mode', 'pages']) expect(html).toContain(`<meta name="lensy:${k}"`);
  });

  test('fixes: each once, ordered by points to gain, with check ids', async () => {
    const doc = buildReportDoc((await inputs()).slice(0, 1), TOOL);
    const gains = doc.pages[0].fixes.map(f => f.gain);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    expect(new Set(doc.pages[0].fixes.map(f => f.fix)).size).toBe(gains.length);
    const ids = new Set(ALL_CHECKS.map(c => c.id));
    expect(doc.pages[0].fixes.every(f => f.id.split(', ').every(id => ids.has(id)))).toBe(true);
    expect(renderMarkdown(doc)).toMatch(/^- \[ \] \*\*S4\*\* \(\+15 points\)/m);
  });
});

describe('HTML loads nothing and runs nothing', () => {
  test('no script, no external URLs, no imports', async () => {
    const html = renderHtml(buildReportDoc(await inputs(), TOOL));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)\s*=\s*["']?\s*(https?:)?\/\//i);
    expect(html).not.toMatch(/<link|@import|url\(/i);
  });

  test('page content is escaped in both formats', async () => {
    const [first] = await inputs();
    const evil = '<script>alert(1)</script> | <img src=https://x.example/a.png> [link](https://x.example)';
    const r = first.report!;
    const hostile: DocInput = { url: first.url, report: { ...r, scores: { ...r.scores, codingAgents: { ...r.scores.codingAgents, checks: r.scores.codingAgents.checks.map(c => ({ ...c, detail: evil })) } } } };
    const doc = buildReportDoc([hostile], TOOL);
    const html = renderHtml(doc);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const md = renderMarkdown(doc);
    expect(md).not.toContain('<script>');
    expect(md).toContain('\\<script\\>alert(1)\\</script\\> \\| \\<img');
  });
});

function io(fetchImpl?: typeof fetch) {
  let out = '', err = '';
  const v: Io = { stdout: { write: (s: string) => { out += s; } }, stderr: { write: (s: string) => { err += s; } }, env: {}, fetchImpl, loadAfdocs: replayAfdocs('vitest-guide'), version: '0.0.0-test', now: () => NOW };
  return { io: v, out: () => out, err: () => err };
}

describe('lensy check --html / --md', () => {
  test('writes both files and says where', async () => {
    const f = loadFixture('vitest-guide');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lensy-'));
    const html = path.join(dir, 'r.html'), md = path.join(dir, 'r.md');
    const t = io(replayFetch(f.entries));
    expect(await run(['check', f.expected.url, '--html', html, '--md', md], t.io)).toBe(EXIT.ok);
    expect(fs.readFileSync(html, 'utf8')).toContain('<!doctype html>');
    expect(fs.readFileSync(md, 'utf8')).toContain('reportVersion: 1');
    expect(t.out()).toContain(`Report written to ${html}`);
    expect(t.out()).toContain(`Report written to ${md}`);
    expect(t.out()).not.toContain('Full results: rerun');
    fs.rmSync(dir, { recursive: true });
  });

  test('a missing folder is a usage error before any request', async () => {
    let calls = 0;
    const t = io((async () => { calls++; return new Response(''); }) as typeof fetch);
    expect(await run(['check', 'https://docs.example.com', '--html', path.join(os.tmpdir(), 'no-such-dir-lensy', 'r.html')], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain("doesn't exist");
    expect(calls).toBe(0);
  });
});

describe('lensy explain', () => {
  test.each(ALL_CHECKS.map(c => c.id))('%s', async (id) => {
    const t = io();
    expect(await run(['explain', id.toLowerCase()], t.io)).toBe(EXIT.ok);
    expect(t.out()).toBe(explainCheck(id) + '\n');
    expect(t.out()).toContain('Why it matters:');
    expect(t.out()).toContain('Evidence:');
  });

  test('an unknown id exits 2 and lists the ids', async () => {
    const t = io();
    expect(await run(['explain', 'C9'], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain('No check called "C9". Checks: C1, C2');
  });
});
