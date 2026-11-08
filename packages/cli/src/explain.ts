// SPDX-License-Identifier: MIT
// `lensy explain <checkId>` and docs/checks.md, both from the engine's check
// registry (Req 3.8, 4.11). No per-check text lives in the CLI.
import { AFDOCS_CHECKS, CHECKS } from '@perseverance-ai/lensy-core';
import type { CheckMeta } from '@perseverance-ai/lensy-core';

const SCORE: Record<CheckMeta['score'], string> = { codingAgents: 'Coding agents', aiSearch: 'AI search' };

/** Lensy's checks, then the AFDocs checks the Coding agents score uses when AFDocs runs. */
export const ALL_CHECKS: CheckMeta[] = [...CHECKS, ...AFDOCS_CHECKS];

export function findCheck(id: string): CheckMeta | undefined {
  return ALL_CHECKS.find(c => c.id.toLowerCase() === id.trim().toLowerCase());
}

// AFDocs-scored checks earn a share of a tier weight; Lensy's C1-S6 are points out of 100.
const inAfdocsScore = (c: CheckMeta) => AFDOCS_CHECKS.includes(c);
const worth = (c: CheckMeta) => {
  if (inAfdocsScore(c)) {
    return c.source === 'afdocs'
      ? `weight ${c.max} in the Coding agents score (AFDocs tiers: critical 10, high 7, medium 4, low 2)`
      : `weight ${c.max} in the Coding agents score (Lensy's own check, scored alongside AFDocs)`;
  }
  // C1-C6 score Coding agents only when AFDocs can't run.
  return c.score === 'codingAgents'
    ? `${c.max} of 100 points in the Coding agents score when AFDocs can't run (the fallback)`
    : `${c.max} of the ${SCORE[c.score]} score's 100 points`;
};

export function explainCheck(id: string): string | null {
  const c = findCheck(id);
  if (!c) return null;
  const lines = [`${c.id} ${c.label}: ${worth(c)}`];
  if (c.source === 'afdocs') lines.push('', 'Source: AFDocs, the Agent-Friendly Documentation checks. The description is AFDocs\' own.');
  lines.push('', `What it measures: ${c.measures}`, '', `Why it matters: ${c.why}`);
  if (c.hostNote) lines.push('', `Depends on your hosting: ${c.hostNote} A local build (--dir or a localhost URL) ${c.hostDependent === 'full' ? "doesn't count this check" : 'counts this check, but your host can change the result'}.`);
  lines.push('', 'Evidence:', ...c.evidence.map(e => `  - ${e.title}: ${e.url}`));
  return lines.join('\n');
}

function section(out: string[], c: CheckMeta, unit: string) {
  out.push('', `### ${c.id} ${c.label} (${c.max} ${unit})`, '', `**What it measures:** ${c.measures}`, '', `**Why it matters:** ${c.why}`);
  if (c.hostNote) out.push('', `**Depends on your hosting:** ${c.hostNote} A local build (\`--dir\` or a localhost URL) ${c.hostDependent === 'full' ? "doesn't count this check" : 'counts this check, but your host can change the result'}.`);
  out.push('', '**Evidence:**', '', ...c.evidence.map(e => `- [${e.title}](${e.url})`));
}

/** packages/docs/checks.md. A test fails when the committed file differs (Req 6.4). */
export function checksDoc(): string {
  const out = [
    '# Lensy checks',
    '',
    'Generated from the engine\'s check registry (`backend/lambda/agent-handler/tools/check-registry.ts`) by `npm run docs:checks`. Don\'t edit by hand.',
    '',
    'Lensy gives two scores out of 100. The Coding agents score comes from AFDocs, the Agent-Friendly Documentation checks, plus Lensy\'s own heading check; if AFDocs can\'t run, it falls back to Lensy\'s C1-C6. AI search is Lensy\'s S1-S6. `lensy explain <id>` prints the same text.',
    '',
    '## Coding agents (AFDocs)',
    '',
    'Each check earns a share of its weight (critical 10, high 7, medium 4, low 2; a warning earns part of it). The score is the weight earned over the weight of the checks that ran, out of 100. Some critical failures cap the score: with no llms.txt it is at most 59.',
    '',
    '| ID | Check | Source | Weight |',
    '|---|---|---|---|',
  ];
  for (const c of AFDOCS_CHECKS) out.push(`| ${c.id} | ${c.label} | ${c.source === 'afdocs' ? 'AFDocs' : 'Lensy'} | ${c.max} |`);
  for (const c of AFDOCS_CHECKS) section(out, c, 'weight');
  for (const score of ['codingAgents', 'aiSearch'] as const) {
    const title = score === 'codingAgents' ? 'Coding agents without AFDocs (C1-C6)' : SCORE[score];
    out.push('', `## ${title}`, '', '| ID | Check | Points |', '|---|---|---|');
    for (const c of CHECKS.filter(x => x.score === score)) out.push(`| ${c.id} | ${c.label} | ${c.max} |`);
    for (const c of CHECKS.filter(x => x.score === score)) section(out, c, 'points');
  }
  return out.join('\n') + '\n';
}
