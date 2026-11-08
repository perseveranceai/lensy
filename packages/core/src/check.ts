// SPDX-License-Identifier: MIT
// check(url): fetch the page honestly, then score it with the website's engine
// (design "How check() works"). Core always calls the engine with
// browserFallback: false: the CLI never poses as a browser (Req 1.5).
import { ACCEPT_HTML, buildScoringV2, collectSignalsV2, fetchPage, headersToRecord, runAfdocsOnPage } from './engine';
import type { AfdocsModule, PageInput } from './engine';
import { isLocalUrl, localScore, makeLocalFetch, publishedUrl } from './local';
import { failedReport, okReport, Mode, Report, ReportBase } from './report';

declare const __LENSY_CORE_VERSION__: string;
declare const __ENGINE_COMMIT__: string;
export const VERSION: string = typeof __LENSY_CORE_VERSION__ === 'string' ? __LENSY_CORE_VERSION__ : '0.0.0';
export const ENGINE_COMMIT: string = typeof __ENGINE_COMMIT__ === 'string' ? __ENGINE_COMMIT__ : 'unknown';

export const defaultUserAgent = (version = VERSION) => `lensy-cli/${version} (+https://perseveranceai.com/bot)`;

export interface CheckOptions {
  /** default `lensy-cli/<version> (+https://perseveranceai.com/bot)` */
  userAgent?: string;
  /** tests inject the fixture replayer */
  fetchImpl?: typeof fetch;
  /** overrides engine defaults (page 8000, sub-requests 10000) */
  timeoutMs?: number;
  /** fixed clock for tests */
  now?: number;
  /**
   * Coding agents is built on AFDocs (docs/coding-agents-afdocs/spec.md). Off
   * only in tests that check Lensy's own checks; if AFDocs fails, the score
   * falls back to C1-C6, as on the website.
   */
  afdocs?: boolean;
  /** tests replay a saved AFDocs run instead of loading the bundled module */
  loadAfdocs?: () => Promise<AfdocsModule>;
  /**
   * Local mode (a build served on this machine): the published site, so its
   * sitemap, llms.txt and canonical links resolve against the local server.
   * See local.ts.
   */
  siteUrl?: URL;
}

// A literal import, so tsup bundles AFDocs into core: users install nothing extra.
const loadAfdocs = () => import('afdocs') as unknown as Promise<AfdocsModule>;
// stdout is the CLI's report; if AFDocs fails, Coding agents shows C1-C6 instead.
const SILENT = { log: () => {}, warn: () => {} };

export { isLocalUrl };

const isHtml = (contentType: string, body: string) =>
  /html/i.test(contentType) || (!contentType && /<html[\s>]/i.test(body));

function base(url: string, finalUrl: string, opts: CheckOptions, mode: Mode = 'url'): ReportBase {
  return { url, finalUrl, mode, commit: ENGINE_COMMIT, checkedAt: new Date(opts.now ?? Date.now()).toISOString() };
}

export async function check(url: string, opts: CheckOptions = {}): Promise<Report> {
  const local = isLocalUrl(url);
  const mode: Mode = local ? 'local' : 'url';
  const userAgent = opts.userAgent ?? defaultUserAgent();
  // Local mode: only the local server (and the published site, mapped to it) is reachable.
  const fetchImpl = local ? makeLocalFetch(new URL(url).origin, opts.siteUrl, opts.fetchImpl ?? fetch) : opts.fetchImpl;
  const r = await fetchPage(url, {
    accept: ACCEPT_HTML,
    timeoutMs: opts.timeoutMs ?? 8000,
    userAgent,
    browserFallback: false,
    fetchImpl,
  });
  if (r.errorKind === 'blocked') return failedReport(base(url, r.finalUrl, opts, mode), 'blocked', r.status);
  if (r.errorKind === 'network' || !r.ok) return failedReport(base(url, r.finalUrl, opts, mode), 'unreachable', r.status || undefined);
  if (!isHtml(r.headers.get('content-type') || '', r.body)) return failedReport(base(url, r.finalUrl, opts, mode), 'not-html', r.status);
  const page: PageInput = {
    // With a site URL, the page is judged as published: canonical, sitemap and
    // llms.txt links on the real domain then match it.
    finalUrl: local && opts.siteUrl ? publishedUrl(r.finalUrl, opts.siteUrl) : r.finalUrl,
    html: r.body,
    headers: headersToRecord(r.headers),
    gate: { via: 'honest', honestStatus: r.status },
  };
  return checkFromPage(page, { ...opts, userAgent, fetchImpl }, url, mode);
}

/** Score a page already fetched. The parity tests call this with the fixtures' pages. */
export async function checkFromPage(page: PageInput, opts: CheckOptions = {}, submittedUrl = page.finalUrl, mode: Mode = 'url'): Promise<Report> {
  const userAgent = opts.userAgent ?? defaultUserAgent();
  // In parallel, as on the website (check-ai-readiness.ts).
  const [signals, afdocs] = await Promise.all([
    collectSignalsV2(page, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs, userAgent, browserFallback: false, now: opts.now }),
    opts.afdocs === false ? undefined : runAfdocsOnPage(page.finalUrl, { load: opts.loadAfdocs ?? loadAfdocs, userAgent, fetchImpl: opts.fetchImpl, log: SILENT }),
  ]);
  const v2 = buildScoringV2(signals, afdocs);
  const report = okReport(base(submittedUrl, page.finalUrl, opts, mode), v2, signals);
  if (mode !== 'local') return report;
  const coding = v2.scores.codingAgents as { cap?: { cap: number } };
  // Requests to other hosts were refused on purpose, not lost: say so instead of "re-scan".
  const refused = [...new Set(report.netErrors.map(u => { try { return new URL(u).origin; } catch { return u; } }))];
  const tips = report.tips.map(t => t.id !== 'network' ? t : {
    id: 'local-refused',
    text: `A local check reaches only this machine, so ${report.netErrors.length} request(s) to ${refused.join(', ')} weren't sent and the checks that need them aren't counted.${opts.siteUrl ? '' : ' If that is your published docs address, add --site-url so they go to the local build.'}`,
  });
  return {
    ...report,
    tips,
    scores: {
      codingAgents: localScore(report.scores.codingAgents, coding.cap?.cap),
      aiSearch: localScore(report.scores.aiSearch),
    },
  };
}
