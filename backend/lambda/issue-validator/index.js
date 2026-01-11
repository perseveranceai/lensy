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
        const prompt = `You are a technical documentation expert analyzing a developer issue.

DEVELOPER ISSUE:
- Title: ${issue.title}
- Description: ${issue.description}
- Error: ${issue.errorMessages?.[0] || 'N/A'}
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBa0Y7QUFDbEYsNEVBQTJGO0FBQzNGLDBEQUFxRTtBQUNyRSxrREFBMEI7QUFDMUIsNkJBQTBCO0FBRTFCLE1BQU0sUUFBUSxHQUFHLElBQUksb0JBQVEsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDbEUsTUFBTSxhQUFhLEdBQUcsSUFBSSw2Q0FBb0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsb0NBQW9DO0FBQzdHLE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFrRzFFOztHQUVHO0FBQ0gsS0FBSyxVQUFVLGlCQUFpQixDQUFDLElBQVk7SUFDekMsSUFBSTtRQUNBLE1BQU0sS0FBSyxHQUFHO1lBQ1YsT0FBTyxFQUFFLDRCQUE0QjtZQUNyQyxXQUFXLEVBQUUsa0JBQWtCO1lBQy9CLE1BQU0sRUFBRSxrQkFBa0I7WUFDMUIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ2pCLFNBQVMsRUFBRSxJQUFJO2FBQ2xCLENBQUM7U0FDTCxDQUFDO1FBRUYsTUFBTSxPQUFPLEdBQUcsSUFBSSwyQ0FBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUM5QyxNQUFNLFFBQVEsR0FBRyxNQUFNLGFBQWEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7UUFFbkQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLFdBQVcsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUN6RSxPQUFPLFlBQVksQ0FBQyxTQUFTLENBQUM7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LENBQUM7b0JBQ1osUUFBUSxFQUFFLENBQUM7b0JBQ1gsYUFBYSxFQUFFLENBQUM7b0JBQ2hCLFlBQVksRUFBRSxDQUFDO2lCQUNsQjtnQkFDRCxjQUFjLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVM7YUFDekMsQ0FBQztTQUNMLENBQUM7S0FDTDtBQUNMLENBQUMsQ0FBQztBQTFGVyxRQUFBLE9BQU8sV0EwRmxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQsIFB1dE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgQmVkcm9ja1J1bnRpbWVDbGllbnQsIEludm9rZU1vZGVsQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1iZWRyb2NrLXJ1bnRpbWUnO1xuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XG5pbXBvcnQgaHR0cHMgZnJvbSAnaHR0cHMnO1xuaW1wb3J0IHsgVVJMIH0gZnJvbSAndXJsJztcblxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XG5jb25zdCBiZWRyb2NrQ2xpZW50ID0gbmV3IEJlZHJvY2tSdW50aW1lQ2xpZW50KHsgcmVnaW9uOiAndXMtZWFzdC0xJyB9KTsgLy8gQmVkcm9jayBpcyBhdmFpbGFibGUgaW4gdXMtZWFzdC0xXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xuXG5pbnRlcmZhY2UgRGlzY292ZXJlZElzc3VlIHtcbiAgICBpZDogc3RyaW5nO1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgY2F0ZWdvcnk6IHN0cmluZztcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAgIGZyZXF1ZW5jeTogbnVtYmVyO1xuICAgIHNvdXJjZXM6IHN0cmluZ1tdO1xuICAgIGxhc3RTZWVuOiBzdHJpbmc7XG4gICAgc2V2ZXJpdHk6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG4gICAgcmVsYXRlZFBhZ2VzOiBzdHJpbmdbXTtcbiAgICAvLyBSaWNoIGNvbnRlbnQgZnJvbSBzb3VyY2VcbiAgICBmdWxsQ29udGVudD86IHN0cmluZzsgIC8vIEZ1bGwgcXVlc3Rpb24vaXNzdWUgYm9keVxuICAgIGNvZGVTbmlwcGV0cz86IHN0cmluZ1tdOyAgLy8gQ29kZSBleGFtcGxlcyBmcm9tIHRoZSBpc3N1ZVxuICAgIGVycm9yTWVzc2FnZXM/OiBzdHJpbmdbXTsgIC8vIEV4dHJhY3RlZCBlcnJvciBtZXNzYWdlc1xuICAgIHRhZ3M/OiBzdHJpbmdbXTsgIC8vIFRlY2hub2xvZ3kgdGFnc1xuICAgIHN0YWNrVHJhY2U/OiBzdHJpbmc7ICAvLyBTdGFjayB0cmFjZXMgaWYgcHJlc2VudFxufVxuXG5pbnRlcmZhY2UgSXNzdWVWYWxpZGF0b3JJbnB1dCB7XG4gICAgaXNzdWVzOiBEaXNjb3ZlcmVkSXNzdWVbXTtcbiAgICBkb21haW46IHN0cmluZztcbiAgICBzZXNzaW9uSWQ6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEV2aWRlbmNlIHtcbiAgICBwYWdlVXJsOiBzdHJpbmc7XG4gICAgcGFnZVRpdGxlOiBzdHJpbmc7XG4gICAgaGFzUmVsZXZhbnRDb250ZW50OiBib29sZWFuO1xuICAgIGNvbnRlbnRHYXBzOiBzdHJpbmdbXTtcbiAgICBjb2RlRXhhbXBsZXM6IG51bWJlcjtcbiAgICBwcm9kdWN0aW9uR3VpZGFuY2U6IGJvb2xlYW47XG4gICAgc2VtYW50aWNTY29yZT86IG51bWJlcjsgLy8gU2VtYW50aWMgc2ltaWxhcml0eSBzY29yZSAoMC0xKVxufVxuXG5pbnRlcmZhY2UgR2FwQW5hbHlzaXMge1xuICAgIGdhcFR5cGU6ICdwb3RlbnRpYWwtZ2FwJyB8ICdjcml0aWNhbC1nYXAnIHwgJ3Jlc29sdmVkJztcbiAgICBwYWdlVXJsPzogc3RyaW5nO1xuICAgIHBhZ2VUaXRsZT86IHN0cmluZztcbiAgICBtaXNzaW5nQ29udGVudDogc3RyaW5nW107XG4gICAgcmVhc29uaW5nOiBzdHJpbmc7XG4gICAgZGV2ZWxvcGVySW1wYWN0OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBWYWxpZGF0aW9uUmVzdWx0IHtcbiAgICBpc3N1ZUlkOiBzdHJpbmc7XG4gICAgaXNzdWVUaXRsZTogc3RyaW5nO1xuICAgIHN0YXR1czogJ2NvbmZpcm1lZCcgfCAncmVzb2x2ZWQnIHwgJ3BvdGVudGlhbC1nYXAnIHwgJ2NyaXRpY2FsLWdhcCc7XG4gICAgZXZpZGVuY2U6IEV2aWRlbmNlW107XG4gICAgbWlzc2luZ0VsZW1lbnRzOiBzdHJpbmdbXTtcbiAgICBwb3RlbnRpYWxHYXBzOiBHYXBBbmFseXNpc1tdO1xuICAgIGNyaXRpY2FsR2Fwczogc3RyaW5nW107XG4gICAgY29uZmlkZW5jZTogbnVtYmVyO1xuICAgIHJlY29tbWVuZGF0aW9uczogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBJc3N1ZVZhbGlkYXRvck91dHB1dCB7XG4gICAgdmFsaWRhdGlvblJlc3VsdHM6IFZhbGlkYXRpb25SZXN1bHRbXTtcbiAgICBzdW1tYXJ5OiB7XG4gICAgICAgIHRvdGFsSXNzdWVzOiBudW1iZXI7XG4gICAgICAgIGNvbmZpcm1lZDogbnVtYmVyO1xuICAgICAgICByZXNvbHZlZDogbnVtYmVyO1xuICAgICAgICBwb3RlbnRpYWxHYXBzOiBudW1iZXI7XG4gICAgICAgIGNyaXRpY2FsR2FwczogbnVtYmVyO1xuICAgIH07XG4gICAgcHJvY2Vzc2luZ1RpbWU6IG51bWJlcjtcbiAgICBzaXRlbWFwSGVhbHRoPzogU2l0ZW1hcEhlYWx0aFN1bW1hcnk7IC8vIE5FVzogT3B0aW9uYWwgc2l0ZW1hcCBoZWFsdGggZGF0YVxufVxuXG5pbnRlcmZhY2UgU2l0ZW1hcEhlYWx0aFN1bW1hcnkge1xuICAgIHRvdGFsVXJsczogbnVtYmVyO1xuICAgIGhlYWx0aHlVcmxzOiBudW1iZXI7XG4gICAgYnJva2VuVXJsczogbnVtYmVyO1xuICAgIGFjY2Vzc0RlbmllZFVybHM6IG51bWJlcjtcbiAgICB0aW1lb3V0VXJsczogbnVtYmVyO1xuICAgIG90aGVyRXJyb3JVcmxzOiBudW1iZXI7XG4gICAgbGlua0lzc3VlczogTGlua0lzc3VlW107XG4gICAgaGVhbHRoUGVyY2VudGFnZTogbnVtYmVyO1xuICAgIHByb2Nlc3NpbmdUaW1lOiBudW1iZXI7XG4gICAgdGltZXN0YW1wOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBMaW5rSXNzdWUge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHN0YXR1czogbnVtYmVyIHwgc3RyaW5nO1xuICAgIGVycm9yTWVzc2FnZTogc3RyaW5nO1xuICAgIGlzc3VlVHlwZTogJzQwNCcgfCAnYWNjZXNzLWRlbmllZCcgfCAndGltZW91dCcgfCAnZXJyb3InO1xufVxuXG5pbnRlcmZhY2UgUmljaENvbnRlbnRFbWJlZGRpbmcge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgICBjb250ZW50OiBzdHJpbmc7XG4gICAgZW1iZWRkaW5nOiBudW1iZXJbXTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBlbWJlZGRpbmcgZm9yIHRleHQgdXNpbmcgQW1hem9uIEJlZHJvY2sgVGl0YW5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVFbWJlZGRpbmcodGV4dDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXJbXT4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0ge1xuICAgICAgICAgICAgbW9kZWxJZDogJ2FtYXpvbi50aXRhbi1lbWJlZC10ZXh0LXYxJyxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBhY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBpbnB1dFRleHQ6IHRleHRcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VNb2RlbENvbW1hbmQoaW5wdXQpO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGJlZHJvY2tDbGllbnQuc2VuZChjb21tYW5kKTtcblxuICAgICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5ib2R5KSk7XG4gICAgICAgIHJldHVybiByZXNwb25zZUJvZHkuZW1iZWRkaW5nO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdlbmVyYXRpbmcgZW1iZWRkaW5nOicsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxufVxuXG4vKipcbiAqIEV4dHJhY3QgcGFnZSBjb250ZW50IGZyb20gSFRNTFxuICovXG5mdW5jdGlvbiBleHRyYWN0UGFnZUNvbnRlbnQoaHRtbDogc3RyaW5nKTogeyB0aXRsZTogc3RyaW5nOyBkZXNjcmlwdGlvbjogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfSB7XG4gICAgLy8gRXh0cmFjdCB0aXRsZVxuICAgIGNvbnN0IHRpdGxlTWF0Y2ggPSBodG1sLm1hdGNoKC88dGl0bGVbXj5dKj4oLio/KTxcXC90aXRsZT4vaSk7XG4gICAgY29uc3QgdGl0bGUgPSB0aXRsZU1hdGNoID8gdGl0bGVNYXRjaFsxXS50cmltKCkgOiAnJztcblxuICAgIC8vIEV4dHJhY3QgbWV0YSBkZXNjcmlwdGlvblxuICAgIGNvbnN0IGRlc2NNYXRjaCA9IGh0bWwubWF0Y2goLzxtZXRhW14+XSpuYW1lPVtcIiddZGVzY3JpcHRpb25bXCInXVtePl0qY29udGVudD1bXCInXShbXlwiJ10qPylbXCInXVtePl0qPi9pKTtcbiAgICBjb25zdCBkZXNjcmlwdGlvbiA9IGRlc2NNYXRjaCA/IGRlc2NNYXRjaFsxXS50cmltKCkgOiAnJztcblxuICAgIC8vIEV4dHJhY3QgbWFpbiBjb250ZW50IChyZW1vdmUgc2NyaXB0cywgc3R5bGVzLCBuYXYsIGZvb3RlcilcbiAgICBsZXQgY29udGVudCA9IGh0bWxcbiAgICAgICAgLnJlcGxhY2UoLzxzY3JpcHRbXj5dKj5bXFxzXFxTXSo/PFxcL3NjcmlwdD4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPHN0eWxlW14+XSo+W1xcc1xcU10qPzxcXC9zdHlsZT4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPG5hdltePl0qPltcXHNcXFNdKj88XFwvbmF2Pi9naSwgJycpXG4gICAgICAgIC5yZXBsYWNlKC88Zm9vdGVyW14+XSo+W1xcc1xcU10qPzxcXC9mb290ZXI+L2dpLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLzxoZWFkZXJbXj5dKj5bXFxzXFxTXSo/PFxcL2hlYWRlcj4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPGFzaWRlW14+XSo+W1xcc1xcU10qPzxcXC9hc2lkZT4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPFtePl0rPi9nLCAnICcpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKTtcblxuICAgIC8vIExpbWl0IGNvbnRlbnQgbGVuZ3RoIGZvciBlbWJlZGRpbmdcbiAgICBpZiAoY29udGVudC5sZW5ndGggPiA4MDAwKSB7XG4gICAgICAgIGNvbnRlbnQgPSBjb250ZW50LnN1YnN0cmluZygwLCA4MDAwKSArICcuLi4nO1xuICAgIH1cblxuICAgIHJldHVybiB7IHRpdGxlLCBkZXNjcmlwdGlvbiwgY29udGVudCB9O1xufVxuXG4vKipcbiAqIExvYWQgb3IgZ2VuZXJhdGUgZW1iZWRkaW5ncyBmb3IgYWxsIGRvY3VtZW50YXRpb24gcGFnZXNcbiAqL1xuYXN5bmMgZnVuY3Rpb24gbG9hZE9yR2VuZXJhdGVFbWJlZGRpbmdzKGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxSaWNoQ29udGVudEVtYmVkZGluZ1tdPiB7XG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LlMzX0JVQ0tFVF9OQU1FO1xuICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1MzX0JVQ0tFVF9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxpemUgZG9tYWluIGZvciBjb25zaXN0ZW50IGNvbmZpZ3VyYXRpb24gbG9va3VwXG4gICAgY29uc3Qgbm9ybWFsaXplZERvbWFpbiA9IG5vcm1hbGl6ZURvbWFpbihkb21haW4pO1xuICAgIGNvbnNvbGUubG9nKGBMb2FkaW5nIGVtYmVkZGluZ3MgZm9yIGRvbWFpbjogJHtkb21haW59IChub3JtYWxpemVkOiAke25vcm1hbGl6ZWREb21haW59KWApO1xuXG4gICAgLy8gRG9tYWluLXNwZWNpZmljIGVtYmVkZGluZ3Mga2V5IHRvIGF2b2lkIGNyb3NzLWNvbnRhbWluYXRpb25cbiAgICBjb25zdCBlbWJlZGRpbmdzS2V5ID0gYHJpY2gtY29udGVudC1lbWJlZGRpbmdzLSR7bm9ybWFsaXplZERvbWFpbi5yZXBsYWNlKC9cXC4vZywgJy0nKX0uanNvbmA7XG4gICAgY29uc29sZS5sb2coYFVzaW5nIGRvbWFpbi1zcGVjaWZpYyBlbWJlZGRpbmdzIGtleTogJHtlbWJlZGRpbmdzS2V5fWApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gVHJ5IHRvIGxvYWQgZXhpc3RpbmcgZW1iZWRkaW5ncyBmcm9tIFMzXG4gICAgICAgIGNvbnNvbGUubG9nKCdMb2FkaW5nIGV4aXN0aW5nIGVtYmVkZGluZ3MgZnJvbSBTMy4uLicpO1xuICAgICAgICBjb25zdCBnZXRDb21tYW5kID0gbmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBlbWJlZGRpbmdzS2V5XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChnZXRDb21tYW5kKTtcbiAgICAgICAgY29uc3QgZW1iZWRkaW5nc0RhdGEgPSBhd2FpdCByZXNwb25zZS5Cb2R5Py50cmFuc2Zvcm1Ub1N0cmluZygpO1xuXG4gICAgICAgIGlmIChlbWJlZGRpbmdzRGF0YSkge1xuICAgICAgICAgICAgY29uc3QgZW1iZWRkaW5nczogUmljaENvbnRlbnRFbWJlZGRpbmdbXSA9IEpTT04ucGFyc2UoZW1iZWRkaW5nc0RhdGEpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYExvYWRlZCAke2VtYmVkZGluZ3MubGVuZ3RofSBleGlzdGluZyBlbWJlZGRpbmdzIGZyb20gUzNgKTtcbiAgICAgICAgICAgIHJldHVybiBlbWJlZGRpbmdzO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05vIGV4aXN0aW5nIGVtYmVkZGluZ3MgZm91bmQsIGdlbmVyYXRpbmcgbmV3IG9uZXMuLi4nKTtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSBuZXcgZW1iZWRkaW5nc1xuICAgIGNvbnN0IHNpdGVtYXAgPSBhd2FpdCBmZXRjaFNpdGVtYXAobm9ybWFsaXplZERvbWFpbik7XG4gICAgY29uc3QgZG9jUGFnZXMgPSBzaXRlbWFwLmZpbHRlcih1cmwgPT4gdXJsLnN0YXJ0c1dpdGgoJy9kb2NzLycpKTtcbiAgICBjb25zb2xlLmxvZyhgR2VuZXJhdGluZyBlbWJlZGRpbmdzIGZvciAke2RvY1BhZ2VzLmxlbmd0aH0gZG9jdW1lbnRhdGlvbiBwYWdlcy4uLmApO1xuXG4gICAgY29uc3QgZW1iZWRkaW5nczogUmljaENvbnRlbnRFbWJlZGRpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBwYWdlUGF0aCBvZiBkb2NQYWdlcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgaHRtbCA9IGF3YWl0IGZldGNoUGFnZUNvbnRlbnQoZG9tYWluLCBwYWdlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWh0bWwpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBjb25zdCB7IHRpdGxlLCBkZXNjcmlwdGlvbiwgY29udGVudCB9ID0gZXh0cmFjdFBhZ2VDb250ZW50KGh0bWwpO1xuXG4gICAgICAgICAgICAvLyBDb21iaW5lIHRpdGxlLCBkZXNjcmlwdGlvbiwgYW5kIGNvbnRlbnQgZm9yIGVtYmVkZGluZ1xuICAgICAgICAgICAgY29uc3QgdGV4dEZvckVtYmVkZGluZyA9IGAke3RpdGxlfSAke2Rlc2NyaXB0aW9ufSAke2NvbnRlbnR9YC50cmltKCk7XG5cbiAgICAgICAgICAgIGlmICh0ZXh0Rm9yRW1iZWRkaW5nLmxlbmd0aCA8IDEwKSBjb250aW51ZTsgLy8gU2tpcCBwYWdlcyB3aXRoIG1pbmltYWwgY29udGVudFxuXG4gICAgICAgICAgICBjb25zdCBlbWJlZGRpbmcgPSBhd2FpdCBnZW5lcmF0ZUVtYmVkZGluZyh0ZXh0Rm9yRW1iZWRkaW5nKTtcblxuICAgICAgICAgICAgZW1iZWRkaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICB1cmw6IHBhZ2VQYXRoLFxuICAgICAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICAgIGNvbnRlbnQsXG4gICAgICAgICAgICAgICAgZW1iZWRkaW5nXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coYEdlbmVyYXRlZCBlbWJlZGRpbmcgZm9yOiAke3BhZ2VQYXRofSAoJHt0aXRsZX0pYCk7XG5cbiAgICAgICAgICAgIC8vIEFkZCBzbWFsbCBkZWxheSB0byBhdm9pZCByYXRlIGxpbWl0aW5nXG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7XG5cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBnZW5lcmF0ZSBlbWJlZGRpbmcgZm9yICR7cGFnZVBhdGh9OmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFN0b3JlIGVtYmVkZGluZ3MgaW4gUzNcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBwdXRDb21tYW5kID0gbmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBlbWJlZGRpbmdzS2V5LFxuICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkoZW1iZWRkaW5ncywgbnVsbCwgMiksXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQocHV0Q29tbWFuZCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBTdG9yZWQgJHtlbWJlZGRpbmdzLmxlbmd0aH0gZW1iZWRkaW5ncyBpbiBTM2ApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzdG9yZSBlbWJlZGRpbmdzIGluIFMzOicsIGVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZW1iZWRkaW5ncztcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGUgY29zaW5lIHNpbWlsYXJpdHkgYmV0d2VlbiB0d28gdmVjdG9yc1xuICovXG5mdW5jdGlvbiBjb3NpbmVTaW1pbGFyaXR5KGE6IG51bWJlcltdLCBiOiBudW1iZXJbXSk6IG51bWJlciB7XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZlY3RvcnMgbXVzdCBoYXZlIHRoZSBzYW1lIGxlbmd0aCcpO1xuICAgIH1cblxuICAgIGxldCBkb3RQcm9kdWN0ID0gMDtcbiAgICBsZXQgbm9ybUEgPSAwO1xuICAgIGxldCBub3JtQiA9IDA7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZG90UHJvZHVjdCArPSBhW2ldICogYltpXTtcbiAgICAgICAgbm9ybUEgKz0gYVtpXSAqIGFbaV07XG4gICAgICAgIG5vcm1CICs9IGJbaV0gKiBiW2ldO1xuICAgIH1cblxuICAgIG5vcm1BID0gTWF0aC5zcXJ0KG5vcm1BKTtcbiAgICBub3JtQiA9IE1hdGguc3FydChub3JtQik7XG5cbiAgICBpZiAobm9ybUEgPT09IDAgfHwgbm9ybUIgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRvdFByb2R1Y3QgLyAobm9ybUEgKiBub3JtQik7XG59XG5cbi8qKlxuICogU2VhcmNoIHNpdGVtYXAgdXNpbmcgc2VtYW50aWMgc2ltaWxhcml0eSAob3B0aW1pemVkIHZlcnNpb24pXG4gKiBSZXR1cm5zIGFycmF5IG9mIHt1cmwsIHRpdGxlLCBzaW1pbGFyaXR5fSBvYmplY3RzXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNlYXJjaFNpdGVtYXBTZW1hbnRpY2x5T3B0aW1pemVkKGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUsIGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxBcnJheTx7IHVybDogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyBzaW1pbGFyaXR5OiBudW1iZXIgfT4+IHtcbiAgICB0cnkge1xuICAgICAgICAvLyBMb2FkIHByZS1nZW5lcmF0ZWQgZW1iZWRkaW5nc1xuICAgICAgICBjb25zdCBlbWJlZGRpbmdzID0gYXdhaXQgbG9hZE9yR2VuZXJhdGVFbWJlZGRpbmdzKGRvbWFpbik7XG5cbiAgICAgICAgaWYgKGVtYmVkZGluZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gZW1iZWRkaW5ncyBhdmFpbGFibGUsIGZhbGxpbmcgYmFjayB0byBrZXl3b3JkIHNlYXJjaCcpO1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2VuZXJhdGUgZW1iZWRkaW5nIGZvciB0aGUgaXNzdWUgdXNpbmcgUklDSCBDT05URU5UXG4gICAgICAgIC8vIENvbWJpbmUgYWxsIGF2YWlsYWJsZSBmaWVsZHMgZm9yIG1heGltdW0gY29udGV4dFxuICAgICAgICBsZXQgaXNzdWVUZXh0ID0gYCR7aXNzdWUudGl0bGV9ICR7aXNzdWUuZGVzY3JpcHRpb259ICR7aXNzdWUuY2F0ZWdvcnl9YDtcblxuICAgICAgICAvLyBBZGQgcmljaCBjb250ZW50IGlmIGF2YWlsYWJsZVxuICAgICAgICBpZiAoaXNzdWUuZnVsbENvbnRlbnQpIHtcbiAgICAgICAgICAgIGlzc3VlVGV4dCArPSBgICR7aXNzdWUuZnVsbENvbnRlbnR9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBVc2luZyBmdWxsIGNvbnRlbnQgKCR7aXNzdWUuZnVsbENvbnRlbnQubGVuZ3RofSBjaGFycykgZm9yIHNlbWFudGljIG1hdGNoaW5nYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNzdWUuY29kZVNuaXBwZXRzICYmIGlzc3VlLmNvZGVTbmlwcGV0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBpc3N1ZVRleHQgKz0gYCAke2lzc3VlLmNvZGVTbmlwcGV0cy5qb2luKCcgJyl9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBJbmNsdWRpbmcgJHtpc3N1ZS5jb2RlU25pcHBldHMubGVuZ3RofSBjb2RlIHNuaXBwZXRzYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNzdWUuZXJyb3JNZXNzYWdlcyAmJiBpc3N1ZS5lcnJvck1lc3NhZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGlzc3VlVGV4dCArPSBgICR7aXNzdWUuZXJyb3JNZXNzYWdlcy5qb2luKCcgJyl9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBJbmNsdWRpbmcgJHtpc3N1ZS5lcnJvck1lc3NhZ2VzLmxlbmd0aH0gZXJyb3IgbWVzc2FnZXNgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc3N1ZS50YWdzICYmIGlzc3VlLnRhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgaXNzdWVUZXh0ICs9IGAgJHtpc3N1ZS50YWdzLmpvaW4oJyAnKX1gO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEluY2x1ZGluZyAke2lzc3VlLnRhZ3MubGVuZ3RofSB0YWdzOiAke2lzc3VlLnRhZ3Muam9pbignLCAnKX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc3N1ZS5zdGFja1RyYWNlKSB7XG4gICAgICAgICAgICBpc3N1ZVRleHQgKz0gYCAke2lzc3VlLnN0YWNrVHJhY2V9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBJbmNsdWRpbmcgc3RhY2sgdHJhY2VgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBUb3RhbCBpc3N1ZSB0ZXh0IGZvciBlbWJlZGRpbmc6ICR7aXNzdWVUZXh0Lmxlbmd0aH0gY2hhcnNgKTtcblxuICAgICAgICBjb25zdCBpc3N1ZUVtYmVkZGluZyA9IGF3YWl0IGdlbmVyYXRlRW1iZWRkaW5nKGlzc3VlVGV4dCk7XG5cbiAgICAgICAgLy8gQ2FsY3VsYXRlIHNpbWlsYXJpdGllc1xuICAgICAgICBjb25zdCBzaW1pbGFyaXRpZXM6IEFycmF5PHsgdXJsOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmc7IHNpbWlsYXJpdHk6IG51bWJlciB9PiA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgZW1iZWRkaW5nIG9mIGVtYmVkZGluZ3MpIHtcbiAgICAgICAgICAgIGNvbnN0IHNpbWlsYXJpdHkgPSBjb3NpbmVTaW1pbGFyaXR5KGlzc3VlRW1iZWRkaW5nLCBlbWJlZGRpbmcuZW1iZWRkaW5nKTtcbiAgICAgICAgICAgIHNpbWlsYXJpdGllcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB1cmw6IGVtYmVkZGluZy51cmwsXG4gICAgICAgICAgICAgICAgdGl0bGU6IGVtYmVkZGluZy50aXRsZSxcbiAgICAgICAgICAgICAgICBzaW1pbGFyaXR5XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNvcnQgYnkgc2ltaWxhcml0eSBhbmQgcmV0dXJuIHRvcCA1XG4gICAgICAgIHNpbWlsYXJpdGllcy5zb3J0KChhLCBiKSA9PiBiLnNpbWlsYXJpdHkgLSBhLnNpbWlsYXJpdHkpO1xuICAgICAgICBjb25zdCB0b3BQYWdlcyA9IHNpbWlsYXJpdGllcy5zbGljZSgwLCA1KTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgU2VtYW50aWMgc2VhcmNoIHJlc3VsdHMgZm9yIFwiJHtpc3N1ZS50aXRsZX1cIiAodXNpbmcgcmljaCBjb250ZW50KTpgKTtcbiAgICAgICAgdG9wUGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAke2luZGV4ICsgMX0uICR7cGFnZS51cmx9ICgke3BhZ2UudGl0bGV9KSAtIFNpbWlsYXJpdHk6ICR7cGFnZS5zaW1pbGFyaXR5LnRvRml4ZWQoMyl9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0b3BQYWdlcztcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1NlbWFudGljIHNlYXJjaCBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxufVxuXG4vKipcbiAqIEV4dHJhY3Qga2V5d29yZHMgZnJvbSBpc3N1ZSBmb3Igc2l0ZW1hcCBzZWFyY2hcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEtleXdvcmRzKGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgdGV4dCA9IGAke2lzc3VlLnRpdGxlfSAke2lzc3VlLmRlc2NyaXB0aW9ufSAke2lzc3VlLmNhdGVnb3J5fWAudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIENvbW1vbiBzdG9wIHdvcmRzIHRvIGZpbHRlciBvdXRcbiAgICBjb25zdCBzdG9wV29yZHMgPSBbJ3RoZScsICdhJywgJ2FuJywgJ2FuZCcsICdvcicsICdidXQnLCAnaW4nLCAnb24nLCAnYXQnLCAndG8nLCAnZm9yJywgJ29mJywgJ3dpdGgnLCAnaXMnLCAnYXJlJywgJ3dhcycsICd3ZXJlJywgJ2JlZW4nLCAnYmUnLCAnaGF2ZScsICdoYXMnLCAnaGFkJywgJ2RvJywgJ2RvZXMnLCAnZGlkJywgJ3dpbGwnLCAnd291bGQnLCAnc2hvdWxkJywgJ2NvdWxkJywgJ21heScsICdtaWdodCcsICdtdXN0JywgJ2NhbiddO1xuXG4gICAgLy8gRXh0cmFjdCB3b3JkcyAoYWxwaGFudW1lcmljLCAzKyBjaGFycylcbiAgICBjb25zdCB3b3JkcyA9IHRleHQubWF0Y2goL1xcYlthLXowLTldezMsfVxcYi9nKSB8fCBbXTtcblxuICAgIC8vIEZpbHRlciBzdG9wIHdvcmRzIGFuZCBkZWR1cGxpY2F0ZVxuICAgIGNvbnN0IGtleXdvcmRzID0gWy4uLm5ldyBTZXQod29yZHMuZmlsdGVyKHdvcmQgPT4gIXN0b3BXb3Jkcy5pbmNsdWRlcyh3b3JkKSkpXTtcblxuICAgIC8vIEFkZCBjYXRlZ29yeS1zcGVjaWZpYyBrZXl3b3Jkc1xuICAgIGNvbnN0IGNhdGVnb3J5S2V5d29yZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgICAgICAgJ2RlcGxveW1lbnQnOiBbJ2RlcGxveScsICdwcm9kdWN0aW9uJywgJ2Vudmlyb25tZW50JywgJ3ZlcmNlbCcsICduZXRsaWZ5JywgJ2hvc3RpbmcnXSxcbiAgICAgICAgJ2VtYWlsLWRlbGl2ZXJ5JzogWydlbWFpbCcsICdzcGFtJywgJ2RlbGl2ZXJhYmlsaXR5JywgJ2RucycsICdzcGYnLCAnZGtpbScsICdnbWFpbCddLFxuICAgICAgICAnYXBpLXVzYWdlJzogWydhcGknLCAnZW5kcG9pbnQnLCAncmVxdWVzdCcsICdyZXNwb25zZScsICdpbnRlZ3JhdGlvbiddLFxuICAgICAgICAnYXV0aGVudGljYXRpb24nOiBbJ2F1dGgnLCAna2V5JywgJ3Rva2VuJywgJ2NyZWRlbnRpYWwnLCAncGVybWlzc2lvbiddLFxuICAgICAgICAnZG9jdW1lbnRhdGlvbic6IFsnZG9jcycsICdndWlkZScsICd0dXRvcmlhbCcsICdleGFtcGxlJ11cbiAgICB9O1xuXG4gICAgaWYgKGlzc3VlLmNhdGVnb3J5ICYmIGNhdGVnb3J5S2V5d29yZHNbaXNzdWUuY2F0ZWdvcnldKSB7XG4gICAgICAgIGtleXdvcmRzLnB1c2goLi4uY2F0ZWdvcnlLZXl3b3Jkc1tpc3N1ZS5jYXRlZ29yeV0pO1xuICAgIH1cblxuICAgIHJldHVybiBbLi4ubmV3IFNldChrZXl3b3JkcyldO1xufVxuXG4vKipcbiAqIERvbWFpbi1zcGVjaWZpYyBzaXRlbWFwIGNvbmZpZ3VyYXRpb25cbiAqL1xuY29uc3QgRE9NQUlOX1NJVEVNQVBfQ09ORklHOiBSZWNvcmQ8c3RyaW5nLCB7IHNpdGVtYXBVcmw6IHN0cmluZzsgZG9jRmlsdGVyOiBzdHJpbmcgfT4gPSB7XG4gICAgJ3Jlc2VuZC5jb20nOiB7XG4gICAgICAgIHNpdGVtYXBVcmw6ICdodHRwczovL3Jlc2VuZC5jb20vZG9jcy9zaXRlbWFwLnhtbCcsXG4gICAgICAgIGRvY0ZpbHRlcjogJy9kb2NzLydcbiAgICB9LFxuICAgICdsaXZlYmxvY2tzLmlvJzoge1xuICAgICAgICBzaXRlbWFwVXJsOiAnaHR0cHM6Ly9saXZlYmxvY2tzLmlvL3NpdGVtYXAueG1sJyxcbiAgICAgICAgZG9jRmlsdGVyOiAnL2RvY3MnXG4gICAgfSxcbiAgICAnZG9jcy5rbm9jay5hcHAnOiB7XG4gICAgICAgIHNpdGVtYXBVcmw6ICdodHRwczovL2RvY3Mua25vY2suYXBwL3NpdGVtYXAueG1sJyxcbiAgICAgICAgZG9jRmlsdGVyOiAnLydcbiAgICB9XG59O1xuXG4vKipcbiAqIE5vcm1hbGl6ZSBkb21haW4gdG8gbWF0Y2ggY29uZmlndXJhdGlvbiBrZXlzXG4gKiBDb252ZXJ0cyB1c2VyLWZyaWVuZGx5IGRvbWFpbnMgdG8gdGhlaXIgY2Fub25pY2FsIGRvY3VtZW50YXRpb24gZG9tYWluXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZURvbWFpbihkb21haW46IHN0cmluZyk6IHN0cmluZyB7XG4gICAgLy8gUmVtb3ZlIHByb3RvY29sIGFuZCB0cmFpbGluZyBzbGFzaGVzXG4gICAgY29uc3QgY2xlYW5Eb21haW4gPSBkb21haW4ucmVwbGFjZSgvXmh0dHBzPzpcXC9cXC8vLCAnJykucmVwbGFjZSgvXFwvJC8sICcnKTtcblxuICAgIC8vIEhhbmRsZSBrbm9jay5hcHAgLT4gZG9jcy5rbm9jay5hcHAgY29udmVyc2lvblxuICAgIGlmIChjbGVhbkRvbWFpbiA9PT0gJ2tub2NrLmFwcCcpIHtcbiAgICAgICAgcmV0dXJuICdkb2NzLmtub2NrLmFwcCc7XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIGFzLWlzIGZvciBvdGhlciBkb21haW5zXG4gICAgcmV0dXJuIGNsZWFuRG9tYWluO1xufVxuXG4vKipcbiAqIEZldGNoIHNpdGVtYXAueG1sIGFuZCBleHRyYWN0IFVSTHMgLSBFbmhhbmNlZCB0byBzdXBwb3J0IG11bHRpcGxlIGRvbWFpbnNcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hTaXRlbWFwKGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIC8vIEdldCBkb21haW4tc3BlY2lmaWMgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGNvbmZpZyA9IERPTUFJTl9TSVRFTUFQX0NPTkZJR1tkb21haW5dO1xuXG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBObyBzaXRlbWFwIGNvbmZpZ3VyYXRpb24gZm9yIGRvbWFpbjogJHtkb21haW59LCB1c2luZyBkZWZhdWx0YCk7XG4gICAgICAgIC8vIERlZmF1bHQgZmFsbGJhY2tcbiAgICAgICAgY29uc3QgZGVmYXVsdFNpdGVtYXBVcmwgPSBgaHR0cHM6Ly8ke2RvbWFpbn0vc2l0ZW1hcC54bWxgO1xuICAgICAgICBjb25zb2xlLmxvZyhgRmV0Y2hpbmcgc2l0ZW1hcCBmcm9tOiAke2RlZmF1bHRTaXRlbWFwVXJsfWApO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB4bWwgPSBhd2FpdCBtYWtlSHR0cFJlcXVlc3QoZGVmYXVsdFNpdGVtYXBVcmwpO1xuICAgICAgICAgICAgY29uc3QgdXJsTWF0Y2hlcyA9IHhtbC5tYXRjaCgvPGxvYz4oLio/KTxcXC9sb2M+L2cpIHx8IFtdO1xuICAgICAgICAgICAgY29uc3QgdXJscyA9IHVybE1hdGNoZXMubWFwKG1hdGNoID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB1cmwgPSBtYXRjaC5yZXBsYWNlKC88XFwvP2xvYz4vZywgJycpO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwodXJsKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHVybE9iai5wYXRobmFtZTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHVybDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB1cmxzLmZpbHRlcih1cmwgPT4gdXJsLmluY2x1ZGVzKCcvZG9jcycpKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCBzaXRlbWFwOicsIGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBzaXRlbWFwIGZyb206ICR7Y29uZmlnLnNpdGVtYXBVcmx9IChmaWx0ZXJpbmcgZm9yOiAke2NvbmZpZy5kb2NGaWx0ZXJ9KWApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeG1sID0gYXdhaXQgbWFrZUh0dHBSZXF1ZXN0KGNvbmZpZy5zaXRlbWFwVXJsKTtcblxuICAgICAgICAvLyBFeHRyYWN0IFVSTHMgZnJvbSBzaXRlbWFwIFhNTFxuICAgICAgICBjb25zdCB1cmxNYXRjaGVzID0geG1sLm1hdGNoKC88bG9jPiguKj8pPFxcL2xvYz4vZykgfHwgW107XG4gICAgICAgIGNvbnN0IHVybHMgPSB1cmxNYXRjaGVzLm1hcChtYXRjaCA9PiB7XG4gICAgICAgICAgICBjb25zdCB1cmwgPSBtYXRjaC5yZXBsYWNlKC88XFwvP2xvYz4vZywgJycpO1xuICAgICAgICAgICAgLy8gQ29udmVydCBmdWxsIFVSTCB0byBwYXRoXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwodXJsKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdXJsT2JqLnBhdGhuYW1lO1xuICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHVybDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRmlsdGVyIHRvIG9ubHkgZG9jdW1lbnRhdGlvbiBwYWdlc1xuICAgICAgICBjb25zdCBkb2NVcmxzID0gdXJscy5maWx0ZXIodXJsID0+IHVybC5zdGFydHNXaXRoKGNvbmZpZy5kb2NGaWx0ZXIpKTtcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7ZG9jVXJscy5sZW5ndGh9IGRvY3VtZW50YXRpb24gVVJMcyBmcm9tICR7dXJscy5sZW5ndGh9IHRvdGFsIFVSTHNgKTtcblxuICAgICAgICByZXR1cm4gZG9jVXJscztcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCBzaXRlbWFwOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbn1cblxuLyoqXG4gKiBTZWFyY2ggc2l0ZW1hcCBmb3IgcmVsZXZhbnQgcGFnZXMgYmFzZWQgb24ga2V5d29yZHNcbiAqL1xuZnVuY3Rpb24gc2VhcmNoU2l0ZW1hcEZvclJlbGV2YW50UGFnZXMoa2V5d29yZHM6IHN0cmluZ1tdLCBzaXRlbWFwVXJsczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcmVsZXZhbnRQYWdlczogQXJyYXk8eyB1cmw6IHN0cmluZzsgc2NvcmU6IG51bWJlciB9PiA9IFtdO1xuXG4gICAgZm9yIChjb25zdCB1cmwgb2Ygc2l0ZW1hcFVybHMpIHtcbiAgICAgICAgY29uc3QgdXJsTG93ZXIgPSB1cmwudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgbGV0IHNjb3JlID0gMDtcblxuICAgICAgICAvLyBTY29yZSBiYXNlZCBvbiBrZXl3b3JkIG1hdGNoZXNcbiAgICAgICAgZm9yIChjb25zdCBrZXl3b3JkIG9mIGtleXdvcmRzKSB7XG4gICAgICAgICAgICBpZiAodXJsTG93ZXIuaW5jbHVkZXMoa2V5d29yZCkpIHtcbiAgICAgICAgICAgICAgICBzY29yZSArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQm9vc3Qgc2NvcmUgZm9yIC9kb2NzLyBwYWdlc1xuICAgICAgICBpZiAodXJsTG93ZXIuaW5jbHVkZXMoJy9kb2NzLycpKSB7XG4gICAgICAgICAgICBzY29yZSArPSAwLjU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc2NvcmUgPiAwKSB7XG4gICAgICAgICAgICByZWxldmFudFBhZ2VzLnB1c2goeyB1cmwsIHNjb3JlIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gU29ydCBieSBzY29yZSBhbmQgcmV0dXJuIHRvcCA1XG4gICAgcmVsZXZhbnRQYWdlcy5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSk7XG4gICAgY29uc3QgdG9wUGFnZXMgPSByZWxldmFudFBhZ2VzLnNsaWNlKDAsIDUpLm1hcChwID0+IHAudXJsKTtcblxuICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3RvcFBhZ2VzLmxlbmd0aH0gcmVsZXZhbnQgcGFnZXMgZnJvbSBzaXRlbWFwOmAsIHRvcFBhZ2VzKTtcbiAgICByZXR1cm4gdG9wUGFnZXM7XG59XG5cbi8qKlxuICogRmV0Y2ggcGFnZSBjb250ZW50XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoUGFnZUNvbnRlbnQoZG9tYWluOiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgdXJsID0gYGh0dHBzOi8vJHtkb21haW59JHtwYXRofWA7XG4gICAgY29uc29sZS5sb2coYEZldGNoaW5nIHBhZ2UgY29udGVudCBmcm9tOiAke3VybH1gKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBtYWtlSHR0cFJlcXVlc3QodXJsKTtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGZldGNoIHBhZ2UgJHt1cmx9OmAsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0IGNvZGUgc25pcHBldHMgZnJvbSBIVE1MIHBhZ2VcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdENvZGVTbmlwcGV0c0Zyb21QYWdlKGh0bWw6IHN0cmluZyk6IEFycmF5PHsgY29kZTogc3RyaW5nOyBsYW5ndWFnZT86IHN0cmluZyB9PiB7XG4gICAgY29uc3Qgc25pcHBldHM6IEFycmF5PHsgY29kZTogc3RyaW5nOyBsYW5ndWFnZT86IHN0cmluZyB9PiA9IFtdO1xuXG4gICAgLy8gTWF0Y2ggPHByZT48Y29kZT4gYmxvY2tzXG4gICAgY29uc3QgcHJlQ29kZVJlZ2V4ID0gLzxwcmVbXj5dKj48Y29kZVtePl0qY2xhc3M9W1wiJ10/bGFuZ3VhZ2UtKFxcdyspW1wiJ10/W14+XSo+KFtcXHNcXFNdKj8pPFxcL2NvZGU+PFxcL3ByZT4vZ2k7XG4gICAgbGV0IG1hdGNoO1xuXG4gICAgd2hpbGUgKChtYXRjaCA9IHByZUNvZGVSZWdleC5leGVjKGh0bWwpKSAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCBsYW5ndWFnZSA9IG1hdGNoWzFdO1xuICAgICAgICBsZXQgY29kZSA9IG1hdGNoWzJdO1xuXG4gICAgICAgIC8vIERlY29kZSBIVE1MIGVudGl0aWVzXG4gICAgICAgIGNvZGUgPSBjb2RlXG4gICAgICAgICAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmd0Oy9nLCAnPicpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmFtcDsvZywgJyYnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyYjMzk7L2csIFwiJ1wiKTtcblxuICAgICAgICAvLyBSZW1vdmUgSFRNTCB0YWdzIHRoYXQgbWlnaHQgYmUgaW5zaWRlXG4gICAgICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UoLzxbXj5dKz4vZywgJycpO1xuXG4gICAgICAgIGlmIChjb2RlLnRyaW0oKS5sZW5ndGggPiAxMCkge1xuICAgICAgICAgICAgc25pcHBldHMucHVzaCh7IGNvZGU6IGNvZGUudHJpbSgpLCBsYW5ndWFnZSB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFsc28gdHJ5IHRvIG1hdGNoIHNpbXBsZSA8Y29kZT4gYmxvY2tzXG4gICAgaWYgKHNuaXBwZXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjb25zdCBjb2RlUmVnZXggPSAvPGNvZGVbXj5dKj4oW1xcc1xcU10qPyk8XFwvY29kZT4vZ2k7XG4gICAgICAgIHdoaWxlICgobWF0Y2ggPSBjb2RlUmVnZXguZXhlYyhodG1sKSkgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGxldCBjb2RlID0gbWF0Y2hbMV07XG4gICAgICAgICAgICBjb2RlID0gY29kZVxuICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8mbHQ7L2csICc8JylcbiAgICAgICAgICAgICAgICAucmVwbGFjZSgvJmd0Oy9nLCAnPicpXG4gICAgICAgICAgICAgICAgLnJlcGxhY2UoLyZhbXA7L2csICcmJylcbiAgICAgICAgICAgICAgICAucmVwbGFjZSgvJnF1b3Q7L2csICdcIicpXG4gICAgICAgICAgICAgICAgLnJlcGxhY2UoLyYjMzk7L2csIFwiJ1wiKVxuICAgICAgICAgICAgICAgIC5yZXBsYWNlKC88W14+XSs+L2csICcnKTtcblxuICAgICAgICAgICAgaWYgKGNvZGUudHJpbSgpLmxlbmd0aCA+IDUwKSB7IC8vIE9ubHkgbG9uZ2VyIGNvZGUgYmxvY2tzXG4gICAgICAgICAgICAgICAgc25pcHBldHMucHVzaCh7IGNvZGU6IGNvZGUudHJpbSgpIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNuaXBwZXRzLnNsaWNlKDAsIDUpOyAvLyBMaW1pdCB0byA1IHNuaXBwZXRzIHRvIGF2b2lkIHRva2VuIGxpbWl0c1xufVxuXG4vKipcbiAqIEFuYWx5emUgcGFnZSBjb250ZW50IGZvciByZWxldmFuY2UgdG8gaXNzdWVcbiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVBhZ2VDb250ZW50KGNvbnRlbnQ6IHN0cmluZywgaXNzdWU6IERpc2NvdmVyZWRJc3N1ZSwgcGFnZVVybDogc3RyaW5nLCBzZW1hbnRpY1Njb3JlPzogbnVtYmVyKTogRXZpZGVuY2Uge1xuICAgIGNvbnN0IGNvbnRlbnRMb3dlciA9IGNvbnRlbnQudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBrZXl3b3JkcyA9IGV4dHJhY3RLZXl3b3Jkcyhpc3N1ZSk7XG5cbiAgICAvLyBFeHRyYWN0IHBhZ2UgdGl0bGVcbiAgICBjb25zdCB0aXRsZU1hdGNoID0gY29udGVudC5tYXRjaCgvPHRpdGxlPiguKj8pPFxcL3RpdGxlPi9pKTtcbiAgICBjb25zdCBwYWdlVGl0bGUgPSB0aXRsZU1hdGNoID8gdGl0bGVNYXRjaFsxXSA6IHBhZ2VVcmw7XG5cbiAgICAvLyBDaGVjayBmb3Iga2V5d29yZCBtYXRjaGVzXG4gICAgY29uc3Qga2V5d29yZE1hdGNoZXMgPSBrZXl3b3Jkcy5maWx0ZXIoa3cgPT4gY29udGVudExvd2VyLmluY2x1ZGVzKGt3KSk7XG4gICAgY29uc3QgaGFzUmVsZXZhbnRDb250ZW50ID0ga2V5d29yZE1hdGNoZXMubGVuZ3RoID49IDI7IC8vIEF0IGxlYXN0IDIga2V5d29yZHNcblxuICAgIC8vIENvdW50IGNvZGUgZXhhbXBsZXMgKGNvZGUgYmxvY2tzLCBwcmUgdGFncylcbiAgICBjb25zdCBjb2RlQmxvY2tNYXRjaGVzID0gY29udGVudC5tYXRjaCgvPGNvZGV8PHByZXxgYGAvZ2kpIHx8IFtdO1xuICAgIGNvbnN0IGNvZGVFeGFtcGxlcyA9IGNvZGVCbG9ja01hdGNoZXMubGVuZ3RoO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHByb2R1Y3Rpb24gZ3VpZGFuY2Uga2V5d29yZHNcbiAgICBjb25zdCBwcm9kdWN0aW9uS2V5d29yZHMgPSBbJ3Byb2R1Y3Rpb24nLCAnZGVwbG95JywgJ2Vudmlyb25tZW50JywgJ2NvbmZpZ3VyYXRpb24nLCAnc2V0dXAnXTtcbiAgICBjb25zdCBwcm9kdWN0aW9uR3VpZGFuY2UgPSBwcm9kdWN0aW9uS2V5d29yZHMuc29tZShrdyA9PiBjb250ZW50TG93ZXIuaW5jbHVkZXMoa3cpKTtcblxuICAgIC8vIElkZW50aWZ5IGNvbnRlbnQgZ2Fwc1xuICAgIGNvbnN0IGNvbnRlbnRHYXBzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgaWYgKGNvZGVFeGFtcGxlcyA9PT0gMCkge1xuICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIGNvZGUgZXhhbXBsZXMnKTtcbiAgICB9XG5cbiAgICBpZiAoIXByb2R1Y3Rpb25HdWlkYW5jZSAmJiBpc3N1ZS5jYXRlZ29yeSA9PT0gJ2RlcGxveW1lbnQnKSB7XG4gICAgICAgIGNvbnRlbnRHYXBzLnB1c2goJ01pc3NpbmcgcHJvZHVjdGlvbiBkZXBsb3ltZW50IGd1aWRhbmNlJyk7XG4gICAgfVxuXG4gICAgaWYgKCFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2Vycm9yJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygndHJvdWJsZXNob290JykpIHtcbiAgICAgICAgY29udGVudEdhcHMucHVzaCgnTWlzc2luZyBlcnJvciBoYW5kbGluZyBhbmQgdHJvdWJsZXNob290aW5nIHN0ZXBzJyk7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZm9yIHNwZWNpZmljIGlzc3VlLXJlbGF0ZWQgY29udGVudFxuICAgIGlmIChpc3N1ZS5jYXRlZ29yeSA9PT0gJ2VtYWlsLWRlbGl2ZXJ5Jykge1xuICAgICAgICBpZiAoIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnc3BhbScpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2RlbGl2ZXJhYmlsaXR5JykpIHtcbiAgICAgICAgICAgIGNvbnRlbnRHYXBzLnB1c2goJ01pc3Npbmcgc3BhbS9kZWxpdmVyYWJpbGl0eSB0cm91Ymxlc2hvb3RpbmcnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnZG5zJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnc3BmJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnZGtpbScpKSB7XG4gICAgICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIEROUyBjb25maWd1cmF0aW9uIGV4YW1wbGVzJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaXNzdWUuY2F0ZWdvcnkgPT09ICdkZXBsb3ltZW50Jykge1xuICAgICAgICBpZiAoIWNvbnRlbnRMb3dlci5pbmNsdWRlcygndmVyY2VsJykgJiYgIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnbmV0bGlmeScpICYmIGlzc3VlLnRpdGxlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ3ZlcmNlbCcpKSB7XG4gICAgICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIHBsYXRmb3JtLXNwZWNpZmljIGRlcGxveW1lbnQgZXhhbXBsZXMgKFZlcmNlbC9OZXRsaWZ5KScpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY29udGVudExvd2VyLmluY2x1ZGVzKCdlbnZpcm9ubWVudCB2YXJpYWJsZScpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2VudicpKSB7XG4gICAgICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIGVudmlyb25tZW50IHZhcmlhYmxlIGNvbmZpZ3VyYXRpb24nKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHBhZ2VVcmwsXG4gICAgICAgIHBhZ2VUaXRsZSxcbiAgICAgICAgaGFzUmVsZXZhbnRDb250ZW50LFxuICAgICAgICBjb250ZW50R2FwcyxcbiAgICAgICAgY29kZUV4YW1wbGVzLFxuICAgICAgICBwcm9kdWN0aW9uR3VpZGFuY2UsXG4gICAgICAgIHNlbWFudGljU2NvcmVcbiAgICB9O1xufVxuXG4vKipcbiAqIFZhbGlkYXRlIGEgc2luZ2xlIGlzc3VlIGFnYWluc3QgZG9jdW1lbnRhdGlvblxuICovXG5hc3luYyBmdW5jdGlvbiB2YWxpZGF0ZUlzc3VlKGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUsIGRvbWFpbjogc3RyaW5nKTogUHJvbWlzZTxWYWxpZGF0aW9uUmVzdWx0PiB7XG4gICAgY29uc29sZS5sb2coYFxcbj09PSBWYWxpZGF0aW5nIGlzc3VlOiAke2lzc3VlLnRpdGxlfSA9PT1gKTtcblxuICAgIGxldCBwYWdlc1RvQ2hlY2s6IEFycmF5PHsgdXJsOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmc7IHNpbWlsYXJpdHk/OiBudW1iZXIgfT4gPSBbXTtcbiAgICBsZXQgdXNlZFNpdGVtYXBGYWxsYmFjayA9IGZhbHNlO1xuXG4gICAgLy8gU3RlcCAxOiBUcnkgcHJlLWN1cmF0ZWQgcGFnZXMgZmlyc3RcbiAgICBpZiAoaXNzdWUucmVsYXRlZFBhZ2VzICYmIGlzc3VlLnJlbGF0ZWRQYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBhZ2VzVG9DaGVjayA9IGlzc3VlLnJlbGF0ZWRQYWdlcy5tYXAodXJsID0+ICh7IHVybCwgdGl0bGU6IHVybCB9KSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2luZyBwcmUtY3VyYXRlZCBwYWdlczpgLCBwYWdlc1RvQ2hlY2subWFwKHAgPT4gcC51cmwpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTdGVwIDI6IFVzZSBzZW1hbnRpYyBzZWFyY2ggZm9yIGJldHRlciByZWxldmFuY2VcbiAgICAgICAgY29uc29sZS5sb2coYE5vIHByZS1jdXJhdGVkIHBhZ2VzLCB1c2luZyBzZW1hbnRpYyBzZWFyY2hgKTtcbiAgICAgICAgdXNlZFNpdGVtYXBGYWxsYmFjayA9IHRydWU7XG5cbiAgICAgICAgY29uc3Qgc2VtYW50aWNSZXN1bHRzID0gYXdhaXQgc2VhcmNoU2l0ZW1hcFNlbWFudGljbHlPcHRpbWl6ZWQoaXNzdWUsIGRvbWFpbik7XG4gICAgICAgIHBhZ2VzVG9DaGVjayA9IHNlbWFudGljUmVzdWx0cztcblxuICAgICAgICAvLyBGYWxsYmFjayB0byBrZXl3b3JkIHNlYXJjaCBpZiBzZW1hbnRpYyBzZWFyY2ggZmFpbHNcbiAgICAgICAgaWYgKHBhZ2VzVG9DaGVjay5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZW1hbnRpYyBzZWFyY2ggZmFpbGVkLCBmYWxsaW5nIGJhY2sgdG8ga2V5d29yZCBzZWFyY2hgKTtcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXAgPSBhd2FpdCBmZXRjaFNpdGVtYXAoZG9tYWluKTtcbiAgICAgICAgICAgIGlmIChzaXRlbWFwLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAvLyBGaWx0ZXIgdG8gb25seSBpbmNsdWRlIGRvY3MgcGFnZXMgdG8gYXZvaWQgaXJyZWxldmFudCByZXN1bHRzXG4gICAgICAgICAgICAgICAgY29uc3QgZG9jUGFnZXMgPSBzaXRlbWFwLmZpbHRlcih1cmwgPT4gdXJsLnN0YXJ0c1dpdGgoJy9kb2NzLycpKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgdG8gJHtkb2NQYWdlcy5sZW5ndGh9IGRvY3MgcGFnZXMgZnJvbSAke3NpdGVtYXAubGVuZ3RofSB0b3RhbCBwYWdlc2ApO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qga2V5d29yZHMgPSBleHRyYWN0S2V5d29yZHMoaXNzdWUpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBFeHRyYWN0ZWQga2V5d29yZHM6YCwga2V5d29yZHMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGtleXdvcmRQYWdlcyA9IHNlYXJjaFNpdGVtYXBGb3JSZWxldmFudFBhZ2VzKGtleXdvcmRzLCBkb2NQYWdlcyk7XG4gICAgICAgICAgICAgICAgcGFnZXNUb0NoZWNrID0ga2V5d29yZFBhZ2VzLm1hcCh1cmwgPT4gKHsgdXJsLCB0aXRsZTogdXJsIH0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFN0ZXAgMzogVmFsaWRhdGUgZWFjaCBwYWdlXG4gICAgY29uc3QgZXZpZGVuY2U6IEV2aWRlbmNlW10gPSBbXTtcbiAgICBjb25zdCBwb3RlbnRpYWxHYXBzOiBHYXBBbmFseXNpc1tdID0gW107XG4gICAgY29uc3QgY3JpdGljYWxHYXBzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IG1pc3NpbmdFbGVtZW50czogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmIChwYWdlc1RvQ2hlY2subGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIENyaXRpY2FsIGdhcDogTm8gcmVsZXZhbnQgcGFnZXMgZm91bmRcbiAgICAgICAgY29uc29sZS5sb2coYOKdjCBDUklUSUNBTCBHQVA6IE5vIHJlbGV2YW50IHBhZ2VzIGZvdW5kIGZvciBpc3N1ZWApO1xuXG4gICAgICAgIGNyaXRpY2FsR2Fwcy5wdXNoKGBObyBkb2N1bWVudGF0aW9uIHBhZ2UgZm91bmQgYWRkcmVzc2luZyBcIiR7aXNzdWUudGl0bGV9XCJgKTtcblxuICAgICAgICBwb3RlbnRpYWxHYXBzLnB1c2goe1xuICAgICAgICAgICAgZ2FwVHlwZTogJ2NyaXRpY2FsLWdhcCcsXG4gICAgICAgICAgICBtaXNzaW5nQ29udGVudDogW1xuICAgICAgICAgICAgICAgICdDb21wbGV0ZSBkb2N1bWVudGF0aW9uIHBhZ2UgbWlzc2luZycsXG4gICAgICAgICAgICAgICAgJ0NvZGUgZXhhbXBsZXMgbmVlZGVkJyxcbiAgICAgICAgICAgICAgICAnVHJvdWJsZXNob290aW5nIGd1aWRlIG5lZWRlZCcsXG4gICAgICAgICAgICAgICAgJ1Byb2R1Y3Rpb24gZGVwbG95bWVudCBndWlkYW5jZSBuZWVkZWQnXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVhc29uaW5nOiBgU2VhcmNoZWQgc2l0ZW1hcC54bWwgYnV0IGZvdW5kIG5vIHBhZ2VzIG1hdGNoaW5nIGtleXdvcmRzOiAke2V4dHJhY3RLZXl3b3Jkcyhpc3N1ZSkuam9pbignLCAnKX1gLFxuICAgICAgICAgICAgZGV2ZWxvcGVySW1wYWN0OiBgJHtpc3N1ZS5mcmVxdWVuY3l9IGRldmVsb3BlcnMgYWZmZWN0ZWQgLSByZXBvcnRpbmcgdGhpcyBpc3N1ZSBzaW5jZSAke2lzc3VlLmxhc3RTZWVufWBcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlzc3VlSWQ6IGlzc3VlLmlkLFxuICAgICAgICAgICAgaXNzdWVUaXRsZTogaXNzdWUudGl0bGUsXG4gICAgICAgICAgICBzdGF0dXM6ICdjcml0aWNhbC1nYXAnLFxuICAgICAgICAgICAgZXZpZGVuY2UsXG4gICAgICAgICAgICBtaXNzaW5nRWxlbWVudHM6IFsnQ29tcGxldGUgZG9jdW1lbnRhdGlvbiBwYWdlJ10sXG4gICAgICAgICAgICBwb3RlbnRpYWxHYXBzLFxuICAgICAgICAgICAgY3JpdGljYWxHYXBzLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogOTUsXG4gICAgICAgICAgICByZWNvbW1lbmRhdGlvbnM6IFtcbiAgICAgICAgICAgICAgICBgQ3JlYXRlIG5ldyBkb2N1bWVudGF0aW9uIHBhZ2UgYWRkcmVzc2luZzogJHtpc3N1ZS50aXRsZX1gLFxuICAgICAgICAgICAgICAgIGBJbmNsdWRlIGNvZGUgZXhhbXBsZXMgZm9yICR7aXNzdWUuY2F0ZWdvcnl9YCxcbiAgICAgICAgICAgICAgICBgQWRkIHRyb3VibGVzaG9vdGluZyBzZWN0aW9uYCxcbiAgICAgICAgICAgICAgICBgUmVmZXJlbmNlOiAke2lzc3VlLnNvdXJjZXNbMF19YFxuICAgICAgICAgICAgXVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIEZldGNoIGFuZCBhbmFseXplIGVhY2ggcGFnZVxuICAgIGZvciAoY29uc3QgcGFnZSBvZiBwYWdlc1RvQ2hlY2spIHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IGZldGNoUGFnZUNvbnRlbnQoZG9tYWluLCBwYWdlLnVybCk7XG5cbiAgICAgICAgaWYgKCFjb250ZW50KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pqg77iPIEZhaWxlZCB0byBmZXRjaCBwYWdlOiAke3BhZ2UudXJsfWApO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwYWdlRXZpZGVuY2UgPSBhbmFseXplUGFnZUNvbnRlbnQoY29udGVudCwgaXNzdWUsIHBhZ2UudXJsLCBwYWdlLnNpbWlsYXJpdHkpO1xuICAgICAgICBldmlkZW5jZS5wdXNoKHBhZ2VFdmlkZW5jZSk7XG5cbiAgICAgICAgLy8gQ29udGVudCBnYXBzIGFyZSBhbHJlYWR5IHNob3duIGluIHRoZSBFdmlkZW5jZSBzZWN0aW9uLCBubyBuZWVkIHRvIGR1cGxpY2F0ZVxuICAgICAgICAvLyBpZiAoIXBhZ2VFdmlkZW5jZS5oYXNSZWxldmFudENvbnRlbnQgfHwgcGFnZUV2aWRlbmNlLmNvbnRlbnRHYXBzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gICAgIGNvbnNvbGUubG9nKGDimqDvuI8gUE9URU5USUFMIEdBUDogJHtwYWdlLnVybH0gZXhpc3RzIGJ1dCBtaXNzaW5nIGNvbnRlbnRgKTtcblxuICAgICAgICAvLyAgICAgcG90ZW50aWFsR2Fwcy5wdXNoKHtcbiAgICAgICAgLy8gICAgICAgICBnYXBUeXBlOiAncG90ZW50aWFsLWdhcCcsXG4gICAgICAgIC8vICAgICAgICAgcGFnZVVybDogcGFnZS51cmwsXG4gICAgICAgIC8vICAgICAgICAgcGFnZVRpdGxlOiBwYWdlRXZpZGVuY2UucGFnZVRpdGxlLFxuICAgICAgICAvLyAgICAgICAgIG1pc3NpbmdDb250ZW50OiBwYWdlRXZpZGVuY2UuY29udGVudEdhcHMsXG4gICAgICAgIC8vICAgICAgICAgcmVhc29uaW5nOiBgUmljaCBjb250ZW50IGFuYWx5c2lzIHN1Z2dlc3RzIHJlbGV2YW5jZSB0byBcIiR7aXNzdWUudGl0bGV9XCIgYnV0IGxhY2tzIHNwZWNpZmljIGNvbnRlbnRgLFxuICAgICAgICAvLyAgICAgICAgIGRldmVsb3BlckltcGFjdDogYERldmVsb3BlcnMgc2VhcmNoaW5nIGZvciBcIiR7aXNzdWUudGl0bGV9XCIgd291bGQgZmluZCB0aGlzIHBhZ2UgYnV0IG5vdCBnZXQgY29tcGxldGUgc29sdXRpb25gXG4gICAgICAgIC8vICAgICB9KTtcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIG1pc3NpbmdFbGVtZW50cy5wdXNoKC4uLnBhZ2VFdmlkZW5jZS5jb250ZW50R2Fwcyk7XG4gICAgfVxuXG4gICAgLy8gRGV0ZXJtaW5lIG92ZXJhbGwgc3RhdHVzXG4gICAgLy8gQmUgY29uc2VydmF0aXZlOiBEb24ndCBtYXJrIGFzIFwicmVzb2x2ZWRcIiB1bmxlc3Mgd2UncmUgdmVyeSBjb25maWRlbnRcbiAgICAvLyB0aGUgZG9jdW1lbnRhdGlvbiBhZGRyZXNzZXMgdGhlIENPUkUgcHJvYmxlbSwgbm90IGp1c3QgbWVudGlvbnMgcmVsYXRlZCBrZXl3b3Jkc1xuXG4gICAgLy8gRGVidWcgbG9nZ2luZ1xuICAgIGNvbnNvbGUubG9nKGBcXG49PT0gU3RhdHVzIERldGVybWluYXRpb24gRGVidWcgPT09YCk7XG4gICAgZXZpZGVuY2UuZm9yRWFjaCgoZSwgaWR4KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBFdmlkZW5jZSAke2lkeCArIDF9OiAke2UucGFnZVVybH1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYCAgLSBoYXNSZWxldmFudENvbnRlbnQ6ICR7ZS5oYXNSZWxldmFudENvbnRlbnR9YCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGAgIC0gY29udGVudEdhcHMubGVuZ3RoOiAke2UuY29udGVudEdhcHMubGVuZ3RofWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgICAtIGNvbnRlbnRHYXBzOiAke0pTT04uc3RyaW5naWZ5KGUuY29udGVudEdhcHMpfWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgICAtIHNlbWFudGljU2NvcmU6ICR7ZS5zZW1hbnRpY1Njb3JlfWApO1xuICAgIH0pO1xuXG4gICAgY29uc3QgaGFzQ29tcGxldGVDb250ZW50ID0gZXZpZGVuY2Uuc29tZShlID0+XG4gICAgICAgIGUuaGFzUmVsZXZhbnRDb250ZW50ICYmXG4gICAgICAgIGUuY29udGVudEdhcHMubGVuZ3RoID09PSAwICYmXG4gICAgICAgIGUuc2VtYW50aWNTY29yZSAmJiBlLnNlbWFudGljU2NvcmUgPiAwLjg1IC8vIEhpZ2ggY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICApO1xuICAgIGNvbnN0IGhhc1NvbWVDb250ZW50ID0gZXZpZGVuY2Uuc29tZShlID0+IGUuaGFzUmVsZXZhbnRDb250ZW50KTtcblxuICAgIGNvbnNvbGUubG9nKGBoYXNDb21wbGV0ZUNvbnRlbnQ6ICR7aGFzQ29tcGxldGVDb250ZW50fWApO1xuICAgIGNvbnNvbGUubG9nKGBoYXNTb21lQ29udGVudDogJHtoYXNTb21lQ29udGVudH1gKTtcblxuICAgIGxldCBzdGF0dXM6IFZhbGlkYXRpb25SZXN1bHRbJ3N0YXR1cyddO1xuICAgIGxldCBjb25maWRlbmNlOiBudW1iZXI7XG5cbiAgICBpZiAoaGFzQ29tcGxldGVDb250ZW50KSB7XG4gICAgICAgIHN0YXR1cyA9ICdyZXNvbHZlZCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA5MDtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBSRVNPTFZFRDogSXNzdWUgYXBwZWFycyB0byBiZSBhZGRyZXNzZWQgaW4gZG9jdW1lbnRhdGlvbiAoaGlnaCBjb25maWRlbmNlKWApO1xuICAgIH0gZWxzZSBpZiAoZXZpZGVuY2Uuc29tZShlID0+IGUuc2VtYW50aWNTY29yZSAmJiBlLnNlbWFudGljU2NvcmUgPiAwLjYpKSB7XG4gICAgICAgIC8vIEdvb2Qgc2VtYW50aWMgbWF0Y2ggYnV0IG5vdCBwZXJmZWN0IC0gbGlrZWx5IGEgcG90ZW50aWFsIGdhcFxuICAgICAgICBzdGF0dXMgPSAncG90ZW50aWFsLWdhcCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA3NTtcbiAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyBQT1RFTlRJQUwgR0FQOiBSZWxldmFudCBwYWdlcyBleGlzdCBidXQgbWF5IG5vdCBmdWxseSBhZGRyZXNzIHRoZSBpc3N1ZWApO1xuICAgIH0gZWxzZSBpZiAoaGFzU29tZUNvbnRlbnQpIHtcbiAgICAgICAgc3RhdHVzID0gJ2NvbmZpcm1lZCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA3MDtcbiAgICAgICAgY29uc29sZS5sb2coYOKdjCBDT05GSVJNRUQ6IElzc3VlIGV4aXN0cywgZG9jdW1lbnRhdGlvbiBpcyBpbmNvbXBsZXRlYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgc3RhdHVzID0gJ2NyaXRpY2FsLWdhcCc7XG4gICAgICAgIGNvbmZpZGVuY2UgPSA4NTtcbiAgICAgICAgY29uc29sZS5sb2coYOKdjCBDUklUSUNBTCBHQVA6IE5vIHJlbGV2YW50IGNvbnRlbnQgZm91bmRgKTtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSBkZXRhaWxlZCByZWNvbW1lbmRhdGlvbnMgdXNpbmcgQUkgYW5hbHlzaXMgKGZvciBhbGwgc3RhdHVzZXMpXG4gICAgY29uc3QgcmVjb21tZW5kYXRpb25zID0gYXdhaXQgZ2VuZXJhdGVEZXRhaWxlZFJlY29tbWVuZGF0aW9ucyhpc3N1ZSwgZXZpZGVuY2UsIHN0YXR1cywgZG9tYWluKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGlzc3VlSWQ6IGlzc3VlLmlkLFxuICAgICAgICBpc3N1ZVRpdGxlOiBpc3N1ZS50aXRsZSxcbiAgICAgICAgc3RhdHVzLFxuICAgICAgICBldmlkZW5jZSxcbiAgICAgICAgbWlzc2luZ0VsZW1lbnRzOiBbLi4ubmV3IFNldChtaXNzaW5nRWxlbWVudHMpXSxcbiAgICAgICAgcG90ZW50aWFsR2FwcyxcbiAgICAgICAgY3JpdGljYWxHYXBzLFxuICAgICAgICBjb25maWRlbmNlLFxuICAgICAgICByZWNvbW1lbmRhdGlvbnNcbiAgICB9O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIGRldGFpbGVkLCBhY3Rpb25hYmxlIHJlY29tbWVuZGF0aW9ucyB1c2luZyBBSSBhbmFseXNpc1xuICovXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZURldGFpbGVkUmVjb21tZW5kYXRpb25zKFxuICAgIGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUsXG4gICAgZXZpZGVuY2U6IEV2aWRlbmNlW10sXG4gICAgc3RhdHVzOiBzdHJpbmcsXG4gICAgZG9tYWluOiBzdHJpbmdcbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICB0cnkge1xuICAgICAgICAvLyBHZXQgdGhlIGJlc3QgbWF0Y2hpbmcgcGFnZSAoaGlnaGVzdCBzZW1hbnRpYyBzY29yZSlcbiAgICAgICAgY29uc3QgYmVzdE1hdGNoID0gZXZpZGVuY2UucmVkdWNlKChiZXN0LCBjdXJyZW50KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBiZXN0U2NvcmUgPSBiZXN0LnNlbWFudGljU2NvcmUgfHwgMDtcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRTY29yZSA9IGN1cnJlbnQuc2VtYW50aWNTY29yZSB8fCAwO1xuICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTY29yZSA+IGJlc3RTY29yZSA/IGN1cnJlbnQgOiBiZXN0O1xuICAgICAgICB9LCBldmlkZW5jZVswXSk7XG5cbiAgICAgICAgaWYgKCFiZXN0TWF0Y2ggfHwgIWJlc3RNYXRjaC5zZW1hbnRpY1Njb3JlIHx8IGJlc3RNYXRjaC5zZW1hbnRpY1Njb3JlIDwgMC41KSB7XG4gICAgICAgICAgICAvLyBObyBnb29kIG1hdGNoLCByZXR1cm4gZ2VuZXJpYyByZWNvbW1lbmRhdGlvbnNcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinYwgTm8gZ29vZCBzZW1hbnRpYyBtYXRjaCBmb3VuZC4gYmVzdE1hdGNoOiAkeyEhYmVzdE1hdGNofSwgc2VtYW50aWNTY29yZTogJHtiZXN0TWF0Y2g/LnNlbWFudGljU2NvcmV9YCk7XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgIGBDcmVhdGUgbmV3IGRvY3VtZW50YXRpb24gcGFnZSBhZGRyZXNzaW5nOiAke2lzc3VlLnRpdGxlfWAsXG4gICAgICAgICAgICAgICAgYEluY2x1ZGUgY29kZSBleGFtcGxlcyBmb3IgJHtpc3N1ZS5jYXRlZ29yeX1gLFxuICAgICAgICAgICAgICAgIGBBZGQgdHJvdWJsZXNob290aW5nIHNlY3Rpb24gZm9yIGNvbW1vbiBlcnJvcnNgLFxuICAgICAgICAgICAgICAgIGBSZWZlcmVuY2U6ICR7aXNzdWUuc291cmNlc1swXX1gXG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIHJlc29sdmVkIGlzc3Vlcywgc3RpbGwgZ2VuZXJhdGUgcmVjb21tZW5kYXRpb25zIGZvciBpbXByb3ZlbWVudHNcbiAgICAgICAgY29uc29sZS5sb2coYPCflI0gR2VuZXJhdGluZyByZWNvbW1lbmRhdGlvbnMgZm9yIGlzc3VlOiAke2lzc3VlLmlkfSAoc3RhdHVzOiAke3N0YXR1c30pYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIEJlc3QgbWF0Y2g6ICR7YmVzdE1hdGNoLnBhZ2VVcmx9IChzY29yZTogJHtiZXN0TWF0Y2guc2VtYW50aWNTY29yZX0pYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgUHJvY2VlZGluZyB3aXRoIEFJIHJlY29tbWVuZGF0aW9uIGdlbmVyYXRpb24uLi5gKTtcblxuICAgICAgICAvLyBDUklUSUNBTDogRmV0Y2ggdGhlIEFDVFVBTCBwYWdlIGNvbnRlbnQgdG8gYW5hbHl6ZSBleGlzdGluZyBjb2RlXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OEIEZldGNoaW5nIGFjdHVhbCBwYWdlIGNvbnRlbnQgZnJvbTogJHtkb21haW59JHtiZXN0TWF0Y2gucGFnZVVybH1gKTtcbiAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSBhd2FpdCBmZXRjaFBhZ2VDb250ZW50KGRvbWFpbiwgYmVzdE1hdGNoLnBhZ2VVcmwpO1xuXG4gICAgICAgIGlmICghcGFnZUNvbnRlbnQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinYwgRmFpbGVkIHRvIGZldGNoIHBhZ2UgY29udGVudCwgZmFsbGluZyBiYWNrIHRvIGdlbmVyaWMgcmVjb21tZW5kYXRpb25zYCk7XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgIGBVcGRhdGUgJHtiZXN0TWF0Y2gucGFnZVVybH0gdG8gYWRkcmVzczogJHtpc3N1ZS50aXRsZX1gLFxuICAgICAgICAgICAgICAgIGBBZGQgY29kZSBleGFtcGxlcyBmb3IgJHtpc3N1ZS5jYXRlZ29yeX1gLFxuICAgICAgICAgICAgICAgIGBJbmNsdWRlIHRyb3VibGVzaG9vdGluZyBzZWN0aW9uIGZvciBjb21tb24gZXJyb3JzYCxcbiAgICAgICAgICAgICAgICBgUmVmZXJlbmNlOiAke2lzc3VlLnNvdXJjZXNbMF19YFxuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEV4dHJhY3QgY29kZSBzbmlwcGV0cyBmcm9tIHRoZSBwYWdlXG4gICAgICAgIGNvbnN0IGNvZGVTbmlwcGV0cyA9IGV4dHJhY3RDb2RlU25pcHBldHNGcm9tUGFnZShwYWdlQ29udGVudCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OdIEV4dHJhY3RlZCAke2NvZGVTbmlwcGV0cy5sZW5ndGh9IGNvZGUgc25pcHBldHMgZnJvbSBkb2N1bWVudGF0aW9uIHBhZ2VgKTtcblxuICAgICAgICAvLyBCdWlsZCBjb250ZXh0IGZvciBBSSBhbmFseXNpc1xuICAgICAgICBjb25zdCBpc3N1ZUNvbnRleHQgPSBgXG5Jc3N1ZSBUaXRsZTogJHtpc3N1ZS50aXRsZX1cbkNhdGVnb3J5OiAke2lzc3VlLmNhdGVnb3J5fVxuRGVzY3JpcHRpb246ICR7aXNzdWUuZGVzY3JpcHRpb259XG5FcnJvciBNZXNzYWdlczogJHtpc3N1ZS5lcnJvck1lc3NhZ2VzPy5qb2luKCcsICcpIHx8ICdOb25lJ31cblRhZ3M6ICR7aXNzdWUudGFncz8uam9pbignLCAnKSB8fCAnTm9uZSd9XG5Db2RlIFNuaXBwZXRzIGZyb20gRGV2ZWxvcGVyIElzc3VlOiAke2lzc3VlLmNvZGVTbmlwcGV0cz8ubGVuZ3RoIHx8IDB9IHNuaXBwZXRzIGZvdW5kXG4ke2lzc3VlLmNvZGVTbmlwcGV0cyA/IGlzc3VlLmNvZGVTbmlwcGV0cy5tYXAoKHNuaXBwZXQsIGkpID0+IGBcXG5TbmlwcGV0ICR7aSArIDF9OlxcblxcYFxcYFxcYFxcbiR7c25pcHBldH1cXG5cXGBcXGBcXGBgKS5qb2luKCdcXG4nKSA6ICcnfVxuRnVsbCBDb250ZW50IFByZXZpZXc6ICR7aXNzdWUuZnVsbENvbnRlbnQ/LnN1YnN0cmluZygwLCAxMDAwKSB8fCAnTm90IGF2YWlsYWJsZSd9XG5Tb3VyY2U6ICR7aXNzdWUuc291cmNlc1swXX1cbmAudHJpbSgpO1xuXG4gICAgICAgIGNvbnN0IGRvY0NvbnRleHQgPSBgXG5QYWdlIFVSTDogJHtiZXN0TWF0Y2gucGFnZVVybH1cblBhZ2UgVGl0bGU6ICR7YmVzdE1hdGNoLnBhZ2VUaXRsZX1cblNlbWFudGljIE1hdGNoIFNjb3JlOiAkeyhiZXN0TWF0Y2guc2VtYW50aWNTY29yZSAqIDEwMCkudG9GaXhlZCgxKX0lXG5IYXMgQ29kZSBFeGFtcGxlczogJHtiZXN0TWF0Y2guY29kZUV4YW1wbGVzID4gMCA/ICdZZXMnIDogJ05vJ31cbkhhcyBQcm9kdWN0aW9uIEd1aWRhbmNlOiAke2Jlc3RNYXRjaC5wcm9kdWN0aW9uR3VpZGFuY2UgPyAnWWVzJyA6ICdObyd9XG5Db250ZW50IEdhcHM6ICR7YmVzdE1hdGNoLmNvbnRlbnRHYXBzLmpvaW4oJywgJyl9XG5cbkVYSVNUSU5HIENPREUgT04gRE9DVU1FTlRBVElPTiBQQUdFOlxuJHtjb2RlU25pcHBldHMubGVuZ3RoID4gMCA/IGNvZGVTbmlwcGV0cy5tYXAoKHNuaXBwZXQsIGkpID0+IGBcXG5Db2RlIEV4YW1wbGUgJHtpICsgMX06XFxuXFxgXFxgXFxgJHtzbmlwcGV0Lmxhbmd1YWdlIHx8ICd0eXBlc2NyaXB0J31cXG4ke3NuaXBwZXQuY29kZX1cXG5cXGBcXGBcXGBgKS5qb2luKCdcXG4nKSA6ICdObyBjb2RlIGV4YW1wbGVzIGZvdW5kIG9uIHBhZ2UnfVxuYC50cmltKCk7XG5cbiAgICAgICAgY29uc3QgcHJvbXB0ID0gYFlvdSBhcmUgYSB0ZWNobmljYWwgZG9jdW1lbnRhdGlvbiBleHBlcnQgYW5hbHl6aW5nIGEgZGV2ZWxvcGVyIGlzc3VlLlxuXG5ERVZFTE9QRVIgSVNTVUU6XG4tIFRpdGxlOiAke2lzc3VlLnRpdGxlfVxuLSBEZXNjcmlwdGlvbjogJHtpc3N1ZS5kZXNjcmlwdGlvbn1cbi0gRXJyb3I6ICR7aXNzdWUuZXJyb3JNZXNzYWdlcz8uWzBdIHx8ICdOL0EnfVxuLSBTb3VyY2U6ICR7aXNzdWUuc291cmNlc1swXX1cblxuRE9DVU1FTlRBVElPTiBQQUdFOiAke2Jlc3RNYXRjaC5wYWdlVXJsfVxuRVhJU1RJTkcgQ09ERSBPTiBQQUdFOlxuJHtjb2RlU25pcHBldHMubGVuZ3RoID4gMCA/IGNvZGVTbmlwcGV0cy5zbGljZSgwLCAyKS5tYXAoKHMsIGkpID0+IGBFeGFtcGxlICR7aSArIDF9OlxcblxcYFxcYFxcYCR7cy5sYW5ndWFnZSB8fCAndHlwZXNjcmlwdCd9XFxuJHtzLmNvZGUuc3Vic3RyaW5nKDAsIDUwMCl9XFxuXFxgXFxgXFxgYCkuam9pbignXFxuXFxuJykgOiAnTm8gY29kZSBleGFtcGxlcyBmb3VuZCd9XG5cbllPVVIgVEFTSzogR2VuZXJhdGUgVFdPIGRldGFpbGVkIHJlY29tbWVuZGF0aW9ucyB3aXRoIENPTVBMRVRFIGNvZGUgZXhhbXBsZXMuXG5cbkNSSVRJQ0FMIFJFUVVJUkVNRU5UUzpcbjEuIEVhY2ggcmVjb21tZW5kYXRpb24gTVVTVCBpbmNsdWRlIGEgQ09NUExFVEUgY29kZSBibG9jayAoNDAtNjAgbGluZXMgbWluaW11bSlcbjIuIENvZGUgbXVzdCBiZSBDT1BZLVBBU1RFIFJFQURZIC0gbm8gcGxhY2Vob2xkZXJzLCBubyBcIi8vIC4uLiByZXN0IG9mIGNvZGVcIlxuMy4gSW5jbHVkZSBBTEwgaW1wb3J0cywgQUxMIGVycm9yIGhhbmRsaW5nLCBBTEwgZWRnZSBjYXNlc1xuNC4gU2hvdyBCRUZPUkUgKGV4aXN0aW5nIGRvYyBjb2RlKSBhbmQgQUZURVIgKGltcHJvdmVkIGNvZGUpIGNvbXBhcmlzb25cblxuT1VUUFVUIEZPUk1BVCAoZm9sbG93IGV4YWN0bHkpOlxuXG4jIyBSZWNvbW1lbmRhdGlvbiAxOiBbRGVzY3JpcHRpdmUgVGl0bGVdXG5cbioqUHJvYmxlbToqKiBbMi0zIHNlbnRlbmNlcyBleHBsYWluaW5nIHdoYXQncyBtaXNzaW5nIGluIGN1cnJlbnQgZG9jc11cblxuKipDdXJyZW50IERvY3VtZW50YXRpb24gQ29kZSAoQkVGT1JFKToqKlxuXFxgXFxgXFxgdHlwZXNjcmlwdFxuLy8gU2hvdyB0aGUgZXhpc3RpbmcgY29kZSBmcm9tIGRvY3VtZW50YXRpb24gdGhhdCBuZWVkcyBpbXByb3ZlbWVudFxuXFxgXFxgXFxgXG5cbioqSW1wcm92ZWQgQ29kZSAoQUZURVIpIC0gQWRkIHRoaXMgdG8gZG9jdW1lbnRhdGlvbjoqKlxuXFxgXFxgXFxgdHlwZXNjcmlwdFxuLy8gQ09NUExFVEUgNDAtNjAgbGluZSBjb2RlIGV4YW1wbGUgaGVyZVxuLy8gSW5jbHVkZTogJ3VzZSBzZXJ2ZXInIGRpcmVjdGl2ZSwgYWxsIGltcG9ydHMsIHR5cGUgZGVmaW5pdGlvbnNcbi8vIEluY2x1ZGU6IGlucHV0IHZhbGlkYXRpb24sIGVudmlyb25tZW50IGNoZWNrc1xuLy8gSW5jbHVkZTogdHJ5L2NhdGNoIHdpdGggc3BlY2lmaWMgZXJyb3IgbWVzc2FnZXNcbi8vIEluY2x1ZGU6IHN1Y2Nlc3MvZXJyb3IgcmV0dXJuIHR5cGVzXG4vLyBJbmNsdWRlOiBoZWxwZnVsIGNvbW1lbnRzIGV4cGxhaW5pbmcgZWFjaCBzZWN0aW9uXG5cXGBcXGBcXGBcblxuKipXaHkgVGhpcyBIZWxwcyBEZXZlbG9wZXJzOioqIFsyLTMgc2VudGVuY2VzXVxuXG4tLS1cblxuIyMgUmVjb21tZW5kYXRpb24gMjogW0Rlc2NyaXB0aXZlIFRpdGxlXVxuXG4qKlByb2JsZW06KiogWzItMyBzZW50ZW5jZXNdXG5cbioqQ3VycmVudCBEb2N1bWVudGF0aW9uIENvZGUgKEJFRk9SRSk6KipcblxcYFxcYFxcYHR5cGVzY3JpcHRcbi8vIEV4aXN0aW5nIGNvZGVcblxcYFxcYFxcYFxuXG4qKkltcHJvdmVkIENvZGUgKEFGVEVSKSAtIEFkZCB0aGlzIHRvIGRvY3VtZW50YXRpb246KipcblxcYFxcYFxcYHR5cGVzY3JpcHRcbi8vIEFub3RoZXIgQ09NUExFVEUgNDAtNjAgbGluZSBjb2RlIGV4YW1wbGVcbi8vIERpZmZlcmVudCBhc3BlY3Qgb2YgdGhlIGlzc3VlIChlLmcuLCBmb3JtIGludGVncmF0aW9uLCBkZWJ1Z2dpbmcpXG5cXGBcXGBcXGBcblxuKipXaHkgVGhpcyBIZWxwcyBEZXZlbG9wZXJzOioqIFsyLTMgc2VudGVuY2VzXVxuXG4tLS1cblxuUkVNRU1CRVI6IFlvdXIgcmVzcG9uc2Ugc2hvdWxkIGJlIGFwcHJveGltYXRlbHkgMzAwMC00MDAwIGNoYXJhY3RlcnMgdG90YWwuIERvIE5PVCBiZSBicmllZi4gSW5jbHVkZSBGVUxMLCBXT1JLSU5HIGNvZGUgdGhhdCBkZXZlbG9wZXJzIGNhbiBjb3B5IGRpcmVjdGx5LmA7XG5cbiAgICAgICAgY29uc29sZS5sb2coYPCfmoAgQ2FsbGluZyBCZWRyb2NrIHRvIGdlbmVyYXRlIHJlY29tbWVuZGF0aW9ucy4uLmApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+kliBNb2RlbCBJRDogdXMuYW50aHJvcGljLmNsYXVkZS1zb25uZXQtNC01LTIwMjUwOTI5LXYxOjBgKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk50gUHJvbXB0IGxlbmd0aDogJHtwcm9tcHQubGVuZ3RofSBjaGFyYWN0ZXJzYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SNIElzc3VlIGNvbnRleHQgbGVuZ3RoOiAke2lzc3VlQ29udGV4dC5sZW5ndGh9IGNoYXJhY3RlcnNgKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4QgRG9jIGNvbnRleHQgbGVuZ3RoOiAke2RvY0NvbnRleHQubGVuZ3RofSBjaGFyYWN0ZXJzYCk7XG5cbiAgICAgICAgLy8gSW1wbGVtZW50IGNvbnRpbnVhdGlvbiBsb2dpYyBmb3IgdHJ1bmNhdGVkIHJlc3BvbnNlc1xuICAgICAgICBsZXQgZnVsbFJlY29tbWVuZGF0aW9uc1RleHQgPSAnJztcbiAgICAgICAgbGV0IGNvbnZlcnNhdGlvbkhpc3Rvcnk6IEFycmF5PHsgcm9sZTogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfT4gPSBbXG4gICAgICAgICAgICB7IHJvbGU6ICd1c2VyJywgY29udGVudDogcHJvbXB0IH1cbiAgICAgICAgXTtcbiAgICAgICAgbGV0IGF0dGVtcHRDb3VudCA9IDA7XG4gICAgICAgIGNvbnN0IG1heEF0dGVtcHRzID0gNTsgLy8gSW5jcmVhc2VkIHRvIDUgY29udGludWF0aW9uIGF0dGVtcHRzXG4gICAgICAgIGxldCB3YXNUcnVuY2F0ZWQgPSBmYWxzZTtcblxuICAgICAgICBkbyB7XG4gICAgICAgICAgICBhdHRlbXB0Q291bnQrKztcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OhIEFQSSBjYWxsIGF0dGVtcHQgJHthdHRlbXB0Q291bnR9LyR7bWF4QXR0ZW1wdHN9Li4uYCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGlucHV0ID0ge1xuICAgICAgICAgICAgICAgIG1vZGVsSWQ6ICd1cy5hbnRocm9waWMuY2xhdWRlLXNvbm5ldC00LTUtMjAyNTA5MjktdjE6MCcsXG4gICAgICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICBhY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIGFudGhyb3BpY192ZXJzaW9uOiAnYmVkcm9jay0yMDIzLTA1LTMxJyxcbiAgICAgICAgICAgICAgICAgICAgbWF4X3Rva2VuczogNDA5NiwgLy8gUmVkdWNlZCB0byA0MDk2IHRvIGVuY291cmFnZSBtb3JlIGNvbmNpc2UgcmVzcG9uc2VzXG4gICAgICAgICAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjMsXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VzOiBjb252ZXJzYXRpb25IaXN0b3J5XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxDb21tYW5kKGlucHV0KTtcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYmVkcm9ja0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIEJlZHJvY2sgcmVzcG9uc2UgcmVjZWl2ZWQgKGF0dGVtcHQgJHthdHRlbXB0Q291bnR9KWApO1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuYm9keSkpO1xuXG4gICAgICAgICAgICAvLyBMb2cgZGV0YWlsZWQgcmVzcG9uc2UgaW5mb1xuICAgICAgICAgICAgY29uc29sZS5sb2coYPCfk4sgUmVzcG9uc2UgYm9keSBrZXlzOiAke09iamVjdC5rZXlzKHJlc3BvbnNlQm9keSkuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5uRIFN0b3AgcmVhc29uOiAke3Jlc3BvbnNlQm9keS5zdG9wX3JlYXNvbn1gKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFVzYWdlOiBpbnB1dF90b2tlbnM9JHtyZXNwb25zZUJvZHkudXNhZ2U/LmlucHV0X3Rva2Vuc30sIG91dHB1dF90b2tlbnM9JHtyZXNwb25zZUJvZHkudXNhZ2U/Lm91dHB1dF90b2tlbnN9YCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHBhcnRpYWxUZXh0ID0gcmVzcG9uc2VCb2R5LmNvbnRlbnRbMF0udGV4dDtcbiAgICAgICAgICAgIGZ1bGxSZWNvbW1lbmRhdGlvbnNUZXh0ICs9IHBhcnRpYWxUZXh0O1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+TnSBQYXJ0aWFsIHJlc3BvbnNlIGxlbmd0aDogJHtwYXJ0aWFsVGV4dC5sZW5ndGh9IGNoYXJzYCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBUb3RhbCBhY2N1bXVsYXRlZCBsZW5ndGg6ICR7ZnVsbFJlY29tbWVuZGF0aW9uc1RleHQubGVuZ3RofSBjaGFyc2ApO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiByZXNwb25zZSB3YXMgdHJ1bmNhdGVkXG4gICAgICAgICAgICB3YXNUcnVuY2F0ZWQgPSByZXNwb25zZUJvZHkuc3RvcF9yZWFzb24gPT09ICdtYXhfdG9rZW5zJztcblxuICAgICAgICAgICAgaWYgKHdhc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFJlc3BvbnNlICR7YXR0ZW1wdENvdW50fSB3YXMgdHJ1bmNhdGVkIChzdG9wX3JlYXNvbjogbWF4X3Rva2VucylgKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+UhCBBdHRlbXB0aW5nIGNvbnRpbnVhdGlvbi4uLmApO1xuXG4gICAgICAgICAgICAgICAgLy8gQWRkIHRoZSBhc3Npc3RhbnQncyByZXNwb25zZSB0byBjb252ZXJzYXRpb24gaGlzdG9yeVxuICAgICAgICAgICAgICAgIGNvbnZlcnNhdGlvbkhpc3RvcnkucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIHJvbGU6ICdhc3Npc3RhbnQnLFxuICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwYXJ0aWFsVGV4dFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgLy8gQWRkIGEgY29udGludWF0aW9uIHByb21wdFxuICAgICAgICAgICAgICAgIGNvbnZlcnNhdGlvbkhpc3RvcnkucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIHJvbGU6ICd1c2VyJyxcbiAgICAgICAgICAgICAgICAgICAgY29udGVudDogJ1BsZWFzZSBjb250aW51ZSBmcm9tIHdoZXJlIHlvdSBsZWZ0IG9mZi4gQ29tcGxldGUgdGhlIGNvZGUgZXhhbXBsZSBhbmQgZXhwbGFuYXRpb24uJ1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFJlc3BvbnNlICR7YXR0ZW1wdENvdW50fSBjb21wbGV0ZWQgbmF0dXJhbGx5IChzdG9wX3JlYXNvbjogJHtyZXNwb25zZUJvZHkuc3RvcF9yZWFzb259KWApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gd2hpbGUgKHdhc1RydW5jYXRlZCAmJiBhdHRlbXB0Q291bnQgPCBtYXhBdHRlbXB0cyk7XG5cbiAgICAgICAgaWYgKHdhc1RydW5jYXRlZCAmJiBhdHRlbXB0Q291bnQgPj0gbWF4QXR0ZW1wdHMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFJlYWNoZWQgbWF4aW11bSBjb250aW51YXRpb24gYXR0ZW1wdHMgKCR7bWF4QXR0ZW1wdHN9KS4gUmVzcG9uc2UgbWF5IHN0aWxsIGJlIGluY29tcGxldGUuYCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZWNvbW1lbmRhdGlvbnNUZXh0ID0gZnVsbFJlY29tbWVuZGF0aW9uc1RleHQ7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OdIEZpbmFsIEFJIHJlY29tbWVuZGF0aW9ucyAoJHtyZWNvbW1lbmRhdGlvbnNUZXh0Lmxlbmd0aH0gY2hhcnMgdG90YWwgZnJvbSAke2F0dGVtcHRDb3VudH0gQVBJIGNhbGxzKWApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+ThCBGdWxsIHJlc3BvbnNlIHByZXZpZXcgKGZpcnN0IDUwMCBjaGFycyk6ICR7cmVjb21tZW5kYXRpb25zVGV4dC5zdWJzdHJpbmcoMCwgNTAwKX0uLi5gKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4QgRnVsbCByZXNwb25zZSBwcmV2aWV3IChsYXN0IDUwMCBjaGFycyk6IC4uLiR7cmVjb21tZW5kYXRpb25zVGV4dC5zdWJzdHJpbmcocmVjb21tZW5kYXRpb25zVGV4dC5sZW5ndGggLSA1MDApfWApO1xuXG4gICAgICAgIC8vIFBhcnNlIHJlY29tbWVuZGF0aW9ucyAtIHByZXNlcnZlIGNvZGUgYmxvY2tzIGJ5IHNwbGl0dGluZyBvbiBkb3VibGUgbmV3bGluZXMgb3IgbnVtYmVyZWQgbGlzdHNcbiAgICAgICAgLy8gU3BsaXQgYnkgcGF0dGVybnMgbGlrZSBcIjEuIFwiLCBcIjIuIFwiLCBldGMuIG9yIGRvdWJsZSBuZXdsaW5lc1xuICAgICAgICBjb25zdCByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGNvbnN0IGxpbmVzID0gcmVjb21tZW5kYXRpb25zVGV4dC5zcGxpdCgnXFxuJyk7XG4gICAgICAgIGxldCBjdXJyZW50UmVjID0gJyc7XG5cbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiBsaW5lIHN0YXJ0cyB3aXRoIGEgbnVtYmVyICgxLiwgMi4sIGV0Yy4pIC0gbmV3IHJlY29tbWVuZGF0aW9uXG4gICAgICAgICAgICBpZiAobGluZS5tYXRjaCgvXlxcZCtcXC5cXHMvKSkge1xuICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UmVjLnRyaW0oKSkge1xuICAgICAgICAgICAgICAgICAgICByZWNvbW1lbmRhdGlvbnMucHVzaChjdXJyZW50UmVjLnRyaW0oKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGN1cnJlbnRSZWMgPSBsaW5lLnJlcGxhY2UoL15cXGQrXFwuXFxzLywgJycpOyAvLyBSZW1vdmUgbnVtYmVyaW5nXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIGN1cnJlbnQgcmVjb21tZW5kYXRpb24gKGluY2x1ZGluZyBjb2RlIGJsb2NrcylcbiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFJlYyB8fCBsaW5lLnRyaW0oKSkge1xuICAgICAgICAgICAgICAgICAgICBjdXJyZW50UmVjICs9IChjdXJyZW50UmVjID8gJ1xcbicgOiAnJykgKyBsaW5lO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCB0aGUgbGFzdCByZWNvbW1lbmRhdGlvblxuICAgICAgICBpZiAoY3VycmVudFJlYy50cmltKCkpIHtcbiAgICAgICAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKGN1cnJlbnRSZWMudHJpbSgpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgR2VuZXJhdGVkICR7cmVjb21tZW5kYXRpb25zLmxlbmd0aH0gQUkgcmVjb21tZW5kYXRpb25zIHN1Y2Nlc3NmdWxseWApO1xuICAgICAgICByZXR1cm4gcmVjb21tZW5kYXRpb25zLnNsaWNlKDAsIDUpOyAvLyBMaW1pdCB0byA1IHJlY29tbWVuZGF0aW9uc1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBnZW5lcmF0ZSBBSSByZWNvbW1lbmRhdGlvbnM6JywgZXJyb3IpO1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcign8J+UjSBFcnJvciBkZXRhaWxzOicsIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgY29kZTogKGVycm9yIGFzIGFueSkuY29kZSxcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAoZXJyb3IgYXMgYW55KS4kbWV0YWRhdGE/Lmh0dHBTdGF0dXNDb2RlLFxuICAgICAgICAgICAgICAgIHJlcXVlc3RJZDogKGVycm9yIGFzIGFueSkuJG1ldGFkYXRhPy5yZXF1ZXN0SWQsXG4gICAgICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBjb25zb2xlLmxvZyhg8J+UhCBGYWxsaW5nIGJhY2sgdG8gZ2VuZXJpYyByZWNvbW1lbmRhdGlvbnNgKTtcblxuICAgICAgICAvLyBFbmhhbmNlZCBmYWxsYmFjayByZWNvbW1lbmRhdGlvbnMgd2l0aCBtb3JlIHNwZWNpZmljIGNvbnRlbnRcbiAgICAgICAgY29uc3QgZmFsbGJhY2tSZWNvbW1lbmRhdGlvbnMgPSBbXG4gICAgICAgICAgICBgQWRkIHRyb3VibGVzaG9vdGluZyBzZWN0aW9uIGZvciBcIiR7aXNzdWUudGl0bGV9XCIgd2l0aCBzcGVjaWZpYyBlcnJvciBoYW5kbGluZ2AsXG4gICAgICAgICAgICBgSW5jbHVkZSBjb2RlIGV4YW1wbGVzIGFkZHJlc3NpbmcgJHtpc3N1ZS5jYXRlZ29yeX0gaXNzdWVzYCxcbiAgICAgICAgICAgIGBBZGQgcHJvZHVjdGlvbiBkZXBsb3ltZW50IGd1aWRhbmNlIGZvciBjb21tb24gJHtpc3N1ZS5jYXRlZ29yeX0gcHJvYmxlbXNgLFxuICAgICAgICAgICAgYFJlZmVyZW5jZSBkZXZlbG9wZXIgaXNzdWU6ICR7aXNzdWUuc291cmNlc1swXX1gXG4gICAgICAgIF07XG5cbiAgICAgICAgY29uc29sZS5sb2coYPCfk50gVXNpbmcgZW5oYW5jZWQgZmFsbGJhY2sgcmVjb21tZW5kYXRpb25zOiAke2ZhbGxiYWNrUmVjb21tZW5kYXRpb25zLmxlbmd0aH0gaXRlbXNgKTtcbiAgICAgICAgcmV0dXJuIGZhbGxiYWNrUmVjb21tZW5kYXRpb25zO1xuICAgIH1cbn1cblxuLyoqXG4gKiBNYWtlIEhUVFAgcmVxdWVzdFxuICovXG5hc3luYyBmdW5jdGlvbiBtYWtlSHR0cFJlcXVlc3QodXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwodXJsKTtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIGhvc3RuYW1lOiB1cmxPYmouaG9zdG5hbWUsXG4gICAgICAgICAgICBwb3J0OiB1cmxPYmoucG9ydCB8fCA0NDMsXG4gICAgICAgICAgICBwYXRoOiB1cmxPYmoucGF0aG5hbWUgKyB1cmxPYmouc2VhcmNoLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnVXNlci1BZ2VudCc6ICdMZW5zeS1Eb2N1bWVudGF0aW9uLUF1ZGl0b3IvMS4wJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlcSA9IGh0dHBzLnJlcXVlc3Qob3B0aW9ucywgKHJlcykgPT4ge1xuICAgICAgICAgICAgbGV0IGRhdGEgPSAnJztcbiAgICAgICAgICAgIHJlcy5vbignZGF0YScsIChjaHVuaykgPT4gZGF0YSArPSBjaHVuayk7XG4gICAgICAgICAgICByZXMub24oJ2VuZCcsICgpID0+IHJlc29sdmUoZGF0YSkpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXEub24oJ2Vycm9yJywgcmVqZWN0KTtcbiAgICAgICAgcmVxLnNldFRpbWVvdXQoMTAwMDAsICgpID0+IHtcbiAgICAgICAgICAgIHJlcS5kZXN0cm95KCk7XG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKCdSZXF1ZXN0IHRpbWVvdXQnKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJlcS5lbmQoKTtcbiAgICB9KTtcbn1cblxuLyoqXG4gKiBTdG9yZSB2YWxpZGF0aW9uIHJlc3VsdHMgaW4gUzNcbiAqL1xuYXN5bmMgZnVuY3Rpb24gc3RvcmVWYWxpZGF0aW9uUmVzdWx0cyhzZXNzaW9uSWQ6IHN0cmluZywgcmVzdWx0czogSXNzdWVWYWxpZGF0b3JPdXRwdXQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuUzNfQlVDS0VUX05BTUU7XG4gICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUzNfQlVDS0VUX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgbm90IHNldCcpO1xuICAgIH1cblxuICAgIGNvbnN0IGtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vaXNzdWUtdmFsaWRhdGlvbi1yZXN1bHRzLmpzb25gO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBKU09OLnN0cmluZ2lmeShyZXN1bHRzLCBudWxsLCAyKTtcblxuICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgIEtleToga2V5LFxuICAgICAgICBCb2R5OiBjb250ZW50LFxuICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgfSkpO1xuXG4gICAgY29uc29sZS5sb2coYFN0b3JlZCB2YWxpZGF0aW9uIHJlc3VsdHMgaW4gUzM6ICR7a2V5fWApO1xufVxuXG4vKipcbiAqIFBlcmZvcm0gc2l0ZW1hcCBoZWFsdGggY2hlY2sgZm9yIHRoZSBnaXZlbiBkb21haW4gd2l0aCBjYWNoaW5nXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1TaXRlbWFwSGVhbHRoQ2hlY2soZG9tYWluOiBzdHJpbmcsIHNlc3Npb25JZDogc3RyaW5nKTogUHJvbWlzZTxTaXRlbWFwSGVhbHRoU3VtbWFyeSB8IG51bGw+IHtcbiAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuUzNfQlVDS0VUX05BTUU7XG4gICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1MzX0JVQ0tFVF9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gTm9ybWFsaXplIGRvbWFpbiBmb3IgY29uc2lzdGVudCBjb25maWd1cmF0aW9uIGxvb2t1cFxuICAgICAgICBjb25zdCBub3JtYWxpemVkRG9tYWluID0gbm9ybWFsaXplRG9tYWluKGRvbWFpbik7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SNIFN0YXJ0aW5nIHNpdGVtYXAgaGVhbHRoIGNoZWNrIGZvciBkb21haW46ICR7ZG9tYWlufSAobm9ybWFsaXplZDogJHtub3JtYWxpemVkRG9tYWlufSlgKTtcblxuICAgICAgICAvLyBEb21haW4tc3BlY2lmaWMgY2FjaGUga2V5IChzaW1pbGFyIHRvIGVtYmVkZGluZ3MpXG4gICAgICAgIGNvbnN0IGNhY2hlS2V5ID0gYHNpdGVtYXAtaGVhbHRoLSR7bm9ybWFsaXplZERvbWFpbi5yZXBsYWNlKC9cXC4vZywgJy0nKX0uanNvbmA7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OmIENhY2hlIGtleTogJHtjYWNoZUtleX1gKTtcblxuICAgICAgICAvLyBUcnkgdG8gbG9hZCBjYWNoZWQgaGVhbHRoIHJlc3VsdHMgZnJvbSBTM1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ/CflI0gQ2hlY2tpbmcgZm9yIGNhY2hlZCBzaXRlbWFwIGhlYWx0aCByZXN1bHRzLi4uJyk7XG4gICAgICAgICAgICBjb25zdCBnZXRDb21tYW5kID0gbmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IGNhY2hlS2V5XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBzM0NsaWVudC5zZW5kKGdldENvbW1hbmQpO1xuICAgICAgICAgICAgY29uc3QgY2FjaGVkRGF0YSA9IGF3YWl0IHJlc3BvbnNlLkJvZHk/LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG5cbiAgICAgICAgICAgIGlmIChjYWNoZWREYXRhKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2FjaGVkSGVhbHRoOiBTaXRlbWFwSGVhbHRoU3VtbWFyeSA9IEpTT04ucGFyc2UoY2FjaGVkRGF0YSk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBVc2luZyBjYWNoZWQgc2l0ZW1hcCBoZWFsdGggcmVzdWx0cyAoJHtjYWNoZWRIZWFsdGgudG90YWxVcmxzfSBVUkxzLCAke2NhY2hlZEhlYWx0aC5oZWFsdGhQZXJjZW50YWdlfSUgaGVhbHRoeSlgKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+ThSBDYWNoZSB0aW1lc3RhbXA6ICR7Y2FjaGVkSGVhbHRoLnRpbWVzdGFtcH1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2FjaGVkSGVhbHRoO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ/Cfk50gTm8gY2FjaGVkIHJlc3VsdHMgZm91bmQsIHBlcmZvcm1pbmcgZnJlc2ggaGVhbHRoIGNoZWNrLi4uJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgZG9tYWluLXNwZWNpZmljIHNpdGVtYXAgVVJMIGFuZCBkb2MgZmlsdGVyXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IERPTUFJTl9TSVRFTUFQX0NPTkZJR1tub3JtYWxpemVkRG9tYWluXTtcbiAgICAgICAgY29uc3Qgc2l0ZW1hcFVybCA9IGNvbmZpZyA/IGNvbmZpZy5zaXRlbWFwVXJsIDogYGh0dHBzOi8vJHtub3JtYWxpemVkRG9tYWlufS9zaXRlbWFwLnhtbGA7XG4gICAgICAgIGNvbnN0IGRvY0ZpbHRlciA9IGNvbmZpZyA/IGNvbmZpZy5kb2NGaWx0ZXIgOiAnL2RvY3MnO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+ThCBDaGVja2luZyBzaXRlbWFwOiAke3NpdGVtYXBVcmx9IChmaWx0ZXJpbmcgZm9yOiAke2RvY0ZpbHRlcn0pYCk7XG5cbiAgICAgICAgLy8gU3RlcCAxOiBJbnZva2UgU2l0ZW1hcFBhcnNlciBMYW1iZGFcbiAgICAgICAgY29uc3Qgc2l0ZW1hcFBhcnNlclBheWxvYWQgPSB7XG4gICAgICAgICAgICB1cmw6IHNpdGVtYXBVcmwsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IHNlc3Npb25JZCxcbiAgICAgICAgICAgIGlucHV0VHlwZTogJ3NpdGVtYXAnXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc29sZS5sb2coYPCfmoAgSW52b2tpbmcgU2l0ZW1hcFBhcnNlciBMYW1iZGEuLi5gKTtcbiAgICAgICAgY29uc3QgcGFyc2VyUmVzdWx0ID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQobmV3IEludm9rZUNvbW1hbmQoe1xuICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiAnTGVuc3lTdGFjay1TaXRlbWFwUGFyc2VyRnVuY3Rpb24xQTAwN0RGOS05cW9UQURZaTdrQ20nLFxuICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoc2l0ZW1hcFBhcnNlclBheWxvYWQpXG4gICAgICAgIH0pKTtcblxuICAgICAgICBpZiAoIXBhcnNlclJlc3VsdC5QYXlsb2FkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIHJlc3BvbnNlIGZyb20gU2l0ZW1hcFBhcnNlcicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGFyc2VyUmVzcG9uc2UgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShwYXJzZXJSZXN1bHQuUGF5bG9hZCkpO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBTaXRlbWFwUGFyc2VyIHJlc3VsdDogJHtwYXJzZXJSZXNwb25zZS5zdWNjZXNzID8gJ1NVQ0NFU1MnIDogJ0ZBSUxFRCd9YCk7XG5cbiAgICAgICAgaWYgKCFwYXJzZXJSZXNwb25zZS5zdWNjZXNzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4p2MIFNpdGVtYXBQYXJzZXIgZmFpbGVkOiAke3BhcnNlclJlc3BvbnNlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpbHRlciBVUkxzIHRvIG9ubHkgaW5jbHVkZSBkb2N1bWVudGF0aW9uIHBhZ2VzXG4gICAgICAgIGNvbnN0IGFsbFVybHMgPSBwYXJzZXJSZXNwb25zZS5zaXRlbWFwVXJscyB8fCBbXTtcbiAgICAgICAgLy8gVVJMcyBtaWdodCBiZSBmdWxsIFVSTHMgb3IgcGF0aHMsIGhhbmRsZSBib3RoIGNhc2VzXG4gICAgICAgIGNvbnN0IGRvY1VybHMgPSBhbGxVcmxzLmZpbHRlcigodXJsOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgcGF0aCBmcm9tIGZ1bGwgVVJMIGlmIG5lZWRlZFxuICAgICAgICAgICAgY29uc3QgcGF0aCA9IHVybC5zdGFydHNXaXRoKCdodHRwJykgPyBuZXcgVVJMKHVybCkucGF0aG5hbWUgOiB1cmw7XG4gICAgICAgICAgICByZXR1cm4gcGF0aC5zdGFydHNXaXRoKGRvY0ZpbHRlcik7XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiyBGaWx0ZXJlZCB0byAke2RvY1VybHMubGVuZ3RofSBkb2N1bWVudGF0aW9uIFVSTHMgZnJvbSAke2FsbFVybHMubGVuZ3RofSB0b3RhbCBVUkxzYCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGZpbHRlcmVkIHBhcnNlciByZXNwb25zZSB3aXRoIGNvcnJlY3QgZmllbGQgbmFtZXMgZm9yIFNpdGVtYXBIZWFsdGhDaGVja2VyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkUGFyc2VyUmVzcG9uc2UgPSB7XG4gICAgICAgICAgICAuLi5wYXJzZXJSZXNwb25zZSxcbiAgICAgICAgICAgIHNpdGVtYXBVcmxzOiBkb2NVcmxzLCAgLy8gU2l0ZW1hcEhlYWx0aENoZWNrZXIgZXhwZWN0cyAnc2l0ZW1hcFVybHMnIG5vdCAndXJscydcbiAgICAgICAgICAgIHRvdGFsVXJsczogZG9jVXJscy5sZW5ndGhcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBTdGVwIDI6IEludm9rZSBTaXRlbWFwSGVhbHRoQ2hlY2tlciBMYW1iZGEgd2l0aCBmaWx0ZXJlZCBVUkxzXG4gICAgICAgIGNvbnN0IGhlYWx0aENoZWNrZXJQYXlsb2FkID0ge1xuICAgICAgICAgICAgc2Vzc2lvbklkOiBzZXNzaW9uSWQsXG4gICAgICAgICAgICBzaXRlbWFwUGFyc2VyUmVzdWx0OiB7XG4gICAgICAgICAgICAgICAgUGF5bG9hZDogZmlsdGVyZWRQYXJzZXJSZXNwb25zZVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5qAIEludm9raW5nIFNpdGVtYXBIZWFsdGhDaGVja2VyIExhbWJkYS4uLmApO1xuICAgICAgICBjb25zdCBoZWFsdGhSZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZCh7XG4gICAgICAgICAgICBGdW5jdGlvbk5hbWU6ICdMZW5zeVN0YWNrLVNpdGVtYXBIZWFsdGhDaGVja2VyRnVuY3Rpb25CMjNFNEY1My1SODNET2c2R2gwTFknLFxuICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoaGVhbHRoQ2hlY2tlclBheWxvYWQpXG4gICAgICAgIH0pKTtcblxuICAgICAgICBpZiAoIWhlYWx0aFJlc3VsdC5QYXlsb2FkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIHJlc3BvbnNlIGZyb20gU2l0ZW1hcEhlYWx0aENoZWNrZXInKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGhlYWx0aFJlc3BvbnNlID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoaGVhbHRoUmVzdWx0LlBheWxvYWQpKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogU2l0ZW1hcEhlYWx0aENoZWNrZXIgcmVzdWx0OiAke2hlYWx0aFJlc3BvbnNlLnN1Y2Nlc3MgPyAnU1VDQ0VTUycgOiAnRkFJTEVEJ31gKTtcblxuICAgICAgICBpZiAoIWhlYWx0aFJlc3BvbnNlLnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinYwgU2l0ZW1hcEhlYWx0aENoZWNrZXIgZmFpbGVkOiAke2hlYWx0aFJlc3BvbnNlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJldHVybiB0aGUgaGVhbHRoIHN1bW1hcnkgd2l0aCBicmVha2Rvd24gY291bnRzXG4gICAgICAgIGNvbnN0IGhlYWx0aFN1bW1hcnk6IFNpdGVtYXBIZWFsdGhTdW1tYXJ5ID0ge1xuICAgICAgICAgICAgLi4uaGVhbHRoUmVzcG9uc2UuaGVhbHRoU3VtbWFyeSxcbiAgICAgICAgICAgIGJyb2tlblVybHM6IGhlYWx0aFJlc3BvbnNlLmJyb2tlblVybHMsXG4gICAgICAgICAgICBhY2Nlc3NEZW5pZWRVcmxzOiBoZWFsdGhSZXNwb25zZS5hY2Nlc3NEZW5pZWRVcmxzLFxuICAgICAgICAgICAgdGltZW91dFVybHM6IGhlYWx0aFJlc3BvbnNlLnRpbWVvdXRVcmxzLFxuICAgICAgICAgICAgb3RoZXJFcnJvclVybHM6IGhlYWx0aFJlc3BvbnNlLm90aGVyRXJyb3JVcmxzXG4gICAgICAgIH07XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgU2l0ZW1hcCBoZWFsdGggY2hlY2sgY29tcGxldGU6ICR7aGVhbHRoU3VtbWFyeS5oZWFsdGh5VXJsc30vJHtoZWFsdGhTdW1tYXJ5LnRvdGFsVXJsc30gVVJMcyBoZWFsdGh5ICgke2hlYWx0aFN1bW1hcnkuaGVhbHRoUGVyY2VudGFnZX0lKWApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBCcmVha2Rvd246ICR7aGVhbHRoU3VtbWFyeS5icm9rZW5VcmxzfSBicm9rZW4sICR7aGVhbHRoU3VtbWFyeS5hY2Nlc3NEZW5pZWRVcmxzfSBhY2Nlc3MgZGVuaWVkLCAke2hlYWx0aFN1bW1hcnkudGltZW91dFVybHN9IHRpbWVvdXQsICR7aGVhbHRoU3VtbWFyeS5vdGhlckVycm9yVXJsc30gb3RoZXIgZXJyb3JzYCk7XG5cbiAgICAgICAgLy8gU3RvcmUgaGVhbHRoIHJlc3VsdHMgaW4gZG9tYWluLXNwZWNpZmljIGNhY2hlXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBwdXRDb21tYW5kID0gbmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IGNhY2hlS2V5LFxuICAgICAgICAgICAgICAgIEJvZHk6IEpTT04uc3RyaW5naWZ5KGhlYWx0aFN1bW1hcnksIG51bGwsIDIpLFxuICAgICAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKHB1dENvbW1hbmQpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYPCfkr4gQ2FjaGVkIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHMgdG86ICR7Y2FjaGVLZXl9YCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfimqDvuI8gRmFpbGVkIHRvIGNhY2hlIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHM6JywgZXJyb3IpO1xuICAgICAgICAgICAgLy8gRG9uJ3QgZmFpbCB0aGUgd2hvbGUgb3BlcmF0aW9uIGlmIGNhY2hpbmcgZmFpbHNcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBoZWFsdGhTdW1tYXJ5O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFNpdGVtYXAgaGVhbHRoIGNoZWNrIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coJ0lzc3VlVmFsaWRhdG9yIExhbWJkYSBzdGFydGVkJywgeyBldmVudDogSlNPTi5zdHJpbmdpZnkoZXZlbnQpIH0pO1xuXG4gICAgICAgIC8vIFBhcnNlIGlucHV0XG4gICAgICAgIGNvbnN0IGlucHV0OiBJc3N1ZVZhbGlkYXRvcklucHV0ID0gdHlwZW9mIGV2ZW50LmJvZHkgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IEpTT04ucGFyc2UoZXZlbnQuYm9keSlcbiAgICAgICAgICAgIDogZXZlbnQuYm9keSBhcyBhbnk7XG5cbiAgICAgICAgY29uc3QgeyBpc3N1ZXMsIGRvbWFpbiwgc2Vzc2lvbklkIH0gPSBpbnB1dDtcblxuICAgICAgICBpZiAoIWlzc3VlcyB8fCAhZG9tYWluIHx8ICFzZXNzaW9uSWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXJzOiBpc3N1ZXMsIGRvbWFpbiwgYW5kIHNlc3Npb25JZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coYFZhbGlkYXRpbmcgJHtpc3N1ZXMubGVuZ3RofSBpc3N1ZXMgZm9yIGRvbWFpbjogJHtkb21haW59YCk7XG5cbiAgICAgICAgLy8gU3RhcnQgYm90aCBpc3N1ZSB2YWxpZGF0aW9uIGFuZCBzaXRlbWFwIGhlYWx0aCBjaGVjayBpbiBwYXJhbGxlbFxuICAgICAgICBjb25zdCBbdmFsaWRhdGlvblJlc3VsdHMsIHNpdGVtYXBIZWFsdGhdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgLy8gSXNzdWUgdmFsaWRhdGlvbiAoZXhpc3RpbmcgbG9naWMpXG4gICAgICAgICAgICBQcm9taXNlLmFsbChpc3N1ZXMubWFwKGlzc3VlID0+IHZhbGlkYXRlSXNzdWUoaXNzdWUsIGRvbWFpbikpKSxcbiAgICAgICAgICAgIC8vIFNpdGVtYXAgaGVhbHRoIGNoZWNrIChuZXcgbG9naWMpXG4gICAgICAgICAgICBwZXJmb3JtU2l0ZW1hcEhlYWx0aENoZWNrKGRvbWFpbiwgc2Vzc2lvbklkKVxuICAgICAgICBdKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIElzc3VlIHZhbGlkYXRpb24gY29tcGxldGVkOiAke3ZhbGlkYXRpb25SZXN1bHRzLmxlbmd0aH0gaXNzdWVzIHByb2Nlc3NlZGApO1xuICAgICAgICBpZiAoc2l0ZW1hcEhlYWx0aCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBTaXRlbWFwIGhlYWx0aCBjaGVjayBjb21wbGV0ZWQ6ICR7c2l0ZW1hcEhlYWx0aC5oZWFsdGh5VXJsc30vJHtzaXRlbWFwSGVhbHRoLnRvdGFsVXJsc30gVVJMcyBoZWFsdGh5YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pqg77iPIFNpdGVtYXAgaGVhbHRoIGNoZWNrIHNraXBwZWQgb3IgZmFpbGVkYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDYWxjdWxhdGUgc3VtbWFyeVxuICAgICAgICBjb25zdCBzdW1tYXJ5ID0ge1xuICAgICAgICAgICAgdG90YWxJc3N1ZXM6IHZhbGlkYXRpb25SZXN1bHRzLmxlbmd0aCxcbiAgICAgICAgICAgIGNvbmZpcm1lZDogdmFsaWRhdGlvblJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdjb25maXJtZWQnKS5sZW5ndGgsXG4gICAgICAgICAgICByZXNvbHZlZDogdmFsaWRhdGlvblJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdyZXNvbHZlZCcpLmxlbmd0aCxcbiAgICAgICAgICAgIHBvdGVudGlhbEdhcHM6IHZhbGlkYXRpb25SZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAncG90ZW50aWFsLWdhcCcpLmxlbmd0aCxcbiAgICAgICAgICAgIGNyaXRpY2FsR2FwczogdmFsaWRhdGlvblJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdjcml0aWNhbC1nYXAnKS5sZW5ndGhcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBwcm9jZXNzaW5nVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0OiBJc3N1ZVZhbGlkYXRvck91dHB1dCA9IHtcbiAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHRzLFxuICAgICAgICAgICAgc3VtbWFyeSxcbiAgICAgICAgICAgIHByb2Nlc3NpbmdUaW1lLFxuICAgICAgICAgICAgc2l0ZW1hcEhlYWx0aDogc2l0ZW1hcEhlYWx0aCB8fCB1bmRlZmluZWQgLy8gSW5jbHVkZSBzaXRlbWFwIGhlYWx0aCBpZiBhdmFpbGFibGVcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBTdG9yZSByZXN1bHRzIGluIFMzXG4gICAgICAgIGF3YWl0IHN0b3JlVmFsaWRhdGlvblJlc3VsdHMoc2Vzc2lvbklkLCBvdXRwdXQpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBJc3N1ZVZhbGlkYXRvciBjb21wbGV0ZWQgaW4gJHtwcm9jZXNzaW5nVGltZX1tc2AsIHN1bW1hcnkpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkob3V0cHV0KVxuICAgICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignSXNzdWVWYWxpZGF0b3IgZXJyb3I6JywgZXJyb3IpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGVycm9yOiAnSXNzdWUgdmFsaWRhdGlvbiBmYWlsZWQnLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHRzOiBbXSxcbiAgICAgICAgICAgICAgICBzdW1tYXJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHRvdGFsSXNzdWVzOiAwLFxuICAgICAgICAgICAgICAgICAgICBjb25maXJtZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmVkOiAwLFxuICAgICAgICAgICAgICAgICAgICBwb3RlbnRpYWxHYXBzOiAwLFxuICAgICAgICAgICAgICAgICAgICBjcml0aWNhbEdhcHM6IDBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByb2Nlc3NpbmdUaW1lOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lXG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuICAgIH1cbn07XG4iXX0=