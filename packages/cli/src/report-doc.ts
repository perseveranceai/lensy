// SPDX-License-Identifier: MIT
// The one structure behind --html and --md (Req 3.4-3.6). reportVersion 1:
// fields, columns and sections may only be added at the end; removing,
// renaming or reordering needs reportVersion 2. Grouping, fix order, banner
// and preview wording come from the website's report view, so the files say
// what the website says. No per-check code: labels and text come from reports.
import type { Check, Report, Score } from '@perseverance-ai/lensy-core';
import { SOURCE_LABELS, v2Recommendations, v2SignalGroups } from '../../../frontend/src/report/report-view';
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
  pages: { url: string; status: Report['status'] | 'internal-error'; codingAgents: number | null; aiSearch: number | null }[];
}

/** source: "AFDocs" for AFDocs checks, empty for Lensy's own (the website's SOURCE_LABELS). */
export interface DocRow { id: string; check: string; status: string; points: string; max: string; finding: string; source: string }
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
}

export interface ReportDoc { meta: DocMeta; pages: DocPage[] }

export interface DocInput { url: string; report?: Report; internalError?: string }

const allChecks = (r: Report): Check[] => [...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks];
const STATUS = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', neutral: 'INFO', unknown: 'UNKNOWN', skipped: 'SKIPPED' } as const;
const num = (s: Score) => s.score;

function page(input: DocInput): DocPage {
  const empty: DocPage = { url: input.url, groups: [], fixes: [], tips: [], skipped: [], notes: [] };
  const message = statusMessage(input);
  if (message) return { ...empty, message, notes: input.report?.notes ?? [] };
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
        finding: sig.detail,
        source: (sig.source && SOURCE_LABELS[sig.source]) || '',
      };
    }),
  }));

  // The website's fix list: each fix once, ordered by points lost, tips last.
  const fixes = v2Recommendations(view)
    .filter(x => x.category !== 'Tip' && x.fix)
    .map(x => {
      const ids = allChecks(r).filter(c => c.fix === x.fix && c.points !== null).map(c => c.id);
      const gain = ids.map(id => byId.get(id)!).reduce((n, c) => n + (c.max - (c.points as number)), 0);
      return { id: ids.join(', '), issue: x.issue || '', fix: x.fix || '', gain: Math.round(gain * 10) / 10 };
    });

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
        };
      }),
    },
    pages: inputs.map(page),
  };
}
