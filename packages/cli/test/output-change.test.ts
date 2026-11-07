// SPDX-License-Identifier: MIT
// The comparison in the outputs (Req 4.9, 5.4, 5.5, 5.7): the terminal pieces on
// their own, the fix points and order in the files, and hostile text in the new
// section. The run-level behaviour is in save-run.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createColors } from 'picocolors';
import { checkFromPage } from '@perseverance-ai/lensy-core';
import type { Report } from '@perseverance-ai/lensy-core';
import type { Change } from '../src/compare';
import { buildReportDoc } from '../src/report-doc';
import type { DocInput } from '../src/report-doc';
import { renderHtml } from '../src/render-html';
import { pointsLostOf } from '../src/render-json';
import { renderMarkdown } from '../src/render-md';
import { renderBrief, renderPage, renderSummary } from '../src/render-text';
import type { PageResult } from '../src/render-text';
import { replayAfdocs } from '../../core/test/afdocs-replay';
import { loadFixture, pageInputFromFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });

const NOW = Date.parse('2026-11-08T18:30:12Z');
const TOOL = { version: '0.0.0-test', engineCommit: 'test', checkedAt: '2026-11-08T18:30:12.000Z' };
const PLAIN = createColors(false);
const COLOR = createColors(true);

async function reportOf(name: string): Promise<Report> {
  const { entries, expected } = loadFixture(name);
  return checkFromPage(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: NOW, loadAfdocs: replayAfdocs(name) });
}

const change = (over: Partial<Change> = {}): Change => ({
  since: '2026-11-01T18:30:12.000Z', previousStatus: 'ok',
  codingAgents: { from: 87, to: 91, delta: 4 }, aiSearch: { from: 95, to: 95, delta: 0 },
  fixed: [], new: [], worse: [], better: [], lensyChanged: false, message: '', ...over,
});

describe('the terminal: change lines under the scores', () => {
  test('one page: right after the scores line, before the reachability banner, indented two spaces', async () => {
    const r = await reportOf('vitest-guide');
    const text = renderPage(PLAIN, { url: r.url, report: r }, { width: 100, change: { change: change({ fixed: [{ id: 'a', check: 'Check A' }], new: [{ id: 'b', check: 'Check B' }] }), now: NOW } });
    const lines = text.split('\n');
    const scores = lines.findIndex(l => l.startsWith('  Coding agents '));
    expect(lines.slice(scores + 1, scores + 4)).toEqual([
      '  Since Nov 1 (7 days ago): Coding agents 87 → 91 (+4)    AI search 95 → 95',
      '  Fixed: Check A',
      '  New: Check B',
    ]);
    expect(lines[scores + 4]).toMatch(/^ {2}Reachability:/);
  });

  test('first saved run', async () => {
    const r = await reportOf('vitest-guide');
    const text = renderPage(PLAIN, { url: r.url, report: r }, { width: 100, change: { change: null, now: NOW } });
    expect(text).toContain('\n  First saved run for this page.\n');
  });

  test('without a ChangeView the output has none of it', async () => {
    const r = await reportOf('vitest-guide');
    expect(renderPage(PLAIN, { url: r.url, report: r }, { width: 100 })).not.toMatch(/Since|First saved|Fixed:|Last run/);
    expect(renderBrief(PLAIN, { url: r.url, report: r })).not.toMatch(/Since|First saved/);
  });

  test('--verbose adds Worse and Better, and the checks stay below', async () => {
    const r = await reportOf('vitest-guide');
    const c = change({ worse: [{ id: 'a', check: 'Check A', from: 3, to: 5 }], better: [{ id: 'b', check: 'Check B', from: 6, to: 2 }] });
    const verbose = renderPage(PLAIN, { url: r.url, report: r }, { verbose: true, width: 100, change: { change: c, now: NOW } });
    expect(verbose).toContain('\n  Worse: Check A (3 → 5 points lost)\n  Better: Check B (6 → 2 points lost)\n');
    expect(verbose).toMatch(/PASS\s+llms-txt-exists/);
    const short = renderPage(PLAIN, { url: r.url, report: r }, { width: 100, change: { change: c, now: NOW } });
    expect(short).not.toMatch(/Worse:|Better:/);
  });

  test('a long list wraps with a hang; a line that fits is never reflowed (the four-space gap stays)', async () => {
    const r = await reportOf('vitest-guide');
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, check: `A fairly long check name number ${i}` }));
    const text = renderPage(PLAIN, { url: r.url, report: r }, { width: 80, change: { change: change({ fixed: many }), now: NOW } });
    expect(text).toContain('  Since Nov 1 (7 days ago): Coding agents 87 → 91 (+4)    AI search 95 → 95\n');
    const block = text.split('\n').filter(l => /^ {2}Fixed:|^ {4}\S/.test(l)).slice(0, 4);
    expect(block[0].startsWith('  Fixed: A fairly long check name number 0')).toBe(true);
    expect(block.length).toBeGreaterThan(1);
    expect(block.every(l => l.length <= 80)).toBe(true);
    expect(block[1].startsWith('    ')).toBe(true);
  });

  test('colour: Fixed and Better green, New and Worse red, only the label', async () => {
    const r = await reportOf('vitest-guide');
    const c = change({ fixed: [{ id: 'a', check: 'A' }], new: [{ id: 'b', check: 'B' }], worse: [{ id: 'c', check: 'C', from: 1, to: 2 }], better: [{ id: 'd', check: 'D', from: 2, to: 1 }] });
    const text = renderPage(COLOR, { url: r.url, report: r }, { verbose: true, width: 100, change: { change: c, now: NOW } });
    expect(text).toContain(`  ${COLOR.green('Fixed:')} A`);
    expect(text).toContain(`  ${COLOR.red('New:')} B`);
    expect(text).toContain(`  ${COLOR.red('Worse:')} C`);
    expect(text).toContain(`  ${COLOR.green('Better:')} D`);
    const plain = renderPage(PLAIN, { url: r.url, report: r }, { verbose: true, width: 100, change: { change: c, now: NOW } });
    expect(plain).not.toMatch(/\x1b\[/);
  });

  test('a page that could not be checked keeps its message and adds what the last run scored', () => {
    const blocked: PageResult = { url: 'https://x.example.com/', report: { status: 'blocked', gate: { state: 'blocked', honestStatus: 403, robotsBlocks: [] } } as unknown as Report };
    const c = change({ codingAgents: { from: 87, to: null, delta: null }, aiSearch: { from: 95, to: null, delta: null } });
    const text = renderPage(PLAIN, blocked, { change: { change: c, now: NOW } });
    expect(text.split('\n')).toEqual([
      'https://x.example.com/',
      "  This site's bot protection refused lensy-cli (HTTP 403), so this page wasn't checked. Run the audit at https://perseveranceai.com instead.",
      '  Last run on Nov 1 (7 days ago) scored Coding agents 87, AI search 95.',
    ]);
    expect(renderBrief(PLAIN, blocked, 3, 100, { change: c, now: NOW })).toContain('  Last run on Nov 1 (7 days ago) scored');
  });
});

describe('several pages: the Change column (Req 5.7)', () => {
  async function pages(): Promise<PageResult[]> {
    const a = await reportOf('vitest-guide');
    const b = await reportOf('stripe-payments');
    const blocked: PageResult = { url: 'https://blocked.example.com/', report: { status: 'blocked', gate: { state: 'blocked', honestStatus: 403, robotsBlocks: [] } } as unknown as Report };
    return [{ url: a.url, report: a }, { url: b.url, report: b }, blocked, { url: 'https://boom.example.com/', internalError: 'boom' }];
  }

  test('after AI search and before Status, with +4 / 0, first run and dashes', async () => {
    const ps = await pages();
    const table = renderSummary(PLAIN, ps, [change(), null, change(), null]);
    const lines = table.split('\n');
    expect(lines[0]).toMatch(/^Page\s+Coding agents\s+AI search\s+Change\s+Status$/);
    expect(lines[1]).toMatch(/\s+\+4 \/ 0\s+ok$/);
    expect(lines[2]).toMatch(/\s+first run\s+ok$/);
    expect(lines[3]).toMatch(/\s+-\s+-\s+-\s+blocked$/);
    expect(lines[4]).toMatch(/\s+-\s+-\s+-\s+internal error$/);
  });

  test('without changes the table is exactly the old one', async () => {
    const table = renderSummary(PLAIN, await pages());
    expect(table.split('\n')[0]).toMatch(/^Page\s+Coding agents\s+AI search\s+Status$/);
    expect(table).not.toContain('Change');
  });

  test('columns stay aligned', async () => {
    const lines = renderSummary(PLAIN, await pages(), [change(), null, null, null]).split('\n');
    const at = (s: string, word: string) => s.indexOf(word);
    expect(at(lines[1], '+4 / 0')).toBe(at(lines[0], 'Change'));
    expect(at(lines[2], 'first run')).toBe(at(lines[0], 'Change'));
  });
});

describe('the files: fix points and order (Req 4.9)', () => {
  test.each(['vitest-guide', 'stripe-payments'])('%s: every fix shows whole scaled points, and they add up to the points lost in --json', async (name) => {
    const r = await reportOf(name);
    const doc = buildReportDoc([{ url: r.url, report: r }], TOOL);
    const gains = doc.pages[0].fixes.map(f => f.gain);
    expect(gains.every(Number.isInteger)).toBe(true);
    const checksWithFix = new Set([...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks].filter(c => c.fix).map(c => c.id));
    const lost = Object.entries(pointsLostOf(r)).filter(([id]) => checksWithFix.has(id)).reduce((n, [, v]) => n + v, 0);
    expect(gains.reduce((a, b) => a + b, 0)).toBe(lost);
  });

  test('fixes are ordered by the points shown, even where the website\'s raw order would differ', async () => {
    // Coding agents: one check losing 7 of 112 raw points scales to 6. AI search: one losing 6.6 of 100 scales to 7.
    // Raw, the first is bigger (7 > 6.6); scaled, the second is (7 > 6).
    const base = await reportOf('vitest-guide');
    const check = (id: string, max: number, points: number) => ({ id, source: 'lensy', label: `Check ${id}`, max, points, status: 'warn' as const, detail: `detail ${id}`, fix: `Add something for ${id}.` });
    const report: Report = {
      ...base,
      scores: {
        codingAgents: { score: 94, coveredMax: 100, checks: [check('C2', 112, 105)] },
        aiSearch: { score: 93, coveredMax: 100, checks: [check('S4', 100, 93.4)] },
      },
    };
    const fixes = buildReportDoc([{ url: report.url, report }], TOOL).pages[0].fixes;
    expect(fixes.map(f => [f.id, f.gain])).toEqual([['S4', 7], ['C2', 6]]);
    expect(renderMarkdown(buildReportDoc([{ url: report.url, report }], TOOL))).toMatch(/\*\*S4\*\* \(\+7 points\)[\s\S]*\*\*C2\*\* \(\+6 points\)/);
  });

  test('a fix shared by two scores is worth both losses', async () => {
    const base = await reportOf('vitest-guide');
    const shared = (id: string) => ({ id, source: 'lensy', label: 'Content without JavaScript', max: 20, points: 10, status: 'warn' as const, detail: 'd', fix: 'Serve the content in the HTML.' });
    const report: Report = { ...base, scores: { codingAgents: { score: 90, coveredMax: 100, checks: [shared('C1'), { ...shared('C6'), label: 'x', max: 80, points: 80, status: 'pass' as const, fix: undefined }] }, aiSearch: { score: 90, coveredMax: 100, checks: [shared('S2'), { ...shared('S1'), label: 'y', max: 80, points: 80, status: 'pass' as const, fix: undefined }] } } };
    const fixes = buildReportDoc([{ url: report.url, report }], TOOL).pages[0].fixes;
    expect(fixes.length).toBe(1);
    expect(fixes[0]).toMatchObject({ id: 'C1, S2', gain: 20 }); // 10 of 100 in each score
  });
});

describe('"Since last run" in the files (Req 5.5)', () => {
  const hostile = '<script>alert(1)</script> | [x](https://x.example) *bold*';
  const withChange = async (c: Change | null | undefined): Promise<DocInput[]> => {
    const r = await reportOf('vitest-guide');
    return [{ url: r.url, report: r, change: c }];
  };

  test('absent when results are not saved', async () => {
    const doc = buildReportDoc(await withChange(undefined), TOOL);
    expect(doc.pages[0].since).toBeUndefined();
    expect(renderMarkdown(doc)).not.toContain('Since last run');
    expect(renderHtml(doc)).not.toContain('Since last run');
  });

  test('between the summary and the first group of checks, in both formats', async () => {
    const doc = buildReportDoc(await withChange(change({ fixed: [{ id: 'a', check: 'Check A' }] })), TOOL);
    const md = renderMarkdown(doc);
    const at = (h: string) => md.indexOf(h);
    expect(at('### Summary')).toBeLessThan(at('### Since last run'));
    expect(at('### Since last run')).toBeLessThan(at('### Both audiences'));
    expect(md).toContain('### Since last run\n\n- Compared with the run on 2026-11-01.\n- Coding agents 87 → 91 (+4)\n- AI search 95 → 95\n- Fixed: Check A\n');
    const html = renderHtml(doc);
    expect(html.indexOf('<h3>Summary</h3>')).toBeLessThan(html.indexOf('<h3>Since last run</h3>'));
    expect(html.indexOf('<h3>Since last run</h3>')).toBeLessThan(html.indexOf('<h3>Both audiences</h3>'));
    expect(html).toContain('<li>Fixed: Check A</li>');
  });

  test('a first run says so', async () => {
    const md = renderMarkdown(buildReportDoc(await withChange(null), TOOL));
    expect(md).toContain('### Since last run\n\n- First saved run for this page.\n');
  });

  test('text from the scanned site is escaped in both formats', async () => {
    const doc = buildReportDoc(await withChange(change({ fixed: [{ id: 'a', check: hostile }], new: [{ id: 'b', check: hostile }] })), TOOL);
    const md = renderMarkdown(doc);
    expect(md).not.toContain('<script>');
    expect(md).toContain('\\<script\\>alert(1)\\</script\\> \\| \\[x\\](https://x.example) \\*bold\\*');
    const html = renderHtml(doc);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
  });

  test('the HTML stays offline and script-free with the new section', async () => {
    const html = renderHtml(buildReportDoc(await withChange(change()), TOOL));
    expect(html).not.toMatch(/(src|href)\s*=\s*["']?\s*(https?:)?\/\//i);
    expect(html).not.toMatch(/<link|@import|url\(/i);
  });

  test('a page that could not be checked gets the section after its message', async () => {
    const input: DocInput = { url: 'https://x.example.com/', report: { status: 'blocked', gate: { state: 'blocked', honestStatus: 403, robotsBlocks: [] }, notes: [] } as unknown as Report, change: change({ codingAgents: { from: 87, to: null, delta: null }, aiSearch: { from: 95, to: null, delta: null } }) };
    const md = renderMarkdown(buildReportDoc([input], TOOL));
    expect(md.indexOf("wasn't checked")).toBeLessThan(md.indexOf('### Since last run'));
    expect(md).toContain('- Last run on 2026-11-01 scored Coding agents 87, AI search 95.');
    const html = renderHtml(buildReportDoc([input], TOOL));
    expect(html).toContain('<h3>Since last run</h3>');
  });

  test('a page that could not be checked, when results are not saved, renders exactly as before', async () => {
    const input: DocInput = { url: 'https://x.example.com/', report: { status: 'blocked', gate: { state: 'blocked', honestStatus: 403, robotsBlocks: [] }, notes: [] } as unknown as Report };
    expect(renderHtml(buildReportDoc([input], TOOL))).toContain(`instead.</p></section>`);
    expect(renderMarkdown(buildReportDoc([input], TOOL))).not.toContain('Since last run');
  });
});
