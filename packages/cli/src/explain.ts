// SPDX-License-Identifier: MIT
// `lensy explain <checkId>` and docs/checks.md, both from the engine's check
// registry (Req 3.8, 4.11). No per-check text lives in the CLI.
import { CHECKS } from '@perseverance-ai/lensy-core';
import type { CheckMeta } from '@perseverance-ai/lensy-core';

const SCORE: Record<CheckMeta['score'], string> = { codingAgents: 'Coding agents', aiSearch: 'AI search' };

export function findCheck(id: string): CheckMeta | undefined {
  return CHECKS.find(c => c.id.toLowerCase() === id.trim().toLowerCase());
}

export function explainCheck(id: string): string | null {
  const c = findCheck(id);
  if (!c) return null;
  const lines = [
    `${c.id} ${c.label}: ${c.max} of the ${SCORE[c.score]} score's 100 points`,
    '',
    `What it measures: ${c.measures}`,
    '',
    `Why it matters: ${c.why}`,
  ];
  if (c.hostNote) lines.push('', `Depends on your hosting: ${c.hostNote}`);
  if (c.sourceNote) lines.push('', `Checking source files: ${c.sourceNote}`);
  lines.push('', 'Evidence:', ...c.evidence.map(e => `  - ${e.title}: ${e.url}`));
  return lines.join('\n');
}

/** packages/docs/checks.md. A test fails when the committed file differs (Req 6.4). */
export function checksDoc(): string {
  const out = [
    '# Lensy checks',
    '',
    'Generated from the engine\'s check registry (`backend/lambda/agent-handler/tools/check-registry.ts`) by `npm run docs:checks`. Don\'t edit by hand.',
    '',
    'Lensy gives two scores out of 100. Each check below is worth the points shown in one of them. `lensy explain <id>` prints the same text.',
  ];
  for (const score of ['codingAgents', 'aiSearch'] as const) {
    out.push('', `## ${SCORE[score]}`, '', '| ID | Check | Points |', '|---|---|---|');
    for (const c of CHECKS.filter(x => x.score === score)) out.push(`| ${c.id} | ${c.label} | ${c.max} |`);
    for (const c of CHECKS.filter(x => x.score === score)) {
      out.push('', `### ${c.id} ${c.label} (${c.max} points)`, '', `**What it measures:** ${c.measures}`, '', `**Why it matters:** ${c.why}`);
      if (c.hostNote) out.push('', `**Depends on your hosting:** ${c.hostNote}`);
      if (c.sourceNote) out.push('', `**Checking source files:** ${c.sourceNote}`);
      out.push('', '**Evidence:**', '', ...c.evidence.map(e => `- [${e.title}](${e.url})`));
    }
  }
  return out.join('\n') + '\n';
}
