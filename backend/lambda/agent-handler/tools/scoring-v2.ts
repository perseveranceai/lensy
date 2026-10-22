/**
 * Scoring v2: two readiness scores (spec docs/two-score-readiness/spec.md §4).
 *
 *   Coding agents (100): C1-C6, scored on what an agent receives (Markdown when offered).
 *   AI search (100):     S1-S6, scored on the HTML, which is what crawlers get.
 *   Reachability:        a banner (pass / warn), never a cap on the scores (§4.1).
 *
 * Pure functions over SignalsV2: no network, no clock. Points follow
 * docs/two-score-readiness/prototype.mjs exactly; the fixture tests check it.
 */
import { SignalsV2, AI_SEARCH_BOTS, Platform } from './collect-signals-v2';

export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';

export interface CheckResult {
    id: CheckId;
    label: string;
    points: number;
    max: number;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
    fix?: string;
}

export interface ScoreResult { score: number; checks: CheckResult[] }

export interface GateResult {
    state: 'pass' | 'warn';
    via: 'honest' | 'browser';
    honestStatus: number;
    browserStatus?: number;
    robotsBlocks: string[];
    mismatch?: string;
}

export interface Tip { id: string; text: string }

const round1 = (n: number) => Math.round(n * 10) / 10;
const kChars = (n: number) => `${Math.round(n / 1000)}K`;

function check(id: CheckId, label: string, raw: number, max: number, detail: string, fix?: string): CheckResult & { raw: number } {
    const points = round1(raw);
    const status = raw >= max ? 'pass' : raw <= 0 ? 'fail' : 'warn';
    return { id, label, points, max, status, detail, ...(status !== 'pass' && fix ? { fix } : {}), raw };
}

// Totals add the unrounded points, then round once (as the prototype does).
function total(checks: (CheckResult & { raw: number })[]): ScoreResult {
    const score = Math.round(checks.reduce((s, c) => s + c.raw, 0));
    return { score, checks: checks.map(({ raw, ...c }) => c) };
}

// ── Shared: content without JavaScript (C1 and S2) ──
export function contentWithoutJsShare(s: SignalsV2): number {
    const { words, spaShell } = s.rawContent;
    return words >= 150 && !spaShell ? 1 : words >= 40 ? 0.5 : 0;
}
const jsDetail = (s: SignalsV2) => `${s.rawContent.words} words in raw HTML${s.rawContent.spaShell ? ', empty SPA root' : ''}`;
const JS_FIX = 'Serve the page content in the HTML (server-side rendering or static generation). AI crawlers and coding agents do not run JavaScript.';

// ── Platform-specific fix copy (§8.2) ──
const FIX: Record<string, Partial<Record<NonNullable<Platform> | 'default', string>>> = {
    C2: {
        default: 'Return Markdown when a request sends Accept: text/markdown (Claude Code, Cursor and OpenCode send it). Cloudflare and Vercel can do this at the edge.',
        vitepress: 'VitePress has no content negotiation built in. Generate .md copies of each page (for example with vitepress-plugin-llms) and have your host return them for Accept: text/markdown.',
        docusaurus: 'Docusaurus has no content negotiation built in. Generate .md copies of each page (for example with docusaurus-plugin-llms) and have your host return them for Accept: text/markdown.',
    },
    C3: {
        default: 'Publish a Markdown copy at <page>.md and advertise it: add <link rel="alternate" type="text/markdown" href="..."> to the page head, or list it in llms.txt.',
        vitepress: 'Generate .md copies with vitepress-plugin-llms, which also lists them in llms.txt.',
        docusaurus: 'Generate .md copies with docusaurus-plugin-llms, which also lists them in llms.txt.',
        mintlify: 'Mintlify serves <page>.md and lists pages in its generated llms.txt; check that this page is listed.',
    },
    C4: {
        default: 'Publish /llms.txt: an H1 with the site name, then Markdown links to your docs pages. Keep it under 50K characters and make sure every link resolves.',
        vitepress: 'Add vitepress-plugin-llms to generate /llms.txt from your pages.',
        docusaurus: 'Add docusaurus-plugin-llms to generate /llms.txt from your docs.',
        mintlify: 'Mintlify generates /llms.txt; check that it is published at the root and its links resolve.',
    },
    C5: { default: 'Split very long pages so what an agent receives fits in one fetch (agents read about 100,000 characters at a time), or offer a Markdown version, which is much smaller than HTML.' },
    C6: { default: 'Use one H1, nest headings without skipping levels (H2 then H3), and give H2/H3 headings id attributes so sections can be linked and found.' },
    S4: {
        default: 'Declare when the page changed: a visible "Last updated" date or dateModified in JSON-LD, plus accurate <lastmod> values in the sitemap.',
        vitepress: 'Set lastUpdated: true in the VitePress config. It shows a visible date and gives the sitemap git-based <lastmod> values.',
        docusaurus: 'Set showLastUpdateTime: true in the docs preset. It shows a visible date; the sitemap plugin then writes <lastmod> from it (lastmod: "date").',
    },
};
const fixFor = (id: string, p: Platform) => FIX[id]?.[p || 'default'] || FIX[id]?.default;

export function scoreCodingAgents(s: SignalsV2): ScoreResult {
    const share = contentWithoutJsShare(s);
    const cn = s.contentNegotiation;
    const md = s.markdownUrl;

    let llmsRaw = 0;
    let llmsDetail = 'not found';
    if (s.llmsTxt) {
        const l = s.llmsTxt;
        const resolve = l.sampled ? l.resolved / l.sampled : 0;
        const sizePts = l.size <= 50000 ? 4 : l.size <= 100000 ? 2 : 0;
        llmsRaw = 8 + (l.validFormat ? 4 : 0) + 4 * resolve + sizePts;
        llmsDetail = `${l.url}, ${l.links} links, ${Math.round(resolve * 100)}% of ${l.sampled} sampled resolve, ${kChars(l.size)} chars`;
    }

    const r = s.received;
    const fitsRaw = r.words < 40 ? 0 : r.chars <= 50000 ? 15 : r.chars <= 100000 ? 10 : 0;
    const fitsDetail = r.words < 40
        ? `no readable content received (${r.words} words)`
        : `${kChars(r.chars)} chars received as ${r.format === 'markdown' ? 'Markdown' : 'HTML text'}`;

    const h = s.receivedHeadings;
    const idShare = s.htmlHeadings.subCount ? s.htmlHeadings.subWithId / s.htmlHeadings.subCount : 0;
    const secRaw = (h.h1Count === 1 ? 5 : h.h1Count > 1 ? 2 : 0) + (h.count < 2 ? 0 : h.skips === 0 ? 6 : h.skips === 1 ? 3 : 0) + 4 * idShare;

    const mdVia = md.advertisedBy === 'rel-alternate' ? 'rel=alternate' : md.advertisedBy === 'link-header' ? 'Link header' : md.advertisedBy === 'llms-txt' ? 'listed in llms.txt' : 'not advertised';

    return total([
        check('C1', 'Content without JavaScript', 20 * share, 20, jsDetail(s), JS_FIX),
        check('C2', 'Markdown on request', cn.ok ? 15 : 0, 15, cn.ok ? `served ${cn.contentType}` : `got ${cn.contentType || cn.status}`, fixFor('C2', s.platform)),
        check('C3', '.md version discoverable', md.ok && md.advertisedBy ? 15 : md.ok ? 8 : 0, 15, md.ok ? `${md.url} (${mdVia})` : 'no .md version', fixFor('C3', s.platform)),
        check('C4', 'llms.txt usable', llmsRaw, 20, llmsDetail, fixFor('C4', s.platform)),
        check('C5', 'Page fits one fetch', fitsRaw, 15, fitsDetail, fixFor('C5', s.platform)),
        check('C6', 'Sections findable', secRaw, 15, `${h.h1Count} H1, ${h.skips} level skip(s), ${Math.round(idShare * 100)}% of H2/H3 have ids, ${h.generic} generic heading(s)`, fixFor('C6', s.platform)),
    ]);
}

export function scoreAiSearch(s: SignalsV2): ScoreResult {
    const share = contentWithoutJsShare(s);
    const allowed = s.robots.allowedBots.length;
    const blocked = s.robots.blockedBots;

    const ix = s.indexable;
    const sm = s.sitemap;
    const ixRaw = ix.noindex ? 0 : 10 + (ix.canonical ? 7 : 0) + (sm.inSitemap ? 8 : 0);
    const ixDetail = `${ix.noindex ? `NOINDEX (${ix.noindexSource === 'header' ? 'X-Robots-Tag' : 'meta robots'})` : 'indexable'}, canonical ${ix.canonical ? 'yes' : 'no'}, ${sm.found ? `in sitemap: ${sm.inSitemap ? 'yes' : 'no'} (${sm.urlsRead} URLs read)` : 'no sitemap found'}`;
    const ixFix = ix.noindex
        ? 'Remove noindex (meta robots or the X-Robots-Tag header) if this page should appear in AI search.'
        : 'Add <link rel="canonical"> to the page head and list the page in your sitemap (referenced from robots.txt).';

    const f = s.freshness;
    const freshRaw = (f.pageDate ? 6 : 0) + (f.entryLastmod ? 4 : 0) + (f.believable ? 3 : 0) + (f.agree ? 2 : 0);
    const freshDetail = `page date: ${f.pageDateSource || 'none'}; sitemap lastmod: ${f.lastmodCount}/${sm.urlsRead} URLs, ${f.distinctLastmod} distinct dates${f.lastmodCount && !f.believable ? ' (all identical = generated)' : ''}; this URL ${f.entryLastmod ? 'has lastmod' : 'no lastmod'}`;

    const hh = s.htmlHeadings;
    const med = s.sections.medianWords;
    const chunkPts = med == null ? 0 : med >= 40 && med <= 500 ? 7 : med <= 900 ? 4 : 1;
    const ansRaw = (hh.h1Count === 1 ? 4 : hh.h1Count > 1 ? 2 : 0) + (hh.count < 2 ? 0 : hh.skips === 0 ? 4 : hh.skips === 1 ? 2 : 0) + chunkPts;

    const j = s.jsonLd;
    const ldRaw = (j.types.some(t => t !== 'invalid') ? 3 : 0) + (j.hasDateModified ? 2 : 0);

    return total([
        check('S1', 'AI search bots allowed', 20 * allowed / AI_SEARCH_BOTS.length, 20,
            blocked.length ? `blocked: ${blocked.join(', ')}` : `all ${AI_SEARCH_BOTS.length} allowed${s.robots.found ? '' : ' (no robots.txt)'}`,
            `Allow ${blocked.join(', ') || 'the AI search bots'} in robots.txt for this path. These fetch pages for ChatGPT search, Perplexity and Claude answers; blocking them keeps the page out of AI answers.`),
        check('S2', 'Content without JavaScript', 20 * share, 20, jsDetail(s), JS_FIX),
        check('S3', 'Indexable', ixRaw, 25, ixDetail, ixFix),
        check('S4', 'Freshness declared', freshRaw, 15, freshDetail, fixFor('S4', s.platform)),
        check('S5', 'Answer-ready sections', ansRaw, 15, `${hh.h1Count} H1, ${hh.skips} skip(s), median section ${med ?? 'n/a'} words (HTML)`,
            'Use one H1 and split the page into H2/H3 sections of about 40 to 500 words, so each section can stand alone as an answer.'),
        check('S6', 'JSON-LD', ldRaw, 5, j.types.length ? `${j.types.join(', ')}${j.hasDateModified ? ', dateModified' : ''}` : 'none',
            'Add a JSON-LD block (for example TechArticle) with dateModified. It carries little weight for AI citations, so do this last.'),
    ]);
}

export function gateState(s: SignalsV2): GateResult {
    const reachable = s.gate.honestStatus >= 200 && s.gate.honestStatus < 300;
    const robotsBlocks = s.robots.blockedBots;
    return {
        state: reachable ? 'pass' : 'warn',
        via: s.gate.via,
        honestStatus: s.gate.honestStatus,
        ...(s.gate.browserStatus !== undefined ? { browserStatus: s.gate.browserStatus } : {}),
        robotsBlocks,
        ...(robotsBlocks.length === 0 && !reachable ? { mismatch: 'robots.txt allows AI bots but the server blocked an honest agent' } : {}),
    };
}

/** Shown, not scored (§4.4, §4.5). */
export function tipsV2(s: SignalsV2): Tip[] {
    const tips: Tip[] = [];
    if (s.freshness.ageDays != null) {
        const months = Math.round(s.freshness.ageDays / 30.4);
        tips.push({ id: 'age', text: `Last updated about ${months} month${months === 1 ? '' : 's'} ago (from the ${s.freshness.pageDate ? 'page date' : 'sitemap'}).${months > 18 ? ' Pages older than about 18 months are worth a review.' : ''}` });
    }
    if (s.freshness.lastmodCount > 0 && !s.freshness.believable) {
        tips.push({ id: 'lastmod-generated', text: 'Every sitemap <lastmod> is the same date, which looks like the build time rather than when pages changed. Search engines ignore lastmod they can\'t trust.' });
    }
    if (s.rawContent.words > 0 && s.rawContent.words < 100) {
        tips.push({ id: 'thin', text: `This page has about ${s.rawContent.words} words of content. Very thin pages rarely answer a question on their own.` });
    }
    if (!s.tipFacts.openGraph) {
        tips.push({ id: 'opengraph', text: 'No OpenGraph tags. They don\'t affect AI search, but they control how links to this page look when shared.' });
    }
    const pres = s.tipFacts.codeBlocks;
    if (pres > 0 && !s.tipFacts.codeBlocksWithLanguage) {
        tips.push({ id: 'code-language', text: `${pres} code block(s) have no language class. Language hints may help coding agents (plausible, not yet measured).` });
    }
    if (s.netErrors.length) {
        tips.push({ id: 'network', text: `${s.netErrors.length} request(s) failed at the network level, so the checks that depend on them may be lower than they should be. Re-scan to confirm.` });
    }
    return tips;
}
