import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { writeSessionArtifact } from '../shared/s3-helpers';
import { URL } from 'url';
import { createProgressHelper } from './publish-progress';
import { harvestSignals, executeProbes, crossReference } from './detection-engine';
import { DetectionReport } from './detection-types';

// ── Browser User-Agent for page fetching (hybrid Chrome UA — avoids JS shell responses from CDNs) ──
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (+https://perseveranceai.com/bot)';
const FETCH_HEADERS = {
    'User-Agent': BROWSER_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

// ── AI Bot Registry ─────────────────────────────────────────────────────
const AI_BOTS = [
    { name: 'GPTBot (OpenAI)', userAgent: 'GPTBot' },
    { name: 'OAI-SearchBot (OpenAI)', userAgent: 'OAI-SearchBot' },
    { name: 'ChatGPT-User (OpenAI)', userAgent: 'ChatGPT-User' },
    { name: 'ClaudeBot (Anthropic)', userAgent: 'ClaudeBot' },
    { name: 'Claude-Web (Anthropic)', userAgent: 'Claude-Web' },
    { name: 'PerplexityBot', userAgent: 'PerplexityBot' },
    { name: 'Amazonbot', userAgent: 'Amazonbot' },
    { name: 'Bingbot (Microsoft)', userAgent: 'Bingbot' },
    { name: 'Bytespider (ByteDance)', userAgent: 'Bytespider' },
    { name: 'Google-Extended', userAgent: 'Google-Extended' },
];

// ── Known Schema.org types for documentation ─────────────────────────────
const VALID_SCHEMA_TYPES = [
    'Article', 'TechArticle', 'HowTo', 'FAQPage', 'APIReference',
    'WebPage', 'WebSite', 'SoftwareApplication', 'CreativeWork',
    'LearningResource', 'Course', 'BlogPosting',
];

// ── Required fields per schema type ──────────────────────────────────────
const SCHEMA_REQUIRED_FIELDS: Record<string, string[]> = {
    Article: ['headline', 'author', 'datePublished'],
    TechArticle: ['headline', 'author', 'datePublished'],
    HowTo: ['name', 'step'],
    FAQPage: ['mainEntity'],
    BlogPosting: ['headline', 'author', 'datePublished'],
    WebPage: ['name'],
    WebSite: ['name', 'url'],
};

// ── Types ────────────────────────────────────────────────────────────────

interface BotStatus {
    name: string;
    userAgent: string;
    status: 'allowed' | 'blocked' | 'not-mentioned';
}

interface Recommendation {
    category: string;
    priority: 'high' | 'medium' | 'low' | 'best-practice';
    issue: string;
    fix: string;
    codeSnippet?: string;
}

export interface AIReadinessResult {
    categories: {
        botAccess: {
            robotsTxtFound: boolean;
            bots: BotStatus[];
            allowedCount: number;
            blockedCount: number;
        };
        discoverability: {
            llmsTxt: { found: boolean; url: string; fullContent?: string; checkedUrls?: string[] };
            llmsFullTxt: { found: boolean; url: string; checkedUrls?: string[] };
            sitemapXml: { found: boolean; url?: string; referencedInRobotsTxt: boolean };
            openGraph: { found: boolean; tags: Record<string, string> };
            canonical: { found: boolean; url?: string };
            metaRobots: { found: boolean; content?: string; blocksIndexing: boolean };
        };
        consumability: {
            markdownAvailable: {
                found: boolean;
                urls: string[];
                discoverable: boolean;
                discoveryMethod?: 'link-alternate' | 'link-header' | 'llms-txt' | 'none';
            };
            textToHtmlRatio: { ratio: number; textBytes: number; htmlBytes: number; status: 'good' | 'low' | 'very-low' };
            jsRendered: boolean;
            headingHierarchy: { h1Count: number; h2Count: number; h3Count: number; hasProperNesting: boolean; headings: string[] };
            wordCount: number;
            codeBlocks: { count: number; withLanguageHints: number; hasCode: boolean };
            pageType: 'api-reference' | 'guide' | 'general';
            internalLinkDensity: { count: number; perKWords: number; status: 'good' | 'sparse' | 'excessive' };
        };
        structuredData: {
            jsonLd: { found: boolean; types: string[]; isValidSchemaType: boolean };
            schemaCompleteness: { status: 'complete' | 'partial' | 'missing'; missingFields: string[] };
            openGraphCompleteness: { score: 'complete' | 'partial' | 'missing'; missingTags: string[] };
            breadcrumbs: { found: boolean };
        };
    };
    /** v2: Evidence-aware detection report (site-level + page-level signals) */
    detection?: DetectionReport;
    recommendations: Recommendation[];
    // Legacy fields for backward compat during rollout
    overallScore: number;
}

// ── Tool Definition ──────────────────────────────────────────────────────

export const checkAIReadinessTool = tool(
    async (input): Promise<string> => {
        console.log('check_ai_readiness: Checking domain:', input.url);

        try {
            const domain = new URL(input.url).hostname;
            const progress = createProgressHelper(input.sessionId);
            await progress.info('Analyzing AI readiness across 4 categories...');

            const results = await checkAIReadiness(domain, input.url, input.sessionId, input.llmsTxtUrl, input.prefetchedHtml, input.prefetchedHeaders);

            // Store results in S3
            await writeSessionArtifact(input.sessionId, 'ai-readiness-results.json', results);

            const { botAccess, discoverability, consumability, structuredData } = results.categories;
            await progress.success(
                `AI readiness analysis complete: ${botAccess.allowedCount}/10 bots allowed, ` +
                `${results.recommendations.length} issues found`
            );

            return JSON.stringify({
                success: true,
                botsAllowed: botAccess.allowedCount,
                botsBlocked: botAccess.blockedCount,
                hasLlmsTxt: discoverability.llmsTxt.found,
                hasLlmsFullTxt: discoverability.llmsFullTxt.found,
                hasSitemap: discoverability.sitemapXml.found,
                hasJsonLd: structuredData.jsonLd.found,
                textToHtmlRatio: consumability.textToHtmlRatio.ratio,
                jsRendered: consumability.jsRendered,
                recommendationCount: results.recommendations.length,
                message: `AI readiness: ${botAccess.allowedCount}/10 bots allowed, ${results.recommendations.length} issues found`
            });

        } catch (error) {
            console.error('AI readiness check failed:', error);
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    },
    {
        name: 'check_ai_readiness',
        description: 'Checks if the domain is AI-ready across 4 categories: Bot Access (10 AI bots), Content Discoverability (llms.txt, sitemap, OG, canonical), Content Consumability (text ratio, headings, markdown, code blocks), and Structured Data (JSON-LD, schema completeness, breadcrumbs). Returns structured pass/fail results per check with actionable recommendations.',
        schema: z.object({
            url: z.string().describe('The URL to check AI readiness for'),
            sessionId: z.string().describe('The analysis session ID'),
            llmsTxtUrl: z.string().optional().describe('User-provided llms.txt URL. If provided, check this URL directly instead of auto-discovering.'),
            prefetchedHtml: z.string().optional().describe('Pre-fetched HTML content of the target URL. If provided, skips the initial page fetch.'),
            prefetchedHeaders: z.record(z.string()).optional().describe('Pre-fetched HTTP response headers from the target URL. Passed alongside prefetchedHtml to preserve Link headers for detection.')
        })
    }
);

// ── Main Analysis Function ───────────────────────────────────────────────

async function checkAIReadiness(domain: string, targetUrl: string, sessionId: string, explicitLlmsTxtUrl?: string, prefetchedHtml?: string, prefetchedHeaders?: Record<string, string>): Promise<AIReadinessResult> {
    let baseUrl = `https://${domain}`;
    const recommendations: Recommendation[] = [];
    const progress = createProgressHelper(sessionId);

    // ── Use prefetched HTML if available, otherwise fetch target page ──
    let targetHtml = '';
    let targetHeaders: Headers | null = null;
    let targetHeadersRecord: Record<string, string> | null = null;
    if (prefetchedHtml) {
        console.log(`[AIReadiness] Using prefetched HTML (${prefetchedHtml.length} bytes)`);
        targetHtml = prefetchedHtml;
        if (prefetchedHeaders) {
            targetHeadersRecord = prefetchedHeaders;
        }
    } else {
        console.log(`[AIReadiness] No prefetched HTML, fetching ${targetUrl} directly`);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(targetUrl, { signal: controller.signal, headers: FETCH_HEADERS });
            clearTimeout(timeoutId);
            if (res.ok) {
                targetHtml = await res.text();
                targetHeaders = res.headers;
                // Convert Headers to plain Record for v2 detection engine
                targetHeadersRecord = {};
                res.headers.forEach((v, k) => { targetHeadersRecord![k] = v; });

                // ── Follow redirects: update baseUrl + targetUrl to final destination ──
                const finalUrl = res.url;
                if (finalUrl && finalUrl !== targetUrl) {
                    const finalParsed = new URL(finalUrl);
                    const newDomain = finalParsed.hostname;
                    if (newDomain !== domain) {
                        console.log(`[AIReadiness] Redirect detected: ${domain} → ${newDomain} (final URL: ${finalUrl})`);
                        baseUrl = `${finalParsed.protocol}//${newDomain}`;
                        targetUrl = finalUrl;
                    }
                }
            }
        } catch (e) {
            console.warn(`Failed to fetch target page ${targetUrl}:`, e);
        }
    }

    // ── Derive docsSubpath AFTER redirect resolution (uses correct baseUrl) ──
    const docsSubpath = deriveDocsSubpath(explicitLlmsTxtUrl, targetUrl, baseUrl);

    // ── Fetch robots.txt once (reused for bot access + sitemap ref + v2 detection) ──
    const robotsTxtUrl = `${baseUrl}/robots.txt`;
    const robotsCheck = await checkUrl(robotsTxtUrl, true);

    // ═══════════════════════════════════════════════════════════════════
    // v2 Detection Engine — 3-phase: harvest → parallel probes → cross-reference
    // Runs IN PARALLEL with existing category analysis
    // ═══════════════════════════════════════════════════════════════════
    const detectionStart = Date.now();
    console.log(`[AIReadiness v2] Starting 3-phase detection engine`);

    // Phase 1: Signal Harvest (0 HTTP calls, ~0ms)
    const signals = harvestSignals(
        targetHtml,
        targetHeadersRecord,
        robotsCheck.content || null,
        targetUrl,
        baseUrl,
    );
    console.log(`[AIReadiness v2] Phase 1 complete: ${signals.llmsTxtHintUrls.length} llms.txt hints, ${signals.blockedCrawlers.length} blocked crawlers`);

    // Phase 2 (v2 parallel probes) + existing categories run concurrently
    const [probeResults, botAccess, discoverability, consumability] = await Promise.all([
        // v2: All probes fire in parallel (~5s wall clock)
        executeProbes(baseUrl, targetUrl, signals, robotsCheck.content || null),
        // Existing Category 1: Bot Access (sync, no HTTP)
        Promise.resolve(analyzeBotAccess(robotsCheck, recommendations)),
        // Existing Category 2: Discoverability (sequential HTTP — will be replaced by v2 in future)
        analyzeDiscoverability(baseUrl, targetUrl, targetHtml, robotsCheck, explicitLlmsTxtUrl, docsSubpath, recommendations),
        // Existing Category 3: Consumability
        analyzeConsumability(targetUrl, targetHtml, targetHeaders, baseUrl, false, recommendations),
    ]);

    // Phase 3: Cross-Reference (0 HTTP calls, ~0ms)
    const detection = crossReference(signals, probeResults, targetUrl, baseUrl);
    const detectionMs = Date.now() - detectionStart;
    console.log(`[AIReadiness v2] Detection complete in ${detectionMs}ms — llms.txt: ${detection.site.llmsTxt.status}, markdown: ${detection.page.markdown.status}, page-mapped: ${detection.page.llmsTxtMapping.status}`);

    // ── Publish results to frontend (cards fill in as they arrive) ──
    // Strip fullContent from discoverability before WebSocket publish — it can be
    // hundreds of KB for large llms.txt files, exceeding API Gateway's 128KB frame limit.
    // The full data is still returned to the caller and persisted to S3 for the report.
    const discoverabilityForWs = {
        ...discoverability,
        llmsTxt: { ...discoverability.llmsTxt, fullContent: undefined },
    };
    await progress.categoryResult('botAccess', botAccess, `Bot Access: ${botAccess.allowedCount}/10 bots allowed`);
    await progress.categoryResult('discoverability', discoverabilityForWs, 'Content Discoverability analysis complete');
    await progress.categoryResult('consumability', consumability, 'Content Consumability analysis complete');

    // ── Category 4: Structured Data & Semantic Markup ────────────────
    const structuredData = analyzeStructuredData(targetHtml, recommendations);
    await progress.categoryResult('structuredData', structuredData, 'Structured Data analysis complete');

    // ── Publish v2 detection report ──
    await progress.categoryResult('detection', detection, `Evidence detection: ${detection.site.llmsTxt.status} llms.txt, ${detection.page.markdown.status} markdown`);

    return {
        categories: { botAccess, discoverability, consumability, structuredData },
        detection,
        recommendations,
        overallScore: 0, // Scoring added in generate-report
    };
}

// ── Category 1: Bot Access ───────────────────────────────────────────────

function analyzeBotAccess(
    robotsCheck: { found: boolean; content?: string },
    recommendations: Recommendation[]
): AIReadinessResult['categories']['botAccess'] {
    const bots: BotStatus[] = [];

    if (!robotsCheck.found || !robotsCheck.content) {
        // No robots.txt → all bots are "not-mentioned" (default allow)
        for (const bot of AI_BOTS) {
            bots.push({ name: bot.name, userAgent: bot.userAgent, status: 'not-mentioned' });
        }
        recommendations.push({
            category: 'Bot Access',
            priority: 'medium',
            issue: 'No robots.txt found — AI bots will crawl by default but explicit rules show intent.',
            fix: 'Create a robots.txt file with explicit AI bot rules.',
            codeSnippet: AI_BOTS.map(b => `User-agent: ${b.userAgent}\nAllow: /`).join('\n\n'),
        });
    } else {
        const content = robotsCheck.content;
        for (const bot of AI_BOTS) {
            const status = parseBotStatus(content, bot.userAgent);
            bots.push({ name: bot.name, userAgent: bot.userAgent, status });
        }

        const blocked = bots.filter(b => b.status === 'blocked');
        const notMentioned = bots.filter(b => b.status === 'not-mentioned');

        if (blocked.length > 0) {
            recommendations.push({
                category: 'Bot Access',
                priority: 'high',
                issue: `${blocked.length} AI bot(s) are blocked: ${blocked.map(b => b.name).join(', ')}`,
                fix: 'Update robots.txt to allow these AI bots if you want your content indexed by AI search engines.',
                codeSnippet: blocked.map(b => `User-agent: ${b.userAgent}\nAllow: /`).join('\n\n'),
            });
        }
        if (notMentioned.length > 0 && notMentioned.length < AI_BOTS.length) {
            recommendations.push({
                category: 'Bot Access',
                priority: 'low',
                issue: `${notMentioned.length} AI bot(s) have no explicit rules (default allow): ${notMentioned.map(b => b.userAgent).join(', ')}`,
                fix: 'Add explicit Allow rules for all AI bots to signal intent.',
                codeSnippet: notMentioned.map(b => `User-agent: ${b.userAgent}\nAllow: /`).join('\n\n'),
            });
        }
    }

    const allowedCount = bots.filter(b => b.status === 'allowed' || b.status === 'not-mentioned').length;
    const blockedCount = bots.filter(b => b.status === 'blocked').length;

    return { robotsTxtFound: robotsCheck.found, bots, allowedCount, blockedCount };
}

function parseBotStatus(robotsTxt: string, userAgent: string): 'allowed' | 'blocked' | 'not-mentioned' {
    // Parse robots.txt blocks: find the User-agent block for this bot
    const lines = robotsTxt.split('\n');
    let inBlock = false;
    let hasAllow = false;
    let hasDisallow = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().startsWith('user-agent:')) {
            const ua = trimmed.substring('user-agent:'.length).trim();
            inBlock = ua === userAgent || ua === '*';
            if (ua !== userAgent && ua !== '*') {
                // New non-matching block — if we were in a matching block, stop
                if (hasAllow || hasDisallow) break;
                inBlock = false;
            }
        } else if (inBlock) {
            if (trimmed.toLowerCase().startsWith('allow:')) {
                hasAllow = true;
            } else if (trimmed.toLowerCase().startsWith('disallow:')) {
                const path = trimmed.substring('disallow:'.length).trim();
                if (path === '') {
                    // "Disallow:" with empty path = allow everything (explicit allow-all)
                    hasAllow = true;
                } else if (path === '/') {
                    // "Disallow: /" = block everything
                    hasDisallow = true;
                }
            }
        }
    }

    // Check for specific bot mention (not just wildcard)
    const mentionsBot = robotsTxt.includes(userAgent);

    if (mentionsBot) {
        // Re-parse specifically for this bot's block
        let inSpecificBlock = false;
        let specificAllow = false;
        let specificDisallow = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.toLowerCase().startsWith('user-agent:')) {
                const ua = trimmed.substring('user-agent:'.length).trim();
                if (ua === userAgent) {
                    inSpecificBlock = true;
                } else if (inSpecificBlock) {
                    break; // End of this bot's block
                }
            } else if (inSpecificBlock) {
                if (trimmed.toLowerCase().startsWith('allow:')) {
                    specificAllow = true;
                } else if (trimmed.toLowerCase().startsWith('disallow:')) {
                    const path = trimmed.substring('disallow:'.length).trim();
                    if (path === '') {
                        // "Disallow:" with empty path = allow everything
                        specificAllow = true;
                    } else if (path.length > 0) {
                        specificDisallow = true;
                    }
                }
            }
        }

        if (specificDisallow && !specificAllow) return 'blocked';
        if (specificAllow) return 'allowed';
    }

    // Check wildcard block
    if (!mentionsBot) {
        if (hasDisallow && !hasAllow) return 'blocked';
        if (hasAllow) return 'allowed';
        return 'not-mentioned';
    }

    return 'not-mentioned';
}

// ── Category 2: Content Discoverability ──────────────────────────────────

async function analyzeDiscoverability(
    baseUrl: string,
    targetUrl: string,
    targetHtml: string,
    robotsCheck: { found: boolean; content?: string },
    explicitLlmsTxtUrl: string | undefined,
    docsSubpath: string | null,
    recommendations: Recommendation[]
): Promise<AIReadinessResult['categories']['discoverability']> {

    // ── llms.txt ──
    const llmsTxtCandidates: string[] = [];
    if (explicitLlmsTxtUrl) {
        llmsTxtCandidates.push(explicitLlmsTxtUrl);
    } else {
        llmsTxtCandidates.push(`${baseUrl}/llms.txt`);
        if (docsSubpath) llmsTxtCandidates.push(`${baseUrl}${docsSubpath}/llms.txt`);
    }

    let llmsTxt: { found: boolean; content?: string } = { found: false };
    let llmsTxtUrl = llmsTxtCandidates[0];
    const llmsTxtCheckedUrls: string[] = [];
    for (const candidateUrl of llmsTxtCandidates) {
        llmsTxtCheckedUrls.push(candidateUrl);
        const result = await checkUrl(candidateUrl, true);
        if (result.found) {
            llmsTxt = result;
            llmsTxtUrl = candidateUrl;
            break;
        }
    }
    if (!llmsTxt.found) {
        recommendations.push({
            category: 'Discoverability',
            priority: 'high',
            issue: `No llms.txt found — checked: ${llmsTxtCheckedUrls.join(', ')}`,
            fix: 'Create an llms.txt file at your domain root listing your documentation pages.',
            codeSnippet: `# ${new URL(baseUrl).hostname}\n\n> Documentation for [Your Product]\n\n- [Getting Started](${baseUrl}/docs/getting-started): Quick start guide\n- [API Reference](${baseUrl}/docs/api): Full API documentation`,
        });
    }

    // ── llms-full.txt ──
    const llmsFullCandidates = new Set<string>();
    llmsFullCandidates.add(`${baseUrl}/llms-full.txt`);
    if (docsSubpath) llmsFullCandidates.add(`${baseUrl}${docsSubpath}/llms-full.txt`);
    if (explicitLlmsTxtUrl) {
        const siblingUrl = explicitLlmsTxtUrl.replace(/llms\.txt$/, 'llms-full.txt');
        if (siblingUrl !== explicitLlmsTxtUrl) llmsFullCandidates.add(siblingUrl);
    }

    let llmsFullTxt: { found: boolean } = { found: false };
    let llmsFullTxtUrl = `${baseUrl}/llms-full.txt`;
    const llmsFullCheckedUrls: string[] = [];
    for (const candidateUrl of llmsFullCandidates) {
        llmsFullCheckedUrls.push(candidateUrl);
        const result = await checkUrl(candidateUrl);
        if (result.found) {
            llmsFullTxt = result;
            llmsFullTxtUrl = candidateUrl;
            break;
        }
    }
    // llms-full.txt: still check but don't recommend — only useful for very large doc sites

    // ── sitemap.xml ──
    const sitemapResult = await checkSitemap(baseUrl, robotsCheck);
    if (!sitemapResult.found) {
        recommendations.push({
            category: 'Discoverability',
            priority: 'medium',
            issue: 'No sitemap.xml found — search engines and AI crawlers may miss pages.',
            fix: 'Create a sitemap.xml and reference it in robots.txt.',
            codeSnippet: `# Add to robots.txt:\nSitemap: ${baseUrl}/sitemap.xml`,
        });
    }

    // ── OpenGraph tags ──
    const ogTags = parseOpenGraphTags(targetHtml);
    const ogFound = Object.keys(ogTags).length > 0;

    // ── Canonical URL ──
    const canonicalMatch = targetHtml.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    const canonical = {
        found: !!canonicalMatch,
        url: canonicalMatch?.[1],
    };
    if (!canonical.found) {
        recommendations.push({
            category: 'Discoverability',
            priority: 'low',
            issue: 'No canonical URL tag found — AI search may index duplicate versions of this page.',
            fix: 'Add a canonical link tag to the page head.',
            codeSnippet: `<link rel="canonical" href="${targetUrl}" />`,
        });
    }

    // ── Meta robots ──
    const metaRobotsMatch = targetHtml.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i)
        || targetHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']robots["']/i);
    const metaRobotsContent = metaRobotsMatch?.[1] || '';
    const blocksIndexing = metaRobotsContent.toLowerCase().includes('noindex');
    if (blocksIndexing) {
        recommendations.push({
            category: 'Discoverability',
            priority: 'high',
            issue: 'Meta robots tag contains "noindex" — AI search engines will not index this page.',
            fix: 'Remove the noindex directive if you want this page discoverable by AI search.',
        });
    }

    return {
        llmsTxt: { found: llmsTxt.found, url: llmsTxtUrl, fullContent: llmsTxt.content, checkedUrls: llmsTxtCheckedUrls },
        llmsFullTxt: { found: llmsFullTxt.found, url: llmsFullTxtUrl, checkedUrls: llmsFullCheckedUrls },
        sitemapXml: sitemapResult,
        openGraph: { found: ogFound, tags: ogTags },
        canonical,
        metaRobots: { found: !!metaRobotsMatch, content: metaRobotsContent || undefined, blocksIndexing },
    };
}

async function checkSitemap(baseUrl: string, robotsCheck: { found: boolean; content?: string }) {
    // Check robots.txt for Sitemap: directive
    let referencedInRobotsTxt = false;
    let sitemapUrlFromRobots: string | undefined;
    if (robotsCheck.found && robotsCheck.content) {
        const match = robotsCheck.content.match(/^Sitemap:\s*(.+)$/im);
        if (match) {
            referencedInRobotsTxt = true;
            sitemapUrlFromRobots = match[1].trim();
        }
    }

    // Check sitemap.xml directly
    const sitemapUrl = sitemapUrlFromRobots || `${baseUrl}/sitemap.xml`;
    const sitemapCheck = await checkUrl(sitemapUrl);

    return {
        found: sitemapCheck.found,
        url: sitemapCheck.found ? sitemapUrl : undefined,
        referencedInRobotsTxt,
    };
}

function parseOpenGraphTags(html: string): Record<string, string> {
    const tags: Record<string, string> = {};
    const ogRegex = /<meta[^>]*property=["'](og:[^"']+)["'][^>]*content=["']([^"']*)["']/gi;
    const ogRegex2 = /<meta[^>]*content=["']([^"']*)["'][^>]*property=["'](og:[^"']+)["']/gi;

    let match;
    while ((match = ogRegex.exec(html)) !== null) {
        tags[match[1]] = match[2];
    }
    while ((match = ogRegex2.exec(html)) !== null) {
        tags[match[2]] = match[1];
    }
    return tags;
}

// ── Category 3: Content Consumability ────────────────────────────────────

async function analyzeConsumability(
    targetUrl: string,
    html: string,
    headers: Headers | null,
    baseUrl: string,
    llmsTxtFound: boolean,
    recommendations: Recommendation[]
): Promise<AIReadinessResult['categories']['consumability']> {

    // ── Text-to-HTML ratio (recommendation deferred until after markdown detection) ──
    const textToHtmlRatio = calculateTextToHtmlRatio(html);

    // ── JS rendering detection ──
    const jsRendered = detectJSRendering(html);
    if (jsRendered) {
        recommendations.push({
            category: 'Consumability',
            priority: 'high',
            issue: 'Page appears to be JavaScript-rendered (SPA) — AI bots cannot execute JS and will see empty content.',
            fix: 'Implement server-side rendering (SSR) or static site generation (SSG) so content is in the initial HTML response.',
        });
    }

    // ── Heading hierarchy ──
    const headingHierarchy = analyzeHeadings(html);
    if (headingHierarchy.h1Count === 0) {
        recommendations.push({
            category: 'Consumability',
            priority: 'medium',
            issue: 'No H1 heading found — AI bots use H1 as the primary topic signal.',
            fix: 'Add an H1 heading that clearly describes the page content.',
        });
    } else if (headingHierarchy.h1Count > 1) {
        recommendations.push({
            category: 'Consumability',
            priority: 'low',
            issue: `Multiple H1 headings found (${headingHierarchy.h1Count}) — AI bots may be confused about the primary topic.`,
            fix: 'Use a single H1 for the main topic and H2+ for subsections.',
        });
    }
    if (!headingHierarchy.hasProperNesting && headingHierarchy.headings.length > 2) {
        recommendations.push({
            category: 'Consumability',
            priority: 'low',
            issue: 'Heading hierarchy has level skips (e.g., H1 → H3) — reduces structural clarity for AI parsing.',
            fix: 'Use proper heading nesting: H1 → H2 → H3 without skipping levels.',
        });
    }

    // ── Markdown availability & discoverability ──
    const markdown = await analyzeMarkdownAvailability(html, headers, targetUrl, baseUrl, llmsTxtFound);
    if (!markdown.found) {
        recommendations.push({
            category: 'Consumability',
            priority: 'medium',
            issue: 'Markdown discovery signal missing — a <link rel="alternate" type="text/markdown"> tag helps AI coding assistants (Cursor, Copilot, Claude Code) find and fetch your markdown version.',
            fix: `Add a <link rel="alternate" type="text/markdown"> tag in your <head>. Even if you already serve .md files, AI tools need this HTML signal to discover them.`,
            codeSnippet: `<!-- Add to <head> -->\n<link rel="alternate" type="text/markdown" href="${new URL(targetUrl).pathname}.md" />`,
        });
    } else if (!markdown.discoverable) {
        recommendations.push({
            category: 'Discoverability',
            priority: 'best-practice',
            issue: 'Expose the Markdown version via rel="alternate" in the HTML head as an additional machine-readable hint. This complements llms.txt, direct Markdown URLs, and content negotiation.',
            fix: 'Add a <link rel="alternate" type="text/markdown"> tag — a standards-friendly discovery hint for tools that start from the HTML page.',
            codeSnippet: `<!-- Add to <head> -->\n<link rel="alternate" type="text/markdown" href="${markdown.urls[0] || `${new URL(targetUrl).pathname}.md`}" />`,
        });
    }

    // ── Text-to-HTML ratio (deferred: downgrade when markdown is available) ──
    if (textToHtmlRatio.status === 'very-low') {
        const hasMarkdownAlternative = markdown.found;
        recommendations.push({
            category: 'Consumability',
            priority: hasMarkdownAlternative ? 'low' : 'high',
            issue: hasMarkdownAlternative
                ? `Low text-to-HTML ratio (${(textToHtmlRatio.ratio * 100).toFixed(1)}%). Coding assistants can use the markdown version, but AI search engines (Perplexity, ChatGPT) still crawl the HTML.`
                : `Very low text-to-HTML ratio (${(textToHtmlRatio.ratio * 100).toFixed(1)}%). AI search crawlers such as PerplexityBot and GPTBot may process mostly noise (scripts, CSS, nav) when extracting your content.`,
            fix: hasMarkdownAlternative
                ? 'Coding assistants are covered by markdown. To also help AI search crawlers, reduce inline scripts/styles in the HTML.'
                : 'Reduce inline scripts/styles, minimize navigation markup, and ensure main content is prominent in the HTML.',
        });
    } else if (textToHtmlRatio.status === 'low') {
        if (!markdown.found) {
            recommendations.push({
                category: 'Consumability',
                priority: 'medium',
                issue: `Low text-to-HTML ratio (${(textToHtmlRatio.ratio * 100).toFixed(1)}%). AI search crawlers may need to strip more noise to extract your content.`,
                fix: 'Move scripts to external files, minimize inline CSS, and use semantic HTML for content.',
            });
        }
        // Skip recommendation entirely if markdown is available and ratio is only "low"
    }

    // ── Code blocks (conditional) ──
    const codeBlocks = analyzeCodeBlocks(html);
    if (codeBlocks.hasCode && codeBlocks.withLanguageHints === 0) {
        recommendations.push({
            category: 'Consumability',
            priority: markdown.found ? 'low' : 'medium',
            issue: markdown.found
                ? `${codeBlocks.count} code block(s) in HTML have no language hints. Coding assistants can use the markdown version, but AI search crawlers still parse the HTML.`
                : `${codeBlocks.count} code block(s) found but none have language hints — AI bots can't determine the programming language.`,
            fix: 'Add language class attributes to code blocks.',
            codeSnippet: `<pre><code class="language-python">print("hello")</code></pre>\n\n<!-- Or in Markdown: -->\n\`\`\`python\nprint("hello")\n\`\`\``,
        });
    }

    // ── Internal link density ──
    const internalLinkDensity = analyzeInternalLinks(html, baseUrl);
    if (internalLinkDensity.status === 'sparse' && internalLinkDensity.count < 3) {
        recommendations.push({
            category: 'Consumability',
            priority: 'low',
            issue: 'Very few internal links — AI bots use cross-references to understand content relationships.',
            fix: 'Add links to related documentation pages to help AI understand your content structure.',
        });
    }

    // Word count from clean text — strip non-content elements (nav, header, footer, sidebar)
    const cleanText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;

    // ── AI Chunking heuristics (research-backed) ──
    const h2Count = headingHierarchy.h2Count || 0;
    const avgWordsPerH2 = h2Count > 0 ? Math.round(wordCount / h2Count) : wordCount;
    if (wordCount > 1500 && h2Count < 3) {
        recommendations.push({
            category: 'Consumability',
            priority: 'high',
            issue: `This page is ${wordCount.toLocaleString()} words with only ${h2Count} H2 heading${h2Count === 1 ? '' : 's'}. AI will produce 1–2 large, mixed-topic chunks that retrieve poorly.`,
            fix: 'Split into separate task pages or add H2 headings for each major task so AI can create focused, single-topic chunks.',
        });
    } else if (h2Count > 0 && avgWordsPerH2 > 500) {
        recommendations.push({
            category: 'Consumability',
            priority: 'medium',
            issue: `Long sections detected (~${avgWordsPerH2} words per H2). AI retrieves sections as chunks — large chunks dilute semantic signal.`,
            fix: 'Add more H2 sub-sections (target ~200-400 words each) so each chunk maps to a single task or question.',
        });
    }
    if (wordCount > 0 && wordCount < 100) {
        recommendations.push({
            category: 'Consumability',
            priority: 'medium',
            issue: `Very short page (~${wordCount} words). May lack enough context for AI to answer questions from it alone.`,
            fix: 'Expand content with explanatory text, examples, and context so AI has enough material to retrieve.',
        });
    } else if (wordCount >= 100 && wordCount < 500) {
        recommendations.push({
            category: 'Consumability',
            priority: 'low',
            issue: `Short page (~${wordCount} words). AI may not have enough depth to cite this page over more comprehensive alternatives.`,
            fix: 'Consider adding more detail — examples, edge cases, or context — to make this the definitive resource on the topic.',
        });
    }
    if (h2Count > 8 && wordCount < 600) {
        recommendations.push({
            category: 'Consumability',
            priority: 'low',
            issue: `${h2Count} headings with only ${wordCount} words — AI chunks will be too thin to be useful.`,
            fix: 'Expand each section with enough content (aim for 100+ words) or consolidate related headings.',
        });
    }

    // ── Page type detection (API/SDK reference vs guide/general) ──
    const pageType = detectPageType(html, targetUrl);

    // If API/SDK reference page has no code examples, flag it
    if (pageType === 'api-reference' && !codeBlocks.hasCode) {
        recommendations.push({
            category: 'Consumability',
            priority: 'high',
            issue: 'API/SDK reference page with no code examples — research shows this reduces LLM accuracy by 3–4× (HKUST RAG study).',
            fix: 'Add working code examples for each endpoint/method. Include request/response samples, error handling, and common use cases.',
        });
    }

    return { markdownAvailable: markdown, textToHtmlRatio, jsRendered, headingHierarchy, codeBlocks, pageType, internalLinkDensity, wordCount };
}

function detectPageType(html: string, url: string): 'api-reference' | 'guide' | 'general' {
    const urlLower = url.toLowerCase();
    const htmlLower = html.toLowerCase();

    // URL-based signals
    const apiUrlPatterns = ['/api/', '/reference/', '/sdk/', '/endpoint', '/rest/', '/graphql/'];
    const hasApiUrl = apiUrlPatterns.some(p => urlLower.includes(p));

    // Content-based signals: parameter tables with technical headers
    const paramTableHeaders = /(parameter|param|argument|field|property)\s*<\/t[hd]>/gi;
    const typeHeaders = /<t[hd][^>]*>\s*(type|returns?|response|request|method|required)\s*<\/t[hd]>/gi;
    const paramTableMatches = (html.match(paramTableHeaders) || []).length;
    const typeHeaderMatches = (html.match(typeHeaders) || []).length;

    // Code inside table cells (common in API reference: parameter tables with code-formatted names)
    const codeInTd = /<td[^>]*>\s*<code/gi;
    const codeInTdCount = (html.match(codeInTd) || []).length;

    // HTTP method indicators
    const httpMethods = /\b(GET|POST|PUT|DELETE|PATCH)\s+\//g;
    const httpMethodCount = (html.match(httpMethods) || []).length;

    // Score it
    let apiScore = 0;
    if (hasApiUrl) apiScore += 3;
    if (paramTableMatches >= 2) apiScore += 2;
    if (typeHeaderMatches >= 2) apiScore += 2;
    if (codeInTdCount >= 3) apiScore += 2;
    if (httpMethodCount >= 1) apiScore += 2;

    if (apiScore >= 3) return 'api-reference';

    // Guide detection: URL signals
    const guideUrlPatterns = ['/guide', '/tutorial', '/getting-started', '/quickstart', '/how-to', '/walkthrough'];
    if (guideUrlPatterns.some(p => urlLower.includes(p))) return 'guide';

    return 'general';
}

function calculateTextToHtmlRatio(html: string): AIReadinessResult['categories']['consumability']['textToHtmlRatio'] {
    const htmlBytes = Buffer.byteLength(html, 'utf-8');
    if (htmlBytes === 0) return { ratio: 0, textBytes: 0, htmlBytes: 0, status: 'very-low' };

    // Strip tags, scripts, styles to get visible text
    const textOnly = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const textBytes = Buffer.byteLength(textOnly, 'utf-8');
    const ratio = textBytes / htmlBytes;

    let status: 'good' | 'low' | 'very-low' = 'good';
    if (ratio < 0.15) status = 'very-low';
    else if (ratio < 0.30) status = 'low';

    return { ratio, textBytes, htmlBytes, status };
}

function detectJSRendering(html: string): boolean {
    if (!html || html.length < 500) return true; // Very short HTML = likely SPA shell

    // Check for common SPA indicators
    const textOnly = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // If very little text after stripping tags, likely JS-rendered
    if (textOnly.length < 100) return true;

    // Check for common SPA root divs with no content
    const spaPatterns = [
        /<div\s+id=["'](?:root|app|__next|__nuxt)["']\s*>\s*<\/div>/i,
        /<div\s+id=["'](?:root|app|__next|__nuxt)["']\s*><\/div>/i,
    ];
    return spaPatterns.some(p => p.test(html));
}

function analyzeHeadings(html: string): AIReadinessResult['categories']['consumability']['headingHierarchy'] {
    const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
    const headings: string[] = [];
    const levels: number[] = [];
    let match;

    while ((match = headingRegex.exec(html)) !== null) {
        const level = parseInt(match[1]);
        const text = match[2].replace(/<[^>]+>/g, '').trim();
        if (text) {
            headings.push(`H${level}: ${text.substring(0, 80)}`);
            levels.push(level);
        }
    }

    const h1Count = levels.filter(l => l === 1).length;
    const h2Count = levels.filter(l => l === 2).length;
    const h3Count = levels.filter(l => l === 3).length;

    // Check proper nesting: no level skips (e.g., H1 → H3 without H2)
    let hasProperNesting = true;
    for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
            hasProperNesting = false;
            break;
        }
    }

    return { h1Count, h2Count, h3Count, hasProperNesting, headings: headings.slice(0, 20) };
}

async function analyzeMarkdownAvailability(
    html: string,
    headers: Headers | null,
    targetUrl: string,
    baseUrl: string,
    llmsTxtFound: boolean
): Promise<AIReadinessResult['categories']['consumability']['markdownAvailable']> {
    const urls: string[] = [];
    let discoverable = false;
    let discoveryMethod: 'link-alternate' | 'link-header' | 'llms-txt' | 'none' = 'none';

    // Check <link rel="alternate" type="text/markdown"> in HTML
    const linkAlternateMatch = html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*type=["']text\/markdown["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
    if (linkAlternateMatch) {
        const mdUrl = linkAlternateMatch[1].startsWith('http')
            ? linkAlternateMatch[1]
            : `${baseUrl}${linkAlternateMatch[1].startsWith('/') ? '' : '/'}${linkAlternateMatch[1]}`;
        urls.push(mdUrl);
        discoverable = true;
        discoveryMethod = 'link-alternate';
    }

    // Check HTTP Link header for markdown alternate
    if (headers) {
        const linkHeader = headers.get('link');
        if (linkHeader && linkHeader.includes('text/markdown')) {
            const linkMatch = linkHeader.match(/<([^>]+)>;\s*rel="alternate";\s*type="text\/markdown"/i);
            if (linkMatch) {
                urls.push(linkMatch[1]);
                discoverable = true;
                discoveryMethod = 'link-header';
            }
        }
    }

    // Check for .md links in HTML
    const mdLinkMatches = html.match(/href=["']([^"']*\.md)["']/gi);
    if (mdLinkMatches) {
        const extractedUrls = mdLinkMatches
            .map(m => m.match(/href=["']([^"']+)["']/)?.[1] || '')
            .filter(Boolean)
            .slice(0, 3)
            .map(u => u.startsWith('http') ? u : `${baseUrl}${u.startsWith('/') ? '' : '/'}${u}`);
        urls.push(...extractedUrls);
    }

    // Probe {targetUrl}.md directly (common convention: Mintlify, GitBook, etc.)
    if (urls.length === 0) {
        const mdProbeUrl = targetUrl.replace(/\/$/, '') + '.md';
        const mdProbe = await checkUrl(mdProbeUrl);
        if (mdProbe.found) {
            urls.push(mdProbeUrl);
        }
    }

    // If llms.txt references markdown, it's discoverable through llms.txt
    if (llmsTxtFound && !discoverable) {
        discoverable = true;
        discoveryMethod = 'llms-txt';
    }

    const found = urls.length > 0;

    return {
        found,
        urls: [...new Set(urls)],
        discoverable: discoverable || false,
        discoveryMethod: found ? discoveryMethod : undefined,
    };
}

function analyzeCodeBlocks(html: string): AIReadinessResult['categories']['consumability']['codeBlocks'] {
    // Only count <pre> blocks (real code blocks), not standalone <code> (inline formatting)
    const preBlockRegex = /<pre[^>]*>/gi;
    const preMatches = html.match(preBlockRegex) || [];
    // Also count <code> that are inside <pre> (but not standalone inline <code>)
    const preCodeRegex = /<pre[^>]*>[\s\S]*?<code[^>]*>/gi;
    const preCodeMatches = html.match(preCodeRegex) || [];
    const count = Math.max(preMatches.length, preCodeMatches.length);

    if (count === 0) return { count: 0, withLanguageHints: 0, hasCode: false };

    // Check for language hints on <pre> or <code> within <pre>
    // Matches: class="language-*", class="lang-*", class="highlight-*", or language="*" attribute (Mintlify/Shiki)
    const withLangRegex = /<(?:pre|code)[^>]*(?:class=["'][^"']*(?:language-|lang-|highlight-)[^"']*["']|language=["'][^"']+["'])[^>]*>/gi;
    const langMatches = html.match(withLangRegex) || [];

    return { count, withLanguageHints: langMatches.length, hasCode: count > 0 };
}

function analyzeInternalLinks(html: string, baseUrl: string): AIReadinessResult['categories']['consumability']['internalLinkDensity'] {
    const domain = new URL(baseUrl).hostname;
    // Strip non-content elements before counting links
    const contentHtml = html
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    const linkRegex = /href=["']([^"']+)["']/gi;
    let match;
    let internalCount = 0;

    while ((match = linkRegex.exec(contentHtml)) !== null) {
        const href = match[1];
        try {
            if (href.startsWith('/') && !href.startsWith('//')) {
                internalCount++;
            } else if (href.startsWith('http')) {
                const linkDomain = new URL(href).hostname;
                if (linkDomain === domain || linkDomain.endsWith(`.${domain}`)) {
                    internalCount++;
                }
            }
        } catch { }
    }

    // Calculate text word count for density (from content only)
    const textOnly = contentHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .trim();
    const wordCount = textOnly.split(/\s+/).length;
    const kWords = Math.max(wordCount / 1000, 0.1);
    const perKWords = internalCount / kWords;

    let status: 'good' | 'sparse' | 'excessive' = 'good';
    if (internalCount < 5 || (internalCount < 20 && perKWords < 5)) status = 'sparse';

    return { count: internalCount, perKWords: Math.round(perKWords * 10) / 10, status };
}

// ── Category 4: Structured Data & Semantic Markup ────────────────────────

function analyzeStructuredData(
    html: string,
    recommendations: Recommendation[]
): AIReadinessResult['categories']['structuredData'] {
    // ── JSON-LD ──
    const jsonLdBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    const types: string[] = [];
    const allFields: string[] = [];

    for (const block of jsonLdBlocks) {
        const contentMatch = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        if (contentMatch) {
            try {
                const data = JSON.parse(contentMatch[1]);
                if (data['@type']) {
                    const t = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
                    types.push(...t);
                }
                allFields.push(...Object.keys(data));
            } catch { }
        }
    }

    const uniqueTypes = [...new Set(types)];
    const isValidSchemaType = uniqueTypes.some(t => VALID_SCHEMA_TYPES.includes(t));

    if (uniqueTypes.length === 0) {
        recommendations.push({
            category: 'Structured Data',
            priority: 'low',
            issue: 'No JSON-LD structured data found — structured data can improve machine understanding and rich-search eligibility. Helpful for discoverability, but not a major coding-agent blocker.',
            fix: 'Add valid JSON-LD for the most relevant schema types used on your docs pages.',
            codeSnippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "TechArticle",\n  "headline": "Your Page Title",\n  "author": { "@type": "Organization", "name": "Your Org" },\n  "datePublished": "2026-01-01"\n}\n</script>`,
        });
    } else if (!isValidSchemaType) {
        recommendations.push({
            category: 'Structured Data',
            priority: 'low',
            issue: `JSON-LD uses type(s) "${uniqueTypes.join(', ')}" — consider using a more specific type for documentation.`,
            fix: 'Use TechArticle, HowTo, FAQPage, or APIReference for technical documentation.',
        });
    }

    // ── Schema completeness ──
    let schemaStatus: 'complete' | 'partial' | 'missing' = 'missing';
    let missingFields: string[] = [];

    if (uniqueTypes.length > 0) {
        const primaryType = uniqueTypes[0];
        const required = SCHEMA_REQUIRED_FIELDS[primaryType] || [];
        missingFields = required.filter(f => !allFields.includes(f));

        if (required.length === 0) {
            schemaStatus = 'complete'; // Unknown type, can't check
        } else if (missingFields.length === 0) {
            schemaStatus = 'complete';
        } else {
            schemaStatus = 'partial';
            recommendations.push({
                category: 'Structured Data',
                priority: 'low',
                issue: `JSON-LD ${primaryType} schema found but could be enhanced — optional fields missing: ${missingFields.join(', ')}`,
                fix: `Adding these fields to your "${primaryType}" schema can improve how AI search engines display and reference your page.`,
            });
        }
    }

    // ── OpenGraph completeness ──
    const ogTags = parseOpenGraphTags(html);
    const requiredOgTags = ['og:title', 'og:description', 'og:image', 'og:type'];
    const missingOgTags = requiredOgTags.filter(t => !ogTags[t]);
    let ogScore: 'complete' | 'partial' | 'missing' = 'missing';

    if (missingOgTags.length === 0) {
        ogScore = 'complete';
    } else if (Object.keys(ogTags).length > 0) {
        ogScore = 'partial';
        recommendations.push({
            category: 'Structured Data',
            priority: 'low',
            issue: `OpenGraph tags incomplete — missing: ${missingOgTags.join(', ')}`,
            fix: 'Add the missing OpenGraph tags for better AI search previews.',
            codeSnippet: missingOgTags.map(t => `<meta property="${t}" content="..." />`).join('\n'),
        });
    } else {
        recommendations.push({
            category: 'Structured Data',
            priority: 'medium',
            issue: 'No OpenGraph tags found — AI search engines and social platforms use these for content understanding.',
            fix: 'Add OpenGraph meta tags to the page head.',
            codeSnippet: `<meta property="og:title" content="Page Title" />\n<meta property="og:description" content="Page description" />\n<meta property="og:image" content="https://example.com/image.png" />\n<meta property="og:type" content="article" />`,
        });
    }

    // ── Breadcrumbs ──
    const hasBreadcrumbs = html.includes('BreadcrumbList') ||
        html.includes('breadcrumb') && html.includes('application/ld+json');
    if (!hasBreadcrumbs) {
        recommendations.push({
            category: 'Structured Data',
            priority: 'low',
            issue: 'No BreadcrumbList schema found — breadcrumb markup helps search systems understand page hierarchy. Useful, but lower priority than crawlability and Markdown access.',
            fix: 'Add valid BreadcrumbList markup that matches the user-visible docs path.',
            codeSnippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "BreadcrumbList",\n  "itemListElement": [\n    { "@type": "ListItem", "position": 1, "name": "Docs", "item": "${'https://example.com/docs'}" },\n    { "@type": "ListItem", "position": 2, "name": "Getting Started", "item": "${'https://example.com/docs/getting-started'}" }\n  ]\n}\n</script>`,
        });
    }

    return {
        jsonLd: { found: jsonLdBlocks.length > 0, types: uniqueTypes, isValidSchemaType },
        schemaCompleteness: { status: schemaStatus, missingFields },
        openGraphCompleteness: { score: ogScore, missingTags: missingOgTags },
        breadcrumbs: { found: hasBreadcrumbs },
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────

const DOCS_PATH_SEGMENTS = new Set([
    'docs', 'doc', 'documentation', 'guide', 'guides',
    'learn', 'reference', 'help', 'wiki', 'manual',
    'knowledge', 'kb', 'api', 'tutorials', 'resources',
]);

function deriveDocsSubpath(llmsTxtUrl?: string, targetUrl?: string, baseUrl?: string): string | null {
    if (llmsTxtUrl) {
        try {
            const path = new URL(llmsTxtUrl).pathname;
            const dir = path.substring(0, path.lastIndexOf('/'));
            if (dir && dir !== '/') return dir;
        } catch { }
    }
    if (targetUrl && baseUrl) {
        try {
            const path = new URL(targetUrl).pathname;
            const segments = path.split('/').filter(Boolean);
            if (segments.length > 1 && DOCS_PATH_SEGMENTS.has(segments[0].toLowerCase())) {
                return `/${segments[0]}`;
            }
        } catch { }
    }
    return null;
}

async function checkUrl(url: string, returnContent = false): Promise<{ found: boolean; content?: string }> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
        clearTimeout(timeoutId);
        if (res.ok) {
            const content = returnContent ? await res.text() : undefined;
            return { found: true, content };
        }
        return { found: false };
    } catch (e) {
        console.log(`Failed to fetch ${url}: ${(e as Error).message}`);
        return { found: false };
    }
}
