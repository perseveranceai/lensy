// Replays saved responses as fetch() for the scoring tests. Same lookup rules
// as backend/scripts/fixture-replay.mjs, which the capture script uses to re-run
// the prototype offline: method + URL + Accept, then method + URL, preferring an
// entry sent with the same kind of user agent (honest or browser).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { PageInput } from '../collect-signals-v2';

export interface FixtureEntry {
    method: string; url: string; accept: string; ua: string;
    status?: number; finalUrl?: string; headers?: Record<string, string>; body?: string; error?: string;
}

const HONEST = /^Lensy\//;
const PAGE_ACCEPT = 'text/html,*/*;q=0.8'; // the prototype's page request

export function findEntry(entries: FixtureEntry[], method: string, url: string, accept: string, ua: string) {
    const same = entries.filter(e => e.method === method && e.url === url);
    const exact = same.filter(e => e.accept === accept);
    const pool = exact.length ? exact : same;
    if (!pool.length) return null;
    return pool.find(e => HONEST.test(e.ua) === HONEST.test(ua)) || pool[0];
}

export function toResponse(entry: FixtureEntry, method: string): Response {
    const status = entry.status!;
    const nullBody = method === 'HEAD' || [101, 204, 205, 304].includes(status);
    const res = new Response(nullBody ? null : entry.body ?? '', { status, headers: entry.headers });
    Object.defineProperty(res, 'url', { value: entry.finalUrl });
    return res;
}

/** fetch() over saved entries. `misses` collects requests with no entry. */
export function replayFetch(entries: FixtureEntry[], misses: string[] = []): typeof fetch {
    return (async (input: any, init: RequestInit = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const headers = new Headers(init.headers as HeadersInit);
        const method = (init.method || 'GET').toUpperCase();
        const entry = findEntry(entries, method, url, headers.get('accept') || '', headers.get('user-agent') || '');
        if (!entry) { misses.push(`${method} ${url} [${headers.get('accept')}]`); throw new TypeError('fetch failed (no fixture)'); }
        if (entry.error) throw new TypeError(entry.error);
        return toResponse(entry, method);
    }) as typeof fetch;
}

export const FIXTURE_DIR = path.join(__dirname, 'fixtures');

export function loadFixture(name: string): { entries: FixtureEntry[]; expected: any } {
    const dir = path.join(FIXTURE_DIR, name);
    const { entries } = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'responses.json.gz'))).toString('utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
    return { entries, expected };
}

/**
 * The page as the Lambda prefetch would have handed it over: the prototype's
 * first request for the URL (honest user agent), or the browser retry when the
 * honest one was refused.
 */
export function pageInputFromFixture(entries: FixtureEntry[], url: string): PageInput {
    const pageReqs = entries.filter(e => e.method === 'GET' && e.url === url && e.accept === PAGE_ACCEPT);
    const honest = pageReqs.find(e => HONEST.test(e.ua));
    const browser = pageReqs.find(e => !HONEST.test(e.ua));
    if (!honest) throw new Error(`no page request for ${url}`);
    const used = honest.status && honest.status >= 200 && honest.status < 300 ? honest : browser || honest;
    return {
        finalUrl: used.finalUrl || url,
        html: used.body || '',
        headers: used.headers || {},
        gate: {
            via: used === honest ? 'honest' : 'browser',
            honestStatus: honest.status || 0,
            ...(browser ? { browserStatus: browser.status } : {}),
        },
    };
}
