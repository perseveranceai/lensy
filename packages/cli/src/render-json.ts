// SPDX-License-Identifier: MIT
// --json: the machine-readable result for scripts and CI. reportVersion 1:
// fields may only be added; removing or renaming needs reportVersion 2.
// Each page carries the core Report unchanged, plus `fixes`: the short view's
// list, ordered by points lost on the 0-100 scale; `pointsLost`: the same losses
// by check id, which is what a later run is compared with; and `change`: the
// comparison with the previous run, null without one or when results aren't saved.
import type { Report } from '@perseverance-ai/lensy-core';
import type { Change } from './compare';
import { REPORT_VERSION } from './report-doc';
import type { PageResult } from './render-text';
import type { SavedPage } from './store';
import { scaledLosses, summarize } from './summary';

export interface JsonMeta { toolVersion: string; engineCommit: string; checkedAt: string }

/** One entry of "pages". Run records (Req 4.5) hold exactly this object. */
export type JsonPage = SavedPage & { change: Change | null };

/**
 * Points lost per check id on the 0-100 scale of its score (the numbers of the
 * short view), for the checks that lost any. They add up to 100 minus each score.
 */
export function pointsLostOf(r: Report): Record<string, number> {
  const out: Record<string, number> = {};
  for (const score of [r.scores.codingAgents, r.scores.aiSearch]) {
    for (const [id, lost] of scaledLosses(score)) if (lost > 0) out[id] = (out[id] ?? 0) + lost;
  }
  return out;
}

export function jsonPage(p: PageResult, change: Change | null): JsonPage {
  if (p.internalError) return { url: p.url, status: 'internal-error', error: p.internalError, change };
  const r = p.report as Report;
  // A local build's score is points earned out of the points it could check: say out of what.
  const outOf = r.mode === 'local' ? { scoresOutOf: { codingAgents: r.scores.codingAgents.coveredMax, aiSearch: r.scores.aiSearch.coveredMax } } : {};
  const base = { url: p.url, status: r.status, scores: { codingAgents: r.scores.codingAgents.score, aiSearch: r.scores.aiSearch.score } };
  // Added fields go last (reportVersion 1 is additive): the mode, and for a local build what each score is out of.
  const added = { mode: r.mode, ...outOf };
  if (r.status !== 'ok') return { ...base, change, report: r, ...added };
  const s = summarize(r);
  return {
    ...base,
    fixes: s.fixes.map(f => ({ id: f.id, check: f.label, audience: f.audience, pointsLost: f.lost, fix: f.action, finding: f.finding })),
    pointsLost: pointsLostOf(r),
    change,
    report: r,
    ...added,
  };
}

/** `changes` is one per page, or omitted when results aren't saved (every change is null then). */
export function renderJson(pages: PageResult[], meta: JsonMeta, changes?: (Change | null)[]): string {
  const doc = {
    reportVersion: REPORT_VERSION,
    tool: 'lensy',
    ...meta,
    pages: pages.map((p, i) => jsonPage(p, changes?.[i] ?? null)),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}
