// SPDX-License-Identifier: MIT
/**
 * Coding agents score from an AFDocs run on the scanned page, plus Lensy's own
 * checks in the same tiers. Spec: docs/coding-agents-afdocs/spec.md.
 *
 * AFDocs' formula: every check earns a share of its weight (10/7/4/2 by tier,
 * warns earn a fraction), the score is earned over possible, and some critical
 * failures cap it (no llms.txt caps at 59). Skipped checks count for nothing
 * either way. Lensy checks are added to both sides of that ratio.
 *
 * Pure: no network, no clock.
 */
import type { AfdocsRun } from './afdocs-page';
import type { SignalsV2 } from './collect-signals-v2';
import type { CheckResult, ScoreResult } from './scoring-v2';

export const AFDOCS_LABELS: Record<string, string> = {
    'llms-txt-exists': 'llms.txt exists',
    'llms-txt-valid': 'llms.txt format',
    'llms-txt-size': 'llms.txt size',
    'llms-txt-links-resolve': 'llms.txt links resolve',
    'llms-txt-links-markdown': 'llms.txt links point to Markdown',
    'llms-txt-directive-html': 'Page points agents to llms.txt (HTML)',
    'llms-txt-directive-md': 'Page points agents to llms.txt (Markdown)',
    'llms-txt-coverage': 'llms.txt covers the sitemap',
    'markdown-url-support': '.md version of the page',
    'content-negotiation': 'Markdown on request',
    'rendering-strategy': 'Content without JavaScript',
    'page-size-markdown': 'Markdown size',
    'page-size-html': 'HTML size',
    'page-size-transfer': 'Download size',
    'content-start-position': 'Content starts near the top',
    'single-fetch-completeness': 'Complete in one fetch',
    'tabbed-content-serialization': 'Tabbed content readable',
    'section-header-quality': 'Headers inside tabs',
    'markdown-code-fence-validity': 'Code fences closed',
    'markdown-link-portability': 'Links work outside the site',
    'embedded-data-serialization': 'Embedded data size',
    'markdown-content-parity': 'Markdown matches HTML',
    'cache-header-hygiene': 'Cache headers',
    'http-status-codes': 'Real 404s for missing pages',
    'redirect-behavior': 'Redirects',
    'auth-gate-detection': 'Public without login',
    'auth-alternative-access': 'Alternative access to gated docs',
    'bot-protection-interference': 'Bot protection lets agents in',
};

const titleCase = (id: string) => id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
const round1 = (n: number) => Math.round(n * 10) / 10;
const statusOf = (share: number): CheckResult['status'] => share >= 1 ? 'pass' : share <= 0 ? 'fail' : 'warn';

/** Lensy check on top of AFDocs: medium tier, the same weight as AFDocs' own medium checks. */
export const HEADINGS_ID = 'lensy-headings';
export const HEADINGS_WEIGHT = 4;

// Agents find a section by its heading text (the #fragment never reaches the
// server), so one H1 and an unbroken outline let them land on the right part of
// the page. AFDocs' section-header-quality only looks at headers inside tabs.
export function headingsShare(s: SignalsV2): number {
    const h = s.receivedHeadings;
    const h1 = h.h1Count === 1 ? 0.5 : h.h1Count > 1 ? 0.2 : 0;
    const outline = h.count < 2 ? 0 : h.skips === 0 ? 0.5 : h.skips === 1 ? 0.25 : 0;
    return h1 + outline;
}

interface Scored { check: CheckResult; earned: number; possible: number }

function headingsCheck(s: SignalsV2): Scored {
    const share = headingsShare(s);
    const h = s.receivedHeadings;
    const status = statusOf(share);
    return {
        check: {
            id: HEADINGS_ID,
            label: 'Headings an agent can navigate',
            category: 'lensy',
            points: round1(share * HEADINGS_WEIGHT),
            max: HEADINGS_WEIGHT,
            status,
            detail: `${h.h1Count} H1, ${h.count} heading${h.count === 1 ? '' : 's'}, ${h.skips} level skip(s) in what an agent receives`,
            ...(status !== 'pass' ? { fix: 'Use exactly one H1 and nest headings without skipping levels (H2 then H3). Agents find sections by heading text.' } : {}),
        },
        earned: share * HEADINGS_WEIGHT,
        possible: HEADINGS_WEIGHT,
    };
}

export interface AfdocsScoreResult extends ScoreResult {
    source: 'afdocs';
    afdocsVersion: string;
    /** AFDocs' own score for this page, before Lensy checks. Stored, not shown. */
    afdocsScore: number;
    cap?: { cap: number; checkId: string; reason: string };
}

export function scoreCodingAgentsAfdocs(run: AfdocsRun, signals?: SignalsV2): AfdocsScoreResult {
    const scored: Scored[] = [];
    for (const r of run.results) {
        const cs = run.score.checkScores[r.id];
        if (!cs || cs.scoreDisplayMode === 'notApplicable') continue;
        if (r.status !== 'pass' && r.status !== 'warn' && r.status !== 'fail') continue;
        const fix = r.status !== 'pass' ? run.score.resolutions[r.id] : undefined;
        scored.push({
            check: {
                id: r.id,
                label: AFDOCS_LABELS[r.id] || titleCase(r.id),
                category: r.category,
                points: round1(cs.earnedScore),
                max: round1(cs.maxScore),
                status: r.status,
                detail: r.message,
                ...(fix ? { fix } : {}),
            },
            // AFDocs sums unrounded scores; so do we.
            earned: cs.earnedScore,
            possible: cs.maxScore,
        });
    }
    if (signals) scored.push(headingsCheck(signals));

    const earned = scored.reduce((sum, c) => sum + c.earned, 0);
    const possible = scored.reduce((sum, c) => sum + c.possible, 0);
    const rawScore = possible > 0 ? (earned / possible) * 100 : 0;
    const cap = run.score.cap;
    return {
        score: Math.round(cap ? Math.min(rawScore, cap.cap) : rawScore),
        checks: scored.map(c => c.check),
        source: 'afdocs',
        afdocsVersion: run.version,
        afdocsScore: run.score.overall,
        ...(cap ? { cap } : {}),
    };
}
