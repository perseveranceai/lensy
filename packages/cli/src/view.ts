// SPDX-License-Identifier: MIT
// Adapts a core Report to the website's report view, so the CLI uses the
// website's wording for the reachability banner and agent preview (Req 6.8).
import type { Report } from '@perseverance-ai/lensy-core';
import { gateBannerText, previewSummary, readScoringV2, v2Recommendations } from '../../../frontend/src/report/report-view';
import type { ScoringV2 } from '../../../frontend/src/report/report-view';

/** The report.json fields readScoringV2 reads, taken from a core Report. */
export function toView(r: Report): ScoringV2 | null {
  if (r.status !== 'ok') return null;
  return readScoringV2({
    scoringVersion: 2,
    scores: {
      codingAgents: { score: r.scores.codingAgents.score, checks: r.scores.codingAgents.checks },
      aiSearch: { score: r.scores.aiSearch.score, checks: r.scores.aiSearch.checks },
    },
    gate: r.gate,
    agentPreview: r.agentPreview,
    tips: r.tips,
  });
}

export function bannerLine(r: Report): string | null {
  const v = toView(r);
  return v ? gateBannerText(v, false) : null;
}

export function previewLine(r: Report): string | null {
  const v = toView(r);
  return v?.preview ? previewSummary(v.preview) : null;
}

/** The website's fix list (ordered by points lost, each fix once), without tips. */
export function topFixes(r: Report, n: number): { issue: string; fix: string; points?: string }[] {
  const v = toView(r);
  if (!v) return [];
  return v2Recommendations(v)
    .filter(x => x.category !== 'Tip' && x.fix)
    .slice(0, n)
    .map(x => ({ issue: x.issue || '', fix: x.fix || '', ...(x.points ? { points: x.points } : {}) }));
}
