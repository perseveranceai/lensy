/**
 * Signal collection for the two-score readiness check (spec
 * docs/two-score-readiness/spec.md §4, §6.3). All network work for scoring v2
 * happens here; tools/scoring-v2.ts turns the result into points with no I/O.
 *
 * The rules are ported from docs/two-score-readiness/prototype.mjs, which
 * produced every number in the spec. The fixture tests replay the responses the
 * prototype saw through this collector and require the same points (R7), so
 * keep the requests (URL, method, Accept) and the parsing in step with it.
 */
import { fetchPage, FetchOptions, FetchVia } from '../shared/fetch-page';
import {
    textOf, htmlAsMd, wordCount, headingsFromHtml, headingsFromMd, headingSkips,
    sectionWords, looksMarkdown, looksLikeHtml, Heading,
} from '../shared/html-content';

export const AI_SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User'];
const MAX_SITEMAP_FILES = 12;
const MAX_LLMS_LINK_SAMPLE = 8;

export type Platform = 'vitepress' | 'docusaurus' | 'mintlify' | null;

export function detectPlatform(html: string): Platform {
    const generator = (html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)/i) || [])[1] || '';
    if (/vitepress/i.test(generator)) return 'vitepress';
    if (/docusaurus/i.test(generator)) return 'docusaurus';
    if (/mintlify/i.test(generator) || /mintlify-assets|mintcdn\.com/i.test(html)) return 'mintlify';
    return null;
}

export interface FetchGateInput {
    via: FetchVia;
    honestStatus: number;
    browserStatus?: number;
}

export interface PageInput {
    /** URL after redirects. */
    finalUrl: string;
    /** Raw HTML as served (never the JavaScript-rendered copy): what crawlers receive. */
    html: string;
    headers: Record<string, string>;
    gate: FetchGateInput;
}

export interface SignalsV2 {
    finalUrl: string;
    gate: FetchGateInput;
    robots: { found: boolean; allowedBots: string[]; blockedBots: string[] };
    rawContent: { words: number; spaShell: boolean };
    contentNegotiation: { ok: boolean; status: number; contentType: string };
    markdownUrl: { url: string; ok: boolean; advertisedBy: 'rel-alternate' | 'link-header' | 'llms-txt' | null };
    llmsTxt: null | { url: string; links: number; validFormat: boolean; sampled: number; resolved: number; size: number };
    received: { format: 'markdown' | 'html'; chars: number; words: number };
    receivedHeadings: { count: number; h1Count: number; skips: number; generic: number };
    htmlHeadings: { count: number; h1Count: number; skips: number; subCount: number; subWithId: number };
    sections: { medianWords: number | null; count: number };
    indexable: { noindex: boolean; noindexSource: 'meta' | 'header' | null; canonical: string | null };
    sitemap: { found: boolean; urlsRead: number; filesRead: number; inSitemap: boolean };
    freshness: {
        pageDate: string | null;
        pageDateSource: string | null;
        lastmodCount: number;
        distinctLastmod: number;
        believable: boolean;
        entryLastmod: string | null;
        agree: boolean;
        ageDays: number | null;
    };
    jsonLd: { types: string[]; hasDateModified: boolean };
    /** Facts for tips that are shown, not scored. */
    tipFacts: { openGraph: boolean; codeBlocks: number; codeBlocksWithLanguage: boolean };
    /** Docs platform, when the HTML says so; picks platform-specific fix copy. */
    platform: Platform;
    /** URLs that failed at the network level after retries: their checks are unknown, not "missing". */
    netErrors: string[];
}

export interface CollectOptions {
    /** Injected by the fixture tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    /** Fixed clock for the age shown in the report (tests). */
    now?: number;
}

interface Got { ok: boolean; status: number; url: string; contentType: string; headers: Headers; body: string }

/**
 * robots.txt evaluation: pick the most specific matching group, longest matching rule wins.
 * Matches the prototype's robotsAllows exactly.
 */
export function robotsAllows(robots: string, agent: string, path: string): boolean {
    if (!robots) return true;
    const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
    let cur: typeof groups[number] | null = null;
    let lastWasUA = false;
    for (const raw of robots.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        if (!line) continue;
        const [k, ...rest] = line.split(':');
        const key = k.trim().toLowerCase();
        const val = rest.join(':').trim();
        if (key === 'user-agent') {
            if (!lastWasUA || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
            cur.agents.push(val.toLowerCase());
            lastWasUA = true;
        } else {
            lastWasUA = false;
            if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
        }
    }
    const a = agent.toLowerCase();
    const group = groups.find(g => g.agents.some(x => x !== '*' && a.includes(x))) || groups.find(g => g.agents.includes('*'));
    if (!group) return true;
    let best: { allow: boolean; len: number } | null = null;
    for (const r of group.rules) {
        if (r.path === '') { if (!r.allow && !best) best = { allow: true, len: 0 }; continue; }
        const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
        if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
    }
    return best ? best.allow : true;
}

/** Host + path, lowercased, without a trailing slash or index.html, for sitemap matching. */
export const normUrl = (u: string) => {
    try { const x = new URL(u); return (x.host + x.pathname).replace(/\/(index\.html?)?$/, '').toLowerCase(); } catch { return u; }
};

const parseDate = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? null : d; };

export async function collectSignalsV2(page: PageInput, opts: CollectOptions = {}): Promise<SignalsV2> {
    const netErrors: string[] = [];
    const fetchOpts: FetchOptions = { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs ?? 10000 };

    // GET/HEAD through the honest fetcher, retrying network failures like the prototype (3 tries).
    async function get(url: string, accept: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Got> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const r = await fetchPage(url, { ...fetchOpts, accept, method });
            if (r.errorKind !== 'network') {
                return { ok: r.ok, status: r.status, url: r.finalUrl, contentType: (r.headers.get('content-type') || '').toLowerCase(), headers: r.headers, body: r.body };
            }
            if (attempt < 2) await new Promise(res => setTimeout(res, opts.fetchImpl ? 0 : 800 * (attempt + 1)));
        }
        netErrors.push(url);
        return { ok: false, status: 0, url, contentType: '', headers: new Headers(), body: '' };
    }

    const finalUrl = page.finalUrl;
    const origin = new URL(finalUrl).origin;
    const path = new URL(finalUrl).pathname;
    const html = page.html;
    const pageHeaders = new Headers(page.headers);

    // ── robots.txt and the six AI search bots ──
    const robotsRes = await get(origin + '/robots.txt', 'text/plain,*/*');
    const robots = robotsRes.ok && !/<html/i.test(robotsRes.body) ? robotsRes.body : '';
    const allowedBots = AI_SEARCH_BOTS.filter(b => robotsAllows(robots, b, path));

    // ── Content without JavaScript ──
    const text = textOf(html);
    const words = wordCount(text);
    const spaShell = /<div\s+id=["'](root|app|__next|__nuxt)["']\s*>\s*<\/div>/i.test(html);

    // ── Markdown routes: content negotiation and the .md version ──
    const alt = html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i);
    const linkHdr = (pageHeaders.get('link') || '').match(/<([^>]+)>[^,]*type="?text\/markdown/i);
    const mdCandidate = alt ? new URL(alt[1], finalUrl).href
        : linkHdr ? new URL(linkHdr[1], finalUrl).href
        : finalUrl.replace(/\/$/, '') + '.md';

    const segs = path.split('/').filter(Boolean);
    const llmsCands = [origin + '/llms.txt', ...(segs.length > 1 ? [origin + '/' + segs[0] + '/llms.txt'] : [])];

    const [cn, md, llmsFound] = await Promise.all([
        get(finalUrl, 'text/markdown'),
        get(mdCandidate, 'text/markdown,text/plain,*/*'),
        (async () => {
            for (const c of llmsCands) {
                const r = await get(c, 'text/plain,text/markdown,*/*');
                if (r.ok && !looksLikeHtml(r.body) && r.body.length > 50) return { body: r.body, url: c };
            }
            return null;
        })(),
    ]);
    const cnOk = looksMarkdown(cn);
    const mdOk = looksMarkdown(md);
    const llms = llmsFound?.body || null;
    const llmsUrl = llmsFound?.url || null;

    // REG-19: Markdown listed in llms.txt counts as advertised.
    const mdListedInLlms = !!llms && (llms.includes(new URL(mdCandidate).pathname) || llms.includes(path.replace(/\/$/, '') + '.md'));
    const advertisedBy = !mdOk ? null : alt ? 'rel-alternate' : linkHdr ? 'link-header' : mdListedInLlms ? 'llms-txt' : null;

    // ── llms.txt: format, link sample, size ──
    let llmsTxt: SignalsV2['llmsTxt'] = null;
    if (llms && llmsUrl) {
        const links = [...llms.matchAll(/\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g)].map(m => new URL(m[1], llmsUrl).href);
        const validFormat = /^#\s+\S/m.test(llms) && links.length > 0;
        const step = Math.max(1, Math.floor(links.length / MAX_LLMS_LINK_SAMPLE));
        const sample = links.filter((_, i) => i % step === 0).slice(0, MAX_LLMS_LINK_SAMPLE);
        // One at a time, like the prototype: parallel probes trip rate limits.
        const resolved: boolean[] = [];
        for (const l of sample) {
            const r = await get(l, '*/*', 'HEAD');
            if (r.status === 405 || r.status === 403) {
                const g = await get(l, 'text/markdown,text/html,*/*');
                resolved.push(g.ok);
            } else {
                resolved.push(r.ok);
            }
        }
        llmsTxt = { url: llmsUrl, links: links.length, validFormat, sampled: sample.length, resolved: resolved.filter(Boolean).length, size: llms.length };
    }

    // ── What a coding agent receives (Markdown when offered) ──
    const received = cnOk ? cn.body : mdOk ? md.body : text;
    const mdText = cnOk ? cn.body : mdOk ? md.body : null;
    const hs: Heading[] = mdText ? headingsFromMd(mdText) : headingsFromHtml(html);
    const hHtml = headingsFromHtml(html);
    const sub = hHtml.filter(h => h.level === 2 || h.level === 3);

    // ── Indexable ──
    const metaRobots = (html.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)/i) || [])[1] || '';
    const metaNoindex = /noindex/i.test(metaRobots);
    const headerNoindex = /noindex/i.test(pageHeaders.get('x-robots-tag') || '');
    const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)
        || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1] || null;

    // ── Sitemap walk (robots.txt Sitemap: lines, sitemap indexes, at most 12 files) ──
    const roots = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map(m => m[1]);
    if (!roots.length) roots.push(origin + '/sitemap.xml');
    const entries: { loc: string; lastmod: string | null }[] = [];
    const queue = [...roots];
    let filesRead = 0;
    while (queue.length && filesRead < MAX_SITEMAP_FILES) {
        const r = await get(queue.shift()!, 'application/xml,text/xml,*/*');
        filesRead++;
        if (!r.ok) continue;
        if (/<sitemapindex/i.test(r.body)) {
            for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) queue.push(m[1]);
            continue;
        }
        for (const u of r.body.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
            const loc = (u[1].match(/<loc>\s*([^<\s]+)/i) || [])[1];
            const lm = (u[1].match(/<lastmod>\s*([^<\s]+)/i) || [])[1];
            if (loc) entries.push({ loc, lastmod: lm || null });
        }
    }
    const sitemapFound = filesRead > 0 && entries.length > 0;
    const smEntry = entries.find(e => normUrl(e.loc) === normUrl(finalUrl)) || entries.find(e => normUrl(e.loc) === normUrl(canonical || ''));

    // ── Freshness: declared dates, not age ──
    const pageDates: [string, string][] = [];
    for (const m of html.matchAll(/"dateModified"\s*:\s*"([^"]+)"/g)) pageDates.push(['dateModified', m[1]]);
    for (const m of html.matchAll(/article:modified_time["'][^>]*content=["']([^"']+)/g)) pageDates.push(['article:modified_time', m[1]]);
    for (const m of html.matchAll(/<time[^>]*datetime=["']([^"']+)["']/g)) pageDates.push(['<time>', m[1]]);
    const vis = text.match(/(last\s+updated|updated\s+on|last\s+modified)\s*:?\s*([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (vis) pageDates.push(['visible', vis[2]]);
    const datedEntry = pageDates.find(d => parseDate(d[1]));
    const pageDate = datedEntry ? parseDate(datedEntry[1]) : null;
    const lastmods = entries.map(e => e.lastmod).filter((l): l is string => !!l);
    const distinct = new Set(lastmods.map(l => l.slice(0, 10))).size;
    const believable = lastmods.length > 0 && (distinct > 1 || entries.length === 1);
    const entryLm = smEntry && smEntry.lastmod ? parseDate(smEntry.lastmod) : null;
    const agree = !!(pageDate && entryLm && Math.abs(pageDate.getTime() - entryLm.getTime()) <= 7 * 86400e3);
    const age = pageDate || entryLm;
    const now = opts.now ?? Date.now();

    // ── JSON-LD ──
    const types: string[] = [];
    let hasDM = false;
    for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const j = JSON.parse(m[1]);
            const arr = Array.isArray(j) ? j : j['@graph'] || [j];
            for (const x of arr) {
                if (x['@type']) types.push(([] as string[]).concat(x['@type']).join('/'));
                if (x.dateModified) hasDM = true;
            }
        } catch { types.push('invalid'); }
    }

    const secs = sectionWords(htmlAsMd(html)).sort((a, b) => a - b);

    return {
        finalUrl,
        gate: page.gate,
        robots: { found: !!robots, allowedBots, blockedBots: AI_SEARCH_BOTS.filter(b => !allowedBots.includes(b)) },
        rawContent: { words, spaShell },
        contentNegotiation: { ok: cnOk, status: cn.status, contentType: cn.contentType.split(';')[0] },
        markdownUrl: { url: mdCandidate, ok: mdOk, advertisedBy },
        llmsTxt,
        received: { format: cnOk || mdOk ? 'markdown' : 'html', chars: received.length, words: wordCount(received) },
        receivedHeadings: {
            count: hs.length,
            h1Count: hs.filter(h => h.level === 1).length,
            skips: headingSkips(hs),
            generic: hs.filter(h => /^(overview|introduction|details|more|notes?|example)$/i.test(h.text)).length,
        },
        htmlHeadings: {
            count: hHtml.length,
            h1Count: hHtml.filter(h => h.level === 1).length,
            skips: headingSkips(hHtml),
            subCount: sub.length,
            subWithId: sub.filter(h => h.id).length,
        },
        sections: { medianWords: secs.length ? secs[Math.floor(secs.length / 2)] : null, count: secs.length },
        indexable: { noindex: metaNoindex || headerNoindex, noindexSource: metaNoindex ? 'meta' : headerNoindex ? 'header' : null, canonical },
        sitemap: { found: sitemapFound, urlsRead: entries.length, filesRead, inSitemap: !!smEntry },
        freshness: {
            pageDate: pageDate ? pageDate.toISOString() : null,
            pageDateSource: datedEntry ? datedEntry[0] : null,
            lastmodCount: lastmods.length,
            distinctLastmod: distinct,
            believable,
            entryLastmod: entryLm ? entryLm.toISOString() : null,
            agree,
            ageDays: age ? Math.round((now - age.getTime()) / 86400e3) : null,
        },
        jsonLd: { types, hasDateModified: hasDM },
        tipFacts: {
            openGraph: /<meta[^>]*property=["']og:title["']/i.test(html),
            codeBlocks: (html.match(/<pre[\s>]/gi) || []).length,
            codeBlocksWithLanguage: /<(pre|code)[^>]*class=["'][^"']*(language-|lang-|highlight-)/i.test(html),
        },
        platform: detectPlatform(html),
        netErrors,
    };
}
