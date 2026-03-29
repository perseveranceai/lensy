import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { writeSessionArtifact } from '../shared/s3-helpers';
import { invokeBedrockForJson } from '../shared/bedrock-helpers';
import { URL } from 'url';
import { createProgressHelper } from './publish-progress';

/**
 * Tool: Check AI Search Discoverability
 *
 * Answers: "Can AI search engines actually find and cite this page?"
 *
 * 1. Fetches page content (MD-first: llms.txt → .md alternate → HTML fallback)
 * 2. Generates 6 search queries via Haiku LLM (with template fallback)
 * 3. Sends queries to Perplexity Sonar
 * 4. Checks if the target URL appears in citations
 * 5. Returns per-query results with citation status
 */

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const HAIKU_MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

// ── Browser User-Agent for page fetching (hybrid Chrome UA — avoids JS shell responses from CDNs) ──
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (+https://perseveranceai.com/bot)';
const FETCH_HEADERS = {
    'User-Agent': BROWSER_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

export interface AIDiscoverabilityResult {
    queries: string[];
    /** Intent tier for each query: high (tech-stack specific), mid (technology + problem), low (generic problem) */
    queryTypes: Array<'high' | 'mid' | 'low'>;
    engines: {
        perplexity?: EngineResult;
    };
    overallDiscoverability: 'high' | 'partial' | 'low' | 'not-found';
    recommendations: Array<{ priority: string; issue: string; fix: string }>;
}

interface EngineResult {
    available: boolean;
    results: Array<{
        query: string;
        cited: boolean;
        totalCitations: number;
        citedUrl?: string;
        /** Domains that WERE cited instead when target was NOT found — competitive intel */
        competingDomains?: string[];
    }>;
    foundRate: number;
}

export const checkAIDiscoverabilityTool = tool(
    async (input): Promise<string> => {
        console.log('check_ai_discoverability: Testing discoverability for:', input.url);

        try {
            const progress = createProgressHelper(input.sessionId);
            await progress.info('Generating search queries to test AI discoverability...');

            const results = await checkAIDiscoverability(input.url, input.sessionId, progress, input.prefetchedHtml);

            // Store results in S3
            await writeSessionArtifact(input.sessionId, 'ai-discoverability-results.json', results);

            const engines = Object.entries(results.engines)
                .filter(([, e]) => e?.available)
                .map(([name, e]) => `${name}: cited in ${Math.round((e!.foundRate) * 100)}% of queries`)
                .join(', ');

            // Publish category result for async card loading
            await progress.categoryResult('aiDiscoverability', results,
                `AI discoverability: ${results.overallDiscoverability}` +
                (engines ? ` (${engines})` : '')
            );

            return JSON.stringify({
                success: true,
                queriesGenerated: results.queries.length,
                overallDiscoverability: results.overallDiscoverability,
                perplexityAvailable: results.engines.perplexity?.available || false,
                perplexityFoundRate: results.engines.perplexity?.foundRate,
                recommendationCount: results.recommendations.length,
                message: `AI discoverability: ${results.overallDiscoverability}`
            });

        } catch (error) {
            console.error('AI discoverability check failed:', error);
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    },
    {
        name: 'check_ai_discoverability',
        description: 'Tests if AI search engines (Perplexity, Brave) can actually find and cite this page. Generates search queries from page content, sends them to AI search APIs, and checks if the target URL appears in results. Returns per-engine, per-query results with rank position.',
        schema: z.object({
            url: z.string().describe('The URL to test discoverability for'),
            sessionId: z.string().describe('The analysis session ID'),
            prefetchedHtml: z.string().optional().describe('Pre-fetched HTML content of the target URL. If provided, skips the initial page fetch.'),
        })
    }
);

// ── Main Function ────────────────────────────────────────────────────────

async function checkAIDiscoverability(
    targetUrl: string,
    sessionId: string,
    progress: any,
    prefetchedHtml?: string
): Promise<AIDiscoverabilityResult> {
    const domain = new URL(targetUrl).hostname;
    const recommendations: AIDiscoverabilityResult['recommendations'] = [];

    // Step 1: Get page content (MD-first: markdown alternate → .md URL → HTML fallback)
    const pageInfo = await fetchPageInfo(targetUrl, prefetchedHtml);
    if (!pageInfo.title && !pageInfo.h1 && !pageInfo.metaDescription) {
        return {
            queries: [],
            queryTypes: [],
            engines: {},
            overallDiscoverability: 'not-found',
            recommendations: [{
                priority: 'high',
                issue: 'Could not extract page content for query generation — page may be JS-rendered or inaccessible.',
                fix: 'Ensure the page returns HTML content with title, H1, and meta description tags.',
            }],
        };
    }

    // Step 2: Generate queries via Haiku LLM (with template fallback)
    // Haiku adds ~3s but this entire check runs in parallel with AI readiness (~5-7s),
    // so the LLM call is hidden within the pipeline-level parallelism.
    const generated = await generateSearchQueriesWithLLM(pageInfo, domain);
    console.log('check_ai_discoverability: Generated queries:', generated);

    if (generated.queries.length === 0) {
        return {
            queries: [],
            queryTypes: [],
            engines: {},
            overallDiscoverability: 'not-found',
            recommendations: [{
                priority: 'medium',
                issue: 'Could not generate search queries from page content.',
                fix: 'Ensure the page has descriptive title, headings, and meta description.',
            }],
        };
    }

    const { queries, queryTypes } = generated;

    // Step 3: Query search engines in parallel
    await progress.info(`Testing ${queries.length} queries (high→low intent) across AI search engines...`);

    const perplexityResult = PERPLEXITY_API_KEY
        ? await queryPerplexity(queries, targetUrl, domain)
        : null;

    const engines: AIDiscoverabilityResult['engines'] = {};
    if (perplexityResult) engines.perplexity = perplexityResult;

    // Step 4: Calculate overall discoverability
    const availableEngines = Object.values(engines).filter(e => e?.available);
    let overallDiscoverability: AIDiscoverabilityResult['overallDiscoverability'] = 'not-found';

    if (availableEngines.length === 0) {
        overallDiscoverability = 'not-found';
        recommendations.push({
            priority: 'medium',
            issue: 'No AI search engine API keys configured — cannot test discoverability.',
            fix: 'Configure PERPLEXITY_API_KEY environment variable.',
        });
    } else {
        const avgFoundRate = availableEngines.reduce((sum, e) => sum + (e?.foundRate || 0), 0) / availableEngines.length;

        if (avgFoundRate >= 0.6) overallDiscoverability = 'high';
        else if (avgFoundRate >= 0.3) overallDiscoverability = 'partial';
        else if (avgFoundRate > 0) overallDiscoverability = 'low';
        else overallDiscoverability = 'not-found';

        if (overallDiscoverability === 'not-found') {
            recommendations.push({
                priority: 'high',
                issue: 'Your page was not cited by Perplexity for any of the organic queries tested.',
                fix: 'Improve your page\'s AI readiness: add llms.txt, structured data, and ensure content is indexable. Check the Bot Access and Discoverability categories for specific actions.',
            });
        } else if (overallDiscoverability === 'low') {
            recommendations.push({
                priority: 'high',
                issue: 'Your page was rarely cited by Perplexity — it may not be well-indexed for AI search.',
                fix: 'Ensure AI bots are allowed in robots.txt, add structured data, and submit your sitemap to search engines.',
            });
        } else if (overallDiscoverability === 'partial') {
            recommendations.push({
                priority: 'medium',
                issue: 'Your page is partially discoverable — cited by Perplexity in some queries but not all.',
                fix: 'Improve content specificity, add more structured data, and ensure comprehensive headings.',
            });
        }
    }

    return { queries, queryTypes, engines, overallDiscoverability, recommendations };
}

// ── Page Info Extraction (MD-first) ──────────────────────────────────────

interface PageInfo {
    title: string;
    h1: string;
    metaDescription: string;
    /** Cleaned content excerpt for LLM query generation (~1.5k chars) */
    contentExcerpt: string;
    /** Whether content came from markdown source (cleaner for LLM) */
    fromMarkdown: boolean;
}

async function fetchPageInfo(url: string, prefetchedHtml?: string): Promise<PageInfo> {
    try {
        let html: string;
        if (prefetchedHtml) {
            console.log(`[PageInfo] Using prefetched HTML (${prefetchedHtml.length} bytes)`);
            html = prefetchedHtml;
        } else {
            console.log(`[PageInfo] No prefetched HTML, fetching ${url} directly`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
            clearTimeout(timeoutId);

            if (!res.ok) return { title: '', h1: '', metaDescription: '', contentExcerpt: '', fromMarkdown: false };

            html = await res.text();
        }

        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);

        const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
        const h1 = h1Match?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
        const metaDescription = metaDescMatch?.[1]?.trim() || '';

        // Try MD-first: check for markdown alternate link or .md URL
        const mdContent = await tryFetchMarkdown(url, html);
        if (mdContent) {
            console.log(`[PageInfo] Using markdown source for ${url} (${mdContent.length} chars)`);
            const excerpt = trimMarkdownForLLM(mdContent);
            return { title, h1, metaDescription, contentExcerpt: excerpt, fromMarkdown: true };
        }

        // Fallback: heading-aware HTML → structured text (no library needed)
        const structuredText = htmlToStructuredText(html);

        return { title, h1, metaDescription, contentExcerpt: structuredText.substring(0, 1500), fromMarkdown: false };
    } catch (e) {
        console.warn('Failed to fetch page info:', e);
        return { title: '', h1: '', metaDescription: '', contentExcerpt: '', fromMarkdown: false };
    }
}

/**
 * Heading-aware HTML → structured text conversion.
 * Preserves section structure (h1→#, h2→##, h3→###) and paragraph breaks
 * without requiring an HTML→MD library like Turndown.
 * Gives Haiku much clearer signals about page topics and features.
 */
function htmlToStructuredText(html: string): string {
    return html
        // Remove non-content elements
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        // Convert headings to markdown-style markers
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
        .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n')
        // Convert paragraph and line breaks to newlines
        .replace(/<\/p>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        // Convert list items to bullet points
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
        // Strip remaining tags
        .replace(/<[^>]+>/g, '')
        // Clean up entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // Collapse excessive whitespace but preserve structure
        .replace(/[ \t]+/g, ' ')
        .replace(/\n /g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Try to fetch a markdown version of the page.
 * Only tries if HTML contains an explicit <link rel="alternate" type="text/markdown">.
 * Skips the {url}.md heuristic to avoid wasted 1-3s on 404s/timeouts.
 */
async function tryFetchMarkdown(url: string, html: string): Promise<string | null> {
    // Only fetch MD if the page explicitly declares a markdown alternate
    const linkMatch = html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*type=["']text\/markdown["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);

    if (!linkMatch) return null;

    const baseUrl = `${new URL(url).protocol}//${new URL(url).hostname}`;
    const mdUrl = linkMatch[1].startsWith('http') ? linkMatch[1] : `${baseUrl}${linkMatch[1].startsWith('/') ? '' : '/'}${linkMatch[1]}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(mdUrl, { signal: controller.signal, headers: { 'User-Agent': BROWSER_UA } });
        clearTimeout(timeoutId);
        if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('html')) {
                const text = await res.text();
                if (text.length > 100 && !text.startsWith('<!DOCTYPE')) {
                    return text;
                }
            }
        }
    } catch { /* timeout or network error — skip */ }

    return null;
}

/**
 * Trim markdown content for LLM input: remove nav, large code blocks, images, links.
 * Target: ~1.5k chars of clean content.
 */
function trimMarkdownForLLM(md: string): string {
    return md
        // Remove large code blocks (>3 lines)
        .replace(/```[\s\S]{200,}?```/g, '[code block]')
        // Remove image references
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        // Remove link URLs but keep text
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        // Remove HTML tags that might be in MD
        .replace(/<[^>]+>/g, '')
        // Collapse whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .substring(0, 1500);
}

// ── Query Generation (Haiku LLM + Template Fallback) ─────────────────────

interface GeneratedQueries {
    queries: string[];
    queryTypes: Array<'high' | 'mid' | 'low'>;
}

const QUERY_GEN_SYSTEM = `You generate realistic search queries that developers type into AI assistants (Perplexity, ChatGPT, Claude). Return JSON only, no explanation.`;

function buildQueryGenPrompt(pageInfo: PageInfo, product: string, domain: string): string {
    return `Generate 5 search queries for this documentation page across 3 intent tiers. Research shows developers evolve from generic problem queries to technology-specific ones.

## Page metadata
- Topic: ${pageInfo.h1 || pageInfo.title}
- Description: ${pageInfo.metaDescription}

## Content excerpt
${pageInfo.contentExcerpt}

## Output format
Return exactly this JSON structure:
{"high":["q1"],"mid":["q2","q3"],"low":["q4","q5"]}

## Intent tiers
- **high** (1 query): MUST include the product/brand name "${product || domain}" + specific task from the page. Example: "how to configure CDN in Solodev CMS". This simulates a developer who already knows the product and is searching for a specific task.
- **mid** (2 queries): Include the technology category (e.g., "javascript", "REST API", "database") + the problem, but NO product/brand name. Use tech stack names from the content (e.g., "React", "PostgreSQL").
- **low** (2 queries): Pure generic problem statement — no technology or product names at all. A developer who doesn't even know what stack to use.

## Rules
- HIGH intent MUST include "${product || domain}" — this tests if AI cites this product when someone searches for it by name
- MID and LOW intent must NOT mention "${product}", "${domain}", or any brand/vendor name
- Simulate real developer questions: "how do I...", "best way to...", "why does X not work..."
- Vary intent: how-to, troubleshooting, comparison, best-practice
- 5-15 words each`;
}

/**
 * Generate queries via Haiku LLM, with template fallback on failure.
 * Haiku produces more realistic, varied queries (troubleshooting, comparisons)
 * that templates can't generate.
 */
async function generateSearchQueriesWithLLM(pageInfo: PageInfo, domain: string): Promise<GeneratedQueries> {
    // Extract product/brand name from title separator (e.g., "Backup | Solodev CMS" → "Solodev CMS")
    const titleParts = (pageInfo.title || '').split(/[|\-–—]/);
    let product = titleParts.length > 1 ? titleParts[titleParts.length - 1].trim() : '';
    // Fallback: extract brand from domain (e.g., "cms.solodev.net" → "Solodev", "developer.wordpress.com" → "WordPress")
    if (!product && domain) {
        const domainParts = domain.replace(/^(www|docs|developer|dev|cms|api|help|support|learn|blog)\./, '').split('.')[0];
        product = domainParts.charAt(0).toUpperCase() + domainParts.slice(1);
    }
    const domainHint = domain ? ` (${domain})` : '';

    try {
        const startTime = Date.now();
        const prompt = buildQueryGenPrompt(pageInfo, product, domain);

        const result = await invokeBedrockForJson<{
            high?: string[];
            mid?: string[];
            low?: string[];
            context_free?: string[]; // backward compat
        }>(prompt, {
            modelId: HAIKU_MODEL_ID,
            maxTokens: 400,
            temperature: 0.3,
            systemPrompt: QUERY_GEN_SYSTEM,
        });

        const high = (result.high || []).filter(q => q && q.length > 5).slice(0, 1);
        const mid = (result.mid || []).filter(q => q && q.length > 5).slice(0, 2);
        const low = (result.low || result.context_free || []).filter(q => q && q.length > 5).slice(0, 2);

        const queries = [...high, ...mid, ...low];
        const queryTypes: Array<'high' | 'mid' | 'low'> = [
            ...high.map(() => 'high' as const),
            ...mid.map(() => 'mid' as const),
            ...low.map(() => 'low' as const),
        ];

        console.log(`[QueryGen] Haiku LLM queries in ${Date.now() - startTime}ms — high: ${JSON.stringify(high)}, mid: ${JSON.stringify(mid)}, low: ${JSON.stringify(low)}`);

        if (queries.length >= 3) {
            return { queries, queryTypes };
        }

        // Not enough queries from LLM — fall through to template
        console.warn('[QueryGen] Haiku returned insufficient queries, falling back to templates');
    } catch (err) {
        console.warn('[QueryGen] Haiku LLM failed, falling back to templates:', err);
    }

    // Template fallback
    return generateTemplateQueries(pageInfo, domain);
}

/**
 * Template-based query generation — instant fallback if Haiku fails.
 */
function generateTemplateQueries(pageInfo: PageInfo, domain?: string): GeneratedQueries {
    const titleParts = (pageInfo.title || '').split(/[|\-–—]/);
    const product = titleParts.length > 1 ? titleParts[titleParts.length - 1].trim() : '';
    const topic = pageInfo.h1 || titleParts[0]?.trim() || '';
    const topicLower = topic.toLowerCase();

    const metaWords = (pageInfo.metaDescription || '')
        .replace(/[.!?,;:]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);
    const metaPhrase = metaWords.slice(0, 5).join(' ');

    const domainBrand = (domain || '').replace(/^(www|dev|docs|api)\./, '').split('.')[0]?.toLowerCase() || '';
    const containsBrand = (text: string) => {
        const lower = text.toLowerCase();
        return (product && lower.includes(product.toLowerCase())) ||
               (domainBrand && domainBrand.length > 2 && lower.includes(domainBrand));
    };

    const stripBrand = (text: string) =>
        text.replace(new RegExp(domainBrand, 'gi'), '').replace(new RegExp(product, 'gi'), '').replace(/\s+/g, ' ').trim();

    // High intent: topic as-is (best we can do without LLM tech detection)
    const high: string[] = [];
    if (topicLower && !containsBrand(topicLower)) {
        high.push(topicLower);
    } else if (topicLower) {
        const cleaned = stripBrand(topicLower);
        if (cleaned.length > 5) high.push(cleaned);
    }

    // Mid intent: how-to + topic
    const mid: string[] = [];
    const midTopic = containsBrand(topicLower) ? stripBrand(topicLower) : topicLower;
    if (midTopic.length > 5) mid.push(`how to ${midTopic}`);
    if (metaPhrase && !containsBrand(metaPhrase) && metaPhrase.length > 5) {
        mid.push(metaPhrase);
    }

    // Low intent: generic problem
    const low: string[] = [];
    const genericTopic = containsBrand(topicLower) ? stripBrand(topicLower) : topicLower;
    if (genericTopic.length > 5) {
        low.push(`${genericTopic} best practices`);
        low.push(`${genericTopic} not working`);
    }

    const queries = [...high.slice(0, 1), ...mid.slice(0, 2), ...low.slice(0, 2)];
    const queryTypes: Array<'high' | 'mid' | 'low'> = [
        ...high.slice(0, 1).map(() => 'high' as const),
        ...mid.slice(0, 2).map(() => 'mid' as const),
        ...low.slice(0, 2).map(() => 'low' as const),
    ];

    console.log(`[QueryGen] Template fallback — high: ${JSON.stringify(high.slice(0, 1))}, mid: ${JSON.stringify(mid.slice(0, 2))}, low: ${JSON.stringify(low.slice(0, 2))}`);

    return { queries, queryTypes };
}

// ── Perplexity Sonar API ─────────────────────────────────────────────────

async function queryPerplexity(queries: string[], targetUrl: string, domain: string): Promise<EngineResult> {
    // Run all queries in parallel for ~5x speedup (6 sequential @ 3-6s → 1 parallel batch)
    const results = await Promise.all(
        queries.map(async (query): Promise<EngineResult['results'][0]> => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);

                const response = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'sonar',
                        messages: [
                            { role: 'system', content: 'Search the web and ground your answer in multiple distinct sources. Include all citations you used. Treat capitalized product names as proper nouns referring to specific services or tools.' },
                            { role: 'user', content: query },
                        ],
                        search_context_size: 'high',
                    }),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(`Perplexity API error for query "${query}": ${response.status}`);
                    return { query, cited: false, totalCitations: 0 };
                }

                const data = await response.json() as {
                    citations?: string[];
                    search_results?: Array<{ url: string }>;
                };

                const citations = data.citations || [];
                const totalCitations = citations.length;
                console.log(`[Perplexity] Query: "${query}" → ${totalCitations} citations:`, JSON.stringify(citations));

                // Check if target URL or domain appears in citations
                // Match root domain (gitbook.com) only when the target has a docs-like subdomain
                // (docs.gitbook.com, learn.microsoft.com) — not for developer.amazon.com
                const useRootMatch = hasDocsSubdomain(domain);
                const rootDomain = useRootMatch ? getRootDomain(domain) : null;
                const matchIndex = citations.findIndex(url =>
                    url.includes(domain) || (rootDomain && url.includes(rootDomain)) || normalizeUrl(url) === normalizeUrl(targetUrl)
                );

                if (matchIndex >= 0) {
                    return {
                        query,
                        cited: true,
                        totalCitations,
                        citedUrl: citations[matchIndex],
                    };
                } else {
                    // Extract competing domains — who gets cited instead of you
                    const competingDomains = extractCompetingDomains(citations, domain);
                    return { query, cited: false, totalCitations, competingDomains };
                }
            } catch (e) {
                console.warn(`Perplexity query failed for "${query}":`, e);
                return { query, cited: false, totalCitations: 0 };
            }
        })
    );

    const citedCount = results.filter(r => r.cited).length;
    return {
        available: true,
        results,
        foundRate: queries.length > 0 ? citedCount / queries.length : 0,
    };
}

/**
 * Extract unique competing domains from citations, excluding the target domain.
 * Returns top 3 most relevant domains (deduped, cleaned).
 */
function extractCompetingDomains(citations: string[], targetDomain: string): string[] {
    const domains = new Set<string>();
    const cleanTarget = targetDomain.replace(/^www\./, '');
    const useRootMatch = hasDocsSubdomain(cleanTarget);
    const rootTarget = useRootMatch ? getRootDomain(cleanTarget) : null;
    for (const url of citations) {
        try {
            const hostname = new URL(url).hostname.replace(/^www\./, '');
            // Skip the target domain (and root domain siblings if docs-like subdomain)
            if (hostname.includes(cleanTarget) ||
                (rootTarget && hostname.includes(rootTarget)) ||
                ['google.com', 'youtube.com', 'twitter.com', 'x.com', 'facebook.com'].includes(hostname)) {
                continue;
            }
            domains.add(hostname);
        } catch { /* skip malformed URLs */ }
    }
    return Array.from(domains).slice(0, 3);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Check if a hostname's subdomain prefix indicates a documentation site.
 * e.g. docs.gitbook.com → true, learn.microsoft.com → true, developer.amazon.com → false
 * Only when the subdomain is docs-like should we match citations against the root domain.
 */
const DOCS_SUBDOMAINS = ['docs', 'doc', 'learn', 'guide', 'guides', 'reference', 'api', 'wiki', 'help', 'support', 'kb', 'knowledge', 'manual', 'handbook', 'tutorial', 'tutorials', 'getting-started'];
function hasDocsSubdomain(hostname: string): boolean {
    const clean = hostname.replace(/^www\./, '');
    const root = getRootDomain(clean);
    if (clean === root) return false; // no subdomain
    const prefix = clean.slice(0, clean.length - root.length - 1); // e.g. "docs" from "docs.gitbook.com"
    return DOCS_SUBDOMAINS.includes(prefix.toLowerCase());
}

/**
 * Extract the root (registrable) domain from a hostname.
 * e.g. docs.gitbook.com → gitbook.com, learn.microsoft.com → microsoft.com
 * Handles common multi-part TLDs like .co.uk, .com.au, etc.
 */
function getRootDomain(hostname: string): string {
    const clean = hostname.replace(/^www\./, '');
    const parts = clean.split('.');
    // Multi-part TLDs: .co.uk, .com.au, .co.jp, .org.uk, etc.
    const multiPartTlds = ['co.uk', 'com.au', 'co.jp', 'org.uk', 'com.br', 'co.in', 'co.nz'];
    const lastTwo = parts.slice(-2).join('.');
    if (multiPartTlds.includes(lastTwo) && parts.length > 2) {
        return parts.slice(-3).join('.');
    }
    return parts.length > 2 ? parts.slice(-2).join('.') : clean;
}

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        // Remove trailing slash, www prefix, protocol
        return parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
    } catch {
        return url;
    }
}
