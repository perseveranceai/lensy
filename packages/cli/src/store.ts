// SPDX-License-Identifier: MIT
// Writing results to disk (Req 4, 8). Every file is written atomically; Lensy only
// ever writes inside the results folder and to ~/.lensy/config.json (Req 8.1).
import type { Dirent } from 'node:fs';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mdText } from './render-md';
import { resolvePageFolder } from './page-folder';

/**
 * Req 8.2: write <name>.tmp-<pid> in the same folder, then rename it over the real
 * file. A crash or Ctrl-C leaves the file either complete or untouched, never half
 * written. `mode` is applied to the new file (0600 for the user settings).
 */
export function writeAtomic(file: string, text: string, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    rmSync(tmp, { force: true }); // a leftover from a killed run: start fresh so `mode` applies
    writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
    throw e;
  }
}

// ---- run records ---------------------------------------------------------------

/**
 * One saved run of one page (Req 4.5). `page` is the same object as one entry of
 * `--json` "pages", so reading it back needs no second format.
 */
export interface RunRecord {
  recordVersion: 1;
  tool: 'lensy';
  toolVersion: string;
  engineCommit: string;
  checkedAt: string;
  page: SavedPage;
}

/** What a saved page object is read as. Only these fields are relied on; the rest is kept as it is. */
export interface SavedPage {
  url: string;
  status: string;
  scores?: { codingAgents?: number | null; aiSearch?: number | null };
  /** check id -> points lost on the 0-100 scale; only checks that lost points */
  pointsLost?: Record<string, number>;
  report?: { scores?: Record<string, { checks?: { id?: string; label?: string; points?: number | null }[] } | undefined> };
  [key: string]: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Req 5.1: valid means JSON, recordVersion 1, and a page with a url and a status. */
export function isRunRecord(v: unknown): v is RunRecord {
  return isObject(v) && v.recordVersion === 1 && isObject(v.page) && typeof v.page.url === 'string' && typeof v.page.status === 'string';
}

function readRecord(file: string): RunRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isRunRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** YYYY-MM-DDTHHMMSSZ, optionally -2, -3 ... when a file with that time exists (Req 4.4). */
export const RUN_FILE = /^(\d{4}-\d{2}-\d{2}T\d{6}Z)(?:-(\d+))?\.json$/;

export const runStamp = (ms: number): string => {
  const iso = new Date(ms).toISOString(); // 2026-11-08T18:30:12.000Z
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
};

/** The run files of a page folder, newest first. (A plain name sort would put -2 before the unsuffixed file.) Only regular files count. */
export function runFiles(runsDir: string): string[] {
  let entries: Dirent[];
  try { entries = readdirSync(runsDir, { withFileTypes: true }); } catch { return []; }
  const parsed = entries.flatMap(e => {
    const m = e.isFile() ? RUN_FILE.exec(e.name) : null;
    return m ? [{ name: e.name, stamp: m[1], n: m[2] ? Number(m[2]) : 1 }] : [];
  });
  return parsed.sort((a, b) => (a.stamp === b.stamp ? b.n - a.n : a.stamp < b.stamp ? 1 : -1)).map(p => p.name);
}

/**
 * Req 5.1: the previous run of a page, read before the new one is written. The page
 * folder's latest.json, else the newest valid file in runs/, else null. A broken file
 * never stops the run.
 */
export function readPrevious(pageDir: string): RunRecord | null {
  const latest = readRecord(join(pageDir, 'latest.json'));
  if (latest) return latest;
  for (const name of runFiles(join(pageDir, 'runs'))) {
    const record = readRecord(join(pageDir, 'runs', name));
    if (record) return record;
  }
  return null;
}

// ---- one run at a time per results folder (Req 8.3) -----------------------------

const LOCK_STALE_MS = 30 * 60 * 1000;

function lockIsStale(lockPath: string, nowMs: number): boolean {
  let startedAt: number | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (isObject(parsed) && typeof parsed.startedAt === 'number') startedAt = parsed.startedAt;
  } catch { /* an unreadable lock is judged by its age on disk */ }
  if (startedAt === undefined) {
    try { startedAt = statSync(lockPath).mtimeMs; } catch { return true; } // it vanished: free
  }
  return nowMs - startedAt >= LOCK_STALE_MS;
}

/** Creates .lock exclusively. A lock younger than 30 minutes is held; an older one is replaced. */
function acquireLock(lockPath: string, nowMs: number): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      try { writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: nowMs })); } finally { closeSync(fd); }
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (!lockIsStale(lockPath, nowMs)) return false;
      try { unlinkSync(lockPath); } catch { /* someone else replaced it first; the next 'wx' decides */ }
    }
  }
  return false;
}

/**
 * Runs `fn` while holding <results>/.lock. `locked: false` means another run holds it and
 * `fn` was not called. The lock is removed when `fn` ends or throws, and on SIGINT or
 * SIGTERM, after which the default action (stopping) is carried out.
 */
export function withLock<T>(resultsDir: string, nowMs: number, fn: () => T): { locked: true; value: T } | { locked: false } {
  const lockPath = join(resultsDir, '.lock');
  mkdirSync(resultsDir, { recursive: true });
  if (!acquireLock(lockPath, nowMs)) return { locked: false };
  const release = () => { try { unlinkSync(lockPath); } catch { /* already gone */ } };
  const stop = (signal: NodeJS.Signals) => () => {
    release();
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    process.kill(process.pid, signal);
  };
  const onInt = stop('SIGINT');
  const onTerm = stop('SIGTERM');
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    return { locked: true, value: fn() };
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    release();
  }
}

// ---- saving a run (Req 4) --------------------------------------------------------

export interface HistoryRow {
  /** the run's start time, UTC, "YYYY-MM-DD HH:MM" */
  date: string;
  url: string;
  coding: string;
  search: string;
  change: string;
  fixed: string[];
  added: string[];
}

export interface SaveItem {
  url: string;
  record: RunRecord;
  /** the Markdown report of this page alone, with "Since last run" */
  markdown: string;
  row: HistoryRow;
}

export interface SaveInput {
  /** the run's start time in ms; names the run files */
  startedAt: number;
  keep: number;
  items: SaveItem[];
  /** the top-level latest.md: the Markdown report of every page of the run */
  markdown: string;
}

export const HISTORY_MAX_ROWS = 500;
const HISTORY_HEADER = '| Date (UTC) | Page | Coding agents | AI search | Change | Fixed | New |';
const HISTORY_SEPARATOR = '|---|---|---|---|---|---|---|';
const HISTORY_INTRO = '# Lensy history\n\nOne row per page per run, newest first. Written by `lensy check`. Commit it to share the history with your team.\n\n';
const HISTORY_LIST_MAX = 3;

export const historyDate = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

const cellList = (labels: string[]) => {
  const shown = labels.slice(0, HISTORY_LIST_MAX).map(mdText).join(', ');
  const more = labels.length - HISTORY_LIST_MAX;
  return more > 0 ? `${shown}, +${more} more` : shown;
};

/** A history row. Every row starts "| 20" (the year), which is how rows are counted. */
export const historyRow = (r: HistoryRow): string =>
  `| ${r.date} | ${mdText(r.url)} | ${r.coding} | ${r.search} | ${mdText(r.change)} | ${cellList(r.fixed)} | ${cellList(r.added)} |`;

/** Req 4.7: new rows right under the header, newest first; at most 500 rows; a file that doesn't match is replaced, not repaired. */
function updateHistory(file: string, newRows: string[]): void {
  let old: string[] = [];
  try {
    const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const at = lines.findIndex(l => l.trim() === HISTORY_HEADER);
    if (at >= 0 && lines[at + 1]?.trim() === HISTORY_SEPARATOR) old = lines.slice(at + 2).filter(l => l.startsWith('| 20'));
  } catch { /* no history yet */ }
  const rows = [...newRows, ...old].slice(0, HISTORY_MAX_ROWS);
  writeAtomic(file, `${HISTORY_INTRO}${HISTORY_HEADER}\n${HISTORY_SEPARATOR}\n${rows.map(r => `${r}\n`).join('')}`);
}

/**
 * The run file name for this time: <stamp>.json, and when that time is already used,
 * <stamp>-2.json, -3 ... always one more than the highest in use. (Not "the first free
 * name": pruning may have removed the plain one, and reusing it would make the new
 * record the oldest, so the next prune would delete it.)
 */
function freeRunFile(runsDir: string, stamp: string): string {
  const used = runFiles(runsDir).flatMap(name => {
    const m = RUN_FILE.exec(name);
    return m && m[1] === stamp ? [m[2] ? Number(m[2]) : 1] : [];
  });
  const next = used.length ? Math.max(...used) + 1 : 1;
  return next === 1 ? `${stamp}.json` : `${stamp}-${next}.json`;
}

/** Req 4.6: keep the newest `keep` run records; delete only files whose names are run timestamps. */
function pruneRuns(runsDir: string, keep: number): void {
  for (const name of runFiles(runsDir).slice(keep)) rmSync(join(runsDir, name), { force: true });
}

/**
 * Writes one run (Req 4.1): per page the run record, latest.json, latest.md and
 * page.json, then the top-level latest.md and history.md. Every file is written
 * atomically. Call it while holding the lock.
 */
export function saveRun(resultsDir: string, input: SaveInput): void {
  const stamp = runStamp(input.startedAt);
  for (const item of input.items) {
    const { dir } = resolvePageFolder(resultsDir, item.url);
    const runsDir = join(dir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    const pageJson = `${JSON.stringify({ url: item.url }, null, 2)}\n`;
    let current = '';
    try { current = readFileSync(join(dir, 'page.json'), 'utf8'); } catch { /* new folder */ }
    if (current !== pageJson) writeAtomic(join(dir, 'page.json'), pageJson);
    const record = `${JSON.stringify(item.record, null, 2)}\n`;
    writeAtomic(join(runsDir, freeRunFile(runsDir, stamp)), record);
    writeAtomic(join(dir, 'latest.json'), record);
    writeAtomic(join(dir, 'latest.md'), item.markdown);
    pruneRuns(runsDir, input.keep);
  }
  writeAtomic(join(resultsDir, 'latest.md'), input.markdown);
  updateHistory(join(resultsDir, 'history.md'), input.items.map(i => historyRow(i.row)));
}

/**
 * Removes the absolute paths of this machine from a message (Req 4.10): the folders
 * given, then anything that looks like an absolute path. URLs are left alone.
 */
export function scrubPaths(text: string, folders: (string | undefined)[] = []): string {
  let out = text;
  for (const f of [...new Set(folders.filter((x): x is string => !!x && x.length > 1))].sort((a, b) => b.length - a.length)) out = out.split(f).join('<folder>');
  return out
    .replace(/(?<![\w:/.~-])\/(?:[\w.@+%-]+\/)+[\w.@+%-]*/g, '<path>') // /Users/me/project/file
    .replace(/(?<![\w])[A-Za-z]:\\(?:[^\\\s'"]+\\)*[^\\\s'"]*/g, '<path>'); // C:\Users\me\file
}

const REASONS: Record<string, string> = {
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  ENOSPC: 'no space left on the disk',
  EDQUOT: 'the disk quota is used up',
  EROFS: 'the disk is read-only',
  ENOTDIR: 'a file is in the way',
  EEXIST: 'a file is in the way',
  EISDIR: 'a folder is in the way',
  EMFILE: 'too many files are open',
  ENAMETOOLONG: 'the path is too long',
};

/** A short reason for an error, without the absolute paths that Node puts in its messages (Req 4.10). */
export function friendlyReason(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (code && REASONS[code]) return REASONS[code];
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/'[^']*'/g, '').replace(/\s{2,}/g, ' ').replace(/[\s,:]+$/, '').trim() || 'unknown error';
}
