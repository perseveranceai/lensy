// SPDX-License-Identifier: MIT
// Comparing a page with its previous run (Req 5). Pure: it reads two saved page
// objects and says what changed, in the numbers and in the three texts that show
// it (terminal, files, JSON). It never throws on an odd old file (Req 8.4).
import type { RunRecord, SavedPage } from './store';
import { SHARED_JS } from './summary';

export interface CheckRef { id: string; check: string }
export interface Movement extends CheckRef { from: number; to: number }
export interface ScoreChange { from: number | null; to: number | null; delta: number | null }

/** The "change" of a page in --json and in run records (Req 5.6). Fields may only be added. */
export interface Change {
  /** checkedAt of the previous run */
  since: string;
  previousStatus: string;
  codingAgents: ScoreChange;
  aiSearch: ScoreChange;
  /** checks that lost points before and lose none now */
  fixed: CheckRef[];
  /** checks that lost no points before and lose some now */
  new: CheckRef[];
  /** checks that lose points in both runs, more now */
  worse: Movement[];
  /** checks that lose points in both runs, fewer now */
  better: Movement[];
  lensyChanged: boolean;
  /** one plain sentence a later Slack or email step can post as it is */
  message: string;
  /** only when lensyChanged: "<tool version> (<engine commit>)" of each run */
  lensyFrom?: string;
  lensyTo?: string;
}

/** The run being saved: the same fields as a run record. */
export interface CurrentRun {
  toolVersion: string;
  engineCommit: string;
  checkedAt: string;
  page: SavedPage;
}

const DAY_MS = 86_400_000;
const LIST_MAX = 5;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- reading a saved page -------------------------------------------------------

const scoreOf = (page: SavedPage, key: 'codingAgents' | 'aiSearch'): number | null => {
  if (page.status !== 'ok') return null; // Req 5.6: score fields are null when a run wasn't ok
  const v = page.scores?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

interface CheckInfo { id: string; label: string; lost: number; comparable: boolean }

/** C1, S2 and AFDocs rendering-strategy are one question scored twice; the short view lists it once, so a comparison does too. */
const keyOf = (id: string) => (SHARED_JS.has(id) ? 'js' : id);

/**
 * What a page lost, check by check (Req 5.2). Labels and "did it run" come from the
 * saved report when there is one; points lost come from `pointsLost`, so a run record
 * is enough without re-scoring. A check that didn't run (points null) can't be compared.
 */
function checksOf(page: SavedPage): Map<string, CheckInfo> {
  const out = new Map<string, CheckInfo>();
  const scores = isObject(page.report?.scores) ? page.report.scores : {};
  for (const score of Object.values(scores)) {
    const checks = isObject(score) && Array.isArray(score.checks) ? score.checks : [];
    for (const c of checks) {
      if (!isObject(c) || typeof c.id !== 'string') continue;
      const key = keyOf(c.id);
      const comparable = c.points !== null;
      const known = out.get(key);
      if (known) known.comparable = known.comparable && comparable;
      else out.set(key, { id: c.id, label: typeof c.label === 'string' && c.label ? c.label : c.id, lost: 0, comparable });
    }
  }
  const lost = isObject(page.pointsLost) ? page.pointsLost : {};
  for (const [id, n] of Object.entries(lost)) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue;
    const key = keyOf(id);
    const info = out.get(key) ?? { id, label: id, lost: 0, comparable: true };
    info.lost += n;
    out.set(key, info);
  }
  return out;
}

const STATUS_WORD: Record<string, string> = { blocked: 'blocked', unreachable: 'unreachable', 'not-html': 'not HTML', 'internal-error': 'internal error' };
const statusWord = (s: string) => STATUS_WORD[s] ?? s;

const isoDay = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : 'an earlier run');

// ---- the numbers ------------------------------------------------------------------

const byLabel = (a: CheckRef, b: CheckRef) => (a.check < b.check ? -1 : a.check > b.check ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function scoreChange(from: number | null, to: number | null): ScoreChange {
  return { from, to, delta: from !== null && to !== null ? to - from : null };
}

/** +4, 0 or -3. */
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const deltaText = (d: number | null) => (d === null || d === 0 ? '' : ` (${signed(d)})`);
const scoreText = (name: string, s: ScoreChange) => `${name} ${s.from} → ${s.to}${deltaText(s.delta)}`;

function list(items: CheckRef[], max = LIST_MAX): string {
  const shown = items.slice(0, max).map(i => i.check).join(', ');
  return items.length > max ? `${shown}, +${items.length - max} more` : shown;
}

/**
 * Req 5.1-5.3, 5.6. null when the page has no previous run. The comparison of checks
 * needs both runs to be `ok`; otherwise only the scores (null for a run that wasn't ok)
 * and the message say what happened.
 */
export function compare(prev: RunRecord | null, cur: CurrentRun): Change | null {
  if (!prev) return null;
  const prevOk = prev.page.status === 'ok';
  const curOk = cur.page.status === 'ok';
  const coding = scoreChange(scoreOf(prev.page, 'codingAgents'), scoreOf(cur.page, 'codingAgents'));
  const search = scoreChange(scoreOf(prev.page, 'aiSearch'), scoreOf(cur.page, 'aiSearch'));

  const fixed: (CheckRef & { lost: number })[] = [];
  const added: (CheckRef & { lost: number })[] = [];
  const worse: Movement[] = [];
  const better: Movement[] = [];
  if (prevOk && curOk) {
    const before = checksOf(prev.page);
    const now = checksOf(cur.page);
    for (const key of new Set([...before.keys(), ...now.keys()])) {
      const p = before.get(key);
      const c = now.get(key);
      if ((p && !p.comparable) || (c && !c.comparable)) continue; // unknown or skipped in a run: no claim either way
      const pl = p?.lost ?? 0;
      const cl = c?.lost ?? 0;
      const ref = { id: (c ?? p)!.id, check: (c ?? p)!.label };
      if (pl > 0 && cl === 0) fixed.push({ ...ref, lost: pl });
      else if (pl === 0 && cl > 0) added.push({ ...ref, lost: cl });
      else if (pl > 0 && cl > pl) worse.push({ ...ref, from: pl, to: cl });
      else if (pl > 0 && cl > 0 && cl < pl) better.push({ ...ref, from: pl, to: cl });
    }
  }
  fixed.sort((a, b) => b.lost - a.lost || byLabel(a, b));
  added.sort((a, b) => b.lost - a.lost || byLabel(a, b));
  worse.sort((a, b) => (b.to - b.from) - (a.to - a.from) || byLabel(a, b));
  better.sort((a, b) => (b.from - b.to) - (a.from - a.to) || byLabel(a, b));
  const strip = ({ id, check }: CheckRef & { lost: number }): CheckRef => ({ id, check });

  const lensyChanged = prev.toolVersion !== cur.toolVersion || prev.engineCommit !== cur.engineCommit;
  const change: Change = {
    since: prev.checkedAt,
    previousStatus: prev.page.status,
    codingAgents: coding,
    aiSearch: search,
    fixed: fixed.map(strip),
    new: added.map(strip),
    worse,
    better,
    lensyChanged,
    message: '',
    ...(lensyChanged ? { lensyFrom: `${prev.toolVersion} (${prev.engineCommit})`, lensyTo: `${cur.toolVersion} (${cur.engineCommit})` } : {}),
  };
  change.message = changeMessage(change, cur);
  return change;
}

/** One plain sentence (Req 5.6). Dates are the UTC day of each run. */
function changeMessage(c: Change, cur: CurrentRun): string {
  const was = isoDay(c.since);
  const now = isoDay(cur.checkedAt);
  const curOk = cur.page.status === 'ok';
  const prevOk = c.previousStatus === 'ok';
  if (!curOk) {
    const why = `Couldn't check this page on ${now} (${statusWord(cur.page.status)}).`;
    return prevOk
      ? `${why} On ${was} it scored Coding agents ${c.codingAgents.from}, AI search ${c.aiSearch.from}.`
      : `${why} The run on ${was} couldn't check it either (${statusWord(c.previousStatus)}).`;
  }
  if (!prevOk) return `Checked ${now}; the run on ${was} couldn't check this page (${statusWord(c.previousStatus)}).`;
  let message = `${scoreText('Coding agents', c.codingAgents)}, ${scoreText('AI search', c.aiSearch)} since ${was}.`;
  if (c.fixed.length) message += ` Fixed: ${list(c.fixed)}.`;
  if (c.new.length) message += ` New: ${list(c.new)}.`;
  if (c.lensyChanged) message += ' Lensy changed between these runs, so some differences may come from Lensy.';
  return message;
}

// ---- dates and ages in the terminal ----------------------------------------------

/** Whole calendar days between the day of `sinceMs` and the day of `nowMs`, in the local timezone. Never negative. */
function daysBetween(sinceMs: number, nowMs: number): number {
  const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  return Math.max(0, Math.round((startOfDay(nowMs) - startOfDay(sinceMs)) / DAY_MS));
}

/** today, yesterday, N days ago, or N weeks ago from 14 days on (Req 5.4). */
export function ageText(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 14 ? `${days} days ago` : `${Math.floor(days / 7)} weeks ago`;
}

/** Nov 1, with the year when it isn't the current year; in the local timezone. */
export function shortDate(ms: number, nowMs: number): string {
  const sameYear = new Date(ms).getFullYear() === new Date(nowMs).getFullYear();
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** The day of a previous run as the terminal shows it, or null when its date can't be read. */
function sinceParts(sinceIso: string, nowMs: number): { date: string; age: string; days: number } | null {
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return null;
  const days = daysBetween(since, nowMs);
  return { date: shortDate(since, nowMs), age: ageText(days), days };
}

const LENSY_NOTE = (c: Change) => `Lensy changed between these runs (${c.lensyFrom} → ${c.lensyTo}), so some differences may come from Lensy, not your docs.`;

/**
 * The comparison lines for the terminal (Req 5.4), without colour or indentation.
 * `null` is a page with no previous run. `verbose` adds Worse and Better.
 */
export function changeLines(change: Change | null, nowMs: number, opts: { verbose?: boolean } = {}): string[] {
  if (change === null) return ['First saved run for this page.'];
  const prevOk = change.previousStatus === 'ok';
  const curOk = change.codingAgents.to !== null || change.aiSearch.to !== null; // scores are null when a run wasn't ok
  const parts = sinceParts(change.since, nowMs);
  const day = parts ? parts.date : 'an earlier date';
  if (!prevOk) return curOk ? [`Last run on ${day} couldn't check this page (${statusWord(change.previousStatus)}).`] : [];
  if (!curOk) return [`Last run on ${day}${parts ? ` (${parts.age})` : ''} scored Coding agents ${change.codingAgents.from}, AI search ${change.aiSearch.from}.`];
  const since = !parts ? 'an earlier run' : parts.days <= 1 ? parts.age : `${parts.date} (${parts.age})`;
  const lines = [`Since ${since}: ${scoreText('Coding agents', change.codingAgents)}    ${scoreText('AI search', change.aiSearch)}`];
  if (change.fixed.length) lines.push(`Fixed: ${list(change.fixed)}`);
  if (change.new.length) lines.push(`New: ${list(change.new)}`);
  if (opts.verbose) {
    const moves = (items: Movement[]) => items.slice(0, LIST_MAX).map(m => `${m.check} (${m.from} → ${m.to} points lost)`).join(', ') + (items.length > LIST_MAX ? `, +${items.length - LIST_MAX} more` : '');
    if (change.worse.length) lines.push(`Worse: ${moves(change.worse)}`);
    if (change.better.length) lines.push(`Better: ${moves(change.better)}`);
  }
  if (change.lensyChanged) lines.push(LENSY_NOTE(change));
  return lines;
}

// ---- the same facts for files, and the cells of the tables ------------------------

/** The "Since last run" bullets of the Markdown and HTML reports (Req 5.5): ISO dates, every item, Worse and Better included. */
export function sinceLines(change: Change | null): string[] {
  if (change === null) return ['First saved run for this page.'];
  const was = isoDay(change.since);
  const prevOk = change.previousStatus === 'ok';
  const curOk = change.codingAgents.to !== null || change.aiSearch.to !== null;
  if (!prevOk) return curOk ? [`Last run on ${was} couldn't check this page (${statusWord(change.previousStatus)}).`] : [`Last run on ${was} couldn't check this page either (${statusWord(change.previousStatus)}).`];
  if (!curOk) return [`Last run on ${was} scored Coding agents ${change.codingAgents.from}, AI search ${change.aiSearch.from}.`];
  const all = (items: CheckRef[]) => items.map(i => i.check).join(', ');
  const moves = (items: Movement[]) => items.map(m => `${m.check} (${m.from} → ${m.to} points lost)`).join(', ');
  const lines = [`Compared with the run on ${was}.`, scoreText('Coding agents', change.codingAgents), scoreText('AI search', change.aiSearch)];
  if (change.fixed.length) lines.push(`Fixed: ${all(change.fixed)}`);
  if (change.new.length) lines.push(`New: ${all(change.new)}`);
  if (change.worse.length) lines.push(`Worse: ${moves(change.worse)}`);
  if (change.better.length) lines.push(`Better: ${moves(change.better)}`);
  if (change.lensyChanged) lines.push(LENSY_NOTE(change));
  return lines;
}

/**
 * The Change cell: "+4 / 0" (Coding agents / AI search), "first run", or a dash.
 * `forHistory` writes "not checked" for a page that couldn't be checked (Req 4.7); the terminal table writes "-" (Req 5.7).
 */
export function changeCell(change: Change | null, currentOk: boolean, forHistory = false): string {
  if (!currentOk) return forHistory ? 'not checked' : '-';
  if (change === null) return 'first run';
  const { delta: dc } = change.codingAgents;
  const { delta: ds } = change.aiSearch;
  return dc === null || ds === null ? '-' : `${signed(dc)} / ${signed(ds)}`;
}

/** Labels for the Fixed and New columns of history.md. */
export const labelsOf = (items: CheckRef[]): string[] => items.map(i => i.check);
