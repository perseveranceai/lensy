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
    /** Who defines the check. AFDocs checks keep AFDocs' ids and descriptions. */
    source: 'lensy' | 'afdocs';
    score: 'codingAgents' | 'aiSearch';
    label: string;
    /** Lensy checks: points out of 100. AFDocs checks: the tier weight (critical 10, high 7, medium 4, low 2); a run can give less when AFDocs applies a cluster coefficient. */
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
        measures: 'Not noindex (meta robots or X-Robots-Tag): 10, and noindex makes the whole check 0. Canonical present: 7. Page listed in the sitemap: 8. Sitemaps named in robots.txt are used; without one, Lensy tries <link rel="sitemap">, /sitemap.xml and /sitemap-index.xml, then the same under the page\'s first path segment (for example /docs/sitemap.xml). Sitemap indexes are followed, at most 12 files.',
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

// Coding agents checks when AFDocs ran (docs/coding-agents-afdocs/spec.md). The
// descriptions are AFDocs' own (MIT). Host dependence is read from what each
// check requests; confirm it against a local build before --serve ships.
export const AFDOCS_CHECKS: CheckMeta[] = [
    {
        id: 'llms-txt-exists', source: 'afdocs', score: 'codingAgents', label: 'llms.txt exists', max: 10,
        hostDependent: false,
        measures: 'Whether llms.txt is discoverable at any of the candidate locations.', why: 'Coding agents look for llms.txt to find the right page. Without it they guess URLs. AFDocs caps the score at 59 when it is missing.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-exists', url: 'https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-exists' }],
    },
    {
        id: 'llms-txt-valid', source: 'afdocs', score: 'codingAgents', label: 'llms.txt format', max: 4,
        hostDependent: false,
        measures: 'Whether llms.txt follows the proposed structure from llmstxt.org.', why: 'A predictable structure (an H1, then Markdown links) is what agents and tools parse.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-valid', url: 'https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-valid' }],
    },
    {
        id: 'llms-txt-size', source: 'afdocs', score: 'codingAgents', label: 'llms.txt size', max: 7,
        hostDependent: false,
        measures: 'Whether llms.txt fits within agent truncation limits.', why: 'Agents read about 100,000 characters per fetch; a larger index is cut off.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-size', url: 'https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-size' }],
    },
    {
        id: 'llms-txt-links-resolve', source: 'afdocs', score: 'codingAgents', label: 'llms.txt links resolve', max: 7,
        hostDependent: false,
        measures: 'Whether the URLs listed in llms.txt actually resolve.', why: 'A broken link in the index sends an agent to a dead end.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-links-resolve', url: 'https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-links-resolve' }],
    },
    {
        id: 'llms-txt-links-markdown', source: 'afdocs', score: 'codingAgents', label: 'llms.txt links point to Markdown', max: 7,
        hostDependent: false,
        measures: 'Whether the URLs in llms.txt point to markdown content.', why: 'Markdown is far smaller than HTML, so more of the page fits in what the agent reads.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-links-markdown', url: 'https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-links-markdown' }],
    },
    {
        id: 'llms-txt-directive-html', source: 'afdocs', score: 'codingAgents', label: 'Page points agents to llms.txt (HTML)', max: 7,
        hostDependent: false,
        measures: 'Whether HTML pages include a directive pointing to llms.txt.', why: 'An agent that lands on one page learns where the index of the whole site is.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-directive-html', url: 'https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-directive-html' }],
    },
    {
        id: 'llms-txt-directive-md', source: 'afdocs', score: 'codingAgents', label: 'Page points agents to llms.txt (Markdown)', max: 4,
        hostDependent: false,
        measures: 'Whether markdown pages include a directive pointing to llms.txt.', why: 'Agents that read the Markdown copy see the pointer too.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-directive-md', url: 'https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-directive-md' }],
    },
    {
        id: 'markdown-url-support', source: 'afdocs', score: 'codingAgents', label: '.md version of the page', max: 7,
        hostDependent: 'partial', hostNote: 'A rewrite from <page> to <page>.md can be set by your host rather than your build.',
        measures: 'Whether appending .md to page URLs returns valid markdown.', why: 'Agents guess <page>.md; a Markdown copy is much smaller than the HTML.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: markdown-url-support', url: 'https://agentdocsspec.com/spec/web/markdown-availability/#markdown-url-support' }],
    },
    {
        id: 'content-negotiation', source: 'afdocs', score: 'codingAgents', label: 'Markdown on request', max: 4,
        hostDependent: 'full', hostNote: 'Your web server or CDN decides what to return for Accept: text/markdown.',
        measures: 'Whether the server responds to Accept: text/markdown.', why: 'Claude Code, Cursor and OpenCode ask for Markdown first.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: content-negotiation', url: 'https://agentdocsspec.com/spec/web/markdown-availability/#content-negotiation' }],
    },
    {
        id: 'rendering-strategy', source: 'afdocs', score: 'codingAgents', label: 'Content without JavaScript', max: 10,
        hostDependent: false,
        measures: 'Whether pages contain server-rendered content or are client-side rendered SPA shells.', why: 'AI crawlers and most coding agents do not run JavaScript, so content rendered in the browser is invisible to them.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: rendering-strategy', url: 'https://agentdocsspec.com/spec/web/page-size/#rendering-strategy' }],
    },
    {
        id: 'page-size-markdown', source: 'afdocs', score: 'codingAgents', label: 'Markdown size', max: 7,
        hostDependent: false,
        measures: 'Character count of page when served as markdown.', why: 'Agents read about 100,000 characters per fetch and have to page or give up beyond it.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: page-size-markdown', url: 'https://agentdocsspec.com/spec/web/page-size/#page-size-markdown' }],
    },
    {
        id: 'page-size-html', source: 'afdocs', score: 'codingAgents', label: 'HTML size', max: 7,
        hostDependent: false,
        measures: 'Character count of HTML response and post-conversion size.', why: 'Agents that read HTML convert it to text; past about 100,000 characters the rest is cut off.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: page-size-html', url: 'https://agentdocsspec.com/spec/web/page-size/#page-size-html' }],
    },
    {
        id: 'page-size-transfer', source: 'afdocs', score: 'codingAgents', label: 'Download size', max: 4,
        hostDependent: false,
        measures: 'Served byte size of the HTML document after transfer decoding.', why: 'Very large documents can exceed an agent\'s fetch buffer before any text is read.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: page-size-transfer', url: 'https://agentdocsspec.com/spec/web/page-size/#page-size-transfer' }],
    },
    {
        id: 'content-start-position', source: 'afdocs', score: 'codingAgents', label: 'Content starts near the top', max: 4,
        hostDependent: false,
        measures: 'How far into content the actual documentation begins.', why: 'Navigation before the content uses up the part of the page an agent reads first.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: content-start-position', url: 'https://agentdocsspec.com/spec/web/page-size/#content-start-position' }],
    },
    {
        id: 'single-fetch-completeness', source: 'afdocs', score: 'codingAgents', label: 'Complete in one fetch', max: 4,
        hostDependent: false,
        measures: 'Whether markdown responses are complete in one fetch or declare a working continuation.', why: 'An agent that gets half a page and no way to the rest works from half the facts.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: single-fetch-completeness', url: 'https://agentdocsspec.com/spec/web/page-size/#single-fetch-completeness' }],
    },
    {
        id: 'tabbed-content-serialization', source: 'afdocs', score: 'codingAgents', label: 'Tabbed content readable', max: 4,
        hostDependent: false,
        measures: 'Whether tabbed/accordion content serializes into oversized output.', why: 'Tabs flatten into one long text for an agent; every variant counts toward the size limit.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: tabbed-content-serialization', url: 'https://agentdocsspec.com/spec/web/content-structure/#tabbed-content-serialization' }],
    },
    {
        id: 'section-header-quality', source: 'afdocs', score: 'codingAgents', label: 'Headers inside tabs', max: 2,
        hostDependent: false,
        measures: 'Whether headers in tabbed sections include variant context.', why: 'Flattened tabs repeat the same headings; without the variant name an agent can\'t tell them apart.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: section-header-quality', url: 'https://agentdocsspec.com/spec/web/content-structure/#section-header-quality' }],
    },
    {
        id: 'markdown-code-fence-validity', source: 'afdocs', score: 'codingAgents', label: 'Code fences closed', max: 4,
        hostDependent: false,
        measures: 'Whether markdown contains unclosed code fences.', why: 'An unclosed fence turns the rest of the page into code for the agent.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: markdown-code-fence-validity', url: 'https://agentdocsspec.com/spec/web/content-structure/#markdown-code-fence-validity' }],
    },
    {
        id: 'markdown-link-portability', source: 'afdocs', score: 'codingAgents', label: 'Links work outside the site', max: 4,
        hostDependent: false,
        measures: 'Whether links in served markdown are absolute and resolve to what they promise.', why: 'Relative links break once the Markdown is read outside the site, as agents do.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: markdown-link-portability', url: 'https://agentdocsspec.com/spec/web/content-structure/#markdown-link-portability' }],
    },
    {
        id: 'embedded-data-serialization', source: 'afdocs', score: 'codingAgents', label: 'Embedded data size', max: 4,
        hostDependent: false,
        measures: 'Whether machine-generated bulk data (large tables, data blobs) dominates oversized pages.', why: 'Bulk data can push the actual explanation past what an agent reads.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: embedded-data-serialization', url: 'https://agentdocsspec.com/spec/web/content-structure/#embedded-data-serialization' }],
    },
    {
        id: 'http-status-codes', source: 'afdocs', score: 'codingAgents', label: 'Real 404s for missing pages', max: 7,
        hostDependent: 'full', hostNote: 'Status codes for missing pages are set by your web server or host.',
        measures: 'Whether error pages return correct HTTP status codes.', why: 'A "not found" page served with 200 looks like real content to an agent.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: http-status-codes', url: 'https://agentdocsspec.com/spec/web/url-stability/#http-status-codes' }],
    },
    {
        id: 'redirect-behavior', source: 'afdocs', score: 'codingAgents', label: 'Redirects', max: 4,
        hostDependent: 'full', hostNote: 'Redirects are configured on your host or CDN.',
        measures: 'Whether redirects are same-host HTTP redirects.', why: 'Cross-host or JavaScript redirects lose agents that follow links.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: redirect-behavior', url: 'https://agentdocsspec.com/spec/web/url-stability/#redirect-behavior' }],
    },
    {
        id: 'llms-txt-coverage', source: 'afdocs', score: 'codingAgents', label: 'llms.txt covers the sitemap', max: 4,
        hostDependent: false,
        measures: 'How much of the site is represented in llms.txt.', why: 'Pages missing from the index are found less often. Lensy skips it: it is about the whole site, not the page.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: llms-txt-coverage', url: 'https://agentdocsspec.com/spec/web/observability/#llms-txt-coverage' }],
    },
    {
        id: 'markdown-content-parity', source: 'afdocs', score: 'codingAgents', label: 'Markdown matches HTML', max: 4,
        hostDependent: false,
        measures: 'Whether markdown and HTML versions contain equivalent content.', why: 'A Markdown copy that drops content gives agents a different page than people see.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: markdown-content-parity', url: 'https://agentdocsspec.com/spec/web/observability/#markdown-content-parity' }],
    },
    {
        id: 'cache-header-hygiene', source: 'afdocs', score: 'codingAgents', label: 'Cache headers', max: 2,
        hostDependent: 'full', hostNote: 'Cache headers are set by your web server or CDN.',
        measures: 'Whether cache headers allow timely updates.', why: 'Long caching keeps agents reading old versions after you fix a page.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: cache-header-hygiene', url: 'https://agentdocsspec.com/spec/web/observability/#cache-header-hygiene' }],
    },
    {
        id: 'auth-gate-detection', source: 'afdocs', score: 'codingAgents', label: 'Public without login', max: 10,
        hostDependent: 'full', hostNote: 'Login walls are enforced by your host.',
        measures: 'Whether documentation pages require authentication to access content.', why: 'Agents can\'t log in, so gated docs are invisible to them.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: auth-gate-detection', url: 'https://agentdocsspec.com/spec/web/authentication/#auth-gate-detection' }],
    },
    {
        id: 'auth-alternative-access', source: 'afdocs', score: 'codingAgents', label: 'Alternative access to gated docs', max: 4,
        hostDependent: 'full', hostNote: 'Access rules are enforced by your host.',
        measures: 'Whether an auth-gated documentation site provides alternative access paths for agents.', why: 'When docs need a login, an alternative path lets agents read them anyway.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: auth-alternative-access', url: 'https://agentdocsspec.com/spec/web/authentication/#auth-alternative-access' }],
    },
    {
        id: 'bot-protection-interference', source: 'afdocs', score: 'codingAgents', label: 'Bot protection lets agents in', max: 7,
        hostDependent: 'full', hostNote: 'Bot protection runs on your host or CDN, not in your build.',
        measures: 'Whether bot-protection systems interfere with automated fetching of documentation content.', why: 'Bot protection that refuses honest agents keeps the docs out of their answers.',
        evidence: [{ title: 'Agent-Friendly Documentation Spec: bot-protection-interference', url: 'https://agentdocsspec.com/spec/web/authentication/#bot-protection-interference' }],
    },
    {
        id: 'lensy-headings', source: 'lensy', score: 'codingAgents', label: 'Headings an agent can navigate', max: 4,
        hostDependent: false,
        measures: 'On what an agent receives: exactly one H1 (half the points; more than one, a fifth) and an outline with no skipped heading levels (half; one skip, a quarter), counted only with at least 2 headings.',
        why: 'A URL #fragment never reaches the server, so agents find sections by heading text. AFDocs\' section-header-quality only looks inside tabs.',
        evidence: [EV.claudeFetch],
    },
];

export const CHECKS_BY_ID: Record<string, CheckMeta> = Object.fromEntries([...CHECKS, ...AFDOCS_CHECKS].map(c => [c.id, c]));
