// Edge fixtures from spec docs/two-score-readiness §9.1, hand-written. Each one
// is a small site served by replayFetch, scored end to end (collector + scorer).
import { collectSignalsV2, robotsAllows, detectPlatform } from '../collect-signals-v2';
import { scoreCodingAgents, scoreAiSearch, gateState, CheckId } from '../scoring-v2';
import { FixtureEntry, loadFixture, pageInputFromFixture, replayFetch } from './replay';

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
    const inner = fetch404(entries);
    const requested: string[] = [];
    const fetchImpl = (async (input: any, init?: RequestInit) => { requested.push(String(input)); return inner(input, init); }) as typeof fetch;
    const s = await collectSignalsV2({ finalUrl: PAGE, html, headers: { 'content-type': 'text/html', ...headers }, gate: { via: 'honest', honestStatus: 200 } }, { fetchImpl, now: 0 });
    const all = [...scoreCodingAgents(s).checks, ...scoreAiSearch(s).checks];
    const get = (id: CheckId) => all.find(c => c.id === id)!;
    return { s, requested, pts: (id: CheckId) => get(id).points, fix: (id: CheckId) => get(id).fix };
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

// lensy-cli E5: a request that fails at the network level names the checks it feeds.
describe('netErrorChecks', () => {
    const html = article(`<h1>Start</h1>${body}`);
    async function withFailures(fails: (url: string, accept: string) => boolean, pages: Site = {}) {
        const base = fetch404(site({ [PAGE]: { body: html }, ...pages }));
        const impl = (async (input: any, init: RequestInit = {}) => {
            const accept = (init.headers as Record<string, string>)?.['Accept'] || '';
            if (fails(String(input), accept)) throw new TypeError('fetch failed: ECONNRESET');
            return base(input, init);
        }) as typeof fetch;
        return collectSignalsV2({ finalUrl: PAGE, html, headers: { 'content-type': 'text/html' }, gate: { via: 'honest', honestStatus: 200 } }, { fetchImpl: impl, now: 0 });
    }

    test('no failures: empty', async () => {
        expect((await withFailures(() => false)).netErrorChecks).toEqual([]);
    });
    test('robots.txt fails: S1', async () => {
        expect((await withFailures(u => u.endsWith('/robots.txt'))).netErrorChecks).toEqual(['S1']);
    });
    test('sitemap fails: S3 and S4', async () => {
        expect((await withFailures(u => u.endsWith('/sitemap.xml'))).netErrorChecks).toEqual(['S3', 'S4']);
    });
    test('llms.txt fails: C3 and C4', async () => {
        expect((await withFailures(u => u.endsWith('/llms.txt'))).netErrorChecks).toEqual(['C3', 'C4']);
    });
    test('content negotiation fails: C2, C5 and C6', async () => {
        expect((await withFailures((u, a) => u === PAGE && a === 'text/markdown')).netErrorChecks).toEqual(['C2', 'C5', 'C6']);
    });
    test('.md fails and negotiation returned no Markdown: C3, C5 and C6', async () => {
        expect((await withFailures(u => u.endsWith('.md'))).netErrorChecks).toEqual(['C3', 'C5', 'C6']);
    });
    test('.md fails but negotiation returned Markdown: C3 only', async () => {
        const md = `# Start\n\n## Install\n\n${words(120)}\n\n## Use\n\n${words(120)}\n`;
        const s = await withFailures(u => u.endsWith('.md'), { [PAGE]: { body: md, type: 'text/markdown', accept: 'text/markdown' } });
        expect(s.contentNegotiation.ok).toBe(true);
        expect(s.netErrorChecks).toEqual(['C3']);
    });
});

// REG-05: a site with no robots.txt says so, and never claims a count of bots it
// allowed. The saved lua.org responses have no robots.txt (fixture u5-lua-manual).
test('REG-05: no robots.txt is reported as not found, with all 6 bots allowed by default', async () => {
    const { entries, expected } = loadFixture('u5-lua-manual');
    const signals = await collectSignalsV2(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: Date.parse('2026-10-22T12:00:00Z') });
    expect(signals.robots.found).toBe(false);
    const s1 = scoreAiSearch(signals).checks.find(c => c.id === 'S1')!;
    expect(s1.detail).toBe('all 6 allowed (no robots.txt)');
    expect(s1.points).toBe(s1.max);
});

// ── Engine fixes from the CLI testing (.context/specs/scoring-engine-findings.md) ──

const urlset = (...locs: string[]) => `<urlset>${locs.map(l => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
const xml = (body: string) => ({ type: 'application/xml', body });
const canonicalHead = `<link rel="canonical" href="${PAGE}">`;

describe('REG-31: attributes without quotes are read (minified HTML, for example Docusaurus)', () => {
    test.each([
        [`<link rel=canonical href=${PAGE}>`],
        [`<link href=${PAGE} rel=canonical>`],
        [`<link data-rh=true rel=canonical href=${PAGE} />`],
        [`<link rel='canonical' href='${PAGE}'>`],
    ])('canonical: %s', async (head) => {
        const { s } = await score(article(`<h1>T</h1>${body}`, head));
        expect(s.indexable.canonical).toBe(PAGE);
    });

    test('a rel that only starts with "canonical" is not a canonical link', async () => {
        const { s } = await score(article(`<h1>T</h1>${body}`, '<link rel="canonical-x" href="https://other.example.com/">'));
        expect(s.indexable.canonical).toBeNull();
    });

    test('meta robots noindex without quotes makes S3 0', async () => {
        const { s, pts } = await score(article(`<h1>T</h1>${body}`, `<meta name=robots content=noindex>${canonicalHead}`));
        expect(s.indexable.noindex).toBe(true);
        expect(pts('S3')).toBe(0);
    });

    test('meta generator without quotes still names the platform', () => {
        expect(detectPlatform('<meta name=generator content="Docusaurus v3.5.2">')).toBe('docusaurus');
        expect(detectPlatform('<meta content=VitePress name=generator>')).toBe('vitepress');
    });

    test('a Markdown rel=alternate link without quotes counts as advertised', async () => {
        const { s, pts } = await score(article(`<h1>T</h1>${body}`, '<link rel=alternate type=text/markdown href=/guide/start.md>'), {
            [`${PAGE}.md`]: { type: 'text/markdown', body: `# Start\n\n${'word '.repeat(80)}` },
        });
        expect(s.markdownUrl.advertisedBy).toBe('rel-alternate');
        expect(pts('C3')).toBe(15);
    });
});

describe('sitemaps that robots.txt does not name', () => {
    test('REG-32: Astro\'s /sitemap-index.xml is found and walked', async () => {
        const { s, pts } = await score(article(`<h1>T</h1>${body}`, canonicalHead), {
            [`${ORIGIN}/sitemap-index.xml`]: xml(`<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`),
            [`${ORIGIN}/sitemap-0.xml`]: xml(urlset(PAGE, `${ORIGIN}/other`)),
        });
        expect(s.sitemap.inSitemap).toBe(true);
        expect(pts('S3')).toBe(25);
    });

    test('REG-32: a <link rel="sitemap"> in the page is used', async () => {
        const { s } = await score(article(`<h1>T</h1>${body}`, '<link rel="sitemap" href="/maps/docs.xml">'), {
            [`${ORIGIN}/maps/docs.xml`]: xml(urlset(PAGE)),
        });
        expect(s.sitemap.inSitemap).toBe(true);
    });

    test('REG-33: a sitemap under the base path (/guide/sitemap.xml) is tried', async () => {
        const { s } = await score(article(`<h1>T</h1>${body}`), {
            [`${ORIGIN}/guide/sitemap.xml`]: xml(urlset(PAGE)),
        });
        expect(s.sitemap.inSitemap).toBe(true);
    });

    test('the search stops at the first sitemap that lists URLs', async () => {
        const { requested } = await score(article(`<h1>T</h1>${body}`), { [`${ORIGIN}/sitemap.xml`]: xml(urlset(PAGE)) });
        expect(requested).toContain(`${ORIGIN}/sitemap.xml`);
        expect(requested).not.toContain(`${ORIGIN}/sitemap-index.xml`);
        expect(requested).not.toContain(`${ORIGIN}/guide/sitemap.xml`);
    });

    test('a robots.txt Sitemap: line means no other sitemap URL is tried', async () => {
        const { s, requested } = await score(article(`<h1>T</h1>${body}`, '<link rel="sitemap" href="/maps/docs.xml">'), {
            [`${ORIGIN}/robots.txt`]: { type: 'text/plain', body: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/from-robots.xml` },
            [`${ORIGIN}/from-robots.xml`]: xml(urlset(PAGE)),
        });
        expect(s.sitemap.inSitemap).toBe(true);
        expect(requested.filter(u => /sitemap|maps\//.test(u))).toEqual([]);
    });
});

describe('REG-34: content without JavaScript gives advice that fits the page', () => {
    test('an empty JavaScript shell is told to render on the server', async () => {
        const { fix } = await score('<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
        expect(fix('S2')).toMatch(/server-side rendering or static generation/);
        expect(fix('C1')).toBe(fix('S2'));
    });

    test('a short static page is told it is short, with its word count, not to change how it renders', async () => {
        const { s, fix } = await score(article(`<h1>Release notes</h1><p>${words(60)}</p>`));
        expect(s.rawContent.spaShell).toBe(false);
        expect(fix('S2')).toContain(`${s.rawContent.words} words`);
        expect(fix('S2')).not.toMatch(/^Serve the page content/);
        expect(fix('C1')).toBe(fix('S2'));
    });
});

describe('S3 and S4 fixes name only what is missing', () => {
    const page = article(`<h1>T</h1>${body}`);
    test('S3: canonical present, no sitemap: only the sitemap', async () => {
        const { fix } = await score(article(`<h1>T</h1>${body}`, canonicalHead));
        expect(fix('S3')).toMatch(/sitemap/i);
        expect(fix('S3')).not.toMatch(/canonical/i);
    });
    test('S3: in the sitemap, no canonical: only the canonical', async () => {
        const { fix } = await score(page, { [`${ORIGIN}/sitemap.xml`]: xml(urlset(PAGE)) });
        expect(fix('S3')).toMatch(/canonical/i);
        expect(fix('S3')).not.toMatch(/sitemap/i);
    });
    test('S3: a sitemap that does not list the page says so', async () => {
        const { fix } = await score(article(`<h1>T</h1>${body}`, canonicalHead), { [`${ORIGIN}/sitemap.xml`]: xml(urlset(`${ORIGIN}/other`)) });
        expect(fix('S3')).toMatch(/doesn't list this page/);
    });
    test('S3: nothing missing, no fix', async () => {
        const { pts, fix } = await score(article(`<h1>T</h1>${body}`, canonicalHead), { [`${ORIGIN}/sitemap.xml`]: xml(urlset(PAGE)) });
        expect(pts('S3')).toBe(25);
        expect(fix('S3')).toBeUndefined();
    });

    const dated = (lastmods: string[]) => xml(`<urlset>${[PAGE, `${ORIGIN}/a`, `${ORIGIN}/b`].map((u, i) => `<url><loc>${u}</loc><lastmod>${lastmods[i]}</lastmod></url>`).join('')}</urlset>`);
    test('S4: a page date and identical lastmod values: only the identical dates', async () => {
        const { fix } = await score(article(`<h1>T</h1>${body}`, '<meta property="article:modified_time" content="2026-10-01">'), {
            [`${ORIGIN}/sitemap.xml`]: dated(['2026-10-01', '2026-10-01', '2026-10-01']),
        });
        expect(fix('S4')).toMatch(/same date/);
        expect(fix('S4')).not.toMatch(/Last updated/);
    });
    test('S4: believable lastmod but no page date: only the page date', async () => {
        const { fix } = await score(page, { [`${ORIGIN}/sitemap.xml`]: dated(['2026-10-01', '2026-09-01', '2026-08-01']) });
        expect(fix('S4')).toMatch(/Last updated/);
        expect(fix('S4')).not.toMatch(/lastmod/);
    });
    test('S4: Docusaurus with no page date keeps the Docusaurus advice', async () => {
        const { fix } = await score(article(`<h1>T</h1>${body}`, '<meta name=generator content="Docusaurus v3">'));
        expect(fix('S4')).toMatch(/showLastUpdateTime/);
    });
});
