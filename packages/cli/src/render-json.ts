// SPDX-License-Identifier: MIT
// --json: the machine-readable result for scripts and CI. reportVersion 1:
// fields may only be added; removing or renaming needs reportVersion 2.
// Each page carries the core Report unchanged, plus `fixes`: the short view's
// list, ordered by points lost on the 0-100 scale.
import type { Report } from '@perseverance-ai/lensy-core';
import { REPORT_VERSION } from './report-doc';
import type { PageResult } from './render-text';
import { summarize } from './summary';

export interface JsonMeta { toolVersion: string; engineCommit: string; checkedAt: string }

export function renderJson(pages: PageResult[], meta: JsonMeta): string {
  const doc = {
    reportVersion: REPORT_VERSION,
    tool: 'lensy',
    ...meta,
    pages: pages.map(p => {
      if (p.internalError) return { url: p.url, status: 'internal-error', error: p.internalError };
      const r = p.report as Report;
      const base = { url: p.url, status: r.status, scores: { codingAgents: r.scores.codingAgents.score, aiSearch: r.scores.aiSearch.score } };
      if (r.status !== 'ok') return { ...base, report: r };
      const s = summarize(r);
      return {
        ...base,
        fixes: s.fixes.map(f => ({ check: f.label, audience: f.audience, pointsLost: f.lost, fix: f.action, finding: f.finding })),
        report: r,
      };
    }),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}
