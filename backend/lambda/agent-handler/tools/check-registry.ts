// SPDX-License-Identifier: MIT
/**
 * One entry per scored check: what it measures, why it matters, the evidence,
 * and what local and source modes can measure. Label and max must equal what
 * scoring-v2.ts returns (a test checks it). Rules and evidence come from
 * docs/two-score-readiness/spec.md §3 and §4. Shared by the website and the
 * Lensy CLI (see .kiro/steering/lensy-engine.md). No customer names here:
 * this file is published to npm.
 */

export interface CheckMeta {
    /** 'C1' … 'S6'. A string, not a closed union, so other sources can add ids later. */
    id: string;
    source: 'lensy';
    score: 'codingAgents' | 'aiSearch';
    label: string;
    max: number;
    /** How much of the result comes from the web server or CDN rather than the docs build. */
    hostDependent: 'full' | 'partial' | false;
    hostNote?: string;
    /** Shown in source mode when the check is partly measured or skipped. */
    sourceNote?: string;
    measures: string;
    why: string;
    evidence: { title: string; url: string }[];
}

const EV = {
    vercelJs: { title: 'Do AI crawlers render JavaScript (Vercel and MERJ data, via SearchOptimo)', url: 'https://searchoptimo.com/blog/do-ai-crawlers-render-javascript' },
    markdownAgents: { title: 'Do AI agents read Markdown (Checkly data, via GoodBarber)', url: 'https://www.goodbarber.com/blog/do-ai-agents-read-markdown-what-two-weeks-of-our-own-server-logs-say-a1622/' },
    cloudflareMd: { title: 'Cloudflare: Markdown for Agents', url: 'https://blog.cloudflare.com/markdown-for-agents/' },
    vercelMd: { title: 'Vercel: Markdown and agent discovery', url: 'https://vercel.com/docs/agent-resources/markdown-access' },
    mintlify: { title: 'Inside Mintlify\'s agent stack', url: 'https://theairuntime.com/p/inside-mintlifys-agent-stack' },
    llmsLogs: { title: 'llms.txt server-log study (Saaslinks)', url: 'https://saaslinks.net/blog/llms-txt-server-log-study' },
    claudeFetch: { title: 'How Claude Code eats the web', url: 'https://giuseppegurgone.com/claude-webfetch' },
    passages: { title: 'Passage-level retrieval (Paz.ai)', url: 'https://www.paz.ai/glossary/passage-level-retrieval' },
    citations: { title: 'arXiv 2609.35077: what drives citations in production LLMs', url: 'https://arxiv.org/html/2609.35077v1' },
    geo: { title: 'arXiv 2605.25517: what gets cited (competitive GEO)', url: 'https://arxiv.org/html/2605.25517v1' },
    botLogs: { title: '48 days of AI bot logs (Wislr)', url: 'https://www.wislr.com/articles/ai-bot-behavior-log-analysis/' },
    freshness: { title: 'Freshness signals for answer engines (Stackmatix)', url: 'https://www.stackmatix.com/blog/content-freshness-signals-answer-engines' },
    ahrefs: { title: 'Ahrefs: we tracked 1,885 pages adding schema', url: 'https://ahrefs.com/blog/schema-ai-citations/' },
    otterly: { title: 'Otterly: schema markup\'s real impact on AI search', url: 'https://otterly.ai/blog/schema-markup-real-impact-ai-search/' },
};

const NO_JS_MEASURES = 'Words in the raw HTML after removing scripts, styles, navigation, asides and site-chrome headers. 150 or more words with no empty app root: full points. 40 to 149 words: half. Fewer: none.';
const NO_JS_WHY = 'AI crawlers and most coding agents fetch the HTML and do not run JavaScript, so content rendered in the browser is invisible to them.';
const NEEDS_BUILD = 'Needs the built site: the rendered HTML, the files your build generates and the headers your host sends.';

export const CHECKS: CheckMeta[] = [
    {
        id: 'C1', source: 'lensy', score: 'codingAgents', label: 'Content without JavaScript', max: 20,
        hostDependent: false, sourceNote: NEEDS_BUILD,
        measures: NO_JS_MEASURES, why: NO_JS_WHY, evidence: [EV.vercelJs],
    },
    {
        id: 'C2', source: 'lensy', score: 'codingAgents', label: 'Markdown on request', max: 15,
        hostDependent: 'full', hostNote: 'Your web server or CDN decides what to return for Accept: text/markdown.', sourceNote: NEEDS_BUILD,
        measures: 'A GET of the page with Accept: text/markdown returns Markdown (a Markdown or plain-text content type, Markdown structure, not HTML).',
        why: 'Claude Code, Cursor and OpenCode ask for Markdown first. Markdown is far smaller than the HTML of the same page, so more of it fits in what the agent reads.',
        evidence: [EV.markdownAgents, EV.cloudflareMd, EV.vercelMd],
    },
    {
        id: 'C3', source: 'lensy', score: 'codingAgents', label: '.md version discoverable', max: 15,
        hostDependent: 'partial', hostNote: 'A Link header advertising the Markdown copy, or a rewrite to <page>.md, is set by your host.', sourceNote: NEEDS_BUILD,
        measures: 'A Markdown copy exists (rel=alternate, a Link header, or <url>.md) and is advertised (rel=alternate, a Link header, or listed in llms.txt): full points. Exists but not advertised: 8.',
        why: 'Agents guess .md URLs and follow llms.txt. A copy nothing points to is found less often.',
        evidence: [EV.mintlify, EV.vercelMd],
    },
    {
        id: 'C4', source: 'lensy', score: 'codingAgents', label: 'llms.txt usable', max: 20,
        hostDependent: false, sourceNote: 'Scored only when a static llms.txt is in the folder (for example public/ or static/); links are checked against files in the folder.',
        measures: 'llms.txt found at the root or docs path and not HTML: 8. Valid format (an H1 and Markdown links): 4. Sampled links resolve, up to 8 checked: 4 times the share. Size up to 50K characters: 4; up to 100K: 2.',
        why: 'Coding agents use llms.txt to find the right page. AI crawlers do not request it, so it counts for coding agents only.',
        evidence: [EV.mintlify, EV.llmsLogs],
    },
    {
        id: 'C5', source: 'lensy', score: 'codingAgents', label: 'Page fits one fetch', max: 15,
        hostDependent: false, sourceNote: 'Estimated from the Markdown length.',
        measures: 'Size of what an agent receives (Markdown when offered, otherwise the HTML text): up to 50K characters 15, up to 100K 10, more 0. Under 40 words received: 0.',
        why: 'Agents read a limited window per fetch, about 100,000 characters, and have to page or give up beyond it.',
        evidence: [EV.claudeFetch],
    },
    {
        id: 'C6', source: 'lensy', score: 'codingAgents', label: 'Sections findable', max: 15,
        hostDependent: false, sourceNote: 'Partly measured: one H1 and heading levels (11 of 15 points). Heading ids are added by your build.',
        measures: 'On what the agent receives: exactly one H1 5 (more than one 2). No heading-level skips 6 (one skip 3), counted only with at least 2 headings. Share of H2/H3 with id attributes times 4.',
        why: 'A URL #fragment never reaches the server, so agents fetch the whole page and find sections by heading text.',
        evidence: [EV.claudeFetch],
    },
    {
        id: 'S1', source: 'lensy', score: 'aiSearch', label: 'AI search bots allowed', max: 20,
        hostDependent: false, sourceNote: 'Scored only when a static robots.txt is in the folder.',
        measures: '20 times the share of six AI search and retrieval bots (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User) that robots.txt allows for this path. Most specific group, longest matching rule wins.',
        why: 'These bots fetch pages for ChatGPT search, Perplexity and Claude answers. A page they may not fetch cannot be cited.',
        evidence: [EV.botLogs],
    },
    {
        id: 'S2', source: 'lensy', score: 'aiSearch', label: 'Content without JavaScript', max: 20,
        hostDependent: false, sourceNote: NEEDS_BUILD,
        measures: NO_JS_MEASURES, why: NO_JS_WHY, evidence: [EV.vercelJs],
    },
    {
        id: 'S3', source: 'lensy', score: 'aiSearch', label: 'Indexable', max: 25,
        hostDependent: 'partial', hostNote: 'An X-Robots-Tag noindex header is set by your host.', sourceNote: NEEDS_BUILD,
        measures: 'Not noindex (meta robots or X-Robots-Tag): 10, and noindex makes the whole check 0. Canonical present: 7. Page listed in the sitemap: 8 (robots.txt Sitemap: lines and sitemap indexes are followed, at most 12 files).',
        why: 'A page that asks not to be indexed, or that search engines cannot find in the sitemap, is less likely to be retrieved for an answer.',
        evidence: [EV.citations],
    },
    {
        id: 'S4', source: 'lensy', score: 'aiSearch', label: 'Freshness declared', max: 15,
        hostDependent: false, sourceNote: 'Partly measured: a page date from front matter (6 of 15 points). Sitemap dates are added by your build.',
        measures: 'A date in the raw HTML (dateModified, article:modified_time, <time datetime> or visible "Last updated" text): 6. This URL\'s sitemap entry has lastmod: 4. Sitemap lastmod values are not all identical: 3. Page date and lastmod agree within 7 days: 2. Age is shown, not scored.',
        why: 'Recency is a consistent secondary signal for AI citations, and search engines use sitemap lastmod only when it is believable.',
        evidence: [EV.geo, EV.freshness],
    },
    {
        id: 'S5', source: 'lensy', score: 'aiSearch', label: 'Answer-ready sections', max: 15,
        hostDependent: false, sourceNote: 'Measured from the Markdown. Your build may add an H1 from the front-matter title.',
        measures: 'On the HTML: one H1 4 (more than one 2). No heading skips 4 (one skip 2), counted only with at least 2 headings. Median words per H2/H3 section: 40 to 500 7; under 40 or 501 to 900 4; over 900 1; no sections 0.',
        why: 'AI search retrieves passages of about a heading plus its paragraphs, so each section should answer one question on its own.',
        evidence: [EV.passages],
    },
    {
        id: 'S6', source: 'lensy', score: 'aiSearch', label: 'JSON-LD', max: 5,
        hostDependent: false, sourceNote: NEEDS_BUILD,
        measures: 'Parseable JSON-LD with an @type: 3. Has dateModified: 2.',
        why: 'Controlled studies found structured data barely moves AI citations, so it carries few points. dateModified also declares freshness.',
        evidence: [EV.ahrefs, EV.otterly, EV.citations],
    },
];

export const CHECKS_BY_ID: Record<string, CheckMeta> = Object.fromEntries(CHECKS.map(c => [c.id, c]));
