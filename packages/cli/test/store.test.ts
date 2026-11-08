// SPDX-License-Identifier: MIT
// The store (Req 4, 5.1, 8.2, 8.3): atomic writes, the lock, reading the previous
// run, and saving a run with its latest files, kept runs and history.md.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  HISTORY_MAX_ROWS, friendlyReason, historyDate, historyRow, readPrevious, runFiles, runStamp, saveRun, withLock, writeAtomic,
} from '../src/store';
import type { HistoryRow, RunRecord, SaveItem } from '../src/store';
import { resolvePageFolder } from '../src/page-folder';
import { DAY, T0, listFiles, useTempDirs } from './helpers';

// Windows has no Unix file modes and needs admin rights for symlinks: tests of those run on macOS and Linux.
const ON_WINDOWS = process.platform === 'win32';

const tmp = useTempDirs();
const MIN = 60_000;
const modeOf = (p: string) => fs.statSync(p).mode & 0o777;
const noTemp = (dir: string) => listFiles(dir).filter(f => f.includes('.tmp-'));

function record(url = 'https://docs.example.com/guide', over: Partial<RunRecord['page']> = {}, checkedAt = new Date(T0).toISOString()): RunRecord {
  return { recordVersion: 1, tool: 'lensy', toolVersion: '0.1.0', engineCommit: 'abc1234', checkedAt, page: { url, status: 'ok', scores: { codingAgents: 91, aiSearch: 95 }, pointsLost: {}, ...over } };
}
function row(url: string, over: Partial<HistoryRow> = {}, ms = T0): HistoryRow {
  return { date: historyDate(ms), url, coding: '91', search: '95', change: '+4 / 0', fixed: [], added: [], ...over };
}
function item(url: string, over: { record?: Partial<RunRecord['page']>; row?: Partial<HistoryRow>; markdown?: string } = {}, ms = T0): SaveItem {
  return { url, record: record(url, over.record, new Date(ms).toISOString()), markdown: over.markdown ?? `# report for ${url}\n`, row: row(url, over.row, ms) };
}
const run = (results: string, items: SaveItem[], startedAt = T0, keep = 52, markdown = '# all pages\n') => saveRun(results, { startedAt, keep, items, markdown });

describe('writeAtomic (Req 8.2)', () => {
  test('writes the file, creates folders, and leaves no temporary file', () => {
    const dir = tmp();
    writeAtomic(path.join(dir, 'a', 'b', 'file.txt'), 'hello');
    expect(fs.readFileSync(path.join(dir, 'a', 'b', 'file.txt'), 'utf8')).toBe('hello');
    expect(listFiles(dir)).toEqual(['a/b/file.txt']);
  });

  test('replaces an existing file whole', () => {
    const file = path.join(tmp(), 'f.txt');
    writeAtomic(file, 'one');
    writeAtomic(file, 'two');
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
  });

  test.skipIf(process.platform === 'win32')('applies the mode to the file', () => {
    const file = path.join(tmp(), 'f.txt');
    writeAtomic(file, 'x', 0o600);
    if (!ON_WINDOWS) expect(modeOf(file)).toBe(0o600);
  });

  test('a failed rename leaves the target untouched and no temporary file', () => {
    const dir = tmp();
    const target = path.join(dir, 'target');
    fs.mkdirSync(path.join(target, 'inside'), { recursive: true }); // a folder where the file should go: rename fails
    expect(() => writeAtomic(target, 'text')).toThrow();
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(target, 'inside'))).toBe(true);
    expect(noTemp(dir)).toEqual([]);
  });

  test('a failed write (the parent is a file) throws and leaves nothing', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'blocker'), 'x');
    expect(() => writeAtomic(path.join(dir, 'blocker', 'f.txt'), 'x')).toThrow();
    expect(listFiles(dir)).toEqual(['blocker']);
  });

  test('a temporary file left by a killed run is overwritten, not tripped over', () => {
    const file = path.join(tmp(), 'f.txt');
    fs.writeFileSync(`${file}.tmp-${process.pid}`, 'stale half-written text');
    writeAtomic(file, 'fresh');
    expect(fs.readFileSync(file, 'utf8')).toBe('fresh');
    expect(noTemp(path.dirname(file))).toEqual([]);
  });
});

describe('friendlyReason: no absolute paths in messages (Req 4.10)', () => {
  test.each([
    ['EACCES', 'permission denied'], ['EPERM', 'permission denied'], ['ENOSPC', 'no space left on the disk'],
    ['EROFS', 'the disk is read-only'], ['ENOTDIR', 'a file is in the way'], ['EEXIST', 'a file is in the way'],
  ])('%s', (code, text) => {
    expect(friendlyReason(Object.assign(new Error(`${code}: oops, mkdir '/Users/someone/project/.lensy'`), { code }))).toBe(text);
  });
  test('an unknown error keeps its words but not the quoted path', () => {
    const r = friendlyReason(new Error("EWEIRD: strange thing, open '/Users/someone/p/.lensy/x'"));
    expect(r).toBe('EWEIRD: strange thing, open');
    expect(r).not.toContain('/Users');
  });
  test('a non-error', () => {
    expect(friendlyReason('boom')).toBe('boom');
    expect(friendlyReason(undefined)).toBe('undefined');
  });
});

describe('withLock (Req 8.3)', () => {
  const lockFile = (dir: string) => path.join(dir, '.lock');

  test('runs the function while the lock exists, then removes it', () => {
    const dir = tmp();
    let during = false;
    const r = withLock(dir, T0, () => { during = fs.existsSync(lockFile(dir)); return 42; });
    expect(r).toEqual({ locked: true, value: 42 });
    expect(during).toBe(true);
    expect(fs.existsSync(lockFile(dir))).toBe(false);
  });

  test('the lock holds the pid and the start time', () => {
    const dir = tmp();
    withLock(dir, T0, () => {
      expect(JSON.parse(fs.readFileSync(lockFile(dir), 'utf8'))).toEqual({ pid: process.pid, startedAt: T0 });
    });
  });

  test('creates the results folder if it does not exist yet', () => {
    const dir = path.join(tmp(), 'new', '.lensy');
    expect(withLock(dir, T0, () => 1).locked).toBe(true);
  });

  test('a lock younger than 30 minutes is held: the function is not called, the lock is not touched', () => {
    const dir = tmp();
    const content = JSON.stringify({ pid: 1, startedAt: T0 - 29 * MIN });
    fs.writeFileSync(lockFile(dir), content);
    let called = false;
    expect(withLock(dir, T0, () => { called = true; })).toEqual({ locked: false });
    expect(called).toBe(false);
    expect(fs.readFileSync(lockFile(dir), 'utf8')).toBe(content);
  });

  test.each([[30], [31], [600]])('a lock %s minutes old is stale and is replaced', (minutes) => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 1, startedAt: T0 - minutes * MIN }));
    const r = withLock(dir, T0, () => JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')).pid);
    expect(r).toEqual({ locked: true, value: process.pid });
    expect(fs.existsSync(lockFile(dir))).toBe(false);
  });

  test('an unreadable lock is judged by its age on disk', () => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), 'not json');
    expect(withLock(dir, Date.now(), () => 1)).toEqual({ locked: false }); // just created: held
    const old = new Date(Date.now() - 31 * MIN);
    fs.utimesSync(lockFile(dir), old, old);
    expect(withLock(dir, Date.now(), () => 1).locked).toBe(true); // 31 minutes old: stale
  });

  test('a lock whose startedAt is in the future (clock change) is held, not stale', () => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 1, startedAt: T0 + DAY }));
    expect(withLock(dir, T0, () => 1)).toEqual({ locked: false });
  });

  test('the lock is removed and the error passes through when the function throws', () => {
    const dir = tmp();
    expect(() => withLock(dir, T0, () => { throw new Error('disk full'); })).toThrow('disk full');
    expect(fs.existsSync(lockFile(dir))).toBe(false);
  });

  test('SIGINT and SIGTERM listeners are removed afterwards, also after an error', () => {
    const dir = tmp();
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    let during: number[] = [];
    withLock(dir, T0, () => { during = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]; });
    expect(during).toEqual([before[0] + 1, before[1] + 1]);
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
    try { withLock(dir, T0, () => { throw new Error('x'); }); } catch { /* expected */ }
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });

  test('a held lock registers no listeners', () => {
    const dir = tmp();
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 1, startedAt: T0 }));
    const before = process.listenerCount('SIGINT');
    withLock(dir, T0, () => 1);
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  test('two runs one after the other both get the lock', () => {
    const dir = tmp();
    expect(withLock(dir, T0, () => 1).locked).toBe(true);
    expect(withLock(dir, T0, () => 2).locked).toBe(true);
  });
});

describe('runStamp and runFiles (Req 4.4)', () => {
  test('the stamp is the start time in UTC with no colons', () => {
    expect(runStamp(T0)).toBe('2026-11-08T183012Z');
    expect(runStamp(Date.parse('2026-01-02T03:04:05.999Z'))).toBe('2026-01-02T030405Z');
  });

  test('files are listed newest first, and -2 is newer than the plain name', () => {
    const dir = tmp();
    for (const n of ['2026-11-01T100000Z.json', '2026-11-08T183012Z.json', '2026-11-08T183012Z-2.json', '2026-11-08T183012Z-10.json', '2026-11-08T183012Z-3.json', 'notes.txt', 'x.json', '2026-11-08T183012Z.json.bak']) fs.writeFileSync(path.join(dir, n), '{}');
    expect(runFiles(dir)).toEqual(['2026-11-08T183012Z-10.json', '2026-11-08T183012Z-3.json', '2026-11-08T183012Z-2.json', '2026-11-08T183012Z.json', '2026-11-01T100000Z.json']);
  });

  test('a missing folder is an empty list', () => {
    expect(runFiles(path.join(tmp(), 'nope'))).toEqual([]);
  });
});

describe('readPrevious (Req 5.1)', () => {
  const put = (dir: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const rec = (n: number) => JSON.stringify(record('https://docs.example.com/guide', { scores: { codingAgents: n, aiSearch: n } }));
  const score = (r: RunRecord | null) => r?.page.scores?.codingAgents;

  test('latest.json when it is valid', () => {
    const dir = tmp();
    put(dir, 'latest.json', rec(91));
    put(dir, 'runs/2026-11-01T100000Z.json', rec(50));
    expect(score(readPrevious(dir))).toBe(91);
  });

  test.each([
    ['missing', null],
    ['truncated', '{"recordVersion":1,"page":{"url":"https://x.com/","stat'],
    ['empty', ''],
    ['not JSON', 'oops'],
    ['an array', '[]'],
    ['recordVersion 2', JSON.stringify({ ...record(), recordVersion: 2 })],
    ['no recordVersion', JSON.stringify({ page: record().page })],
    ['no page', JSON.stringify({ recordVersion: 1 })],
    ['a page without a url', JSON.stringify({ ...record(), page: { status: 'ok' } })],
    ['a page without a status', JSON.stringify({ ...record(), page: { url: 'https://x.com/' } })],
  ])('latest.json %s: the newest valid file in runs/ is used', (_what, content) => {
    const dir = tmp();
    if (content !== null) put(dir, 'latest.json', content);
    put(dir, 'runs/2026-11-01T100000Z.json', rec(60));
    put(dir, 'runs/2026-11-05T100000Z.json', rec(70));
    expect(score(readPrevious(dir))).toBe(70);
  });

  test('invalid files in runs/ are skipped, newest first', () => {
    const dir = tmp();
    put(dir, 'runs/2026-11-01T100000Z.json', rec(60));
    put(dir, 'runs/2026-11-05T100000Z.json', rec(70));
    put(dir, 'runs/2026-11-08T100000Z.json', '{ broken');
    put(dir, 'runs/2026-11-08T100000Z-2.json', '[]');
    expect(score(readPrevious(dir))).toBe(70);
  });

  test('-2 files count as newer than the plain name', () => {
    const dir = tmp();
    put(dir, 'runs/2026-11-08T100000Z.json', rec(60));
    put(dir, 'runs/2026-11-08T100000Z-2.json', rec(80));
    expect(score(readPrevious(dir))).toBe(80);
  });

  test('files that are not run files are ignored', () => {
    const dir = tmp();
    put(dir, 'runs/notes.json', rec(99));
    put(dir, 'runs/2026-11-08T100000Z.json.bak', rec(99));
    expect(readPrevious(dir)).toBeNull();
  });

  test('nothing valid at all, an empty folder, or no folder: null, never an error', () => {
    const dir = tmp();
    expect(readPrevious(dir)).toBeNull();
    put(dir, 'latest.json', 'x');
    put(dir, 'runs/2026-11-08T100000Z.json', 'y');
    expect(readPrevious(dir)).toBeNull();
    expect(readPrevious(path.join(dir, 'does-not-exist'))).toBeNull();
  });

  test('a latest.json that is a folder does not throw', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'latest.json'));
    put(dir, 'runs/2026-11-08T100000Z.json', rec(75));
    expect(score(readPrevious(dir))).toBe(75);
  });
});

describe('saveRun: files (Req 4.1, 4.4, 4.5)', () => {
  const A = 'https://docs.example.com/guide/start';
  const B = 'https://docs.example.com/api';

  test('the layout, for two pages', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A), item(B)]);
    expect(listFiles(results)).toEqual([
      'history.md',
      'latest.md',
      'pages/docs.example.com/api/latest.json',
      'pages/docs.example.com/api/latest.md',
      'pages/docs.example.com/api/page.json',
      'pages/docs.example.com/api/runs/2026-11-08T183012Z.json',
      'pages/docs.example.com/guide/start/latest.json',
      'pages/docs.example.com/guide/start/latest.md',
      'pages/docs.example.com/guide/start/page.json',
      'pages/docs.example.com/guide/start/runs/2026-11-08T183012Z.json',
    ]);
  });

  test('page.json names the URL; the run record and latest.json are the same text; latest.md is the page report', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A, { markdown: '# just this page\n' })], T0, 52, '# all\n');
    const dir = path.join(results, 'pages', 'docs.example.com', 'guide', 'start');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'page.json'), 'utf8'))).toEqual({ url: A });
    const latest = fs.readFileSync(path.join(dir, 'latest.json'), 'utf8');
    expect(fs.readFileSync(path.join(dir, 'runs', '2026-11-08T183012Z.json'), 'utf8')).toBe(latest);
    expect(JSON.parse(latest)).toEqual(record(A));
    expect(latest.endsWith('}\n')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'latest.md'), 'utf8')).toBe('# just this page\n');
    expect(fs.readFileSync(path.join(results, 'latest.md'), 'utf8')).toBe('# all\n');
  });

  test('all pages of one run share the run start time', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A), item(B)]);
    const names = listFiles(results).filter(f => f.includes('/runs/')).map(f => path.basename(f));
    expect(new Set(names)).toEqual(new Set(['2026-11-08T183012Z.json']));
  });

  test('a second run at the same second gets -2, a third -3, and latest.json is the newest', () => {
    const results = path.join(tmp(), '.lensy');
    for (let i = 1; i <= 3; i++) run(results, [item(A, { record: { scores: { codingAgents: 70 + i, aiSearch: 90 } } })]);
    const dir = path.join(results, 'pages', 'docs.example.com', 'guide', 'start');
    expect(fs.readdirSync(path.join(dir, 'runs')).sort()).toEqual(['2026-11-08T183012Z-2.json', '2026-11-08T183012Z-3.json', '2026-11-08T183012Z.json']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8')).page.scores.codingAgents).toBe(73);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runs', '2026-11-08T183012Z-3.json'), 'utf8')).page.scores.codingAgents).toBe(73);
  });

  test('runs at different times each get their own file; the top-level latest.md is replaced', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A)], T0, 52, '# first\n');
    run(results, [item(A, {}, T0 + 7 * DAY)], T0 + 7 * DAY, 52, '# second\n');
    expect(fs.readdirSync(path.join(results, 'pages', 'docs.example.com', 'guide', 'start', 'runs')).sort()).toEqual(['2026-11-08T183012Z.json', '2026-11-15T183012Z.json']);
    expect(fs.readFileSync(path.join(results, 'latest.md'), 'utf8')).toBe('# second\n');
  });

  test('a page that could not be checked is saved too, with its status', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A, { record: { status: 'blocked', scores: { codingAgents: null, aiSearch: null } } })]);
    const saved = JSON.parse(fs.readFileSync(path.join(results, 'pages/docs.example.com/guide/start/latest.json'), 'utf8'));
    expect(saved.page.status).toBe('blocked');
    expect(saved.page.scores).toEqual({ codingAgents: null, aiSearch: null });
  });

  test('what was saved can be read back as the previous run', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A)]);
    expect(readPrevious(resolvePageFolder(results, A).dir)).toEqual(record(A));
  });

  test('two URLs that share a folder name get separate folders (Req 4.3)', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://x.com/a'), item('https://x.com/a#other')]);
    const folders = listFiles(results).filter(f => f.endsWith('/page.json'));
    expect(folders.length).toBe(2);
    const urls = folders.map(f => JSON.parse(fs.readFileSync(path.join(results, f), 'utf8')).url).sort();
    expect(urls).toEqual(['https://x.com/a', 'https://x.com/a#other']);
  });

  test('no temporary file is left behind anywhere', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A), item(B)]);
    run(results, [item(A), item(B)], T0 + DAY);
    expect(noTemp(results)).toEqual([]);
  });

  test('page.json is rewritten only when it differs', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item(A)]);
    const file = path.join(results, 'pages/docs.example.com/guide/start/page.json');
    const old = new Date(Date.now() - 5 * DAY);
    fs.utimesSync(file, old, old);
    run(results, [item(A)], T0 + DAY);
    expect(Math.abs(fs.statSync(file).mtimeMs - old.getTime())).toBeLessThan(2000);
    fs.writeFileSync(file, 'broken');
    run(results, [item(A)], T0 + 2 * DAY);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ url: A });
  });
});

describe('saveRun: keeping runs (Req 4.6)', () => {
  const A = 'https://docs.example.com/guide';
  const runsOf = (results: string, rel = 'pages/docs.example.com/guide/runs') => fs.readdirSync(path.join(results, rel)).sort();

  test('53 runs with keep 52: 52 files remain, and the oldest is deleted', () => {
    const results = path.join(tmp(), '.lensy');
    for (let i = 0; i < 53; i++) run(results, [item(A, {}, T0 + i * DAY)], T0 + i * DAY, 52);
    const files = runsOf(results);
    expect(files.length).toBe(52);
    expect(files).not.toContain(`${runStamp(T0)}.json`);
    expect(files).toContain(`${runStamp(T0 + DAY)}.json`);
    expect(files).toContain(`${runStamp(T0 + 52 * DAY)}.json`);
  });

  test('keep 1 keeps only the newest', () => {
    const results = path.join(tmp(), '.lensy');
    for (let i = 0; i < 4; i++) run(results, [item(A, {}, T0 + i * DAY)], T0 + i * DAY, 1);
    expect(runsOf(results)).toEqual([`${runStamp(T0 + 3 * DAY)}.json`]);
  });

  test('only files named like run timestamps are ever deleted', () => {
    const results = path.join(tmp(), '.lensy');
    const runs = path.join(results, 'pages/docs.example.com/guide/runs');
    fs.mkdirSync(runs, { recursive: true });
    for (const n of ['README.txt', 'x.json', '2026-11-08T183012Z.json.bak', '2026-11-08.json']) fs.writeFileSync(path.join(runs, n), 'mine');
    fs.mkdirSync(path.join(runs, '2020-01-01T000000Z.json')); // even a folder with a run-like name is not a file we wrote
    for (let i = 0; i < 4; i++) run(results, [item(A, {}, T0 + i * DAY)], T0 + i * DAY, 2);
    const left = runsOf(results);
    expect(left).toEqual(expect.arrayContaining(['README.txt', 'x.json', '2026-11-08T183012Z.json.bak', '2026-11-08.json']));
    expect(left.filter(n => /^\d{4}-\d\d-\d\dT\d{6}Z\.json$/.test(n) && fs.statSync(path.join(runs, n)).isFile()).length).toBe(2);
  });

  test('only the page folders written in this run are pruned', () => {
    const results = path.join(tmp(), '.lensy');
    const B = 'https://docs.example.com/api';
    for (let i = 0; i < 3; i++) run(results, [item(A, {}, T0 + i * DAY), item(B, {}, T0 + i * DAY)], T0 + i * DAY, 5);
    for (let i = 3; i < 6; i++) run(results, [item(A, {}, T0 + i * DAY)], T0 + i * DAY, 2);
    expect(runsOf(results).length).toBe(2); // A: pruned to 2
    expect(runsOf(results, 'pages/docs.example.com/api/runs').length).toBe(3); // B: not in these runs, left alone
  });

  test('a run with the same second as an old one still counts the new file as newest', () => {
    const results = path.join(tmp(), '.lensy');
    for (let i = 0; i < 4; i++) run(results, [item(A)], T0, 2);
    expect(runsOf(results)).toEqual(['2026-11-08T183012Z-4.json', '2026-11-08T183012Z-3.json'].sort());
  });
});

describe('history.md (Req 4.7)', () => {
  const history = (results: string) => fs.readFileSync(path.join(results, 'history.md'), 'utf8');
  const rows = (results: string) => history(results).split('\n').filter(l => l.startsWith('| 20'));
  const HEADER = '| Date (UTC) | Page | Coding agents | AI search | Change | Fixed | New |';

  test('a title, a line saying what the file is, the header, then rows', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://docs.example.com/guide', { row: { fixed: ['A'], added: ['B'] } })]);
    const lines = history(results).split('\n');
    expect(lines[0]).toBe('# Lensy history');
    expect(lines[2]).toMatch(/^One row per page per run, newest first\./);
    expect(lines).toContain(HEADER);
    expect(lines[lines.indexOf(HEADER) + 1]).toBe('|---|---|---|---|---|---|---|');
    expect(rows(results)).toEqual(['| 2026-11-08 18:30 | https://docs.example.com/guide | 91 | 95 | \\+4 / 0 | A | B |'.replace('\\+', '+')]);
    expect(history(results).endsWith('|\n')).toBe(true);
  });

  test('each run inserts its rows right under the header: newest first, pages in the order given', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://x.com/one'), item('https://x.com/two')], T0);
    run(results, [item('https://x.com/two', {}, T0 + DAY), item('https://x.com/one', {}, T0 + DAY)], T0 + DAY);
    expect(rows(results).map(r => r.split(' | ').slice(0, 2).join(' | '))).toEqual([
      '| 2026-11-09 18:30 | https://x.com/two',
      '| 2026-11-09 18:30 | https://x.com/one',
      '| 2026-11-08 18:30 | https://x.com/one',
      '| 2026-11-08 18:30 | https://x.com/two',
    ]);
    const lines = history(results).split('\n');
    expect(lines[lines.indexOf(HEADER) + 2]).toContain('2026-11-09');
  });

  test('text from pages is escaped as in the Markdown report', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://x.com/a_b*c', { row: { fixed: ['Pipe | and *star* and <b>'], added: ['line\nbreak'] } })]);
    const [r] = rows(results);
    expect(r).toContain('https://x.com/a\\_b\\*c');
    expect(r).toContain('Pipe \\| and \\*star\\* and \\<b\\>');
    expect(r).toContain('line break');
    expect(r.split(/(?<!\\)\|/).length).toBe(9); // 7 cells: still 7 columns after escaping
  });

  test('Fixed and New list at most 3 labels, then +N more', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://x.com/a', { row: { fixed: ['A', 'B', 'C'], added: ['D', 'E', 'F', 'G', 'H'] } })]);
    const [r] = rows(results);
    expect(r).toContain('| A, B, C | D, E, F, +2 more |');
  });

  test('scores that could not be measured, and the change cell, are printed as given', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://x.com/a', { row: { coding: '-', search: '-', change: 'not checked' } })]);
    expect(rows(results)[0]).toContain('| - | - | not checked |');
  });

  test('the table keeps at most 500 rows: older rows are dropped', () => {
    const results = path.join(tmp(), '.lensy');
    for (let i = 0; i < 260; i++) run(results, [item('https://x.com/a', {}, T0 + i * DAY), item('https://x.com/b', {}, T0 + i * DAY)], T0 + i * DAY);
    const all = rows(results);
    expect(all.length).toBe(HISTORY_MAX_ROWS);
    expect(all[0]).toContain(historyDate(T0 + 259 * DAY));
    expect(all[all.length - 1]).toContain(historyDate(T0 + 10 * DAY));
  });

  test('a file whose header does not match is replaced, not repaired', () => {
    const results = path.join(tmp(), '.lensy');
    fs.mkdirSync(results, { recursive: true });
    fs.writeFileSync(path.join(results, 'history.md'), '# my own notes\n\n| 2020-01-01 00:00 | old | row |\n');
    run(results, [item('https://x.com/a')]);
    expect(rows(results).length).toBe(1);
    expect(history(results)).not.toContain('my own notes');
  });

  test('a file with Windows line endings is read', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://x.com/a')]);
    const file = path.join(results, 'history.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    run(results, [item('https://x.com/a', {}, T0 + DAY)], T0 + DAY);
    expect(rows(results).length).toBe(2);
    expect(history(results)).not.toContain('\r');
  });

  test('lines that are not rows are dropped when the file is rewritten', () => {
    const results = path.join(tmp(), '.lensy');
    run(results, [item('https://x.com/a')]);
    fs.appendFileSync(path.join(results, 'history.md'), '\nsome note I typed\n');
    run(results, [item('https://x.com/a', {}, T0 + DAY)], T0 + DAY);
    expect(history(results)).not.toContain('some note');
    expect(rows(results).length).toBe(2);
  });

  test('historyDate is the UTC minute', () => {
    expect(historyDate(T0)).toBe('2026-11-08 18:30');
    expect(historyRow(row('https://x.com/'))).toMatch(/^\| 2026-11-08 18:30 \| /);
  });
});

describe('saved files hold no absolute path of this machine (Req 4.10)', () => {
  test('nothing written contains the temp folder or the home folder', () => {
    const base = tmp();
    const results = path.join(base, 'project', '.lensy');
    run(results, [item('https://docs.example.com/guide'), item('https://docs.example.com/api')]);
    for (const f of listFiles(results)) {
      const text = fs.readFileSync(path.join(results, f), 'utf8');
      expect(text, f).not.toContain(base);
    }
  });
});
