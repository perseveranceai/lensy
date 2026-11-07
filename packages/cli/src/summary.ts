// SPDX-License-Identifier: MIT
// The short default view: what to fix first, in points that add up to the score.
// Terminal only; --md, --html and --json keep every check. No per-check code:
// labels, findings and fixes come from the report, tidied for one page.
import type { Check, Report, Score } from '@perseverance-ai/lensy-core';

// AFDocs describes site samples ("All 1 pages contain..."). Lensy checks one
// page, so say "The page" and fix the verb.
const VERBS: Record<string, string> = {
  contain: 'contains', support: 'supports', return: 'returns', serve: 'serves', deliver: 'delivers',
  carry: 'carries', have: 'has', are: 'is', use: 'uses', include: 'includes', load: 'loads',
};
// AFDocs sometimes leaves out the verb: "All 1 pages under 50K chars".
const PREPOSITIONS = new Set(['under', 'over', 'above', 'below', 'within']);
const verb = (v: string) => (PREPOSITIONS.has(v) ? `is ${v}` : VERBS[v] ?? v);

export function tidy(text: string): string {
  return text
    .replace(/\b[Aa]ll 1 markdown pages (\w+)/g, (_, v) => `The Markdown version ${verb(v)}`)
    .replace(/\b1 of 1 markdown pages (\w+)/g, (_, v) => `The Markdown version ${verb(v)}`)
    .replace(/\b[Aa]ll 1 pages (\w+)/g, (_, v) => `The page ${verb(v)}`)
    .replace(/\b1 of 1 pages (\w+)/g, (_, v) => `The page ${verb(v)}`)
    .replace(/^1 pages (\w+)/g, (_, v) => `The page ${verb(v)}`)
    .replace(/\b1\/1 pages (\w+)/g, (_, v) => `The page ${verb(v)}`)
    .replace(/ of any of 1 pages/g, ' of the page')
    .replace(/ (?:on|across) (?:all )?1 pages/g, ' on the page')
    .replace(/ \(0\/1 pages return markdown\)/g, '')
    .replace(/ \(100%\)$/, '')
    .replace(/between their markdown and HTML versions/g, 'between its Markdown and HTML versions');
}

/** A whole fix, tidied, without sentences that name options of other tools (AFDocs flags). */
export function cleanFix(fix: string): string {
  return tidy(fix).split(/(?<=[.!?])\s+(?=[A-Z"])/).filter(s => !/(^|\s)--[a-z]/.test(s)).join(' ');
}

// Words a fix sentence starts with when it says what to do.
const ACTION = /^(Add|Allow|Avoid|Configure|Create|Declare|Ensure|Fix|Generate|Give|Include|Keep|Make|Move|Nest|Point|Provide|Publish|Put|Reduce|Remove|Replace|Return|Review|Serve|Set|Split|Start|Treat|Turn|Use|Verify|Write)\b/;

/** The one sentence of a fix that says what to do, without options of other tools. */
export function actionLine(fix: string): string | null {
  return cleanFix(fix).split(/(?<=[.!?])\s+(?=[A-Z"])/).find(s => ACTION.test(s)) ?? null;
}

export interface FixItem {
  label: string;
  audience: 'Coding agents' | 'AI search' | 'Both audiences';
  /** points lost on the 0-100 scale; they add up to 100 minus the score */
  lost: number;
  action: string | null;
  finding: string;
}

export interface NoteItem { label: string; finding: string }

// C1/S2, and AFDocs rendering-strategy/S2, are the same question scored twice.
export const SHARED_JS = new Set(['C1', 'rendering-strategy', 'S2']);

/**
 * Each check's points on the 0-100 scale of its score, rounded so they add up
 * exactly (largest remainder). AFDocs checks carry 112 or so raw points; the
 * score is earned / possible, so the scaled losses add up to 100 minus it.
 */
export function scaledLosses(s: Score): Map<string, number> {
  const ran = s.checks.filter(c => c.points !== null && c.max > 0);
  const possible = ran.reduce((n, c) => n + c.max, 0);
  const out = new Map<string, number>();
  if (!possible) return out;
  const raw = ran.map(c => ({ id: c.id, v: ((c.max - (c.points as number)) * 100) / possible }));
  const target = Math.round(raw.reduce((n, x) => n + x.v, 0));
  const floors = raw.map(x => ({ ...x, f: Math.floor(x.v + 1e-9) }));
  let left = target - floors.reduce((n, x) => n + x.f, 0);
  for (const x of [...floors].sort((a, b) => (b.v - b.f) - (a.v - a.f))) {
    if (left <= 0) break;
    x.f += 1;
    left -= 1;
  }
  for (const x of floors) out.set(x.id, x.f);
  return out;
}

/** The uncapped score the checks add up to, when the reported score is lower (an AFDocs cap). */
export function capFrom(s: Score): number | null {
  const ran = s.checks.filter(c => c.points !== null && c.max > 0);
  const possible = ran.reduce((n, c) => n + c.max, 0);
  if (!possible || s.score === null) return null;
  const uncapped = Math.round((100 * ran.reduce((n, c) => n + (c.points as number), 0)) / possible);
  return uncapped > s.score ? uncapped : null;
}

export interface Summary {
  fixes: FixItem[];
  notes: NoteItem[];
  passed: { coding: [number, number]; search: [number, number] };
}

export function summarize(r: Report): Summary {
  const fixes: FixItem[] = [];
  const notes: NoteItem[] = [];
  const byKey = new Map<string, FixItem | null>();
  const add = (audience: FixItem['audience'], c: Check, lost: number) => {
    const key = SHARED_JS.has(c.id) ? 'js' : c.id;
    const prev = byKey.get(key);
    if (prev !== undefined) {
      // The JavaScript check, failed in both scores: one fix, both audiences.
      if (prev) { prev.audience = 'Both audiences'; prev.lost += lost; }
      return;
    }
    const finding = tidy(c.detail);
    if (lost <= 0) { byKey.set(key, null); notes.push({ label: c.label, finding }); return; }
    const item: FixItem = { label: c.label, audience, lost, action: c.fix ? actionLine(c.fix) : null, finding };
    byKey.set(key, item);
    fixes.push(item);
  };
  const count = (s: Score): [number, number] => {
    const ran = s.checks.filter(c => c.points !== null);
    return [ran.filter(c => c.status === 'pass').length, ran.length];
  };
  for (const [audience, s] of [['Coding agents', r.scores.codingAgents], ['AI search', r.scores.aiSearch]] as const) {
    const losses = scaledLosses(s);
    for (const c of s.checks) {
      if (c.status === 'pass' || c.points === null) continue;
      add(audience, c, losses.get(c.id) ?? 0);
    }
  }
  fixes.sort((a, b) => b.lost - a.lost);
  return { fixes, notes, passed: { coding: count(r.scores.codingAgents), search: count(r.scores.aiSearch) } };
}
