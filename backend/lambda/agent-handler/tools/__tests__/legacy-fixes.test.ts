// Bugs in the v1 checks found while prototyping two-score readiness (spec §6.3).
// The v1 fields still feed the report until the UI moves to v2, so they are fixed too.
import { isExpectedContent, markdownListedInLlms, analyzeHeadings, checkUrl } from '../check-ai-readiness';

test('REG-19: Markdown listed in llms.txt is discoverable (was hardcoded llmsTxtFound=false)', () => {
    const llms = '# Docs\n\n- [Start](https://docs.example.com/guide/start.md): getting started\n';
    expect(markdownListedInLlms(llms, 'https://docs.example.com/guide/start', ['https://docs.example.com/guide/start.md'])).toBe(true);
    expect(markdownListedInLlms(llms, 'https://docs.example.com/guide/start/', [])).toBe(true);
    expect(markdownListedInLlms(llms, 'https://docs.example.com/guide/other', ['https://docs.example.com/guide/other.md'])).toBe(false);
});

test('REG-20: a page H1 inside an article <header> is counted; site-chrome headings are not', () => {
    const html = '<header class="navbar"><nav>x</nav><h1>Brand</h1></header><main><article><header><h1>Install</h1></header><h2>Step</h2></article></main><footer><h2>Links</h2></footer>';
    const h = analyzeHeadings(html);
    expect(h.h1Count).toBe(1);
    expect(h.h2Count).toBe(1);
    expect(h.headings[0]).toBe('H1: Install');
});

test('REG-21: an HTML soft 404 is not an llms.txt, sitemap or .md file', () => {
    const soft404 = '<!DOCTYPE html><html><body>Page not found</body></html>';
    expect(isExpectedContent('text', 'text/html; charset=utf-8', soft404)).toBe(false);
    expect(isExpectedContent('text', 'text/plain', soft404)).toBe(false);
    expect(isExpectedContent('markdown', 'text/html', '# Real?')).toBe(false);
    expect(isExpectedContent('xml', 'text/html', soft404)).toBe(false);
    expect(isExpectedContent('text', 'text/plain', '# Docs\n- [a](/a)')).toBe(true);
    expect(isExpectedContent('xml', 'application/xml', '<?xml version="1.0"?><urlset></urlset>')).toBe(true);
    expect(isExpectedContent('page', 'text/html', soft404)).toBe(true);
});

describe('REG-22: a network error means "couldn\'t check", never "not found"', () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    test('retries once, then reports unknown', async () => {
        let calls = 0;
        global.fetch = (async () => { calls++; throw new TypeError('fetch failed: ECONNRESET'); }) as unknown as typeof fetch;
        const r = await checkUrl('https://docs.example.com/llms.txt', true, 'text');
        expect(r).toEqual({ found: false, unknown: true });
        expect(calls).toBe(2);
    });

    test('a 404 is a real "not found" with no retry', async () => {
        let calls = 0;
        global.fetch = (async () => { calls++; return new Response('nope', { status: 404 }); }) as unknown as typeof fetch;
        const r = await checkUrl('https://docs.example.com/llms.txt', true, 'text');
        expect(r).toEqual({ found: false });
        expect(calls).toBe(1);
    });
});
