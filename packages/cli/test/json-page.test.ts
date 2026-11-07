// SPDX-License-Identifier: MIT
// The --json page object (Req 5.6): pointsLost by check id, which is what a later
// run is compared with, and `change`. The same object goes into run records.
import { describe, expect, test } from 'vitest';
import { checkFromPage } from '@perseverance-ai/lensy-core';
import type { Report } from '@perseverance-ai/lensy-core';
import type { Change } from '../src/compare';
import { jsonPage, pointsLostOf, renderJson } from '../src/render-json';
import type { PageResult } from '../src/render-text';
import { replayAfdocs } from '../../core/test/afdocs-replay';
import { loadFixture, pageInputFromFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const META = { toolVersion: '0.0.0-test', engineCommit: 'test', checkedAt: '2026-10-22T12:00:00.000Z' };

async function reportOf(name: string): Promise<Report> {
  const { entries, expected } = loadFixture(name);
  return checkFromPage(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: NOW, loadAfdocs: replayAfdocs(name) });
}

const CHANGE: Change = {
  since: '2026-10-15T12:00:00.000Z', previousStatus: 'ok',
  codingAgents: { from: 80, to: 87, delta: 7 }, aiSearch: { from: 95, to: 95, delta: 0 },
  fixed: [{ id: 'llms-txt-exists', check: 'llms.txt exists' }], new: [], worse: [], better: [],
  lensyChanged: false, message: 'Coding agents 80 → 87 (+7), AI search 95 → 95 since 2026-10-15. Fixed: llms.txt exists.',
};

describe.each(['vitest-guide', 'stripe-payments'])('pointsLostOf: %s', (name) => {
  test('only checks that lost points, each a positive whole number', async () => {
    const r = await reportOf(name);
    const lost = pointsLostOf(r);
    expect(Object.keys(lost).length).toBeGreaterThan(0);
    for (const [id, n] of Object.entries(lost)) {
      expect(Number.isInteger(n) && n > 0, `${id}: ${n}`).toBe(true);
    }
  });

  test('they add up to 100 minus each score (the numbers of the short view)', async () => {
    const r = await reportOf(name);
    const lost = pointsLostOf(r);
    const sum = (ids: string[]) => ids.reduce((n, id) => n + (lost[id] ?? 0), 0);
    expect(sum(r.scores.codingAgents.checks.map(c => c.id))).toBe(100 - r.scores.codingAgents.score!);
    expect(sum(r.scores.aiSearch.checks.map(c => c.id))).toBe(100 - r.scores.aiSearch.score!);
  });

  test('every id is a check of the report', async () => {
    const r = await reportOf(name);
    const known = new Set([...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks].map(c => c.id));
    for (const id of Object.keys(pointsLostOf(r))) expect(known.has(id), id).toBe(true);
  });

  test('a passing check is not in the map', async () => {
    const r = await reportOf(name);
    const lost = pointsLostOf(r);
    for (const c of [...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks]) if (c.status === 'pass') expect(lost[c.id]).toBeUndefined();
  });
});

describe('jsonPage', () => {
  test('a checked page: url, status, scores, fixes, pointsLost, change and the report', async () => {
    const report = await reportOf('vitest-guide');
    const p = jsonPage({ url: report.url, report }, null);
    expect(Object.keys(p)).toEqual(['url', 'status', 'scores', 'fixes', 'pointsLost', 'change', 'report']);
    expect(p.status).toBe('ok');
    expect(p.scores).toEqual({ codingAgents: report.scores.codingAgents.score, aiSearch: report.scores.aiSearch.score });
    expect(p.change).toBeNull();
    expect(p.pointsLost).toEqual(pointsLostOf(report));
  });

  test('change is the object it is given', async () => {
    const report = await reportOf('vitest-guide');
    expect(jsonPage({ url: report.url, report }, CHANGE).change).toBe(CHANGE);
  });

  test('a page that could not be checked has its status, scores null, change and the report, but no fixes', async () => {
    const ok = await reportOf('vitest-guide');
    const report: Report = { ...ok, status: 'blocked', scores: { codingAgents: { score: null, coveredMax: 0, checks: [] }, aiSearch: { score: null, coveredMax: 0, checks: [] } } };
    const p = jsonPage({ url: 'https://blocked.example.com/', report }, CHANGE);
    expect(p).toMatchObject({ url: 'https://blocked.example.com/', status: 'blocked', scores: { codingAgents: null, aiSearch: null }, change: CHANGE });
    expect(p).not.toHaveProperty('fixes');
    expect(p).not.toHaveProperty('pointsLost');
  });

  test('an internal error has its status, the error and change', () => {
    expect(jsonPage({ url: 'https://x.example.com/', internalError: 'boom' }, null)).toEqual({ url: 'https://x.example.com/', status: 'internal-error', error: 'boom', change: null });
  });

  test('fixes are unchanged: their own pointsLost is a number, the page-level one is a map', async () => {
    const report = await reportOf('vitest-guide');
    const p = jsonPage({ url: report.url, report }, null);
    expect(typeof (p.fixes as { pointsLost: number }[])[0].pointsLost).toBe('number');
    expect(typeof p.pointsLost).toBe('object');
  });
});

describe('renderJson', () => {
  async function pages(): Promise<PageResult[]> {
    const a = await reportOf('vitest-guide');
    const b = await reportOf('stripe-payments');
    return [{ url: a.url, report: a }, { url: b.url, report: b }, { url: 'https://x.example.com/', internalError: 'boom' }];
  }

  test('without changes (not saving) every page has change: null', async () => {
    const doc = JSON.parse(renderJson(await pages(), META));
    expect(doc.pages.map((p: { change: unknown }) => p.change)).toEqual([null, null, null]);
    expect(doc).toMatchObject({ reportVersion: 1, tool: 'lensy', ...META });
  });

  test('with changes, one per page', async () => {
    const doc = JSON.parse(renderJson(await pages(), META, [CHANGE, null, null]));
    expect(doc.pages[0].change).toEqual(CHANGE);
    expect(doc.pages[1].change).toBeNull();
  });

  test('a page object in the document equals jsonPage(), so run records can hold the very same object', async () => {
    const ps = await pages();
    const changes = [CHANGE, null, null];
    const doc = JSON.parse(renderJson(ps, META, changes));
    ps.forEach((p, i) => expect(doc.pages[i]).toEqual(JSON.parse(JSON.stringify(jsonPage(p, changes[i])))));
  });

  test('the JSON ends with a newline and is indented by two spaces, as before', async () => {
    const text = renderJson(await pages(), META);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "pages": [\n');
  });
});
