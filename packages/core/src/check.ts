// SPDX-License-Identifier: MIT
// check(url): fetch the page honestly, then score it with the website's engine
// (design "How check() works"). Core always calls the engine with
// browserFallback: false: the CLI never poses as a browser (Req 1.5).
import { ACCEPT_HTML, buildScoringV2, collectSignalsV2, fetchPage, headersToRecord } from './engine';
import type { PageInput } from './engine';
import { failedReport, okReport, Report, ReportBase } from './report';

declare const __LENSY_CORE_VERSION__: string;
declare const __ENGINE_COMMIT__: string;
export const VERSION: string = typeof __LENSY_CORE_VERSION__ === 'string' ? __LENSY_CORE_VERSION__ : '0.0.0';
export const ENGINE_COMMIT: string = typeof __ENGINE_COMMIT__ === 'string' ? __ENGINE_COMMIT__ : 'unknown';

export const defaultUserAgent = (version = VERSION) => `Lensy-CLI/${version} (+https://perseveranceai.com/bot)`;

export interface CheckOptions {
  /** default `Lensy-CLI/<version> (+https://perseveranceai.com/bot)` */
  userAgent?: string;
  /** tests inject the fixture replayer */
  fetchImpl?: typeof fetch;
  /** overrides engine defaults (page 8000, sub-requests 10000) */
  timeoutMs?: number;
  /** fixed clock for tests */
  now?: number;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Local builds are phase 2 (Mahesh, 2026-11-02). The CLI exits 2 on these before checking. */
export function isLocalUrl(url: string): boolean {
  try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

export class LocalUrlError extends Error {
  constructor(url: string) {
    super(`${url} is a local address. Checking a local build comes in a later version.`);
    this.name = 'LocalUrlError';
  }
}

const isHtml = (contentType: string, body: string) =>
  /html/i.test(contentType) || (!contentType && /<html[\s>]/i.test(body));

function base(url: string, finalUrl: string, opts: CheckOptions): ReportBase {
  return { url, finalUrl, mode: 'url', commit: ENGINE_COMMIT, checkedAt: new Date(opts.now ?? Date.now()).toISOString() };
}

export async function check(url: string, opts: CheckOptions = {}): Promise<Report> {
  if (isLocalUrl(url)) throw new LocalUrlError(url);
  const userAgent = opts.userAgent ?? defaultUserAgent();
  const r = await fetchPage(url, {
    accept: ACCEPT_HTML,
    timeoutMs: opts.timeoutMs ?? 8000,
    userAgent,
    browserFallback: false,
    fetchImpl: opts.fetchImpl,
  });
  if (r.errorKind === 'blocked') return failedReport(base(url, r.finalUrl, opts), 'blocked', r.status);
  if (r.errorKind === 'network' || !r.ok) return failedReport(base(url, r.finalUrl, opts), 'unreachable', r.status || undefined);
  if (!isHtml(r.headers.get('content-type') || '', r.body)) return failedReport(base(url, r.finalUrl, opts), 'not-html', r.status);
  const page: PageInput = {
    finalUrl: r.finalUrl,
    html: r.body,
    headers: headersToRecord(r.headers),
    gate: { via: 'honest', honestStatus: r.status },
  };
  return checkFromPage(page, { ...opts, userAgent }, url);
}

/** Score a page already fetched. The parity tests call this with the fixtures' pages. */
export async function checkFromPage(page: PageInput, opts: CheckOptions = {}, submittedUrl = page.finalUrl): Promise<Report> {
  const signals = await collectSignalsV2(page, {
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    userAgent: opts.userAgent ?? defaultUserAgent(),
    browserFallback: false,
    now: opts.now,
  });
  return okReport(base(submittedUrl, page.finalUrl, opts), buildScoringV2(signals), signals);
}
