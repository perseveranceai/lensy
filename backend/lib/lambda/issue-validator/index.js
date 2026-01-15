"use strict";
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
async function generateEmbedding(text) {
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
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.embedding;
    }
    catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
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
async function loadOrGenerateEmbeddings(domain) {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
        throw new Error('S3_BUCKET_NAME environment variable not set');
    }
    // Normalize domain for consistent configuration lookup
    const normalizedDomain = normalizeDomain(domain);
    console.log(`Loading embeddings for domain: ${domain} (normalized: ${normalizedDomain})`);
    // Domain-specific embeddings key to avoid cross-contamination
    const embeddingsKey = `rich-content-embeddings-${normalizedDomain.replace(/\./g, '-')}.json`;
    console.log(`Using domain-specific embeddings key: ${embeddingsKey}`);
    try {
        // Try to load existing embeddings from S3
        console.log('Loading existing embeddings from S3...');
        const getCommand = new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: embeddingsKey
        });
        const response = await s3Client.send(getCommand);
        const embeddingsData = await response.Body?.transformToString();
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
    const sitemap = await fetchSitemap(normalizedDomain);
    const docPages = sitemap.filter(url => url.startsWith('/docs/'));
    console.log(`Generating embeddings for ${docPages.length} documentation pages...`);
    const embeddings = [];
    for (const pagePath of docPages) {
        try {
            const html = await fetchPageContent(domain, pagePath);
            if (!html)
                continue;
            const { title, description, content } = extractPageContent(html);
            // Combine title, description, and content for embedding
            const textForEmbedding = `${title} ${description} ${content}`.trim();
            if (textForEmbedding.length < 10)
                continue; // Skip pages with minimal content
            const embedding = await generateEmbedding(textForEmbedding);
            embeddings.push({
                url: pagePath,
                title,
                description,
                content,
                embedding
            });
            console.log(`Generated embedding for: ${pagePath} (${title})`);
            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
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
        await s3Client.send(putCommand);
        console.log(`Stored ${embeddings.length} embeddings in S3`);
    }
    catch (error) {
        console.error('Failed to store embeddings in S3:', error);
    }
    return embeddings;
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
async function searchSitemapSemanticlyOptimized(issue, domain) {
    try {
        // Load pre-generated embeddings
        const embeddings = await loadOrGenerateEmbeddings(domain);
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
        const issueEmbedding = await generateEmbedding(issueText);
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
    },
    'docs.knock.app': {
        sitemapUrl: 'https://docs.knock.app/sitemap.xml',
        docFilter: '/'
    }
};
/**
 * Normalize domain to match configuration keys
 * Converts user-friendly domains to their canonical documentation domain
 */
function normalizeDomain(domain) {
    // Remove protocol and trailing slashes
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // Handle knock.app -> docs.knock.app conversion
    if (cleanDomain === 'knock.app') {
        return 'docs.knock.app';
    }
    // Return as-is for other domains
    return cleanDomain;
}
/**
 * Fetch sitemap.xml and extract URLs - Enhanced to support multiple domains
 */
async function fetchSitemap(domain) {
    // Get domain-specific configuration
    const config = DOMAIN_SITEMAP_CONFIG[domain];
    if (!config) {
        console.warn(`No sitemap configuration for domain: ${domain}, using default`);
        // Default fallback
        const defaultSitemapUrl = `https://${domain}/sitemap.xml`;
        console.log(`Fetching sitemap from: ${defaultSitemapUrl}`);
        try {
            const xml = await makeHttpRequest(defaultSitemapUrl);
            const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g) || [];
            const urls = urlMatches.map(match => {
                const url = match.replace(/<\/?loc>/g, '');
                try {
                    const urlObj = new url_1.URL(url);
                    return urlObj.pathname;
                }
                catch {
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
        const xml = await makeHttpRequest(config.sitemapUrl);
        // Extract URLs from sitemap XML
        const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g) || [];
        const urls = urlMatches.map(match => {
            const url = match.replace(/<\/?loc>/g, '');
            // Convert full URL to path
            try {
                const urlObj = new url_1.URL(url);
                return urlObj.pathname;
            }
            catch {
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
async function fetchPageContent(domain, path) {
    const url = `https://${domain}${path}`;
    console.log(`Fetching page content from: ${url}`);
    try {
        const content = await makeHttpRequest(url);
        return content;
    }
    catch (error) {
        console.error(`Failed to fetch page ${url}:`, error);
        return '';
    }
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
    // 2. Comprehensive: Match any <code> blocks that look like code (long or contains symbols)
    const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
    while ((match = codeRegex.exec(html)) !== null) {
        let code = match[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/<[^>]+>/g, ''); // Remove any nested tags
        const trimmedCode = code.trim();
        // Logic to distinguish real code snippets from small inline words
        const isLikelySnippet = trimmedCode.length > 40 ||
            trimmedCode.includes('{') ||
            trimmedCode.includes('=>') ||
            trimmedCode.includes(';') ||
            trimmedCode.includes('import ') ||
            trimmedCode.includes('const ');
        if (isLikelySnippet) {
            // Avoid duplicates with pre/code blocks
            if (!snippets.some(s => s.code === trimmedCode)) {
                snippets.push({ code: trimmedCode });
            }
        }
    }
    return snippets; // Return all snippets for maximum context
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
async function validateIssue(issue, domain) {
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
        const semanticResults = await searchSitemapSemanticlyOptimized(issue, domain);
        pagesToCheck = semanticResults;
        // Fallback to keyword search if semantic search fails
        if (pagesToCheck.length === 0) {
            console.log(`Semantic search failed, falling back to keyword search`);
            const sitemap = await fetchSitemap(domain);
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
        const content = await fetchPageContent(domain, page.url);
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
    const recommendations = await generateDetailedRecommendations(issue, evidence, status, domain);
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
}
/**
 * Generate detailed, actionable recommendations using AI analysis
 */
async function generateDetailedRecommendations(issue, evidence, status, domain) {
    try {
        // Get the best matching page (highest semantic score)
        const bestMatch = evidence.reduce((best, current) => {
            const bestScore = best.semanticScore || 0;
            const currentScore = current.semanticScore || 0;
            return currentScore > bestScore ? current : best;
        }, evidence[0]);
        if (!bestMatch || !bestMatch.semanticScore || bestMatch.semanticScore < 0.5) {
            // No good match, return generic recommendations
            console.log(`❌ No good semantic match found. bestMatch: ${!!bestMatch}, semanticScore: ${bestMatch?.semanticScore}`);
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
        const pageContent = await fetchPageContent(domain, bestMatch.pageUrl);
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
Error Messages: ${issue.errorMessages?.join(', ') || 'None'}
Tags: ${issue.tags?.join(', ') || 'None'}
Code Snippets from Developer Issue: ${issue.codeSnippets?.length || 0} snippets found
${issue.codeSnippets ? issue.codeSnippets.map((snippet, i) => `\nSnippet ${i + 1}:\n\`\`\`\n${snippet}\n\`\`\``).join('\n') : ''}
Full Content Preview: ${issue.fullContent?.substring(0, 1000) || 'Not available'}
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
        const prompt = `You are a technical documentation expert analyzing a developer issue for the Knock team.

DEVELOPER ISSUE:
- Title: ${issue.title}
- Description: ${issue.description}
- Error: ${issue.errorMessages?.[0] || 'N/A'}
- Source: ${issue.sources[0]}

DOCUMENTATION PAGE: ${bestMatch.pageUrl}
EXISTING CODE SNIPPETS ON PAGE (CONTEXT):
${codeSnippets.length > 0 ? codeSnippets.map((s, i) => `Snippet ${i + 1}:\n\`\`\`${s.language || 'typescript'}\n${s.code}\n\`\`\``).join('\n\n') : 'No code examples found'}

YOUR TASK: Identify exact gaps or errors based on the developer issue and recommend SURGICAL fixes for the existing code snippets. 

DO NOT generate a new "Master Implementation." Instead, provide updates that the documentation team can easily slot into their existing page layout.

CRITICAL REQUIREMENTS:
1. FOCUS on specific snippets: If the fix belongs in "Snippet 2", call it out clearly.
2. SURGICAL UPDATES: Only provide the code necessary to fix/improve that specific section. 
3. PRESERVE CONTEXT: Ensure the improved code fits perfectly into the existing documentation structure.
4. Show BEFORE (existing doc snippet) and AFTER (improved snippet) comparison.

OUTPUT FORMAT (follow exactly):

## Recommendation 1: [Target Snippet Name/Number] - [Short Fix Title]

**The Gap:** [1-2 sentences explaining why the current snippet causes the developer issue]

**Current Documentation (BEFORE):**
\`\`\`typescript
// SHOW the existing code from the page that is most relevant to this fix.
// Even if this is a "New Section", provide the code from the surrounding area as context so the user knows where to insert it.
// DO NOT use "// Missing Section" - always provide some context snippet from the page.
\`\`\`

**Surgical Improvement (AFTER) - Update this specific snippet:**
\`\`\`typescript
// The improved version of the snippet. 
// Keep it concise but functional.
// Include the specific fix (e.g., proper error handling, correct config field, or missing API parameter).
\`\`\`

**Why This Helps:** [1-2 sentences explaining how this unblocks developers]

---

## Recommendation 2: [Another Target Area] - [Short Fix Title]

**The Gap:** [1-2 sentences]

**Current Documentation (BEFORE):**
\`\`\`typescript
// Existing code or "Missing Section"
\`\`\`

**Improved Code (AFTER):**
\`\`\`typescript
// Targeted update
\`\`\`

**Why This Helps:** [1-2 sentences]

---

REMEMBER: Be surgical and efficient. The goal is to help the Knock team update their documentation with minimal friction.`;
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
            const response = await bedrockClient.send(command);
            console.log(`✅ Bedrock response received (attempt ${attemptCount})`);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            // Log detailed response info
            console.log(`📋 Response body keys: ${Object.keys(responseBody).join(', ')}`);
            console.log(`🛑 Stop reason: ${responseBody.stop_reason}`);
            console.log(`📊 Usage: input_tokens=${responseBody.usage?.input_tokens}, output_tokens=${responseBody.usage?.output_tokens}`);
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
                statusCode: error.$metadata?.httpStatusCode,
                requestId: error.$metadata?.requestId,
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
}
/**
 * Make HTTP request
 */
async function makeHttpRequest(url) {
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
}
/**
 * Store validation results in S3
 */
async function storeValidationResults(sessionId, results) {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
        throw new Error('S3_BUCKET_NAME environment variable not set');
    }
    const key = `sessions/${sessionId}/issue-validation-results.json`;
    const content = JSON.stringify(results, null, 2);
    await s3Client.send(new client_s3_1.PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: content,
        ContentType: 'application/json'
    }));
    console.log(`Stored validation results in S3: ${key}`);
}
/**
 * Perform sitemap health check for the given domain with caching
 */
async function performSitemapHealthCheck(domain, sessionId) {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
        console.error('S3_BUCKET_NAME environment variable not set');
        return null;
    }
    try {
        // Normalize domain for consistent configuration lookup
        const normalizedDomain = normalizeDomain(domain);
        console.log(`🔍 Starting sitemap health check for domain: ${domain} (normalized: ${normalizedDomain})`);
        // Domain-specific cache key (similar to embeddings)
        const cacheKey = `sitemap-health-${normalizedDomain.replace(/\./g, '-')}.json`;
        console.log(`📦 Cache key: ${cacheKey}`);
        // Try to load cached health results from S3
        try {
            console.log('🔍 Checking for cached sitemap health results...');
            const getCommand = new client_s3_1.GetObjectCommand({
                Bucket: bucketName,
                Key: cacheKey
            });
            const response = await s3Client.send(getCommand);
            const cachedData = await response.Body?.transformToString();
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
        const config = DOMAIN_SITEMAP_CONFIG[normalizedDomain];
        const sitemapUrl = config ? config.sitemapUrl : `https://${normalizedDomain}/sitemap.xml`;
        const docFilter = config ? config.docFilter : '/docs';
        console.log(`📄 Checking sitemap: ${sitemapUrl} (filtering for: ${docFilter})`);
        // Step 1: Invoke SitemapParser Lambda
        const sitemapParserPayload = {
            url: sitemapUrl,
            sessionId: sessionId,
            inputType: 'sitemap'
        };
        console.log(`🚀 Invoking SitemapParser Lambda...`);
        const parserResult = await lambdaClient.send(new client_lambda_1.InvokeCommand({
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
        const filteredParserResponse = {
            ...parserResponse,
            sitemapUrls: docUrls,
            totalUrls: docUrls.length
        };
        // Step 2: Invoke SitemapHealthChecker Lambda with filtered URLs
        const healthCheckerPayload = {
            sessionId: sessionId,
            sitemapParserResult: {
                Payload: filteredParserResponse
            }
        };
        console.log(`🚀 Invoking SitemapHealthChecker Lambda...`);
        const healthResult = await lambdaClient.send(new client_lambda_1.InvokeCommand({
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
        const healthSummary = {
            ...healthResponse.healthSummary,
            brokenUrls: healthResponse.brokenUrls,
            accessDeniedUrls: healthResponse.accessDeniedUrls,
            timeoutUrls: healthResponse.timeoutUrls,
            otherErrorUrls: healthResponse.otherErrorUrls
        };
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
            await s3Client.send(putCommand);
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
}
const handler = async (event) => {
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
        const [validationResults, sitemapHealth] = await Promise.all([
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
        await storeValidationResults(sessionId, output);
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
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9sYW1iZGEvaXNzdWUtdmFsaWRhdG9yL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUNBLGtEQUFrRjtBQUNsRiw0RUFBMkY7QUFDM0YsMERBQXFFO0FBQ3JFLGtEQUEwQjtBQUMxQiw2QkFBMEI7QUFFMUIsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNsRSxNQUFNLGFBQWEsR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxvQ0FBb0M7QUFDN0csTUFBTSxZQUFZLEdBQUcsSUFBSSw0QkFBWSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQWtHMUU7O0dBRUc7QUFDSCxLQUFLLFVBQVUsaUJBQWlCLENBQUMsSUFBWTtJQUN6QyxJQUFJO1FBQ0EsTUFBTSxLQUFLLEdBQUc7WUFDVixPQUFPLEVBQUUsNEJBQTRCO1lBQ3JDLFdBQVcsRUFBRSxrQkFBa0I7WUFDL0IsTUFBTSxFQUFFLGtCQUFrQjtZQUMxQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsU0FBUyxFQUFFLElBQUk7YUFDbEIsQ0FBQztTQUNMLENBQUM7UUFFRixNQUFNLE9BQU8sR0FBRyxJQUFJLDJDQUFrQixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLE1BQU0sYUFBYSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVuRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksV0FBVyxFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFD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Q0FBQyxTQUFTLENBQUM7Z0JBQ2pCLEtBQUssRUFBRSx5QkFBeUI7Z0JBQ2hDLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlO2dCQUNqRSxpQkFBaUIsRUFBRSxFQUFFO2dCQUNyQixPQUFPLEVBQUU7b0JBQ0wsV0FBVyxFQUFFLENBQUM7b0JBQ2QsU0FBUyxFQUFFLENBQUM7b0JBQ1osUUFBUSxFQUFFLENBQUM7b0JBQ1gsYUFBYSxFQUFFLENBQUM7b0JBQ2hCLFlBQVksRUFBRSxDQUFDO2lCQUNsQjtnQkFDRCxjQUFjLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVM7YUFDekMsQ0FBQztTQUNMLENBQUM7S0FDTDtBQUNMLENBQUMsQ0FBQztBQTFGVyxRQUFBLE9BQU8sV0EwRmxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQsIFB1dE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgQmVkcm9ja1J1bnRpbWVDbGllbnQsIEludm9rZU1vZGVsQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1iZWRyb2NrLXJ1bnRpbWUnO1xuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XG5pbXBvcnQgaHR0cHMgZnJvbSAnaHR0cHMnO1xuaW1wb3J0IHsgVVJMIH0gZnJvbSAndXJsJztcblxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XG5jb25zdCBiZWRyb2NrQ2xpZW50ID0gbmV3IEJlZHJvY2tSdW50aW1lQ2xpZW50KHsgcmVnaW9uOiAndXMtZWFzdC0xJyB9KTsgLy8gQmVkcm9jayBpcyBhdmFpbGFibGUgaW4gdXMtZWFzdC0xXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xuXG5pbnRlcmZhY2UgRGlzY292ZXJlZElzc3VlIHtcbiAgICBpZDogc3RyaW5nO1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgY2F0ZWdvcnk6IHN0cmluZztcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAgIGZyZXF1ZW5jeTogbnVtYmVyO1xuICAgIHNvdXJjZXM6IHN0cmluZ1tdO1xuICAgIGxhc3RTZWVuOiBzdHJpbmc7XG4gICAgc2V2ZXJpdHk6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG4gICAgcmVsYXRlZFBhZ2VzOiBzdHJpbmdbXTtcbiAgICAvLyBSaWNoIGNvbnRlbnQgZnJvbSBzb3VyY2VcbiAgICBmdWxsQ29udGVudD86IHN0cmluZzsgIC8vIEZ1bGwgcXVlc3Rpb24vaXNzdWUgYm9keVxuICAgIGNvZGVTbmlwcGV0cz86IHN0cmluZ1tdOyAgLy8gQ29kZSBleGFtcGxlcyBmcm9tIHRoZSBpc3N1ZVxuICAgIGVycm9yTWVzc2FnZXM/OiBzdHJpbmdbXTsgIC8vIEV4dHJhY3RlZCBlcnJvciBtZXNzYWdlc1xuICAgIHRhZ3M/OiBzdHJpbmdbXTsgIC8vIFRlY2hub2xvZ3kgdGFnc1xuICAgIHN0YWNrVHJhY2U/OiBzdHJpbmc7ICAvLyBTdGFjayB0cmFjZXMgaWYgcHJlc2VudFxufVxuXG5pbnRlcmZhY2UgSXNzdWVWYWxpZGF0b3JJbnB1dCB7XG4gICAgaXNzdWVzOiBEaXNjb3ZlcmVkSXNzdWVbXTtcbiAgICBkb21haW46IHN0cmluZztcbiAgICBzZXNzaW9uSWQ6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEV2aWRlbmNlIHtcbiAgICBwYWdlVXJsOiBzdHJpbmc7XG4gICAgcGFnZVRpdGxlOiBzdHJpbmc7XG4gICAgaGFzUmVsZXZhbnRDb250ZW50OiBib29sZWFuO1xuICAgIGNvbnRlbnRHYXBzOiBzdHJpbmdbXTtcbiAgICBjb2RlRXhhbXBsZXM6IG51bWJlcjtcbiAgICBwcm9kdWN0aW9uR3VpZGFuY2U6IGJvb2xlYW47XG4gICAgc2VtYW50aWNTY29yZT86IG51bWJlcjsgLy8gU2VtYW50aWMgc2ltaWxhcml0eSBzY29yZSAoMC0xKVxufVxuXG5pbnRlcmZhY2UgR2FwQW5hbHlzaXMge1xuICAgIGdhcFR5cGU6ICdwb3RlbnRpYWwtZ2FwJyB8ICdjcml0aWNhbC1nYXAnIHwgJ3Jlc29sdmVkJztcbiAgICBwYWdlVXJsPzogc3RyaW5nO1xuICAgIHBhZ2VUaXRsZT86IHN0cmluZztcbiAgICBtaXNzaW5nQ29udGVudDogc3RyaW5nW107XG4gICAgcmVhc29uaW5nOiBzdHJpbmc7XG4gICAgZGV2ZWxvcGVySW1wYWN0OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBWYWxpZGF0aW9uUmVzdWx0IHtcbiAgICBpc3N1ZUlkOiBzdHJpbmc7XG4gICAgaXNzdWVUaXRsZTogc3RyaW5nO1xuICAgIHN0YXR1czogJ2NvbmZpcm1lZCcgfCAncmVzb2x2ZWQnIHwgJ3BvdGVudGlhbC1nYXAnIHwgJ2NyaXRpY2FsLWdhcCc7XG4gICAgZXZpZGVuY2U6IEV2aWRlbmNlW107XG4gICAgbWlzc2luZ0VsZW1lbnRzOiBzdHJpbmdbXTtcbiAgICBwb3RlbnRpYWxHYXBzOiBHYXBBbmFseXNpc1tdO1xuICAgIGNyaXRpY2FsR2Fwczogc3RyaW5nW107XG4gICAgY29uZmlkZW5jZTogbnVtYmVyO1xuICAgIHJlY29tbWVuZGF0aW9uczogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBJc3N1ZVZhbGlkYXRvck91dHB1dCB7XG4gICAgdmFsaWRhdGlvblJlc3VsdHM6IFZhbGlkYXRpb25SZXN1bHRbXTtcbiAgICBzdW1tYXJ5OiB7XG4gICAgICAgIHRvdGFsSXNzdWVzOiBudW1iZXI7XG4gICAgICAgIGNvbmZpcm1lZDogbnVtYmVyO1xuICAgICAgICByZXNvbHZlZDogbnVtYmVyO1xuICAgICAgICBwb3RlbnRpYWxHYXBzOiBudW1iZXI7XG4gICAgICAgIGNyaXRpY2FsR2FwczogbnVtYmVyO1xuICAgIH07XG4gICAgcHJvY2Vzc2luZ1RpbWU6IG51bWJlcjtcbiAgICBzaXRlbWFwSGVhbHRoPzogU2l0ZW1hcEhlYWx0aFN1bW1hcnk7IC8vIE5FVzogT3B0aW9uYWwgc2l0ZW1hcCBoZWFsdGggZGF0YVxufVxuXG5pbnRlcmZhY2UgU2l0ZW1hcEhlYWx0aFN1bW1hcnkge1xuICAgIHRvdGFsVXJsczogbnVtYmVyO1xuICAgIGhlYWx0aHlVcmxzOiBudW1iZXI7XG4gICAgYnJva2VuVXJsczogbnVtYmVyO1xuICAgIGFjY2Vzc0RlbmllZFVybHM6IG51bWJlcjtcbiAgICB0aW1lb3V0VXJsczogbnVtYmVyO1xuICAgIG90aGVyRXJyb3JVcmxzOiBudW1iZXI7XG4gICAgbGlua0lzc3VlczogTGlua0lzc3VlW107XG4gICAgaGVhbHRoUGVyY2VudGFnZTogbnVtYmVyO1xuICAgIHByb2Nlc3NpbmdUaW1lOiBudW1iZXI7XG4gICAgdGltZXN0YW1wOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBMaW5rSXNzdWUge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHN0YXR1czogbnVtYmVyIHwgc3RyaW5nO1xuICAgIGVycm9yTWVzc2FnZTogc3RyaW5nO1xuICAgIGlzc3VlVHlwZTogJzQwNCcgfCAnYWNjZXNzLWRlbmllZCcgfCAndGltZW91dCcgfCAnZXJyb3InO1xufVxuXG5pbnRlcmZhY2UgUmljaENvbnRlbnRFbWJlZGRpbmcge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgICBjb250ZW50OiBzdHJpbmc7XG4gICAgZW1iZWRkaW5nOiBudW1iZXJbXTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBlbWJlZGRpbmcgZm9yIHRleHQgdXNpbmcgQW1hem9uIEJlZHJvY2sgVGl0YW5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVFbWJlZGRpbmcodGV4dDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXJbXT4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0ge1xuICAgICAgICAgICAgbW9kZWxJZDogJ2FtYXpvbi50aXRhbi1lbWJlZC10ZXh0LXYxJyxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBhY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBpbnB1dFRleHQ6IHRleHRcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VNb2RlbENvbW1hbmQoaW5wdXQpO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGJlZHJvY2tDbGllbnQuc2VuZChjb21tYW5kKTtcblxuICAgICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5ib2R5KSk7XG4gICAgICAgIHJldHVybiByZXNwb25zZUJvZHkuZW1iZWRkaW5nO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdlbmVyYXRpbmcgZW1iZWRkaW5nOicsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxufVxuXG4vKipcbiAqIEV4dHJhY3QgcGFnZSBjb250ZW50IGZyb20gSFRNTFxuICovXG5mdW5jdGlvbiBleHRyYWN0UGFnZUNvbnRlbnQoaHRtbDogc3RyaW5nKTogeyB0aXRsZTogc3RyaW5nOyBkZXNjcmlwdGlvbjogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfSB7XG4gICAgLy8gRXh0cmFjdCB0aXRsZVxuICAgIGNvbnN0IHRpdGxlTWF0Y2ggPSBodG1sLm1hdGNoKC88dGl0bGVbXj5dKj4oLio/KTxcXC90aXRsZT4vaSk7XG4gICAgY29uc3QgdGl0bGUgPSB0aXRsZU1hdGNoID8gdGl0bGVNYXRjaFsxXS50cmltKCkgOiAnJztcblxuICAgIC8vIEV4dHJhY3QgbWV0YSBkZXNjcmlwdGlvblxuICAgIGNvbnN0IGRlc2NNYXRjaCA9IGh0bWwubWF0Y2goLzxtZXRhW14+XSpuYW1lPVtcIiddZGVzY3JpcHRpb25bXCInXVtePl0qY29udGVudD1bXCInXShbXlwiJ10qPylbXCInXVtePl0qPi9pKTtcbiAgICBjb25zdCBkZXNjcmlwdGlvbiA9IGRlc2NNYXRjaCA/IGRlc2NNYXRjaFsxXS50cmltKCkgOiAnJztcblxuICAgIC8vIEV4dHJhY3QgbWFpbiBjb250ZW50IChyZW1vdmUgc2NyaXB0cywgc3R5bGVzLCBuYXYsIGZvb3RlcilcbiAgICBsZXQgY29udGVudCA9IGh0bWxcbiAgICAgICAgLnJlcGxhY2UoLzxzY3JpcHRbXj5dKj5bXFxzXFxTXSo/PFxcL3NjcmlwdD4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPHN0eWxlW14+XSo+W1xcc1xcU10qPzxcXC9zdHlsZT4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPG5hdltePl0qPltcXHNcXFNdKj88XFwvbmF2Pi9naSwgJycpXG4gICAgICAgIC5yZXBsYWNlKC88Zm9vdGVyW14+XSo+W1xcc1xcU10qPzxcXC9mb290ZXI+L2dpLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLzxoZWFkZXJbXj5dKj5bXFxzXFxTXSo/PFxcL2hlYWRlcj4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPGFzaWRlW14+XSo+W1xcc1xcU10qPzxcXC9hc2lkZT4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPFtePl0rPi9nLCAnICcpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKTtcblxuICAgIC8vIExpbWl0IGNvbnRlbnQgbGVuZ3RoIGZvciBlbWJlZGRpbmdcbiAgICBpZiAoY29udGVudC5sZW5ndGggPiA4MDAwKSB7XG4gICAgICAgIGNvbnRlbnQgPSBjb250ZW50LnN1YnN0cmluZygwLCA4MDAwKSArICcuLi4nO1xuICAgIH1cblxuICAgIHJldHVybiB7IHRpdGxlLCBkZXNjcmlwdGlvbiwgY29udGVudCB9O1xufVxuXG4vKipcbiAqIExvYWQgb3IgZ2VuZXJhdGUgZW1iZWRkaW5ncyBmb3IgYWxsIGRvY3VtZW50YXRpb24gcGFnZXNcbiAqL1xuYXN5bmMgZnVuY3Rpb24gbG9hZE9yR2VuZXJhdGVFbWJlZGRpbmdzKGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxSaWNoQ29udGVudEVtYmVkZGluZ1tdPiB7XG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LlMzX0JVQ0tFVF9OQU1FO1xuICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1MzX0JVQ0tFVF9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxpemUgZG9tYWluIGZvciBjb25zaXN0ZW50IGNvbmZpZ3VyYXRpb24gbG9va3VwXG4gICAgY29uc3Qgbm9ybWFsaXplZERvbWFpbiA9IG5vcm1hbGl6ZURvbWFpbihkb21haW4pO1xuICAgIGNvbnNvbGUubG9nKGBMb2FkaW5nIGVtYmVkZGluZ3MgZm9yIGRvbWFpbjogJHtkb21haW59IChub3JtYWxpemVkOiAke25vcm1hbGl6ZWREb21haW59KWApO1xuXG4gICAgLy8gRG9tYWluLXNwZWNpZmljIGVtYmVkZGluZ3Mga2V5IHRvIGF2b2lkIGNyb3NzLWNvbnRhbWluYXRpb25cbiAgICBjb25zdCBlbWJlZGRpbmdzS2V5ID0gYHJpY2gtY29udGVudC1lbWJlZGRpbmdzLSR7bm9ybWFsaXplZERvbWFpbi5yZXBsYWNlKC9cXC4vZywgJy0nKX0uanNvbmA7XG4gICAgY29uc29sZS5sb2coYFVzaW5nIGRvbWFpbi1zcGVjaWZpYyBlbWJlZGRpbmdzIGtleTogJHtlbWJlZGRpbmdzS2V5fWApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gVHJ5IHRvIGxvYWQgZXhpc3RpbmcgZW1iZWRkaW5ncyBmcm9tIFMzXG4gICAgICAgIGNvbnNvbGUubG9nKCdMb2FkaW5nIGV4aXN0aW5nIGVtYmVkZGluZ3MgZnJvbSBTMy4uLicpO1xuICAgICAgICBjb25zdCBnZXRDb21tYW5kID0gbmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBlbWJlZGRpbmdzS2V5XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChnZXRDb21tYW5kKTtcbiAgICAgICAgY29uc3QgZW1iZWRkaW5nc0RhdGEgPSBhd2FpdCByZXNwb25zZS5Cb2R5Py50cmFuc2Zvcm1Ub1N0cmluZygpO1xuXG4gICAgICAgIGlmIChlbWJlZGRpbmdzRGF0YSkge1xuICAgICAgICAgICAgY29uc3QgZW1iZWRkaW5nczogUmljaENvbnRlbnRFbWJlZGRpbmdbXSA9IEpTT04ucGFyc2UoZW1iZWRkaW5nc0RhdGEpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYExvYWRlZCAke2VtYmVkZGluZ3MubGVuZ3RofSBleGlzdGluZyBlbWJlZGRpbmdzIGZyb20gUzNgKTtcbiAgICAgICAgICAgIHJldHVybiBlbWJlZGRpbmdzO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05vIGV4aXN0aW5nIGVtYmVkZGluZ3MgZm91bmQsIGdlbmVyYXRpbmcgbmV3IG9uZXMuLi4nKTtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSBuZXcgZW1iZWRkaW5nc1xuICAgIGNvbnN0IHNpdGVtYXAgPSBhd2FpdCBmZXRjaFNpdGVtYXAobm9ybWFsaXplZERvbWFpbik7XG4gICAgY29uc3QgZG9jUGFnZXMgPSBzaXRlbWFwLmZpbHRlcih1cmwgPT4gdXJsLnN0YXJ0c1dpdGgoJy9kb2NzLycpKTtcbiAgICBjb25zb2xlLmxvZyhgR2VuZXJhdGluZyBlbWJlZGRpbmdzIGZvciAke2RvY1BhZ2VzLmxlbmd0aH0gZG9jdW1lbnRhdGlvbiBwYWdlcy4uLmApO1xuXG4gICAgY29uc3QgZW1iZWRkaW5nczogUmljaENvbnRlbnRFbWJlZGRpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBwYWdlUGF0aCBvZiBkb2NQYWdlcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgaHRtbCA9IGF3YWl0IGZldGNoUGFnZUNvbnRlbnQoZG9tYWluLCBwYWdlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWh0bWwpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBjb25zdCB7IHRpdGxlLCBkZXNjcmlwdGlvbiwgY29udGVudCB9ID0gZXh0cmFjdFBhZ2VDb250ZW50KGh0bWwpO1xuXG4gICAgICAgICAgICAvLyBDb21iaW5lIHRpdGxlLCBkZXNjcmlwdGlvbiwgYW5kIGNvbnRlbnQgZm9yIGVtYmVkZGluZ1xuICAgICAgICAgICAgY29uc3QgdGV4dEZvckVtYmVkZGluZyA9IGAke3RpdGxlfSAke2Rlc2NyaXB0aW9ufSAke2NvbnRlbnR9YC50cmltKCk7XG5cbiAgICAgICAgICAgIGlmICh0ZXh0Rm9yRW1iZWRkaW5nLmxlbmd0aCA8IDEwKSBjb250aW51ZTsgLy8gU2tpcCBwYWdlcyB3aXRoIG1pbmltYWwgY29udGVudFxuXG4gICAgICAgICAgICBjb25zdCBlbWJlZGRpbmcgPSBhd2FpdCBnZW5lcmF0ZUVtYmVkZGluZyh0ZXh0Rm9yRW1iZWRkaW5nKTtcblxuICAgICAgICAgICAgZW1iZWRkaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICB1cmw6IHBhZ2VQYXRoLFxuICAgICAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICAgIGNvbnRlbnQsXG4gICAgICAgICAgICAgICAgZW1iZWRkaW5nXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coYEdlbmVyYXRlZCBlbWJlZGRpbmcgZm9yOiAke3BhZ2VQYXRofSAoJHt0aXRsZX0pYCk7XG5cbiAgICAgICAgICAgIC8vIEFkZCBzbWFsbCBkZWxheSB0byBhdm9pZCByYXRlIGxpbWl0aW5nXG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7XG5cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBnZW5lcmF0ZSBlbWJlZGRpbmcgZm9yICR7cGFnZVBhdGh9OmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFN0b3JlIGVtYmVkZGluZ3MgaW4gUzNcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBwdXRDb21tYW5kID0gbmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBlbWJlZGRpbmdzS2V5LFxuICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkoZW1iZWRkaW5ncywgbnVsbCwgMiksXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQocHV0Q29tbWFuZCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBTdG9yZWQgJHtlbWJlZGRpbmdzLmxlbmd0aH0gZW1iZWRkaW5ncyBpbiBTM2ApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzdG9yZSBlbWJlZGRpbmdzIGluIFMzOicsIGVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZW1iZWRkaW5ncztcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGUgY29zaW5lIHNpbWlsYXJpdHkgYmV0d2VlbiB0d28gdmVjdG9yc1xuICovXG5mdW5jdGlvbiBjb3NpbmVTaW1pbGFyaXR5KGE6IG51bWJlcltdLCBiOiBudW1iZXJbXSk6IG51bWJlciB7XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZlY3RvcnMgbXVzdCBoYXZlIHRoZSBzYW1lIGxlbmd0aCcpO1xuICAgIH1cblxuICAgIGxldCBkb3RQcm9kdWN0ID0gMDtcbiAgICBsZXQgbm9ybUEgPSAwO1xuICAgIGxldCBub3JtQiA9IDA7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZG90UHJvZHVjdCArPSBhW2ldICogYltpXTtcbiAgICAgICAgbm9ybUEgKz0gYVtpXSAqIGFbaV07XG4gICAgICAgIG5vcm1CICs9IGJbaV0gKiBiW2ldO1xuICAgIH1cblxuICAgIG5vcm1BID0gTWF0aC5zcXJ0KG5vcm1BKTtcbiAgICBub3JtQiA9IE1hdGguc3FydChub3JtQik7XG5cbiAgICBpZiAobm9ybUEgPT09IDAgfHwgbm9ybUIgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRvdFByb2R1Y3QgLyAobm9ybUEgKiBub3JtQik7XG59XG5cbi8qKlxuICogU2VhcmNoIHNpdGVtYXAgdXNpbmcgc2VtYW50aWMgc2ltaWxhcml0eSAob3B0aW1pemVkIHZlcnNpb24pXG4gKiBSZXR1cm5zIGFycmF5IG9mIHt1cmwsIHRpdGxlLCBzaW1pbGFyaXR5fSBvYmplY3RzXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNlYXJjaFNpdGVtYXBTZW1hbnRpY2x5T3B0aW1pemVkKGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUsIGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxBcnJheTx7IHVybDogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyBzaW1pbGFyaXR5OiBudW1iZXIgfT4+IHtcbiAgICB0cnkge1xuICAgICAgICAvLyBMb2FkIHByZS1nZW5lcmF0ZWQgZW1iZWRkaW5nc1xuICAgICAgICBjb25zdCBlbWJlZGRpbmdzID0gYXdhaXQgbG9hZE9yR2VuZXJhdGVFbWJlZGRpbmdzKGRvbWFpbik7XG5cbiAgICAgICAgaWYgKGVtYmVkZGluZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gZW1iZWRkaW5ncyBhdmFpbGFibGUsIGZhbGxpbmcgYmFjayB0byBrZXl3b3JkIHNlYXJjaCcpO1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2VuZXJhdGUgZW1iZWRkaW5nIGZvciB0aGUgaXNzdWUgdXNpbmcgUklDSCBDT05URU5UXG4gICAgICAgIC8vIENvbWJpbmUgYWxsIGF2YWlsYWJsZSBmaWVsZHMgZm9yIG1heGltdW0gY29udGV4dFxuICAgICAgICBsZXQgaXNzdWVUZXh0ID0gYCR7aXNzdWUudGl0bGV9ICR7aXNzdWUuZGVzY3JpcHRpb259ICR7aXNzdWUuY2F0ZWdvcnl9YDtcblxuICAgICAgICAvLyBBZGQgcmljaCBjb250ZW50IGlmIGF2YWlsYWJsZVxuICAgICAgICBpZiAoaXNzdWUuZnVsbENvbnRlbnQpIHtcbiAgICAgICAgICAgIGlzc3VlVGV4dCArPSBgICR7aXNzdWUuZnVsbENvbnRlbnR9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBVc2luZyBmdWxsIGNvbnRlbnQgKCR7aXNzdWUuZnVsbENvbnRlbnQubGVuZ3RofSBjaGFycykgZm9yIHNlbWFudGljIG1hdGNoaW5nYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNzdWUuY29kZVNuaXBwZXRzICYmIGlzc3VlLmNvZGVTbmlwcGV0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBpc3N1ZVRleHQgKz0gYCAke2lzc3VlLmNvZGVTbmlwcGV0cy5qb2luKCcgJyl9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBJbmNsdWRpbmcgJHtpc3N1ZS5jb2RlU25pcHBldHMubGVuZ3RofSBjb2RlIHNuaXBwZXRzYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNzdWUuZXJyb3JNZXNzYWdlcyAmJiBpc3N1ZS5lcnJvck1lc3NhZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGlzc3VlVGV4dCArPSBgICR7aXNzdWUuZXJyb3JNZXNzYWdlcy5qb2luKCcgJyl9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBJbmNsdWRpbmcgJHtpc3N1ZS5lcnJvck1lc3NhZ2VzLmxlbmd0aH0gZXJyb3IgbWVzc2FnZXNgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc3N1ZS50YWdzICYmIGlzc3VlLnRhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgaXNzdWVUZXh0ICs9IGAgJHtpc3N1ZS50YWdzLmpvaW4oJyAnKX1gO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEluY2x1ZGluZyAke2lzc3VlLnRhZ3MubGVuZ3RofSB0YWdzOiAke2lzc3VlLnRhZ3Muam9pbignLCAnKX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc3N1ZS5zdGFja1RyYWNlKSB7XG4gICAgICAgICAgICBpc3N1ZVRleHQgKz0gYCAke2lzc3VlLnN0YWNrVHJhY2V9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBJbmNsdWRpbmcgc3RhY2sgdHJhY2VgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBUb3RhbCBpc3N1ZSB0ZXh0IGZvciBlbWJlZGRpbmc6ICR7aXNzdWVUZXh0Lmxlbmd0aH0gY2hhcnNgKTtcblxuICAgICAgICBjb25zdCBpc3N1ZUVtYmVkZGluZyA9IGF3YWl0IGdlbmVyYXRlRW1iZWRkaW5nKGlzc3VlVGV4dCk7XG5cbiAgICAgICAgLy8gQ2FsY3VsYXRlIHNpbWlsYXJpdGllc1xuICAgICAgICBjb25zdCBzaW1pbGFyaXRpZXM6IEFycmF5PHsgdXJsOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmc7IHNpbWlsYXJpdHk6IG51bWJlciB9PiA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgZW1iZWRkaW5nIG9mIGVtYmVkZGluZ3MpIHtcbiAgICAgICAgICAgIGNvbnN0IHNpbWlsYXJpdHkgPSBjb3NpbmVTaW1pbGFyaXR5KGlzc3VlRW1iZWRkaW5nLCBlbWJlZGRpbmcuZW1iZWRkaW5nKTtcbiAgICAgICAgICAgIHNpbWlsYXJpdGllcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB1cmw6IGVtYmVkZGluZy51cmwsXG4gICAgICAgICAgICAgICAgdGl0bGU6IGVtYmVkZGluZy50aXRsZSxcbiAgICAgICAgICAgICAgICBzaW1pbGFyaXR5XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNvcnQgYnkgc2ltaWxhcml0eSBhbmQgcmV0dXJuIHRvcCA1XG4gICAgICAgIHNpbWlsYXJpdGllcy5zb3J0KChhLCBiKSA9PiBiLnNpbWlsYXJpdHkgLSBhLnNpbWlsYXJpdHkpO1xuICAgICAgICBjb25zdCB0b3BQYWdlcyA9IHNpbWlsYXJpdGllcy5zbGljZSgwLCA1KTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgU2VtYW50aWMgc2VhcmNoIHJlc3VsdHMgZm9yIFwiJHtpc3N1ZS50aXRsZX1cIiAodXNpbmcgcmljaCBjb250ZW50KTpgKTtcbiAgICAgICAgdG9wUGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAke2luZGV4ICsgMX0uICR7cGFnZS51cmx9ICgke3BhZ2UudGl0bGV9KSAtIFNpbWlsYXJpdHk6ICR7cGFnZS5zaW1pbGFyaXR5LnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0b3BQYWdlcztcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1NlbWFudGljIHNlYXJjaCBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxufVxuXG4vKipcbiAqIEV4dHJhY3Qga2V5d29yZHMgZnJvbSBpc3N1ZSBmb3Igc2l0ZW1hcCBzZWFyY2hcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEtleXdvcmRzKGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgdGV4dCA9IGAke2lzc3VlLnRpdGxlfSAke2lzc3VlLmRlc2NyaXB0aW9ufSAke2lzc3VlLmNhdGVnb3J5fWAudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIENvbW1vbiBzdG9wIHdvcmRzIHRvIGZpbHRlciBvdXRcbiAgICBjb25zdCBzdG9wV29yZHMgPSBbJ3RoZScsICdhJywgJ2FuJywgJ2FuZCcsICdvcicsICdidXQnLCAnaW4nLCAnb24nLCAnYXQnLCAndG8nLCAnZm9yJywgJ29mJywgJ3dpdGgnLCAnaXMnLCAnYXJlJywgJ3dhcycsICd3ZXJlJywgJ2JlZW4nLCAnYmUnLCAnaGF2ZScsICdoYXMnLCAnaGFkJywgJ2RvJywgJ2RvZXMnLCAnZGlkJywgJ3dpbGwnLCAnd291bGQnLCAnc2hvdWxkJywgJ2NvdWxkJywgJ21heScsICdtaWdodCcsICdtdXN0JywgJ2NhbiddO1xuXG4gICAgLy8gRXh0cmFjdCB3b3JkcyAoYWxwaGFudW1lcmljLCAzKyBjaGFycylcbiAgICBjb25zdCB3b3JkcyA9IHRleHQubWF0Y2goL1xcYlthLXowLTldezMsfVxcYi9nKSB8fCBbXTtcblxuICAgIC8vIEZpbHRlciBzdG9wIHdvcmRzIGFuZCBkZWR1cGxpY2F0ZVxuICAgIGNvbnN0IGtleXdvcmRzID0gWy4uLm5ldyBTZXQod29yZHMuZmlsdGVyKHdvcmQgPT4gIXN0b3BXb3Jkcy5pbmNsdWRlcyh3b3JkKSkpXTtcblxuICAgIC8vIEFkZCBjYXRlZ29yeS1zcGVjaWZpYyBrZXl3b3Jkc1xuICAgIGNvbnN0IGNhdGVnb3J5S2V5d29yZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgICAgICAgJ2RlcGxveW1lbnQnOiBbJ2RlcGxveScsICdwcm9kdWN0aW9uJywgJ2Vudmlyb25tZW50JywgJ3ZlcmNlbCcsICduZXRsaWZ5JywgJ2hvc3RpbmcnXSxcbiAgICAgICAgJ2VtYWlsLWRlbGl2ZXJ5JzogWydlbWFpbCcsICdzcGFtJywgJ2RlbGl2ZXJhYmlsaXR5JywgJ2RucycsICdzcGYnLCAnZGtpbScsICdnbWFpbCddLFxuICAgICAgICAnYXBpLXVzYWdlJzogWydhcGknLCAnZW5kcG9pbnQnLCAncmVxdWVzdCcsICdyZXNwb25zZScsICdpbnRlZ3JhdGlvbiddLFxuICAgICAgICAnYXV0aGVudGljYXRpb24nOiBbJ2F1dGgnLCAna2V5JywgJ3Rva2VuJywgJ2NyZWRlbnRpYWwnLCAncGVybWlzc2lvbiddLFxuICAgICAgICAnZG9jdW1lbnRhdGlvbic6IFsnZG9jcycsICdndWlkZScsICd0dXRvcmlhbCcsICdleGFtcGxlJ11cbiAgICB9O1xuXG4gICAgaWYgKGlzc3VlLmNhdGVnb3J5ICYmIGNhdGVnb3J5S2V5d29yZHNbaXNzdWUuY2F0ZWdvcnldKSB7XG4gICAgICAgIGtleXdvcmRzLnB1c2goLi4uY2F0ZWdvcnlLZXl3b3Jkc1tpc3N1ZS5jYXRlZ29yeV0pO1xuICAgIH1cblxuICAgIHJldHVybiBbLi4ubmV3IFNldChrZXl3b3JkcyldO1xufVxuXG4vKipcbiAqIERvbWFpbi1zcGVjaWZpYyBzaXRlbWFwIGNvbmZpZ3VyYXRpb25cbiAqL1xuY29uc3QgRE9NQUlOX1NJVEVNQVBfQ09ORklHOiBSZWNvcmQ8c3RyaW5nLCB7IHNpdGVtYXBVcmw6IHN0cmluZzsgZG9jRmlsdGVyOiBzdHJpbmcgfT4gPSB7XG4gICAgJ3Jlc2VuZC5jb20nOiB7XG4gICAgICAgIHNpdGVtYXBVcmw6ICdodHRwczovL3Jlc2VuZC5jb20vZG9jcy9zaXRlbWFwLnhtbCcsXG4gICAgICAgIGRvY0ZpbHRlcjogJy9kb2NzLydcbiAgICB9LFxuICAgICdsaXZlYmxvY2tzLmlvJzoge1xuICAgICAgICBzaXRlbWFwVXJsOiAnaHR0cHM6Ly9saXZlYmxvY2tzLmlvL3NpdGVtYXAueG1sJyxcbiAgICAgICAgZG9jRmlsdGVyOiAnL2RvY3MnXG4gICAgfSxcbiAgICAnZG9jcy5rbm9jay5hcHAnOiB7XG4gICAgICAgIHNpdGVtYXBVcmw6ICdodHRwczovL2RvY3Mua25vY2suYXBwL3NpdGVtYXAueG1sJyxcbiAgICAgICAgZG9jRmlsdGVyOiAnLydcbiAgICB9XG59O1xuXG4vKipcbiAqIE5vcm1hbGl6ZSBkb21haW4gdG8gbWF0Y2ggY29uZmlndXJhdGlvbiBrZXlzXG4gKiBDb252ZXJ0cyB1c2VyLWZyaWVuZGx5IGRvbWFpbnMgdG8gdGhlaXIgY2Fub25pY2FsIGRvY3VtZW50YXRpb24gZG9tYWluXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZURvbWFpbihkb21haW46IHN0cmluZyk6IHN0cmluZyB7XG4gICAgLy8gUmVtb3ZlIHByb3RvY29sIGFuZCB0cmFpbGluZyBzbGFzaGVzXG4gICAgY29uc3QgY2xlYW5Eb21haW4gPSBkb21haW4ucmVwbGFjZSgvXmh0dHBzPzpcXC9cXC8vLCAnJykucmVwbGFjZSgvXFwvJC8sICcnKTtcblxuICAgIC8vIEhhbmRsZSBrbm9jay5hcHAgLT4gZG9jcy5rbm9jay5hcHAgY29udmVyc2lvblxuICAgIGlmIChjbGVhbkRvbWFpbiA9PT0gJ2tub2NrLmFwcCcpIHtcbiAgICAgICAgcmV0dXJuICdkb2NzLmtub2NrLmFwcCc7XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIGFzLWlzIGZvciBvdGhlciBkb21haW5zXG4gICAgcmV0dXJuIGNsZWFuRG9tYWluO1xufVxuXG4vKipcbiAqIEZldGNoIHNpdGVtYXAueG1sIGFuZCBleHRyYWN0IFVSTHMgLSBFbmhhbmNlZCB0byBzdXBwb3J0IG11bHRpcGxlIGRvbWFpbnNcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hTaXRlbWFwKGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIC8vIEdldCBkb21haW4tc3BlY2lmaWMgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGNvbmZpZyA9IERPTUFJTl9TSVRFTUFQX0NPTkZJR1tkb21haW5dO1xuXG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBObyBzaXRlbWFwIGNvbmZpZ3VyYXRpb24gZm9yIGRvbWFpbjogJHtkb21haW59LCB1c2luZyBkZWZhdWx0YCk7XG4gICAgICAgIC8vIERlZmF1bHQgZmFsbGJhY2tcbiAgICAgICAgY29uc3QgZGVmYXVsdFNpdGVtYXBVcmwgPSBgaHR0cHM6Ly8ke2RvbWFpbn0vc2l0ZW1hcC54bWxgO1xuICAgICAgICBjb25zb2xlLmxvZyhgRmV0Y2hpbmcgc2l0ZW1hcCBmcm9tOiAke2RlZmF1bHRTaXRlbWFwVXJsfWApO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB4bWwgPSBhd2FpdCBtYWtlSHR0cFJlcXVlc3QoZGVmYXVsdFNpdGVtYXBVcmwpO1xuICAgICAgICAgICAgY29uc3QgdXJsTWF0Y2hlcyA9IHhtbC5tYXRjaCgvPGxvYz4oLio/KTxcXC9sb2M+L2cpIHx8IFtdO1xuICAgICAgICAgICAgY29uc3QgdXJscyA9IHVybE1hdGNoZXMubWFwKG1hdGNoID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB1cmwgPSBtYXRjaC5yZXBsYWNlKC88XFwvP2xvYz4vZywgJycpO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwodXJsKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHVybE9iai5wYXRobmFtZTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHVybDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB1cmxzLmZpbHRlcih1cmwgPT4gdXJsLmluY2x1ZGVzKCcvZG9jcycpKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCBzaXRlbWFwOicsIGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBzaXRlbWFwIGZyb206ICR7Y29uZmlnLnNpdGVtYXBVcmx9IChmaWx0ZXJpbmcgZm9yOiAke2NvbmZpZy5kb2NGaWx0ZXJ9KWApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeG1sID0gYXdhaXQgbWFrZUh0dHBSZXF1ZXN0KGNvbmZpZy5zaXRlbWFwVXJsKTtcblxuICAgICAgICAvLyBFeHRyYWN0IFVSTHMgZnJvbSBzaXRlbWFwIFhNTFxuICAgICAgICBjb25zdCB1cmxNYXRjaGVzID0geG1sLm1hdGNoKC88bG9jPiguKj8pPFxcL2xvYz4vZykgfHwgW107XG4gICAgICAgIGNvbnN0IHVybHMgPSB1cmxNYXRjaGVzLm1hcChtYXRjaCA9PiB7XG4gICAgICAgICAgICBjb25zdCB1cmwgPSBtYXRjaC5yZXBsYWNlKC88XFwvP2xvYz4vZywgJycpO1xuICAgICAgICAgICAgLy8gQ29udmVydCBmdWxsIFVSTCB0byBwYXRoXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwodXJsKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdXJsT2JqLnBhdGhuYW1lO1xuICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHVybDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRmlsdGVyIHRvIG9ubHkgZG9jdW1lbnRhdGlvbiBwYWdlc1xuICAgICAgICBjb25zdCBkb2NVcmxzID0gdXJscy5maWx0ZXIodXJsID0+IHVybC5zdGFydHNXaXRoKGNvbmZpZy5kb2NGaWx0ZXIpKTtcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7ZG9jVXJscy5sZW5ndGh9IGRvY3VtZW50YXRpb24gVVJMcyBmcm9tICR7dXJscy5sZW5ndGh9IHRvdGFsIFVSTHNgKTtcblxuICAgICAgICByZXR1cm4gZG9jVXJscztcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCBzaXRlbWFwOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbn1cblxuLyoqXG4gKiBTZWFyY2ggc2l0ZW1hcCBmb3IgcmVsZXZhbnQgcGFnZXMgYmFzZWQgb24ga2V5d29yZHNcbiAqL1xuZnVuY3Rpb24gc2VhcmNoU2l0ZW1hcEZvclJlbGV2YW50UGFnZXMoa2V5d29yZHM6IHN0cmluZ1tdLCBzaXRlbWFwVXJsczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcmVsZXZhbnRQYWdlczogQXJyYXk8eyB1cmw6IHN0cmluZzsgc2NvcmU6IG51bWJlciB9PiA9IFtdO1xuXG4gICAgZm9yIChjb25zdCB1cmwgb2Ygc2l0ZW1hcFVybHMpIHtcbiAgICAgICAgY29uc3QgdXJsTG93ZXIgPSB1cmwudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgbGV0IHNjb3JlID0gMDtcblxuICAgICAgICAvLyBTY29yZSBiYXNlZCBvbiBrZXl3b3JkIG1hdGNoZXNcbiAgICAgICAgZm9yIChjb25zdCBrZXl3b3JkIG9mIGtleXdvcmRzKSB7XG4gICAgICAgICAgICBpZiAodXJsTG93ZXIuaW5jbHVkZXMoa2V5d29yZCkpIHtcbiAgICAgICAgICAgICAgICBzY29yZSArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQm9vc3Qgc2NvcmUgZm9yIC9kb2NzLyBwYWdlc1xuICAgICAgICBpZiAodXJsTG93ZXIuaW5jbHVkZXMoJy9kb2NzLycpKSB7XG4gICAgICAgICAgICBzY29yZSArPSAwLjU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc2NvcmUgPiAwKSB7XG4gICAgICAgICAgICByZWxldmFudFBhZ2VzLnB1c2goeyB1cmwsIHNjb3JlIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gU29ydCBieSBzY29yZSBhbmQgcmV0dXJuIHRvcCA1XG4gICAgcmVsZXZhbnRQYWdlcy5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSk7XG4gICAgY29uc3QgdG9wUGFnZXMgPSByZWxldmFudFBhZ2VzLnNsaWNlKDAsIDUpLm1hcChwID0+IHAudXJsKTtcblxuICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3RvcFBhZ2VzLmxlbmd0aH0gcmVsZXZhbnQgcGFnZXMgZnJvbSBzaXRlbWFwOmAsIHRvcFBhZ2VzKTtcbiAgICByZXR1cm4gdG9wUGFnZXM7XG59XG5cbi8qKlxuICogRmV0Y2ggcGFnZSBjb250ZW50XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoUGFnZUNvbnRlbnQoZG9tYWluOiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgdXJsID0gYGh0dHBzOi8vJHtkb21haW59JHtwYXRofWA7XG4gICAgY29uc29sZS5sb2coYEZldGNoaW5nIHBhZ2UgY29udGVudCBmcm9tOiAke3VybH1gKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBtYWtlSHR0cFJlcXVlc3QodXJsKTtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGZldGNoIHBhZ2UgJHt1cmx9OmAsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0IGNvZGUgc25pcHBldHMgZnJvbSBIVE1MIHBhZ2VcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdENvZGVTbmlwcGV0c0Zyb21QYWdlKGh0bWw6IHN0cmluZyk6IEFycmF5PHsgY29kZTogc3RyaW5nOyBsYW5ndWFnZT86IHN0cmluZyB9PiB7XG4gICAgY29uc3Qgc25pcHBldHM6IEFycmF5PHsgY29kZTogc3RyaW5nOyBsYW5ndWFnZT86IHN0cmluZyB9PiA9IFtdO1xuXG4gICAgLy8gTWF0Y2ggPHByZT48Y29kZT4gYmxvY2tzXG4gICAgY29uc3QgcHJlQ29kZVJlZ2V4ID0gLzxwcmVbXj5dKj48Y29kZVtePl0qY2xhc3M9W1wiJ10/bGFuZ3VhZ2UtKFxcdyspW1wiJ10/W14+XSo+KFtcXHNcXFNdKj8pPFxcL2NvZGU+PFxcL3ByZT4vZ2k7XG4gICAgbGV0IG1hdGNoO1xuXG4gICAgd2hpbGUgKChtYXRjaCA9IHByZUNvZGVSZWdleC5leGVjKGh0bWwpKSAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCBsYW5ndWFnZSA9IG1hdGNoWzFdO1xuICAgICAgICBsZXQgY29kZSA9IG1hdGNoWzJdO1xuXG4gICAgICAgIC8vIERlY29kZSBIVE1MIGVudGl0aWVzXG4gICAgICAgIGNvZGUgPSBjb2RlXG4gICAgICAgICAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmd0Oy9nLCAnPicpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmFtcDsvZywgJyYnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyYjMzk7L2csIFwiJ1wiKTtcblxuICAgICAgICAvLyBSZW1vdmUgSFRNTCB0YWdzIHRoYXQgbWlnaHQgYmUgaW5zaWRlXG4gICAgICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UoLzxbXj5dKz4vZywgJycpO1xuXG4gICAgICAgIGlmIChjb2RlLnRyaW0oKS5sZW5ndGggPiAxMCkge1xuICAgICAgICAgICAgc25pcHBldHMucHVzaCh7IGNvZGU6IGNvZGUudHJpbSgpLCBsYW5ndWFnZSB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIDIuIENvbXByZWhlbnNpdmU6IE1hdGNoIGFueSA8Y29kZT4gYmxvY2tzIHRoYXQgbG9vayBsaWtlIGNvZGUgKGxvbmcgb3IgY29udGFpbnMgc3ltYm9scylcbiAgICBjb25zdCBjb2RlUmVnZXggPSAvPGNvZGVbXj5dKj4oW1xcc1xcU10qPyk8XFwvY29kZT4vZ2k7XG4gICAgd2hpbGUgKChtYXRjaCA9IGNvZGVSZWdleC5leGVjKGh0bWwpKSAhPT0gbnVsbCkge1xuICAgICAgICBsZXQgY29kZSA9IG1hdGNoWzFdXG4gICAgICAgICAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmd0Oy9nLCAnPicpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmFtcDsvZywgJyYnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyYjMzk7L2csIFwiJ1wiKVxuICAgICAgICAgICAgLnJlcGxhY2UoLzxbXj5dKz4vZywgJycpOyAvLyBSZW1vdmUgYW55IG5lc3RlZCB0YWdzXG5cbiAgICAgICAgY29uc3QgdHJpbW1lZENvZGUgPSBjb2RlLnRyaW0oKTtcblxuICAgICAgICAvLyBMb2dpYyB0byBkaXN0aW5ndWlzaCByZWFsIGNvZGUgc25pcHBldHMgZnJvbSBzbWFsbCBpbmxpbmUgd29yZHNcbiAgICAgICAgY29uc3QgaXNMaWtlbHlTbmlwcGV0ID0gdHJpbW1lZENvZGUubGVuZ3RoID4gNDAgfHxcbiAgICAgICAgICAgIHRyaW1tZWRDb2RlLmluY2x1ZGVzKCd7JykgfHxcbiAgICAgICAgICAgIHRyaW1tZWRDb2RlLmluY2x1ZGVzKCc9PicpIHx8XG4gICAgICAgICAgICB0cmltbWVkQ29kZS5pbmNsdWRlcygnOycpIHx8XG4gICAgICAgICAgICB0cmltbWVkQ29kZS5pbmNsdWRlcygnaW1wb3J0ICcpIHx8XG4gICAgICAgICAgICB0cmltbWVkQ29kZS5pbmNsdWRlcygnY29uc3QgJyk7XG5cbiAgICAgICAgaWYgKGlzTGlrZWx5U25pcHBldCkge1xuICAgICAgICAgICAgLy8gQXZvaWQgZHVwbGljYXRlcyB3aXRoIHByZS9jb2RlIGJsb2Nrc1xuICAgICAgICAgICAgaWYgKCFzbmlwcGV0cy5zb21lKHMgPT4gcy5jb2RlID09PSB0cmltbWVkQ29kZSkpIHtcbiAgICAgICAgICAgICAgICBzbmlwcGV0cy5wdXNoKHsgY29kZTogdHJpbW1lZENvZGUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc25pcHBldHM7IC8vIFJldHVybiBhbGwgc25pcHBldHMgZm9yIG1heGltdW0gY29udGV4dFxufVxuXG4vKipcbiAqIEFuYWx5emUgcGFnZSBjb250ZW50IGZvciByZWxldmFuY2UgdG8gaXNzdWVcbiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVBhZ2VDb250ZW50KGNvbnRlbnQ6IHN0cmluZywgaXNzdWU6IERpc2NvdmVyZWRJc3N1ZSwgcGFnZVVybDogc3RyaW5nLCBzZW1hbnRpY1Njb3JlPzogbnVtYmVyKTogRXZpZGVuY2Uge1xuICAgIGNvbnN0IGNvbnRlbnRMb3dlciA9IGNvbnRlbnQudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBrZXl3b3JkcyA9IGV4dHJhY3RLZXl3b3Jkcyhpc3N1ZSk7XG5cbiAgICAvLyBFeHRyYWN0IHBhZ2UgdGl0bGVcbiAgICBjb25zdCB0aXRsZU1hdGNoID0gY29udGVudC5tYXRjaCgvPHRpdGxlPiguKj8pPFxcL3RpdGxlPi9pKTtcbiAgICBjb25zdCBwYWdlVGl0bGUgPSB0aXRsZU1hdGNoID8gdGl0bGVNYXRjaFsxXSA6IHBhZ2VVcmw7XG5cbiAgICAvLyBDaGVjayBmb3Iga2V5d29yZCBtYXRjaGVzXG4gICAgY29uc3Qga2V5d29yZE1hdGNoZXMgPSBrZXl3b3Jkcy5maWx0ZXIoa3cgPT4gY29udGVudExvd2VyLmluY2x1ZGVzKGt3KSk7XG4gICAgY29uc3QgaGFzUmVsZXZhbnRDb250ZW50ID0ga2V5d29yZE1hdGNoZXMubGVuZ3RoID49IDI7IC8vIEF0IGxlYXN0IDIga2V5d29yZHNcblxuICAgIC8vIENvdW50IGNvZGUgZXhhbXBsZXMgKGNvZGUgYmxvY2tzLCBwcmUgdGFncylcbiAgICBjb25zdCBjb2RlQmxvY2tNYXRjaGVzID0gY29udGVudC5tYXRjaCgvPGNvZGV8PHByZXxgYGAvZ2kpIHx8IFtdO1xuICAgIGNvbnN0IGNvZGVFeGFtcGxlcyA9IGNvZGVCbG9ja01hdGNoZXMubGVuZ3RoO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHByb2R1Y3Rpb24gZ3VpZGFuY2Uga2V5d29yZHNcbiAgICBjb25zdCBwcm9kdWN0aW9uS2V5d29yZHMgPSBbJ3Byb2R1Y3Rpb24nLCAnZGVwbG95JywgJ2Vudmlyb25tZW50JywgJ2NvbmZpZ3VyYXRpb24nLCAnc2V0dXAnXTtcbiAgICBjb25zdCBwcm9kdWN0aW9uR3VpZGFuY2UgPSBwcm9kdWN0aW9uS2V5d29yZHMuc29tZShrdyA9PiBjb250ZW50TG93ZXIuaW5jbHVkZXMoa3cpKTtcblxuICAgIC8vIElkZW50aWZ5IGNvbnRlbnQgZ2Fwc1xuICAgIGNvbnN0IGNvbnRlbnRHYXBzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgaWYgKGNvZGVFeGFtcGxlcyA9PT0gMCkge1xuICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIGNvZGUgZXhhbXBsZXMnKTtcbiAgICB9XG5cbiAgICBpZiAoIXByb2R1Y3Rpb25HdWlkYW5jZSAmJiBpc3N1ZS5jYXRlZ29yeSA9PT0gJ2RlcGxveW1lbnQnKSB7XG4gICAgICAgIGNvbnRlbnRHYXBzLnB1c2goJ01pc3NpbmcgcHJvZHVjdGlvbiBkZXBsb3ltZW50IGd1aWRhbmNlJyk7XG4gICAgfVxuXG4gICAgaWYgKCFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2Vycm9yJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygndHJvdWJsZXNob290JykpIHtcbiAgICAgICAgY29udGVudEdhcHMucHVzaCgnTWlzc2luZyBlcnJvciBoYW5kbGluZyBhbmQgdHJvdWJsZXNob290aW5nIHN0ZXBzJyk7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZm9yIHNwZWNpZmljIGlzc3VlLXJlbGF0ZWQgY29udGVudFxuICAgIGlmIChpc3N1ZS5jYXRlZ29yeSA9PT0gJ2VtYWlsLWRlbGl2ZXJ5Jykge1xuICAgICAgICBpZiAoIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnc3BhbScpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2RlbGl2ZXJhYmlsaXR5JykpIHtcbiAgICAgICAgICAgIGNvbnRlbnRHYXBzLnB1c2goJ01pc3Npbmcgc3BhbS9kZWxpdmVyYWJpbGl0eSB0cm91Ymxlc2hvb3RpbmcnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnZG5zJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnc3BmJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnZGtpbScpKSB7XG4gICAgICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIEROUyBjb25maWd1cmF0aW9uIGV4YW1wbGVzJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaXNzdWUuY2F0ZWdvcnkgPT09ICdkZXBsb3ltZW50Jykge1xuICAgICAgICBpZiAoIWNvbnRlbnRMb3dlci5pbmNsdWRlcygndmVyY2VsJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnbmV0bGlmeScpICYmIGlzc3VlLnRpdGxlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ3ZlcmNlbCcpKSB7XG4gICAgICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIHBsYXRmb3JtLXNwZWNpZmljIGRlcGxveW1lbnQgZXhhbXBsZXMgKFZlcmNlbC9OZXRsaWZ5KScpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY29udGVudExvd2VyLmluY2x1ZGVzKCdlbnZpcm9ubWVudCB2YXJpYWJsZScpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2VudicpKSB7XG4gICAgICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIGVudmlyb25tZW50IHZhcmlhYmxlIGNvbmZpZ3VyYXRpb24nKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHBhZ2VVcmwsXG4gICAgICAgIHBhZ2VUaXRsZSxcbiAgICAgICAgaGFzUmVsZXZhbnRDb250ZW50LFxuICAgICAgICBjb250ZW50R2FwcyxcbiAgICAgICAgY29kZUV4YW1wbGVzLFxuICAgICAgICBwcm9kdWN0aW9uR3VpZGFuY2UsXG4gICAgICAgIHNlbWFudGljU2NvcmVcbiAgICB9O1xufVxuXG4vKipcbiAqIFZhbGlkYXRlIGEgc2luZ2xlIGlzc3VlIGFnYWluc3QgZG9jdW1lbnRhdGlvblxuICovXG5hc3luYyBmdW5jdGlvbiB2YWxpZGF0ZUlzc3VlKGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUsIGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxWYWxpZGF0aW9uUmVzdWx0PiB7XG4gICAgY29uc29sZS5sb2coYFxcbj09PSBWYWxpZGF0aW5nIGlzc3VlOiAke2lzc3VlLnRpdGxlfSA9PT1gKTtcblxuICAgIGxldCBwYWdlc1RvQ2hlY2s6IEFycmF5PHsgdXJsOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmc7IHNpbWlsYXJpdHk/OiBudW1iZXIgfT4gPSBbXTtcbiAgICBsZXQgdXNlZFNpdGVtYXBGYWxsYmFjayA9IGZhbHNlO1xuXG4gICAgLy8gU3RlcCAxOiBUcnkgcHJlLWN1cmF0ZWQgcGFnZXMgZmlyc3RcbiAgICBpZiAoaXNzdWUucmVsYXRlZFBhZ2VzICYmIGlzc3VlLnJlbGF0ZWRQYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBhZ2VzVG9DaGVjayA9IGlzc3VlLnJlbGF0ZWRQYWdlcy5tYXAodXJsID0+ICh7IHVybCwgdGl0bGU6IHVybCB9KSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2luZyBwcmUtY3VyYXRlZCBwYWdlczpgLCBwYWdlc1RvQ2hlY2subWFwKHAgPT4gcC51cmwpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTdGVwIDI6IFVzZSBzZW1hbnRpYyBzZWFyY2ggZm9yIGJldHRlciByZWxldmFuY2VcbiAgICAgICAgY29uc29sZS5sb2coYE5vIHByZS1jdXJhdGVkIHBhZ2VzLCB1c2luZyBzZW1hbnRpYyBzZWFyY2hgKTtcbiAgICAgICAgdXNlZFNpdGVtYXBGYWxsYmFjayA9IHRydWU7XG5cbiAgICAgICAgY29uc3Qgc2VtYW50aWNSZXN1bHRzID0gYXdhaXQgc2VhcmNoU2l0ZW1hcFNlbWFudGljbHlPcHRpbWl6ZWQoaXNzdWUsIGRvbWFpbik7XG4gICAgICAgIHBhZ2VzVG9DaGVjayA9IHNlbWFudGljUmVzdWx0cztcblxuICAgICAgICAvLyBGYWxsYmFjayB0byBrZXl3b3JkIHNlYXJjaCBpZiBzZW1hbnRpYyBzZWFyY2ggZmFpbHNcbiAgICAgICAgaWYgKHBhZ2VzVG9DaGVjay5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZW1hbnRpYyBzZWFyY2ggZmFpbGVkLCBmYWxsaW5nIGJhY2sgdG8ga2V5d29yZCBzZWFyY2hgKTtcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXAgPSBhd2FpdCBmZXRjaFNpdGVtYXAoZG9tYWluKTtcbiAgICAgICAgICAgIGlmIChzaXRlbWFwLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAvLyBGaWx0ZXIgdG8gb25seSBpbmNsdWRlIGRvY3MgcGFnZXMgdG8gYXZvaWQgaXJyZWxldmFudCByZXN1bHRzXG4gICAgICAgICAgICAgICAgY29uc3QgZG9jUGFnZXMgPSBzaXRlbWFwLmZpbHRlcih1cmwgPT4gdXJsLnN0YXJ0c1dpdGgoJy9kb2NzLycpKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgdG8gJHtkb2NQYWdlcy5sZW5ndGh9IGRvY3MgcGFnZXMgZnJvbSAke3NpdGVtYXAubGVuZ3RofSB0b3RhbCBwYWdlc2ApO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qga2V5d29yZHMgPSBleHRyYWN0S2V5d29yZHMoaXNzdWUpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBFeHRyYWN0ZWQga2V5d29yZHM6YCwga2V5d29yZHMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGtleXdvcmRQYWdlcyA9IHNlYXJjaFNpdGVtYXBGb3JSZWxldmFudFBhZ2VzKGtleXdvcmRzLCBkb2NQYWdlcyk7XG4gICAgICAgICAgICAgICAgcGFnZXNUb0NoZWNrID0ga2V5d29yZFBhZ2VzLm1hcCh1cmwgPT4gKHsgdXJsLCB0aXRsZTogdXJsIH0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFN0ZXAgMzogVmFsaWRhdGUgZWFjaCBwYWdlXG4gICAgY29uc3QgZXZpZGVuY2U6IEV2aWRlbmNlW10gPSBbXTtcbiAgICBjb25zdCBwb3RlbnRpYWxHYXBzOiBHYXBBbmFseXNpc1tdID0gW107XG4gICAgY29uc3QgY3JpdGljYWxHYXBzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IG1pc3NpbmdFbGVtZW50czogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmIChwYWdlc1RvQ2hlY2subGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIENyaXRpY2FsIGdhcDogTm8gcmVsZXZhbnQgcGFnZXMgZm91bmRcbiAgICAgICAgY29uc29sZS5sb2coYOKdjCBDUklUSUNBTCBHQVA6IE5vIHJlbGV2YW50IHBhZ2VzIGZvdW5kIGZvciBpc3N1ZWApO1xuXG4gICAgICAgIGNyaXRpY2FsR2Fwcy5wdXNoKGBObyBkb2N1bWVudGF0aW9uIHBhZ2UgZm91bmQgYWRkcmVzc2luZyBcIiR7aXNzdWUudGl0bGV9XCJgKTtcblxuICAgICAgICBwb3RlbnRpYWxHYXBzLnB1c2goe1xuICAgICAgICAgICAgZ2FwVHlwZTogJ2NyaXRpY2FsLWdhcCcsXG4gICAgICAgICAgICBtaXNzaW5nQ29udGVudDogW1xuICAgICAgICAgICAgICAgICdDb21wbGV0ZSBkb2N1bWVudGF0aW9uIHBhZ2UgbWlzc2luZycsXG4gICAgICAgICAgICAgICAgJ0NvZGUgZXhhbXBsZXMgbmVlZGVkJyxcbiAgICAgICAgICAgICAgICAnVHJvdWJsZXNob290aW5nIGd1aWRlIG5lZWRlZCcsXG4gICAgICAgICAgICAgICAgJ1Byb2R1Y3Rpb24gZGVwbG95bWVudCBndWlkYW5jZSBuZWVkZWQnXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVhc29uaW5nOiBgU2VhcmNoZWQgc2l0ZW1hcC54bWwgYnV0IGZvdW5kIG5vIHBhZ2VzIG1hdGNoaW5nIGtleXdvcmRzOiAke2V4dHJhY3RLZXl3b3Jkcyhpc3N1ZSkuam9pbignLCAnKX1gLFxuICAgICAgICAgICAgZGV2ZWxvcGVySW1wYWN0OiBgJHtpc3N1ZS5mcmVxdWVuY3l9IGRldmVsb3BlcnMgYWZmZWN0ZWQgLSByZXBvcnRpbmcgdGhpcyBpc3N1ZSBzaW5jZSAke2lzc3VlLmxhc3RTZWVufWBcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlzc3VlSWQ6IGlzc3VlLmlkLFxuICAgICAgICAgICAgaXNzdWVUaXRsZTogaXNzdWUudGl0bGUsXG4gICAgICAgICAgICBzdGF0dXM6ICdjcml0aWNhbC1nYXAnLFxuICAgICAgICAgICAgZXZpZGVuY2UsXG4gICAgICAgICAgICBtaXNzaW5nRWxlbWVudHM6IFsnQ29tcGxldGUgZG9jdW1lbnRhdGlvbiBwYWdlJ10sXG4gICAgICAgICAgICBwb3RlbnRpYWxHYXBzLFxuICAgICAgICAgICAgY3JpdGljYWxHYXBzLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogOTUsXG4gICAgICAgICAgICByZWNvbW1lbmRhdGlvbnM6IFtcbiAgICAgICAgICAgICAgICBgQ3JlYXRlIG5ldyBkb2N1bWVudGF0aW9uIHBhZ2UgYWRkcmVzc2luZzogJHtpc3N1ZS50aXRsZX1gLFxuICAgICAgICAgICAgICAgIGBJbmNsdWRlIGNvZGUgZXhhbXBsZXMgZm9yICR7aXNzdWUuY2F0ZWdvcnl9YCxcbiAgICAgICAgICAgICAgICBgQWRkIHRyb3VibGVzaG9vdGluZyBzZWN0aW9uYCxcbiAgICAgICAgICAgICAgICBgUmVmZXJlbmNlOiAke2lzc3VlLnNvdXJjZXNbMF19YFxuICAgICAgICAgICAgXVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIEZldGNoIGFuZCBhbmFseXplIGVhY2ggcGFnZVxuICAgIGZvciAoY29uc3QgcGFnZSBvZiBwYWdlc1RvQ2hlY2spIHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IGZldGNoUGFnZUNvbnRlbnQoZG9tYWluLCBwYWdlLnVybCk7XG5cbiAgICAgICAgaWYgKCFjb250ZW50KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pqg77iPIEZhaWxlZCB0byBmZXRjaCBwYWdlOiAke3BhZ2UudXJsfWApO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwYWdlRXZpZGVuY2UgPSBhbmFseXplUGFnZUNvbnRlbnQoY29udGVudCwgaXNzdWUsIHBhZ2UudXJsLCBwYWdlLnNpbWlsYXJpdHkpO1xuICAgICAgICBldmlkZW5jZS5wdXNoKHBhZ2VFdmlkZW5jZSk7XG5cbiAgICAgICAgLy8gQ29udGVudCBnYXBzIGFyZSBhbHJlYWR5IHNob3duIGluIHRoZSBFdmlkZW5jZSBzZWN0aW9uLCBubyBuZWVkIHRvIGR1cGxpY2F0ZVxuICAgICAgICAvLyBpZiAoIXBhZ2VFdmlkZW5jZS5oYXNSZWxldmFudENvbnRlbnQgfHwgcGFnZUV2aWRlbmNlLmNvbnRlbnRHYXBzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gICAgIGNvbnNvbGUubG9nKGDimqDvuI8gUE9URU5USUFMIEdBUDogJHtwYWdlLnVybH0gZXhpc3RzIGJ1dCBtaXNzaW5nIGNvbnRlbnRgKTtcblxuICAgICAgICAvLyAgICAgcG90ZW50aWFsR2Fwcy5wdXNoKHtcbiAgICAgICAgLy8gICAgICAgICBnYXBUeXBlOiAncG90ZW50aWFsLWdhcCcsXG4gICAgICAgIC8vICAgICAgICAgcGFnZVVybDogcGFnZS51cmwsXG4gICAgICAgIC8vICAgICAgICAgcGFnZVRpdGxlOiBwYWdlRXZpZGVuY2UucGFnZVRpdGxlLFxuICAgICAgICAvLyAgICAgICAgIG1pc3NpbmdDb250ZW50OiBwYWdlRXZpZGVuY2UuY29udGVudEdhcHMsXG4gICAgICAgIC8vICAgICAgICAgcmVhc29uaW5nOiBgUmljaCBjb250ZW50IGFuYWx5c2lzIHN1Z2dlc3RzIHJlbGV2YW5jZSB0byBcIiR7aXNzdWUudGl0bGV9XCIgYnV0IGxhY2tzIHNwZWNpZmljIGNvbnRlbnRgLFxuICAgICAgICAvLyAgICAgICAgIGRldmVsb3BlckltcGFjdDogYERldmVsb3BlcnMgc2VhcmNoaW5nIGZvciBcIiR7aXNzdWUudGl0bGV9XCIgd291bGQgZmluZCB0aGlzIHBhZ2UgYnV0IG5vdCBnZXQgY29tcGxldGUgc29sdXRpb25gXG4gICAgICAgIC8vICAgICB9KTtcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIG1pc3NpbmdFbGVtZW50cy5wdXNoKC4uLnBhZ2VFdmlkZW5jZS5jb250ZW50R2Fwcyk7XG4gICAgfVxuXG4gICAgLy8gRGV0ZXJtaW5lIG92ZXJhbGwgc3RhdHVzXG4gICAgLy8gQmUgY29uc2VydmF0aXZlOiBEb24ndCBtYXJrIGFzIFwicmVzb2x2ZWRcIiB1bmxlc3Mgd2UncmUgdmVyeSBjb25maWRlbnRcbiAgICAvLyB0aGUgZG9jdW1lbnRhdGlvbiBhZGRyZXNzZXMgdGhlIENPUkUgcHJvYmxlbSwgbm90IGp1c3QgbWVudGlvbnMgcmVsYXRlZCBrZXl3b3Jkc1xuXG4gICAgLy8gRGVidWcgbG9nZ2luZ1xuICAgIGNvbnNvbGUubG9nKGBcXG49PT0gU3RhdHVzIERldGVybWluYXRpb24gRGVidWcgPT09YCk7XG4gICAgZXZpZGVuY2UuZm9yRWFjaCgoZSwgaWR4KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBFdmlkZW5jZSAke2lkeCArIDF9OiAke2UucGFnZVVybH1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYCAgLSBoYXNSZWxldmFudENvbnRlbnQ6ICR7ZS5oYXNSZWxldmFudENvbnRlbnR9YCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGAgIC0gY29udGVudEdhcHMubGVuZ3RoOiAke2UuY29udGVudEdhcHMubGVuZ3RofWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgICAtIGNvbnRlbnRHYXBzOiAke0pTT04uc3RyaW5naWZ5KGUuY29udGVudEdhcHMpfWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgICAtIHNlbWFudGljU2NvcmU6ICR7ZS5zZW1hbnRpY1Njb3JlfWApO1xuICAgIH0pO1xuXG4gICAgY29uc3QgaGFzQ29tcGxldGVDb250ZW50ID0gZXZpZGVuY2Uuc29tZShlID0+XG4gICAgICAgIGUuaGFzUmVsZXZhbnRDb250ZW50ICYmXG4gICAgICAgIGUuY29udGVudEdhcHMubGVuZ3RoID09PSAwICYmXG4gICAgICAgIGUuc2VtYW50aWNTY29yZSAmJiBlLnNlbWFudGljU2NvcmUgPiAwLjg1IC8vIEhpZ2ggY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICApO1xuICAgIGNvbnN0IGhhc1NvbWVDb250ZW50ID0gZXZpZGVuY2Uuc29tZShlID0+IGUuaGFzUmVsZXZhbnRDb250ZW50KTtcblxuICAgIGNvbnNvbGUubG9nKGBoYXNDb21wbGV0ZUNvbnRlbnQ6ICR7aGFzQ29tcGxldGVDb250ZW50fWApO1xuICAgIGNvbnNvbGUubG9nKGBoYXNTb21lQ29udGVudDogJHtoYXNTb21lQ29udGVudH1gKTtcblxuICAgIGxldCBzdGF0dXM6IFZhbGlkYXRpb25SZXN1bHRbJ3N0YXR1cyddO1xuICAgIGxldCBjb25maWRlbmNlOiBudW1iZXI7XG5cbiAgICBpZiAoaGFzQ29tcGxldGVDb250ZW50KSB7XG4gICAgICAgIHN0YXR1cyA9ICdyZXNvbHZlZCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA5MDtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBSRVNPTFZFRDogSXNzdWUgYXBwZWFycyB0byBiZSBhZGRyZXNzZWQgaW4gZG9jdW1lbnRhdGlvbiAoaGlnaCBjb25maWRlbmNlKWApO1xuICAgIH0gZWxzZSBpZiAoZXZpZGVuY2Uuc29tZShlID0+IGUuc2VtYW50aWNTY29yZSAmJiBlLnNlbWFudGljU2NvcmUgPiAwLjYpKSB7XG4gICAgICAgIC8vIEdvb2Qgc2VtYW50aWMgbWF0Y2ggYnV0IG5vdCBwZXJmZWN0IC0gbGlrZWx5IGEgcG90ZW50aWFsIGdhcFxuICAgICAgICBzdGF0dXMgPSAncG90ZW50aWFsLWdhcCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA3NTtcbiAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyBQT1RFTlRJQUwgR0FQOiBSZWxldmFudCBwYWdlcyBleGlzdCBidXQgbWF5IG5vdCBmdWxseSBhZGRyZXNzIHRoZSBpc3N1ZWApO1xuICAgIH0gZWxzZSBpZiAoaGFzU29tZUNvbnRlbnQpIHtcbiAgICAgICAgc3RhdHVzID0gJ2NvbmZpcm1lZCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA3MDtcbiAgICAgICAgY29uc29sZS5sb2coYOKdjCBDT05GSVJNRUQ6IElzc3VlIGV4aXN0cywgZG9jdW1lbnRhdGlvbiBpcyBpbmNvbXBsZXRlYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgc3RhdHVzID0gJ2NyaXRpY2FsLWdhcCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA4NTtcbiAgICAgICAgY29uc29sZS5sb2coYOKdjCBDUklUSUNBTCBHQVA6IE5vIHJlbGV2YW50IGNvbnRlbnQgZm91bmRgKTtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSBkZXRhaWxlZCByZWNvbW1lbmRhdGlvbnMgdXNpbmcgQUkgYW5hbHlzaXMgKGZvciBhbGwgc3RhdHVzZXMpXG4gICAgY29uc3QgcmVjb21tZW5kYXRpb25zID0gYXdhaXQgZ2VuZXJhdGVEZXRhaWxlZFJlY29tbWVuZGF0aW9ucyhpc3N1ZSwgZXZpZGVuY2UsIHN0YXR1cywgZG9tYWluKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGlzc3VlSWQ6IGlzc3VlLmlkLFxuICAgICAgICBpc3N1ZVRpdGxlOiBpc3N1ZS50aXRsZSxcbiAgICAgICAgc3RhdHVzLFxuICAgICAgICBldmlkZW5jZSxcbiAgICAgICAgbWlzc2luZ0VsZW1lbnRzOiBbLi4ubmV3IFNldChtaXNzaW5nRWxlbWVudHMpXSxcbiAgICAgICAgcG90ZW50aWFsR2FwcyxcbiAgICAgICAgY3JpdGljYWxHYXBzLFxuICAgICAgICBjb25maWRlbmNlLFxuICAgICAgICByZWNvbW1lbmRhdGlvbnNcbiAgICB9O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIGRldGFpbGVkLCBhY3Rpb25hYmxlIHJlY29tbWVuZGF0aW9ucyB1c2luZyBBSSBhbmFseXNpc1xuICovXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZURldGFpbGVkUmVjb21tZW5kYXRpb25zKFxuICAgIGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUsXG4gICAgZXZpZGVuY2U6IEV2aWRlbmNlW10sXG4gICAgc3RhdHVzOiBzdHJpbmcsXG4gICAgZG9tYWluOiBzdHJpbmdcbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICB0cnkge1xuICAgICAgICAvLyBHZXQgdGhlIGJlc3QgbWF0Y2hpbmcgcGFnZSAoaGlnaGVzdCBzZW1hbnRpYyBzY29yZSlcbiAgICAgICAgY29uc3QgYmVzdE1hdGNoID0gZXZpZGVuY2UucmVkdWNlKChiZXN0LCBjdXJyZW50KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBiZXN0U2NvcmUgPSBiZXN0LnNlbWFudGljU2NvcmUgfHwgMDtcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRTY29yZSA9IGN1cnJlbnQuc2VtYW50aWNTY29yZSB8fCAwO1xuICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTY29yZSA+IGJlc3RTY29yZSA/IGN1cnJlbnQgOiBiZXN0O1xuICAgICAgICB9LCBldmlkZW5jZVswXSk7XG5cbiAgICAgICAgaWYgKCFiZXN0TWF0Y2ggfHwgIWJlc3RNYXRjaC5zZW1hbnRpY1Njb3JlIHx8IGJlc3RNYXRjaC5zZW1hbnRpY1Njb3JlIDwgMC41KSB7XG4gICAgICAgICAgICAvLyBObyBnb29kIG1hdGNoLCByZXR1cm4gZ2VuZXJpYyByZWNvbW1lbmRhdGlvbnNcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinYwgTm8gZ29vZCBzZW1hbnRpYyBtYXRjaCBmb3VuZC4gYmVzdE1hdGNoOiAkeyEhYmVzdE1hdGNofSwgc2VtYW50aWNTY29yZTogJHtiZXN0TWF0Y2g/LnNlbWFudGljU2NvcmV9YCk7XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgIGBDcmVhdGUgbmV3IGRvY3VtZW50YXRpb24gcGFnZSBhZGRyZXNzaW5nOiAke2lzc3VlLnRpdGxlfWAsXG4gICAgICAgICAgICAgICAgYEluY2x1ZGUgY29kZSBleGFtcGxlcyBmb3IgJHtpc3N1ZS5jYXRlZ29yeX1gLFxuICAgICAgICAgICAgICAgIGBBZGQgdHJvdWJsZXNob290aW5nIHNlY3Rpb24gZm9yIGNvbW1vbiBlcnJvcnNgLFxuICAgICAgICAgICAgICAgIGBSZWZlcmVuY2U6ICR7aXNzdWUuc291cmNlc1swXX1gXG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIHJlc29sdmVkIGlzc3Vlcywgc3RpbGwgZ2VuZXJhdGUgcmVjb21tZW5kYXRpb25zIGZvciBpbXByb3ZlbWVudHNcbiAgICAgICAgY29uc29sZS5sb2coYPCflI0gR2VuZXJhdGluZyByZWNvbW1lbmRhdGlvbnMgZm9yIGlzc3VlOiAke2lzc3VlLmlkfSAoc3RhdHVzOiAke3N0YXR1c30pYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIEJlc3QgbWF0Y2g6ICR7YmVzdE1hdGNoLnBhZ2VVcmx9IChzY29yZTogJHtiZXN0TWF0Y2guc2VtYW50aWNTY29yZX0pYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgUHJvY2VlZGluZyB3aXRoIEFJIHJlY29tbWVuZGF0aW9uIGdlbmVyYXRpb24uLi5gKTtcblxuICAgICAgICAvLyBDUklUSUNBTDogRmV0Y2ggdGhlIEFDVFVBTCBwYWdlIGNvbnRlbnQgdG8gYW5hbHl6ZSBleGlzdGluZyBjb2RlXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OEIEZldGNoaW5nIGFjdHVhbCBwYWdlIGNvbnRlbnQgZnJvbTogJHtkb21haW59JHtiZXN0TWF0Y2gucGFnZVVybH1gKTtcbiAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSBhd2FpdCBmZXRjaFBhZ2VDb250ZW50KGRvbWFpbiwgYmVzdE1hdGNoLnBhZ2VVcmwpO1xuXG4gICAgICAgIGlmICghcGFnZUNvbnRlbnQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinYwgRmFpbGVkIHRvIGZldGNoIHBhZ2UgY29udGVudCwgZmFsbGluZyBiYWNrIHRvIGdlbmVyaWMgcmVjb21tZW5kYXRpb25zYCk7XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgIGBVcGRhdGUgJHtiZXN0TWF0Y2gucGFnZVVybH0gdG8gYWRkcmVzczogJHtpc3N1ZS50aXRsZX1gLFxuICAgICAgICAgICAgICAgIGBBZGQgY29kZSBleGFtcGxlcyBmb3IgJHtpc3N1ZS5jYXRlZ29yeX1gLFxuICAgICAgICAgICAgICAgIGBJbmNsdWRlIHRyb3VibGVzaG9vdGluZyBzZWN0aW9uIGZvciBjb21tb24gZXJyb3JzYCxcbiAgICAgICAgICAgICAgICBgUmVmZXJlbmNlOiAke2lzc3VlLnNvdXJjZXNbMF19YFxuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEV4dHJhY3QgY29kZSBzbmlwcGV0cyBmcm9tIHRoZSBwYWdlXG4gICAgICAgIGNvbnN0IGNvZGVTbmlwcGV0cyA9IGV4dHJhY3RDb2RlU25pcHBldHNGcm9tUGFnZShwYWdlQ29udGVudCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OdIEV4dHJhY3RlZCAke2NvZGVTbmlwcGV0cy5sZW5ndGh9IGNvZGUgc25pcHBldHMgZnJvbSBkb2N1bWVudGF0aW9uIHBhZ2VgKTtcblxuICAgICAgICAvLyBCdWlsZCBjb250ZXh0IGZvciBBSSBhbmFseXNpc1xuICAgICAgICBjb25zdCBpc3N1ZUNvbnRleHQgPSBgXG5Jc3N1ZSBUaXRsZTogJHtpc3N1ZS50aXRsZX1cbkNhdGVnb3J5OiAke2lzc3VlLmNhdGVnb3J5fVxuRGVzY3JpcHRpb246ICR7aXNzdWUuZGVzY3JpcHRpb259XG5FcnJvciBNZXNzYWdlczogJHtpc3N1ZS5lcnJvck1lc3NhZ2VzPy5qb2luKCcsICcpIHx8ICdOb25lJ31cblRhZ3M6ICR7aXNzdWUudGFncz8uam9pbignLCAnKSB8fCAnTm9uZSd9XG5Db2RlIFNuaXBwZXRzIGZyb20gRGV2ZWxvcGVyIElzc3VlOiAke2lzc3VlLmNvZGVTbmlwcGV0cz8ubGVuZ3RoIHx8IDB9IHNuaXBwZXRzIGZvdW5kXG4ke2lzc3VlLmNvZGVTbmlwcGV0cyA/IGlzc3VlLmNvZGVTbmlwcGV0cy5tYXAoKHNuaXBwZXQsIGkpID0+IGBcXG5TbmlwcGV0ICR7aSArIDF9OlxcblxcYFxcYFxcYFxcbiR7c25pcHBldH1cXG5cXGBcXGBcXGBgKS5qb2luKCdcXG4nKSA6ICcnfVxuRnVsbCBDb250ZW50IFByZXZpZXc6ICR7aXNzdWUuZnVsbENvbnRlbnQ/LnN1YnN0cmluZygwLCAxMDAwKSB8fCAnTm90IGF2YWlsYWJsZSd9XG5Tb3VyY2U6ICR7aXNzdWUuc291cmNlc1swXX1cbmAudHJpbSgpO1xuXG4gICAgICAgIGNvbnN0IGRvY0NvbnRleHQgPSBgXG5QYWdlIFVSTDogJHtiZXN0TWF0Y2gucGFnZVVybH1cblBhZ2UgVGl0bGU6ICR7YmVzdE1hdGNoLnBhZ2VUaXRsZX1cblNlbWFudGljIE1hdGNoIFNjb3JlOiAkeyhiZXN0TWF0Y2guc2VtYW50aWNTY29yZSAqIDEwMCkudG9GaXhlZCgxKX0lXG5IYXMgQ29kZSBFeGFtcGxlczogJHtiZXN0TWF0Y2guY29kZUV4YW1wbGVzID4gMCA/ICdZZXMnIDogJ05vJ31cbkhhcyBQcm9kdWN0aW9uIEd1aWRhbmNlOiAke2Jlc3RNYXRjaC5wcm9kdWN0aW9uR3VpZGFuY2UgPyAnWWVzJyA6ICdObyd9XG5Db250ZW50IEdhcHM6ICR7YmVzdE1hdGNoLmNvbnRlbnRHYXBzLmpvaW4oJywgJyl9XG5cbkVYSVNUSU5HIENPREUgT04gRE9DVU1FTlRBVElPTiBQQUdFOlxuJHtjb2RlU25pcHBldHMubGVuZ3RoID4gMCA/IGNvZGVTbmlwcGV0cy5tYXAoKHNuaXBwZXQsIGkpID0+IGBcXG5Db2RlIEV4YW1wbGUgJHtpICsgMX06XFxuXFxgXFxgXFxgJHtzbmlwcGV0Lmxhbmd1YWdlIHx8ICd0eXBlc2NyaXB0J31cXG4ke3NuaXBwZXQuY29kZX1cXG5cXGBcXGBcXGBgKS5qb2luKCdcXG4nKSA6ICdObyBjb2RlIGV4YW1wbGVzIGZvdW5kIG9uIHBhZ2UnfVxuYC50cmltKCk7XG5cbiAgICAgICAgY29uc3QgcHJvbXB0ID0gYFlvdSBhcmUgYSB0ZWNobmljYWwgZG9jdW1lbnRhdGlvbiBleHBlcnQgYW5hbHl6aW5nIGEgZGV2ZWxvcGVyIGlzc3VlIGZvciB0aGUgS25vY2sgdGVhbS5cblxuREVWRUxPUEVSIElTU1VFOlxuLSBUaXRsZTogJHtpc3N1ZS50aXRsZX1cbi0gRGVzY3JpcHRpb246ICR7aXNzdWUuZGVzY3JpcHRpb259XG4tIEVycm9yOiAke2lzc3VlLmVycm9yTWVzc2FnZXM/LlswXSB8fCAnTi9BJ31cbi0gU291cmNlOiAke2lzc3VlLnNvdXJjZXNbMF19XG5cbkRPQ1VNRU5UQVRJT04gUEFHRTogJHtiZXN0TWF0Y2gucGFnZVVybH1cbkVYSVNUSU5HIENPREUgU05JUFBFVFMgT04gUEFHRSAoQ09OVEVYVCk6XG4ke2NvZGVTbmlwcGV0cy5sZW5ndGggPiAwID8gY29kZVNuaXBwZXRzLm1hcCgocywgaSkgPT4gYFNuaXBwZXQgJHtpICsgMX06XFxuXFxgXFxgXFxgJHtzLmxhbmd1YWdlIHx8ICd0eXBlc2NyaXB0J31cXG4ke3MuY29kZX1cXG5cXGBcXGBcXGBgKS5qb2luKCdcXG5cXG4nKSA6ICdObyBjb2RlIGV4YW1wbGVzIGZvdW5kJ31cblxuWU9VUiBUQVNLOiBJZGVudGlmeSBleGFjdCBnYXBzIG9yIGVycm9ycyBiYXNlZCBvbiB0aGUgZGV2ZWxvcGVyIGlzc3VlIGFuZCByZWNvbW1lbmQgU1VSR0lDQUwgZml4ZXMgZm9yIHRoZSBleGlzdGluZyBjb2RlIHNuaXBwZXRzLiBcblxuRE8gTk9UIGdlbmVyYXRlIGEgbmV3IFwiTWFzdGVyIEltcGxlbWVudGF0aW9uLlwiIEluc3RlYWQsIHByb3ZpZGUgdXBkYXRlcyB0aGF0IHRoZSBkb2N1bWVudGF0aW9uIHRlYW0gY2FuIGVhc2lseSBzbG90IGludG8gdGhlaXIgZXhpc3RpbmcgcGFnZSBsYXlvdXQuXG5cbkNSSVRJQ0FMIFJFUVVJUkVNRU5UUzpcbjEuIEZPQ1VTIG9uIHNwZWNpZmljIHNuaXBwZXRzOiBJZiB0aGUgZml4IGJlbG9uZ3MgaW4gXCJTbmlwcGV0IDJcIiwgY2FsbCBpdCBvdXQgY2xlYXJseS5cbjIuIFNVUkdJQ0FMIFVQREFURVM6IE9ubHkgcHJvdmlkZSB0aGUgY29kZSBuZWNlc3NhcnkgdG8gZml4L2ltcHJvdmUgdGhhdCBzcGVjaWZpYyBzZWN0aW9uLiBcbjMuIFBSRVNFUlZFIENPTlRFWFQ6IEVuc3VyZSB0aGUgaW1wcm92ZWQgY29kZSBmaXRzIHBlcmZlY3RseSBpbnRvIHRoZSBleGlzdGluZyBkb2N1bWVudGF0aW9uIHN0cnVjdHVyZS5cbjQuIFNob3cgQkVGT1JFIChleGlzdGluZyBkb2Mgc25pcHBldCkgYW5kIEFGVEVSIChpbXByb3ZlZCBzbmlwcGV0KSBjb21wYXJpc29uLlxuXG5PVVRQVVQgRk9STUFUIChmb2xsb3cgZXhhY3RseSk6XG5cbiMjIFJlY29tbWVuZGF0aW9uIDE6IFtUYXJnZXQgU25pcHBldCBOYW1lL051bWJlcl0gLSBbU2hvcnQgRml4IFRpdGxlXVxuXG4qKlRoZSBHYXA6KiogWzEtMiBzZW50ZW5jZXMgZXhwbGFpbmluZyB3aHkgdGhlIGN1cnJlbnQgc25pcHBldCBjYXVzZXMgdGhlIGRldmVsb3BlciBpc3N1ZV1cblxuKipDdXJyZW50IERvY3VtZW50YXRpb24gKEJFRk9SRSk6KipcblxcYFxcYFxcYHR5cGVzY3JpcHRcbi8vIFNIT1cgdGhlIGV4aXN0aW5nIGNvZGUgZnJvbSB0aGUgcGFnZSB0aGF0IGlzIG1vc3QgcmVsZXZhbnQgdG8gdGhpcyBmaXguXG4vLyBFdmVuIGlmIHRoaXMgaXMgYSBcIk5ldyBTZWN0aW9uXCIsIHByb3ZpZGUgdGhlIGNvZGUgZnJvbSB0aGUgc3Vycm91bmRpbmcgYXJlYSBhcyBjb250ZXh0IHNvIHRoZSB1c2VyIGtub3dzIHdoZXJlIHRvIGluc2VydCBpdC5cbi8vIERPIE5PVCB1c2UgXCIvLyBNaXNzaW5nIFNlY3Rpb25cIiAtIGFsd2F5cyBwcm92aWRlIHNvbWUgY29udGV4dCBzbmlwcGV0IGZyb20gdGhlIHBhZ2UuXG5cXGBcXGBcXGBcblxuKipTdXJnaWNhbCBJbXByb3ZlbWVudCAoQUZURVIpIC0gVXBkYXRlIHRoaXMgc3BlY2lmaWMgc25pcHBldDoqKlxuXFxgXFxgXFxgdHlwZXNjcmlwdFxuLy8gVGhlIGltcHJvdmVkIHZlcnNpb24gb2YgdGhlIHNuaXBwZXQuIFxuLy8gS2VlcCBpdCBjb25jaXNlIGJ1dCBmdW5jdGlvbmFsLlxuLy8gSW5jbHVkZSB0aGUgc3BlY2lmaWMgZml4IChlLmcuLCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcsIGNvcnJlY3QgY29uZmlnIGZpZWxkLCBvciBtaXNzaW5nIEFQSSBwYXJhbWV0ZXIpLlxuXFxgXFxgXFxgXG5cbioqV2h5IFRoaXMgSGVscHM6KiogWzEtMiBzZW50ZW5jZXMgZXhwbGFpbmluZyBob3cgdGhpcyB1bmJsb2NrcyBkZXZlbG9wZXJzXVxuXG4tLS1cblxuIyMgUmVjb21tZW5kYXRpb24gMjogW0Fub3RoZXIgVGFyZ2V0IEFyZWFdIC0gW1Nob3J0IEZpeCBUaXRsZV1cblxuKipUaGUgR2FwOioqIFsxLTIgc2VudGVuY2VzXVxuXG4qKkN1cnJlbnQgRG9jdW1lbnRhdGlvbiAoQkVGT1JFKToqKlxuXFxgXFxgXFxgdHlwZXNjcmlwdFxuLy8gRXhpc3RpbmcgY29kZSBvciBcIk1pc3NpbmcgU2VjdGlvblwiXG5cXGBcXGBcXGBcblxuKipJbXByb3ZlZCBDb2RlIChBRlRFUik6KipcblxcYFxcYFxcYHR5cGVzY3JpcHRcbi8vIFRhcmdldGVkIHVwZGF0ZVxuXFxgXFxgXFxgXG5cbioqV2h5IFRoaXMgSGVscHM6KiogWzEtMiBzZW50ZW5jZXNdXG5cbi0tLVxuXG5SRU1FTUJFUjogQmUgc3VyZ2ljYWwgYW5kIGVmZmljaWVudC4gVGhlIGdvYWwgaXMgdG8gaGVscCB0aGUgS25vY2sgdGVhbSB1cGRhdGUgdGhlaXIgZG9jdW1lbnRhdGlvbiB3aXRoIG1pbmltYWwgZnJpY3Rpb24uYDtcblxuICAgICAgICBjb25zb2xlLmxvZyhg8J+agCBDYWxsaW5nIEJlZHJvY2sgdG8gZ2VuZXJhdGUgcmVjb21tZW5kYXRpb25zLi4uYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn6SWIE1vZGVsIElEOiB1cy5hbnRocm9waWMuY2xhdWRlLXNvbm5ldC00LTUtMjAyNTA5MjktdjE6MGApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TnSBQcm9tcHQgbGVuZ3RoOiAke3Byb21wdC5sZW5ndGh9IGNoYXJhY3RlcnNgKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCflI0gSXNzdWUgY29udGV4dCBsZW5ndGg6ICR7aXNzdWVDb250ZXh0Lmxlbmd0aH0gY2hhcmFjdGVyc2ApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+ThCBEb2MgY29udGV4dCBsZW5ndGg6ICR7ZG9jQ29udGV4dC5sZW5ndGh9IGNoYXJhY3RlcnNgKTtcblxuICAgICAgICAvLyBJbXBsZW1lbnQgY29udGludWF0aW9uIGxvZ2ljIGZvciB0cnVuY2F0ZWQgcmVzcG9uc2VzXG4gICAgICAgIGxldCBmdWxsUmVjb21tZW5kYXRpb25zVGV4dCA9ICcnO1xuICAgICAgICBsZXQgY29udmVyc2F0aW9uSGlzdG9yeTogQXJyYXk8eyByb2xlOiBzdHJpbmc7IGNvbnRlbnQ6IHN0cmluZyB9PiA9IFtcbiAgICAgICAgICAgIHsgcm9sZTogJ3VzZXInLCBjb250ZW50OiBwcm9tcHQgfVxuICAgICAgICBdO1xuICAgICAgICBsZXQgYXR0ZW1wdENvdW50ID0gMDtcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHMgPSA1OyAvLyBJbmNyZWFzZWQgdG8gNSBjb250aW51YXRpb24gYXR0ZW1wdHNcbiAgICAgICAgbGV0IHdhc1RydW5jYXRlZCA9IGZhbHNlO1xuXG4gICAgICAgIGRvIHtcbiAgICAgICAgICAgIGF0dGVtcHRDb3VudCsrO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYPCfk6EgQVBJIGNhbGwgYXR0ZW1wdCAke2F0dGVtcHRDb3VudH0vJHttYXhBdHRlbXB0c30uLi5gKTtcblxuICAgICAgICAgICAgY29uc3QgaW5wdXQgPSB7XG4gICAgICAgICAgICAgICAgbW9kZWxJZDogJ3VzLmFudGhyb3BpYy5jbGF1ZGUtc29ubmV0LTQtNS0yMDI1MDkyOS12MTowJyxcbiAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgIGFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICAgICAgYW50aHJvcGljX3ZlcnNpb246ICdiZWRyb2NrLTIwMjMtMDUtMzEnLFxuICAgICAgICAgICAgICAgICAgICBtYXhfdG9rZW5zOiA0MDk2LCAvLyBSZWR1Y2VkIHRvIDQwOTYgdG8gZW5jb3VyYWdlIG1vcmUgY29uY2lzZSByZXNwb25zZXNcbiAgICAgICAgICAgICAgICAgICAgdGVtcGVyYXR1cmU6IDAuMyxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZXM6IGNvbnZlcnNhdGlvbkhpc3RvcnlcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VNb2RlbENvbW1hbmQoaW5wdXQpO1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrQ2xpZW50LnNlbmQoY29tbWFuZCk7XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinIUgQmVkcm9jayByZXNwb25zZSByZWNlaXZlZCAoYXR0ZW1wdCAke2F0dGVtcHRDb3VudH0pYCk7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5ib2R5KSk7XG5cbiAgICAgICAgICAgIC8vIExvZyBkZXRhaWxlZCByZXNwb25zZSBpbmZvXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+TiyBSZXNwb25zZSBib2R5IGtleXM6ICR7T2JqZWN0LmtleXMocmVzcG9uc2VCb2R5KS5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYPCfm5EgU3RvcCByZWFzb246ICR7cmVzcG9uc2VCb2R5LnN0b3BfcmVhc29ufWApO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYPCfk4ogVXNhZ2U6IGlucHV0X3Rva2Vucz0ke3Jlc3BvbnNlQm9keS51c2FnZT8uaW5wdXRfdG9rZW5zfSwgb3V0cHV0X3Rva2Vucz0ke3Jlc3BvbnNlQm9keS51c2FnZT8ub3V0cHV0X3Rva2Vuc31gKTtcblxuICAgICAgICAgICAgY29uc3QgcGFydGlhbFRleHQgPSByZXNwb25zZUJvZHkuY29udGVudFswXS50ZXh0O1xuICAgICAgICAgICAgZnVsbFJlY29tbWVuZGF0aW9uc1RleHQgKz0gcGFydGlhbFRleHQ7XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OdIFBhcnRpYWwgcmVzcG9uc2UgbGVuZ3RoOiAke3BhcnRpYWxUZXh0Lmxlbmd0aH0gY2hhcnNgKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFRvdGFsIGFjY3VtdWxhdGVkIGxlbmd0aDogJHtmdWxsUmVjb21tZW5kYXRpb25zVGV4dC5sZW5ndGh9IGNoYXJzYCk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHJlc3BvbnNlIHdhcyB0cnVuY2F0ZWRcbiAgICAgICAgICAgIHdhc1RydW5jYXRlZCA9IHJlc3BvbnNlQm9keS5zdG9wX3JlYXNvbiA9PT0gJ21heF90b2tlbnMnO1xuXG4gICAgICAgICAgICBpZiAod2FzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gUmVzcG9uc2UgJHthdHRlbXB0Q291bnR9IHdhcyB0cnVuY2F0ZWQgKHN0b3BfcmVhc29uOiBtYXhfdG9rZW5zKWApO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5SEIEF0dGVtcHRpbmcgY29udGludWF0aW9uLi4uYCk7XG5cbiAgICAgICAgICAgICAgICAvLyBBZGQgdGhlIGFzc2lzdGFudCdzIHJlc3BvbnNlIHRvIGNvbnZlcnNhdGlvbiBoaXN0b3J5XG4gICAgICAgICAgICAgICAgY29udmVyc2F0aW9uSGlzdG9yeS5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgcm9sZTogJ2Fzc2lzdGFudCcsXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHBhcnRpYWxUZXh0XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAvLyBBZGQgYSBjb250aW51YXRpb24gcHJvbXB0XG4gICAgICAgICAgICAgICAgY29udmVyc2F0aW9uSGlzdG9yeS5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgcm9sZTogJ3VzZXInLFxuICAgICAgICAgICAgICAgICAgICBjb250ZW50OiAnUGxlYXNlIGNvbnRpbnVlIGZyb20gd2hlcmUgeW91IGxlZnQgb2ZmLiBDb21wbGV0ZSB0aGUgY29kZSBleGFtcGxlIGFuZCBleHBsYW5hdGlvbi4nXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinIUgUmVzcG9uc2UgJHthdHRlbXB0Q291bnR9IGNvbXBsZXRlZCBuYXR1cmFsbHkgKHN0b3BfcmVhc29uOiAke3Jlc3BvbnNlQm9keS5zdG9wX3JlYXNvbn0pYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSB3aGlsZSAod2FzVHJ1bmNhdGVkICYmIGF0dGVtcHRDb3VudCA8IG1heEF0dGVtcHRzKTtcblxuICAgICAgICBpZiAod2FzVHJ1bmNhdGVkICYmIGF0dGVtcHRDb3VudCA+PSBtYXhBdHRlbXB0cykge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gUmVhY2hlZCBtYXhpbXVtIGNvbnRpbnVhdGlvbiBhdHRlbXB0cyAoJHttYXhBdHRlbXB0c30pLiBSZXNwb25zZSBtYXkgc3RpbGwgYmUgaW5jb21wbGV0ZS5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlY29tbWVuZGF0aW9uc1RleHQgPSBmdWxsUmVjb21tZW5kYXRpb25zVGV4dDtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk50gRmluYWwgQUkgcmVjb21tZW5kYXRpb25zICgke3JlY29tbWVuZGF0aW9uc1RleHQubGVuZ3RofSBjaGFycyB0b3RhbCBmcm9tICR7YXR0ZW1wdENvdW50fSBBUEkgY2FsbHMpYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OEIEZ1bGwgcmVzcG9uc2UgcHJldmlldyAoZmlyc3QgNTAwIGNoYXJzKTogJHtyZWNvbW1lbmRhdGlvbnNUZXh0LnN1YnN0cmluZygwLCA1MDApfS4uLmApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+ThCBGdWxsIHJlc3BvbnNlIHByZXZpZXcgKGxhc3QgNTAwIGNoYXJzKTogLi4uJHtyZWNvbW1lbmRhdGlvbnNUZXh0LnN1YnN0cmluZyhyZWNvbW1lbmRhdGlvbnNUZXh0Lmxlbmd0aCAtIDUwMCl9YCk7XG5cbiAgICAgICAgLy8gUGFyc2UgcmVjb21tZW5kYXRpb25zIC0gcHJlc2VydmUgY29kZSBibG9ja3MgYnkgc3BsaXR0aW5nIG9uIGRvdWJsZSBuZXdsaW5lcyBvciBudW1iZXJlZCBsaXN0c1xuICAgICAgICAvLyBTcGxpdCBieSBwYXR0ZXJucyBsaWtlIFwiMS4gXCIsIFwiMi4gXCIsIGV0Yy4gb3IgZG91YmxlIG5ld2xpbmVzXG4gICAgICAgIGNvbnN0IHJlY29tbWVuZGF0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgY29uc3QgbGluZXMgPSByZWNvbW1lbmRhdGlvbnNUZXh0LnNwbGl0KCdcXG4nKTtcbiAgICAgICAgbGV0IGN1cnJlbnRSZWMgPSAnJztcblxuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGxpbmUgc3RhcnRzIHdpdGggYSBudW1iZXIgKDEuLCAyLiwgZXRjLikgLSBuZXcgcmVjb21tZW5kYXRpb25cbiAgICAgICAgICAgIGlmIChsaW5lLm1hdGNoKC9eXFxkK1xcLlxccy8pKSB7XG4gICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRSZWMudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKGN1cnJlbnRSZWMudHJpbSgpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY3VycmVudFJlYyA9IGxpbmUucmVwbGFjZSgvXlxcZCtcXC5cXHMvLCAnJyk7IC8vIFJlbW92ZSBudW1iZXJpbmdcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gQ29udGludWUgY3VycmVudCByZWNvbW1lbmRhdGlvbiAoaW5jbHVkaW5nIGNvZGUgYmxvY2tzKVxuICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UmVjIHx8IGxpbmUudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRSZWMgKz0gKGN1cnJlbnRSZWMgPyAnXFxuJyA6ICcnKSArIGxpbmU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIHRoZSBsYXN0IHJlY29tbWVuZGF0aW9uXG4gICAgICAgIGlmIChjdXJyZW50UmVjLnRyaW0oKSkge1xuICAgICAgICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goY3VycmVudFJlYy50cmltKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coYOKchSBHZW5lcmF0ZWQgJHtyZWNvbW1lbmRhdGlvbnMubGVuZ3RofSBBSSByZWNvbW1lbmRhdGlvbnMgc3VjY2Vzc2Z1bGx5YCk7XG4gICAgICAgIHJldHVybiByZWNvbW1lbmRhdGlvbnMuc2xpY2UoMCwgNSk7IC8vIExpbWl0IHRvIDUgcmVjb21tZW5kYXRpb25zXG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGdlbmVyYXRlIEFJIHJlY29tbWVuZGF0aW9uczonLCBlcnJvcik7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfwn5SNIEVycm9yIGRldGFpbHM6Jywge1xuICAgICAgICAgICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgICBjb2RlOiAoZXJyb3IgYXMgYW55KS5jb2RlLFxuICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IChlcnJvciBhcyBhbnkpLiRtZXRhZGF0YT8uaHR0cFN0YXR1c0NvZGUsXG4gICAgICAgICAgICAgICAgcmVxdWVzdElkOiAoZXJyb3IgYXMgYW55KS4kbWV0YWRhdGE/LnJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2tcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SEIEZhbGxpbmcgYmFjayB0byBnZW5lcmljIHJlY29tbWVuZGF0aW9uc2ApO1xuXG4gICAgICAgIC8vIEVuaGFuY2VkIGZhbGxiYWNrIHJlY29tbWVuZGF0aW9ucyB3aXRoIG1vcmUgc3BlY2lmaWMgY29udGVudFxuICAgICAgICBjb25zdCBmYWxsYmFja1JlY29tbWVuZGF0aW9ucyA9IFtcbiAgICAgICAgICAgIGBBZGQgdHJvdWJsZXNob290aW5nIHNlY3Rpb24gZm9yIFwiJHtpc3N1ZS50aXRsZX1cIiB3aXRoIHNwZWNpZmljIGVycm9yIGhhbmRsaW5nYCxcbiAgICAgICAgICAgIGBJbmNsdWRlIGNvZGUgZXhhbXBsZXMgYWRkcmVzc2luZyAke2lzc3VlLmNhdGVnb3J5fSBpc3N1ZXNgLFxuICAgICAgICAgICAgYEFkZCBwcm9kdWN0aW9uIGRlcGxveW1lbnQgZ3VpZGFuY2UgZm9yIGNvbW1vbiAke2lzc3VlLmNhdGVnb3J5fSBwcm9ibGVtc2AsXG4gICAgICAgICAgICBgUmVmZXJlbmNlIGRldmVsb3BlciBpc3N1ZTogJHtpc3N1ZS5zb3VyY2VzWzBdfWBcbiAgICAgICAgXTtcblxuICAgICAgICBjb25zb2xlLmxvZyhg8J+TnSBVc2luZyBlbmhhbmNlZCBmYWxsYmFjayByZWNvbW1lbmRhdGlvbnM6ICR7ZmFsbGJhY2tSZWNvbW1lbmRhdGlvbnMubGVuZ3RofSBpdGVtc2ApO1xuICAgICAgICByZXR1cm4gZmFsbGJhY2tSZWNvbW1lbmRhdGlvbnM7XG4gICAgfVxufVxuXG4vKipcbiAqIE1ha2UgSFRUUCByZXF1ZXN0XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIG1ha2VIdHRwUmVxdWVzdCh1cmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsT2JqID0gbmV3IFVSTCh1cmwpO1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgICAgICAgaG9zdG5hbWU6IHVybE9iai5ob3N0bmFtZSxcbiAgICAgICAgICAgIHBvcnQ6IHVybE9iai5wb3J0IHx8IDQ0MyxcbiAgICAgICAgICAgIHBhdGg6IHVybE9iai5wYXRobmFtZSArIHVybE9iai5zZWFyY2gsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdVc2VyLUFnZW50JzogJ0xlbnN5LURvY3VtZW50YXRpb24tQXVkaXRvci8xLjAnXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVxID0gaHR0cHMucmVxdWVzdChvcHRpb25zLCAocmVzKSA9PiB7XG4gICAgICAgICAgICBsZXQgZGF0YSA9ICcnO1xuICAgICAgICAgICAgcmVzLm9uKCdkYXRhJywgKGNodW5rKSA9PiBkYXRhICs9IGNodW5rKTtcbiAgICAgICAgICAgIHJlcy5vbignZW5kJywgKCkgPT4gcmVzb2x2ZShkYXRhKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJlcS5vbignZXJyb3InLCByZWplY3QpO1xuICAgICAgICByZXEuc2V0VGltZW91dCgxMDAwMCwgKCkgPT4ge1xuICAgICAgICAgICAgcmVxLmRlc3Ryb3koKTtcbiAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoJ1JlcXVlc3QgdGltZW91dCcpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVxLmVuZCgpO1xuICAgIH0pO1xufVxuXG4vKipcbiAqIFN0b3JlIHZhbGlkYXRpb24gcmVzdWx0cyBpbiBTM1xuICovXG5hc3luYyBmdW5jdGlvbiBzdG9yZVZhbGlkYXRpb25SZXN1bHRzKHNlc3Npb25JZDogc3RyaW5nLCByZXN1bHRzOiBJc3N1ZVZhbGlkYXRvck91dHB1dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5TM19CVUNLRVRfTkFNRTtcbiAgICBpZiAoIWJ1Y2tldE5hbWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTM19CVUNLRVRfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgfVxuXG4gICAgY29uc3Qga2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9pc3N1ZS12YWxpZGF0aW9uLXJlc3VsdHMuanNvbmA7XG4gICAgY29uc3QgY29udGVudCA9IEpTT04uc3RyaW5naWZ5KHJlc3VsdHMsIG51bGwsIDIpO1xuXG4gICAgYXdhaXQgczNDbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgS2V5OiBrZXksXG4gICAgICAgIEJvZHk6IGNvbnRlbnQsXG4gICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICB9KSk7XG5cbiAgICBjb25zb2xlLmxvZyhgU3RvcmVkIHZhbGlkYXRpb24gcmVzdWx0cyBpbiBTMzogJHtrZXl9YCk7XG59XG5cbi8qKlxuICogUGVyZm9ybSBzaXRlbWFwIGhlYWx0aCBjaGVjayBmb3IgdGhlIGdpdmVuIGRvbWFpbiB3aXRoIGNhY2hpbmdcbiAqL1xuYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVNpdGVtYXBIZWFsdGhDaGVjayhkb21haW46IHN0cmluZywgc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPFNpdGVtYXBIZWFsdGhTdW1tYXJ5IHwgbnVsbD4ge1xuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5TM19CVUNLRVRfTkFNRTtcbiAgICBpZiAoIWJ1Y2tldE5hbWUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignUzNfQlVDS0VUX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgbm90IHNldCcpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBOb3JtYWxpemUgZG9tYWluIGZvciBjb25zaXN0ZW50IGNvbmZpZ3VyYXRpb24gbG9va3VwXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWREb21haW4gPSBub3JtYWxpemVEb21haW4oZG9tYWluKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCflI0gU3RhcnRpbmcgc2l0ZW1hcCBoZWFsdGggY2hlY2sgZm9yIGRvbWFpbjogJHtkb21haW59IChub3JtYWxpemVkOiAke25vcm1hbGl6ZWREb21haW59KWApO1xuXG4gICAgICAgIC8vIERvbWFpbi1zcGVjaWZpYyBjYWNoZSBrZXkgKHNpbWlsYXIgdG8gZW1iZWRkaW5ncylcbiAgICAgICAgY29uc3QgY2FjaGVLZXkgPSBgc2l0ZW1hcC1oZWFsdGgtJHtub3JtYWxpemVkRG9tYWluLnJlcGxhY2UoL1xcLi9nLCAnLScpfS5qc29uYDtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk6YgQ2FjaGUga2V5OiAke2NhY2hlS2V5fWApO1xuXG4gICAgICAgIC8vIFRyeSB0byBsb2FkIGNhY2hlZCBoZWFsdGggcmVzdWx0cyBmcm9tIFMzXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygn8J+UjSBDaGVja2luZyBmb3IgY2FjaGVkIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHMuLi4nKTtcbiAgICAgICAgICAgIGNvbnN0IGdldENvbW1hbmQgPSBuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgICAgIEtleTogY2FjaGVLZXlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHMzQ2xpZW50LnNlbmQoZ2V0Q29tbWFuZCk7XG4gICAgICAgICAgICBjb25zdCBjYWNoZWREYXRhID0gYXdhaXQgcmVzcG9uc2UuQm9keT8udHJhbnNmb3JtVG9TdHJpbmcoKTtcblxuICAgICAgICAgICAgaWYgKGNhY2hlZERhdGEpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjYWNoZWRIZWFsdGg6IFNpdGVtYXBIZWFsdGhTdW1tYXJ5ID0gSlNPTi5wYXJzZShjYWNoZWREYXRhKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFVzaW5nIGNhY2hlZCBzaXRlbWFwIGhlYWx0aCByZXN1bHRzICgke2NhY2hlZEhlYWx0aC50b3RhbFVybHN9IFVSTHMsICR7Y2FjaGVkSGVhbHRoLmhlYWx0aFBlcmNlbnRhZ2V9JSBoZWFsdGh5KWApO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OFIENhY2hlIHRpbWVzdGFtcDogJHtjYWNoZWRIZWFsdGgudGltZXN0YW1wfWApO1xuICAgICAgICAgICAgICAgIHJldHVybiBjYWNoZWRIZWFsdGg7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygn8J+TnSBObyBjYWNoZWQgcmVzdWx0cyBmb3VuZCwgcGVyZm9ybWluZyBmcmVzaCBoZWFsdGggY2hlY2suLi4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCBkb21haW4tc3BlY2lmaWMgc2l0ZW1hcCBVUkwgYW5kIGRvYyBmaWx0ZXJcbiAgICAgICAgY29uc3QgY29uZmlnID0gRE9NQUlOX1NJVEVNQVBfQ09ORklHW25vcm1hbGl6ZWREb21haW5dO1xuICAgICAgICBjb25zdCBzaXRlbWFwVXJsID0gY29uZmlnID8gY29uZmlnLnNpdGVtYXBVcmwgOiBgaHR0cHM6Ly8ke25vcm1hbGl6ZWREb21haW59L3NpdGVtYXAueG1sYDtcbiAgICAgICAgY29uc3QgZG9jRmlsdGVyID0gY29uZmlnID8gY29uZmlnLmRvY0ZpbHRlciA6ICcvZG9jcyc7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OEIENoZWNraW5nIHNpdGVtYXA6ICR7c2l0ZW1hcFVybH0gKGZpbHRlcmluZyBmb3I6ICR7ZG9jRmlsdGVyfSlgKTtcblxuICAgICAgICAvLyBTdGVwIDE6IEludm9rZSBTaXRlbWFwUGFyc2VyIExhbWJkYVxuICAgICAgICBjb25zdCBzaXRlbWFwUGFyc2VyUGF5bG9hZCA9IHtcbiAgICAgICAgICAgIHVybDogc2l0ZW1hcFVybCxcbiAgICAgICAgICAgIHNlc3Npb25JZDogc2Vzc2lvbklkLFxuICAgICAgICAgICAgaW5wdXRUeXBlOiAnc2l0ZW1hcCdcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zb2xlLmxvZyhg8J+agCBJbnZva2luZyBTaXRlbWFwUGFyc2VyIExhbWJkYS4uLmApO1xuICAgICAgICBjb25zdCBwYXJzZXJSZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZCh7XG4gICAgICAgICAgICBGdW5jdGlvbk5hbWU6ICdMZW5zeVN0YWNrLVNpdGVtYXBQYXJzZXJGdW5jdGlvbjFBMDA3REY5LTlxb1RBRFlpN2tDbScsXG4gICAgICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShzaXRlbWFwUGFyc2VyUGF5bG9hZClcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGlmICghcGFyc2VyUmVzdWx0LlBheWxvYWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gcmVzcG9uc2UgZnJvbSBTaXRlbWFwUGFyc2VyJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwYXJzZXJSZXNwb25zZSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHBhcnNlclJlc3VsdC5QYXlsb2FkKSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFNpdGVtYXBQYXJzZXIgcmVzdWx0OiAke3BhcnNlclJlc3BvbnNlLnN1Y2Nlc3MgPyAnU1VDQ0VTUycgOiAnRkFJTEVEJ31gKTtcblxuICAgICAgICBpZiAoIXBhcnNlclJlc3BvbnNlLnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinYwgU2l0ZW1hcFBhcnNlciBmYWlsZWQ6ICR7cGFyc2VyUmVzcG9uc2UubWVzc2FnZX1gKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmlsdGVyIFVSTHMgdG8gb25seSBpbmNsdWRlIGRvY3VtZW50YXRpb24gcGFnZXNcbiAgICAgICAgY29uc3QgYWxsVXJscyA9IHBhcnNlclJlc3BvbnNlLnNpdGVtYXBVcmxzIHx8IFtdO1xuICAgICAgICAvLyBVUkxzIG1pZ2h0IGJlIGZ1bGwgVVJMcyBvciBwYXRocywgaGFuZGxlIGJvdGggY2FzZXNcbiAgICAgICAgY29uc3QgZG9jVXJscyA9IGFsbFVybHMuZmlsdGVyKCh1cmw6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgLy8gRXh0cmFjdCBwYXRoIGZyb20gZnVsbCBVUkwgaWYgbmVlZGVkXG4gICAgICAgICAgICBjb25zdCBwYXRoID0gdXJsLnN0YXJ0c1dpdGgoJ2h0dHAnKSA/IG5ldyBVUkwodXJsKS5wYXRobmFtZSA6IHVybDtcbiAgICAgICAgICAgIHJldHVybiBwYXRoLnN0YXJ0c1dpdGgoZG9jRmlsdGVyKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OLIEZpbHRlcmVkIHRvICR7ZG9jVXJscy5sZW5ndGh9IGRvY3VtZW50YXRpb24gVVJMcyBmcm9tICR7YWxsVXJscy5sZW5ndGh9IHRvdGFsIFVSTHNgKTtcblxuICAgICAgICAvLyBDcmVhdGUgZmlsdGVyZWQgcGFyc2VyIHJlc3BvbnNlIHdpdGggY29ycmVjdCBmaWVsZCBuYW1lcyBmb3IgU2l0ZW1hcEhlYWx0aENoZWNrZXJcbiAgICAgICAgY29uc3QgZmlsdGVyZWRQYXJzZXJSZXNwb25zZSA9IHtcbiAgICAgICAgICAgIC4uLnBhcnNlclJlc3BvbnNlLFxuICAgICAgICAgICAgc2l0ZW1hcFVybHM6IGRvY1VybHMsICAvLyBTaXRlbWFwSGVhbHRoQ2hlY2tlciBleHBlY3RzICdzaXRlbWFwVXJscycgbm90ICd1cmxzJ1xuICAgICAgICAgICAgdG90YWxVcmxzOiBkb2NVcmxzLmxlbmd0aFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFN0ZXAgMjogSW52b2tlIFNpdGVtYXBIZWFsdGhDaGVja2VyIExhbWJkYSB3aXRoIGZpbHRlcmVkIFVSTHNcbiAgICAgICAgY29uc3QgaGVhbHRoQ2hlY2tlclBheWxvYWQgPSB7XG4gICAgICAgICAgICBzZXNzaW9uSWQ6IHNlc3Npb25JZCxcbiAgICAgICAgICAgIHNpdGVtYXBQYXJzZXJSZXN1bHQ6IHtcbiAgICAgICAgICAgICAgICBQYXlsb2FkOiBmaWx0ZXJlZFBhcnNlclJlc3BvbnNlXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc29sZS5sb2coYPCfmoAgSW52b2tpbmcgU2l0ZW1hcEhlYWx0aENoZWNrZXIgTGFtYmRhLi4uYCk7XG4gICAgICAgIGNvbnN0IGhlYWx0aFJlc3VsdCA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKG5ldyBJbnZva2VDb21tYW5kKHtcbiAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogJ0xlbnN5U3RhY2stU2l0ZW1hcEhlYWx0aENoZWNrZXJGdW5jdGlvbkIyM0U0RjUzLVI4M0RPZzZHaDBMWScsXG4gICAgICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShoZWFsdGhDaGVja2VyUGF5bG9hZClcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGlmICghaGVhbHRoUmVzdWx0LlBheWxvYWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gcmVzcG9uc2UgZnJvbSBTaXRlbWFwSGVhbHRoQ2hlY2tlcicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaGVhbHRoUmVzcG9uc2UgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShoZWFsdGhSZXN1bHQuUGF5bG9hZCkpO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBTaXRlbWFwSGVhbHRoQ2hlY2tlciByZXN1bHQ6ICR7aGVhbHRoUmVzcG9uc2Uuc3VjY2VzcyA/ICdTVUNDRVNTJyA6ICdGQUlMRUQnfWApO1xuXG4gICAgICAgIGlmICghaGVhbHRoUmVzcG9uc2Uuc3VjY2Vzcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKdjCBTaXRlbWFwSGVhbHRoQ2hlY2tlciBmYWlsZWQ6ICR7aGVhbHRoUmVzcG9uc2UubWVzc2FnZX1gKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmV0dXJuIHRoZSBoZWFsdGggc3VtbWFyeSB3aXRoIGJyZWFrZG93biBjb3VudHNcbiAgICAgICAgY29uc3QgaGVhbHRoU3VtbWFyeTogU2l0ZW1hcEhlYWx0aFN1bW1hcnkgPSB7XG4gICAgICAgICAgICAuLi5oZWFsdGhSZXNwb25zZS5oZWFsdGhTdW1tYXJ5LFxuICAgICAgICAgICAgYnJva2VuVXJsczogaGVhbHRoUmVzcG9uc2UuYnJva2VuVXJscyxcbiAgICAgICAgICAgIGFjY2Vzc0RlbmllZFVybHM6IGhlYWx0aFJlc3BvbnNlLmFjY2Vzc0RlbmllZFVybHMsXG4gICAgICAgICAgICB0aW1lb3V0VXJsczogaGVhbHRoUmVzcG9uc2UudGltZW91dFVybHMsXG4gICAgICAgICAgICBvdGhlckVycm9yVXJsczogaGVhbHRoUmVzcG9uc2Uub3RoZXJFcnJvclVybHNcbiAgICAgICAgfTtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBTaXRlbWFwIGhlYWx0aCBjaGVjayBjb21wbGV0ZTogJHtoZWFsdGhTdW1tYXJ5LmhlYWx0aHlVcmxzfS8ke2hlYWx0aFN1bW1hcnkudG90YWxVcmxzfSBVUkxzIGhlYWx0aHkgKCR7aGVhbHRoU3VtbWFyeS5oZWFsdGhQZXJjZW50YWdlfSUpYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIEJyZWFrZG93bjogJHtoZWFsdGhTdW1tYXJ5LmJyb2tlblVybHN9IGJyb2tlbiwgJHtoZWFsdGhTdW1tYXJ5LmFjY2Vzc0RlbmllZFVybHN9IGFjY2VzcyBkZW5pZWQsICR7aGVhbHRoU3VtbWFyeS50aW1lb3V0VXJsc30gdGltZW91dCwgJHtoZWFsdGhTdW1tYXJ5Lm90aGVyRXJyb3JVcmxzfSBvdGhlciBlcnJvcnNgKTtcblxuICAgICAgICAvLyBTdG9yZSBoZWFsdGggcmVzdWx0cyBpbiBkb21haW4tc3BlY2lmaWMgY2FjaGVcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHB1dENvbW1hbmQgPSBuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgICAgIEtleTogY2FjaGVLZXksXG4gICAgICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkoaGVhbHRoU3VtbWFyeSwgbnVsbCwgMiksXG4gICAgICAgICAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQocHV0Q29tbWFuZCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+SviBDYWNoZWQgc2l0ZW1hcCBoZWFsdGggcmVzdWx0cyB0bzogJHtjYWNoZUtleX1gKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KaoO+4jyBGYWlsZWQgdG8gY2FjaGUgc2l0ZW1hcCBoZWFsdGggcmVzdWx0czonLCBlcnJvcik7XG4gICAgICAgICAgICAvLyBEb24ndCBmYWlsIHRoZSB3aG9sZSBvcGVyYXRpb24gaWYgY2FjaGluZyBmYWlsc1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGhlYWx0aFN1bW1hcnk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgU2l0ZW1hcCBoZWFsdGggY2hlY2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZygnSXNzdWVWYWxpZGF0b3IgTGFtYmRhIHN0YXJ0ZWQnLCB7IGV2ZW50OiBKU09OLnN0cmluZ2lmeShldmVudCkgfSk7XG5cbiAgICAgICAgLy8gUGFyc2UgaW5wdXRcbiAgICAgICAgY29uc3QgaW5wdXQ6IElzc3VlVmFsaWRhdG9ySW5wdXQgPSB0eXBlb2YgZXZlbnQuYm9keSA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgID8gSlNPTi5wYXJzZShldmVudC5ib2R5KVxuICAgICAgICAgICAgOiBldmVudC5ib2R5IGFzIGFueTtcblxuICAgICAgICBjb25zdCB7IGlzc3VlcywgZG9tYWluLCBzZXNzaW9uSWQgfSA9IGlucHV0O1xuXG4gICAgICAgIGlmICghaXNzdWVzIHx8ICFkb21haW4gfHwgIXNlc3Npb25JZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNaXNzaW5nIHJlcXVpcmVkIHBhcmFtZXRlcnM6IGlzc3VlcywgZG9tYWluLCBhbmQgc2Vzc2lvbklkJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhgVmFsaWRhdGluZyAke2lzc3Vlcy5sZW5ndGh9IGlzc3VlcyBmb3IgZG9tYWluOiAke2RvbWFpbn1gKTtcblxuICAgICAgICAvLyBTdGFydCBib3RoIGlzc3VlIHZhbGlkYXRpb24gYW5kIHNpdGVtYXAgaGVhbHRoIGNoZWNrIGluIHBhcmFsbGVsXG4gICAgICAgIGNvbnN0IFt2YWxpZGF0aW9uUmVzdWx0cywgc2l0ZW1hcEhlYWx0aF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgICAgICAvLyBJc3N1ZSB2YWxpZGF0aW9uIChleGlzdGluZyBsb2dpYylcbiAgICAgICAgICAgIFByb21pc2UuYWxsKGlzc3Vlcy5tYXAoaXNzdWUgPT4gdmFsaWRhdGVJc3N1ZShpc3N1ZSwgZG9tYWluKSkpLFxuICAgICAgICAgICAgLy8gU2l0ZW1hcCBoZWFsdGggY2hlY2sgKG5ldyBsb2dpYylcbiAgICAgICAgICAgIHBlcmZvcm1TaXRlbWFwSGVhbHRoQ2hlY2soZG9tYWluLCBzZXNzaW9uSWQpXG4gICAgICAgIF0pO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgSXNzdWUgdmFsaWRhdGlvbiBjb21wbGV0ZWQ6ICR7dmFsaWRhdGlvblJlc3VsdHMubGVuZ3RofSBpc3N1ZXMgcHJvY2Vzc2VkYCk7XG4gICAgICAgIGlmIChzaXRlbWFwSGVhbHRoKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFNpdGVtYXAgaGVhbHRoIGNoZWNrIGNvbXBsZXRlZDogJHtzaXRlbWFwSGVhbHRoLmhlYWx0aHlVcmxzfS8ke3NpdGVtYXBIZWFsdGgudG90YWxVcmxzfSBVUkxzIGhlYWx0aHlgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDimqDvuI8gU2l0ZW1hcCBoZWFsdGggY2hlY2sgc2tpcHBlZCBvciBmYWlsZWRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENhbGN1bGF0ZSBzdW1tYXJ5XG4gICAgICAgIGNvbnN0IHN1bW1hcnkgPSB7XG4gICAgICAgICAgICB0b3RhbElzc3VlczogdmFsaWRhdGlvblJlc3VsdHMubGVuZ3RoLFxuICAgICAgICAgICAgY29uZmlybWVkOiB2YWxpZGF0aW9uUmVzdWx0cy5maWx0ZXIociA9PiByLnN0YXR1cyA9PT0gJ2NvbmZpcm1lZCcpLmxlbmd0aCxcbiAgICAgICAgICAgIHJlc29sdmVkOiB2YWxpZGF0aW9uUmVzdWx0cy5maWx0ZXIociA9PiByLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJykubGVuZ3RoLFxuICAgICAgICAgICAgcG90ZW50aWFsR2FwczogdmFsaWRhdGlvblJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdwb3RlbnRpYWwtZ2FwJykubGVuZ3RoLFxuICAgICAgICAgICAgY3JpdGljYWxHYXBzOiB2YWxpZGF0aW9uUmVzdWx0cy5maWx0ZXIociA9PiByLnN0YXR1cyA9PT0gJ2NyaXRpY2FsLWdhcCcpLmxlbmd0aFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHByb2Nlc3NpbmdUaW1lID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcblxuICAgICAgICBjb25zdCBvdXRwdXQ6IElzc3VlVmFsaWRhdG9yT3V0cHV0ID0ge1xuICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdHMsXG4gICAgICAgICAgICBzdW1tYXJ5LFxuICAgICAgICAgICAgcHJvY2Vzc2luZ1RpbWUsXG4gICAgICAgICAgICBzaXRlbWFwSGVhbHRoOiBzaXRlbWFwSGVhbHRoIHx8IHVuZGVmaW5lZCAvLyBJbmNsdWRlIHNpdGVtYXAgaGVhbHRoIGlmIGF2YWlsYWJsZVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFN0b3JlIHJlc3VsdHMgaW4gUzNcbiAgICAgICAgYXdhaXQgc3RvcmVWYWxpZGF0aW9uUmVzdWx0cyhzZXNzaW9uSWQsIG91dHB1dCk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYElzc3VlVmFsaWRhdG9yIGNvbXBsZXRlZCBpbiAke3Byb2Nlc3NpbmdUaW1lfW1zYCwgc3VtbWFyeSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShvdXRwdXQpXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdJc3N1ZVZhbGlkYXRvciBlcnJvcjonLCBlcnJvcik7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgZXJyb3I6ICdJc3N1ZSB2YWxpZGF0aW9uIGZhaWxlZCcsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdHM6IFtdLFxuICAgICAgICAgICAgICAgIHN1bW1hcnk6IHtcbiAgICAgICAgICAgICAgICAgICAgdG90YWxJc3N1ZXM6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpcm1lZDogMCxcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgIHBvdGVudGlhbEdhcHM6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNyaXRpY2FsR2FwczogMFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1RpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWVcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxufTtcbiJdfQ==