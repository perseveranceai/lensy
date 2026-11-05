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

import { AsyncLocalStorage } from 'node:async_hooks';
import { honestFetch } from '../shared/fetch-page';

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

// AFDocs has no fetch or user-agent option and sends every request through
// globalThis.fetch (dist/http.js). While a run is active, globalThis.fetch is a
// dispatcher: requests made inside an AFDocs run (tracked with
// AsyncLocalStorage) go through honestFetch from fetch-page.ts, so they carry
// Lensy's user agent and the caller's fetchImpl; every other caller in the
// process, including Lensy's own collector running alongside, gets the
// original fetch. The original is put back when the last run's work has
// actually finished, so a run that timed out still can't send requests under
// AFDocs' own name.
const route = new AsyncLocalStorage<typeof fetch>();
let original: typeof fetch | undefined;
let active = 0;

// The routed fetch runs outside the AFDocs context, so a fetchImpl that itself
// calls globalThis.fetch reaches the original instead of looping back here.
const dispatcher = ((input: any, init?: RequestInit) => {
    const routed = route.getStore();
    return routed ? route.exit(() => routed(input, init)) : original!(input, init);
}) as typeof fetch;

function acquire(): typeof fetch {
    if (active++ === 0) {
        original = globalThis.fetch;
        globalThis.fetch = dispatcher;
    }
    return original!;
}

function release(): void {
    if (--active === 0) {
        globalThis.fetch = original!;
        original = undefined;
    }
}

/** Runs fn with AFDocs' requests going through honestFetch. Exported for tests. */
export function withHonestFetch<T>(opts: { userAgent?: string; fetchImpl?: typeof fetch }, fn: () => Promise<T>): Promise<T> {
    const base = acquire();
    const work = route.run(honestFetch({ userAgent: opts.userAgent, fetchImpl: opts.fetchImpl ?? base }), fn);
    work.then(release, release);
    return work;
}

/** Never throws: a missing run falls back to Lensy's own Coding agents checks. */
export async function runAfdocsOnPage(
    url: string,
    opts: { load?: () => Promise<AfdocsModule>; timeoutMs?: number; userAgent?: string; fetchImpl?: typeof fetch } = {},
): Promise<AfdocsRun | undefined> {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
        const afdocs = await (opts.load || loadAfdocs)();
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        });
        const work = withHonestFetch(opts, () => afdocs.runChecks(url, { ...AFDOCS_OPTIONS, curatedPages: [url] }));
        const report = await Promise.race([work, timeout]);
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
