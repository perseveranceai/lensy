// SPDX-License-Identifier: MIT
// Comparing a page with its previous run (Req 5.1-5.3, 5.6, 8.4) and the texts
// that show it: terminal lines, file lines and table cells. Dates are checked in a
// fixed timezone; one test switches it to prove the terminal uses the local one.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ageText, changeCell, changeLines, compare, shortDate, signed, sinceLines } from '../src/compare';
import type { Change, CurrentRun } from '../src/compare';
import type { RunRecord, SavedPage } from '../src/store';

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });

const URL1 = 'https://docs.example.com/guide';
const SINCE = '2026-11-01T18:30:12.000Z';
const NOW_ISO = '2026-11-08T18:30:12.000Z';
const NOW = Date.parse(NOW_ISO);
const DAY = 86_400_000;

interface Spec {
  status?: string;
  coding?: number | null;
  search?: number | null;
  /** points lost by check id (the page's pointsLost map) */
  lost?: Record<string, number>;
  /** check id -> label; ids not listed here are labelled with their id */
  labels?: Record<string, string>;
  /** ids of checks that did not run (points null) */
  unknown?: string[];
  /** leave the report out, as a hand-trimmed file might */
  noReport?: boolean;
}

/** A saved page. Ids starting S1..S9 belong to AI search, everything else to Coding agents. */
function page(s: Spec = {}): SavedPage {
  const ids = [...new Set([...Object.keys(s.labels ?? {}), ...Object.keys(s.lost ?? {})])];
  const scores: Record<'codingAgents' | 'aiSearch', { checks: object[] }> = { codingAgents: { checks: [] }, aiSearch: { checks: [] } };
  for (const id of ids) {
    const key = /^S\d$/.test(id) ? 'aiSearch' : 'codingAgents';
    scores[key].checks.push({ id, label: s.labels?.[id] ?? id, points: (s.unknown ?? []).includes(id) ? null : 0, max: 10 });
  }
  const status = s.status ?? 'ok';
  return {
    url: URL1,
    status,
    scores: { codingAgents: s.coding === undefined ? 87 : s.coding, aiSearch: s.search === undefined ? 95 : s.search },
    pointsLost: s.lost ?? {},
    ...(s.noReport ? {} : { report: { scores } }),
  };
}
const prevRec = (s: Spec = {}, meta: Partial<RunRecord> = {}): RunRecord => ({ recordVersion: 1, tool: 'lensy', toolVersion: '0.1.0', engineCommit: 'abc1234', checkedAt: SINCE, page: page(s), ...meta });
const curRun = (s: Spec = {}, meta: Partial<CurrentRun> = {}): CurrentRun => ({ toolVersion: '0.1.0', engineCommit: 'abc1234', checkedAt: NOW_ISO, page: page(s), ...meta });
const change = (prev: Spec, cur: Spec, pm: Partial<RunRecord> = {}, cm: Partial<CurrentRun> = {}): Change => {
  const c = compare(prevRec(prev, pm), curRun(cur, cm));
  if (!c) throw new Error('expected a change');
  return c;
};
const ids = (items: { id: string }[]) => items.map(i => i.id);

describe('compare: no previous run', () => {
  test('null', () => expect(compare(null, curRun())).toBeNull());
});

describe('compare: scores (Req 5.2)', () => {
  test('from, to and delta for each score', () => {
    const c = change({ coding: 87, search: 95 }, { coding: 91, search: 95 });
    expect(c.codingAgents).toEqual({ from: 87, to: 91, delta: 4 });
    expect(c.aiSearch).toEqual({ from: 95, to: 95, delta: 0 });
    expect(c.since).toBe(SINCE);
    expect(c.previousStatus).toBe('ok');
  });
  test('a drop is a negative delta', () => {
    expect(change({ coding: 90, search: 80 }, { coding: 85, search: 82 }).codingAgents.delta).toBe(-5);
  });
  test('a capped score is compared as it is reported', () => {
    expect(change({ coding: 59 }, { coding: 66 }).codingAgents).toEqual({ from: 59, to: 66, delta: 7 });
  });
  test.each([[0, 100, 100], [100, 0, -100], [0, 0, 0]])('%s -> %s', (from, to, delta) => {
    expect(change({ coding: from }, { coding: to }).codingAgents.delta).toBe(delta);
  });
});

describe('compare: fixed, new, worse, better (Req 5.2)', () => {
  const L = { a: 'Check A', b: 'Check B', c: 'Check C', d: 'Check D', e: 'Check E', S1: 'Bots allowed', S4: 'Freshness' };

  test('fixed: lost points before, lose none now', () => {
    const c = change({ lost: { a: 6 }, labels: L }, { lost: {}, labels: L });
    expect(c.fixed).toEqual([{ id: 'a', check: 'Check A' }]);
    expect([c.new, c.worse, c.better]).toEqual([[], [], []]);
  });

  test('new: lost no points before, lose some now', () => {
    const c = change({ lost: {}, labels: L }, { lost: { b: 3 }, labels: L });
    expect(c.new).toEqual([{ id: 'b', check: 'Check B' }]);
    expect([c.fixed, c.worse, c.better]).toEqual([[], [], []]);
  });

  test('worse and better: lose points in both runs, more or fewer now, with the points', () => {
    const c = change({ lost: { a: 3, b: 6, c: 4 }, labels: L }, { lost: { a: 5, b: 2, c: 4 }, labels: L });
    expect(c.worse).toEqual([{ id: 'a', check: 'Check A', from: 3, to: 5 }]);
    expect(c.better).toEqual([{ id: 'b', check: 'Check B', from: 6, to: 2 }]);
    expect([c.fixed, c.new]).toEqual([[], []]); // c lost the same: not mentioned at all
  });

  test('a check present in only one run is treated as losing nothing in the other (Req 5.2)', () => {
    const gone = change({ lost: { a: 4 }, labels: { a: 'Check A' } }, { lost: {}, labels: {} });
    expect(gone.fixed).toEqual([{ id: 'a', check: 'Check A' }]); // lost before, absent now
    const appeared = change({ lost: {}, labels: {} }, { lost: { b: 4 }, labels: { b: 'Check B' } });
    expect(appeared.new).toEqual([{ id: 'b', check: 'Check B' }]); // absent before, loses now
    const absentBoth = change({ lost: {}, labels: {} }, { lost: {}, labels: {} });
    expect([absentBoth.fixed, absentBoth.new, absentBoth.worse, absentBoth.better]).toEqual([[], [], [], []]);
  });

  test('a check that passes in both runs is not mentioned', () => {
    const c = change({ lost: {}, labels: L }, { lost: {}, labels: L });
    expect([c.fixed, c.new, c.worse, c.better]).toEqual([[], [], [], []]);
  });

  test('checks of both scores are matched by id', () => {
    const c = change({ lost: { a: 5, S1: 4 }, labels: L }, { lost: { S1: 0, S4: 6 }, labels: L });
    expect(ids(c.fixed)).toEqual(['a', 'S1']);
    expect(ids(c.new)).toEqual(['S4']);
  });

  test('the label of a fixed check comes from the current run, else from the previous one', () => {
    const renamed = change({ lost: { a: 4 }, labels: { a: 'Old name' } }, { lost: {}, labels: { a: 'New name' } });
    expect(renamed.fixed[0].check).toBe('New name');
    const gone = change({ lost: { a: 4 }, labels: { a: 'Old name' } }, { lost: {}, labels: {} });
    expect(gone.fixed[0].check).toBe('Old name');
  });

  test('without a report, a check is labelled with its id', () => {
    const c = change({ lost: { 'llms-txt-exists': 5 }, noReport: true }, { lost: {}, noReport: true });
    expect(c.fixed).toEqual([{ id: 'llms-txt-exists', check: 'llms-txt-exists' }]);
  });

  test('lists are ordered by points: fixed and new by points, worse and better by size of change, then by name', () => {
    const labels = { a: 'A', b: 'B', c: 'C', d: 'D' };
    const c = change({ lost: { a: 2, b: 9, c: 2, d: 5 }, labels }, { lost: {}, labels });
    expect(ids(c.fixed)).toEqual(['b', 'd', 'a', 'c']);
    const w = change({ lost: { a: 1, b: 1, c: 5 }, labels }, { lost: { a: 3, b: 9, c: 6 }, labels });
    expect(ids(w.worse)).toEqual(['b', 'a', 'c']);
    const bt = change({ lost: { a: 9, b: 6, c: 5 }, labels }, { lost: { a: 8, b: 1, c: 4 }, labels });
    expect(ids(bt.better)).toEqual(['b', 'a', 'c']);
  });

  describe('a check scored twice (C1, S2, AFDocs rendering-strategy) counts once, as in the short view', () => {
    const labels = { 'rendering-strategy': 'Content without JavaScript', S2: 'Content without JavaScript' };
    test('fixed in both scores: one entry, with the coding agents id', () => {
      const c = change({ lost: { 'rendering-strategy': 10, S2: 20 }, labels }, { lost: {}, labels });
      expect(c.fixed).toEqual([{ id: 'rendering-strategy', check: 'Content without JavaScript' }]);
    });
    test('new in both scores: one entry', () => {
      const c = change({ lost: {}, labels }, { lost: { 'rendering-strategy': 10, S2: 20 }, labels });
      expect(c.new.length).toBe(1);
    });
    test('their points are added up for worse and better', () => {
      const c = change({ lost: { 'rendering-strategy': 5, S2: 5 }, labels }, { lost: { 'rendering-strategy': 10, S2: 10 }, labels });
      expect(c.worse).toEqual([{ id: 'rendering-strategy', check: 'Content without JavaScript', from: 10, to: 20 }]);
    });
    test('C1 is the same check in the fallback scoring', () => {
      const c = change({ lost: { C1: 10, S2: 10 }, labels: { C1: 'Content without JavaScript', S2: 'Content without JavaScript' } }, { lost: {}, labels: { C1: 'x', S2: 'x' } });
      expect(c.fixed.length).toBe(1);
    });
  });

  describe('a check that did not run (points null) can be neither fixed nor new', () => {
    test('unknown now: no claim that it was fixed', () => {
      const c = change({ lost: { a: 6 }, labels: L }, { lost: {}, labels: L, unknown: ['a'] });
      expect(c.fixed).toEqual([]);
    });
    test('unknown before: no claim that it is new', () => {
      const c = change({ lost: {}, labels: L, unknown: ['a'] }, { lost: { a: 6 }, labels: L });
      expect(c.new).toEqual([]);
    });
    test('unknown in either run: not worse or better either', () => {
      const w = change({ lost: { a: 2 }, labels: L }, { lost: { a: 6 }, labels: L, unknown: ['a'] });
      expect([w.worse, w.better]).toEqual([[], []]);
    });
    test('other checks are still compared', () => {
      const c = change({ lost: { a: 6, b: 4 }, labels: L }, { lost: {}, labels: L, unknown: ['a'] });
      expect(ids(c.fixed)).toEqual(['b']);
    });
  });
});

describe('compare: a run that was not ok (Req 5.2, 5.4, 8.4)', () => {
  test('previous blocked, current ok: scores from null, no check comparison', () => {
    const c = change({ status: 'blocked', coding: null, search: null }, { coding: 87, search: 95, lost: { a: 4 }, labels: { a: 'A' } });
    expect(c.previousStatus).toBe('blocked');
    expect(c.codingAgents).toEqual({ from: null, to: 87, delta: null });
    expect(c.aiSearch).toEqual({ from: null, to: 95, delta: null });
    expect([c.fixed, c.new, c.worse, c.better]).toEqual([[], [], [], []]);
    expect(c.message).toBe("Checked 2026-11-08; the run on 2026-11-01 couldn't check this page (blocked).");
  });

  test('a previous run with leftover scores is still treated as null when it was not ok', () => {
    const c = change({ status: 'unreachable', coding: 50, search: 50 }, { coding: 87 });
    expect(c.codingAgents.from).toBeNull();
  });

  test('previous ok, current blocked: scores to null', () => {
    const c = change({ coding: 87, search: 95, lost: { a: 3 }, labels: { a: 'A' } }, { status: 'blocked', coding: null, search: null });
    expect(c.codingAgents).toEqual({ from: 87, to: null, delta: null });
    expect([c.fixed, c.new, c.worse, c.better]).toEqual([[], [], [], []]);
    expect(c.message).toBe("Couldn't check this page on 2026-11-08 (blocked). On 2026-11-01 it scored Coding agents 87, AI search 95.");
  });

  test('both not ok', () => {
    const c = change({ status: 'unreachable', coding: null, search: null }, { status: 'not-html', coding: null, search: null });
    expect(c.message).toBe("Couldn't check this page on 2026-11-08 (not HTML). The run on 2026-11-01 couldn't check it either (unreachable).");
  });

  test.each([['blocked', 'blocked'], ['unreachable', 'unreachable'], ['not-html', 'not HTML'], ['internal-error', 'internal error']])('%s is worded as "%s"', (status, word) => {
    expect(change({ status, coding: null, search: null }, {}).message).toContain(`(${word})`);
  });
});

describe('compare: Lensy changed between the runs (Req 5.3)', () => {
  test('same tool version and engine: no note', () => {
    const c = change({}, {});
    expect(c.lensyChanged).toBe(false);
    expect(c).not.toHaveProperty('lensyFrom');
    expect(c).not.toHaveProperty('lensyTo');
  });
  test('a different tool version', () => {
    const c = change({}, {}, { toolVersion: '0.1.0' }, { toolVersion: '0.2.0' });
    expect(c.lensyChanged).toBe(true);
    expect([c.lensyFrom, c.lensyTo]).toEqual(['0.1.0 (abc1234)', '0.2.0 (abc1234)']);
  });
  test('a different engine commit', () => {
    const c = change({}, {}, {}, { engineCommit: 'def5678' });
    expect(c.lensyChanged).toBe(true);
    expect([c.lensyFrom, c.lensyTo]).toEqual(['0.1.0 (abc1234)', '0.1.0 (def5678)']);
  });
  test('the message mentions it', () => {
    expect(change({}, {}, {}, { engineCommit: 'def5678' }).message).toMatch(/Lensy changed between these runs, so some differences may come from Lensy\.$/);
  });
});

describe('compare: the message (Req 5.6)', () => {
  const labels = { 'llms-txt-directive-html': 'Page points agents to llms.txt (HTML)', md: 'Markdown on request', x: 'Check X' };

  test('the example from the spec, word for word', () => {
    const c = change({ coding: 87, search: 95, lost: { 'llms-txt-directive-html': 6 }, labels }, { coding: 91, search: 95, lost: {}, labels });
    expect(c.message).toBe('Coding agents 87 → 91 (+4), AI search 95 → 95 since 2026-11-01. Fixed: Page points agents to llms.txt (HTML).');
  });
  test('with new problems too', () => {
    const c = change({ coding: 87, search: 95, lost: { 'llms-txt-directive-html': 6 }, labels }, { coding: 91, search: 93, lost: { md: 4 }, labels });
    expect(c.message).toBe('Coding agents 87 → 91 (+4), AI search 95 → 93 (-2) since 2026-11-01. Fixed: Page points agents to llms.txt (HTML). New: Markdown on request.');
  });
  test('nothing changed', () => {
    expect(change({}, {}).message).toBe('Coding agents 87 → 87, AI search 95 → 95 since 2026-11-01.');
  });
  test('long lists are cut after 5, with a count', () => {
    const many = Object.fromEntries('abcdefgh'.split('').map(k => [k, 'Check ' + k.toUpperCase()]));
    const lost = Object.fromEntries('abcdefgh'.split('').map(k => [k, 3]));
    const c = change({ lost, labels: many }, { lost: {}, labels: many });
    expect(c.fixed.length).toBe(8);
    expect(c.message).toContain('Fixed: Check A, Check B, Check C, Check D, Check E, +3 more.');
  });
  test('it is one line', () => {
    expect(change({ lost: { x: 3 }, labels }, { lost: {}, labels }).message).not.toContain('\n');
  });
});

describe('compare: odd old files never throw (Req 8.4)', () => {
  const odd = (page: Partial<SavedPage> & Record<string, unknown>): RunRecord => ({ recordVersion: 1, tool: 'lensy', toolVersion: '0.1.0', engineCommit: 'abc1234', checkedAt: SINCE, page: { url: URL1, status: 'ok', ...page } });

  test.each<[string, Record<string, unknown>]>([
    ['no scores', {}],
    ['scores are strings', { scores: { codingAgents: '87', aiSearch: '95' } }],
    ['NaN and infinity scores', { scores: { codingAgents: NaN, aiSearch: Infinity } }],
    ['pointsLost is an array', { pointsLost: [1, 2] }],
    ['pointsLost holds junk', { pointsLost: { a: 'lots', b: -3, c: NaN, d: null, e: {}, f: 0 } }],
    ['report is a string', { report: 'text' }],
    ['report.scores is an array', { report: { scores: [] } }],
    ['checks is not an array', { report: { scores: { codingAgents: { checks: 'x' }, aiSearch: null } } }],
    ['a check without an id', { report: { scores: { codingAgents: { checks: [{}, null, 5, 'x', { id: 7 }] } } } }],
  ])('previous run with %s', (_what, page) => {
    expect(() => compare(odd(page), curRun({ lost: { a: 3 }, labels: { a: 'A' } }))).not.toThrow();
    const c = compare(odd(page), curRun({ lost: { a: 3 }, labels: { a: 'A' } }))!;
    expect(c.fixed).toEqual([]);
    expect(typeof c.message).toBe('string');
  });

  test('the same odd shapes as the current run', () => {
    expect(() => compare(prevRec(), { toolVersion: '0.1.0', engineCommit: 'abc1234', checkedAt: NOW_ISO, page: { url: URL1, status: 'ok', pointsLost: [] as unknown as Record<string, number>, report: 'x' as unknown as SavedPage['report'] } })).not.toThrow();
  });

  test('an unreadable date in the previous run', () => {
    const c = compare(prevRec({}, { checkedAt: 'last tuesday' }), curRun())!;
    expect(c.since).toBe('last tuesday');
    expect(c.message).toContain('since an earlier run.');
    expect(() => changeLines(c, NOW)).not.toThrow();
    expect(changeLines(c, NOW)[0]).toMatch(/^Since an earlier run: /);
    expect(() => sinceLines(c)).not.toThrow();
  });

  test('the change is plain JSON that survives a round trip', () => {
    const c = change({ lost: { a: 3 }, labels: { a: 'A' } }, { lost: {}, labels: { a: 'A' } }, {}, { engineCommit: 'zzz' });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  test('it is deterministic', () => {
    const args = [{ lost: { a: 3, b: 4 }, labels: { a: 'A', b: 'B' } }, { lost: { b: 6 }, labels: { a: 'A', b: 'B' } }] as const;
    expect(change(...args)).toEqual(change(...args));
  });
});

describe('ageText and shortDate (Req 5.4)', () => {
  test.each([
    [0, 'today'], [-3, 'today'], [1, 'yesterday'], [2, '2 days ago'], [7, '7 days ago'], [13, '13 days ago'],
    [14, '2 weeks ago'], [20, '2 weeks ago'], [21, '3 weeks ago'], [60, '8 weeks ago'], [400, '57 weeks ago'],
  ])('%s days', (days, text) => expect(ageText(days)).toBe(text));

  test('a date in the current year has no year; another year has one', () => {
    expect(shortDate(Date.parse('2026-11-01T18:30:12Z'), NOW)).toBe('Nov 1');
    expect(shortDate(Date.parse('2025-11-01T18:30:12Z'), NOW)).toBe('Nov 1, 2025');
    expect(shortDate(Date.parse('2026-01-09T10:00:00Z'), NOW)).toBe('Jan 9');
  });

  test('signed', () => {
    expect([signed(4), signed(0), signed(-3)]).toEqual(['+4', '0', '-3']);
  });
});

describe('changeLines: the terminal (Req 5.4)', () => {
  const labels = { a: 'Check A', b: 'Check B', c: 'Check C', d: 'Check D', e: 'Check E', f: 'Check F', g: 'Check G' };
  const lines = (prev: Spec, cur: Spec, now = NOW, opts: { verbose?: boolean } = {}, pm: Partial<RunRecord> = {}, cm: Partial<CurrentRun> = {}) =>
    changeLines(change(prev, cur, pm, cm), now, opts);

  test('the example from the spec', () => {
    const l = lines({ coding: 87, search: 95, lost: { a: 6 }, labels }, { coding: 91, search: 95, lost: { b: 3 }, labels });
    expect(l).toEqual([
      'Since Nov 1 (7 days ago): Coding agents 87 → 91 (+4)    AI search 95 → 95',
      'Fixed: Check A',
      'New: Check B',
    ]);
  });

  test('no previous run', () => {
    expect(changeLines(null, NOW)).toEqual(['First saved run for this page.']);
  });

  test('Fixed and New appear only when they have items', () => {
    expect(lines({}, {})).toEqual(['Since Nov 1 (7 days ago): Coding agents 87 → 87    AI search 95 → 95']);
  });

  test('at most 5 items, then +N more', () => {
    const l = lines({ lost: { a: 7, b: 6, c: 5, d: 4, e: 3, f: 2, g: 1 }, labels }, { lost: {}, labels });
    expect(l[1]).toBe('Fixed: Check A, Check B, Check C, Check D, Check E, +2 more');
    const exactly5 = lines({ lost: { a: 5, b: 4, c: 3, d: 2, e: 1 }, labels }, { lost: {}, labels });
    expect(exactly5[1]).toBe('Fixed: Check A, Check B, Check C, Check D, Check E');
  });

  test('worse and better only with --verbose, with from -> to points lost', () => {
    const prev = { lost: { a: 3, b: 6 }, labels };
    const cur = { lost: { a: 5, b: 2 }, labels };
    expect(lines(prev, cur)).toHaveLength(1);
    expect(lines(prev, cur, NOW, { verbose: true })).toEqual([
      'Since Nov 1 (7 days ago): Coding agents 87 → 87    AI search 95 → 95',
      'Worse: Check A (3 → 5 points lost)',
      'Better: Check B (6 → 2 points lost)',
    ]);
  });

  describe('ages', () => {
    const at = (days: number, hours = 0) => Date.parse(SINCE) + days * DAY + hours * 3_600_000;
    test.each([
      [0, 'Since today:'], [0.04, 'Since today:'], [1, 'Since yesterday:'], [2, 'Since Nov 1 (2 days ago):'], [7, 'Since Nov 1 (7 days ago):'],
      [13, 'Since Nov 1 (13 days ago):'], [14, 'Since Nov 1 (2 weeks ago):'], [49, 'Since Nov 1 (7 weeks ago):'],
    ])('%s days later', (days, start) => {
      expect(lines({}, {}, at(days))[0].startsWith(start)).toBe(true);
    });

    test('by calendar day, not by 24-hour blocks: late evening to early morning is "yesterday"', () => {
      const since = '2026-11-01T23:50:00.000Z';
      const l = changeLines(change({}, {}, { checkedAt: since }), Date.parse('2026-11-02T00:10:00.000Z'));
      expect(l[0].startsWith('Since yesterday:')).toBe(true);
    });

    test('another year shows the year', () => {
      const l = changeLines(change({}, {}, { checkedAt: '2025-11-01T18:30:12.000Z' }), NOW);
      expect(l[0].startsWith('Since Nov 1, 2025 (')).toBe(true);
      expect(l[0]).toContain('weeks ago)');
    });

    test('a previous run that seems to be in the future does not break (clock changes)', () => {
      expect(lines({}, {}, Date.parse(SINCE) - 5 * DAY)[0].startsWith('Since today:')).toBe(true);
    });
  });

  test('the local timezone decides the day shown', () => {
    const since = '2026-11-02T03:00:00.000Z'; // still Nov 1 in Los Angeles
    const c = change({}, {}, { checkedAt: since });
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(changeLines(c, Date.parse('2026-11-09T20:00:00.000Z'))[0].startsWith('Since Nov 1 (8 days ago):')).toBe(true);
    } finally {
      process.env.TZ = 'UTC';
    }
    expect(changeLines(c, Date.parse('2026-11-09T20:00:00.000Z'))[0].startsWith('Since Nov 2 (7 days ago):')).toBe(true);
  });

  test('Lensy changed: the note says what changed', () => {
    const l = lines({}, {}, NOW, {}, {}, { engineCommit: 'def5678' });
    expect(l[l.length - 1]).toBe('Lensy changed between these runs (0.1.0 (abc1234) → 0.1.0 (def5678)), so some differences may come from Lensy, not your docs.');
  });

  test('the previous run could not check the page', () => {
    expect(lines({ status: 'blocked', coding: null, search: null }, {})).toEqual(["Last run on Nov 1 couldn't check this page (blocked)."]);
    expect(lines({ status: 'not-html', coding: null, search: null }, {})).toEqual(["Last run on Nov 1 couldn't check this page (not HTML)."]);
  });

  test('this run could not check the page, the last one could: what it scored then', () => {
    expect(lines({ coding: 87, search: 95 }, { status: 'blocked', coding: null, search: null })).toEqual(['Last run on Nov 1 (7 days ago) scored Coding agents 87, AI search 95.']);
  });

  test('neither run could check the page: nothing to add to the message the page already shows', () => {
    expect(lines({ status: 'blocked', coding: null, search: null }, { status: 'blocked', coding: null, search: null })).toEqual([]);
  });
});

describe('sinceLines: the Markdown and HTML reports (Req 5.5)', () => {
  const labels = { a: 'Check A', b: 'Check B', c: 'Check C', d: 'Check D', e: 'Check E', f: 'Check F', g: 'Check G' };

  test('ISO dates, every item (no cut at 5), and worse and better', () => {
    const c = change({ coding: 87, search: 95, lost: { a: 7, b: 6, c: 5, d: 4, e: 3, f: 2, g: 1 } , labels }, { coding: 91, search: 95, lost: {}, labels });
    expect(sinceLines(c)).toEqual([
      'Compared with the run on 2026-11-01.',
      'Coding agents 87 → 91 (+4)',
      'AI search 95 → 95',
      'Fixed: Check A, Check B, Check C, Check D, Check E, Check F, Check G',
    ]);
    const m = change({ lost: { a: 3, b: 6 }, labels }, { lost: { a: 5, b: 2, c: 4 }, labels });
    expect(sinceLines(m)).toEqual([
      'Compared with the run on 2026-11-01.',
      'Coding agents 87 → 87',
      'AI search 95 → 95',
      'New: Check C',
      'Worse: Check A (3 → 5 points lost)',
      'Better: Check B (6 → 2 points lost)',
    ]);
  });

  test('no previous run, and runs that could not check the page', () => {
    expect(sinceLines(null)).toEqual(['First saved run for this page.']);
    expect(sinceLines(change({ status: 'blocked', coding: null, search: null }, {}))).toEqual(["Last run on 2026-11-01 couldn't check this page (blocked)."]);
    expect(sinceLines(change({ coding: 80, search: 90 }, { status: 'unreachable', coding: null, search: null }))).toEqual(['Last run on 2026-11-01 scored Coding agents 80, AI search 90.']);
    expect(sinceLines(change({ status: 'blocked', coding: null, search: null }, { status: 'blocked', coding: null, search: null }))).toEqual(["Last run on 2026-11-01 couldn't check this page either (blocked)."]);
  });

  test('the Lensy note', () => {
    const l = sinceLines(change({}, {}, {}, { toolVersion: '0.2.0' }));
    expect(l[l.length - 1]).toContain('Lensy changed between these runs (0.1.0 (abc1234) → 0.2.0 (abc1234))');
  });

  test('dates are UTC days, whatever the local timezone', () => {
    const c = change({}, {}, { checkedAt: '2026-11-02T03:00:00.000Z' });
    process.env.TZ = 'America/Los_Angeles';
    try { expect(sinceLines(c)[0]).toBe('Compared with the run on 2026-11-02.'); } finally { process.env.TZ = 'UTC'; }
  });
});

describe('changeCell (Req 4.7, 5.7)', () => {
  test('+4 / 0', () => {
    expect(changeCell(change({ coding: 87, search: 95 }, { coding: 91, search: 95 }), true)).toBe('+4 / 0');
    expect(changeCell(change({ coding: 90, search: 80 }, { coding: 85, search: 82 }), true)).toBe('-5 / +2');
    expect(changeCell(change({}, {}), true)).toBe('0 / 0');
  });
  test('first run', () => {
    expect(changeCell(null, true)).toBe('first run');
    expect(changeCell(null, true, true)).toBe('first run');
  });
  test('a page that could not be checked: a dash in the terminal, "not checked" in history.md', () => {
    const c = change({ coding: 87, search: 95 }, { status: 'blocked', coding: null, search: null });
    expect(changeCell(c, false)).toBe('-');
    expect(changeCell(c, false, true)).toBe('not checked');
    expect(changeCell(null, false)).toBe('-');
    expect(changeCell(null, false, true)).toBe('not checked');
  });
  test('the previous run could not check the page: nothing to compare, a dash', () => {
    expect(changeCell(change({ status: 'blocked', coding: null, search: null }, {}), true)).toBe('-');
  });
});
