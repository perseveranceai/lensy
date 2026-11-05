// AFDocs' requests go through Lensy's honest fetch (Rakesh, 2026-11-03;
// docs/coding-agents-afdocs/spec.md criteria 2-4). The fake module calls
// globalThis.fetch the way afdocs 0.23.0 does in dist/http.js: its own
// User-Agent header, and redirect: 'manual' for the redirect check.
import { runAfdocsOnPage, withHonestFetch, AfdocsModule } from '../afdocs-page';
import { HONEST_UA } from '../../shared/fetch-page';

type Call = { url: string; ua: string | null; redirect?: RequestRedirect };

function recorder() {
    const calls: Call[] = [];
    const impl = (async (input: any, init: RequestInit = {}) => {
        calls.push({ url: String(input), ua: new Headers(init.headers).get('user-agent'), redirect: init.redirect });
        return new Response('<html><h1>x</h1></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    return { calls, impl };
}

// Mimics afdocs: every request through globalThis.fetch with its own name.
const afdocsLike = (urls: string[], onDone?: () => void): AfdocsModule => ({
    runChecks: async (url: string) => {
        for (const u of [url, ...urls]) {
            await globalThis.fetch(u, { headers: { 'User-Agent': 'afdocs/0.23.0' }, redirect: u.includes('redirect') ? 'manual' : 'follow' });
        }
        onDone?.();
        return { results: [{ id: 'llms-txt-exists', category: 'content-discoverability', status: 'pass', message: 'ok' }] };
    },
    computeScore: () => ({ overall: 100, checkScores: { 'llms-txt-exists': { earnedScore: 10, maxScore: 10, scoreDisplayMode: 'numeric' } }, resolutions: {} }),
});

const CLI_UA = 'lensy-cli/0.1.0 (+https://perseveranceai.com/bot)';

describe('AFDocs requests carry our user agent', () => {
    test('every request sends the caller user agent and none sends afdocs/', async () => {
        const { calls, impl } = recorder();
        const run = await runAfdocsOnPage('https://docs.example.com/a', {
            load: async () => afdocsLike(['https://docs.example.com/llms.txt', 'https://docs.example.com/redirect-me']),
            userAgent: CLI_UA, fetchImpl: impl,
        });
        expect(run).toBeDefined();
        expect(calls).toHaveLength(3);
        expect(calls.every(c => c.ua === CLI_UA)).toBe(true);
        expect(calls.some(c => /afdocs/i.test(c.ua || ''))).toBe(false);
    });

    test('without a userAgent, the website name Lensy/1.0 is used', async () => {
        const { calls, impl } = recorder();
        await runAfdocsOnPage('https://docs.example.com/a', { load: async () => afdocsLike([]), fetchImpl: impl });
        expect(calls.map(c => c.ua)).toEqual([HONEST_UA]);
    });

    test("redirect: 'manual' reaches the server unchanged, so AFDocs' redirect check still works", async () => {
        const { calls, impl } = recorder();
        await runAfdocsOnPage('https://docs.example.com/a', { load: async () => afdocsLike(['https://docs.example.com/redirect-me']), fetchImpl: impl });
        expect(calls.find(c => c.url.endsWith('redirect-me'))!.redirect).toBe('manual');
    });
});

describe('globalThis.fetch is restored', () => {
    const original = globalThis.fetch;
    afterEach(() => { globalThis.fetch = original; });

    test('after a normal run', async () => {
        const { impl } = recorder();
        await runAfdocsOnPage('https://docs.example.com/a', { load: async () => afdocsLike([]), fetchImpl: impl });
        expect(globalThis.fetch).toBe(original);
    });

    test('after AFDocs throws', async () => {
        const failing: AfdocsModule = { runChecks: async () => { throw new Error('boom'); }, computeScore: () => ({}) };
        expect(await runAfdocsOnPage('https://docs.example.com/a', { load: async () => failing, fetchImpl: recorder().impl })).toBeUndefined();
        expect(globalThis.fetch).toBe(original);
    });

    test('after a timeout, only once the timed-out work has really finished', async () => {
        const { calls, impl } = recorder();
        let finish!: () => void;
        const slow: AfdocsModule = {
            runChecks: async () => { await new Promise<void>(r => { finish = r; }); await globalThis.fetch('https://docs.example.com/late', { headers: { 'User-Agent': 'afdocs/0.23.0' } }); return { results: [] }; },
            computeScore: () => ({}),
        };
        expect(await runAfdocsOnPage('https://docs.example.com/a', { load: async () => slow, timeoutMs: 20, fetchImpl: impl })).toBeUndefined();
        expect(globalThis.fetch).not.toBe(original); // the late request must still go out under our name
        finish();
        await new Promise(r => setTimeout(r, 10));
        expect(calls.map(c => c.ua)).toEqual([HONEST_UA]);
        expect(globalThis.fetch).toBe(original);
    });

    test('overlapping runs: the first to finish does not restore it under the second', async () => {
        const a = recorder(), b = recorder();
        let releaseB!: () => void;
        const gate = new Promise<void>(r => { releaseB = r; });
        const slowB: AfdocsModule = {
            runChecks: async (url: string) => { await gate; await globalThis.fetch(url, { headers: { 'User-Agent': 'afdocs/0.23.0' } }); return { results: [] }; },
            computeScore: () => ({ overall: 0, checkScores: {}, resolutions: {} }),
        };
        const runB = runAfdocsOnPage('https://b.example.com/', { load: async () => slowB, fetchImpl: b.impl, userAgent: 'ua-b' });
        await runAfdocsOnPage('https://a.example.com/', { load: async () => afdocsLike([]), fetchImpl: a.impl, userAgent: 'ua-a' });
        expect(globalThis.fetch).not.toBe(original);
        releaseB();
        await runB;
        expect(a.calls.map(c => c.ua)).toEqual(['ua-a']);
        expect(b.calls.map(c => c.ua)).toEqual(['ua-b']);
        expect(globalThis.fetch).toBe(original);
    });

    test('a fetchImpl that calls globalThis.fetch itself reaches the original, not the wrapper (no loop)', async () => {
        const reached: string[] = [];
        globalThis.fetch = (async (_i: any, init: RequestInit = {}) => { reached.push(new Headers(init.headers).get('user-agent') || ''); return new Response('ok'); }) as typeof fetch;
        const outer = globalThis.fetch;
        const wrapping = ((input: any, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
        await runAfdocsOnPage('https://docs.example.com/a', { load: async () => afdocsLike(['https://docs.example.com/b']), fetchImpl: wrapping, userAgent: CLI_UA });
        expect(reached).toEqual([CLI_UA, CLI_UA]);
        expect(globalThis.fetch).toBe(outer);
    });

    test('code outside an AFDocs run keeps the original fetch while one is active', async () => {
        const seen: string[] = [];
        const outside = (async () => { seen.push('original'); return new Response('o'); }) as typeof fetch;
        globalThis.fetch = outside;
        const { impl } = recorder();
        let release!: () => void;
        const held = withHonestFetch({ fetchImpl: impl }, () => new Promise<void>(r => { release = r; }));
        await globalThis.fetch('https://elsewhere.example.com/'); // not inside the run
        release();
        await held;
        expect(seen).toEqual(['original']);
        expect(globalThis.fetch).toBe(outside);
    });
});
