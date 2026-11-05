// SPDX-License-Identifier: MIT
/**
 * Runs AFDocs on the one page being scanned. AFDocs implements the
 * Agent-Friendly Documentation Spec and is the engine behind Fern's,
 * Mintlify's and Document360's agent scores. Spec: docs/coding-agents-afdocs/spec.md.
 *
 * Page only: curated sampling with just the given URL, documented in the AFDocs CLI
 * reference, and its scoring treats it as a full run (the under-5-pages rule
 * only applies to random/deterministic sampling).
 */

// Pinned exactly; upgrade on purpose and re-capture the fixtures (Rakesh, 2026-11-03).
export const AFDOCS_VERSION = '0.23.0';

export type AfdocsStatus = 'pass' | 'warn' | 'fail' | 'skip' | 'error';

export interface AfdocsCheckResult {
    id: string;
    category: string;
    status: AfdocsStatus;
    message: string;
}

export interface AfdocsCheckScore {
    earnedScore: number;
    maxScore: number;
    scoreDisplayMode: string;
}

/** What we keep from an AFDocs run: plain JSON, so it survives S3 and test fixtures. */
export interface AfdocsRun {
    version: string;
    url: string;
    results: AfdocsCheckResult[];
    score: {
        overall: number;
        cap?: { cap: number; checkId: string; reason: string };
        checkScores: Record<string, AfdocsCheckScore>;
        resolutions: Record<string, string>;
    };
    requests?: number;
    ms: number;
}

export interface AfdocsModule {
    runChecks(url: string, options: Record<string, unknown>): Promise<any>;
    computeScore(report: any): any;
}

// llms-txt-coverage asks whether llms.txt lists the whole site, which isn't
// about this page, and it reads the whole sitemap: the slowest part of a run.
export const AFDOCS_SKIP = ['llms-txt-coverage'];

export const AFDOCS_OPTIONS = {
    samplingStrategy: 'curated',
    // llms.txt link checks sample this many links (AFDocs default 50).
    maxLinksToTest: 20,
    maxConcurrency: 3,
    requestDelay: 200,
    requestTimeout: 10000,
    skipCheckIds: AFDOCS_SKIP,
};

const DEFAULT_TIMEOUT_MS = 150000;

// afdocs is ESM-only and this Lambda compiles to CommonJS, where TypeScript
// would turn a plain import() into require().
const loadAfdocs = (): Promise<AfdocsModule> =>
    (new Function('m', 'return import(m)') as (m: string) => Promise<AfdocsModule>)('afdocs');

/** Never throws: a missing run falls back to Lensy's own Coding agents checks. */
export async function runAfdocsOnPage(
    url: string,
    opts: { load?: () => Promise<AfdocsModule>; timeoutMs?: number } = {},
): Promise<AfdocsRun | undefined> {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
        const afdocs = await (opts.load || loadAfdocs)();
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        });
        const report = await Promise.race([afdocs.runChecks(url, { ...AFDOCS_OPTIONS, curatedPages: [url] }), timeout]);
        const score = afdocs.computeScore(report);
        const run: AfdocsRun = {
            version: AFDOCS_VERSION,
            url,
            results: (report.results || []).map((r: any) => ({ id: r.id, category: r.category, status: r.status, message: r.message })),
            score: {
                overall: score.overall,
                ...(score.cap ? { cap: { cap: score.cap.cap, checkId: score.cap.checkId, reason: score.cap.reason } } : {}),
                checkScores: Object.fromEntries(Object.entries(score.checkScores || {}).map(([id, c]: [string, any]) =>
                    [id, { earnedScore: c.earnedScore, maxScore: c.maxScore, scoreDisplayMode: c.scoreDisplayMode }])),
                resolutions: score.resolutions || {},
            },
            ...(report.requestSummary?.requests !== undefined ? { requests: report.requestSummary.requests } : {}),
            ms: Date.now() - started,
        };
        console.log(`[AFDocs] ${url}: ${run.score.overall}${run.score.cap ? ` (capped by ${run.score.cap.checkId})` : ''}, ${run.results.length} checks, ${run.requests ?? '?'} requests, ${run.ms}ms`);
        return run;
    } catch (e) {
        console.warn(`[AFDocs] run failed for ${url} after ${Date.now() - started}ms, using Lensy checks:`, (e as Error).message);
        return undefined;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
