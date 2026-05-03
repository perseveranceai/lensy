/**
 * Lensy v2 Detection Engine
 *
 * Pure analysis functions with no side effects (no S3, no WebSocket, no progress publishing).
 * This is the core detection logic — the adapter layer (Lambda/MCP) handles I/O.
 *
 * Architecture: 3 phases
 *   Phase 1: Signal Harvest  (0 HTTP calls, ~0ms)  — parse headers + HTML + robots.txt for hints
 *   Phase 2: Parallel Probes (~5s wall clock)       — fire all probes via Promise.allSettled
 *   Phase 3: Cross-Reference (0 HTTP calls, ~0ms)   — validate hints, merge results, classify evidence
 *
 * @see docs/lensy-v2-implementation-spec.md
 */

import { URL } from 'url';
import {
    HarvestedSignals,
    DetectionReport,
    DetectionSignal,
    AllProbeResults,
    ProbeResult,
    ProbeLogEntry,
    LlmsTxtProbeResults,
    MarkdownProbeResults,
    ExtrasProbeResults,
    notVerifiedSignal,
    experimentalSignal,
} from './detection-types';

// ── Constants ───────────────────────────────────────────────────────────

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (+https://perseveranceai.com/bot)';

const FETCH_HEADERS: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

const PROBE_TIMEOUT_MS = 3000;

/** Known docs path segments for subpath derivation */
const DOCS_PATH_SEGMENTS = new Set([
    'docs', 'doc', 'documentation', 'guide', 'guides',
    'learn', 'reference', 'help', 'wiki', 'manual',
    'knowledge', 'kb', 'api', 'tutorials', 'resources',
]);

/** AI crawler user-agents to check in robots.txt */
const AI_CRAWLERS = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
    'ClaudeBot', 'Claude-Web',
    'PerplexityBot', 'Amazonbot', 'Bingbot',
    'Bytespider', 'Google-Extended',
    'CCBot', 'anthropic-ai', 'Omgilibot',
];

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1: Signal Harvest (0 HTTP calls)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extract all detection hints from already-fetched data.
 * Pure function — no HTTP calls, no side effects.
 *
 * @param html        - Prefetched HTML of the target page
 * @param headers     - HTTP response headers from the target page fetch (optional)
 * @param robotsTxt   - Prefetched robots.txt content (optional)
 * @param targetUrl   - The URL being analyzed
 * @param baseUrl     - The site's base URL (e.g., https://docs.example.com)
 */
export function harvestSignals(
    html: string,
    headers: Record<string, string> | null,
    robotsTxt: string | null,
    targetUrl: string,
    baseUrl: string,
): HarvestedSignals {
    const llmsTxtHintUrls: string[] = [];
    const llmsFullTxtHintUrls: string[] = [];
    let markdownAlternateUrl: string | null = null;
    let markdownLinkHeaderUrl: string | null = null;
    const mdLinksInHtml: string[] = [];

    // ── Parse Link header ──
    const linkHeader = headers?.['link'] || headers?.['Link'] || '';
    if (linkHeader) {
        // Parse rel="llms-txt"
        const llmsMatches = linkHeader.matchAll(/<([^>]+)>;\s*[^,]*rel="llms-txt"/gi);
        for (const m of llmsMatches) {
            llmsTxtHintUrls.push(resolveUrl(m[1], baseUrl));
        }

        // Parse rel="llms-full-txt"
        const llmsFullMatches = linkHeader.matchAll(/<([^>]+)>;\s*[^,]*rel="llms-full-txt"/gi);
        for (const m of llmsFullMatches) {
            llmsFullTxtHintUrls.push(resolveUrl(m[1], baseUrl));
        }

        // Parse type="text/markdown" (markdown alternate via Link header)
        const mdLinkMatch = linkHeader.match(/<([^>]+)>;\s*[^,]*(?:rel="alternate"[^,]*type="text\/markdown"|type="text\/markdown"[^,]*rel="alternate")/i);
        if (mdLinkMatch) {
            markdownLinkHeaderUrl = resolveUrl(mdLinkMatch[1], baseUrl);
        }
    }

    // ── Parse X-Llms-Txt header ──
    const xLlmsTxt = headers?.['x-llms-txt'] || headers?.['X-Llms-Txt'] || '';
    if (xLlmsTxt) {
        llmsTxtHintUrls.push(resolveUrl(xLlmsTxt, baseUrl));
    }

    // ── Parse HTML for <link rel="alternate" type="text/markdown"> ──
    const altMdMatch = html.match(
        /<link[^>]*rel=["']alternate["'][^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i
    ) || html.match(
        /<link[^>]*type=["']text\/markdown["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i
    ) || html.match(
        /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*type=["']text\/markdown["']/i
    );
    if (altMdMatch) {
        markdownAlternateUrl = resolveUrl(altMdMatch[1], baseUrl);
    }

    // ── Parse HTML for .md links ──
    const mdLinkRegex = /href=["']([^"']*\.md)["']/gi;
    let mdMatch;
    while ((mdMatch = mdLinkRegex.exec(html)) !== null) {
        mdLinksInHtml.push(resolveUrl(mdMatch[1], baseUrl));
        if (mdLinksInHtml.length >= 5) break; // Cap to avoid noise
    }

    // ── Parse response headers for supporting evidence ──
    const varyHeader = headers?.['vary'] || headers?.['Vary'] || '';
    const varyAccept = varyHeader.toLowerCase().includes('accept');

    const xRobotsTag = headers?.['x-robots-tag'] || headers?.['X-Robots-Tag'] || null;

    // ── Parse robots.txt for AI crawler directives ──
    const { blocked, allowed } = parseRobotsTxtCrawlers(robotsTxt);

    // ── Parse HTML for canonical URL ──
    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
    const canonicalUrl = canonicalMatch ? canonicalMatch[1] : null;

    // ── Parse HTML for meta robots ──
    const metaRobotsMatch = html.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']robots["']/i);
    const metaRobots = metaRobotsMatch ? metaRobotsMatch[1] : null;

    // ── Parse HTML for OpenGraph tags ──
    const openGraphTags: Record<string, string> = {};
    const ogRegex1 = /<meta[^>]*property=["'](og:[^"']+)["'][^>]*content=["']([^"']*)["']/gi;
    const ogRegex2 = /<meta[^>]*content=["']([^"']*)["'][^>]*property=["'](og:[^"']+)["']/gi;
    let ogMatch;
    while ((ogMatch = ogRegex1.exec(html)) !== null) openGraphTags[ogMatch[1]] = ogMatch[2];
    while ((ogMatch = ogRegex2.exec(html)) !== null) openGraphTags[ogMatch[2]] = ogMatch[1];

    // ── Derive docs subpath ──
    const docsSubpath = deriveDocsSubpath(targetUrl, baseUrl);

    return {
        llmsTxtHintUrls,
        llmsFullTxtHintUrls,
        markdownAlternateUrl,
        markdownLinkHeaderUrl,
        mdLinksInHtml,
        varyAccept,
        xRobotsTag,
        blockedCrawlers: blocked,
        allowedCrawlers: allowed,
        canonicalUrl,
        metaRobots,
        openGraphTags,
        docsSubpath,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2: Parallel Probes (~5s wall clock)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fire all detection probes in parallel via Promise.allSettled.
 * Each probe has its own 5s timeout. Total wall clock ≈ max single probe time.
 *
 * @param baseUrl       - Site base URL (post-redirect, e.g. https://www.unkey.com)
 * @param targetUrl     - The specific page URL being analyzed
 * @param signals       - Harvested signals from Phase 1
 * @param robotsTxt     - Prefetched robots.txt content (optional)
 */
export async function executeProbes(
    baseUrl: string,
    targetUrl: string,
    signals: HarvestedSignals,
    robotsTxt: string | null,
): Promise<AllProbeResults> {
    const probeLog: ProbeLogEntry[] = [];

    // Run 3 probe groups in parallel (each group limits its own concurrency).
    // Within each group, candidates are tried sequentially to avoid flooding
    // the target server (stop on first success).
    const [llmsTxtResults, markdownResults, extrasResults] = await Promise.all([
        probeLlmsTxtGroup(baseUrl, targetUrl, signals, probeLog),
        probeMarkdownGroup(baseUrl, targetUrl, signals, probeLog),
        probeExtrasGroup(baseUrl, robotsTxt, probeLog),
    ]);

    return {
        llmsTxt: llmsTxtResults,
        markdown: markdownResults,
        extras: extrasResults,
        probeLog,
    };
}

/** Group A: llms.txt + llms-full.txt probes */
async function probeLlmsTxtGroup(
    baseUrl: string,
    targetUrl: string,
    signals: HarvestedSignals,
    probeLog: ProbeLogEntry[],
): Promise<LlmsTxtProbeResults> {

    // ── Build llms.txt candidate list ──
    const llmsTxtCandidates: string[] = [];

    // 1. Header hint URLs (validate, don't trust)
    for (const hintUrl of signals.llmsTxtHintUrls) {
        if (!llmsTxtCandidates.includes(hintUrl)) llmsTxtCandidates.push(hintUrl);
    }

    // 2. Root convention
    const rootUrl = `${baseUrl}/llms.txt`;
    if (!llmsTxtCandidates.includes(rootUrl)) llmsTxtCandidates.push(rootUrl);

    // 3. Docs subpath
    if (signals.docsSubpath) {
        const subpathUrl = `${baseUrl}${signals.docsSubpath}/llms.txt`;
        if (!llmsTxtCandidates.includes(subpathUrl)) llmsTxtCandidates.push(subpathUrl);
    }

    // 4. Walk-up from target path (Lensy heuristic — cap at 3 levels)
    const walkUpUrls = generateWalkUpCandidates(targetUrl, baseUrl, 'llms.txt');
    for (const url of walkUpUrls) {
        if (!llmsTxtCandidates.includes(url)) llmsTxtCandidates.push(url);
    }

    // 5. .well-known convention
    const wellKnownUrl = `${baseUrl}/.well-known/llms.txt`;
    if (!llmsTxtCandidates.includes(wellKnownUrl)) llmsTxtCandidates.push(wellKnownUrl);

    // ── Build llms-full.txt candidate list ──
    const llmsFullTxtCandidates: string[] = [];

    // Header hints
    for (const hintUrl of signals.llmsFullTxtHintUrls) {
        if (!llmsFullTxtCandidates.includes(hintUrl)) llmsFullTxtCandidates.push(hintUrl);
    }

    // Root
    const fullRootUrl = `${baseUrl}/llms-full.txt`;
    if (!llmsFullTxtCandidates.includes(fullRootUrl)) llmsFullTxtCandidates.push(fullRootUrl);

    // Docs subpath
    if (signals.docsSubpath) {
        const subUrl = `${baseUrl}${signals.docsSubpath}/llms-full.txt`;
        if (!llmsFullTxtCandidates.includes(subUrl)) llmsFullTxtCandidates.push(subUrl);
    }

    // Walk-up
    const walkUpFull = generateWalkUpCandidates(targetUrl, baseUrl, 'llms-full.txt');
    for (const url of walkUpFull) {
        if (!llmsFullTxtCandidates.includes(url)) llmsFullTxtCandidates.push(url);
    }

    // .well-known
    const fullWellKnownUrl = `${baseUrl}/.well-known/llms-full.txt`;
    if (!llmsFullTxtCandidates.includes(fullWellKnownUrl)) llmsFullTxtCandidates.push(fullWellKnownUrl);

    // ── Probe sequentially: llms.txt first (higher value), then llms-full.txt ──
    // Sequential to avoid flooding target server with parallel requests
    const llmsTxt = await probeFirstSuccess(llmsTxtCandidates, 'llms.txt', probeLog, true);
    const llmsFullTxt = await probeFirstSuccess(llmsFullTxtCandidates, 'llms-full.txt', probeLog, false);

    return {
        llmsTxt,
        llmsFullTxt,
        llmsTxtCandidates,
        llmsFullTxtCandidates,
    };
}

/** Group B: Markdown probes */
async function probeMarkdownGroup(
    baseUrl: string,
    targetUrl: string,
    signals: HarvestedSignals,
    probeLog: ProbeLogEntry[],
): Promise<MarkdownProbeResults> {

    // 3 probes in parallel — different endpoints, won't trigger rate limiting
    const [contentNegotiation, linkAlternate, directMdProbe] = await Promise.allSettled([
        probeContentNegotiation(targetUrl, probeLog),
        probeMarkdownAlternate(signals, probeLog),
        probeDirectMd(targetUrl, probeLog),
    ]);

    return {
        contentNegotiation: contentNegotiation.status === 'fulfilled' ? contentNegotiation.value : null,
        linkAlternate: linkAlternate.status === 'fulfilled' ? linkAlternate.value : null,
        directMdProbe: directMdProbe.status === 'fulfilled' ? directMdProbe.value : null,
    };
}

/** Group C: Extras (experimental + sitemap) */
async function probeExtrasGroup(
    baseUrl: string,
    robotsTxt: string | null,
    probeLog: ProbeLogEntry[],
): Promise<ExtrasProbeResults> {

    // Determine sitemap URL from robots.txt
    let sitemapUrl = `${baseUrl}/sitemap.xml`;
    if (robotsTxt) {
        const sitemapMatch = robotsTxt.match(/^Sitemap:\s*(.+)$/im);
        if (sitemapMatch) sitemapUrl = sitemapMatch[1].trim();
    }

    // 3 HEAD requests in parallel — lightweight, won't trigger rate limiting
    const [agentsMd, mcpJson, sitemap] = await Promise.allSettled([
        probeUrl(`${baseUrl}/AGENTS.md`, 'AGENTS.md', probeLog),
        probeUrl(`${baseUrl}/.well-known/mcp.json`, 'mcp.json', probeLog),
        probeUrl(sitemapUrl, 'sitemap.xml', probeLog),
    ]);

    return {
        agentsMd: agentsMd.status === 'fulfilled' ? agentsMd.value : null,
        mcpJson: mcpJson.status === 'fulfilled' ? mcpJson.value : null,
        sitemap: sitemap.status === 'fulfilled' ? sitemap.value : null,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3: Cross-Reference (0 HTTP calls)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Validate hints against probe results, classify evidence, build report.
 * Pure function — no HTTP calls, no side effects.
 */
export function crossReference(
    signals: HarvestedSignals,
    probes: AllProbeResults,
    targetUrl: string,
    baseUrl: string,
): DetectionReport {

    // ── Site-level: llms.txt ──
    const llmsTxtSignal = classifyLlmsTxt(signals, probes.llmsTxt);

    // ── Site-level: llms-full.txt ──
    const llmsFullTxtSignal = classifyLlmsFullTxt(signals, probes.llmsTxt);

    // ── Site-level: sitemap ──
    const sitemapSignal = classifySitemap(probes.extras);

    // ── Site-level: AGENTS.md (experimental) ──
    const agentsMdSignal = classifyExperimental(probes.extras.agentsMd, 'AGENTS.md');

    // ── Site-level: mcp.json (experimental) ──
    const mcpJsonSignal = classifyExperimental(probes.extras.mcpJson, 'mcp.json');

    // ── Site-level: OpenAPI specs from llms.txt content ──
    const openApiSpecs = extractOpenApiSpecs(probes.llmsTxt.llmsTxt?.content);

    // ── Page-level: markdown ──
    const markdownSignal = classifyMarkdown(signals, probes.markdown);

    // ── Page-level: content negotiation ──
    const contentNegotiationSignal = classifyContentNegotiation(probes.markdown);

    // ── Page-level: llms.txt mapping ──
    const { llmsTxtMapping, llmsTxtMarkdownMapping } = classifyPageMapping(
        targetUrl, probes.llmsTxt.llmsTxt?.content
    );

    return {
        site: {
            llmsTxt: llmsTxtSignal,
            llmsFullTxt: llmsFullTxtSignal,
            sitemap: sitemapSignal,
            agentsMd: agentsMdSignal,
            mcpJson: mcpJsonSignal,
            blockedAiCrawlers: signals.blockedCrawlers,
            allowedAiCrawlers: signals.allowedCrawlers,
            openApiSpecs,
        },
        page: {
            markdown: markdownSignal,
            llmsTxtMapping,
            llmsTxtMarkdownMapping,
            contentNegotiation: contentNegotiationSignal,
        },
        probeLog: probes.probeLog,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Classification helpers (Phase 3 internals)
// ═══════════════════════════════════════════════════════════════════════

function classifyLlmsTxt(
    signals: HarvestedSignals,
    llmsTxtProbes: LlmsTxtProbeResults,
): DetectionSignal {
    const probe = llmsTxtProbes.llmsTxt;

    if (probe?.found) {
        // Determine if it was found at a hint URL or a fallback
        const wasHinted = signals.llmsTxtHintUrls.length > 0;
        const hintSucceeded = wasHinted && signals.llmsTxtHintUrls.includes(probe.url);

        let note: string | null = null;
        if (wasHinted && !hintSucceeded) {
            note = `Link header pointed to ${signals.llmsTxtHintUrls[0]} (not found), discovered at ${probe.url}`;
        }

        return {
            status: 'verified',
            method: determineProbeMethod(probe.url, signals),
            validatedUrl: probe.url,
            audience: 'both',
            note,
        };
    }

    // Not found — but was it advertised via headers?
    if (signals.llmsTxtHintUrls.length > 0) {
        return {
            status: 'advertised',
            method: 'link-header',
            validatedUrl: null,
            audience: 'both',
            note: `Header advertised ${signals.llmsTxtHintUrls[0]} but probe failed. Tested: ${llmsTxtProbes.llmsTxtCandidates.join(', ')}`,
        };
    }

    return {
        ...notVerifiedSignal('both'),
        note: `Tested: ${llmsTxtProbes.llmsTxtCandidates.join(', ')}`,
    };
}

function classifyLlmsFullTxt(
    signals: HarvestedSignals,
    llmsTxtProbes: LlmsTxtProbeResults,
): DetectionSignal {
    const probe = llmsTxtProbes.llmsFullTxt;

    if (probe?.found) {
        return {
            status: 'verified',
            method: determineProbeMethod(probe.url, signals),
            validatedUrl: probe.url,
            audience: 'coding_agents',
        };
    }

    // Check if llms.txt content references llms-full.txt
    const llmsTxtContent = llmsTxtProbes.llmsTxt?.content;
    if (llmsTxtContent) {
        const fullTxtRef = llmsTxtContent.match(/llms-full\.txt/i);
        if (fullTxtRef) {
            return {
                status: 'advertised',
                method: 'llms-txt-reference',
                validatedUrl: null,
                audience: 'coding_agents',
                note: 'Referenced in llms.txt but direct probe failed',
            };
        }
    }

    if (signals.llmsFullTxtHintUrls.length > 0) {
        return {
            status: 'advertised',
            method: 'link-header',
            validatedUrl: null,
            audience: 'coding_agents',
            note: `Header advertised ${signals.llmsFullTxtHintUrls[0]} but probe failed`,
        };
    }

    return notVerifiedSignal('coding_agents');
}

function classifySitemap(extras: ExtrasProbeResults): DetectionSignal {
    if (extras.sitemap?.found) {
        return {
            status: 'verified',
            method: 'direct-fetch',
            validatedUrl: extras.sitemap.url,
            audience: 'ai_search',
        };
    }
    return notVerifiedSignal('ai_search');
}

function classifyExperimental(probe: ProbeResult | null, name: string): DetectionSignal {
    if (probe?.found) {
        return {
            status: 'experimental',
            method: 'direct-fetch',
            validatedUrl: probe.url,
            audience: 'coding_agents',
            note: `${name} found — emerging standard, not scored`,
        };
    }
    return notVerifiedSignal('coding_agents');
}

function classifyMarkdown(
    signals: HarvestedSignals,
    markdownProbes: MarkdownProbeResults,
): DetectionSignal {
    // Priority: content negotiation > link-alternate > direct .md probe
    if (markdownProbes.contentNegotiation?.found) {
        return {
            status: 'verified',
            method: 'content-negotiation',
            validatedUrl: markdownProbes.contentNegotiation.url,
            audience: 'coding_agents',
        };
    }

    if (markdownProbes.linkAlternate?.found) {
        return {
            status: 'verified',
            method: 'link-alternate',
            validatedUrl: markdownProbes.linkAlternate.url,
            audience: 'coding_agents',
        };
    }

    if (markdownProbes.directMdProbe?.found) {
        return {
            status: 'verified',
            method: 'direct-md-probe',
            validatedUrl: markdownProbes.directMdProbe.url,
            audience: 'coding_agents',
        };
    }

    // Was advertised but not validated?
    if (signals.markdownAlternateUrl || signals.markdownLinkHeaderUrl) {
        return {
            status: 'advertised',
            method: signals.markdownAlternateUrl ? 'link-alternate' : 'link-header',
            validatedUrl: null,
            audience: 'coding_agents',
            note: `Advertised at ${signals.markdownAlternateUrl || signals.markdownLinkHeaderUrl} but probe failed`,
        };
    }

    return notVerifiedSignal('coding_agents');
}

function classifyContentNegotiation(markdownProbes: MarkdownProbeResults): DetectionSignal {
    if (markdownProbes.contentNegotiation?.found) {
        return {
            status: 'verified',
            method: 'content-negotiation',
            validatedUrl: markdownProbes.contentNegotiation.url,
            audience: 'coding_agents',
        };
    }
    return notVerifiedSignal('coding_agents');
}

function classifyPageMapping(
    targetUrl: string,
    llmsTxtContent: string | undefined,
): { llmsTxtMapping: DetectionSignal; llmsTxtMarkdownMapping: DetectionSignal } {
    if (!llmsTxtContent) {
        return {
            llmsTxtMapping: notVerifiedSignal('both'),
            llmsTxtMarkdownMapping: notVerifiedSignal('both'),
        };
    }

    // Normalize the target URL for matching
    const normalizedTarget = normalizeUrlForMatching(targetUrl);
    const mdVariant = normalizedTarget.replace(/\/?$/, '.md');

    const lines = llmsTxtContent.split('\n');
    let foundExact = false;
    let foundMd = false;
    let matchedUrl: string | null = null;
    let matchedMdUrl: string | null = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;

        // Extract URL from markdown link format: - [Title](url) or just plain URL
        const linkMatch = trimmed.match(/\[([^\]]*)\]\(([^)]+)\)/);
        const url = linkMatch ? linkMatch[2] : (trimmed.startsWith('http') ? trimmed.split(/\s/)[0] : null);

        if (!url) continue;

        const normalizedUrl = normalizeUrlForMatching(url);
        // Strip common file extensions for fuzzy matching (.md, .html, .htm, .mdx)
        const normalizedUrlBase = normalizedUrl.replace(/\.(md|html|htm|mdx)$/, '');
        const normalizedTargetBase = normalizedTarget.replace(/\.(md|html|htm|mdx)$/, '');

        // Check match (exact, with trailing slash, or extension-stripped)
        if (normalizedUrl === normalizedTarget
            || normalizedUrl === normalizedTarget + '/'
            || normalizedUrlBase === normalizedTargetBase) {
            foundExact = true;
            matchedUrl = url;
        }

        // Check .md variant match (llms.txt lists .md URL for a non-.md target page)
        if (normalizedUrl === mdVariant || normalizedUrl.endsWith(mdVariant)) {
            foundMd = true;
            matchedMdUrl = url;
        }

        // Also check if the page path appears as a relative URL in llms.txt
        try {
            const targetPath = new URL(targetUrl).pathname.replace(/\/$/, '');
            const targetPathBase = targetPath.replace(/\.(md|html|htm|mdx)$/, '');
            const urlPath = url.startsWith('http') ? new URL(url).pathname.replace(/\/$/, '') : url.replace(/\/$/, '');
            const urlPathBase = urlPath.replace(/\.(md|html|htm|mdx)$/, '');
            if (targetPath && (urlPath === targetPath || urlPathBase === targetPathBase)) {
                foundExact = true;
                matchedUrl = url;
            }
            if (targetPath && (urlPath === targetPath + '.md')) {
                foundMd = true;
                matchedMdUrl = url;
            }
        } catch { }
    }

    const llmsTxtMapping: DetectionSignal = foundExact || foundMd
        ? { status: 'mapped', method: 'llms-txt-content-match', validatedUrl: matchedUrl || matchedMdUrl, audience: 'both' }
        : notVerifiedSignal('both');

    const llmsTxtMarkdownMapping: DetectionSignal = foundMd
        ? { status: 'mapped', method: 'llms-txt-md-match', validatedUrl: matchedMdUrl, audience: 'both' }
        : notVerifiedSignal('both');

    return { llmsTxtMapping, llmsTxtMarkdownMapping };
}

function extractOpenApiSpecs(llmsTxtContent: string | undefined): string[] {
    if (!llmsTxtContent) return [];
    const specs: string[] = [];

    // Look for ## OpenAPI Specs section
    const sectionMatch = llmsTxtContent.match(/##\s*OpenAPI\s*Specs?\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
    if (sectionMatch) {
        const lines = sectionMatch[1].split('\n');
        for (const line of lines) {
            const urlMatch = line.match(/(https?:\/\/[^\s)]+)/);
            if (urlMatch) specs.push(urlMatch[1]);
        }
    }

    return specs;
}

// ═══════════════════════════════════════════════════════════════════════
// Probe helpers
// ═════════════════���═════════════════════════════════════════════════════

/** Content-type expectations per probe purpose — reject HTML soft-404s */
const EXPECTED_CONTENT_TYPES: Record<string, string[]> = {
    'llms.txt': ['text/plain', 'text/markdown', 'application/octet-stream'],
    'llms-full.txt': ['text/plain', 'text/markdown', 'application/octet-stream'],
    'AGENTS.md': ['text/plain', 'text/markdown', 'application/octet-stream'],
    'mcp.json': ['application/json', 'text/json'],
    'sitemap.xml': ['application/xml', 'text/xml'],
    'markdown-alternate': ['text/markdown', 'text/plain'],
    'direct-md': ['text/markdown', 'text/plain', 'application/octet-stream'],
};

/**
 * Probe a single URL. Returns ProbeResult.
 * Validates Content-Type against expected types to reject HTML soft-404s.
 */
async function probeUrl(
    url: string,
    purpose: string,
    probeLog: ProbeLogEntry[],
    returnContent = false,
): Promise<ProbeResult> {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

        // Use HEAD when we don't need content — avoids downloading large files (e.g., llms-full.txt)
        // Some servers don't support HEAD, so we fall back to GET with immediate body abort.
        let res: Response;
        if (!returnContent) {
            try {
                res = await fetch(url, { method: 'HEAD', signal: controller.signal, headers: FETCH_HEADERS, redirect: 'follow' });
            } catch {
                // HEAD not supported — fall back to GET
                res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS, redirect: 'follow' });
            }
        } else {
            res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS, redirect: 'follow' });
        }
        clearTimeout(timeoutId);

        const durationMs = Date.now() - start;
        const statusCode = res.status;
        const contentType = res.headers.get('content-type') || '';

        probeLog.push({ url, statusCode, purpose, durationMs });

        if (res.ok) {
            // Reject HTML soft-404s: if we expect text/plain but got text/html, it's a custom error page
            const expectedTypes = EXPECTED_CONTENT_TYPES[purpose];
            if (expectedTypes && contentType.includes('text/html')) {
                // Got HTML when expecting a non-HTML resource → soft 404
                return { found: false, url, statusCode, contentType, durationMs };
            }

            let content: string | undefined;
            if (returnContent) {
                // Read up to 32KB — enough for page mapping and OpenAPI extraction
                // without downloading multi-MB llms-full.txt files
                const reader = res.body?.getReader();
                if (reader) {
                    const chunks: Uint8Array[] = [];
                    let totalBytes = 0;
                    const MAX_CONTENT_BYTES = 512 * 1024; // 512KB — llms.txt files can be large and need full read for page mapping
                    while (totalBytes < MAX_CONTENT_BYTES) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        totalBytes += value.length;
                    }
                    reader.cancel(); // Stop downloading remaining bytes
                    const decoder = new TextDecoder();
                    content = chunks.map(c => decoder.decode(c, { stream: true })).join('');
                } else {
                    content = await res.text();
                }
            }
            // Collect response headers
            const responseHeaders: Record<string, string> = {};
            res.headers.forEach((v, k) => { responseHeaders[k] = v; });

            return { found: true, url, content, statusCode, contentType, headers: responseHeaders, durationMs };
        }

        return { found: false, url, statusCode, durationMs };
    } catch (e) {
        const durationMs = Date.now() - start;
        probeLog.push({ url, statusCode: 0, purpose, durationMs });
        return { found: false, url, statusCode: 0, durationMs };
    }
}

/**
 * Try candidates sequentially, return the first one that succeeds.
 * Stops immediately on first hit — avoids flooding the target server
 * with 5-10+ parallel requests (which triggers rate limiting).
 */
async function probeFirstSuccess(
    candidates: string[],
    purpose: string,
    probeLog: ProbeLogEntry[],
    returnContent: boolean,
): Promise<ProbeResult | null> {
    if (candidates.length === 0) return null;

    for (const url of candidates) {
        const result = await probeUrl(url, purpose, probeLog, returnContent);
        if (result.found) return result;
    }

    return null;
}

/**
 * Probe target URL with Accept: text/markdown header (content negotiation).
 */
async function probeContentNegotiation(
    targetUrl: string,
    probeLog: ProbeLogEntry[],
): Promise<ProbeResult> {
    const start = Date.now();
    const purpose = 'content-negotiation';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        const res = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
                ...FETCH_HEADERS,
                'Accept': 'text/markdown',
            },
            redirect: 'follow',
        });
        clearTimeout(timeoutId);

        const durationMs = Date.now() - start;
        const statusCode = res.status;
        const contentType = res.headers.get('content-type') || '';

        probeLog.push({ url: targetUrl, statusCode, purpose, durationMs });

        // Only count as found if the server actually returned markdown
        if (res.ok && contentType.includes('text/markdown')) {
            const content = await res.text();
            return { found: true, url: targetUrl, content, statusCode, contentType, durationMs };
        }

        return { found: false, url: targetUrl, statusCode, contentType, durationMs };
    } catch (e) {
        const durationMs = Date.now() - start;
        probeLog.push({ url: targetUrl, statusCode: 0, purpose, durationMs });
        return { found: false, url: targetUrl, statusCode: 0, durationMs };
    }
}

/**
 * Probe the markdown alternate URL from HTML <link> or HTTP Link header.
 */
async function probeMarkdownAlternate(
    signals: HarvestedSignals,
    probeLog: ProbeLogEntry[],
): Promise<ProbeResult> {
    const url = signals.markdownAlternateUrl || signals.markdownLinkHeaderUrl;
    if (!url) {
        return { found: false, url: '', statusCode: 0 };
    }
    return probeUrl(url, 'markdown-alternate', probeLog);
}

/**
 * Probe {targetUrl}.md directly (common convention).
 */
async function probeDirectMd(
    targetUrl: string,
    probeLog: ProbeLogEntry[],
): Promise<ProbeResult> {
    const mdUrl = targetUrl.replace(/\/$/, '') + '.md';
    return probeUrl(mdUrl, 'direct-md', probeLog);
}

// ═══════════════════════════════════════════════════════════════════════
// URL helpers
// ═══════════════════════════════════════════════════════════════════════

/** Resolve a potentially relative URL against a base URL */
function resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    try {
        return new URL(url, baseUrl).href;
    } catch {
        return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
    }
}

/** Normalize a URL for matching (lowercase domain, strip trailing slash) */
function normalizeUrlForMatching(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
    } catch {
        return url.replace(/\/$/, '').toLowerCase();
    }
}

/**
 * Generate walk-up candidates for a filename (Lensy heuristic, cap at 3 levels).
 *
 * Example: targetUrl=/docs/guides/api/page, filename=llms.txt
 *   → /docs/guides/api/llms.txt, /docs/guides/llms.txt, /docs/llms.txt
 */
function generateWalkUpCandidates(targetUrl: string, baseUrl: string, filename: string): string[] {
    try {
        const targetPath = new URL(targetUrl).pathname;
        const segments = targetPath.split('/').filter(Boolean);

        // We need at least 2 segments to walk up (e.g., /docs/page → try /docs/llms.txt)
        if (segments.length < 2) return [];

        const candidates: string[] = [];
        // Walk up from the parent of the target page, cap at 3 levels
        // Don't include root (that's already in the main candidate list)
        for (let i = segments.length - 1; i >= 1 && candidates.length < 3; i--) {
            const parentPath = '/' + segments.slice(0, i).join('/');
            const candidateUrl = `${baseUrl}${parentPath}/${filename}`;
            candidates.push(candidateUrl);
        }

        return candidates;
    } catch {
        return [];
    }
}

/**
 * Derive docs subpath from the target URL.
 * E.g., https://docs.example.com/docs/guides/api → /docs
 */
function deriveDocsSubpath(targetUrl: string, baseUrl: string): string | null {
    try {
        const path = new URL(targetUrl).pathname;
        const segments = path.split('/').filter(Boolean);
        if (segments.length > 0 && DOCS_PATH_SEGMENTS.has(segments[0].toLowerCase())) {
            return `/${segments[0]}`;
        }
    } catch { }
    return null;
}

/**
 * Determine how a probe found its target (for the method field).
 */
function determineProbeMethod(foundUrl: string, signals: HarvestedSignals): string {
    if (signals.llmsTxtHintUrls.includes(foundUrl)) return 'link-header';
    if (foundUrl.includes('.well-known')) return 'well-known';
    if (signals.docsSubpath && foundUrl.includes(signals.docsSubpath)) return 'subpath-probe';
    if (foundUrl.endsWith('/llms.txt') || foundUrl.endsWith('/llms-full.txt')) return 'direct-fetch';
    return 'walk-up-probe';
}

// ═══════════════════════════════════════════════════════════════════════
// robots.txt parsing
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse robots.txt for AI crawler access status.
 */
function parseRobotsTxtCrawlers(robotsTxt: string | null): { blocked: string[]; allowed: string[] } {
    const blocked: string[] = [];
    const allowed: string[] = [];

    if (!robotsTxt) {
        // No robots.txt = all allowed by default
        return { blocked, allowed: [...AI_CRAWLERS] };
    }

    for (const crawler of AI_CRAWLERS) {
        const status = parseSingleCrawlerStatus(robotsTxt, crawler);
        if (status === 'blocked') {
            blocked.push(crawler);
        } else {
            allowed.push(crawler);
        }
    }

    return { blocked, allowed };
}

/**
 * Parse robots.txt status for a single crawler.
 * Handles grouped User-agent blocks (multiple UAs sharing one rule set).
 * Checks both specific user-agent block and wildcard (*) block.
 */
function parseSingleCrawlerStatus(robotsTxt: string, userAgent: string): 'allowed' | 'blocked' | 'not-mentioned' {
    // Parse robots.txt into blocks: each block has a set of user-agents + rules
    const blocks = parseRobotsTxtBlocks(robotsTxt);

    // 1. Check blocks that specifically name this user-agent
    for (const block of blocks) {
        if (block.userAgents.includes(userAgent)) {
            if (block.disallowAll && !block.hasAllow) return 'blocked';
            if (block.hasAllow) return 'allowed';
            // Mentioned with no rules = default allow
            return 'allowed';
        }
    }

    // 2. Fall back to wildcard (*) block
    for (const block of blocks) {
        if (block.userAgents.includes('*')) {
            if (block.disallowAll && !block.hasAllow) return 'blocked';
            if (block.hasAllow) return 'allowed';
        }
    }

    return 'not-mentioned';
}

interface RobotsTxtBlock {
    userAgents: string[];
    hasAllow: boolean;
    disallowAll: boolean;  // Has "Disallow: /"
}

/**
 * Parse robots.txt into structured blocks.
 * Handles grouped User-agent lines (multiple UAs before first rule).
 */
function parseRobotsTxtBlocks(robotsTxt: string): RobotsTxtBlock[] {
    const lines = robotsTxt.split('\n');
    const blocks: RobotsTxtBlock[] = [];
    let currentBlock: RobotsTxtBlock | null = null;
    let collectingUAs = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip comments and empty lines between blocks
        if (trimmed === '' || trimmed.startsWith('#')) {
            // Empty line ends UA collection but not the block
            if (currentBlock && collectingUAs) {
                collectingUAs = false;
            }
            continue;
        }

        if (trimmed.toLowerCase().startsWith('user-agent:')) {
            const ua = trimmed.substring('user-agent:'.length).trim();
            if (collectingUAs && currentBlock) {
                // Another UA in the same group
                currentBlock.userAgents.push(ua);
            } else {
                // Start a new block
                if (currentBlock) blocks.push(currentBlock);
                currentBlock = { userAgents: [ua], hasAllow: false, disallowAll: false };
                collectingUAs = true;
            }
        } else if (currentBlock) {
            collectingUAs = false; // First non-UA line ends UA collection
            if (trimmed.toLowerCase().startsWith('allow:')) {
                const path = trimmed.substring('allow:'.length).trim();
                if (path === '/' || path.length > 0) {
                    currentBlock.hasAllow = true;
                }
            } else if (trimmed.toLowerCase().startsWith('disallow:')) {
                const path = trimmed.substring('disallow:'.length).trim();
                if (path === '') {
                    currentBlock.hasAllow = true; // Empty Disallow = allow all
                } else if (path === '/') {
                    currentBlock.disallowAll = true;
                }
            }
        }
    }

    if (currentBlock) blocks.push(currentBlock);
    return blocks;
}

// ═══════════════════════════════════════════════════════════════════════
// Test exports — internal helpers exposed for unit testing
// ═══════════════════════════════════════════════════════════════════════

export const _testing = {
    parseRobotsTxtBlocks,
    parseSingleCrawlerStatus,
    parseRobotsTxtCrawlers,
    generateWalkUpCandidates,
    resolveUrl,
    normalizeUrlForMatching,
    deriveDocsSubpath,
    extractOpenApiSpecs,
};
