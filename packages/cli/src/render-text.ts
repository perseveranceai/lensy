// SPDX-License-Identifier: MIT
// Terminal text. Not a stable format (Req 3.1); --html and --md are.
// No per-check code: labels, findings and fixes come from the report.
import type { Check, Report, Score } from '@perseverance-ai/lensy-core';
import type { Colors } from 'picocolors/types';
import { SOURCE_LABELS } from '../../../frontend/src/report/report-view';
import { changeCell, changeLines } from './compare';
import type { Change } from './compare';
import { bannerLine, previewLine } from './view';
import { capFrom, cleanFix, summarize, tidy } from './summary';

const STATUS_WORD: Record<Check['status'], string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', unknown: 'UNKNOWN', skipped: 'SKIPPED' };

export interface PageResult {
  url: string;
  report?: Report;
  /** set when the engine threw; the page counts as not checked */
  internalError?: string;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

export function scoreText(s: Score, short = false): string {
  if (s.score === null) return '-';
  // A local build: points earned out of the points a local preview can test, never stretched to 100.
  if (s.label === 'local') return short ? `${s.score} of ${s.coveredMax}` : `${s.score} of ${s.coveredMax} points checked`;
  const label = s.label ? ` (${s.label}${s.coveredMax < 100 ? `, covers ${s.coveredMax} of 100 points` : ''})` : '';
  return `${s.score}/100${label}`;
}

export function statusMessage(p: PageResult): string | null {
  if (p.internalError) return `Lensy hit an internal error on ${p.url}.`;
  const r = p.report!;
  const http = r.gate.honestStatus ? `HTTP ${r.gate.honestStatus}` : null;
  switch (r.status) {
    case 'ok': return null;
    case 'blocked': return `This site's bot protection refused lensy-cli${http ? ` (${http})` : ''}, so this page wasn't checked. Run the audit at https://perseveranceai.com instead.`;
    case 'unreachable': return `Lensy couldn't fetch this page${http ? ` (${http})` : ' (network error)'}, so it wasn't checked.`;
    case 'not-html': return `This URL didn't return an HTML page${http ? ` (${http})` : ''}, so it wasn't checked.`;
  }
}

function colorStatus(c: Colors, s: Check['status']): string {
  const w = pad(STATUS_WORD[s], 7);
  return s === 'pass' ? c.green(w) : s === 'fail' ? c.red(w) : s === 'warn' ? c.yellow(w) : c.dim(w);
}

// Same label as the website's source badge; Lensy's own checks show none.
const sourceTag = (x: Check) => (x.source && SOURCE_LABELS[x.source] ? ` ${SOURCE_LABELS[x.source]}` : '');

function renderChecks(c: Colors, title: string, s: Score): string[] {
  const lines = [``, c.bold(`  ${title}  ${scoreText(s)}`)];
  const possible = s.checks.filter(x => x.points !== null).reduce((n, x) => n + x.max, 0);
  if (possible && possible !== 100 && s.score !== null) lines.push(c.dim(`    Points below are out of ${possible}; the score scales them to 100.`));
  const idWidth = Math.max(3, ...s.checks.map(x => x.id.length));
  const width = Math.max(...s.checks.map(x => x.label.length + sourceTag(x).length));
  for (const x of s.checks) {
    const pts = x.points === null ? `-/${x.max}` : `${x.points}/${x.max}`;
    const tag = sourceTag(x);
    const label = x.label + (tag ? c.dim(tag) : '') + ' '.repeat(Math.max(0, width - x.label.length - tag.length));
    lines.push(`    ${colorStatus(c, x.status)} ${pad(x.id, idWidth)} ${label}  ${pad(pts, 7)} ${tidy(x.detail)}`);
    if (x.note) lines.push(c.dim(`          ${x.note}`));
    const fix = x.fix ? cleanFix(x.fix) : '';
    if (fix) lines.push(`          Fix: ${fix}`);
  }
  return lines;
}

/**
 * The comparison with the previous run, when results are saved. `change` is null for a
 * page with no previous run. Without a ChangeView (results aren't saved) nothing is added.
 */
export interface ChangeView { change: Change | null; now: number }

export interface PageOptions {
  /** every check with points, ids and full fixes (the pre-0.1 default) */
  verbose?: boolean;
  /** wrap width for the short view */
  width?: number;
  change?: ChangeView;
}

/** Word-wraps text after an indent; long words are left whole. */
export function wrap(text: string, indent: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && indent.length + line.length + 1 + word.length > width) { out.push(indent + line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(indent + line);
  return out;
}

// Fixed and Better read as good news, New and Worse as bad: colour the label only.
const tint = (c: Colors, line: string) => line
  .replace(/^(\s*)(Fixed:|Better:)/, (_m, sp: string, k: string) => sp + c.green(k))
  .replace(/^(\s*)(New:|Worse:)/, (_m, sp: string, k: string) => sp + c.red(k));

/**
 * The comparison lines under the scores (Req 5.4): indented two spaces. A line that fits
 * is kept as it is, so the four-space gap between the two scores stays; a longer one
 * (a long list of checks) is wrapped with a four-space hang.
 */
function changeBlock(c: Colors, view: ChangeView | undefined, verbose: boolean, width: number): string[] {
  if (!view) return [];
  return changeLines(view.change, view.now, { verbose }).flatMap(line =>
    (2 + line.length <= width ? [`  ${line}`] : wrap(line, '    ', width).map((l, i) => (i === 0 ? `  ${l.trimStart()}` : l)))
      .map((l, i) => (i === 0 ? tint(c, l) : l)));
}

function header(c: Colors, p: PageResult, opts: PageOptions): string[] {
  const r = p.report!;
  const lines = [c.bold(p.url)];
  if (r.finalUrl && r.finalUrl !== p.url) lines.push(c.dim(`  Checked ${r.finalUrl}`));
  lines.push(`  Coding agents ${scoreText(r.scores.codingAgents)}    AI search ${scoreText(r.scores.aiSearch)}`);
  lines.push(...changeBlock(c, opts.change, !!opts.verbose, opts.width ?? 100));
  const banner = bannerLine(r);
  if (banner) lines.push(`  ${banner}`);
  const preview = previewLine(r);
  if (preview) lines.push(`  What an agent receives: ${preview}`);
  return lines;
}

function footer(r: Report, width: number): string[] {
  const out: string[] = [];
  if (r.tips.length) {
    out.push('', '  Tips');
    for (const t of r.tips) out.push(...wrap(t.text, '      ', width).map((l, i) => (i ? l : `    - ${l.trimStart()}`)));
  }
  for (const n of r.notes) out.push('', ...wrap(n, '  ', width));
  return out;
}

/** The short view: scores, then what to fix first in points that add up to the score. */
function renderShort(c: Colors, p: PageResult, opts: PageOptions): string {
  const width = opts.width ?? 100;
  const r = p.report!;
  const lines = header(c, p, opts);
  const cap = capFrom(r.scores.codingAgents);
  if (cap !== null) lines.push(c.yellow(`  Coding agents is capped at ${r.scores.codingAgents.score} because a check every agent depends on failed; the checks alone add up to ${cap}.`));
  const sum = summarize(r);
  if (sum.fixes.length) {
    lines.push('', c.bold('  Fix these first'));
    const labelWidth = Math.min(46, Math.max(...sum.fixes.map(f => f.label.length)));
    sum.fixes.forEach((f, i) => {
      const n = `${i + 1}.`.padStart(3);
      const lost = c.red(`−${f.lost}`.padStart(4));
      lines.push(`  ${n} ${c.bold(pad(f.label, labelWidth))} ${lost}  ${c.dim(f.audience)}`);
      lines.push(...wrap(f.action ?? f.finding, '      ', width));
    });
  } else {
    lines.push('', c.green('  Nothing to fix: every scored check passes.'));
  }
  const [cp, ct] = sum.passed.coding;
  const [sp, st] = sum.passed.search;
  lines.push('', `  Passed: ${cp} of ${ct} Coding agents checks, ${sp} of ${st} AI search checks.`);
  // Local builds: name what wasn't checked, so "71 of 84 points checked" is never read as the whole picture.
  const skipped = [...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks].filter(x => x.status === 'skipped');
  if (skipped.length) {
    lines.push(...wrap(`Not checked here (your web server or CDN decides these, so check the live site for them): ${[...new Set(skipped.map(x => x.label))].join(', ')}.`, '  ', width).map(l => c.dim(l)));
  }
  if (sum.notes.length) {
    lines.push(c.dim('  Not scored:'));
    for (const nt of sum.notes) lines.push(...wrap(`${nt.label}: ${nt.finding}`, '      ', width).map((l, i) => c.dim(i ? l : `    - ${l.trimStart()}`)));
  }
  lines.push(...footer(r, width));
  lines.push('', ...wrap('Every check with points: add --verbose. Full report: --md report.md (for coding agents), --html report.html or --json report.json.', '  ', width).map(l => c.dim(l)));
  return lines.join('\n');
}

export function renderPage(c: Colors, p: PageResult, opts: PageOptions = {}): string {
  const msg = statusMessage(p);
  if (msg) return [c.bold(p.url), `  ${p.internalError ? c.red(msg) : c.yellow(msg)}`, ...changeBlock(c, opts.change, !!opts.verbose, opts.width ?? 100)].join('\n');
  if (!opts.verbose) return renderShort(c, p, opts);
  const r = p.report!;
  const lines = header(c, p, opts);
  lines.push(...renderChecks(c, 'Coding agents', r.scores.codingAgents));
  lines.push(...renderChecks(c, 'AI search', r.scores.aiSearch));
  if (r.tips.length) {
    lines.push('', c.bold('  Tips'));
    for (const t of r.tips) lines.push(`    - ${t.text}`);
  }
  for (const n of r.notes) lines.push('', c.dim(`  ${n}`));
  return lines.join('\n');
}

/** `changes` is one per page when results are saved: the table then has a Change column (Req 5.7). */
export function renderSummary(c: Colors, pages: PageResult[], changes?: (Change | null)[]): string {
  const rows = pages.map((p, i) => {
    const r = p.report;
    const ok = r?.status === 'ok' && !p.internalError;
    return [
      p.url,
      ok ? scoreText(r!.scores.codingAgents, true) : '-',
      ok ? scoreText(r!.scores.aiSearch, true) : '-',
      ...(changes ? [changeCell(changes[i] ?? null, ok)] : []),
      p.internalError ? 'internal error' : r!.status,
    ];
  });
  const head = ['Page', 'Coding agents', 'AI search', ...(changes ? ['Change'] : []), 'Status'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (cells: string[]) => cells.map((x, i) => pad(x, w[i])).join('  ').trimEnd();
  return [c.bold(line(head)), ...rows.map(line)].join('\n');
}

/** Several pages: one short block per page with its top fixes, not every check. */
export function renderBrief(c: Colors, p: PageResult, fixes = 3, width = 100, view?: ChangeView): string {
  const msg = statusMessage(p);
  if (msg) return [c.bold(p.url), `  ${p.internalError ? c.red(msg) : c.yellow(msg)}`, ...changeBlock(c, view, false, width)].join('\n');
  const r = p.report!;
  const lines = [c.bold(p.url), `  Coding agents ${scoreText(r.scores.codingAgents)}    AI search ${scoreText(r.scores.aiSearch)}`, ...changeBlock(c, view, false, width)];
  const cap = capFrom(r.scores.codingAgents);
  if (cap !== null) lines.push(c.yellow(`  Coding agents is capped at ${r.scores.codingAgents.score}; the checks alone add up to ${cap}.`));
  const all = summarize(r).fixes;
  const top = all.slice(0, fixes);
  if (!top.length) lines.push('  Nothing to fix: every scored check passes.');
  for (const f of top) {
    lines.push(`  - ${f.label} ${c.red(`(−${f.lost})`)} ${c.dim(f.audience)}`);
    lines.push(...wrap(f.action ?? f.finding, '      ', width));
  }
  const more = all.length - top.length;
  if (more > 0) {
    // A local build isn't at its URL yet, so point to the full report instead of a live check.
    const where = r.mode === 'local' ? 'see them with --verbose or --md report.md' : `lensy check ${p.url}`;
    lines.push(c.dim(`  ${more} more fix${more === 1 ? '' : 'es'}: ${where}`));
  }
  return lines.join('\n');
}
