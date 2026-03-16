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
 * 3. Sends queries to Perplexity Sonar and Brave Web Search in parallel
 * 4. Checks if the target URL appears in citations/results
 * 5. Returns per-engine, per-query results with rank
 */

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
const HAIKU_MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

export interface AIDiscoverabilityResult {
    queries: string[];
    /** Which queries are context-aware (include product/domain name) vs context-free (generic) */
    queryTypes: Array<'context-aware' | 'context-free'>;
    engines: {
        perplexity?: EngineResult;
        brave?: EngineResult;
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

            const results = await checkAIDiscoverability(input.url, input.sessionId, progress);

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
                braveAvailable: results.engines.brave?.available || false,
                perplexityFoundRate: results.engines.perplexity?.foundRate,
                braveFoundRate: results.engines.brave?.foundRate,
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
        })
    }
);

// ── Main Function ────────────────────────────────────────────────────────

async function checkAIDiscoverability(
    targetUrl: string,
    sessionId: string,
    progress: any
): Promise<AIDiscoverabilityResult> {
    const domain = new URL(targetUrl).hostname;
    const recommendations: AIDiscoverabilityResult['recommendations'] = [];

    // Step 1: Get page content (MD-first: markdown alternate → .md URL → HTML fallback)
    const pageInfo = await fetchPageInfo(targetUrl);
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
    const awareCount = queryTypes.filter(t => t === 'context-aware').length;
    const freeCount = queryTypes.filter(t => t === 'context-free').length;
    await progress.info(`Testing ${queries.length} queries (${awareCount} with context, ${freeCount} generic) across AI search engines...`);

    const [perplexityResult, braveResult] = await Promise.all([
        PERPLEXITY_API_KEY ? queryPerplexity(queries, targetUrl, domain) : null,
        BRAVE_API_KEY ? queryBrave(queries, targetUrl, domain) : null,
    ]);

    const engines: AIDiscoverabilityResult['engines'] = {};
    if (perplexityResult) engines.perplexity = perplexityResult;
    if (braveResult) engines.brave = braveResult;

    // Step 4: Calculate overall discoverability
    const availableEngines = Object.values(engines).filter(e => e?.available);
    let overallDiscoverability: AIDiscoverabilityResult['overallDiscoverability'] = 'not-found';

    if (availableEngines.length === 0) {
        overallDiscoverability = 'not-found';
        recommendations.push({
            priority: 'medium',
            issue: 'No AI search engine API keys configured — cannot test discoverability.',
            fix: 'Configure PERPLEXITY_API_KEY and/or BRAVE_API_KEY environment variables.',
        });
    } else {
        const avgFoundRate = availableEngines.reduce((sum, e) => sum + (e?.foundRate || 0), 0) / availableEngines.length;

        if (avgFoundRate >= 0.6) overallDiscoverability = 'high';
        else if (avgFoundRate >= 0.3) overallDiscoverability = 'partial';
        else if (avgFoundRate > 0) overallDiscoverability = 'low';
        else overallDiscoverability = 'not-found';

        // Compute per-category found rates for smarter recommendations
        const perplexityResults = engines.perplexity?.results || [];
        const braveResults = engines.brave?.results || [];
        const awareIndices = queryTypes.map((t, i) => t === 'context-aware' ? i : -1).filter(i => i >= 0);
        const freeIndices = queryTypes.map((t, i) => t === 'context-free' ? i : -1).filter(i => i >= 0);

        const awareFound = awareIndices.filter(i => perplexityResults[i]?.cited || braveResults[i]?.cited).length;
        const freeFound = freeIndices.filter(i => perplexityResults[i]?.cited || braveResults[i]?.cited).length;
        const awareRate = awareIndices.length > 0 ? awareFound / awareIndices.length : 0;
        const freeRate = freeIndices.length > 0 ? freeFound / freeIndices.length : 0;

        if (overallDiscoverability === 'not-found') {
            recommendations.push({
                priority: 'high',
                issue: 'Your page was not cited by any AI search engine for any of the generated queries.',
                fix: 'Improve your page\'s AI readiness: add llms.txt, structured data, and ensure content is indexable. Check the Bot Access and Discoverability categories for specific actions.',
            });
        } else if (awareRate > 0 && freeRate === 0) {
            // Found with brand name but not generically — common pattern
            recommendations.push({
                priority: 'high',
                issue: `Your page is cited when users mention your product (${Math.round(awareRate * 100)}% cited), but is invisible for generic searches (0% cited).`,
                fix: 'To win generic search traffic, add common framework names, use cases, and comparison terms to your content. Compete on generic developer queries.',
            });
        } else if (overallDiscoverability === 'low') {
            recommendations.push({
                priority: 'high',
                issue: 'Your page was rarely cited by AI search engines — it may not be well-indexed.',
                fix: 'Ensure AI bots are allowed in robots.txt, add structured data, and submit your sitemap to search engines.',
            });
        } else if (overallDiscoverability === 'partial') {
            recommendations.push({
                priority: 'medium',
                issue: 'Your page is partially discoverable — cited in some queries but not all.',
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

async function fetchPageInfo(url: string): Promise<PageInfo> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) return { title: '', h1: '', metaDescription: '', contentExcerpt: '', fromMarkdown: false };

        const html = await res.text();

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
        const res = await fetch(mdUrl, { signal: controller.signal });
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
    queryTypes: Array<'context-aware' | 'context-free'>;
}

const QUERY_GEN_SYSTEM = `You generate realistic search queries that developers type into AI assistants (Perplexity, ChatGPT, Claude). Return JSON only, no explanation.`;

function buildQueryGenPrompt(pageInfo: PageInfo, product: string, domain: string): string {
    return `Generate 6 search queries for this documentation page.

## Page metadata
- URL: ${domain}
- Product: ${product} (${domain})
- Topic: ${pageInfo.h1 || pageInfo.title}
- Description: ${pageInfo.metaDescription}

## Content excerpt
${pageInfo.contentExcerpt}

## Output format
Return exactly this JSON structure:
{"context_aware":["q1","q2","q3"],"context_free":["q1","q2","q3"]}

Rules:
- context_aware (3): Include "${product}" in the query. Simulate a developer who knows the product.
- context_free (3): Do NOT mention "${product}", "${domain}", or any brand name. Simulate a developer discovering this organically.
- Sound like real questions: "how do I...", "why is X not working", "best way to..."
- Vary intent: how-to, troubleshooting, comparison
- 5-15 words each`;
}

/**
 * Generate queries via Haiku LLM, with template fallback on failure.
 * Haiku produces more realistic, varied queries (troubleshooting, comparisons)
 * that templates can't generate.
 */
async function generateSearchQueriesWithLLM(pageInfo: PageInfo, domain: string): Promise<GeneratedQueries> {
    const titleParts = (pageInfo.title || '').split(/[|\-–—]/);
    const product = titleParts.length > 1 ? titleParts[titleParts.length - 1].trim() : '';
    const domainHint = domain ? ` (${domain})` : '';

    try {
        const startTime = Date.now();
        const prompt = buildQueryGenPrompt(pageInfo, product, domain);

        const result = await invokeBedrockForJson<{
            context_aware?: string[];
            context_free?: string[];
        }>(prompt, {
            modelId: HAIKU_MODEL_ID,
            maxTokens: 300,
            temperature: 0.3,
            systemPrompt: QUERY_GEN_SYSTEM,
        });

        const aware = (result.context_aware || []).filter(q => q && q.length > 5).slice(0, 3);
        const free = (result.context_free || []).filter(q => q && q.length > 5).slice(0, 3);

        console.log(`[QueryGen] Haiku LLM queries in ${Date.now() - startTime}ms — aware: ${JSON.stringify(aware)}, free: ${JSON.stringify(free)}`);

        if (aware.length >= 2 && free.length >= 2) {
            // Add domain hint to context-aware queries for Perplexity disambiguation
            const awareWithHint = aware.map(q => {
                // Only add hint if product name is in the query but domain isn't
                if (product && q.includes(product) && !q.includes(domain)) {
                    return q.replace(product, `${product}${domainHint}`);
                }
                return q;
            });

            return {
                queries: [...awareWithHint, ...free],
                queryTypes: [
                    ...awareWithHint.map(() => 'context-aware' as const),
                    ...free.map(() => 'context-free' as const),
                ],
            };
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
    const domainHint = domain ? ` (${domain})` : '';
    const topic = pageInfo.h1 || titleParts[0]?.trim() || '';
    const topicLower = topic.toLowerCase();

    const metaWords = (pageInfo.metaDescription || '')
        .replace(/[.!?,;:]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);
    const metaPhrase = metaWords.slice(0, 5).join(' ');

    // Context-aware queries
    const contextAware: string[] = [];
    if (product && topic) {
        contextAware.push(`${product}${domainHint} ${topic}`);
        contextAware.push(`how to ${topicLower} in ${product}${domainHint}`);
        if (metaPhrase) {
            contextAware.push(`${product}${domainHint} ${metaPhrase}`);
        } else {
            contextAware.push(`${product}${domainHint} documentation ${topicLower}`);
        }
    } else if (topic) {
        contextAware.push(topic);
        contextAware.push(`how to ${topicLower}`);
        contextAware.push(`${topicLower} documentation`);
    }

    // Context-free queries (strip brand names)
    const domainBrand = (domain || '').replace(/^(www|dev|docs|api)\./, '').split('.')[0]?.toLowerCase() || '';
    const containsBrand = (text: string) => {
        const lower = text.toLowerCase();
        return (product && lower.includes(product.toLowerCase())) ||
               (domainBrand && domainBrand.length > 2 && lower.includes(domainBrand));
    };

    const contextFree: string[] = [];
    if (topic) {
        if (!containsBrand(topicLower)) {
            contextFree.push(topicLower);
            contextFree.push(`how to ${topicLower}`);
        } else {
            const genericTopic = topicLower.replace(new RegExp(domainBrand, 'gi'), '').replace(/\s+/g, ' ').trim();
            if (genericTopic.length > 5) {
                contextFree.push(genericTopic);
                contextFree.push(`how to ${genericTopic}`);
            }
        }
        if (metaPhrase && !containsBrand(metaPhrase)) {
            contextFree.push(metaPhrase);
        } else {
            const fallback = containsBrand(topicLower)
                ? topicLower.replace(new RegExp(domainBrand, 'gi'), '').replace(/\s+/g, ' ').trim() + ' best practices'
                : `${topicLower} best practices`;
            if (fallback.length > 5) contextFree.push(fallback);
        }
    }

    const aware = contextAware.filter(q => q.length > 5).slice(0, 3);
    const free = contextFree.filter(q => q.length > 5).slice(0, 3);

    console.log(`[QueryGen] Template fallback — aware: ${JSON.stringify(aware)}, free: ${JSON.stringify(free)}`);

    return {
        queries: [...aware, ...free],
        queryTypes: [
            ...aware.map(() => 'context-aware' as const),
            ...free.map(() => 'context-free' as const),
        ],
    };
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
                const matchIndex = citations.findIndex(url =>
                    url.includes(domain) || normalizeUrl(url) === normalizeUrl(targetUrl)
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
    for (const url of citations) {
        try {
            const hostname = new URL(url).hostname.replace(/^www\./, '');
            // Skip the target domain and generic/non-informative domains
            if (!hostname.includes(targetDomain.replace(/^www\./, '')) &&
                !['google.com', 'youtube.com', 'twitter.com', 'x.com', 'facebook.com'].includes(hostname)) {
                domains.add(hostname);
            }
        } catch { /* skip malformed URLs */ }
    }
    return Array.from(domains).slice(0, 3);
}

// ── Brave Web Search API ─────────────────────────────────────────────────

async function queryBrave(queries: string[], targetUrl: string, domain: string): Promise<EngineResult> {
    // Run all queries in parallel
    const results = await Promise.all(
        queries.map(async (query): Promise<EngineResult['results'][0]> => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const params = new URLSearchParams({ q: query, count: '10' });
                const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
                    headers: {
                        'X-Subscription-Token': BRAVE_API_KEY,
                        'Accept': 'application/json',
                    },
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(`Brave API error for query "${query}": ${response.status}`);
                    return { query, cited: false, totalCitations: 0 };
                }

                const data = await response.json() as {
                    web?: { results?: Array<{ url: string }> };
                };

                const webResults = data.web?.results || [];
                const totalCitations = webResults.length;

                const matchIndex = webResults.findIndex(r =>
                    r.url.includes(domain) || normalizeUrl(r.url) === normalizeUrl(targetUrl)
                );

                if (matchIndex >= 0) {
                    return {
                        query,
                        cited: true,
                        totalCitations,
                        citedUrl: webResults[matchIndex].url,
                    };
                } else {
                    const competingDomains = extractCompetingDomains(
                        webResults.map(r => r.url), domain
                    );
                    return { query, cited: false, totalCitations, competingDomains };
                }
            } catch (e) {
                console.warn(`Brave query failed for "${query}":`, e);
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

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        // Remove trailing slash, www prefix, protocol
        return parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
    } catch {
        return url;
    }
}
