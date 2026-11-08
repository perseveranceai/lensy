// SPDX-License-Identifier: MIT
// The one structure behind --html and --md (Req 3.4-3.6). reportVersion 1:
// fields, columns and sections may only be added at the end; removing,
// renaming or reordering needs reportVersion 2. Grouping, fix order, banner
// and preview wording come from the website's report view, so the files say
// what the website says. No per-check code: labels and text come from reports.
import type { Check, Report, Score } from '@perseverance-ai/lensy-core';
import { SOURCE_LABELS, v2Recommendations, v2SignalGroups } from '../../../frontend/src/report/report-view';
import { sinceLines } from './compare';
import type { Change } from './compare';
import { cleanFix, scaledLosses, tidy } from './summary';
import { bannerLine, previewLine, toView } from './view';
import { statusMessage, scoreText } from './render-text';

export const REPORT_VERSION = 1;

export interface DocMeta {
  reportVersion: 1;
  tool: 'lensy';
  toolVersion: string;
  engineCommit: string;
  checkedAt: string;
  mode: Report['mode'];
  pages: { url: string; status: Report['status'] | 'internal-error'; codingAgents: number | null; aiSearch: number | null; codingAgentsOutOf?: number; aiSearchOutOf?: number }[];
}

/** source: "AFDocs" for AFDocs checks, empty for Lensy's own (the website's SOURCE_LABELS). */
export interface DocRow { id: string; check: string; status: string; points: string; max: string; finding: string; source: string }
/** gain: the points the fix is worth on the 0-100 scale of its score, the same numbers as the short view and --json (Req 4.9) */
export interface DocFix { id: string; issue: string; fix: string; gain: number }
export interface DocSkipped { id: string; check: string; status: string; reason: string }

export interface DocPage {
  url: string;
  /** set when the page wasn't checked */
  message?: string;
  summary?: { codingAgents: string; aiSearch: string; banner: string | null; preview: string | null };
  groups: { title: 'Both audiences' | 'Coding agents' | 'AI search'; rows: DocRow[] }[];
  fixes: DocFix[];
  tips: string[];
  skipped: DocSkipped[];
  notes: string[];
  /** the "Since last run" lines; absent when results aren't saved (Req 5.5). Added at the end of the page, shown after the summary. */
  since?: string[];
}

export interface ReportDoc { meta: DocMeta; pages: DocPage[] }

/** `change` is undefined when results aren't saved, null for a page with no previous run. */
export interface DocInput { url: string; report?: Report; internalError?: string; change?: Change | null }

const allChecks = (r: Report): Check[] => [...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks];
const STATUS = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', neutral: 'INFO', unknown: 'UNKNOWN', skipped: 'SKIPPED' } as const;
const num = (s: Score) => s.score;

function page(input: DocInput): DocPage {
  const empty: DocPage = { url: input.url, groups: [], fixes: [], tips: [], skipped: [], notes: [] };
  const since = input.change === undefined ? {} : { since: sinceLines(input.change) };
  const message = statusMessage(input);
  if (message) return { ...empty, message, notes: input.report?.notes ?? [], ...since };
  const r = input.report!;
  const view = toView(r)!;
  const byId = new Map(allChecks(r).map(c => [c.id, c]));

  const groups = v2SignalGroups(view).map(g => ({
    title: g.title as DocPage['groups'][number]['title'],
    rows: g.sections.flatMap(s => s.signals).map(sig => {
      const ids = sig.checkIds || [];
      const checks = ids.map(id => byId.get(id)!).filter(Boolean);
      return {
        id: ids.join(', '),
        check: sig.label,
        status: STATUS[sig.status],
        points: checks.map(c => (c.points === null ? '-' : String(c.points))).join(' / '),
        max: checks.map(c => String(c.max)).join(' / '),
        finding: tidy(sig.detail),
        source: (sig.source && SOURCE_LABELS[sig.source]) || '',
      };
    }),
  }));

  // The website's fix list: each fix once, ordered by points lost, tips last.
  // Points are worth what the short view says: scaled to 0-100 per score, so AFDocs checks (more than 100 raw points) agree.
  const losses = [r.scores.codingAgents, r.scores.aiSearch].map(s => ({ checks: s.checks, lost: scaledLosses(s) }));
  const fixes = v2Recommendations(view)
    .filter(x => x.category !== 'Tip' && x.fix)
    .map(x => {
      const ids = allChecks(r).filter(c => c.fix === x.fix && c.points !== null).map(c => c.id);
      const gain = losses.reduce((n, s) => n + s.checks.filter(c => c.fix === x.fix && c.points !== null).reduce((m, c) => m + (s.lost.get(c.id) ?? 0), 0), 0);
      // One page, in plain words: "The page", and never another tool's options.
      return { id: ids.join(', '), issue: tidy(x.issue || ''), fix: cleanFix(x.fix || ''), gain };
    })
    // A fix worth no points isn't a to-do: those findings stay in the tables above.
    .filter(x => x.gain > 0 && x.fix)
    // The website orders by raw points; the files show scaled points, so order by those (a stable sort keeps the website's order for ties).
    .sort((a, b) => b.gain - a.gain);

  return {
    url: input.url,
    summary: {
      codingAgents: scoreText(r.scores.codingAgents),
      aiSearch: scoreText(r.scores.aiSearch),
      banner: bannerLine(r),
      preview: previewLine(r),
    },
    groups,
    fixes,
    tips: r.tips.map(t => t.text),
    skipped: allChecks(r)
      .filter(c => c.status === 'unknown' || c.status === 'skipped')
      .map(c => ({ id: c.id, check: c.label, status: STATUS[c.status], reason: c.note || '' })),
    notes: r.notes,
    ...since,
  };
}

export function buildReportDoc(inputs: DocInput[], tool: { version: string; engineCommit: string; checkedAt: string }): ReportDoc {
  const mode = inputs.find(i => i.report)?.report?.mode ?? 'url';
  return {
    meta: {
      reportVersion: 1,
      tool: 'lensy',
      toolVersion: tool.version,
      engineCommit: tool.engineCommit,
      checkedAt: tool.checkedAt,
      mode,
      pages: inputs.map(i => {
        const ok = i.report?.status === 'ok' && !i.internalError;
        return {
          url: i.url,
          status: i.internalError ? 'internal-error' : i.report!.status,
          codingAgents: ok ? num(i.report!.scores.codingAgents) : null,
          aiSearch: ok ? num(i.report!.scores.aiSearch) : null,
          ...(ok && i.report!.mode === 'local' ? { codingAgentsOutOf: i.report!.scores.codingAgents.coveredMax, aiSearchOutOf: i.report!.scores.aiSearch.coveredMax } : {}),
        };
      }),
    },
    pages: inputs.map(page),
  };
}
