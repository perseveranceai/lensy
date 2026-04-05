/**
 * Lensy Analysis Pipeline — Direct Orchestration
 *
 * Replaces the LangGraph agent loop with direct tool calls.
 * The execution order is 100% deterministic (no LLM decisions needed),
 * so we skip the ~20s of Bedrock Sonnet round-trips and run
 * readiness + discoverability checks in parallel.
 *
 * Performance improvement: ~60-70% faster than the LangGraph agent loop.
 *
 * Pipeline:
 *   1. detect_input_type (inline — trivial)
 *   2. check_ai_readiness + check_ai_discoverability (PARALLEL)
 *   3. generate_report
 */

import { ProgressPublisher } from './shared/progress-publisher';
import { writeSessionArtifact } from './shared/s3-helpers';

// Import tools for direct invocation
import { checkAIReadinessTool } from './tools/check-ai-readiness';
import { checkAIDiscoverabilityTool } from './tools/check-ai-discoverability';
import { generateReportTool } from './tools/generate-report';

// DynamoDB for audit log + usage refund
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
const dynamoClient = new DynamoDBClient({});

/**
 * Refund usage count when a scan is rejected by the content gate.
 * Non-doc pages should NOT count against the daily audit limit.
 */
async function refundUsage(ipHash: string): Promise<void> {
    const tableName = process.env.USAGE_TRACKING_TABLE;
    if (!tableName || !ipHash) return;
    const today = new Date().toISOString().split('T')[0];
    try {
        await dynamoClient.send(new UpdateItemCommand({
            TableName: tableName,
            Key: {
                ipHash: { S: ipHash },
                date: { S: today },
            },
            // Decrement by 1 but never go below 0
            UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :one) - :one',
            ConditionExpression: 'usageCount > :zero',
            ExpressionAttributeValues: {
                ':one': { N: '1' },
                ':zero': { N: '0' },
            },
        }));
        console.log(`[Pipeline] Refunded usage for ipHash=${ipHash.substring(0, 8)}...`);
    } catch (e) {
        // ConditionalCheckFailedException means count is already 0 — fine
        console.warn('[Pipeline] Usage refund failed (may already be 0):', (e as Error).message);
    }
}

async function writeAuditLog(sessionId: string, auditUrl: string, status: string, extras: Record<string, string> = {}) {
    const tableName = process.env.AUDIT_LOG_TABLE;
    if (!tableName) return;
    try {
        const item: Record<string, any> = {
            sessionId: { S: sessionId },
            auditUrl: { S: auditUrl },
            submittedAt: { S: new Date().toISOString() },
            status: { S: status },
        };
        for (const [k, v] of Object.entries(extras)) {
            if (v != null) item[k] = { S: String(v) };
        }
        await dynamoClient.send(new PutItemCommand({ TableName: tableName, Item: item }));
    } catch (e) {
        console.warn('[AuditLog] Failed to write:', (e as Error).message);
    }
}

// ── Content Gate: Score how likely a URL is a tech documentation page ──
interface DocConfidence {
    isDoc: boolean;
    confidence: number;  // 0-1
    signals: string[];   // human-readable signals that contributed
}

function scoreDocConfidence(html: string, url: string): DocConfidence {
    const signals: string[] = [];
    let score = 0;

    // 1. Root URLs (no path) → strong negative
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, '');
        if (!path || path === '') {
            signals.push('Root URL with no path (−4)');
            return { isDoc: false, confidence: 0, signals };
        }
    } catch {
        return { isDoc: false, confidence: 0, signals: ['Invalid URL'] };
    }

    const lowerUrl = url.toLowerCase();
    const lowerHtml = html.toLowerCase();

    // ── Structural counts (shared across signals) ──
    const preCount = (html.match(/<pre[\s>]/gi) || []).length;
    const codeCount = (html.match(/<code[\s>]/gi) || []).length;
    const imgCount = (html.match(/<img[\s>]/gi) || []).length;
    const pCount = (html.match(/<p[\s>]/gi) || []).length;
    const buttonCount = (html.match(/<button[\s>]/gi) || []).length;

    // ── URL-level signals ──

    // Positive: doc path patterns (+2 each)
    const docPathPatterns: [RegExp, string][] = [
        [/\/docs?\//i, '/docs/'], [/\/api\//i, '/api/'], [/\/reference\//i, '/reference/'],
        [/\/guide/i, '/guide'], [/\/tutorial/i, '/tutorial'], [/\/sdk\//i, '/sdk/'],
        [/\/getting-?started/i, '/getting-started'], [/\/quickstart/i, '/quickstart'],
        [/\/develop\//i, '/develop/'], [/\/learn\//i, '/learn/'],
        [/\/manual\//i, '/manual/'], [/\/handbook\//i, '/handbook/'], [/\/wiki\//i, '/wiki/'],
        [/\/changelog/i, '/changelog'], [/\/release-notes/i, '/release-notes'],
        [/\/help\//i, '/help/'],
    ];
    for (const [pattern, label] of docPathPatterns) {
        if (pattern.test(lowerUrl)) { score += 2; signals.push(`URL path contains ${label} (+2)`); }
    }

    // Positive: doc hosting platforms (+3) — expanded list
    // These platforms exclusively host documentation, so strong signal
    const docPlatforms: [RegExp, string][] = [
        [/readme\.io/i, 'readme.io'], [/gitbook\.io/i, 'gitbook.io'],
        [/readthedocs/i, 'readthedocs'], [/swagger/i, 'swagger'],
        [/mintlify/i, 'mintlify'], [/docusaurus/i, 'docusaurus'],
        [/stoplight\.io/i, 'stoplight.io'], [/redoc/i, 'redoc'],
        [/apiary\.io/i, 'apiary.io'], [/postman\.com/i, 'postman'],
    ];
    for (const [pattern, label] of docPlatforms) {
        if (pattern.test(lowerUrl)) { score += 3; signals.push(`Hosted on ${label} (+3)`); }
    }

    // Positive: doc platform HTML fingerprints (in page source, not URL) (+3)
    // Detect platforms even when hosted on custom domains
    const platformFingerprints: [RegExp, string][] = [
        [/mintlify|fern-docs|gitbook-root|docsearch-input/i, 'doc platform fingerprint'],
        [/docusaurus|nextra-body|algolia-docsearch/i, 'doc framework detected'],
        [/swagger-ui|redoc-wrap|stoplight-elements/i, 'API doc framework'],
    ];
    for (const [pattern, label] of platformFingerprints) {
        if (pattern.test(html)) { score += 3; signals.push(`${label} (+3)`); break; } // only count once
    }

    // Positive: doc subdomain (+2)
    if (/^https?:\/\/(developer|docs|dev|api|learn|support)\./i.test(url)) {
        score += 2; signals.push('Doc subdomain (developer./docs./dev.) (+2)');
    }

    // Negative: marketing/non-doc paths (−2 each)
    const marketingPaths: [RegExp, string][] = [
        [/\/pricing/i, '/pricing'], [/\/customers/i, '/customers'],
        [/\/careers/i, '/careers'], [/\/about\/?$/i, '/about'],
        [/\/landing/i, '/landing'], [/\/press/i, '/press'],
        [/\/contact/i, '/contact'], [/\/design\//i, '/design/'],
        [/\/blog\//i, '/blog/'], [/\/stories\//i, '/stories/'],
        [/\/community\//i, '/community/'], [/\/events\//i, '/events/'],
        [/\/news\//i, '/news/'], [/\/solutions\//i, '/solutions/'],
        [/\/platform\//i, '/platform/'], [/\/products\//i, '/products/'],
        [/\/samples\/?$/i, '/samples'], [/\/showcase/i, '/showcase'],
        [/\/gallery/i, '/gallery'], [/\/examples\/?$/i, '/examples'],
        [/\/templates\/?$/i, '/templates'], [/\/catalog/i, '/catalog'],
    ];
    for (const [pattern, label] of marketingPaths) {
        if (pattern.test(lowerUrl)) { score -= 2; signals.push(`Non-doc path ${label} (−2)`); }
    }

    // ── HTML structure signals ──

    // Positive: code blocks (+3)
    if (preCount > 0) { score += 3; signals.push(`${preCount} code block(s) found (+3)`); }

    // Positive: inline code (+1)
    if (codeCount >= 3) { score += 1; signals.push(`${codeCount} inline code elements (+1)`); }

    // Positive: same-page anchor links in CONTENT area (TOC pattern) (+3)
    // Strip nav/header/footer before counting — only count anchors in actual page body
    const contentHtml = html
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[\s\S]*?<\/aside>/gi, '');
    const contentAnchorLinks = (contentHtml.match(/href=["']#[a-zA-Z]/gi) || []).length;
    if (contentAnchorLinks >= 5) { score += 3; signals.push(`${contentAnchorLinks} in-content anchor links (TOC) (+3)`); }

    // Positive: <main> or role="main" (+1)
    if (/<main[\s>]|role=["']main["']/i.test(html)) { score += 1; signals.push('<main> element found (+1)'); }

    // Positive: doc-style meta tags (+2)
    if (/<meta[^>]*name=["']docsearch/i.test(html)) { score += 2; signals.push('DocSearch meta tag (+2)'); }
    if (/data-docs/i.test(html)) { score += 1; signals.push('data-docs attribute (+1)'); }

    // Positive: install commands (+2)
    if (/npm install|pip install|yarn add|cargo add|gem install|brew install/i.test(lowerHtml)) {
        score += 2; signals.push('Package install commands found (+2)');
    }

    // ── Negative signals ──

    // Negative: marketing CTAs (−2)
    const ctaCount = (lowerHtml.match(/buy now|contact sales|book a demo|free trial|sign up free|get started free/gi) || []).length;
    if (ctaCount >= 2) { score -= 2; signals.push(`${ctaCount} marketing CTAs found (−2)`); }

    // Negative: pricing tables (−2)
    if (/<table[^>]*>[\s\S]*?(price|\/month|\/year|enterprise|starter|pro plan)/i.test(html)) {
        score -= 2; signals.push('Pricing table detected (−2)');
    }

    // Negative: hero/marketing layout patterns (−2)
    const heroPatterns = (lowerHtml.match(/hero[-_]?section|hero[-_]?banner|cta[-_]?button|testimonial|social[-_]?proof|customer[-_]?logo/gi) || []).length;
    if (heroPatterns >= 2) { score -= 2; signals.push(`Marketing layout patterns found (−2)`); }

    // Negative: feature grid / marketing card patterns (−1)
    if (/feature[-_]?grid|feature[-_]?card|benefit[-_]?card|use[-_]?case/i.test(lowerHtml)) {
        score -= 1; signals.push('Feature/benefit grid layout (−1)');
    }

    // Negative: card/grid listing layout (−3) — catalog/gallery/index pages
    // These are browsable listings, not instructional content
    const cardGridSignals = (lowerHtml.match(/card[-_]?grid|card[-_]?container|card[-_]?list|grid[-_]?container|item[-_]?grid|sample[-_]?card|resource[-_]?card/gi) || []).length;
    const repeatingCards = (html.match(/<div[^>]*class=["'][^"']*card["'][^>]*>/gi) || []).length;
    if (cardGridSignals >= 2 || repeatingCards >= 6) {
        score -= 3; signals.push(`Card/grid listing layout (${cardGridSignals} grid patterns, ${repeatingCards} cards) (−3)`);
    }

    // Negative: pagination (−2) — index/listing pages have pagination, docs don't
    const hasPagination = /class=["'][^"']*pagination["']|aria-label=["']pagination["']|page\s+\d+\s+of\s+\d+|<nav[^>]*>[\s\S]*?<a[^>]*>\d+<\/a>[\s\S]*?<a[^>]*>\d+<\/a>/i.test(html);
    if (hasPagination) {
        score -= 2; signals.push('Pagination detected — listing/index page (−2)');
    }

    // Negative: filter/faceted search UI (−2) — catalog pages have filters, docs don't
    const hasFilters = /filter[-_]?bar|filter[-_]?panel|facet|search[-_]?filter|select\s+all|checkbox.*filter/i.test(lowerHtml);
    if (hasFilters) {
        score -= 2; signals.push('Filter/faceted search UI — catalog page (−2)');
    }

    // Negative: high image density with no long-form content (−2)
    if (imgCount >= 10 && pCount < 5) {
        score -= 2; signals.push(`${imgCount} images with only ${pCount} paragraphs — showcase/gallery (−2)`);
    }

    // Negative: "explore" / "discover" / "learn more" CTAs typical of overview pages (−1)
    const overviewCtas = (lowerHtml.match(/explore\s+\w+|discover\s+\w+|learn\s+more|view\s+samples|browse\s+\w+|try\s+it\s+out/gi) || []).length;
    if (overviewCtas >= 3) {
        score -= 1; signals.push(`${overviewCtas} overview CTAs ("Explore...", "Discover...", etc.) (−1)`);
    }

    // Negative: many buttons (−1) — docs rarely have more than 2-3 buttons
    if (buttonCount >= 5 && preCount === 0) {
        score -= 1; signals.push(`${buttonCount} buttons with no code blocks (−1)`);
    }

    // Negative: link-dominated pages with minimal prose (−3) — index/hub pages
    // Pages that are mostly lists of links to other pages are navigation, not documentation
    const contentAreaForLinks = html
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[\s\S]*?<\/aside>/gi, '');
    const outboundLinks = (contentAreaForLinks.match(/<a\s[^>]*href=["']https?:\/\//gi) || []).length;
    const proseParagraphs = (contentAreaForLinks.match(/<p[\s>][\s\S]*?<\/p>/gi) || [])
        .filter(p => p.replace(/<[^>]+>/g, '').trim().length > 80).length;
    const isLinkHeavy = outboundLinks >= 8 && proseParagraphs <= 2;
    if (isLinkHeavy) {
        score -= 3; signals.push(`Link-heavy index page (${outboundLinks} outbound links, ${proseParagraphs} prose paragraphs) (−3)`);
    }

    // ── Absence-of-content penalty ──
    // Light penalty — docs can legitimately use images/diagrams instead of code
    const hasCodeBlocks = preCount > 0;
    const hasInlineCode = codeCount >= 3;
    const hasInstallCommands = /npm install|pip install|yarn add|cargo add|gem install|brew install/i.test(lowerHtml);
    const hasApiPatterns = /api reference|endpoint|request body|response body|authentication|authorization header|bearer token/i.test(lowerHtml);
    const hasTechnicalContent = hasCodeBlocks || hasInlineCode || hasInstallCommands || hasApiPatterns;

    // Light penalty (−1) for no technical content — many valid docs use images/diagrams instead of code
    if (!hasTechnicalContent) {
        score -= 1; signals.push('No code, API patterns, or install commands found (−1)');
    }

    // ── Convert score to 0-1 confidence via logistic function ──
    // Logistic: 1 / (1 + e^(-k*score)), k=0.7 gives good spread
    const confidence = Math.round((1 / (1 + Math.exp(-0.7 * score))) * 100) / 100;
    const isDoc = confidence >= 0.4;

    return { isDoc, confidence, signals };
}

// ─── Public API ──────────────────────────────────────────────

export interface AgentRunInput {
    url: string;
    sessionId: string;
    selectedModel: string;
    analysisStartTime: number;
    contextAnalysis?: {
        enabled: boolean;
        maxContextPages?: number;
    };
    cacheControl?: {
        enabled: boolean;
    };
    sitemapUrl?: string;
    llmsTxtUrl?: string;
    ipHash?: string; // For refunding usage on content gate rejection
    skipCitations?: boolean; // Skip Perplexity AI citation check (run on-demand from frontend)
}

/**
 * Run the Lensy AI readiness analysis pipeline (direct orchestration).
 *
 * Instead of using LangGraph's agent loop (8+ LLM round-trips at ~2.5s each),
 * we call tools directly in a deterministic sequence. Readiness and discoverability
 * checks run in parallel since they are independent.
 */
export async function runAgent(input: AgentRunInput): Promise<string> {
    const { sessionId, analysisStartTime, llmsTxtUrl, ipHash, skipCitations } = input;
    let url = input.url;  // mutable — updated if redirect detected
    const progress = new ProgressPublisher(sessionId);

    console.log(`[Pipeline] Starting direct analysis for URL: ${url}, session: ${sessionId}`);
    const pipelineStart = Date.now();

    try {
        // ── Step 1: Detect input type (inline — no tool call needed) ──
        const inputType = url.toLowerCase().includes('sitemap.xml') ? 'sitemap' : 'doc';
        console.log(`[Pipeline] Input type: ${inputType}`);

        // ── Step 1.5: Fetch page HTML once (shared by both parallel checks) ──
        await progress.info('Fetching page content...');
        let prefetchedHtml = '';
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (+https://perseveranceai.com/bot)';
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': BROWSER_UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                prefetchedHtml = await res.text();
                console.log(`[Pipeline] Prefetched ${url}: ${prefetchedHtml.length} bytes`);

                // ── Follow redirects: update URL to final destination ──
                const finalUrl = res.url;
                if (finalUrl && finalUrl !== url) {
                    const originalDomain = new URL(url).hostname;
                    const finalDomain = new URL(finalUrl).hostname;
                    if (finalDomain !== originalDomain) {
                        console.log(`[Pipeline] Redirect detected: ${originalDomain} → ${finalDomain} (final URL: ${finalUrl})`);
                    } else {
                        console.log(`[Pipeline] Path redirect: ${url} → ${finalUrl}`);
                    }
                    url = finalUrl;
                }
            } else {
                console.warn(`[Pipeline] Prefetch failed with status ${res.status}`);
            }
        } catch (e) {
            console.warn(`[Pipeline] Prefetch failed:`, (e as Error).message);
        }

        if (!prefetchedHtml) {
            await progress.error('Lensy was unable to access this URL. Please verify the URL is correct and publicly accessible.');
            await writeSessionArtifact(sessionId, 'status.json', {
                status: 'rejected',
                reason: 'unreachable-url',
                completedAt: new Date().toISOString(),
            });
            await writeAuditLog(sessionId, url, 'rejected', { reason: 'unreachable-url' });
            // Refund usage — rejected scans should not count against daily limit
            if (ipHash) await refundUsage(ipHash);
            return JSON.stringify({
                success: false,
                error: 'unreachable-url',
                message: 'Lensy was unable to fetch content from this URL. It may be invalid, private, or blocking automated access.',
            });
        }

        // ── Step 1.7: Content gate + confidence scoring ──
        // Two-stage gate: (1) fast heuristic, (2) LLM verification for ambiguous cases
        let docConfidence: DocConfidence = { isDoc: true, confidence: 1, signals: [] };
        if (prefetchedHtml) {
            docConfidence = scoreDocConfidence(prefetchedHtml, url);
            console.log(`[Pipeline] Doc confidence (heuristic): ${docConfidence.confidence} (${docConfidence.isDoc ? 'PASS' : 'REJECT'}) — signals: ${docConfidence.signals.join('; ')}`);

            // Stage 2: For ambiguous cases (0.4-0.95), use LLM (Haiku — fast, cheap) to verify
            // Only skip LLM for very high confidence (>0.95) — code blocks + doc paths + technical content
            if (docConfidence.isDoc && docConfidence.confidence < 0.95) {
                await progress.info('Verifying page type...');
                try {
                    const { invokeBedrockForJson } = await import('./shared/bedrock-helpers.js');

                    // Strip nav, header, footer, sidebar BEFORE extracting content
                    const mainContent = prefetchedHtml
                        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
                        .replace(/<header[\s\S]*?<\/header>/gi, '')
                        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
                        .replace(/<aside[\s\S]*?<\/aside>/gi, '')
                        .replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[\s\S]*?<\/style>/gi, '');

                    // ── Convert HTML to a simplified structured representation ──
                    // This lets the LLM see the page naturally: headings, prose, links, code — all distinguishable
                    let structuredView = mainContent
                        // Headings → markdown-style
                        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${t.replace(/<[^>]+>/g, '').trim()}\n`)
                        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${t.replace(/<[^>]+>/g, '').trim()}\n`)
                        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${t.replace(/<[^>]+>/g, '').trim()}\n`)
                        .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, t) => `\n#### ${t.replace(/<[^>]+>/g, '').trim()}\n`)
                        // Links → [text](url) so LLM can see what's a link vs prose
                        .replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
                            const linkText = text.replace(/<[^>]+>/g, '').trim();
                            return linkText ? `[${linkText}](${href})` : '';
                        })
                        // Code blocks → fenced
                        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\`\`\`\n${code.replace(/<[^>]+>/g, '').trim()}\n\`\`\`\n`)
                        // Inline code
                        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${code.replace(/<[^>]+>/g, '').trim()}\``)
                        // List items → bullets
                        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `  • ${text.replace(/<[^>]+>/g, '').trim()}\n`)
                        // Paragraphs → newline-separated text
                        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `${text.replace(/<[^>]+>/g, '').trim()}\n`)
                        // Images
                        .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_, alt) => alt ? `[image: ${alt}]` : '[image]')
                        // Strip remaining HTML
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\n{3,}/g, '\n\n')
                        .replace(/[ \t]+/g, ' ')
                        .trim()
                        .substring(0, 2000);

                    // ── Quick content stats for the LLM ──
                    const llmLinkCount = (mainContent.match(/<a[\s>]/gi) || []).length;
                    const llmParagraphs = (mainContent.match(/<p[\s>][\s\S]*?<\/p>/gi) || [])
                        .map(p => p.replace(/<[^>]+>/g, '').trim());
                    const llmProseWordCount = llmParagraphs.join(' ').split(/\s+/).filter(w => w.length > 0).length;
                    const llmCodeBlockCount = (mainContent.match(/<pre[\s>]/gi) || []).length;

                    const contentStats = `Links: ${llmLinkCount} | Paragraphs: ${llmParagraphs.length} | Prose words: ${llmProseWordCount} | Code blocks: ${llmCodeBlockCount}`;

                    const llmResult: { isDoc: boolean; category: string; reason: string } = await invokeBedrockForJson(
                        `You are a web page classifier. Given a page's content, determine whether it is technical documentation that should be scored for AI readiness.

Your task: Read the page content below and classify it into ONE of these categories:

DOCUMENTATION — The page itself teaches or explains something. It contains instructional prose, how-to steps, API parameter descriptions, conceptual explanations, configuration guides, or tutorials. The reader learns something by reading this page. Documentation can exist without code blocks (conceptual docs, architecture guides, glossaries are still docs).

INDEX/NAVIGATION — The page primarily organizes links to other pages. It may have a brief intro but the bulk of the content is a list of links, a table of contents, or a directory. Even if every linked page is technical documentation, this page itself is just a menu. Ask yourself: if you removed all the links, would meaningful content remain?

MARKETING/PRODUCT — Landing pages, product overviews, feature showcases, pricing, sign-up flows, testimonials, case studies.

BLOG/ARTICLE — Time-stamped posts, news, announcements, changelogs, opinion pieces.

REFERENCE LISTING — API endpoint lists, class/method indexes, or tables that name items without explaining them. These catalog things without teaching about them.

OTHER — Forums, support tickets, error pages, login pages, community pages.

Key principle: Does this page TEACH or EXPLAIN, or does it merely POINT to pages that do?
A page titled "ChromeDriver Documentation" that lists links to design docs is NAVIGATION, not documentation.
A page titled "Getting Started" that walks you through setup steps is DOCUMENTATION, even without code.

URL: ${url}
Content stats: ${contentStats}

Page content (HTML converted to structured text — links shown as [text](url), code as \`\`\` blocks):
${structuredView}

Respond with JSON only:
{"isDoc": true/false, "category": "DOCUMENTATION|INDEX/NAVIGATION|MARKETING/PRODUCT|BLOG/ARTICLE|REFERENCE LISTING|OTHER", "reason": "one sentence explanation"}`,
                        {
                            modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
                            maxTokens: 100,
                            temperature: 0,
                        }
                    );

                    const llmCategory = llmResult.category || (llmResult.isDoc ? 'DOCUMENTATION' : 'UNKNOWN');
                    console.log(`[Pipeline] LLM doc verification: isDoc=${llmResult.isDoc}, category=${llmCategory}, reason=${llmResult.reason}`);

                    if (!llmResult.isDoc) {
                        docConfidence.isDoc = false;
                        docConfidence.confidence = Math.min(docConfidence.confidence, 0.3);
                        docConfidence.signals.push(`LLM classified as ${llmCategory}: ${llmResult.reason}`);
                    } else {
                        docConfidence.signals.push(`LLM confirmed as ${llmCategory}: ${llmResult.reason}`);
                    }
                } catch (e) {
                    console.warn(`[Pipeline] LLM doc verification failed, proceeding with heuristic:`, (e as Error).message);
                    // If LLM fails, proceed with heuristic result (don't block)
                }
            }

            if (!docConfidence.isDoc) {
                const rejectMessage = 'This page does not appear to be technical documentation. Lensy analyzes developer docs, API references, SDK guides, and technical tutorials. Try entering a specific documentation page URL instead.';
                await progress.error(rejectMessage);
                await writeSessionArtifact(sessionId, 'status.json', {
                    status: 'rejected',
                    reason: 'non-documentation-page',
                    completedAt: new Date().toISOString(),
                });
                await writeAuditLog(sessionId, url, 'rejected', {
                    reason: 'non-documentation-page',
                    docConfidence: String(docConfidence.confidence),
                });
                // Refund usage — rejected scans should not count against daily limit
                if (ipHash) await refundUsage(ipHash);
                return JSON.stringify({
                    success: false,
                    error: 'non-documentation-page',
                    message: rejectMessage,
                    confidence: docConfidence.confidence,
                    signals: docConfidence.signals,
                });
            }
        }

        // ── Step 2: Run readiness (+ optionally discoverability) in PARALLEL ──
        await progress.info(skipCitations
            ? 'Analyzing AI readiness...'
            : 'Analyzing AI readiness and search discoverability in parallel...');

        const readinessInput = llmsTxtUrl
            ? { url, sessionId, llmsTxtUrl, prefetchedHtml }
            : { url, sessionId, prefetchedHtml };

        const parallelTasks: Promise<any>[] = [
            checkAIReadinessTool.invoke(readinessInput),
        ];
        if (!skipCitations) {
            parallelTasks.push(checkAIDiscoverabilityTool.invoke({ url, sessionId, prefetchedHtml }));
        }

        const results = await Promise.allSettled(parallelTasks);
        const readinessResult = results[0];
        const discoverabilityResult = skipCitations ? null : results[1];

        // Log results (tools write artifacts to S3 internally)
        if (readinessResult.status === 'fulfilled') {
            console.log(`[Pipeline] AI readiness complete: ${String(readinessResult.value).substring(0, 200)}`);
        } else {
            console.error(`[Pipeline] AI readiness FAILED:`, readinessResult.reason);
            await progress.error(`AI readiness check failed: ${readinessResult.reason}`);
        }

        if (discoverabilityResult) {
            if (discoverabilityResult.status === 'fulfilled') {
                console.log(`[Pipeline] AI discoverability complete: ${String(discoverabilityResult.value).substring(0, 200)}`);
            } else {
                console.error(`[Pipeline] AI discoverability FAILED:`, discoverabilityResult.reason);
                await progress.error(`AI discoverability check failed: ${discoverabilityResult.reason}`);
            }
        } else {
            console.log(`[Pipeline] AI discoverability skipped (skipCitations=true)`);
        }

        const parallelTime = Date.now() - pipelineStart;
        console.log(`[Pipeline] Parallel checks completed in ${parallelTime}ms`);

        // ── Step 3: Generate report ──
        await progress.info('Generating report...');

        const reportResult = await generateReportTool.invoke({
            sessionId,
            url,
            sourceMode: 'ai-readiness',
            analysisStartTime,
        });

        const totalTime = Date.now() - pipelineStart;
        console.log(`[Pipeline] Report generated. Total pipeline time: ${totalTime}ms`);

        // Parse report result, inject doc confidence, and extract score
        let overallScore = 0;
        let finalResult = reportResult;
        try {
            const parsed = JSON.parse(reportResult);
            overallScore = parsed.overallScore || 0;
            // Inject doc confidence into the result
            parsed.docConfidence = {
                score: docConfidence.confidence,
                signals: docConfidence.signals,
            };
            finalResult = JSON.stringify(parsed);

            // Re-publish overallScore category with docConfidence so frontend cards pick it up
            await progress.categoryResult('overallScore', {
                overallScore: parsed.overallScore,
                scoreBreakdown: parsed.scoreBreakdown,
                recommendationCount: parsed.recommendationCount || 0,
                contextualSuggestionCount: parsed.contextualSuggestionCount || 0,
                docConfidence: parsed.docConfidence,
            }, `AI Readiness Score: ${overallScore}/100`);
        } catch { }

        await progress.success(
            `Analysis complete! AI Readiness: ${overallScore}/100 (${(totalTime / 1000).toFixed(1)}s)`
        );

        await writeAuditLog(sessionId, url, 'completed', {
            overallScore: String(overallScore),
            analysisTimeMs: String(totalTime),
            docConfidence: String(docConfidence.confidence),
        });

        return finalResult;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Pipeline] Fatal error:`, errorMessage);
        await progress.error(`Analysis failed: ${errorMessage}`);
        throw error;
    }
}
