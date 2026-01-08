"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: 'us-east-1' }); // Bedrock is available in us-east-1
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION });
/**
 * Generate embedding for text using Amazon Bedrock Titan
 */
function generateEmbedding(text) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const input = {
                modelId: 'amazon.titan-embed-text-v1',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                    inputText: text
                })
            };
            const command = new client_bedrock_runtime_1.InvokeModelCommand(input);
            const response = yield bedrockClient.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            return responseBody.embedding;
        }
        catch (error) {
            console.error('Error generating embedding:', error);
            throw error;
        }
    });
}
/**
 * Extract page content from HTML
 */
function extractPageContent(html) {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["'][^>]*>/i);
    const description = descMatch ? descMatch[1].trim() : '';
    // Extract main content (remove scripts, styles, nav, footer)
    let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // Limit content length for embedding
    if (content.length > 8000) {
        content = content.substring(0, 8000) + '...';
    }
    return { title, description, content };
}
/**
 * Load or generate embeddings for all documentation pages
 */
function loadOrGenerateEmbeddings(domain) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const bucketName = process.env.S3_BUCKET_NAME;
        if (!bucketName) {
            throw new Error('S3_BUCKET_NAME environment variable not set');
        }
        // Domain-specific embeddings key to avoid cross-contamination
        const embeddingsKey = `rich-content-embeddings-${domain.replace(/\./g, '-')}.json`;
        console.log(`Using domain-specific embeddings key: ${embeddingsKey}`);
        try {
            // Try to load existing embeddings from S3
            console.log('Loading existing embeddings from S3...');
            const getCommand = new client_s3_1.GetObjectCommand({
                Bucket: bucketName,
                Key: embeddingsKey
            });
            const response = yield s3Client.send(getCommand);
            const embeddingsData = yield ((_a = response.Body) === null || _a === void 0 ? void 0 : _a.transformToString());
            if (embeddingsData) {
                const embeddings = JSON.parse(embeddingsData);
                console.log(`Loaded ${embeddings.length} existing embeddings from S3`);
                return embeddings;
            }
        }
        catch (error) {
            console.log('No existing embeddings found, generating new ones...');
        }
        // Generate new embeddings
        const sitemap = yield fetchSitemap(domain);
        const docPages = sitemap.filter(url => url.startsWith('/docs/'));
        console.log(`Generating embeddings for ${docPages.length} documentation pages...`);
        const embeddings = [];
        for (const pagePath of docPages) {
            try {
                const html = yield fetchPageContent(domain, pagePath);
                if (!html)
                    continue;
                const { title, description, content } = extractPageContent(html);
                // Combine title, description, and content for embedding
                const textForEmbedding = `${title} ${description} ${content}`.trim();
                if (textForEmbedding.length < 10)
                    continue; // Skip pages with minimal content
                const embedding = yield generateEmbedding(textForEmbedding);
                embeddings.push({
                    url: pagePath,
                    title,
                    description,
                    content,
                    embedding
                });
                console.log(`Generated embedding for: ${pagePath} (${title})`);
                // Add small delay to avoid rate limiting
                yield new Promise(resolve => setTimeout(resolve, 100));
            }
            catch (error) {
                console.error(`Failed to generate embedding for ${pagePath}:`, error);
            }
        }
        // Store embeddings in S3
        try {
            const putCommand = new client_s3_1.PutObjectCommand({
                Bucket: bucketName,
                Key: embeddingsKey,
                Body: JSON.stringify(embeddings, null, 2),
                ContentType: 'application/json'
            });
            yield s3Client.send(putCommand);
            console.log(`Stored ${embeddings.length} embeddings in S3`);
        }
        catch (error) {
            console.error('Failed to store embeddings in S3:', error);
        }
        return embeddings;
    });
}
/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error('Vectors must have the same length');
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (normA * normB);
}
/**
 * Search sitemap using semantic similarity (optimized version)
 * Returns array of {url, title, similarity} objects
 */
function searchSitemapSemanticlyOptimized(issue, domain) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Load pre-generated embeddings
            const embeddings = yield loadOrGenerateEmbeddings(domain);
            if (embeddings.length === 0) {
                console.log('No embeddings available, falling back to keyword search');
                return [];
            }
            // Generate embedding for the issue using RICH CONTENT
            // Combine all available fields for maximum context
            let issueText = `${issue.title} ${issue.description} ${issue.category}`;
            // Add rich content if available
            if (issue.fullContent) {
                issueText += ` ${issue.fullContent}`;
                console.log(`Using full content (${issue.fullContent.length} chars) for semantic matching`);
            }
            if (issue.codeSnippets && issue.codeSnippets.length > 0) {
                issueText += ` ${issue.codeSnippets.join(' ')}`;
                console.log(`Including ${issue.codeSnippets.length} code snippets`);
            }
            if (issue.errorMessages && issue.errorMessages.length > 0) {
                issueText += ` ${issue.errorMessages.join(' ')}`;
                console.log(`Including ${issue.errorMessages.length} error messages`);
            }
            if (issue.tags && issue.tags.length > 0) {
                issueText += ` ${issue.tags.join(' ')}`;
                console.log(`Including ${issue.tags.length} tags: ${issue.tags.join(', ')}`);
            }
            if (issue.stackTrace) {
                issueText += ` ${issue.stackTrace}`;
                console.log(`Including stack trace`);
            }
            console.log(`Total issue text for embedding: ${issueText.length} chars`);
            const issueEmbedding = yield generateEmbedding(issueText);
            // Calculate similarities
            const similarities = [];
            for (const embedding of embeddings) {
                const similarity = cosineSimilarity(issueEmbedding, embedding.embedding);
                similarities.push({
                    url: embedding.url,
                    title: embedding.title,
                    similarity
                });
            }
            // Sort by similarity and return top 5
            similarities.sort((a, b) => b.similarity - a.similarity);
            const topPages = similarities.slice(0, 5);
            console.log(`Semantic search results for "${issue.title}" (using rich content):`);
            topPages.forEach((page, index) => {
                console.log(`${index + 1}. ${page.url} (${page.title}) - Similarity: ${page.similarity.toFixed(3)}`);
            });
            return topPages;
        }
        catch (error) {
            console.error('Semantic search failed:', error);
            return [];
        }
    });
}
/**
 * Extract keywords from issue for sitemap search
 */
function extractKeywords(issue) {
    const text = `${issue.title} ${issue.description} ${issue.category}`.toLowerCase();
    // Common stop words to filter out
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can'];
    // Extract words (alphanumeric, 3+ chars)
    const words = text.match(/\b[a-z0-9]{3,}\b/g) || [];
    // Filter stop words and deduplicate
    const keywords = [...new Set(words.filter(word => !stopWords.includes(word)))];
    // Add category-specific keywords
    const categoryKeywords = {
        'deployment': ['deploy', 'production', 'environment', 'vercel', 'netlify', 'hosting'],
        'email-delivery': ['email', 'spam', 'deliverability', 'dns', 'spf', 'dkim', 'gmail'],
        'api-usage': ['api', 'endpoint', 'request', 'response', 'integration'],
        'authentication': ['auth', 'key', 'token', 'credential', 'permission'],
        'documentation': ['docs', 'guide', 'tutorial', 'example']
    };
    if (issue.category && categoryKeywords[issue.category]) {
        keywords.push(...categoryKeywords[issue.category]);
    }
    return [...new Set(keywords)];
}
/**
 * Domain-specific sitemap configuration
 */
const DOMAIN_SITEMAP_CONFIG = {
    'resend.com': {
        sitemapUrl: 'https://resend.com/docs/sitemap.xml',
        docFilter: '/docs/'
    },
    'liveblocks.io': {
        sitemapUrl: 'https://liveblocks.io/sitemap.xml',
        docFilter: '/docs'
    }
};
/**
 * Fetch sitemap.xml and extract URLs - Enhanced to support multiple domains
 */
function fetchSitemap(domain) {
    return __awaiter(this, void 0, void 0, function* () {
        // Get domain-specific configuration
        const config = DOMAIN_SITEMAP_CONFIG[domain];
        if (!config) {
            console.warn(`No sitemap configuration for domain: ${domain}, using default`);
            // Default fallback
            const defaultSitemapUrl = `https://${domain}/sitemap.xml`;
            console.log(`Fetching sitemap from: ${defaultSitemapUrl}`);
            try {
                const xml = yield makeHttpRequest(defaultSitemapUrl);
                const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g) || [];
                const urls = urlMatches.map(match => {
                    const url = match.replace(/<\/?loc>/g, '');
                    try {
                        const urlObj = new url_1.URL(url);
                        return urlObj.pathname;
                    }
                    catch (_a) {
                        return url;
                    }
                });
                return urls.filter(url => url.includes('/docs'));
            }
            catch (error) {
                console.error('Failed to fetch sitemap:', error);
                return [];
            }
        }
        console.log(`Fetching sitemap from: ${config.sitemapUrl} (filtering for: ${config.docFilter})`);
        try {
            const xml = yield makeHttpRequest(config.sitemapUrl);
            // Extract URLs from sitemap XML
            const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g) || [];
            const urls = urlMatches.map(match => {
                const url = match.replace(/<\/?loc>/g, '');
                // Convert full URL to path
                try {
                    const urlObj = new url_1.URL(url);
                    return urlObj.pathname;
                }
                catch (_a) {
                    return url;
                }
            });
            // Filter to only documentation pages
            const docUrls = urls.filter(url => url.startsWith(config.docFilter));
            console.log(`Found ${docUrls.length} documentation URLs from ${urls.length} total URLs`);
            return docUrls;
        }
        catch (error) {
            console.error('Failed to fetch sitemap:', error);
            return [];
        }
    });
}
/**
 * Search sitemap for relevant pages based on keywords
 */
function searchSitemapForRelevantPages(keywords, sitemapUrls) {
    const relevantPages = [];
    for (const url of sitemapUrls) {
        const urlLower = url.toLowerCase();
        let score = 0;
        // Score based on keyword matches
        for (const keyword of keywords) {
            if (urlLower.includes(keyword)) {
                score += 1;
            }
        }
        // Boost score for /docs/ pages
        if (urlLower.includes('/docs/')) {
            score += 0.5;
        }
        if (score > 0) {
            relevantPages.push({ url, score });
        }
    }
    // Sort by score and return top 5
    relevantPages.sort((a, b) => b.score - a.score);
    const topPages = relevantPages.slice(0, 5).map(p => p.url);
    console.log(`Found ${topPages.length} relevant pages from sitemap:`, topPages);
    return topPages;
}
/**
 * Fetch page content
 */
function fetchPageContent(domain, path) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `https://${domain}${path}`;
        console.log(`Fetching page content from: ${url}`);
        try {
            const content = yield makeHttpRequest(url);
            return content;
        }
        catch (error) {
            console.error(`Failed to fetch page ${url}:`, error);
            return '';
        }
    });
}
/**
 * Extract code snippets from HTML page
 */
function extractCodeSnippetsFromPage(html) {
    const snippets = [];
    // Match <pre><code> blocks
    const preCodeRegex = /<pre[^>]*><code[^>]*class=["']?language-(\w+)["']?[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
    let match;
    while ((match = preCodeRegex.exec(html)) !== null) {
        const language = match[1];
        let code = match[2];
        // Decode HTML entities
        code = code
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        // Remove HTML tags that might be inside
        code = code.replace(/<[^>]+>/g, '');
        if (code.trim().length > 10) {
            snippets.push({ code: code.trim(), language });
        }
    }
    // Also try to match simple <code> blocks
    if (snippets.length === 0) {
        const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
        while ((match = codeRegex.exec(html)) !== null) {
            let code = match[1];
            code = code
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/<[^>]+>/g, '');
            if (code.trim().length > 50) { // Only longer code blocks
                snippets.push({ code: code.trim() });
            }
        }
    }
    return snippets.slice(0, 5); // Limit to 5 snippets to avoid token limits
}
/**
 * Analyze page content for relevance to issue
 */
function analyzePageContent(content, issue, pageUrl, semanticScore) {
    const contentLower = content.toLowerCase();
    const keywords = extractKeywords(issue);
    // Extract page title
    const titleMatch = content.match(/<title>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1] : pageUrl;
    // Check for keyword matches
    const keywordMatches = keywords.filter(kw => contentLower.includes(kw));
    const hasRelevantContent = keywordMatches.length >= 2; // At least 2 keywords
    // Count code examples (code blocks, pre tags)
    const codeBlockMatches = content.match(/<code|<pre|```/gi) || [];
    const codeExamples = codeBlockMatches.length;
    // Check for production guidance keywords
    const productionKeywords = ['production', 'deploy', 'environment', 'configuration', 'setup'];
    const productionGuidance = productionKeywords.some(kw => contentLower.includes(kw));
    // Identify content gaps
    const contentGaps = [];
    if (codeExamples === 0) {
        contentGaps.push('Missing code examples');
    }
    if (!productionGuidance && issue.category === 'deployment') {
        contentGaps.push('Missing production deployment guidance');
    }
    if (!contentLower.includes('error') && !contentLower.includes('troubleshoot')) {
        contentGaps.push('Missing error handling and troubleshooting steps');
    }
    // Check for specific issue-related content
    if (issue.category === 'email-delivery') {
        if (!contentLower.includes('spam') && !contentLower.includes('deliverability')) {
            contentGaps.push('Missing spam/deliverability troubleshooting');
        }
        if (!contentLower.includes('dns') && !contentLower.includes('spf') && !contentLower.includes('dkim')) {
            contentGaps.push('Missing DNS configuration examples');
        }
    }
    if (issue.category === 'deployment') {
        if (!contentLower.includes('vercel') && !contentLower.includes('netlify') && issue.title.toLowerCase().includes('vercel')) {
            contentGaps.push('Missing platform-specific deployment examples (Vercel/Netlify)');
        }
        if (!contentLower.includes('environment variable') && !contentLower.includes('env')) {
            contentGaps.push('Missing environment variable configuration');
        }
    }
    return {
        pageUrl,
        pageTitle,
        hasRelevantContent,
        contentGaps,
        codeExamples,
        productionGuidance,
        semanticScore
    };
}
/**
 * Validate a single issue against documentation
 */
function validateIssue(issue, domain) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`\n=== Validating issue: ${issue.title} ===`);
        let pagesToCheck = [];
        let usedSitemapFallback = false;
        // Step 1: Try pre-curated pages first
        if (issue.relatedPages && issue.relatedPages.length > 0) {
            pagesToCheck = issue.relatedPages.map(url => ({ url, title: url }));
            console.log(`Using pre-curated pages:`, pagesToCheck.map(p => p.url));
        }
        else {
            // Step 2: Use semantic search for better relevance
            console.log(`No pre-curated pages, using semantic search`);
            usedSitemapFallback = true;
            const semanticResults = yield searchSitemapSemanticlyOptimized(issue, domain);
            pagesToCheck = semanticResults;
            // Fallback to keyword search if semantic search fails
            if (pagesToCheck.length === 0) {
                console.log(`Semantic search failed, falling back to keyword search`);
                const sitemap = yield fetchSitemap(domain);
                if (sitemap.length > 0) {
                    // Filter to only include docs pages to avoid irrelevant results
                    const docPages = sitemap.filter(url => url.startsWith('/docs/'));
                    console.log(`Filtered to ${docPages.length} docs pages from ${sitemap.length} total pages`);
                    const keywords = extractKeywords(issue);
                    console.log(`Extracted keywords:`, keywords);
                    const keywordPages = searchSitemapForRelevantPages(keywords, docPages);
                    pagesToCheck = keywordPages.map(url => ({ url, title: url }));
                }
            }
        }
        // Step 3: Validate each page
        const evidence = [];
        const potentialGaps = [];
        const criticalGaps = [];
        const missingElements = [];
        if (pagesToCheck.length === 0) {
            // Critical gap: No relevant pages found
            console.log(`❌ CRITICAL GAP: No relevant pages found for issue`);
            criticalGaps.push(`No documentation page found addressing "${issue.title}"`);
            potentialGaps.push({
                gapType: 'critical-gap',
                missingContent: [
                    'Complete documentation page missing',
                    'Code examples needed',
                    'Troubleshooting guide needed',
                    'Production deployment guidance needed'
                ],
                reasoning: `Searched sitemap.xml but found no pages matching keywords: ${extractKeywords(issue).join(', ')}`,
                developerImpact: `${issue.frequency} developers affected - reporting this issue since ${issue.lastSeen}`
            });
            return {
                issueId: issue.id,
                issueTitle: issue.title,
                status: 'critical-gap',
                evidence,
                missingElements: ['Complete documentation page'],
                potentialGaps,
                criticalGaps,
                confidence: 95,
                recommendations: [
                    `Create new documentation page addressing: ${issue.title}`,
                    `Include code examples for ${issue.category}`,
                    `Add troubleshooting section`,
                    `Reference: ${issue.sources[0]}`
                ]
            };
        }
        // Fetch and analyze each page
        for (const page of pagesToCheck) {
            const content = yield fetchPageContent(domain, page.url);
            if (!content) {
                console.log(`⚠️ Failed to fetch page: ${page.url}`);
                continue;
            }
            const pageEvidence = analyzePageContent(content, issue, page.url, page.similarity);
            evidence.push(pageEvidence);
            // Content gaps are already shown in the Evidence section, no need to duplicate
            // if (!pageEvidence.hasRelevantContent || pageEvidence.contentGaps.length > 0) {
            //     console.log(`⚠️ POTENTIAL GAP: ${page.url} exists but missing content`);
            //     potentialGaps.push({
            //         gapType: 'potential-gap',
            //         pageUrl: page.url,
            //         pageTitle: pageEvidence.pageTitle,
            //         missingContent: pageEvidence.contentGaps,
            //         reasoning: `Rich content analysis suggests relevance to "${issue.title}" but lacks specific content`,
            //         developerImpact: `Developers searching for "${issue.title}" would find this page but not get complete solution`
            //     });
            // }
            missingElements.push(...pageEvidence.contentGaps);
        }
        // Determine overall status
        // Be conservative: Don't mark as "resolved" unless we're very confident
        // the documentation addresses the CORE problem, not just mentions related keywords
        // Debug logging
        console.log(`\n=== Status Determination Debug ===`);
        evidence.forEach((e, idx) => {
            console.log(`Evidence ${idx + 1}: ${e.pageUrl}`);
            console.log(`  - hasRelevantContent: ${e.hasRelevantContent}`);
            console.log(`  - contentGaps.length: ${e.contentGaps.length}`);
            console.log(`  - contentGaps: ${JSON.stringify(e.contentGaps)}`);
            console.log(`  - semanticScore: ${e.semanticScore}`);
        });
        const hasCompleteContent = evidence.some(e => e.hasRelevantContent &&
            e.contentGaps.length === 0 &&
            e.semanticScore && e.semanticScore > 0.85 // High confidence threshold
        );
        const hasSomeContent = evidence.some(e => e.hasRelevantContent);
        console.log(`hasCompleteContent: ${hasCompleteContent}`);
        console.log(`hasSomeContent: ${hasSomeContent}`);
        let status;
        let confidence;
        if (hasCompleteContent) {
            status = 'resolved';
            confidence = 90;
            console.log(`✅ RESOLVED: Issue appears to be addressed in documentation (high confidence)`);
        }
        else if (evidence.some(e => e.semanticScore && e.semanticScore > 0.6)) {
            // Good semantic match but not perfect - likely a potential gap
            status = 'potential-gap';
            confidence = 75;
            console.log(`⚠️ POTENTIAL GAP: Relevant pages exist but may not fully address the issue`);
        }
        else if (hasSomeContent) {
            status = 'confirmed';
            confidence = 70;
            console.log(`❌ CONFIRMED: Issue exists, documentation is incomplete`);
        }
        else {
            status = 'critical-gap';
            confidence = 85;
            console.log(`❌ CRITICAL GAP: No relevant content found`);
        }
        // Generate detailed recommendations using AI analysis (for all statuses)
        const recommendations = yield generateDetailedRecommendations(issue, evidence, status, domain);
        return {
            issueId: issue.id,
            issueTitle: issue.title,
            status,
            evidence,
            missingElements: [...new Set(missingElements)],
            potentialGaps,
            criticalGaps,
            confidence,
            recommendations
        };
    });
}
/**
 * Generate detailed, actionable recommendations using AI analysis
 */
function generateDetailedRecommendations(issue, evidence, status, domain) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Get the best matching page (highest semantic score)
            const bestMatch = evidence.reduce((best, current) => {
                const bestScore = best.semanticScore || 0;
                const currentScore = current.semanticScore || 0;
                return currentScore > bestScore ? current : best;
            }, evidence[0]);
            if (!bestMatch || !bestMatch.semanticScore || bestMatch.semanticScore < 0.5) {
                // No good match, return generic recommendations
                console.log(`❌ No good semantic match found. bestMatch: ${!!bestMatch}, semanticScore: ${bestMatch === null || bestMatch === void 0 ? void 0 : bestMatch.semanticScore}`);
                return [
                    `Create new documentation page addressing: ${issue.title}`,
                    `Include code examples for ${issue.category}`,
                    `Add troubleshooting section for common errors`,
                    `Reference: ${issue.sources[0]}`
                ];
            }
            // For resolved issues, still generate recommendations for improvements
            console.log(`🔍 Generating recommendations for issue: ${issue.id} (status: ${status})`);
            console.log(`📊 Best match: ${bestMatch.pageUrl} (score: ${bestMatch.semanticScore})`);
            console.log(`✅ Proceeding with AI recommendation generation...`);
            // CRITICAL: Fetch the ACTUAL page content to analyze existing code
            console.log(`📄 Fetching actual page content from: ${domain}${bestMatch.pageUrl}`);
            const pageContent = yield fetchPageContent(domain, bestMatch.pageUrl);
            if (!pageContent) {
                console.log(`❌ Failed to fetch page content, falling back to generic recommendations`);
                return [
                    `Update ${bestMatch.pageUrl} to address: ${issue.title}`,
                    `Add code examples for ${issue.category}`,
                    `Include troubleshooting section for common errors`,
                    `Reference: ${issue.sources[0]}`
                ];
            }
            // Extract code snippets from the page
            const codeSnippets = extractCodeSnippetsFromPage(pageContent);
            console.log(`📝 Extracted ${codeSnippets.length} code snippets from documentation page`);
            // Build context for AI analysis
            const issueContext = `
Issue Title: ${issue.title}
Category: ${issue.category}
Description: ${issue.description}
Error Messages: ${((_a = issue.errorMessages) === null || _a === void 0 ? void 0 : _a.join(', ')) || 'None'}
Tags: ${((_b = issue.tags) === null || _b === void 0 ? void 0 : _b.join(', ')) || 'None'}
Code Snippets from Developer Issue: ${((_c = issue.codeSnippets) === null || _c === void 0 ? void 0 : _c.length) || 0} snippets found
${issue.codeSnippets ? issue.codeSnippets.map((snippet, i) => `\nSnippet ${i + 1}:\n\`\`\`\n${snippet}\n\`\`\``).join('\n') : ''}
Full Content Preview: ${((_d = issue.fullContent) === null || _d === void 0 ? void 0 : _d.substring(0, 1000)) || 'Not available'}
Source: ${issue.sources[0]}
`.trim();
            const docContext = `
Page URL: ${bestMatch.pageUrl}
Page Title: ${bestMatch.pageTitle}
Semantic Match Score: ${(bestMatch.semanticScore * 100).toFixed(1)}%
Has Code Examples: ${bestMatch.codeExamples > 0 ? 'Yes' : 'No'}
Has Production Guidance: ${bestMatch.productionGuidance ? 'Yes' : 'No'}
Content Gaps: ${bestMatch.contentGaps.join(', ')}

EXISTING CODE ON DOCUMENTATION PAGE:
${codeSnippets.length > 0 ? codeSnippets.map((snippet, i) => `\nCode Example ${i + 1}:\n\`\`\`${snippet.language || 'typescript'}\n${snippet.code}\n\`\`\``).join('\n') : 'No code examples found on page'}
`.trim();
            const prompt = `You are a technical documentation expert analyzing a developer issue.

DEVELOPER ISSUE:
- Title: ${issue.title}
- Description: ${issue.description}
- Error: ${((_e = issue.errorMessages) === null || _e === void 0 ? void 0 : _e[0]) || 'N/A'}
- Source: ${issue.sources[0]}

DOCUMENTATION PAGE: ${bestMatch.pageUrl}
EXISTING CODE ON PAGE:
${codeSnippets.length > 0 ? codeSnippets.slice(0, 2).map((s, i) => `Example ${i + 1}:\n\`\`\`${s.language || 'typescript'}\n${s.code.substring(0, 500)}\n\`\`\``).join('\n\n') : 'No code examples found'}

YOUR TASK: Generate TWO detailed recommendations with COMPLETE code examples.

CRITICAL REQUIREMENTS:
1. Each recommendation MUST include a COMPLETE code block (40-60 lines minimum)
2. Code must be COPY-PASTE READY - no placeholders, no "// ... rest of code"
3. Include ALL imports, ALL error handling, ALL edge cases
4. Show BEFORE (existing doc code) and AFTER (improved code) comparison

OUTPUT FORMAT (follow exactly):

## Recommendation 1: [Descriptive Title]

**Problem:** [2-3 sentences explaining what's missing in current docs]

**Current Documentation Code (BEFORE):**
\`\`\`typescript
// Show the existing code from documentation that needs improvement
\`\`\`

**Improved Code (AFTER) - Add this to documentation:**
\`\`\`typescript
// COMPLETE 40-60 line code example here
// Include: 'use server' directive, all imports, type definitions
// Include: input validation, environment checks
// Include: try/catch with specific error messages
// Include: success/error return types
// Include: helpful comments explaining each section
\`\`\`

**Why This Helps Developers:** [2-3 sentences]

---

## Recommendation 2: [Descriptive Title]

**Problem:** [2-3 sentences]

**Current Documentation Code (BEFORE):**
\`\`\`typescript
// Existing code
\`\`\`

**Improved Code (AFTER) - Add this to documentation:**
\`\`\`typescript
// Another COMPLETE 40-60 line code example
// Different aspect of the issue (e.g., form integration, debugging)
\`\`\`

**Why This Helps Developers:** [2-3 sentences]

---

REMEMBER: Your response should be approximately 3000-4000 characters total. Do NOT be brief. Include FULL, WORKING code that developers can copy directly.`;
            console.log(`🚀 Calling Bedrock to generate recommendations...`);
            console.log(`🤖 Model ID: us.anthropic.claude-sonnet-4-5-20250929-v1:0`);
            console.log(`📝 Prompt length: ${prompt.length} characters`);
            console.log(`🔍 Issue context length: ${issueContext.length} characters`);
            console.log(`📄 Doc context length: ${docContext.length} characters`);
            // Implement continuation logic for truncated responses
            let fullRecommendationsText = '';
            let conversationHistory = [
                { role: 'user', content: prompt }
            ];
            let attemptCount = 0;
            const maxAttempts = 5; // Increased to 5 continuation attempts
            let wasTruncated = false;
            do {
                attemptCount++;
                console.log(`📡 API call attempt ${attemptCount}/${maxAttempts}...`);
                const input = {
                    modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
                    contentType: 'application/json',
                    accept: 'application/json',
                    body: JSON.stringify({
                        anthropic_version: 'bedrock-2023-05-31',
                        max_tokens: 4096,
                        temperature: 0.3,
                        messages: conversationHistory
                    })
                };
                const command = new client_bedrock_runtime_1.InvokeModelCommand(input);
                const response = yield bedrockClient.send(command);
                console.log(`✅ Bedrock response received (attempt ${attemptCount})`);
                const responseBody = JSON.parse(new TextDecoder().decode(response.body));
                // Log detailed response info
                console.log(`📋 Response body keys: ${Object.keys(responseBody).join(', ')}`);
                console.log(`🛑 Stop reason: ${responseBody.stop_reason}`);
                console.log(`📊 Usage: input_tokens=${(_f = responseBody.usage) === null || _f === void 0 ? void 0 : _f.input_tokens}, output_tokens=${(_g = responseBody.usage) === null || _g === void 0 ? void 0 : _g.output_tokens}`);
                const partialText = responseBody.content[0].text;
                fullRecommendationsText += partialText;
                console.log(`📝 Partial response length: ${partialText.length} chars`);
                console.log(`📊 Total accumulated length: ${fullRecommendationsText.length} chars`);
                // Check if response was truncated
                wasTruncated = responseBody.stop_reason === 'max_tokens';
                if (wasTruncated) {
                    console.warn(`⚠️ Response ${attemptCount} was truncated (stop_reason: max_tokens)`);
                    console.log(`🔄 Attempting continuation...`);
                    // Add the assistant's response to conversation history
                    conversationHistory.push({
                        role: 'assistant',
                        content: partialText
                    });
                    // Add a continuation prompt
                    conversationHistory.push({
                        role: 'user',
                        content: 'Please continue from where you left off. Complete the code example and explanation.'
                    });
                }
                else {
                    console.log(`✅ Response ${attemptCount} completed naturally (stop_reason: ${responseBody.stop_reason})`);
                }
            } while (wasTruncated && attemptCount < maxAttempts);
            if (wasTruncated && attemptCount >= maxAttempts) {
                console.warn(`⚠️ Reached maximum continuation attempts (${maxAttempts}). Response may still be incomplete.`);
            }
            const recommendationsText = fullRecommendationsText;
            console.log(`📝 Final AI recommendations (${recommendationsText.length} chars total from ${attemptCount} API calls)`);
            console.log(`📄 Full response preview (first 500 chars): ${recommendationsText.substring(0, 500)}...`);
            console.log(`📄 Full response preview (last 500 chars): ...${recommendationsText.substring(recommendationsText.length - 500)}`);
            // Parse recommendations - preserve code blocks by splitting on double newlines or numbered lists
            // Split by patterns like "1. ", "2. ", etc. or double newlines
            const recommendations = [];
            const lines = recommendationsText.split('\n');
            let currentRec = '';
            for (const line of lines) {
                // Check if line starts with a number (1., 2., etc.) - new recommendation
                if (line.match(/^\d+\.\s/)) {
                    if (currentRec.trim()) {
                        recommendations.push(currentRec.trim());
                    }
                    currentRec = line.replace(/^\d+\.\s/, ''); // Remove numbering
                }
                else {
                    // Continue current recommendation (including code blocks)
                    if (currentRec || line.trim()) {
                        currentRec += (currentRec ? '\n' : '') + line;
                    }
                }
            }
            // Add the last recommendation
            if (currentRec.trim()) {
                recommendations.push(currentRec.trim());
            }
            console.log(`✅ Generated ${recommendations.length} AI recommendations successfully`);
            return recommendations.slice(0, 5); // Limit to 5 recommendations
        }
        catch (error) {
            console.error('❌ Failed to generate AI recommendations:', error);
            if (error instanceof Error) {
                console.error('🔍 Error details:', {
                    name: error.name,
                    message: error.message,
                    code: error.code,
                    statusCode: (_h = error.$metadata) === null || _h === void 0 ? void 0 : _h.httpStatusCode,
                    requestId: (_j = error.$metadata) === null || _j === void 0 ? void 0 : _j.requestId,
                    stack: error.stack
                });
            }
            console.log(`🔄 Falling back to generic recommendations`);
            // Enhanced fallback recommendations with more specific content
            const fallbackRecommendations = [
                `Add troubleshooting section for "${issue.title}" with specific error handling`,
                `Include code examples addressing ${issue.category} issues`,
                `Add production deployment guidance for common ${issue.category} problems`,
                `Reference developer issue: ${issue.sources[0]}`
            ];
            console.log(`📝 Using enhanced fallback recommendations: ${fallbackRecommendations.length} items`);
            return fallbackRecommendations;
        }
    });
}
/**
 * Make HTTP request
 */
function makeHttpRequest(url) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            const urlObj = new url_1.URL(url);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Lensy-Documentation-Auditor/1.0'
                }
            };
            const req = https_1.default.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.end();
        });
    });
}
/**
 * Store validation results in S3
 */
function storeValidationResults(sessionId, results) {
    return __awaiter(this, void 0, void 0, function* () {
        const bucketName = process.env.S3_BUCKET_NAME;
        if (!bucketName) {
            throw new Error('S3_BUCKET_NAME environment variable not set');
        }
        const key = `sessions/${sessionId}/issue-validation-results.json`;
        const content = JSON.stringify(results, null, 2);
        yield s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: content,
            ContentType: 'application/json'
        }));
        console.log(`Stored validation results in S3: ${key}`);
    });
}
/**
 * Perform sitemap health check for the given domain with caching
 */
function performSitemapHealthCheck(domain, sessionId) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const bucketName = process.env.S3_BUCKET_NAME;
        if (!bucketName) {
            console.error('S3_BUCKET_NAME environment variable not set');
            return null;
        }
        try {
            console.log(`🔍 Starting sitemap health check for domain: ${domain}`);
            // Domain-specific cache key (similar to embeddings)
            const cacheKey = `sitemap-health-${domain.replace(/\./g, '-')}.json`;
            console.log(`📦 Cache key: ${cacheKey}`);
            // Try to load cached health results from S3
            try {
                console.log('🔍 Checking for cached sitemap health results...');
                const getCommand = new client_s3_1.GetObjectCommand({
                    Bucket: bucketName,
                    Key: cacheKey
                });
                const response = yield s3Client.send(getCommand);
                const cachedData = yield ((_a = response.Body) === null || _a === void 0 ? void 0 : _a.transformToString());
                if (cachedData) {
                    const cachedHealth = JSON.parse(cachedData);
                    console.log(`✅ Using cached sitemap health results (${cachedHealth.totalUrls} URLs, ${cachedHealth.healthPercentage}% healthy)`);
                    console.log(`📅 Cache timestamp: ${cachedHealth.timestamp}`);
                    return cachedHealth;
                }
            }
            catch (error) {
                console.log('📝 No cached results found, performing fresh health check...');
            }
            // Get domain-specific sitemap URL and doc filter
            const config = DOMAIN_SITEMAP_CONFIG[domain];
            const sitemapUrl = config ? config.sitemapUrl : `https://${domain}/sitemap.xml`;
            const docFilter = config ? config.docFilter : '/docs';
            console.log(`📄 Checking sitemap: ${sitemapUrl} (filtering for: ${docFilter})`);
            // Step 1: Invoke SitemapParser Lambda
            const sitemapParserPayload = {
                url: sitemapUrl,
                sessionId: sessionId,
                inputType: 'sitemap'
            };
            console.log(`🚀 Invoking SitemapParser Lambda...`);
            const parserResult = yield lambdaClient.send(new client_lambda_1.InvokeCommand({
                FunctionName: 'LensyStack-SitemapParserFunction1A007DF9-9qoTADYi7kCm',
                Payload: JSON.stringify(sitemapParserPayload)
            }));
            if (!parserResult.Payload) {
                throw new Error('No response from SitemapParser');
            }
            const parserResponse = JSON.parse(new TextDecoder().decode(parserResult.Payload));
            console.log(`📊 SitemapParser result: ${parserResponse.success ? 'SUCCESS' : 'FAILED'}`);
            if (!parserResponse.success) {
                console.log(`❌ SitemapParser failed: ${parserResponse.message}`);
                return null;
            }
            // Filter URLs to only include documentation pages
            const allUrls = parserResponse.sitemapUrls || [];
            // URLs might be full URLs or paths, handle both cases
            const docUrls = allUrls.filter((url) => {
                // Extract path from full URL if needed
                const path = url.startsWith('http') ? new url_1.URL(url).pathname : url;
                return path.startsWith(docFilter);
            });
            console.log(`📋 Filtered to ${docUrls.length} documentation URLs from ${allUrls.length} total URLs`);
            // Create filtered parser response with correct field names for SitemapHealthChecker
            const filteredParserResponse = Object.assign(Object.assign({}, parserResponse), { sitemapUrls: docUrls, totalUrls: docUrls.length });
            // Step 2: Invoke SitemapHealthChecker Lambda with filtered URLs
            const healthCheckerPayload = {
                sessionId: sessionId,
                sitemapParserResult: {
                    Payload: filteredParserResponse
                }
            };
            console.log(`🚀 Invoking SitemapHealthChecker Lambda...`);
            const healthResult = yield lambdaClient.send(new client_lambda_1.InvokeCommand({
                FunctionName: 'LensyStack-SitemapHealthCheckerFunctionB23E4F53-R83DOg6Gh0LY',
                Payload: JSON.stringify(healthCheckerPayload)
            }));
            if (!healthResult.Payload) {
                throw new Error('No response from SitemapHealthChecker');
            }
            const healthResponse = JSON.parse(new TextDecoder().decode(healthResult.Payload));
            console.log(`📊 SitemapHealthChecker result: ${healthResponse.success ? 'SUCCESS' : 'FAILED'}`);
            if (!healthResponse.success) {
                console.log(`❌ SitemapHealthChecker failed: ${healthResponse.message}`);
                return null;
            }
            // Return the health summary with breakdown counts
            const healthSummary = Object.assign(Object.assign({}, healthResponse.healthSummary), { brokenUrls: healthResponse.brokenUrls, accessDeniedUrls: healthResponse.accessDeniedUrls, timeoutUrls: healthResponse.timeoutUrls, otherErrorUrls: healthResponse.otherErrorUrls });
            console.log(`✅ Sitemap health check complete: ${healthSummary.healthyUrls}/${healthSummary.totalUrls} URLs healthy (${healthSummary.healthPercentage}%)`);
            console.log(`📊 Breakdown: ${healthSummary.brokenUrls} broken, ${healthSummary.accessDeniedUrls} access denied, ${healthSummary.timeoutUrls} timeout, ${healthSummary.otherErrorUrls} other errors`);
            // Store health results in domain-specific cache
            try {
                const putCommand = new client_s3_1.PutObjectCommand({
                    Bucket: bucketName,
                    Key: cacheKey,
                    Body: JSON.stringify(healthSummary, null, 2),
                    ContentType: 'application/json'
                });
                yield s3Client.send(putCommand);
                console.log(`💾 Cached sitemap health results to: ${cacheKey}`);
            }
            catch (error) {
                console.error('⚠️ Failed to cache sitemap health results:', error);
                // Don't fail the whole operation if caching fails
            }
            return healthSummary;
        }
        catch (error) {
            console.error('❌ Sitemap health check failed:', error);
            return null;
        }
    });
}
const handler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    const startTime = Date.now();
    try {
        console.log('IssueValidator Lambda started', { event: JSON.stringify(event) });
        // Parse input
        const input = typeof event.body === 'string'
            ? JSON.parse(event.body)
            : event.body;
        const { issues, domain, sessionId } = input;
        if (!issues || !domain || !sessionId) {
            throw new Error('Missing required parameters: issues, domain, and sessionId');
        }
        console.log(`Validating ${issues.length} issues for domain: ${domain}`);
        // Start both issue validation and sitemap health check in parallel
        const [validationResults, sitemapHealth] = yield Promise.all([
            // Issue validation (existing logic)
            Promise.all(issues.map(issue => validateIssue(issue, domain))),
            // Sitemap health check (new logic)
            performSitemapHealthCheck(domain, sessionId)
        ]);
        console.log(`✅ Issue validation completed: ${validationResults.length} issues processed`);
        if (sitemapHealth) {
            console.log(`✅ Sitemap health check completed: ${sitemapHealth.healthyUrls}/${sitemapHealth.totalUrls} URLs healthy`);
        }
        else {
            console.log(`⚠️ Sitemap health check skipped or failed`);
        }
        // Calculate summary
        const summary = {
            totalIssues: validationResults.length,
            confirmed: validationResults.filter(r => r.status === 'confirmed').length,
            resolved: validationResults.filter(r => r.status === 'resolved').length,
            potentialGaps: validationResults.filter(r => r.status === 'potential-gap').length,
            criticalGaps: validationResults.filter(r => r.status === 'critical-gap').length
        };
        const processingTime = Date.now() - startTime;
        const output = {
            validationResults,
            summary,
            processingTime,
            sitemapHealth: sitemapHealth || undefined // Include sitemap health if available
        };
        // Store results in S3
        yield storeValidationResults(sessionId, output);
        console.log(`IssueValidator completed in ${processingTime}ms`, summary);
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(output)
        };
    }
    catch (error) {
        console.error('IssueValidator error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Issue validation failed',
                message: error instanceof Error ? error.message : 'Unknown error',
                validationResults: [],
                summary: {
                    totalIssues: 0,
                    confirmed: 0,
                    resolved: 0,
                    potentialGaps: 0,
                    criticalGaps: 0
                },
                processingTime: Date.now() - startTime
            })
        };
    }
});
exports.handler = handler;
