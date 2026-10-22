// REG-18 (unit part): sites behind bot protection were rejected as
// "unreachable" because the fetcher pretended to be Chrome (Branch, 2026-10-21).
// The shared fetch helper must name itself first, fall back to the browser
// user agent only on 403/429, and never report a network error as a block.
import { fetchPage, HONEST_UA, BROWSER_UA } from '../fetch-page';

type Answer = number | 'network';

// A fake fetch that answers per user agent and records what it was sent.
function fakeFetch(byUa: { honest: Answer; browser: Answer }) {
    const calls: { url: string; ua: string; accept: string }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        const ua = headers['User-Agent'];
        calls.push({ url, ua, accept: headers['Accept'] });
        const answer = ua === HONEST_UA ? byUa.honest : byUa.browser;
        if (answer === 'network') throw new TypeError('fetch failed: getaddrinfo ENOTFOUND');
        return new Response(answer === 200 ? '<html><h1>Docs</h1></html>' : 'denied', {
            status: answer,
            headers: { 'content-type': 'text/html' },
        });
    }) as unknown as typeof fetch;
    return { impl, calls };
}

describe('REG-18: fetchPage honest user agent with browser fallback', () => {
    test('403 for the browser UA and 200 for Lensy/1.0 gives pass (honest, no fallback)', async () => {
        const { impl, calls } = fakeFetch({ honest: 200, browser: 403 });
        const r = await fetchPage('https://help.branch.io/', { fetchImpl: impl });
        expect(r.ok).toBe(true);
        expect(r.via).toBe('honest');
        expect(r.honestStatus).toBe(200);
        expect(r.browserStatus).toBeUndefined();
        expect(r.errorKind).toBeUndefined();
        expect(r.body).toContain('<h1>Docs</h1>');
        expect(calls.map(c => c.ua)).toEqual([HONEST_UA]);
    });

    test('403 for Lensy/1.0 and 200 for the browser UA gives warn (browser fallback)', async () => {
        const { impl, calls } = fakeFetch({ honest: 403, browser: 200 });
        const r = await fetchPage('https://example.com/docs', { fetchImpl: impl });
        expect(r.ok).toBe(true);
        expect(r.via).toBe('browser');
        expect(r.honestStatus).toBe(403);
        expect(r.browserStatus).toBe(200);
        expect(r.errorKind).toBeUndefined();
        expect(calls.map(c => c.ua)).toEqual([HONEST_UA, BROWSER_UA]);
    });

    test('429 for Lensy/1.0 also triggers the single browser retry', async () => {
        const { impl, calls } = fakeFetch({ honest: 429, browser: 200 });
        const r = await fetchPage('https://example.com/docs', { fetchImpl: impl });
        expect(r.via).toBe('browser');
        expect(calls).toHaveLength(2);
    });

    test('403 for both gives blocked-by-bot-protection (errorKind blocked)', async () => {
        const { impl, calls } = fakeFetch({ honest: 403, browser: 403 });
        const r = await fetchPage('https://example.com/docs', { fetchImpl: impl });
        expect(r.ok).toBe(false);
        expect(r.errorKind).toBe('blocked');
        expect(r.status).toBe(403);
        expect(calls).toHaveLength(2); // retried once, not more
    });

    test('a network error is never reported as a block', async () => {
        const { impl, calls } = fakeFetch({ honest: 'network', browser: 200 });
        const r = await fetchPage('https://no-such-host.invalid/', { fetchImpl: impl });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(0);
        expect(r.errorKind).toBe('network');
        expect(calls).toHaveLength(1); // no browser retry for a network failure
    });

    test('other HTTP errors (404) are not blocks and do not retry', async () => {
        const { impl, calls } = fakeFetch({ honest: 404, browser: 200 });
        const r = await fetchPage('https://example.com/missing', { fetchImpl: impl });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(404);
        expect(r.errorKind).toBeUndefined();
        expect(calls).toHaveLength(1);
    });

    test('the Accept header is passed through to both attempts', async () => {
        const { impl, calls } = fakeFetch({ honest: 403, browser: 200 });
        await fetchPage('https://example.com/docs', { fetchImpl: impl, accept: 'text/markdown' });
        expect(calls.map(c => c.accept)).toEqual(['text/markdown', 'text/markdown']);
    });
});
