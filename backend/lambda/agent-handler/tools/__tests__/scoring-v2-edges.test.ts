// Edge fixtures from spec docs/two-score-readiness §9.1, hand-written. Each one
// is a small site served by replayFetch, scored end to end (collector + scorer).
import { collectSignalsV2, robotsAllows } from '../collect-signals-v2';
import { scoreCodingAgents, scoreAiSearch, gateState, CheckId } from '../scoring-v2';
import { FixtureEntry, replayFetch } from './replay';

const ORIGIN = 'https://docs.example.com';
const PAGE = `${ORIGIN}/guide/start`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

type Site = Record<string, { status?: number; type?: string; body?: string; headers?: Record<string, string>; accept?: string }>;

// Every URL a scan may request; anything not listed answers 404 HTML (a typical soft site).
function site(pages: Site): FixtureEntry[] {
    const entries: FixtureEntry[] = [];
    for (const [url, p] of Object.entries(pages)) {
        for (const method of ['GET', 'HEAD']) {
            entries.push({
                method, url, accept: p.accept ?? '', ua: 'Lensy/1.0', status: p.status ?? 200, finalUrl: url,
                headers: { 'content-type': p.type ?? 'text/html', ...(p.headers || {}) }, body: p.body ?? '',
            });
        }
    }
    return entries;
}

function fetch404(entries: FixtureEntry[]): typeof fetch {
    const replay = replayFetch(entries, []);
    return (async (input: any, init: RequestInit = {}) => {
        try { return await replay(input, init); } catch {
            return new Response('<!doctype html><html><body>Not found</body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
        }
    }) as typeof fetch;
}

const article = (inner: string, head = '') => `<!doctype html><html><head>${head}</head><body><header class="site-header"><nav><a href="/">Home</a></nav><h1>Site name</h1></header><main>${inner}</main><footer>f</footer></body></html>`;

async function score(html: string, pages: Site = {}, headers: Record<string, string> = {}) {
    const entries = site({ [PAGE]: { body: html, headers }, ...pages });
    const s = await collectSignalsV2({ finalUrl: PAGE, html, headers: { 'content-type': 'text/html', ...headers }, gate: { via: 'honest', honestStatus: 200 } }, { fetchImpl: fetch404(entries), now: 0 });
    const all = [...scoreCodingAgents(s).checks, ...scoreAiSearch(s).checks];
    return { s, pts: (id: CheckId) => all.find(c => c.id === id)!.points };
}

const body = `<h2 id="a">Install</h2><p>${words(120)}</p><h2 id="b">Use</h2><p>${words(120)}</p>`;

test('REG-20: an H1 inside an article <header> counts; a site-chrome <header> with a <nav> does not', async () => {
    const html = article(`<article><header><h1>Getting started</h1></header>${body}</article>`);
    const { s, pts } = await score(html);
    expect(s.htmlHeadings.h1Count).toBe(1); // the article H1 only, not "Site name"
    expect(pts('S5')).toBe(15);
    expect(pts('C6')).toBe(15);
});

test('a page with no headings earns no "no skips" points (needs at least 2 headings)', async () => {
    const { pts } = await score(article(`<p>${words(300)}</p>`));
    expect(pts('C6')).toBe(0);
    expect(pts('S5')).toBe(0);
});

test('C5: an empty page is not "small": under 40 words received scores 0', async () => {
    const { s, pts } = await score('<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
    expect(s.received.words).toBeLessThan(40);
    expect(pts('C5')).toBe(0);
    expect(pts('C1')).toBe(0);
});

test('S4: sitemap lastmod values that are all identical are not believable', async () => {
    const sitemap = `<urlset>${[PAGE, `${ORIGIN}/a`, `${ORIGIN}/b`].map(u => `<url><loc>${u}</loc><lastmod>2026-10-01T00:00:00Z</lastmod></url>`).join('')}</urlset>`;
    const { s, pts } = await score(article(`<h1>T</h1>${body}`), { [`${ORIGIN}/sitemap.xml`]: { type: 'application/xml', body: sitemap } });
    expect(s.freshness.believable).toBe(false);
    expect(pts('S4')).toBe(4); // this URL has lastmod (4), not believable (0), no page date
});

test('S3/S4: a sitemap index is walked to the child sitemap that lists the page', async () => {
    const index = `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-docs.xml</loc></sitemap></sitemapindex>`;
    const child = `<urlset><url><loc>${PAGE}</loc><lastmod>2026-10-01</lastmod></url><url><loc>${ORIGIN}/x</loc><lastmod>2026-09-01</lastmod></url></urlset>`;
    const html = article(`<h1>T</h1>${body}`, `<link rel="canonical" href="${PAGE}"><meta property="article:modified_time" content="2026-10-03">`);
    const { s, pts } = await score(html, {
        [`${ORIGIN}/robots.txt`]: { type: 'text/plain', body: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap-index.xml` },
        [`${ORIGIN}/sitemap-index.xml`]: { type: 'application/xml', body: index },
        [`${ORIGIN}/sitemap-docs.xml`]: { type: 'application/xml', body: child },
    });
    expect(s.sitemap.filesRead).toBe(2);
    expect(s.sitemap.inSitemap).toBe(true);
    expect(pts('S3')).toBe(25);
    expect(pts('S4')).toBe(15); // page date 6, lastmod 4, believable 3, agree within 7 days 2
});

test('REG-21: a soft-404 HTML page returned for /llms.txt is not an llms.txt', async () => {
    const { s, pts } = await score(article(`<h1>T</h1>${body}`), {
        [`${ORIGIN}/llms.txt`]: { type: 'text/html', body: `<!doctype html><html><body>${words(100)}</body></html>` },
    });
    expect(s.llmsTxt).toBeNull();
    expect(pts('C4')).toBe(0);
});

test('S3: noindex in X-Robots-Tag makes the whole check 0', async () => {
    const { s, pts } = await score(article(`<h1>T</h1>${body}`, `<link rel="canonical" href="${PAGE}">`), {}, { 'x-robots-tag': 'noindex' });
    expect(s.indexable.noindexSource).toBe('header');
    expect(pts('S3')).toBe(0);
});

test('C4: an llms.txt over 100K characters gets no size points', async () => {
    const llms = `# Example\n\n- [Start](${PAGE})\n` + `- [Page](${ORIGIN}/p): ${'x'.repeat(80)}\n`.repeat(1200);
    expect(llms.length).toBeGreaterThan(100000);
    const { s, pts } = await score(article(`<h1>T</h1>${body}`), {
        [`${ORIGIN}/llms.txt`]: { type: 'text/plain', body: llms },
        [`${ORIGIN}/p`]: { body: 'ok' },
    });
    expect(s.llmsTxt!.size).toBe(llms.length);
    expect(pts('C4')).toBe(16); // found 8 + format 4 + all sampled resolve 4 + size 0
});

test('S1: a specific-bot group in robots.txt overrides "*"', async () => {
    const robots = 'User-agent: *\nAllow: /\n\nUser-agent: PerplexityBot\nUser-agent: Claude-User\nDisallow: /guide/\n';
    expect(robotsAllows(robots, 'PerplexityBot', '/guide/start')).toBe(false);
    expect(robotsAllows(robots, 'OAI-SearchBot', '/guide/start')).toBe(true);
    const { s, pts } = await score(article(`<h1>T</h1>${body}`), { [`${ORIGIN}/robots.txt`]: { type: 'text/plain', body: robots } });
    expect(s.robots.blockedBots).toEqual(['PerplexityBot', 'Claude-User']);
    expect(pts('S1')).toBeCloseTo(13.3, 1);
});

test('C6: Markdown with a heading-level skip loses half the skip points', async () => {
    const md = `# Start\n\n## Install\n\n#### Deep\n\n${words(100)}\n`;
    const { s, pts } = await score(article(`<h1>T</h1>${body}`), { [PAGE]: { body: md, type: 'text/markdown', accept: 'text/markdown' } });
    expect(s.received.format).toBe('markdown');
    expect(s.receivedHeadings.skips).toBe(1);
    expect(pts('C2')).toBe(15);
    expect(pts('C6')).toBe(5 + 3 + 4); // one H1, one skip, all HTML H2/H3 have ids
});

test('REG-19: a .md page listed in llms.txt counts as discoverable', async () => {
    const llms = `# Example\n\n- [Start](${ORIGIN}/guide/start.md): getting started\n`;
    const { s, pts } = await score(article(`<h1>T</h1>${body}`), {
        [`${ORIGIN}/llms.txt`]: { type: 'text/plain', body: llms },
        [`${PAGE}.md`]: { type: 'text/markdown', body: `# Start\n\n${words(80)}` },
    });
    expect(s.markdownUrl.advertisedBy).toBe('llms-txt');
    expect(pts('C3')).toBe(15);
});

test('gate: honest refused, browser worked gives warn with the mismatch note, and scores are not capped', async () => {
    const html = article(`<h1>T</h1>${body}`);
    const entries = site({ [PAGE]: { body: html } });
    const s = await collectSignalsV2({ finalUrl: PAGE, html, headers: {}, gate: { via: 'browser', honestStatus: 403, browserStatus: 200 } }, { fetchImpl: fetch404(entries) });
    const g = gateState(s);
    expect(g.state).toBe('warn');
    expect(g.mismatch).toMatch(/robots\.txt allows AI bots/);
    expect(scoreAiSearch(s).checks.find(c => c.id === 'S1')!.points).toBe(20);
});

test('fix copy names what is wrong when llms.txt or a .md copy exists but loses points', async () => {
    const html = article(`<article><h1>Getting started</h1>${body}</article>`);
    const links = Array.from({ length: 1200 }, (_, i) => `- [Page ${i}](${ORIGIN}/guide/start): ${words(6)}`).join('\n');
    const { s } = await score(html, {
        [`${ORIGIN}/llms.txt`]: { type: 'text/plain', body: `# Example docs\n\n${links}\n` },
        [`${PAGE}.md`]: { type: 'text/markdown', body: `# Getting started\n\n## Install\n\n${words(120)}\n` },
    });
    const checks = scoreCodingAgents(s).checks;
    const c3 = checks.find(c => c.id === 'C3')!;
    const c4 = checks.find(c => c.id === 'C4')!;
    expect(c3.status).toBe('warn');
    expect(c3.fix).toContain(`A Markdown copy exists at ${PAGE}.md, but nothing points to it`);
    expect(c4.status).toBe('warn');
    expect(c4.fix).toMatch(/^It is \d+K characters; keep it under 50K/);
    expect(c4.fix).not.toContain('Publish /llms.txt');
});
