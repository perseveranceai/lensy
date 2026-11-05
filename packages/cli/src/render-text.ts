// SPDX-License-Identifier: MIT
// Terminal text. Not a stable format (Req 3.1); --html and --md are.
// No per-check code: labels, findings and fixes come from the report.
import type { Check, Report, Score } from '@perseverance-ai/lensy-core';
import type { Colors } from 'picocolors/types';
import { SOURCE_LABELS } from '../../../frontend/src/report/report-view';
import { bannerLine, previewLine, topFixes } from './view';

const STATUS_WORD: Record<Check['status'], string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', unknown: 'UNKNOWN', skipped: 'SKIPPED' };

export interface PageResult {
  url: string;
  report?: Report;
  /** set when the engine threw; the page counts as not checked */
  internalError?: string;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

export function scoreText(s: Score): string {
  if (s.score === null) return '-';
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
  const idWidth = Math.max(3, ...s.checks.map(x => x.id.length));
  const width = Math.max(...s.checks.map(x => x.label.length + sourceTag(x).length));
  for (const x of s.checks) {
    const pts = x.points === null ? `-/${x.max}` : `${x.points}/${x.max}`;
    const tag = sourceTag(x);
    const label = x.label + (tag ? c.dim(tag) : '') + ' '.repeat(Math.max(0, width - x.label.length - tag.length));
    lines.push(`    ${colorStatus(c, x.status)} ${pad(x.id, idWidth)} ${label}  ${pad(pts, 7)} ${x.detail}`);
    if (x.note) lines.push(c.dim(`          ${x.note}`));
    if (x.fix) lines.push(`          Fix: ${x.fix}`);
  }
  return lines;
}

export function renderPage(c: Colors, p: PageResult): string {
  const lines = [c.bold(p.url)];
  const msg = statusMessage(p);
  if (msg) {
    lines.push(`  ${p.internalError ? c.red(msg) : c.yellow(msg)}`);
    return lines.join('\n');
  }
  const r = p.report!;
  if (r.finalUrl && r.finalUrl !== p.url) lines.push(c.dim(`  Checked ${r.finalUrl}`));
  lines.push(`  Coding agents ${scoreText(r.scores.codingAgents)}    AI search ${scoreText(r.scores.aiSearch)}`);
  const banner = bannerLine(r);
  if (banner) lines.push(`  ${banner}`);
  const preview = previewLine(r);
  if (preview) lines.push(`  What an agent receives: ${preview}`);
  lines.push(...renderChecks(c, 'Coding agents', r.scores.codingAgents));
  lines.push(...renderChecks(c, 'AI search', r.scores.aiSearch));
  if (r.tips.length) {
    lines.push('', c.bold('  Tips'));
    for (const t of r.tips) lines.push(`    - ${t.text}`);
  }
  for (const n of r.notes) lines.push('', c.dim(`  ${n}`));
  return lines.join('\n');
}

export function renderSummary(c: Colors, pages: PageResult[]): string {
  const rows = pages.map(p => {
    const r = p.report;
    const ok = r?.status === 'ok' && !p.internalError;
    return [p.url, ok ? scoreText(r!.scores.codingAgents) : '-', ok ? scoreText(r!.scores.aiSearch) : '-', p.internalError ? 'internal error' : r!.status];
  });
  const head = ['Page', 'Coding agents', 'AI search', 'Status'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (cells: string[]) => cells.map((x, i) => pad(x, w[i])).join('  ').trimEnd();
  return [c.bold(line(head)), ...rows.map(line)].join('\n');
}

/** Several pages: one short block per page with its top fixes, not every check. */
export function renderBrief(c: Colors, p: PageResult, fixes = 3): string {
  const msg = statusMessage(p);
  if (msg) return [c.bold(p.url), `  ${p.internalError ? c.red(msg) : c.yellow(msg)}`].join('\n');
  const r = p.report!;
  const lines = [c.bold(p.url), `  Coding agents ${scoreText(r.scores.codingAgents)}    AI search ${scoreText(r.scores.aiSearch)}`];
  const top = topFixes(r, fixes);
  if (!top.length) lines.push('  Every check passes.');
  for (const f of top) lines.push(`  - ${f.issue}${f.points ? ` (${f.points})` : ''}`, `      Fix: ${f.fix}`);
  return lines.join('\n');
}
