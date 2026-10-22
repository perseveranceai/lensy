/**
 * One fetch helper for every request Lensy makes to the site it scans
 * (spec: docs/two-score-readiness/spec.md §7).
 *
 * Lensy used to send a Chrome user agent. Bot protection such as Cloudflare
 * refuses clients that claim to be Chrome but don't behave like one, so honest
 * docs sites were rejected as "unreachable" (Branch, 2026-10-21, REG-18).
 * Now Lensy names itself first and only retries with the browser user agent
 * when that is refused with 403 or 429.
 *
 * Outcomes:
 *   - honest name got an answer         -> via 'honest'
 *   - honest refused, browser worked    -> via 'browser' (report shows a warning)
 *   - both refused with 403/429         -> errorKind 'blocked'
 *   - DNS, TLS, timeout, reset          -> errorKind 'network' (never "blocked" or "not found")
 */

export const HONEST_UA = 'Lensy/1.0 (+https://perseveranceai.com/bot)';
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (+https://perseveranceai.com/bot)';

export const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

export type FetchVia = 'honest' | 'browser';
export type FetchErrorKind = 'network' | 'blocked';

export interface FetchAttempt {
    response: Response | null;
    via: FetchVia;
    honestStatus: number;      // 0 when the honest request failed at the network level
    browserStatus?: number;    // set only when the browser fallback ran
    errorKind?: FetchErrorKind;
    error?: string;
}

export interface FetchPageResult {
    ok: boolean;
    status: number;
    finalUrl: string;
    headers: Headers;
    body: string;
    via: FetchVia;
    honestStatus: number;
    browserStatus?: number;
    errorKind?: FetchErrorKind;
    error?: string;
}

export interface FetchOptions {
    accept?: string;
    method?: 'GET' | 'HEAD';
    timeoutMs?: number;
    headers?: Record<string, string>;
    /** Injected in tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
}

const isRefused = (status: number) => status === 403 || status === 429;

async function attempt(url: string, ua: string, opts: FetchOptions): Promise<{ res: Response | null; error?: string }> {
    const doFetch = opts.fetchImpl || fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    try {
        const res = await doFetch(url, {
            method: opts.method || 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'Accept': opts.accept || ACCEPT_HTML,
                'Accept-Language': 'en-US,en;q=0.9',
                ...(opts.headers || {}),
                'User-Agent': ua,
            },
        });
        return { res };
    } catch (e) {
        return { res: null, error: (e as Error).message || String(e) };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Honest user agent first, browser user agent once on 403/429. Returns the
 * Response unread so callers can stream or cap the body themselves.
 */
export async function fetchWithFallback(url: string, opts: FetchOptions = {}): Promise<FetchAttempt> {
    const honest = await attempt(url, HONEST_UA, opts);
    if (!honest.res) {
        return { response: null, via: 'honest', honestStatus: 0, errorKind: 'network', error: honest.error };
    }
    if (!isRefused(honest.res.status)) {
        return { response: honest.res, via: 'honest', honestStatus: honest.res.status };
    }

    // Drain the refused body so the connection can be reused.
    try { await honest.res.arrayBuffer(); } catch { /* ignore */ }

    const browser = await attempt(url, BROWSER_UA, opts);
    if (!browser.res) {
        return { response: null, via: 'browser', honestStatus: honest.res.status, browserStatus: 0, errorKind: 'network', error: browser.error };
    }
    const browserStatus = browser.res.status;
    return {
        response: browser.res,
        via: 'browser',
        honestStatus: honest.res.status,
        browserStatus,
        ...(isRefused(browserStatus) ? { errorKind: 'blocked' as const } : {}),
    };
}

/** fetchWithFallback plus the body read as text. */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchPageResult> {
    const a = await fetchWithFallback(url, opts);
    if (!a.response) {
        return {
            ok: false, status: 0, finalUrl: url, headers: new Headers(), body: '',
            via: a.via, honestStatus: a.honestStatus, browserStatus: a.browserStatus,
            errorKind: a.errorKind, error: a.error,
        };
    }
    let body = '';
    let readError: string | undefined;
    if ((opts.method || 'GET') !== 'HEAD') {
        try { body = await a.response.text(); } catch (e) { readError = (e as Error).message; }
    }
    return {
        ok: a.response.ok && !readError,
        status: a.response.status,
        finalUrl: a.response.url || url,
        headers: a.response.headers,
        body,
        via: a.via,
        honestStatus: a.honestStatus,
        browserStatus: a.browserStatus,
        errorKind: readError ? 'network' : a.errorKind,
        error: readError,
    };
}

/** Plain-object copy of response headers (for JSON artifacts and the detection engine). */
export function headersToRecord(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((v, k) => { out[k] = v; });
    return out;
}
