// SPDX-License-Identifier: MIT
// A saving run, end to end in process (Req 3.4-3.5, 4, 5, 8.3): what is printed and
// written, run after run, over the saved fixtures. The clock is fixed and moved on;
// the timezone is UTC so dates are the same everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/main';
import { resolvePageFolder } from '../src/page-folder';
import { DAY, T0, listFiles, makeIo, makeProject, replayFetch, stripe, useTempDirs, vitest } from './helpers';

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });

const tmp = useTempDirs();
const V = vitest();
const S = stripe();
const URL1 = V.expected.url;
const URL2 = S.expected.url;
const ENTRIES = [...V.entries, ...S.entries];

/** A project with a clock that can be moved, and a switch that makes `blockedHost` refuse the tool. */
function project() {
  const { root, home } = makeProject(tmp);
  const state = { now: T0, block: [] as string[] };
  const replay = replayFetch(ENTRIES);
  const fetchImpl = (async (input: any, init?: RequestInit) =>
    state.block.some(h => String(input).startsWith(h))
      ? new Response('denied', { status: 403, headers: { 'content-type': 'text/html' } })
      : replay(input, init)) as typeof fetch;
  const lensy = path.join(root, '.lensy');
  const go = async (args: string[], over: { cwd?: string; env?: Record<string, string> } = {}) => {
    const t = makeIo({ cwd: over.cwd ?? root, home, fetchImpl, now: () => state.now, env: over.env });
    const code = await run(['check', ...args], t.io);
    return { code, out: t.out(), err: t.err() };
  };
  const pageDir = (url: string) => resolvePageFolder(lensy, url).dir;
  const read = (rel: string) => fs.readFileSync(path.join(lensy, rel), 'utf8');
  const latest = (url: string) => JSON.parse(fs.readFileSync(path.join(pageDir(url), 'latest.json'), 'utf8'));
  const edit = (url: string, change: (record: any) => void) => {
    const file = path.join(pageDir(url), 'latest.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    change(record);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
  };
  const strays = () => listFiles(lensy).filter(n => /(^|\/)(\.lock|\.write-test-.*|.*\.tmp-.*)$/.test(n));
  return { root, home, lensy, state, go, pageDir, read, latest, edit, strays };
}

const ADDED = /^(  Since |  First saved run|  Fixed:|  New:|  Worse:|  Better:|  Lensy changed|  Last run on |Results saved in )/;
/** The output without the lines saving adds, to compare with a run that does not save. */
const tidyBlank = (out: string) => out.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
const withoutAdded = (out: string) => tidyBlank(out.split('\n').filter(l => !ADDED.test(l)).join('\n'));

describe('the first saved run of a page', () => {
  test('says so under the scores, then ends with where the results are', async () => {
    const p = project();
    const r = await p.go([URL1, '--save']);
    expect(r.code).toBe(EXIT.ok);
    const lines = r.out.split('\n');
    const scores = lines.findIndex(l => /^  Coding agents \d+\/100 {4}AI search \d+\/100/.test(l));
    expect(lines[scores + 1]).toBe('  First saved run for this page.');
    expect(r.out.trimEnd().endsWith('Results saved in .lensy')).toBe(true);
    expect(r.err).toBe('');
  });

  test('writes the layout of the spec, with a run named by the start time and no strays', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    expect(listFiles(p.lensy)).toEqual([
      'history.md', 'latest.md',
      'pages/vitest.dev/guide/index/latest.json', 'pages/vitest.dev/guide/index/latest.md',
      'pages/vitest.dev/guide/index/page.json', 'pages/vitest.dev/guide/index/runs/2026-11-08T183012Z.json',
    ]);
  });

  test('the history has one row: first run', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    const rows = p.read('history.md').split('\n').filter(l => l.startsWith('| 20'));
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatch(/^\| 2026-11-08 18:30 \| https:\/\/vitest\.dev\/guide\/ \| \d+ \| \d+ \| first run \|/);
  });

  test('the run record: version, tool, versions, start time, and the page object with change null', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    const rec = p.latest(URL1);
    expect(rec).toMatchObject({ recordVersion: 1, tool: 'lensy', toolVersion: '0.0.0-test', checkedAt: '2026-11-08T18:30:12.000Z' });
    expect(typeof rec.engineCommit).toBe('string');
    expect(rec.page).toMatchObject({ url: URL1, status: 'ok', change: null });
    expect(rec.page.pointsLost).toBeTypeOf('object');
    expect(rec.page.report.scores.codingAgents.checks.length).toBeGreaterThan(0);
  });
});

describe('the next run', () => {
  test('a run that does not save neither saves nor compares; the next saving run compares with the last saved one', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    p.state.now = T0 + 7 * DAY;
    const unsaved = await p.go([URL1]); // no flag, no config, no terminal: not saved, so nothing to compare
    expect(unsaved.out).not.toMatch(/Since|First saved|Results saved/);
    expect(fs.readdirSync(path.join(p.pageDir(URL1), 'runs')).length).toBe(1);
    p.state.now = T0 + 14 * DAY;
    const saved = await p.go([URL1, '--save']);
    expect(saved.out).toMatch(/^  Since Nov 8 \(2 weeks ago\): Coding agents (\d+) → \1    AI search (\d+) → \2$/m);
  });

  test('the same page twice, a week apart: unchanged scores, "Since Nov 8 (7 days ago)", and no Fixed or New', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    p.state.now = T0 + 7 * DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.out).toMatch(/^  Since Nov 8 \(7 days ago\): Coding agents (\d+) → \1    AI search (\d+) → \2$/m);
    expect(r.out).not.toMatch(/^  (Fixed|New):/m);
    expect(r.out).not.toContain('First saved run');
    expect(p.latest(URL1).page.change).toMatchObject({ since: '2026-11-08T18:30:12.000Z', previousStatus: 'ok', fixed: [], new: [], worse: [], better: [], lensyChanged: false });
  });

  test('"today" and "yesterday": by calendar day, against the last saved run', async () => {
    const p = project();
    await p.go([URL1, '--save']); // T0
    p.state.now = T0 + 60_000;
    expect((await p.go([URL1, '--save'])).out).toMatch(/^  Since today: /m); // a minute after the last run
    p.state.now = T0 + DAY + 60_000;
    expect((await p.go([URL1, '--save'])).out).toMatch(/^  Since yesterday: /m); // exactly a day after the last run
    p.state.now = T0 + DAY + 120_000;
    expect((await p.go([URL1, '--save'])).out).toMatch(/^  Since today: /m); // a minute after that one
  });

  test('two runs a week apart keep two run files, and the history grows newest first', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    p.state.now = T0 + 7 * DAY;
    await p.go([URL1, '--save']);
    expect(fs.readdirSync(path.join(p.pageDir(URL1), 'runs')).sort()).toEqual(['2026-11-08T183012Z.json', '2026-11-15T183012Z.json']);
    const rows = p.read('history.md').split('\n').filter(l => l.startsWith('| 20'));
    expect(rows.map(r => r.slice(2, 18))).toEqual(['2026-11-15 18:30', '2026-11-08 18:30']);
    expect(rows[0]).toMatch(/\| 0 \/ 0 \|/);
    expect(rows[1]).toContain('| first run |');
  });

  test('Fixed, New, Worse and Better, from a saved record that is edited to differ', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    const before = p.latest(URL1);
    const lost: Record<string, number> = before.page.pointsLost;
    const ids = Object.keys(lost);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const [worseId, betterId, newId] = ids;
    const labelOf = (id: string) => [...before.page.report.scores.codingAgents.checks, ...before.page.report.scores.aiSearch.checks].find((c: { id: string }) => c.id === id).label;
    // Make the last saved run differ from what the fixtures give now. A saving run replaces
    // latest.json, so the edit is applied again before each run that is compared with it.
    const makePreviousDiffer = () => p.edit(URL1, rec => {
      rec.page.scores.codingAgents = before.page.scores.codingAgents - 7; // so it is better now, by 7
      rec.page.pointsLost = { ...lost, [worseId]: Math.max(1, lost[worseId] - 1), [betterId]: lost[betterId] + 2, 'a-check-we-fixed': 5 };
      delete rec.page.pointsLost[newId]; // it lost no points before, but loses some now
      if (!rec.page.report.scores.codingAgents.checks.some((c: { id: string }) => c.id === 'a-check-we-fixed')) {
        rec.page.report.scores.codingAgents.checks.push({ id: 'a-check-we-fixed', label: 'A check we fixed', points: 0, max: 5 });
      }
    });
    makePreviousDiffer();
    p.state.now = T0 + 7 * DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.out).toMatch(new RegExp(`^  Since Nov 8 \\(7 days ago\\): Coding agents ${before.page.scores.codingAgents - 7} → ${before.page.scores.codingAgents} \\(\\+7\\)`, 'm'));
    expect(r.out).toMatch(/^  Fixed: A check we fixed$/m);
    expect(r.out).toContain(`New: ${labelOf(newId)}`);
    expect(r.out).not.toMatch(/^  Worse:/m); // Worse and Better only with --verbose
    expect(r.out).not.toMatch(/^  Better:/m);

    makePreviousDiffer();
    p.state.now = T0 + 14 * DAY;
    const verbose = (await p.go([URL1, '--save', '--verbose'])).out.replace(/\s+/g, ' ');
    expect(verbose).toContain(`Worse: ${labelOf(worseId)} (${Math.max(1, lost[worseId] - 1)} → ${lost[worseId]} points lost)`);
    expect(verbose).toContain(`Better: ${labelOf(betterId)} (${lost[betterId] + 2} → ${lost[betterId]} points lost)`);
    // The saved record carries all four.
    const change = p.latest(URL1).page.change;
    expect(change.fixed.map((c: { check: string }) => c.check)).toEqual(['A check we fixed']);
    expect(change.new.map((c: { id: string }) => c.id)).toEqual([newId]);
    expect(change.worse[0]).toMatchObject({ id: worseId, from: Math.max(1, lost[worseId] - 1), to: lost[worseId] });
    expect(change.better[0]).toMatchObject({ id: betterId, from: lost[betterId] + 2, to: lost[betterId] });
  });

  test('Lensy changed between the runs: the note is shown', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    p.edit(URL1, rec => { rec.toolVersion = '0.0.1'; });
    p.state.now = T0 + DAY;
    const r = await p.go([URL1, '--save']);
    const flat = r.out.replace(/\s+/g, ' '); // the note is wrapped at 80 columns
    expect(flat).toContain('Lensy changed between these runs (0.0.1 (');
    expect(flat).toContain('→ 0.0.0-test ('); // the same note, with the new version
    expect(flat).toContain('so some differences may come from Lensy, not your docs.');
    expect(p.latest(URL1).page.change.lensyChanged).toBe(true);
  });
});

describe('without saving the output is exactly what it was (Req 5.8)', () => {
  test('one page: a saving run differs only by the lines saving adds', async () => {
    const p = project();
    const plain = await p.go([URL1, '--no-save']);
    const first = await p.go([URL1, '--save']);
    expect(withoutAdded(first.out)).toBe(tidyBlank(plain.out));
    p.state.now = T0 + 7 * DAY;
    const second = await p.go([URL1, '--save']);
    expect(withoutAdded(second.out)).toBe(tidyBlank(plain.out));
  });

  test('--no-save: no comparison, no closing line, no files, change null in the JSON', async () => {
    const p = project();
    await p.go([URL1, '--save']); // there is a previous run on disk
    p.state.now = T0 + DAY;
    const r = await p.go([URL1, '--no-save', '--json', '-']);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out).pages[0].change).toBeNull();
    expect(r.err).toBe('');
    expect(fs.readdirSync(path.join(p.pageDir(URL1), 'runs')).length).toBe(1); // nothing was added
    const text = await p.go([URL1, '--no-save']);
    expect(text.out).not.toMatch(/Since|First saved|Results saved/);
  });

  test('several pages without saving: the table has no Change column', async () => {
    const p = project();
    const r = await p.go([URL1, URL2, '--no-save']);
    expect(r.out).toMatch(/^Page\s+Coding agents\s+AI search\s+Status$/m);
    expect(r.out).not.toContain('Change');
  });

  test('a run with nothing decided and no terminal saves nothing', async () => {
    const p = project();
    const r = await p.go([URL1]);
    expect(fs.existsSync(p.lensy)).toBe(false);
    expect(r.out).not.toMatch(/Since|First saved|Results saved/);
  });
});

describe('several pages (Req 5.7)', () => {
  test('the table gets a Change column after AI search; each block shows its Since line', async () => {
    const p = project();
    const first = await p.go([URL1, URL2, '--save']);
    expect(first.out).toMatch(/^Page\s+Coding agents\s+AI search\s+Change\s+Status$/m);
    expect(first.out).toMatch(/^https:\/\/vitest\.dev\/guide\/\s+\d+\/100\s+\d+\/100\s+first run\s+ok$/m);
    expect((first.out.match(/^  First saved run for this page\.$/gm) ?? []).length).toBe(2);
    expect(first.out.match(/Results saved in/g)?.length).toBe(1);
    p.state.now = T0 + 7 * DAY;
    const second = await p.go([URL1, URL2, '--save']);
    expect(second.out).toMatch(/^https:\/\/vitest\.dev\/guide\/\s+\d+\/100\s+\d+\/100\s+0 \/ 0\s+ok$/m);
    expect((second.out.match(/^  Since Nov 8 \(7 days ago\): /gm) ?? []).length).toBe(2);
    expect(second.out.match(/Results saved in/g)?.length).toBe(1);
  });

  test('two pages, two folders, and a history row each, in the order given', async () => {
    const p = project();
    await p.go([URL2, URL1, '--save']);
    const rows = p.read('history.md').split('\n').filter(l => l.startsWith('| 20'));
    expect(rows.map(r => r.split(' | ')[1])).toEqual([URL2, URL1]);
    expect(listFiles(p.lensy).filter(f => f.endsWith('/latest.json')).length).toBe(2);
  });

  test('--verbose gives every page its change lines', async () => {
    const p = project();
    await p.go([URL1, URL2, '--save']);
    p.state.now = T0 + DAY;
    const r = await p.go([URL1, URL2, '--save', '--verbose']);
    expect((r.out.match(/^  Since yesterday: /gm) ?? []).length).toBe(2);
  });

  test('the same URL twice is checked and saved once', async () => {
    const p = project();
    await p.go([URL1, URL1, '--save']);
    expect(listFiles(p.lensy).filter(f => f.includes('/runs/')).length).toBe(1);
    expect(p.read('history.md').split('\n').filter(l => l.startsWith('| 20')).length).toBe(1);
  });
});

describe('a page that could not be checked (Req 5.4, 8.4)', () => {
  test('ok, then blocked: saved with its status, and the terminal says it was not checked', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    const was = p.latest(URL1).page.scores;
    p.state.block = ['https://vitest.dev'];
    p.state.now = T0 + 7 * DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.code).toBe(EXIT.notChecked);
    expect(r.out).toContain("so this page wasn't checked.");
    expect(r.out).toContain(`Last run on Nov 8 (7 days ago) scored Coding agents ${was.codingAgents}, AI search ${was.aiSearch}.`);
    const rec = p.latest(URL1);
    expect(rec.page.status).toBe('blocked');
    expect(rec.page.scores).toEqual({ codingAgents: null, aiSearch: null });
    expect(rec.page.change).toMatchObject({ previousStatus: 'ok', codingAgents: { from: was.codingAgents, to: null, delta: null } });
    expect(p.read('history.md').split('\n').find(l => l.startsWith('| 2026-11-15'))).toMatch(/\| - \| - \| not checked \| {2}\| {2}\|$/);
  });

  test('blocked, then ok: the last run could not check the page', async () => {
    const p = project();
    p.state.block = ['https://vitest.dev'];
    const first = await p.go([URL1, '--save']);
    expect(first.code).toBe(EXIT.notChecked);
    expect(p.latest(URL1).page.status).toBe('blocked');
    p.state.block = [];
    p.state.now = T0 + 7 * DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("Last run on Nov 8 couldn't check this page (blocked).");
    expect(p.latest(URL1).page.change).toMatchObject({ previousStatus: 'blocked', codingAgents: { from: null }, fixed: [], new: [] });
    expect(p.latest(URL1).page.change.message).toBe("Checked 2026-11-15; the run on 2026-11-08 couldn't check this page (blocked).");
    expect(p.read('history.md').split('\n').find(l => l.startsWith('| 2026-11-15'))).toContain('| - |');
  });

  test('blocked twice: the page message is not repeated or contradicted', async () => {
    const p = project();
    p.state.block = ['https://vitest.dev'];
    await p.go([URL1, '--save']);
    p.state.now = T0 + DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.out).not.toContain('Last run on');
    expect(r.out.match(/wasn't checked/g)?.length).toBe(1);
  });

  test('in a table: the Change cell of a blocked page is a dash', async () => {
    const p = project();
    p.state.block = ['https://vitest.dev'];
    const r = await p.go([URL1, URL2, '--save']);
    expect(r.out).toMatch(/^https:\/\/vitest\.dev\/guide\/\s+-\s+-\s+-\s+blocked$/m);
    expect(r.out).toMatch(/^https:\/\/docs\.stripe\.com\S*\s+\d+\/100\s+\d+\/100\s+first run\s+ok$/m);
  });
});

describe('a broken previous run does not stop this one (Req 5.1)', () => {
  test('a truncated latest.json: the newest valid run file is used', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    p.state.now = T0 + DAY;
    await p.go([URL1, '--save']);
    fs.writeFileSync(path.join(p.pageDir(URL1), 'latest.json'), '{"recordVersion":1,"page":{"url":');
    p.state.now = T0 + 3 * DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toMatch(/^  Since Nov 9 \(2 days ago\): /m); // compared with the second run, from runs/
    expect(JSON.parse(fs.readFileSync(path.join(p.pageDir(URL1), 'latest.json'), 'utf8')).page.change.since).toBe('2026-11-09T18:30:12.000Z');
  });

  test('nothing valid at all: it is a first run', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    const dir = p.pageDir(URL1);
    fs.writeFileSync(path.join(dir, 'latest.json'), 'garbage');
    for (const f of fs.readdirSync(path.join(dir, 'runs'))) fs.writeFileSync(path.join(dir, 'runs', f), '[]');
    p.state.now = T0 + DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain('First saved run for this page.');
    expect(p.latest(URL1).page.change).toBeNull();
  });

  test('a previous record with the wrong recordVersion is ignored', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    p.edit(URL1, rec => { rec.recordVersion = 2; });
    const dir = p.pageDir(URL1);
    for (const f of fs.readdirSync(path.join(dir, 'runs'))) fs.rmSync(path.join(dir, 'runs', f));
    p.state.now = T0 + DAY;
    expect((await p.go([URL1, '--save'])).out).toContain('First saved run');
  });

  test('a page folder where page.json says another URL gets its own folder (Req 4.3)', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    fs.writeFileSync(path.join(p.pageDir(URL1), 'page.json'), JSON.stringify({ url: 'https://vitest.dev/guide/#someone-else' }));
    p.state.now = T0 + DAY;
    const r = await p.go([URL1, '--save']);
    expect(r.out).toContain('First saved run'); // the old data belongs to another URL
    expect(listFiles(p.lensy).filter(f => f.endsWith('/page.json')).length).toBe(2);
  });
});

describe('--json and the reports (Req 5.5, 5.6, 6.3)', () => {
  test('--json - prints only the JSON, with change; "Results saved in" goes to stderr', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    p.state.now = T0 + 7 * DAY;
    const r = await p.go([URL1, '--save', '--json', '-']);
    const doc = JSON.parse(r.out);
    expect(doc.pages[0].change).toMatchObject({ since: '2026-11-08T18:30:12.000Z', previousStatus: 'ok' });
    expect(r.err).toBe('Results saved in .lensy\n');
    expect(r.out).not.toContain('Results saved in');
  });

  test('the --json page and the saved run record page are the same object', async () => {
    const p = project();
    await p.go([URL1, URL2, '--save']);
    p.state.now = T0 + 7 * DAY;
    const out = await p.go([URL1, URL2, '--save', '--json', '-']);
    const doc = JSON.parse(out.out);
    doc.pages.forEach((page: { url: string }) => expect(page).toEqual(p.latest(page.url).page));
    expect(doc.pages[0].change).not.toBeNull();
    expect(doc.checkedAt).toBe(p.latest(URL1).checkedAt); // one start time for the whole run
  });

  test('--json <file> writes the file and the terminal view keeps its comparison', async () => {
    const p = project();
    const file = path.join(p.root, 'out.json');
    await p.go([URL1, '--save']);
    p.state.now = T0 + DAY;
    const r = await p.go([URL1, '--save', '--json', file]);
    expect(r.out).toContain(`Report written to ${file}`);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).pages[0].change.previousStatus).toBe('ok');
    expect(r.out).toMatch(/^  Since yesterday: /m);
  });

  test('--md and --html get a "Since last run" section when saving, and the saved latest.md files have it', async () => {
    const p = project();
    const md = path.join(p.root, 'r.md');
    const html = path.join(p.root, 'r.html');
    await p.go([URL1, '--save']);
    p.state.now = T0 + 7 * DAY;
    await p.go([URL1, '--save', '--md', md, '--html', html]);
    const mdText = fs.readFileSync(md, 'utf8');
    expect(mdText).toContain('### Since last run');
    expect(mdText).toContain('- Compared with the run on 2026-11-08.');
    expect(mdText.indexOf('### Since last run')).toBeGreaterThan(mdText.indexOf('### Summary'));
    expect(mdText.indexOf('### Since last run')).toBeLessThan(mdText.indexOf('### Both audiences'));
    const htmlText = fs.readFileSync(html, 'utf8');
    expect(htmlText).toContain('<h3>Since last run</h3>');
    expect(htmlText).not.toMatch(/<script/i);
    // The saved files: the top-level latest.md equals --md; the page's latest.md is that page alone.
    expect(p.read('latest.md')).toBe(mdText);
    expect(fs.readFileSync(path.join(p.pageDir(URL1), 'latest.md'), 'utf8')).toContain('### Since last run');
  });

  test('without saving, --md and --html are as before: no "Since last run"', async () => {
    const p = project();
    const md = path.join(p.root, 'r.md');
    const html = path.join(p.root, 'r.html');
    await p.go([URL1, '--no-save', '--md', md, '--html', html]);
    expect(fs.readFileSync(md, 'utf8')).not.toContain('Since last run');
    expect(fs.readFileSync(html, 'utf8')).not.toContain('Since last run');
  });

  test('a first run has the section too, saying so', async () => {
    const p = project();
    const md = path.join(p.root, 'r.md');
    await p.go([URL1, '--save', '--md', md]);
    expect(fs.readFileSync(md, 'utf8')).toContain('### Since last run\n\n- First saved run for this page.');
  });

  test('the fix points in the files are the points of the short view and of --json (Req 4.9)', async () => {
    const p = project();
    const md = path.join(p.root, 'r.md');
    const r = await p.go([URL1, '--no-save', '--md', md, '--json', '-']);
    const page = JSON.parse(r.out).pages[0];
    const fromMd = [...fs.readFileSync(md, 'utf8').matchAll(/^- \[ \] \*\*(.+?)\*\* \(\+(\d+) points\)/gm)].map(m => Number(m[2]));
    const fromJson = Object.values(page.pointsLost as Record<string, number>);
    expect(fromMd.reduce((a, b) => a + b, 0)).toBe(fromJson.reduce((a, b) => a + b, 0));
    expect(fromMd.every(Number.isInteger)).toBe(true);
  });
});

describe('the closing line (Req 3.5, 4.10)', () => {
  test('the path is relative to the current folder', async () => {
    const p = project();
    const sub = path.join(p.root, 'docs', 'guide');
    fs.mkdirSync(sub, { recursive: true });
    const r = await p.go([URL1, '--save'], { cwd: sub });
    expect(r.out.trimEnd().endsWith('Results saved in ../../.lensy')).toBe(true);
    expect(r.out).not.toContain(p.root);
  });

  test('with --save-dir', async () => {
    const p = project();
    const r = await p.go([URL1, '--save-dir', 'out/res']);
    expect(r.out.trimEnd().endsWith('Results saved in out/res')).toBe(true);
    expect(fs.existsSync(path.join(p.root, 'out', 'res', 'history.md'))).toBe(true);
  });

  test('it is the last thing printed, after the report pointer', async () => {
    const p = project();
    const r = await p.go([URL1, URL2, '--save']);
    const lines = r.out.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe('Results saved in .lensy');
    expect(lines[lines.length - 3]).toMatch(/^Full results: rerun with --html/);
  });
});

describe('the lock (Req 8.3)', () => {
  const lockPath = (p: ReturnType<typeof project>) => path.join(p.lensy, '.lock');

  test('a lock younger than 30 minutes: not saved, a message on stderr, and the exit code is unchanged', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(lockPath(p), JSON.stringify({ pid: 1, startedAt: T0 - 5 * 60_000 }));
    const r = await p.go([URL1, '--save']);
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toBe("Another lensy run is saving to .lensy; results from this run weren't saved.\n");
    expect(listFiles(p.lensy)).toEqual(['.lock']); // nothing written, the other run's lock untouched
    expect(r.out).not.toMatch(/Results saved|Since|First saved/);
    expect(r.out).toMatch(/Coding agents \d+\/100/);
  });

  test('a blocked page keeps exit 3 when the lock is held', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(lockPath(p), JSON.stringify({ pid: 1, startedAt: T0 }));
    p.state.block = ['https://vitest.dev'];
    expect((await p.go([URL1, '--save'])).code).toBe(EXIT.notChecked);
  });

  test('a lock 31 minutes old is stale: replaced, and the run saves', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(lockPath(p), JSON.stringify({ pid: 1, startedAt: T0 - 31 * 60_000 }));
    const r = await p.go([URL1, '--save']);
    expect(r.err).toBe('');
    expect(r.out).toContain('Results saved in .lensy');
    expect(p.strays()).toEqual([]);
  });

  test('the lock is gone after a run, so the next run is not blocked', async () => {
    const p = project();
    await p.go([URL1, '--save']);
    expect(fs.existsSync(lockPath(p))).toBe(false);
    p.state.now = T0 + 1000;
    expect((await p.go([URL1, '--save'])).out).toContain('Since today');
  });
});

describe('a save that fails after the pages were checked (Req 3.4)', () => {
  test('exit 1, "Couldn\'t save results" on stderr, and the results are still printed', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(path.join(p.lensy, 'pages'), 'a file where the pages folder should go');
    const r = await p.go([URL1, '--save']);
    expect(r.code).toBe(EXIT.saveFailed);
    expect(r.err).toBe("Couldn't save results: a file is in the way\n");
    expect(r.out).toMatch(/Coding agents \d+\/100/);
    expect(r.out).not.toContain('Results saved in');
    expect(p.strays()).toEqual([]); // the lock was released
  });

  test('it also beats exit 3', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(path.join(p.lensy, 'pages'), 'x');
    p.state.block = ['https://vitest.dev'];
    expect((await p.go([URL1, '--save'])).code).toBe(EXIT.saveFailed);
  });
});

describe('settings that shape a run', () => {
  test('"keep" in the project config limits the run files kept (Req 4.6)', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(path.join(p.lensy, 'config.json'), JSON.stringify({ save: true, keep: 2 }));
    for (let i = 0; i < 4; i++) { p.state.now = T0 + i * DAY; await p.go([URL1]); }
    expect(fs.readdirSync(path.join(p.pageDir(URL1), 'runs')).sort()).toEqual(['2026-11-10T183012Z.json', '2026-11-11T183012Z.json']);
  });

  test('a project config with save:true saves without a flag, and --no-save still wins', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(path.join(p.lensy, 'config.json'), JSON.stringify({ save: true }));
    expect((await p.go([URL1])).out).toContain('Results saved in .lensy');
    p.state.now = T0 + DAY;
    expect((await p.go([URL1, '--no-save'])).out).not.toContain('Results saved');
    expect(fs.readdirSync(path.join(p.pageDir(URL1), 'runs')).length).toBe(1);
  });

  test('pages from config.json are checked and saved with no arguments', async () => {
    const p = project();
    fs.mkdirSync(p.lensy);
    fs.writeFileSync(path.join(p.lensy, 'config.json'), JSON.stringify({ save: true, pages: [URL1, URL2] }));
    const r = await p.go([]);
    expect(r.out).toMatch(/^Page\s+Coding agents\s+AI search\s+Change\s+Status$/m);
    expect(listFiles(p.lensy).filter(f => f.endsWith('/latest.json')).length).toBe(2);
    expect(JSON.parse(fs.readFileSync(path.join(p.lensy, 'config.json'), 'utf8')).pages).toEqual([URL1, URL2]); // not rewritten
  });

  test('the question\'s "y" is a save from the first run on', async () => {
    const { root, home } = makeProject(tmp);
    const t = makeIo({ cwd: root, home, fetchImpl: replayFetch(ENTRIES), interactive: true, answers: ['y'] });
    expect(await run(['check', URL1], t.io)).toBe(EXIT.ok);
    expect(t.out()).toContain('First saved run for this page.');
    expect(t.out().trimEnd().endsWith('Results saved in .lensy')).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.lensy', 'config.json'), 'utf8'))).toEqual({ configVersion: 1, save: true });
  });
});

describe('nothing absolute is saved (Req 4.10)', () => {
  test('no saved file contains the project, home or temp folder', async () => {
    const p = project();
    const sub = path.join(p.root, 'docs');
    fs.mkdirSync(sub);
    await p.go([URL1, URL2, '--save'], { cwd: sub });
    p.state.now = T0 + 7 * DAY;
    await p.go([URL1, URL2, '--save'], { cwd: sub });
    for (const f of listFiles(p.lensy)) {
      const text = fs.readFileSync(path.join(p.lensy, f), 'utf8');
      expect(text, f).not.toContain(p.root);
      expect(text, f).not.toContain(p.home);
      expect(text, f).not.toContain(path.dirname(p.root));
    }
  });

  test('no .tmp- file anywhere after several runs', async () => {
    const p = project();
    for (let i = 0; i < 3; i++) { p.state.now = T0 + i * DAY; await p.go([URL1, URL2, '--save']); }
    expect(p.strays()).toEqual([]);
  });
});
