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
                    max_tokens: 4096, // Reduced to 4096 to encourage more concise responses
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
            sitemapUrls: docUrls, // SitemapHealthChecker expects 'sitemapUrls' not 'urls'
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBa0Y7QUFDbEYsNEVBQTJGO0FBQzNGLDBEQUFxRTtBQUNyRSxrREFBMEI7QUFDMUIsNkJBQTBCO0FBRTFCLE1BQU0sUUFBUSxHQUFHLElBQUksb0JBQVEsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDbEUsTUFBTSxhQUFhLEdBQUcsSUFBSSw2Q0FBb0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsb0NBQW9DO0FBQzdHLE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFrRzFFOztHQUVHO0FBQ0gsS0FBSyxVQUFVLGlCQUFpQixDQUFDLElBQVk7SUFDekMsSUFBSSxDQUFDO1FBQ0QsTUFBTSxLQUFLLEdBQUc7WUFDVixPQUFPLEVBQUUsNEJBQTRCO1lBQ3JDLFdBQVcsRUFBRSxrQkFBa0I7WUFDL0IsTUFBTSxFQUFFLGtCQUFrQjtZQUMxQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsU0FBUyxFQUFFLElBQUk7YUFDbEIsQ0FBQztTQUNMLENBQUM7UUFFRixNQUFNLE9BQU8sR0FBRyxJQUFJLDJDQUFrQixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLE1BQU0sYUFBYSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVuRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksV0FBVyxFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ3pFLE9BQU8sWUFBWSxDQUFDLFNBQVMs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QUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7Z0JBQ2pFLGlCQUFpQixFQUFFLEVBQUU7Z0JBQ3JCLE9BQU8sRUFBRTtvQkFDTCxXQUFXLEVBQUUsQ0FBQztvQkFDZCxTQUFTLEVBQUUsQ0FBQztvQkFDWixRQUFRLEVBQUUsQ0FBQztvQkFDWCxhQUFhLEVBQUUsQ0FBQztvQkFDaEIsWUFBWSxFQUFFLENBQUM7aUJBQ2xCO2dCQUNELGNBQWMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUzthQUN6QyxDQUFDO1NBQ0wsQ0FBQztJQUNOLENBQUM7QUFDTCxDQUFDLENBQUM7QUExRlcsUUFBQSxPQUFPLFdBMEZsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IFMzQ2xpZW50LCBHZXRPYmplY3RDb21tYW5kLCBQdXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcbmltcG9ydCB7IEJlZHJvY2tSdW50aW1lQ2xpZW50LCBJbnZva2VNb2RlbENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtYmVkcm9jay1ydW50aW1lJztcbmltcG9ydCB7IExhbWJkYUNsaWVudCwgSW52b2tlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1sYW1iZGEnO1xuaW1wb3J0IGh0dHBzIGZyb20gJ2h0dHBzJztcbmltcG9ydCB7IFVSTCB9IGZyb20gJ3VybCc7XG5cbmNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xuY29uc3QgYmVkcm9ja0NsaWVudCA9IG5ldyBCZWRyb2NrUnVudGltZUNsaWVudCh7IHJlZ2lvbjogJ3VzLWVhc3QtMScgfSk7IC8vIEJlZHJvY2sgaXMgYXZhaWxhYmxlIGluIHVzLWVhc3QtMVxuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcblxuaW50ZXJmYWNlIERpc2NvdmVyZWRJc3N1ZSB7XG4gICAgaWQ6IHN0cmluZztcbiAgICB0aXRsZTogc3RyaW5nO1xuICAgIGNhdGVnb3J5OiBzdHJpbmc7XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgICBmcmVxdWVuY3k6IG51bWJlcjtcbiAgICBzb3VyY2VzOiBzdHJpbmdbXTtcbiAgICBsYXN0U2Vlbjogc3RyaW5nO1xuICAgIHNldmVyaXR5OiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnO1xuICAgIHJlbGF0ZWRQYWdlczogc3RyaW5nW107XG4gICAgLy8gUmljaCBjb250ZW50IGZyb20gc291cmNlXG4gICAgZnVsbENvbnRlbnQ/OiBzdHJpbmc7ICAvLyBGdWxsIHF1ZXN0aW9uL2lzc3VlIGJvZHlcbiAgICBjb2RlU25pcHBldHM/OiBzdHJpbmdbXTsgIC8vIENvZGUgZXhhbXBsZXMgZnJvbSB0aGUgaXNzdWVcbiAgICBlcnJvck1lc3NhZ2VzPzogc3RyaW5nW107ICAvLyBFeHRyYWN0ZWQgZXJyb3IgbWVzc2FnZXNcbiAgICB0YWdzPzogc3RyaW5nW107ICAvLyBUZWNobm9sb2d5IHRhZ3NcbiAgICBzdGFja1RyYWNlPzogc3RyaW5nOyAgLy8gU3RhY2sgdHJhY2VzIGlmIHByZXNlbnRcbn1cblxuaW50ZXJmYWNlIElzc3VlVmFsaWRhdG9ySW5wdXQge1xuICAgIGlzc3VlczogRGlzY292ZXJlZElzc3VlW107XG4gICAgZG9tYWluOiBzdHJpbmc7XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBFdmlkZW5jZSB7XG4gICAgcGFnZVVybDogc3RyaW5nO1xuICAgIHBhZ2VUaXRsZTogc3RyaW5nO1xuICAgIGhhc1JlbGV2YW50Q29udGVudDogYm9vbGVhbjtcbiAgICBjb250ZW50R2Fwczogc3RyaW5nW107XG4gICAgY29kZUV4YW1wbGVzOiBudW1iZXI7XG4gICAgcHJvZHVjdGlvbkd1aWRhbmNlOiBib29sZWFuO1xuICAgIHNlbWFudGljU2NvcmU/OiBudW1iZXI7IC8vIFNlbWFudGljIHNpbWlsYXJpdHkgc2NvcmUgKDAtMSlcbn1cblxuaW50ZXJmYWNlIEdhcEFuYWx5c2lzIHtcbiAgICBnYXBUeXBlOiAncG90ZW50aWFsLWdhcCcgfCAnY3JpdGljYWwtZ2FwJyB8ICdyZXNvbHZlZCc7XG4gICAgcGFnZVVybD86IHN0cmluZztcbiAgICBwYWdlVGl0bGU/OiBzdHJpbmc7XG4gICAgbWlzc2luZ0NvbnRlbnQ6IHN0cmluZ1tdO1xuICAgIHJlYXNvbmluZzogc3RyaW5nO1xuICAgIGRldmVsb3BlckltcGFjdDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgVmFsaWRhdGlvblJlc3VsdCB7XG4gICAgaXNzdWVJZDogc3RyaW5nO1xuICAgIGlzc3VlVGl0bGU6IHN0cmluZztcbiAgICBzdGF0dXM6ICdjb25maXJtZWQnIHwgJ3Jlc29sdmVkJyB8ICdwb3RlbnRpYWwtZ2FwJyB8ICdjcml0aWNhbC1nYXAnO1xuICAgIGV2aWRlbmNlOiBFdmlkZW5jZVtdO1xuICAgIG1pc3NpbmdFbGVtZW50czogc3RyaW5nW107XG4gICAgcG90ZW50aWFsR2FwczogR2FwQW5hbHlzaXNbXTtcbiAgICBjcml0aWNhbEdhcHM6IHN0cmluZ1tdO1xuICAgIGNvbmZpZGVuY2U6IG51bWJlcjtcbiAgICByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdO1xufVxuXG5pbnRlcmZhY2UgSXNzdWVWYWxpZGF0b3JPdXRwdXQge1xuICAgIHZhbGlkYXRpb25SZXN1bHRzOiBWYWxpZGF0aW9uUmVzdWx0W107XG4gICAgc3VtbWFyeToge1xuICAgICAgICB0b3RhbElzc3VlczogbnVtYmVyO1xuICAgICAgICBjb25maXJtZWQ6IG51bWJlcjtcbiAgICAgICAgcmVzb2x2ZWQ6IG51bWJlcjtcbiAgICAgICAgcG90ZW50aWFsR2FwczogbnVtYmVyO1xuICAgICAgICBjcml0aWNhbEdhcHM6IG51bWJlcjtcbiAgICB9O1xuICAgIHByb2Nlc3NpbmdUaW1lOiBudW1iZXI7XG4gICAgc2l0ZW1hcEhlYWx0aD86IFNpdGVtYXBIZWFsdGhTdW1tYXJ5OyAvLyBORVc6IE9wdGlvbmFsIHNpdGVtYXAgaGVhbHRoIGRhdGFcbn1cblxuaW50ZXJmYWNlIFNpdGVtYXBIZWFsdGhTdW1tYXJ5IHtcbiAgICB0b3RhbFVybHM6IG51bWJlcjtcbiAgICBoZWFsdGh5VXJsczogbnVtYmVyO1xuICAgIGJyb2tlblVybHM6IG51bWJlcjtcbiAgICBhY2Nlc3NEZW5pZWRVcmxzOiBudW1iZXI7XG4gICAgdGltZW91dFVybHM6IG51bWJlcjtcbiAgICBvdGhlckVycm9yVXJsczogbnVtYmVyO1xuICAgIGxpbmtJc3N1ZXM6IExpbmtJc3N1ZVtdO1xuICAgIGhlYWx0aFBlcmNlbnRhZ2U6IG51bWJlcjtcbiAgICBwcm9jZXNzaW5nVGltZTogbnVtYmVyO1xuICAgIHRpbWVzdGFtcDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgTGlua0lzc3VlIHtcbiAgICB1cmw6IHN0cmluZztcbiAgICBzdGF0dXM6IG51bWJlciB8IHN0cmluZztcbiAgICBlcnJvck1lc3NhZ2U6IHN0cmluZztcbiAgICBpc3N1ZVR5cGU6ICc0MDQnIHwgJ2FjY2Vzcy1kZW5pZWQnIHwgJ3RpbWVvdXQnIHwgJ2Vycm9yJztcbn1cblxuaW50ZXJmYWNlIFJpY2hDb250ZW50RW1iZWRkaW5nIHtcbiAgICB1cmw6IHN0cmluZztcbiAgICB0aXRsZTogc3RyaW5nO1xuICAgIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gICAgY29udGVudDogc3RyaW5nO1xuICAgIGVtYmVkZGluZzogbnVtYmVyW107XG59XG5cbi8qKlxuICogR2VuZXJhdGUgZW1iZWRkaW5nIGZvciB0ZXh0IHVzaW5nIEFtYXpvbiBCZWRyb2NrIFRpdGFuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlRW1iZWRkaW5nKHRleHQ6IHN0cmluZyk6IFByb21pc2U8bnVtYmVyW10+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IHtcbiAgICAgICAgICAgIG1vZGVsSWQ6ICdhbWF6b24udGl0YW4tZW1iZWQtdGV4dC12MScsXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgYWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgaW5wdXRUZXh0OiB0ZXh0XG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxDb21tYW5kKGlucHV0KTtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrQ2xpZW50LnNlbmQoY29tbWFuZCk7XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuYm9keSkpO1xuICAgICAgICByZXR1cm4gcmVzcG9uc2VCb2R5LmVtYmVkZGluZztcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZW5lcmF0aW5nIGVtYmVkZGluZzonLCBlcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0IHBhZ2UgY29udGVudCBmcm9tIEhUTUxcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdFBhZ2VDb250ZW50KGh0bWw6IHN0cmluZyk6IHsgdGl0bGU6IHN0cmluZzsgZGVzY3JpcHRpb246IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0ge1xuICAgIC8vIEV4dHJhY3QgdGl0bGVcbiAgICBjb25zdCB0aXRsZU1hdGNoID0gaHRtbC5tYXRjaCgvPHRpdGxlW14+XSo+KC4qPyk8XFwvdGl0bGU+L2kpO1xuICAgIGNvbnN0IHRpdGxlID0gdGl0bGVNYXRjaCA/IHRpdGxlTWF0Y2hbMV0udHJpbSgpIDogJyc7XG5cbiAgICAvLyBFeHRyYWN0IG1ldGEgZGVzY3JpcHRpb25cbiAgICBjb25zdCBkZXNjTWF0Y2ggPSBodG1sLm1hdGNoKC88bWV0YVtePl0qbmFtZT1bXCInXWRlc2NyaXB0aW9uW1wiJ11bXj5dKmNvbnRlbnQ9W1wiJ10oW15cIiddKj8pW1wiJ11bXj5dKj4vaSk7XG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSBkZXNjTWF0Y2ggPyBkZXNjTWF0Y2hbMV0udHJpbSgpIDogJyc7XG5cbiAgICAvLyBFeHRyYWN0IG1haW4gY29udGVudCAocmVtb3ZlIHNjcmlwdHMsIHN0eWxlcywgbmF2LCBmb290ZXIpXG4gICAgbGV0IGNvbnRlbnQgPSBodG1sXG4gICAgICAgIC5yZXBsYWNlKC88c2NyaXB0W14+XSo+W1xcc1xcU10qPzxcXC9zY3JpcHQ+L2dpLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLzxzdHlsZVtePl0qPltcXHNcXFNdKj88XFwvc3R5bGU+L2dpLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLzxuYXZbXj5dKj5bXFxzXFxTXSo/PFxcL25hdj4vZ2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvPGZvb3RlcltePl0qPltcXHNcXFNdKj88XFwvZm9vdGVyPi9naSwgJycpXG4gICAgICAgIC5yZXBsYWNlKC88aGVhZGVyW14+XSo+W1xcc1xcU10qPzxcXC9oZWFkZXI+L2dpLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLzxhc2lkZVtePl0qPltcXHNcXFNdKj88XFwvYXNpZGU+L2dpLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLzxbXj5dKz4vZywgJyAnKVxuICAgICAgICAucmVwbGFjZSgvXFxzKy9nLCAnICcpXG4gICAgICAgIC50cmltKCk7XG5cbiAgICAvLyBMaW1pdCBjb250ZW50IGxlbmd0aCBmb3IgZW1iZWRkaW5nXG4gICAgaWYgKGNvbnRlbnQubGVuZ3RoID4gODAwMCkge1xuICAgICAgICBjb250ZW50ID0gY29udGVudC5zdWJzdHJpbmcoMCwgODAwMCkgKyAnLi4uJztcbiAgICB9XG5cbiAgICByZXR1cm4geyB0aXRsZSwgZGVzY3JpcHRpb24sIGNvbnRlbnQgfTtcbn1cblxuLyoqXG4gKiBMb2FkIG9yIGdlbmVyYXRlIGVtYmVkZGluZ3MgZm9yIGFsbCBkb2N1bWVudGF0aW9uIHBhZ2VzXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxvYWRPckdlbmVyYXRlRW1iZWRkaW5ncyhkb21haW46IHN0cmluZyk6IFByb21pc2U8UmljaENvbnRlbnRFbWJlZGRpbmdbXT4ge1xuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5TM19CVUNLRVRfTkFNRTtcbiAgICBpZiAoIWJ1Y2tldE5hbWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTM19CVUNLRVRfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgfVxuXG4gICAgLy8gTm9ybWFsaXplIGRvbWFpbiBmb3IgY29uc2lzdGVudCBjb25maWd1cmF0aW9uIGxvb2t1cFxuICAgIGNvbnN0IG5vcm1hbGl6ZWREb21haW4gPSBub3JtYWxpemVEb21haW4oZG9tYWluKTtcbiAgICBjb25zb2xlLmxvZyhgTG9hZGluZyBlbWJlZGRpbmdzIGZvciBkb21haW46ICR7ZG9tYWlufSAobm9ybWFsaXplZDogJHtub3JtYWxpemVkRG9tYWlufSlgKTtcblxuICAgIC8vIERvbWFpbi1zcGVjaWZpYyBlbWJlZGRpbmdzIGtleSB0byBhdm9pZCBjcm9zcy1jb250YW1pbmF0aW9uXG4gICAgY29uc3QgZW1iZWRkaW5nc0tleSA9IGByaWNoLWNvbnRlbnQtZW1iZWRkaW5ncy0ke25vcm1hbGl6ZWREb21haW4ucmVwbGFjZSgvXFwuL2csICctJyl9Lmpzb25gO1xuICAgIGNvbnNvbGUubG9nKGBVc2luZyBkb21haW4tc3BlY2lmaWMgZW1iZWRkaW5ncyBrZXk6ICR7ZW1iZWRkaW5nc0tleX1gKTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vIFRyeSB0byBsb2FkIGV4aXN0aW5nIGVtYmVkZGluZ3MgZnJvbSBTM1xuICAgICAgICBjb25zb2xlLmxvZygnTG9hZGluZyBleGlzdGluZyBlbWJlZGRpbmdzIGZyb20gUzMuLi4nKTtcbiAgICAgICAgY29uc3QgZ2V0Q29tbWFuZCA9IG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogZW1iZWRkaW5nc0tleVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHMzQ2xpZW50LnNlbmQoZ2V0Q29tbWFuZCk7XG4gICAgICAgIGNvbnN0IGVtYmVkZGluZ3NEYXRhID0gYXdhaXQgcmVzcG9uc2UuQm9keT8udHJhbnNmb3JtVG9TdHJpbmcoKTtcblxuICAgICAgICBpZiAoZW1iZWRkaW5nc0RhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IGVtYmVkZGluZ3M6IFJpY2hDb250ZW50RW1iZWRkaW5nW10gPSBKU09OLnBhcnNlKGVtYmVkZGluZ3NEYXRhKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBMb2FkZWQgJHtlbWJlZGRpbmdzLmxlbmd0aH0gZXhpc3RpbmcgZW1iZWRkaW5ncyBmcm9tIFMzYCk7XG4gICAgICAgICAgICByZXR1cm4gZW1iZWRkaW5ncztcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdObyBleGlzdGluZyBlbWJlZGRpbmdzIGZvdW5kLCBnZW5lcmF0aW5nIG5ldyBvbmVzLi4uJyk7XG4gICAgfVxuXG4gICAgLy8gR2VuZXJhdGUgbmV3IGVtYmVkZGluZ3NcbiAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgZmV0Y2hTaXRlbWFwKG5vcm1hbGl6ZWREb21haW4pO1xuICAgIGNvbnN0IGRvY1BhZ2VzID0gc2l0ZW1hcC5maWx0ZXIodXJsID0+IHVybC5zdGFydHNXaXRoKCcvZG9jcy8nKSk7XG4gICAgY29uc29sZS5sb2coYEdlbmVyYXRpbmcgZW1iZWRkaW5ncyBmb3IgJHtkb2NQYWdlcy5sZW5ndGh9IGRvY3VtZW50YXRpb24gcGFnZXMuLi5gKTtcblxuICAgIGNvbnN0IGVtYmVkZGluZ3M6IFJpY2hDb250ZW50RW1iZWRkaW5nW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgcGFnZVBhdGggb2YgZG9jUGFnZXMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGh0bWwgPSBhd2FpdCBmZXRjaFBhZ2VDb250ZW50KGRvbWFpbiwgcGFnZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFodG1sKSBjb250aW51ZTtcblxuICAgICAgICAgICAgY29uc3QgeyB0aXRsZSwgZGVzY3JpcHRpb24sIGNvbnRlbnQgfSA9IGV4dHJhY3RQYWdlQ29udGVudChodG1sKTtcblxuICAgICAgICAgICAgLy8gQ29tYmluZSB0aXRsZSwgZGVzY3JpcHRpb24sIGFuZCBjb250ZW50IGZvciBlbWJlZGRpbmdcbiAgICAgICAgICAgIGNvbnN0IHRleHRGb3JFbWJlZGRpbmcgPSBgJHt0aXRsZX0gJHtkZXNjcmlwdGlvbn0gJHtjb250ZW50fWAudHJpbSgpO1xuXG4gICAgICAgICAgICBpZiAodGV4dEZvckVtYmVkZGluZy5sZW5ndGggPCAxMCkgY29udGludWU7IC8vIFNraXAgcGFnZXMgd2l0aCBtaW5pbWFsIGNvbnRlbnRcblxuICAgICAgICAgICAgY29uc3QgZW1iZWRkaW5nID0gYXdhaXQgZ2VuZXJhdGVFbWJlZGRpbmcodGV4dEZvckVtYmVkZGluZyk7XG5cbiAgICAgICAgICAgIGVtYmVkZGluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgdXJsOiBwYWdlUGF0aCxcbiAgICAgICAgICAgICAgICB0aXRsZSxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICBjb250ZW50LFxuICAgICAgICAgICAgICAgIGVtYmVkZGluZ1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBHZW5lcmF0ZWQgZW1iZWRkaW5nIGZvcjogJHtwYWdlUGF0aH0gKCR7dGl0bGV9KWApO1xuXG4gICAgICAgICAgICAvLyBBZGQgc21hbGwgZGVsYXkgdG8gYXZvaWQgcmF0ZSBsaW1pdGluZ1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpO1xuXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gZ2VuZXJhdGUgZW1iZWRkaW5nIGZvciAke3BhZ2VQYXRofTpgLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdG9yZSBlbWJlZGRpbmdzIGluIFMzXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcHV0Q29tbWFuZCA9IG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogZW1iZWRkaW5nc0tleSxcbiAgICAgICAgICAgIEJvZHk6IEpTT04uc3RyaW5naWZ5KGVtYmVkZGluZ3MsIG51bGwsIDIpLFxuICAgICAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKHB1dENvbW1hbmQpO1xuICAgICAgICBjb25zb2xlLmxvZyhgU3RvcmVkICR7ZW1iZWRkaW5ncy5sZW5ndGh9IGVtYmVkZGluZ3MgaW4gUzNgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc3RvcmUgZW1iZWRkaW5ncyBpbiBTMzonLCBlcnJvcik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVtYmVkZGluZ3M7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIGNvc2luZSBzaW1pbGFyaXR5IGJldHdlZW4gdHdvIHZlY3RvcnNcbiAqL1xuZnVuY3Rpb24gY29zaW5lU2ltaWxhcml0eShhOiBudW1iZXJbXSwgYjogbnVtYmVyW10pOiBudW1iZXIge1xuICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdWZWN0b3JzIG11c3QgaGF2ZSB0aGUgc2FtZSBsZW5ndGgnKTtcbiAgICB9XG5cbiAgICBsZXQgZG90UHJvZHVjdCA9IDA7XG4gICAgbGV0IG5vcm1BID0gMDtcbiAgICBsZXQgbm9ybUIgPSAwO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGRvdFByb2R1Y3QgKz0gYVtpXSAqIGJbaV07XG4gICAgICAgIG5vcm1BICs9IGFbaV0gKiBhW2ldO1xuICAgICAgICBub3JtQiArPSBiW2ldICogYltpXTtcbiAgICB9XG5cbiAgICBub3JtQSA9IE1hdGguc3FydChub3JtQSk7XG4gICAgbm9ybUIgPSBNYXRoLnNxcnQobm9ybUIpO1xuXG4gICAgaWYgKG5vcm1BID09PSAwIHx8IG5vcm1CID09PSAwKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIHJldHVybiBkb3RQcm9kdWN0IC8gKG5vcm1BICogbm9ybUIpO1xufVxuXG4vKipcbiAqIFNlYXJjaCBzaXRlbWFwIHVzaW5nIHNlbWFudGljIHNpbWlsYXJpdHkgKG9wdGltaXplZCB2ZXJzaW9uKVxuICogUmV0dXJucyBhcnJheSBvZiB7dXJsLCB0aXRsZSwgc2ltaWxhcml0eX0gb2JqZWN0c1xuICovXG5hc3luYyBmdW5jdGlvbiBzZWFyY2hTaXRlbWFwU2VtYW50aWNseU9wdGltaXplZChpc3N1ZTogRGlzY292ZXJlZElzc3VlLCBkb21haW46IHN0cmluZyk6IFByb21pc2U8QXJyYXk8eyB1cmw6IHN0cmluZzsgdGl0bGU6IHN0cmluZzsgc2ltaWxhcml0eTogbnVtYmVyIH0+PiB7XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gTG9hZCBwcmUtZ2VuZXJhdGVkIGVtYmVkZGluZ3NcbiAgICAgICAgY29uc3QgZW1iZWRkaW5ncyA9IGF3YWl0IGxvYWRPckdlbmVyYXRlRW1iZWRkaW5ncyhkb21haW4pO1xuXG4gICAgICAgIGlmIChlbWJlZGRpbmdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGVtYmVkZGluZ3MgYXZhaWxhYmxlLCBmYWxsaW5nIGJhY2sgdG8ga2V5d29yZCBzZWFyY2gnKTtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdlbmVyYXRlIGVtYmVkZGluZyBmb3IgdGhlIGlzc3VlIHVzaW5nIFJJQ0ggQ09OVEVOVFxuICAgICAgICAvLyBDb21iaW5lIGFsbCBhdmFpbGFibGUgZmllbGRzIGZvciBtYXhpbXVtIGNvbnRleHRcbiAgICAgICAgbGV0IGlzc3VlVGV4dCA9IGAke2lzc3VlLnRpdGxlfSAke2lzc3VlLmRlc2NyaXB0aW9ufSAke2lzc3VlLmNhdGVnb3J5fWA7XG5cbiAgICAgICAgLy8gQWRkIHJpY2ggY29udGVudCBpZiBhdmFpbGFibGVcbiAgICAgICAgaWYgKGlzc3VlLmZ1bGxDb250ZW50KSB7XG4gICAgICAgICAgICBpc3N1ZVRleHQgKz0gYCAke2lzc3VlLmZ1bGxDb250ZW50fWA7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgZnVsbCBjb250ZW50ICgke2lzc3VlLmZ1bGxDb250ZW50Lmxlbmd0aH0gY2hhcnMpIGZvciBzZW1hbnRpYyBtYXRjaGluZ2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzc3VlLmNvZGVTbmlwcGV0cyAmJiBpc3N1ZS5jb2RlU25pcHBldHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgaXNzdWVUZXh0ICs9IGAgJHtpc3N1ZS5jb2RlU25pcHBldHMuam9pbignICcpfWA7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgSW5jbHVkaW5nICR7aXNzdWUuY29kZVNuaXBwZXRzLmxlbmd0aH0gY29kZSBzbmlwcGV0c2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzc3VlLmVycm9yTWVzc2FnZXMgJiYgaXNzdWUuZXJyb3JNZXNzYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBpc3N1ZVRleHQgKz0gYCAke2lzc3VlLmVycm9yTWVzc2FnZXMuam9pbignICcpfWA7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgSW5jbHVkaW5nICR7aXNzdWUuZXJyb3JNZXNzYWdlcy5sZW5ndGh9IGVycm9yIG1lc3NhZ2VzYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNzdWUudGFncyAmJiBpc3N1ZS50YWdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGlzc3VlVGV4dCArPSBgICR7aXNzdWUudGFncy5qb2luKCcgJyl9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBJbmNsdWRpbmcgJHtpc3N1ZS50YWdzLmxlbmd0aH0gdGFnczogJHtpc3N1ZS50YWdzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNzdWUuc3RhY2tUcmFjZSkge1xuICAgICAgICAgICAgaXNzdWVUZXh0ICs9IGAgJHtpc3N1ZS5zdGFja1RyYWNlfWA7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgSW5jbHVkaW5nIHN0YWNrIHRyYWNlYCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhgVG90YWwgaXNzdWUgdGV4dCBmb3IgZW1iZWRkaW5nOiAke2lzc3VlVGV4dC5sZW5ndGh9IGNoYXJzYCk7XG5cbiAgICAgICAgY29uc3QgaXNzdWVFbWJlZGRpbmcgPSBhd2FpdCBnZW5lcmF0ZUVtYmVkZGluZyhpc3N1ZVRleHQpO1xuXG4gICAgICAgIC8vIENhbGN1bGF0ZSBzaW1pbGFyaXRpZXNcbiAgICAgICAgY29uc3Qgc2ltaWxhcml0aWVzOiBBcnJheTx7IHVybDogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyBzaW1pbGFyaXR5OiBudW1iZXIgfT4gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IGVtYmVkZGluZyBvZiBlbWJlZGRpbmdzKSB7XG4gICAgICAgICAgICBjb25zdCBzaW1pbGFyaXR5ID0gY29zaW5lU2ltaWxhcml0eShpc3N1ZUVtYmVkZGluZywgZW1iZWRkaW5nLmVtYmVkZGluZyk7XG4gICAgICAgICAgICBzaW1pbGFyaXRpZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgdXJsOiBlbWJlZGRpbmcudXJsLFxuICAgICAgICAgICAgICAgIHRpdGxlOiBlbWJlZGRpbmcudGl0bGUsXG4gICAgICAgICAgICAgICAgc2ltaWxhcml0eVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTb3J0IGJ5IHNpbWlsYXJpdHkgYW5kIHJldHVybiB0b3AgNVxuICAgICAgICBzaW1pbGFyaXRpZXMuc29ydCgoYSwgYikgPT4gYi5zaW1pbGFyaXR5IC0gYS5zaW1pbGFyaXR5KTtcbiAgICAgICAgY29uc3QgdG9wUGFnZXMgPSBzaW1pbGFyaXRpZXMuc2xpY2UoMCwgNSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYFNlbWFudGljIHNlYXJjaCByZXN1bHRzIGZvciBcIiR7aXNzdWUudGl0bGV9XCIgKHVzaW5nIHJpY2ggY29udGVudCk6YCk7XG4gICAgICAgIHRvcFBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgJHtpbmRleCArIDF9LiAke3BhZ2UudXJsfSAoJHtwYWdlLnRpdGxlfSkgLSBTaW1pbGFyaXR5OiAke3BhZ2Uuc2ltaWxhcml0eS50b0ZpeGVkKDMpfWApO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdG9wUGFnZXM7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdTZW1hbnRpYyBzZWFyY2ggZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0IGtleXdvcmRzIGZyb20gaXNzdWUgZm9yIHNpdGVtYXAgc2VhcmNoXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RLZXl3b3Jkcyhpc3N1ZTogRGlzY292ZXJlZElzc3VlKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHRleHQgPSBgJHtpc3N1ZS50aXRsZX0gJHtpc3N1ZS5kZXNjcmlwdGlvbn0gJHtpc3N1ZS5jYXRlZ29yeX1gLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAvLyBDb21tb24gc3RvcCB3b3JkcyB0byBmaWx0ZXIgb3V0XG4gICAgY29uc3Qgc3RvcFdvcmRzID0gWyd0aGUnLCAnYScsICdhbicsICdhbmQnLCAnb3InLCAnYnV0JywgJ2luJywgJ29uJywgJ2F0JywgJ3RvJywgJ2ZvcicsICdvZicsICd3aXRoJywgJ2lzJywgJ2FyZScsICd3YXMnLCAnd2VyZScsICdiZWVuJywgJ2JlJywgJ2hhdmUnLCAnaGFzJywgJ2hhZCcsICdkbycsICdkb2VzJywgJ2RpZCcsICd3aWxsJywgJ3dvdWxkJywgJ3Nob3VsZCcsICdjb3VsZCcsICdtYXknLCAnbWlnaHQnLCAnbXVzdCcsICdjYW4nXTtcblxuICAgIC8vIEV4dHJhY3Qgd29yZHMgKGFscGhhbnVtZXJpYywgMysgY2hhcnMpXG4gICAgY29uc3Qgd29yZHMgPSB0ZXh0Lm1hdGNoKC9cXGJbYS16MC05XXszLH1cXGIvZykgfHwgW107XG5cbiAgICAvLyBGaWx0ZXIgc3RvcCB3b3JkcyBhbmQgZGVkdXBsaWNhdGVcbiAgICBjb25zdCBrZXl3b3JkcyA9IFsuLi5uZXcgU2V0KHdvcmRzLmZpbHRlcih3b3JkID0+ICFzdG9wV29yZHMuaW5jbHVkZXMod29yZCkpKV07XG5cbiAgICAvLyBBZGQgY2F0ZWdvcnktc3BlY2lmaWMga2V5d29yZHNcbiAgICBjb25zdCBjYXRlZ29yeUtleXdvcmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7XG4gICAgICAgICdkZXBsb3ltZW50JzogWydkZXBsb3knLCAncHJvZHVjdGlvbicsICdlbnZpcm9ubWVudCcsICd2ZXJjZWwnLCAnbmV0bGlmeScsICdob3N0aW5nJ10sXG4gICAgICAgICdlbWFpbC1kZWxpdmVyeSc6IFsnZW1haWwnLCAnc3BhbScsICdkZWxpdmVyYWJpbGl0eScsICdkbnMnLCAnc3BmJywgJ2RraW0nLCAnZ21haWwnXSxcbiAgICAgICAgJ2FwaS11c2FnZSc6IFsnYXBpJywgJ2VuZHBvaW50JywgJ3JlcXVlc3QnLCAncmVzcG9uc2UnLCAnaW50ZWdyYXRpb24nXSxcbiAgICAgICAgJ2F1dGhlbnRpY2F0aW9uJzogWydhdXRoJywgJ2tleScsICd0b2tlbicsICdjcmVkZW50aWFsJywgJ3Blcm1pc3Npb24nXSxcbiAgICAgICAgJ2RvY3VtZW50YXRpb24nOiBbJ2RvY3MnLCAnZ3VpZGUnLCAndHV0b3JpYWwnLCAnZXhhbXBsZSddXG4gICAgfTtcblxuICAgIGlmIChpc3N1ZS5jYXRlZ29yeSAmJiBjYXRlZ29yeUtleXdvcmRzW2lzc3VlLmNhdGVnb3J5XSkge1xuICAgICAgICBrZXl3b3Jkcy5wdXNoKC4uLmNhdGVnb3J5S2V5d29yZHNbaXNzdWUuY2F0ZWdvcnldKTtcbiAgICB9XG5cbiAgICByZXR1cm4gWy4uLm5ldyBTZXQoa2V5d29yZHMpXTtcbn1cblxuLyoqXG4gKiBEb21haW4tc3BlY2lmaWMgc2l0ZW1hcCBjb25maWd1cmF0aW9uXG4gKi9cbmNvbnN0IERPTUFJTl9TSVRFTUFQX0NPTkZJRzogUmVjb3JkPHN0cmluZywgeyBzaXRlbWFwVXJsOiBzdHJpbmc7IGRvY0ZpbHRlcjogc3RyaW5nIH0+ID0ge1xuICAgICdyZXNlbmQuY29tJzoge1xuICAgICAgICBzaXRlbWFwVXJsOiAnaHR0cHM6Ly9yZXNlbmQuY29tL2RvY3Mvc2l0ZW1hcC54bWwnLFxuICAgICAgICBkb2NGaWx0ZXI6ICcvZG9jcy8nXG4gICAgfSxcbiAgICAnbGl2ZWJsb2Nrcy5pbyc6IHtcbiAgICAgICAgc2l0ZW1hcFVybDogJ2h0dHBzOi8vbGl2ZWJsb2Nrcy5pby9zaXRlbWFwLnhtbCcsXG4gICAgICAgIGRvY0ZpbHRlcjogJy9kb2NzJ1xuICAgIH0sXG4gICAgJ2RvY3Mua25vY2suYXBwJzoge1xuICAgICAgICBzaXRlbWFwVXJsOiAnaHR0cHM6Ly9kb2NzLmtub2NrLmFwcC9zaXRlbWFwLnhtbCcsXG4gICAgICAgIGRvY0ZpbHRlcjogJy8nXG4gICAgfVxufTtcblxuLyoqXG4gKiBOb3JtYWxpemUgZG9tYWluIHRvIG1hdGNoIGNvbmZpZ3VyYXRpb24ga2V5c1xuICogQ29udmVydHMgdXNlci1mcmllbmRseSBkb21haW5zIHRvIHRoZWlyIGNhbm9uaWNhbCBkb2N1bWVudGF0aW9uIGRvbWFpblxuICovXG5mdW5jdGlvbiBub3JtYWxpemVEb21haW4oZG9tYWluOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIC8vIFJlbW92ZSBwcm90b2NvbCBhbmQgdHJhaWxpbmcgc2xhc2hlc1xuICAgIGNvbnN0IGNsZWFuRG9tYWluID0gZG9tYWluLnJlcGxhY2UoL15odHRwcz86XFwvXFwvLywgJycpLnJlcGxhY2UoL1xcLyQvLCAnJyk7XG5cbiAgICAvLyBIYW5kbGUga25vY2suYXBwIC0+IGRvY3Mua25vY2suYXBwIGNvbnZlcnNpb25cbiAgICBpZiAoY2xlYW5Eb21haW4gPT09ICdrbm9jay5hcHAnKSB7XG4gICAgICAgIHJldHVybiAnZG9jcy5rbm9jay5hcHAnO1xuICAgIH1cblxuICAgIC8vIFJldHVybiBhcy1pcyBmb3Igb3RoZXIgZG9tYWluc1xuICAgIHJldHVybiBjbGVhbkRvbWFpbjtcbn1cblxuLyoqXG4gKiBGZXRjaCBzaXRlbWFwLnhtbCBhbmQgZXh0cmFjdCBVUkxzIC0gRW5oYW5jZWQgdG8gc3VwcG9ydCBtdWx0aXBsZSBkb21haW5zXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoU2l0ZW1hcChkb21haW46IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAvLyBHZXQgZG9tYWluLXNwZWNpZmljIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBjb25maWcgPSBET01BSU5fU0lURU1BUF9DT05GSUdbZG9tYWluXTtcblxuICAgIGlmICghY29uZmlnKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgTm8gc2l0ZW1hcCBjb25maWd1cmF0aW9uIGZvciBkb21haW46ICR7ZG9tYWlufSwgdXNpbmcgZGVmYXVsdGApO1xuICAgICAgICAvLyBEZWZhdWx0IGZhbGxiYWNrXG4gICAgICAgIGNvbnN0IGRlZmF1bHRTaXRlbWFwVXJsID0gYGh0dHBzOi8vJHtkb21haW59L3NpdGVtYXAueG1sYDtcbiAgICAgICAgY29uc29sZS5sb2coYEZldGNoaW5nIHNpdGVtYXAgZnJvbTogJHtkZWZhdWx0U2l0ZW1hcFVybH1gKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeG1sID0gYXdhaXQgbWFrZUh0dHBSZXF1ZXN0KGRlZmF1bHRTaXRlbWFwVXJsKTtcbiAgICAgICAgICAgIGNvbnN0IHVybE1hdGNoZXMgPSB4bWwubWF0Y2goLzxsb2M+KC4qPyk8XFwvbG9jPi9nKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IHVybHMgPSB1cmxNYXRjaGVzLm1hcChtYXRjaCA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdXJsID0gbWF0Y2gucmVwbGFjZSgvPFxcLz9sb2M+L2csICcnKTtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB1cmxPYmogPSBuZXcgVVJMKHVybCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB1cmxPYmoucGF0aG5hbWU7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB1cmw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gdXJscy5maWx0ZXIodXJsID0+IHVybC5pbmNsdWRlcygnL2RvY3MnKSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gZmV0Y2ggc2l0ZW1hcDonLCBlcnJvcik7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhgRmV0Y2hpbmcgc2l0ZW1hcCBmcm9tOiAke2NvbmZpZy5zaXRlbWFwVXJsfSAoZmlsdGVyaW5nIGZvcjogJHtjb25maWcuZG9jRmlsdGVyfSlgKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHhtbCA9IGF3YWl0IG1ha2VIdHRwUmVxdWVzdChjb25maWcuc2l0ZW1hcFVybCk7XG5cbiAgICAgICAgLy8gRXh0cmFjdCBVUkxzIGZyb20gc2l0ZW1hcCBYTUxcbiAgICAgICAgY29uc3QgdXJsTWF0Y2hlcyA9IHhtbC5tYXRjaCgvPGxvYz4oLio/KTxcXC9sb2M+L2cpIHx8IFtdO1xuICAgICAgICBjb25zdCB1cmxzID0gdXJsTWF0Y2hlcy5tYXAobWF0Y2ggPT4ge1xuICAgICAgICAgICAgY29uc3QgdXJsID0gbWF0Y2gucmVwbGFjZSgvPFxcLz9sb2M+L2csICcnKTtcbiAgICAgICAgICAgIC8vIENvbnZlcnQgZnVsbCBVUkwgdG8gcGF0aFxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCB1cmxPYmogPSBuZXcgVVJMKHVybCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHVybE9iai5wYXRobmFtZTtcbiAgICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgICAgIHJldHVybiB1cmw7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEZpbHRlciB0byBvbmx5IGRvY3VtZW50YXRpb24gcGFnZXNcbiAgICAgICAgY29uc3QgZG9jVXJscyA9IHVybHMuZmlsdGVyKHVybCA9PiB1cmwuc3RhcnRzV2l0aChjb25maWcuZG9jRmlsdGVyKSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2RvY1VybHMubGVuZ3RofSBkb2N1bWVudGF0aW9uIFVSTHMgZnJvbSAke3VybHMubGVuZ3RofSB0b3RhbCBVUkxzYCk7XG5cbiAgICAgICAgcmV0dXJuIGRvY1VybHM7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gZmV0Y2ggc2l0ZW1hcDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG59XG5cbi8qKlxuICogU2VhcmNoIHNpdGVtYXAgZm9yIHJlbGV2YW50IHBhZ2VzIGJhc2VkIG9uIGtleXdvcmRzXG4gKi9cbmZ1bmN0aW9uIHNlYXJjaFNpdGVtYXBGb3JSZWxldmFudFBhZ2VzKGtleXdvcmRzOiBzdHJpbmdbXSwgc2l0ZW1hcFVybHM6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHJlbGV2YW50UGFnZXM6IEFycmF5PHsgdXJsOiBzdHJpbmc7IHNjb3JlOiBudW1iZXIgfT4gPSBbXTtcblxuICAgIGZvciAoY29uc3QgdXJsIG9mIHNpdGVtYXBVcmxzKSB7XG4gICAgICAgIGNvbnN0IHVybExvd2VyID0gdXJsLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGxldCBzY29yZSA9IDA7XG5cbiAgICAgICAgLy8gU2NvcmUgYmFzZWQgb24ga2V5d29yZCBtYXRjaGVzXG4gICAgICAgIGZvciAoY29uc3Qga2V5d29yZCBvZiBrZXl3b3Jkcykge1xuICAgICAgICAgICAgaWYgKHVybExvd2VyLmluY2x1ZGVzKGtleXdvcmQpKSB7XG4gICAgICAgICAgICAgICAgc2NvcmUgKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEJvb3N0IHNjb3JlIGZvciAvZG9jcy8gcGFnZXNcbiAgICAgICAgaWYgKHVybExvd2VyLmluY2x1ZGVzKCcvZG9jcy8nKSkge1xuICAgICAgICAgICAgc2NvcmUgKz0gMC41O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHNjb3JlID4gMCkge1xuICAgICAgICAgICAgcmVsZXZhbnRQYWdlcy5wdXNoKHsgdXJsLCBzY29yZSB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNvcnQgYnkgc2NvcmUgYW5kIHJldHVybiB0b3AgNVxuICAgIHJlbGV2YW50UGFnZXMuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpO1xuICAgIGNvbnN0IHRvcFBhZ2VzID0gcmVsZXZhbnRQYWdlcy5zbGljZSgwLCA1KS5tYXAocCA9PiBwLnVybCk7XG5cbiAgICBjb25zb2xlLmxvZyhgRm91bmQgJHt0b3BQYWdlcy5sZW5ndGh9IHJlbGV2YW50IHBhZ2VzIGZyb20gc2l0ZW1hcDpgLCB0b3BQYWdlcyk7XG4gICAgcmV0dXJuIHRvcFBhZ2VzO1xufVxuXG4vKipcbiAqIEZldGNoIHBhZ2UgY29udGVudFxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFBhZ2VDb250ZW50KGRvbWFpbjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHVybCA9IGBodHRwczovLyR7ZG9tYWlufSR7cGF0aH1gO1xuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBwYWdlIGNvbnRlbnQgZnJvbTogJHt1cmx9YCk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgbWFrZUh0dHBSZXF1ZXN0KHVybCk7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBmZXRjaCBwYWdlICR7dXJsfTpgLCBlcnJvcik7XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG59XG5cbi8qKlxuICogRXh0cmFjdCBjb2RlIHNuaXBwZXRzIGZyb20gSFRNTCBwYWdlXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RDb2RlU25pcHBldHNGcm9tUGFnZShodG1sOiBzdHJpbmcpOiBBcnJheTx7IGNvZGU6IHN0cmluZzsgbGFuZ3VhZ2U/OiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHNuaXBwZXRzOiBBcnJheTx7IGNvZGU6IHN0cmluZzsgbGFuZ3VhZ2U/OiBzdHJpbmcgfT4gPSBbXTtcblxuICAgIC8vIE1hdGNoIDxwcmU+PGNvZGU+IGJsb2Nrc1xuICAgIGNvbnN0IHByZUNvZGVSZWdleCA9IC88cHJlW14+XSo+PGNvZGVbXj5dKmNsYXNzPVtcIiddP2xhbmd1YWdlLShcXHcrKVtcIiddP1tePl0qPihbXFxzXFxTXSo/KTxcXC9jb2RlPjxcXC9wcmU+L2dpO1xuICAgIGxldCBtYXRjaDtcblxuICAgIHdoaWxlICgobWF0Y2ggPSBwcmVDb2RlUmVnZXguZXhlYyhodG1sKSkgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgbGFuZ3VhZ2UgPSBtYXRjaFsxXTtcbiAgICAgICAgbGV0IGNvZGUgPSBtYXRjaFsyXTtcblxuICAgICAgICAvLyBEZWNvZGUgSFRNTCBlbnRpdGllc1xuICAgICAgICBjb2RlID0gY29kZVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZsdDsvZywgJzwnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZndDsvZywgJz4nKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZhbXA7L2csICcmJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mcXVvdDsvZywgJ1wiJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mIzM5Oy9nLCBcIidcIik7XG5cbiAgICAgICAgLy8gUmVtb3ZlIEhUTUwgdGFncyB0aGF0IG1pZ2h0IGJlIGluc2lkZVxuICAgICAgICBjb2RlID0gY29kZS5yZXBsYWNlKC88W14+XSs+L2csICcnKTtcblxuICAgICAgICBpZiAoY29kZS50cmltKCkubGVuZ3RoID4gMTApIHtcbiAgICAgICAgICAgIHNuaXBwZXRzLnB1c2goeyBjb2RlOiBjb2RlLnRyaW0oKSwgbGFuZ3VhZ2UgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBbHNvIHRyeSB0byBtYXRjaCBzaW1wbGUgPGNvZGU+IGJsb2Nrc1xuICAgIGlmIChzbmlwcGV0cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgY29uc3QgY29kZVJlZ2V4ID0gLzxjb2RlW14+XSo+KFtcXHNcXFNdKj8pPFxcL2NvZGU+L2dpO1xuICAgICAgICB3aGlsZSAoKG1hdGNoID0gY29kZVJlZ2V4LmV4ZWMoaHRtbCkpICE9PSBudWxsKSB7XG4gICAgICAgICAgICBsZXQgY29kZSA9IG1hdGNoWzFdO1xuICAgICAgICAgICAgY29kZSA9IGNvZGVcbiAgICAgICAgICAgICAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpXG4gICAgICAgICAgICAgICAgLnJlcGxhY2UoLyZndDsvZywgJz4nKVxuICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8mYW1wOy9nLCAnJicpXG4gICAgICAgICAgICAgICAgLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKVxuICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8mIzM5Oy9nLCBcIidcIilcbiAgICAgICAgICAgICAgICAucmVwbGFjZSgvPFtePl0rPi9nLCAnJyk7XG5cbiAgICAgICAgICAgIGlmIChjb2RlLnRyaW0oKS5sZW5ndGggPiA1MCkgeyAvLyBPbmx5IGxvbmdlciBjb2RlIGJsb2Nrc1xuICAgICAgICAgICAgICAgIHNuaXBwZXRzLnB1c2goeyBjb2RlOiBjb2RlLnRyaW0oKSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzbmlwcGV0cy5zbGljZSgwLCA1KTsgLy8gTGltaXQgdG8gNSBzbmlwcGV0cyB0byBhdm9pZCB0b2tlbiBsaW1pdHNcbn1cblxuLyoqXG4gKiBBbmFseXplIHBhZ2UgY29udGVudCBmb3IgcmVsZXZhbmNlIHRvIGlzc3VlXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVQYWdlQ29udGVudChjb250ZW50OiBzdHJpbmcsIGlzc3VlOiBEaXNjb3ZlcmVkSXNzdWUsIHBhZ2VVcmw6IHN0cmluZywgc2VtYW50aWNTY29yZT86IG51bWJlcik6IEV2aWRlbmNlIHtcbiAgICBjb25zdCBjb250ZW50TG93ZXIgPSBjb250ZW50LnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3Qga2V5d29yZHMgPSBleHRyYWN0S2V5d29yZHMoaXNzdWUpO1xuXG4gICAgLy8gRXh0cmFjdCBwYWdlIHRpdGxlXG4gICAgY29uc3QgdGl0bGVNYXRjaCA9IGNvbnRlbnQubWF0Y2goLzx0aXRsZT4oLio/KTxcXC90aXRsZT4vaSk7XG4gICAgY29uc3QgcGFnZVRpdGxlID0gdGl0bGVNYXRjaCA/IHRpdGxlTWF0Y2hbMV0gOiBwYWdlVXJsO1xuXG4gICAgLy8gQ2hlY2sgZm9yIGtleXdvcmQgbWF0Y2hlc1xuICAgIGNvbnN0IGtleXdvcmRNYXRjaGVzID0ga2V5d29yZHMuZmlsdGVyKGt3ID0+IGNvbnRlbnRMb3dlci5pbmNsdWRlcyhrdykpO1xuICAgIGNvbnN0IGhhc1JlbGV2YW50Q29udGVudCA9IGtleXdvcmRNYXRjaGVzLmxlbmd0aCA+PSAyOyAvLyBBdCBsZWFzdCAyIGtleXdvcmRzXG5cbiAgICAvLyBDb3VudCBjb2RlIGV4YW1wbGVzIChjb2RlIGJsb2NrcywgcHJlIHRhZ3MpXG4gICAgY29uc3QgY29kZUJsb2NrTWF0Y2hlcyA9IGNvbnRlbnQubWF0Y2goLzxjb2RlfDxwcmV8YGBgL2dpKSB8fCBbXTtcbiAgICBjb25zdCBjb2RlRXhhbXBsZXMgPSBjb2RlQmxvY2tNYXRjaGVzLmxlbmd0aDtcblxuICAgIC8vIENoZWNrIGZvciBwcm9kdWN0aW9uIGd1aWRhbmNlIGtleXdvcmRzXG4gICAgY29uc3QgcHJvZHVjdGlvbktleXdvcmRzID0gWydwcm9kdWN0aW9uJywgJ2RlcGxveScsICdlbnZpcm9ubWVudCcsICdjb25maWd1cmF0aW9uJywgJ3NldHVwJ107XG4gICAgY29uc3QgcHJvZHVjdGlvbkd1aWRhbmNlID0gcHJvZHVjdGlvbktleXdvcmRzLnNvbWUoa3cgPT4gY29udGVudExvd2VyLmluY2x1ZGVzKGt3KSk7XG5cbiAgICAvLyBJZGVudGlmeSBjb250ZW50IGdhcHNcbiAgICBjb25zdCBjb250ZW50R2Fwczogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmIChjb2RlRXhhbXBsZXMgPT09IDApIHtcbiAgICAgICAgY29udGVudEdhcHMucHVzaCgnTWlzc2luZyBjb2RlIGV4YW1wbGVzJyk7XG4gICAgfVxuXG4gICAgaWYgKCFwcm9kdWN0aW9uR3VpZGFuY2UgJiYgaXNzdWUuY2F0ZWdvcnkgPT09ICdkZXBsb3ltZW50Jykge1xuICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIHByb2R1Y3Rpb24gZGVwbG95bWVudCBndWlkYW5jZScpO1xuICAgIH1cblxuICAgIGlmICghY29udGVudExvd2VyLmluY2x1ZGVzKCdlcnJvcicpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ3Ryb3VibGVzaG9vdCcpKSB7XG4gICAgICAgIGNvbnRlbnRHYXBzLnB1c2goJ01pc3NpbmcgZXJyb3IgaGFuZGxpbmcgYW5kIHRyb3VibGVzaG9vdGluZyBzdGVwcycpO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGZvciBzcGVjaWZpYyBpc3N1ZS1yZWxhdGVkIGNvbnRlbnRcbiAgICBpZiAoaXNzdWUuY2F0ZWdvcnkgPT09ICdlbWFpbC1kZWxpdmVyeScpIHtcbiAgICAgICAgaWYgKCFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ3NwYW0nKSAmJiAhY29udGVudExvd2VyLmluY2x1ZGVzKCdkZWxpdmVyYWJpbGl0eScpKSB7XG4gICAgICAgICAgICBjb250ZW50R2Fwcy5wdXNoKCdNaXNzaW5nIHNwYW0vZGVsaXZlcmFiaWxpdHkgdHJvdWJsZXNob290aW5nJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2RucycpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ3NwZicpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ2RraW0nKSkge1xuICAgICAgICAgICAgY29udGVudEdhcHMucHVzaCgnTWlzc2luZyBETlMgY29uZmlndXJhdGlvbiBleGFtcGxlcycpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGlzc3VlLmNhdGVnb3J5ID09PSAnZGVwbG95bWVudCcpIHtcbiAgICAgICAgaWYgKCFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ3ZlcmNlbCcpICYmICFjb250ZW50TG93ZXIuaW5jbHVkZXMoJ25ldGxpZnknKSAmJiBpc3N1ZS50aXRsZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCd2ZXJjZWwnKSkge1xuICAgICAgICAgICAgY29udGVudEdhcHMucHVzaCgnTWlzc2luZyBwbGF0Zm9ybS1zcGVjaWZpYyBkZXBsb3ltZW50IGV4YW1wbGVzIChWZXJjZWwvTmV0bGlmeSknKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNvbnRlbnRMb3dlci5pbmNsdWRlcygnZW52aXJvbm1lbnQgdmFyaWFibGUnKSAmJiAhY29udGVudExvd2VyLmluY2x1ZGVzKCdlbnYnKSkge1xuICAgICAgICAgICAgY29udGVudEdhcHMucHVzaCgnTWlzc2luZyBlbnZpcm9ubWVudCB2YXJpYWJsZSBjb25maWd1cmF0aW9uJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBwYWdlVXJsLFxuICAgICAgICBwYWdlVGl0bGUsXG4gICAgICAgIGhhc1JlbGV2YW50Q29udGVudCxcbiAgICAgICAgY29udGVudEdhcHMsXG4gICAgICAgIGNvZGVFeGFtcGxlcyxcbiAgICAgICAgcHJvZHVjdGlvbkd1aWRhbmNlLFxuICAgICAgICBzZW1hbnRpY1Njb3JlXG4gICAgfTtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZSBhIHNpbmdsZSBpc3N1ZSBhZ2FpbnN0IGRvY3VtZW50YXRpb25cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdmFsaWRhdGVJc3N1ZShpc3N1ZTogRGlzY292ZXJlZElzc3VlLCBkb21haW46IHN0cmluZyk6IFByb21pc2U8VmFsaWRhdGlvblJlc3VsdD4ge1xuICAgIGNvbnNvbGUubG9nKGBcXG49PT0gVmFsaWRhdGluZyBpc3N1ZTogJHtpc3N1ZS50aXRsZX0gPT09YCk7XG5cbiAgICBsZXQgcGFnZXNUb0NoZWNrOiBBcnJheTx7IHVybDogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyBzaW1pbGFyaXR5PzogbnVtYmVyIH0+ID0gW107XG4gICAgbGV0IHVzZWRTaXRlbWFwRmFsbGJhY2sgPSBmYWxzZTtcblxuICAgIC8vIFN0ZXAgMTogVHJ5IHByZS1jdXJhdGVkIHBhZ2VzIGZpcnN0XG4gICAgaWYgKGlzc3VlLnJlbGF0ZWRQYWdlcyAmJiBpc3N1ZS5yZWxhdGVkUGFnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYWdlc1RvQ2hlY2sgPSBpc3N1ZS5yZWxhdGVkUGFnZXMubWFwKHVybCA9PiAoeyB1cmwsIHRpdGxlOiB1cmwgfSkpO1xuICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgcHJlLWN1cmF0ZWQgcGFnZXM6YCwgcGFnZXNUb0NoZWNrLm1hcChwID0+IHAudXJsKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU3RlcCAyOiBVc2Ugc2VtYW50aWMgc2VhcmNoIGZvciBiZXR0ZXIgcmVsZXZhbmNlXG4gICAgICAgIGNvbnNvbGUubG9nKGBObyBwcmUtY3VyYXRlZCBwYWdlcywgdXNpbmcgc2VtYW50aWMgc2VhcmNoYCk7XG4gICAgICAgIHVzZWRTaXRlbWFwRmFsbGJhY2sgPSB0cnVlO1xuXG4gICAgICAgIGNvbnN0IHNlbWFudGljUmVzdWx0cyA9IGF3YWl0IHNlYXJjaFNpdGVtYXBTZW1hbnRpY2x5T3B0aW1pemVkKGlzc3VlLCBkb21haW4pO1xuICAgICAgICBwYWdlc1RvQ2hlY2sgPSBzZW1hbnRpY1Jlc3VsdHM7XG5cbiAgICAgICAgLy8gRmFsbGJhY2sgdG8ga2V5d29yZCBzZWFyY2ggaWYgc2VtYW50aWMgc2VhcmNoIGZhaWxzXG4gICAgICAgIGlmIChwYWdlc1RvQ2hlY2subGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VtYW50aWMgc2VhcmNoIGZhaWxlZCwgZmFsbGluZyBiYWNrIHRvIGtleXdvcmQgc2VhcmNoYCk7XG4gICAgICAgICAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgZmV0Y2hTaXRlbWFwKGRvbWFpbik7XG4gICAgICAgICAgICBpZiAoc2l0ZW1hcC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyIHRvIG9ubHkgaW5jbHVkZSBkb2NzIHBhZ2VzIHRvIGF2b2lkIGlycmVsZXZhbnQgcmVzdWx0c1xuICAgICAgICAgICAgICAgIGNvbnN0IGRvY1BhZ2VzID0gc2l0ZW1hcC5maWx0ZXIodXJsID0+IHVybC5zdGFydHNXaXRoKCcvZG9jcy8nKSk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIHRvICR7ZG9jUGFnZXMubGVuZ3RofSBkb2NzIHBhZ2VzIGZyb20gJHtzaXRlbWFwLmxlbmd0aH0gdG90YWwgcGFnZXNgKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGtleXdvcmRzID0gZXh0cmFjdEtleXdvcmRzKGlzc3VlKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgRXh0cmFjdGVkIGtleXdvcmRzOmAsIGtleXdvcmRzKTtcbiAgICAgICAgICAgICAgICBjb25zdCBrZXl3b3JkUGFnZXMgPSBzZWFyY2hTaXRlbWFwRm9yUmVsZXZhbnRQYWdlcyhrZXl3b3JkcywgZG9jUGFnZXMpO1xuICAgICAgICAgICAgICAgIHBhZ2VzVG9DaGVjayA9IGtleXdvcmRQYWdlcy5tYXAodXJsID0+ICh7IHVybCwgdGl0bGU6IHVybCB9KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdGVwIDM6IFZhbGlkYXRlIGVhY2ggcGFnZVxuICAgIGNvbnN0IGV2aWRlbmNlOiBFdmlkZW5jZVtdID0gW107XG4gICAgY29uc3QgcG90ZW50aWFsR2FwczogR2FwQW5hbHlzaXNbXSA9IFtdO1xuICAgIGNvbnN0IGNyaXRpY2FsR2Fwczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBtaXNzaW5nRWxlbWVudHM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAocGFnZXNUb0NoZWNrLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBDcml0aWNhbCBnYXA6IE5vIHJlbGV2YW50IHBhZ2VzIGZvdW5kXG4gICAgICAgIGNvbnNvbGUubG9nKGDinYwgQ1JJVElDQUwgR0FQOiBObyByZWxldmFudCBwYWdlcyBmb3VuZCBmb3IgaXNzdWVgKTtcblxuICAgICAgICBjcml0aWNhbEdhcHMucHVzaChgTm8gZG9jdW1lbnRhdGlvbiBwYWdlIGZvdW5kIGFkZHJlc3NpbmcgXCIke2lzc3VlLnRpdGxlfVwiYCk7XG5cbiAgICAgICAgcG90ZW50aWFsR2Fwcy5wdXNoKHtcbiAgICAgICAgICAgIGdhcFR5cGU6ICdjcml0aWNhbC1nYXAnLFxuICAgICAgICAgICAgbWlzc2luZ0NvbnRlbnQ6IFtcbiAgICAgICAgICAgICAgICAnQ29tcGxldGUgZG9jdW1lbnRhdGlvbiBwYWdlIG1pc3NpbmcnLFxuICAgICAgICAgICAgICAgICdDb2RlIGV4YW1wbGVzIG5lZWRlZCcsXG4gICAgICAgICAgICAgICAgJ1Ryb3VibGVzaG9vdGluZyBndWlkZSBuZWVkZWQnLFxuICAgICAgICAgICAgICAgICdQcm9kdWN0aW9uIGRlcGxveW1lbnQgZ3VpZGFuY2UgbmVlZGVkJ1xuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlYXNvbmluZzogYFNlYXJjaGVkIHNpdGVtYXAueG1sIGJ1dCBmb3VuZCBubyBwYWdlcyBtYXRjaGluZyBrZXl3b3JkczogJHtleHRyYWN0S2V5d29yZHMoaXNzdWUpLmpvaW4oJywgJyl9YCxcbiAgICAgICAgICAgIGRldmVsb3BlckltcGFjdDogYCR7aXNzdWUuZnJlcXVlbmN5fSBkZXZlbG9wZXJzIGFmZmVjdGVkIC0gcmVwb3J0aW5nIHRoaXMgaXNzdWUgc2luY2UgJHtpc3N1ZS5sYXN0U2Vlbn1gXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpc3N1ZUlkOiBpc3N1ZS5pZCxcbiAgICAgICAgICAgIGlzc3VlVGl0bGU6IGlzc3VlLnRpdGxlLFxuICAgICAgICAgICAgc3RhdHVzOiAnY3JpdGljYWwtZ2FwJyxcbiAgICAgICAgICAgIGV2aWRlbmNlLFxuICAgICAgICAgICAgbWlzc2luZ0VsZW1lbnRzOiBbJ0NvbXBsZXRlIGRvY3VtZW50YXRpb24gcGFnZSddLFxuICAgICAgICAgICAgcG90ZW50aWFsR2FwcyxcbiAgICAgICAgICAgIGNyaXRpY2FsR2FwcyxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6IDk1LFxuICAgICAgICAgICAgcmVjb21tZW5kYXRpb25zOiBbXG4gICAgICAgICAgICAgICAgYENyZWF0ZSBuZXcgZG9jdW1lbnRhdGlvbiBwYWdlIGFkZHJlc3Npbmc6ICR7aXNzdWUudGl0bGV9YCxcbiAgICAgICAgICAgICAgICBgSW5jbHVkZSBjb2RlIGV4YW1wbGVzIGZvciAke2lzc3VlLmNhdGVnb3J5fWAsXG4gICAgICAgICAgICAgICAgYEFkZCB0cm91Ymxlc2hvb3Rpbmcgc2VjdGlvbmAsXG4gICAgICAgICAgICAgICAgYFJlZmVyZW5jZTogJHtpc3N1ZS5zb3VyY2VzWzBdfWBcbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBGZXRjaCBhbmQgYW5hbHl6ZSBlYWNoIHBhZ2VcbiAgICBmb3IgKGNvbnN0IHBhZ2Ugb2YgcGFnZXNUb0NoZWNrKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmZXRjaFBhZ2VDb250ZW50KGRvbWFpbiwgcGFnZS51cmwpO1xuXG4gICAgICAgIGlmICghY29udGVudCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyBGYWlsZWQgdG8gZmV0Y2ggcGFnZTogJHtwYWdlLnVybH1gKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGFnZUV2aWRlbmNlID0gYW5hbHl6ZVBhZ2VDb250ZW50KGNvbnRlbnQsIGlzc3VlLCBwYWdlLnVybCwgcGFnZS5zaW1pbGFyaXR5KTtcbiAgICAgICAgZXZpZGVuY2UucHVzaChwYWdlRXZpZGVuY2UpO1xuXG4gICAgICAgIC8vIENvbnRlbnQgZ2FwcyBhcmUgYWxyZWFkeSBzaG93biBpbiB0aGUgRXZpZGVuY2Ugc2VjdGlvbiwgbm8gbmVlZCB0byBkdXBsaWNhdGVcbiAgICAgICAgLy8gaWYgKCFwYWdlRXZpZGVuY2UuaGFzUmVsZXZhbnRDb250ZW50IHx8IHBhZ2VFdmlkZW5jZS5jb250ZW50R2Fwcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vICAgICBjb25zb2xlLmxvZyhg4pqg77iPIFBPVEVOVElBTCBHQVA6ICR7cGFnZS51cmx9IGV4aXN0cyBidXQgbWlzc2luZyBjb250ZW50YCk7XG5cbiAgICAgICAgLy8gICAgIHBvdGVudGlhbEdhcHMucHVzaCh7XG4gICAgICAgIC8vICAgICAgICAgZ2FwVHlwZTogJ3BvdGVudGlhbC1nYXAnLFxuICAgICAgICAvLyAgICAgICAgIHBhZ2VVcmw6IHBhZ2UudXJsLFxuICAgICAgICAvLyAgICAgICAgIHBhZ2VUaXRsZTogcGFnZUV2aWRlbmNlLnBhZ2VUaXRsZSxcbiAgICAgICAgLy8gICAgICAgICBtaXNzaW5nQ29udGVudDogcGFnZUV2aWRlbmNlLmNvbnRlbnRHYXBzLFxuICAgICAgICAvLyAgICAgICAgIHJlYXNvbmluZzogYFJpY2ggY29udGVudCBhbmFseXNpcyBzdWdnZXN0cyByZWxldmFuY2UgdG8gXCIke2lzc3VlLnRpdGxlfVwiIGJ1dCBsYWNrcyBzcGVjaWZpYyBjb250ZW50YCxcbiAgICAgICAgLy8gICAgICAgICBkZXZlbG9wZXJJbXBhY3Q6IGBEZXZlbG9wZXJzIHNlYXJjaGluZyBmb3IgXCIke2lzc3VlLnRpdGxlfVwiIHdvdWxkIGZpbmQgdGhpcyBwYWdlIGJ1dCBub3QgZ2V0IGNvbXBsZXRlIHNvbHV0aW9uYFxuICAgICAgICAvLyAgICAgfSk7XG4gICAgICAgIC8vIH1cblxuICAgICAgICBtaXNzaW5nRWxlbWVudHMucHVzaCguLi5wYWdlRXZpZGVuY2UuY29udGVudEdhcHMpO1xuICAgIH1cblxuICAgIC8vIERldGVybWluZSBvdmVyYWxsIHN0YXR1c1xuICAgIC8vIEJlIGNvbnNlcnZhdGl2ZTogRG9uJ3QgbWFyayBhcyBcInJlc29sdmVkXCIgdW5sZXNzIHdlJ3JlIHZlcnkgY29uZmlkZW50XG4gICAgLy8gdGhlIGRvY3VtZW50YXRpb24gYWRkcmVzc2VzIHRoZSBDT1JFIHByb2JsZW0sIG5vdCBqdXN0IG1lbnRpb25zIHJlbGF0ZWQga2V5d29yZHNcblxuICAgIC8vIERlYnVnIGxvZ2dpbmdcbiAgICBjb25zb2xlLmxvZyhgXFxuPT09IFN0YXR1cyBEZXRlcm1pbmF0aW9uIERlYnVnID09PWApO1xuICAgIGV2aWRlbmNlLmZvckVhY2goKGUsIGlkeCkgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZyhgRXZpZGVuY2UgJHtpZHggKyAxfTogJHtlLnBhZ2VVcmx9YCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGAgIC0gaGFzUmVsZXZhbnRDb250ZW50OiAke2UuaGFzUmVsZXZhbnRDb250ZW50fWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgICAtIGNvbnRlbnRHYXBzLmxlbmd0aDogJHtlLmNvbnRlbnRHYXBzLmxlbmd0aH1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYCAgLSBjb250ZW50R2FwczogJHtKU09OLnN0cmluZ2lmeShlLmNvbnRlbnRHYXBzKX1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYCAgLSBzZW1hbnRpY1Njb3JlOiAke2Uuc2VtYW50aWNTY29yZX1gKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGhhc0NvbXBsZXRlQ29udGVudCA9IGV2aWRlbmNlLnNvbWUoZSA9PlxuICAgICAgICBlLmhhc1JlbGV2YW50Q29udGVudCAmJlxuICAgICAgICBlLmNvbnRlbnRHYXBzLmxlbmd0aCA9PT0gMCAmJlxuICAgICAgICBlLnNlbWFudGljU2NvcmUgJiYgZS5zZW1hbnRpY1Njb3JlID4gMC44NSAvLyBIaWdoIGNvbmZpZGVuY2UgdGhyZXNob2xkXG4gICAgKTtcbiAgICBjb25zdCBoYXNTb21lQ29udGVudCA9IGV2aWRlbmNlLnNvbWUoZSA9PiBlLmhhc1JlbGV2YW50Q29udGVudCk7XG5cbiAgICBjb25zb2xlLmxvZyhgaGFzQ29tcGxldGVDb250ZW50OiAke2hhc0NvbXBsZXRlQ29udGVudH1gKTtcbiAgICBjb25zb2xlLmxvZyhgaGFzU29tZUNvbnRlbnQ6ICR7aGFzU29tZUNvbnRlbnR9YCk7XG5cbiAgICBsZXQgc3RhdHVzOiBWYWxpZGF0aW9uUmVzdWx0WydzdGF0dXMnXTtcbiAgICBsZXQgY29uZmlkZW5jZTogbnVtYmVyO1xuXG4gICAgaWYgKGhhc0NvbXBsZXRlQ29udGVudCkge1xuICAgICAgICBzdGF0dXMgPSAncmVzb2x2ZWQnO1xuICAgICAgICBjb25maWRlbmNlID0gOTA7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgUkVTT0xWRUQ6IElzc3VlIGFwcGVhcnMgdG8gYmUgYWRkcmVzc2VkIGluIGRvY3VtZW50YXRpb24gKGhpZ2ggY29uZmlkZW5jZSlgKTtcbiAgICB9IGVsc2UgaWYgKGV2aWRlbmNlLnNvbWUoZSA9PiBlLnNlbWFudGljU2NvcmUgJiYgZS5zZW1hbnRpY1Njb3JlID4gMC42KSkge1xuICAgICAgICAvLyBHb29kIHNlbWFudGljIG1hdGNoIGJ1dCBub3QgcGVyZmVjdCAtIGxpa2VseSBhIHBvdGVudGlhbCBnYXBcbiAgICAgICAgc3RhdHVzID0gJ3BvdGVudGlhbC1nYXAnO1xuICAgICAgICBjb25maWRlbmNlID0gNzU7XG4gICAgICAgIGNvbnNvbGUubG9nKGDimqDvuI8gUE9URU5USUFMIEdBUDogUmVsZXZhbnQgcGFnZXMgZXhpc3QgYnV0IG1heSBub3QgZnVsbHkgYWRkcmVzcyB0aGUgaXNzdWVgKTtcbiAgICB9IGVsc2UgaWYgKGhhc1NvbWVDb250ZW50KSB7XG4gICAgICAgIHN0YXR1cyA9ICdjb25maXJtZWQnO1xuICAgICAgICBjb25maWRlbmNlID0gNzA7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinYwgQ09ORklSTUVEOiBJc3N1ZSBleGlzdHMsIGRvY3VtZW50YXRpb24gaXMgaW5jb21wbGV0ZWApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YXR1cyA9ICdjcml0aWNhbC1nYXAnO1xuICAgICAgICBjb25maWRlbmNlID0gODU7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinYwgQ1JJVElDQUwgR0FQOiBObyByZWxldmFudCBjb250ZW50IGZvdW5kYCk7XG4gICAgfVxuXG4gICAgLy8gR2VuZXJhdGUgZGV0YWlsZWQgcmVjb21tZW5kYXRpb25zIHVzaW5nIEFJIGFuYWx5c2lzIChmb3IgYWxsIHN0YXR1c2VzKVxuICAgIGNvbnN0IHJlY29tbWVuZGF0aW9ucyA9IGF3YWl0IGdlbmVyYXRlRGV0YWlsZWRSZWNvbW1lbmRhdGlvbnMoaXNzdWUsIGV2aWRlbmNlLCBzdGF0dXMsIGRvbWFpbik7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBpc3N1ZUlkOiBpc3N1ZS5pZCxcbiAgICAgICAgaXNzdWVUaXRsZTogaXNzdWUudGl0bGUsXG4gICAgICAgIHN0YXR1cyxcbiAgICAgICAgZXZpZGVuY2UsXG4gICAgICAgIG1pc3NpbmdFbGVtZW50czogWy4uLm5ldyBTZXQobWlzc2luZ0VsZW1lbnRzKV0sXG4gICAgICAgIHBvdGVudGlhbEdhcHMsXG4gICAgICAgIGNyaXRpY2FsR2FwcyxcbiAgICAgICAgY29uZmlkZW5jZSxcbiAgICAgICAgcmVjb21tZW5kYXRpb25zXG4gICAgfTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBkZXRhaWxlZCwgYWN0aW9uYWJsZSByZWNvbW1lbmRhdGlvbnMgdXNpbmcgQUkgYW5hbHlzaXNcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVEZXRhaWxlZFJlY29tbWVuZGF0aW9ucyhcbiAgICBpc3N1ZTogRGlzY292ZXJlZElzc3VlLFxuICAgIGV2aWRlbmNlOiBFdmlkZW5jZVtdLFxuICAgIHN0YXR1czogc3RyaW5nLFxuICAgIGRvbWFpbjogc3RyaW5nXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gR2V0IHRoZSBiZXN0IG1hdGNoaW5nIHBhZ2UgKGhpZ2hlc3Qgc2VtYW50aWMgc2NvcmUpXG4gICAgICAgIGNvbnN0IGJlc3RNYXRjaCA9IGV2aWRlbmNlLnJlZHVjZSgoYmVzdCwgY3VycmVudCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYmVzdFNjb3JlID0gYmVzdC5zZW1hbnRpY1Njb3JlIHx8IDA7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50U2NvcmUgPSBjdXJyZW50LnNlbWFudGljU2NvcmUgfHwgMDtcbiAgICAgICAgICAgIHJldHVybiBjdXJyZW50U2NvcmUgPiBiZXN0U2NvcmUgPyBjdXJyZW50IDogYmVzdDtcbiAgICAgICAgfSwgZXZpZGVuY2VbMF0pO1xuXG4gICAgICAgIGlmICghYmVzdE1hdGNoIHx8ICFiZXN0TWF0Y2guc2VtYW50aWNTY29yZSB8fCBiZXN0TWF0Y2guc2VtYW50aWNTY29yZSA8IDAuNSkge1xuICAgICAgICAgICAgLy8gTm8gZ29vZCBtYXRjaCwgcmV0dXJuIGdlbmVyaWMgcmVjb21tZW5kYXRpb25zXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4p2MIE5vIGdvb2Qgc2VtYW50aWMgbWF0Y2ggZm91bmQuIGJlc3RNYXRjaDogJHshIWJlc3RNYXRjaH0sIHNlbWFudGljU2NvcmU6ICR7YmVzdE1hdGNoPy5zZW1hbnRpY1Njb3JlfWApO1xuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICBgQ3JlYXRlIG5ldyBkb2N1bWVudGF0aW9uIHBhZ2UgYWRkcmVzc2luZzogJHtpc3N1ZS50aXRsZX1gLFxuICAgICAgICAgICAgICAgIGBJbmNsdWRlIGNvZGUgZXhhbXBsZXMgZm9yICR7aXNzdWUuY2F0ZWdvcnl9YCxcbiAgICAgICAgICAgICAgICBgQWRkIHRyb3VibGVzaG9vdGluZyBzZWN0aW9uIGZvciBjb21tb24gZXJyb3JzYCxcbiAgICAgICAgICAgICAgICBgUmVmZXJlbmNlOiAke2lzc3VlLnNvdXJjZXNbMF19YFxuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZvciByZXNvbHZlZCBpc3N1ZXMsIHN0aWxsIGdlbmVyYXRlIHJlY29tbWVuZGF0aW9ucyBmb3IgaW1wcm92ZW1lbnRzXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SNIEdlbmVyYXRpbmcgcmVjb21tZW5kYXRpb25zIGZvciBpc3N1ZTogJHtpc3N1ZS5pZH0gKHN0YXR1czogJHtzdGF0dXN9KWApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBCZXN0IG1hdGNoOiAke2Jlc3RNYXRjaC5wYWdlVXJsfSAoc2NvcmU6ICR7YmVzdE1hdGNoLnNlbWFudGljU2NvcmV9KWApO1xuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFByb2NlZWRpbmcgd2l0aCBBSSByZWNvbW1lbmRhdGlvbiBnZW5lcmF0aW9uLi4uYCk7XG5cbiAgICAgICAgLy8gQ1JJVElDQUw6IEZldGNoIHRoZSBBQ1RVQUwgcGFnZSBjb250ZW50IHRvIGFuYWx5emUgZXhpc3RpbmcgY29kZVxuICAgICAgICBjb25zb2xlLmxvZyhg8J+ThCBGZXRjaGluZyBhY3R1YWwgcGFnZSBjb250ZW50IGZyb206ICR7ZG9tYWlufSR7YmVzdE1hdGNoLnBhZ2VVcmx9YCk7XG4gICAgICAgIGNvbnN0IHBhZ2VDb250ZW50ID0gYXdhaXQgZmV0Y2hQYWdlQ29udGVudChkb21haW4sIGJlc3RNYXRjaC5wYWdlVXJsKTtcblxuICAgICAgICBpZiAoIXBhZ2VDb250ZW50KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4p2MIEZhaWxlZCB0byBmZXRjaCBwYWdlIGNvbnRlbnQsIGZhbGxpbmcgYmFjayB0byBnZW5lcmljIHJlY29tbWVuZGF0aW9uc2ApO1xuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICBgVXBkYXRlICR7YmVzdE1hdGNoLnBhZ2VVcmx9IHRvIGFkZHJlc3M6ICR7aXNzdWUudGl0bGV9YCxcbiAgICAgICAgICAgICAgICBgQWRkIGNvZGUgZXhhbXBsZXMgZm9yICR7aXNzdWUuY2F0ZWdvcnl9YCxcbiAgICAgICAgICAgICAgICBgSW5jbHVkZSB0cm91Ymxlc2hvb3Rpbmcgc2VjdGlvbiBmb3IgY29tbW9uIGVycm9yc2AsXG4gICAgICAgICAgICAgICAgYFJlZmVyZW5jZTogJHtpc3N1ZS5zb3VyY2VzWzBdfWBcbiAgICAgICAgICAgIF07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBFeHRyYWN0IGNvZGUgc25pcHBldHMgZnJvbSB0aGUgcGFnZVxuICAgICAgICBjb25zdCBjb2RlU25pcHBldHMgPSBleHRyYWN0Q29kZVNuaXBwZXRzRnJvbVBhZ2UocGFnZUNvbnRlbnQpO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TnSBFeHRyYWN0ZWQgJHtjb2RlU25pcHBldHMubGVuZ3RofSBjb2RlIHNuaXBwZXRzIGZyb20gZG9jdW1lbnRhdGlvbiBwYWdlYCk7XG5cbiAgICAgICAgLy8gQnVpbGQgY29udGV4dCBmb3IgQUkgYW5hbHlzaXNcbiAgICAgICAgY29uc3QgaXNzdWVDb250ZXh0ID0gYFxuSXNzdWUgVGl0bGU6ICR7aXNzdWUudGl0bGV9XG5DYXRlZ29yeTogJHtpc3N1ZS5jYXRlZ29yeX1cbkRlc2NyaXB0aW9uOiAke2lzc3VlLmRlc2NyaXB0aW9ufVxuRXJyb3IgTWVzc2FnZXM6ICR7aXNzdWUuZXJyb3JNZXNzYWdlcz8uam9pbignLCAnKSB8fCAnTm9uZSd9XG5UYWdzOiAke2lzc3VlLnRhZ3M/LmpvaW4oJywgJykgfHwgJ05vbmUnfVxuQ29kZSBTbmlwcGV0cyBmcm9tIERldmVsb3BlciBJc3N1ZTogJHtpc3N1ZS5jb2RlU25pcHBldHM/Lmxlbmd0aCB8fCAwfSBzbmlwcGV0cyBmb3VuZFxuJHtpc3N1ZS5jb2RlU25pcHBldHMgPyBpc3N1ZS5jb2RlU25pcHBldHMubWFwKChzbmlwcGV0LCBpKSA9PiBgXFxuU25pcHBldCAke2kgKyAxfTpcXG5cXGBcXGBcXGBcXG4ke3NuaXBwZXR9XFxuXFxgXFxgXFxgYCkuam9pbignXFxuJykgOiAnJ31cbkZ1bGwgQ29udGVudCBQcmV2aWV3OiAke2lzc3VlLmZ1bGxDb250ZW50Py5zdWJzdHJpbmcoMCwgMTAwMCkgfHwgJ05vdCBhdmFpbGFibGUnfVxuU291cmNlOiAke2lzc3VlLnNvdXJjZXNbMF19XG5gLnRyaW0oKTtcblxuICAgICAgICBjb25zdCBkb2NDb250ZXh0ID0gYFxuUGFnZSBVUkw6ICR7YmVzdE1hdGNoLnBhZ2VVcmx9XG5QYWdlIFRpdGxlOiAke2Jlc3RNYXRjaC5wYWdlVGl0bGV9XG5TZW1hbnRpYyBNYXRjaCBTY29yZTogJHsoYmVzdE1hdGNoLnNlbWFudGljU2NvcmUgKiAxMDApLnRvRml4ZWQoMSl9JVxuSGFzIENvZGUgRXhhbXBsZXM6ICR7YmVzdE1hdGNoLmNvZGVFeGFtcGxlcyA+IDAgPyAnWWVzJyA6ICdObyd9XG5IYXMgUHJvZHVjdGlvbiBHdWlkYW5jZTogJHtiZXN0TWF0Y2gucHJvZHVjdGlvbkd1aWRhbmNlID8gJ1llcycgOiAnTm8nfVxuQ29udGVudCBHYXBzOiAke2Jlc3RNYXRjaC5jb250ZW50R2Fwcy5qb2luKCcsICcpfVxuXG5FWElTVElORyBDT0RFIE9OIERPQ1VNRU5UQVRJT04gUEFHRTpcbiR7Y29kZVNuaXBwZXRzLmxlbmd0aCA+IDAgPyBjb2RlU25pcHBldHMubWFwKChzbmlwcGV0LCBpKSA9PiBgXFxuQ29kZSBFeGFtcGxlICR7aSArIDF9OlxcblxcYFxcYFxcYCR7c25pcHBldC5sYW5ndWFnZSB8fCAndHlwZXNjcmlwdCd9XFxuJHtzbmlwcGV0LmNvZGV9XFxuXFxgXFxgXFxgYCkuam9pbignXFxuJykgOiAnTm8gY29kZSBleGFtcGxlcyBmb3VuZCBvbiBwYWdlJ31cbmAudHJpbSgpO1xuXG4gICAgICAgIGNvbnN0IHByb21wdCA9IGBZb3UgYXJlIGEgdGVjaG5pY2FsIGRvY3VtZW50YXRpb24gZXhwZXJ0IGFuYWx5emluZyBhIGRldmVsb3BlciBpc3N1ZS5cblxuREVWRUxPUEVSIElTU1VFOlxuLSBUaXRsZTogJHtpc3N1ZS50aXRsZX1cbi0gRGVzY3JpcHRpb246ICR7aXNzdWUuZGVzY3JpcHRpb259XG4tIEVycm9yOiAke2lzc3VlLmVycm9yTWVzc2FnZXM/LlswXSB8fCAnTi9BJ31cbi0gU291cmNlOiAke2lzc3VlLnNvdXJjZXNbMF19XG5cbkRPQ1VNRU5UQVRJT04gUEFHRTogJHtiZXN0TWF0Y2gucGFnZVVybH1cbkVYSVNUSU5HIENPREUgT04gUEFHRTpcbiR7Y29kZVNuaXBwZXRzLmxlbmd0aCA+IDAgPyBjb2RlU25pcHBldHMuc2xpY2UoMCwgMikubWFwKChzLCBpKSA9PiBgRXhhbXBsZSAke2kgKyAxfTpcXG5cXGBcXGBcXGAke3MubGFuZ3VhZ2UgfHwgJ3R5cGVzY3JpcHQnfVxcbiR7cy5jb2RlLnN1YnN0cmluZygwLCA1MDApfVxcblxcYFxcYFxcYGApLmpvaW4oJ1xcblxcbicpIDogJ05vIGNvZGUgZXhhbXBsZXMgZm91bmQnfVxuXG5ZT1VSIFRBU0s6IEdlbmVyYXRlIFRXTyBkZXRhaWxlZCByZWNvbW1lbmRhdGlvbnMgd2l0aCBDT01QTEVURSBjb2RlIGV4YW1wbGVzLlxuXG5DUklUSUNBTCBSRVFVSVJFTUVOVFM6XG4xLiBFYWNoIHJlY29tbWVuZGF0aW9uIE1VU1QgaW5jbHVkZSBhIENPTVBMRVRFIGNvZGUgYmxvY2sgKDQwLTYwIGxpbmVzIG1pbmltdW0pXG4yLiBDb2RlIG11c3QgYmUgQ09QWS1QQVNURSBSRUFEWSAtIG5vIHBsYWNlaG9sZGVycywgbm8gXCIvLyAuLi4gcmVzdCBvZiBjb2RlXCJcbjMuIEluY2x1ZGUgQUxMIGltcG9ydHMsIEFMTCBlcnJvciBoYW5kbGluZywgQUxMIGVkZ2UgY2FzZXNcbjQuIFNob3cgQkVGT1JFIChleGlzdGluZyBkb2MgY29kZSkgYW5kIEFGVEVSIChpbXByb3ZlZCBjb2RlKSBjb21wYXJpc29uXG5cbk9VVFBVVCBGT1JNQVQgKGZvbGxvdyBleGFjdGx5KTpcblxuIyMgUmVjb21tZW5kYXRpb24gMTogW0Rlc2NyaXB0aXZlIFRpdGxlXVxuXG4qKlByb2JsZW06KiogWzItMyBzZW50ZW5jZXMgZXhwbGFpbmluZyB3aGF0J3MgbWlzc2luZyBpbiBjdXJyZW50IGRvY3NdXG5cbioqQ3VycmVudCBEb2N1bWVudGF0aW9uIENvZGUgKEJFRk9SRSk6KipcblxcYFxcYFxcYHR5cGVzY3JpcHRcbi8vIFNob3cgdGhlIGV4aXN0aW5nIGNvZGUgZnJvbSBkb2N1bWVudGF0aW9uIHRoYXQgbmVlZHMgaW1wcm92ZW1lbnRcblxcYFxcYFxcYFxuXG4qKkltcHJvdmVkIENvZGUgKEFGVEVSKSAtIEFkZCB0aGlzIHRvIGRvY3VtZW50YXRpb246KipcblxcYFxcYFxcYHR5cGVzY3JpcHRcbi8vIENPTVBMRVRFIDQwLTYwIGxpbmUgY29kZSBleGFtcGxlIGhlcmVcbi8vIEluY2x1ZGU6ICd1c2Ugc2VydmVyJyBkaXJlY3RpdmUsIGFsbCBpbXBvcnRzLCB0eXBlIGRlZmluaXRpb25zXG4vLyBJbmNsdWRlOiBpbnB1dCB2YWxpZGF0aW9uLCBlbnZpcm9ubWVudCBjaGVja3Ncbi8vIEluY2x1ZGU6IHRyeS9jYXRjaCB3aXRoIHNwZWNpZmljIGVycm9yIG1lc3NhZ2VzXG4vLyBJbmNsdWRlOiBzdWNjZXNzL2Vycm9yIHJldHVybiB0eXBlc1xuLy8gSW5jbHVkZTogaGVscGZ1bCBjb21tZW50cyBleHBsYWluaW5nIGVhY2ggc2VjdGlvblxuXFxgXFxgXFxgXG5cbioqV2h5IFRoaXMgSGVscHMgRGV2ZWxvcGVyczoqKiBbMi0zIHNlbnRlbmNlc11cblxuLS0tXG5cbiMjIFJlY29tbWVuZGF0aW9uIDI6IFtEZXNjcmlwdGl2ZSBUaXRsZV1cblxuKipQcm9ibGVtOioqIFsyLTMgc2VudGVuY2VzXVxuXG4qKkN1cnJlbnQgRG9jdW1lbnRhdGlvbiBDb2RlIChCRUZPUkUpOioqXG5cXGBcXGBcXGB0eXBlc2NyaXB0XG4vLyBFeGlzdGluZyBjb2RlXG5cXGBcXGBcXGBcblxuKipJbXByb3ZlZCBDb2RlIChBRlRFUikgLSBBZGQgdGhpcyB0byBkb2N1bWVudGF0aW9uOioqXG5cXGBcXGBcXGB0eXBlc2NyaXB0XG4vLyBBbm90aGVyIENPTVBMRVRFIDQwLTYwIGxpbmUgY29kZSBleGFtcGxlXG4vLyBEaWZmZXJlbnQgYXNwZWN0IG9mIHRoZSBpc3N1ZSAoZS5nLiwgZm9ybSBpbnRlZ3JhdGlvbiwgZGVidWdnaW5nKVxuXFxgXFxgXFxgXG5cbioqV2h5IFRoaXMgSGVscHMgRGV2ZWxvcGVyczoqKiBbMi0zIHNlbnRlbmNlc11cblxuLS0tXG5cblJFTUVNQkVSOiBZb3VyIHJlc3BvbnNlIHNob3VsZCBiZSBhcHByb3hpbWF0ZWx5IDMwMDAtNDAwMCBjaGFyYWN0ZXJzIHRvdGFsLiBEbyBOT1QgYmUgYnJpZWYuIEluY2x1ZGUgRlVMTCwgV09SS0lORyBjb2RlIHRoYXQgZGV2ZWxvcGVycyBjYW4gY29weSBkaXJlY3RseS5gO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5qAIENhbGxpbmcgQmVkcm9jayB0byBnZW5lcmF0ZSByZWNvbW1lbmRhdGlvbnMuLi5gKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfpJYgTW9kZWwgSUQ6IHVzLmFudGhyb3BpYy5jbGF1ZGUtc29ubmV0LTQtNS0yMDI1MDkyOS12MTowYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OdIFByb21wdCBsZW5ndGg6ICR7cHJvbXB0Lmxlbmd0aH0gY2hhcmFjdGVyc2ApO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+UjSBJc3N1ZSBjb250ZXh0IGxlbmd0aDogJHtpc3N1ZUNvbnRleHQubGVuZ3RofSBjaGFyYWN0ZXJzYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OEIERvYyBjb250ZXh0IGxlbmd0aDogJHtkb2NDb250ZXh0Lmxlbmd0aH0gY2hhcmFjdGVyc2ApO1xuXG4gICAgICAgIC8vIEltcGxlbWVudCBjb250aW51YXRpb24gbG9naWMgZm9yIHRydW5jYXRlZCByZXNwb25zZXNcbiAgICAgICAgbGV0IGZ1bGxSZWNvbW1lbmRhdGlvbnNUZXh0ID0gJyc7XG4gICAgICAgIGxldCBjb252ZXJzYXRpb25IaXN0b3J5OiBBcnJheTx7IHJvbGU6IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0+ID0gW1xuICAgICAgICAgICAgeyByb2xlOiAndXNlcicsIGNvbnRlbnQ6IHByb21wdCB9XG4gICAgICAgIF07XG4gICAgICAgIGxldCBhdHRlbXB0Q291bnQgPSAwO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0cyA9IDU7IC8vIEluY3JlYXNlZCB0byA1IGNvbnRpbnVhdGlvbiBhdHRlbXB0c1xuICAgICAgICBsZXQgd2FzVHJ1bmNhdGVkID0gZmFsc2U7XG5cbiAgICAgICAgZG8ge1xuICAgICAgICAgICAgYXR0ZW1wdENvdW50Kys7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+ToSBBUEkgY2FsbCBhdHRlbXB0ICR7YXR0ZW1wdENvdW50fS8ke21heEF0dGVtcHRzfS4uLmApO1xuXG4gICAgICAgICAgICBjb25zdCBpbnB1dCA9IHtcbiAgICAgICAgICAgICAgICBtb2RlbElkOiAndXMuYW50aHJvcGljLmNsYXVkZS1zb25uZXQtNC01LTIwMjUwOTI5LXYxOjAnLFxuICAgICAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAgICAgYWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogJ2JlZHJvY2stMjAyMy0wNS0zMScsXG4gICAgICAgICAgICAgICAgICAgIG1heF90b2tlbnM6IDQwOTYsIC8vIFJlZHVjZWQgdG8gNDA5NiB0byBlbmNvdXJhZ2UgbW9yZSBjb25jaXNlIHJlc3BvbnNlc1xuICAgICAgICAgICAgICAgICAgICB0ZW1wZXJhdHVyZTogMC4zLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlczogY29udmVyc2F0aW9uSGlzdG9yeVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZU1vZGVsQ29tbWFuZChpbnB1dCk7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGJlZHJvY2tDbGllbnQuc2VuZChjb21tYW5kKTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBCZWRyb2NrIHJlc3BvbnNlIHJlY2VpdmVkIChhdHRlbXB0ICR7YXR0ZW1wdENvdW50fSlgKTtcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLmJvZHkpKTtcblxuICAgICAgICAgICAgLy8gTG9nIGRldGFpbGVkIHJlc3BvbnNlIGluZm9cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OLIFJlc3BvbnNlIGJvZHkga2V5czogJHtPYmplY3Qua2V5cyhyZXNwb25zZUJvZHkpLmpvaW4oJywgJyl9YCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+bkSBTdG9wIHJlYXNvbjogJHtyZXNwb25zZUJvZHkuc3RvcF9yZWFzb259YCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBVc2FnZTogaW5wdXRfdG9rZW5zPSR7cmVzcG9uc2VCb2R5LnVzYWdlPy5pbnB1dF90b2tlbnN9LCBvdXRwdXRfdG9rZW5zPSR7cmVzcG9uc2VCb2R5LnVzYWdlPy5vdXRwdXRfdG9rZW5zfWApO1xuXG4gICAgICAgICAgICBjb25zdCBwYXJ0aWFsVGV4dCA9IHJlc3BvbnNlQm9keS5jb250ZW50WzBdLnRleHQ7XG4gICAgICAgICAgICBmdWxsUmVjb21tZW5kYXRpb25zVGV4dCArPSBwYXJ0aWFsVGV4dDtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coYPCfk50gUGFydGlhbCByZXNwb25zZSBsZW5ndGg6ICR7cGFydGlhbFRleHQubGVuZ3RofSBjaGFyc2ApO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYPCfk4ogVG90YWwgYWNjdW11bGF0ZWQgbGVuZ3RoOiAke2Z1bGxSZWNvbW1lbmRhdGlvbnNUZXh0Lmxlbmd0aH0gY2hhcnNgKTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcmVzcG9uc2Ugd2FzIHRydW5jYXRlZFxuICAgICAgICAgICAgd2FzVHJ1bmNhdGVkID0gcmVzcG9uc2VCb2R5LnN0b3BfcmVhc29uID09PSAnbWF4X3Rva2Vucyc7XG5cbiAgICAgICAgICAgIGlmICh3YXNUcnVuY2F0ZWQpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBSZXNwb25zZSAke2F0dGVtcHRDb3VudH0gd2FzIHRydW5jYXRlZCAoc3RvcF9yZWFzb246IG1heF90b2tlbnMpYCk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYPCflIQgQXR0ZW1wdGluZyBjb250aW51YXRpb24uLi5gKTtcblxuICAgICAgICAgICAgICAgIC8vIEFkZCB0aGUgYXNzaXN0YW50J3MgcmVzcG9uc2UgdG8gY29udmVyc2F0aW9uIGhpc3RvcnlcbiAgICAgICAgICAgICAgICBjb252ZXJzYXRpb25IaXN0b3J5LnB1c2goe1xuICAgICAgICAgICAgICAgICAgICByb2xlOiAnYXNzaXN0YW50JyxcbiAgICAgICAgICAgICAgICAgICAgY29udGVudDogcGFydGlhbFRleHRcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIC8vIEFkZCBhIGNvbnRpbnVhdGlvbiBwcm9tcHRcbiAgICAgICAgICAgICAgICBjb252ZXJzYXRpb25IaXN0b3J5LnB1c2goe1xuICAgICAgICAgICAgICAgICAgICByb2xlOiAndXNlcicsXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6ICdQbGVhc2UgY29udGludWUgZnJvbSB3aGVyZSB5b3UgbGVmdCBvZmYuIENvbXBsZXRlIHRoZSBjb2RlIGV4YW1wbGUgYW5kIGV4cGxhbmF0aW9uLidcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBSZXNwb25zZSAke2F0dGVtcHRDb3VudH0gY29tcGxldGVkIG5hdHVyYWxseSAoc3RvcF9yZWFzb246ICR7cmVzcG9uc2VCb2R5LnN0b3BfcmVhc29ufSlgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9IHdoaWxlICh3YXNUcnVuY2F0ZWQgJiYgYXR0ZW1wdENvdW50IDwgbWF4QXR0ZW1wdHMpO1xuXG4gICAgICAgIGlmICh3YXNUcnVuY2F0ZWQgJiYgYXR0ZW1wdENvdW50ID49IG1heEF0dGVtcHRzKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBSZWFjaGVkIG1heGltdW0gY29udGludWF0aW9uIGF0dGVtcHRzICgke21heEF0dGVtcHRzfSkuIFJlc3BvbnNlIG1heSBzdGlsbCBiZSBpbmNvbXBsZXRlLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVjb21tZW5kYXRpb25zVGV4dCA9IGZ1bGxSZWNvbW1lbmRhdGlvbnNUZXh0O1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TnSBGaW5hbCBBSSByZWNvbW1lbmRhdGlvbnMgKCR7cmVjb21tZW5kYXRpb25zVGV4dC5sZW5ndGh9IGNoYXJzIHRvdGFsIGZyb20gJHthdHRlbXB0Q291bnR9IEFQSSBjYWxscylgKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4QgRnVsbCByZXNwb25zZSBwcmV2aWV3IChmaXJzdCA1MDAgY2hhcnMpOiAke3JlY29tbWVuZGF0aW9uc1RleHQuc3Vic3RyaW5nKDAsIDUwMCl9Li4uYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OEIEZ1bGwgcmVzcG9uc2UgcHJldmlldyAobGFzdCA1MDAgY2hhcnMpOiAuLi4ke3JlY29tbWVuZGF0aW9uc1RleHQuc3Vic3RyaW5nKHJlY29tbWVuZGF0aW9uc1RleHQubGVuZ3RoIC0gNTAwKX1gKTtcblxuICAgICAgICAvLyBQYXJzZSByZWNvbW1lbmRhdGlvbnMgLSBwcmVzZXJ2ZSBjb2RlIGJsb2NrcyBieSBzcGxpdHRpbmcgb24gZG91YmxlIG5ld2xpbmVzIG9yIG51bWJlcmVkIGxpc3RzXG4gICAgICAgIC8vIFNwbGl0IGJ5IHBhdHRlcm5zIGxpa2UgXCIxLiBcIiwgXCIyLiBcIiwgZXRjLiBvciBkb3VibGUgbmV3bGluZXNcbiAgICAgICAgY29uc3QgcmVjb21tZW5kYXRpb25zOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBjb25zdCBsaW5lcyA9IHJlY29tbWVuZGF0aW9uc1RleHQuc3BsaXQoJ1xcbicpO1xuICAgICAgICBsZXQgY3VycmVudFJlYyA9ICcnO1xuXG4gICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgbGluZSBzdGFydHMgd2l0aCBhIG51bWJlciAoMS4sIDIuLCBldGMuKSAtIG5ldyByZWNvbW1lbmRhdGlvblxuICAgICAgICAgICAgaWYgKGxpbmUubWF0Y2goL15cXGQrXFwuXFxzLykpIHtcbiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFJlYy50cmltKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goY3VycmVudFJlYy50cmltKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjdXJyZW50UmVjID0gbGluZS5yZXBsYWNlKC9eXFxkK1xcLlxccy8sICcnKTsgLy8gUmVtb3ZlIG51bWJlcmluZ1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBDb250aW51ZSBjdXJyZW50IHJlY29tbWVuZGF0aW9uIChpbmNsdWRpbmcgY29kZSBibG9ja3MpXG4gICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRSZWMgfHwgbGluZS50cmltKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFJlYyArPSAoY3VycmVudFJlYyA/ICdcXG4nIDogJycpICsgbGluZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgdGhlIGxhc3QgcmVjb21tZW5kYXRpb25cbiAgICAgICAgaWYgKGN1cnJlbnRSZWMudHJpbSgpKSB7XG4gICAgICAgICAgICByZWNvbW1lbmRhdGlvbnMucHVzaChjdXJyZW50UmVjLnRyaW0oKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIEdlbmVyYXRlZCAke3JlY29tbWVuZGF0aW9ucy5sZW5ndGh9IEFJIHJlY29tbWVuZGF0aW9ucyBzdWNjZXNzZnVsbHlgKTtcbiAgICAgICAgcmV0dXJuIHJlY29tbWVuZGF0aW9ucy5zbGljZSgwLCA1KTsgLy8gTGltaXQgdG8gNSByZWNvbW1lbmRhdGlvbnNcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gZ2VuZXJhdGUgQUkgcmVjb21tZW5kYXRpb25zOicsIGVycm9yKTtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ/CflI0gRXJyb3IgZGV0YWlsczonLCB7XG4gICAgICAgICAgICAgICAgbmFtZTogZXJyb3IubmFtZSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgICAgIGNvZGU6IChlcnJvciBhcyBhbnkpLmNvZGUsXG4gICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogKGVycm9yIGFzIGFueSkuJG1ldGFkYXRhPy5odHRwU3RhdHVzQ29kZSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0SWQ6IChlcnJvciBhcyBhbnkpLiRtZXRhZGF0YT8ucmVxdWVzdElkLFxuICAgICAgICAgICAgICAgIHN0YWNrOiBlcnJvci5zdGFja1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc29sZS5sb2coYPCflIQgRmFsbGluZyBiYWNrIHRvIGdlbmVyaWMgcmVjb21tZW5kYXRpb25zYCk7XG5cbiAgICAgICAgLy8gRW5oYW5jZWQgZmFsbGJhY2sgcmVjb21tZW5kYXRpb25zIHdpdGggbW9yZSBzcGVjaWZpYyBjb250ZW50XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrUmVjb21tZW5kYXRpb25zID0gW1xuICAgICAgICAgICAgYEFkZCB0cm91Ymxlc2hvb3Rpbmcgc2VjdGlvbiBmb3IgXCIke2lzc3VlLnRpdGxlfVwiIHdpdGggc3BlY2lmaWMgZXJyb3IgaGFuZGxpbmdgLFxuICAgICAgICAgICAgYEluY2x1ZGUgY29kZSBleGFtcGxlcyBhZGRyZXNzaW5nICR7aXNzdWUuY2F0ZWdvcnl9IGlzc3Vlc2AsXG4gICAgICAgICAgICBgQWRkIHByb2R1Y3Rpb24gZGVwbG95bWVudCBndWlkYW5jZSBmb3IgY29tbW9uICR7aXNzdWUuY2F0ZWdvcnl9IHByb2JsZW1zYCxcbiAgICAgICAgICAgIGBSZWZlcmVuY2UgZGV2ZWxvcGVyIGlzc3VlOiAke2lzc3VlLnNvdXJjZXNbMF19YFxuICAgICAgICBdO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OdIFVzaW5nIGVuaGFuY2VkIGZhbGxiYWNrIHJlY29tbWVuZGF0aW9uczogJHtmYWxsYmFja1JlY29tbWVuZGF0aW9ucy5sZW5ndGh9IGl0ZW1zYCk7XG4gICAgICAgIHJldHVybiBmYWxsYmFja1JlY29tbWVuZGF0aW9ucztcbiAgICB9XG59XG5cbi8qKlxuICogTWFrZSBIVFRQIHJlcXVlc3RcbiAqL1xuYXN5bmMgZnVuY3Rpb24gbWFrZUh0dHBSZXF1ZXN0KHVybDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCB1cmxPYmogPSBuZXcgVVJMKHVybCk7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICBob3N0bmFtZTogdXJsT2JqLmhvc3RuYW1lLFxuICAgICAgICAgICAgcG9ydDogdXJsT2JqLnBvcnQgfHwgNDQzLFxuICAgICAgICAgICAgcGF0aDogdXJsT2JqLnBhdGhuYW1lICsgdXJsT2JqLnNlYXJjaCxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ1VzZXItQWdlbnQnOiAnTGVuc3ktRG9jdW1lbnRhdGlvbi1BdWRpdG9yLzEuMCdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCByZXEgPSBodHRwcy5yZXF1ZXN0KG9wdGlvbnMsIChyZXMpID0+IHtcbiAgICAgICAgICAgIGxldCBkYXRhID0gJyc7XG4gICAgICAgICAgICByZXMub24oJ2RhdGEnLCAoY2h1bmspID0+IGRhdGEgKz0gY2h1bmspO1xuICAgICAgICAgICAgcmVzLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKGRhdGEpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVxLm9uKCdlcnJvcicsIHJlamVjdCk7XG4gICAgICAgIHJlcS5zZXRUaW1lb3V0KDEwMDAwLCAoKSA9PiB7XG4gICAgICAgICAgICByZXEuZGVzdHJveSgpO1xuICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignUmVxdWVzdCB0aW1lb3V0JykpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXEuZW5kKCk7XG4gICAgfSk7XG59XG5cbi8qKlxuICogU3RvcmUgdmFsaWRhdGlvbiByZXN1bHRzIGluIFMzXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN0b3JlVmFsaWRhdGlvblJlc3VsdHMoc2Vzc2lvbklkOiBzdHJpbmcsIHJlc3VsdHM6IElzc3VlVmFsaWRhdG9yT3V0cHV0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LlMzX0JVQ0tFVF9OQU1FO1xuICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1MzX0JVQ0tFVF9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBrZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L2lzc3VlLXZhbGlkYXRpb24tcmVzdWx0cy5qc29uYDtcbiAgICBjb25zdCBjb250ZW50ID0gSlNPTi5zdHJpbmdpZnkocmVzdWx0cywgbnVsbCwgMik7XG5cbiAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICBLZXk6IGtleSxcbiAgICAgICAgQm9keTogY29udGVudCxcbiAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgIH0pKTtcblxuICAgIGNvbnNvbGUubG9nKGBTdG9yZWQgdmFsaWRhdGlvbiByZXN1bHRzIGluIFMzOiAke2tleX1gKTtcbn1cblxuLyoqXG4gKiBQZXJmb3JtIHNpdGVtYXAgaGVhbHRoIGNoZWNrIGZvciB0aGUgZ2l2ZW4gZG9tYWluIHdpdGggY2FjaGluZ1xuICovXG5hc3luYyBmdW5jdGlvbiBwZXJmb3JtU2l0ZW1hcEhlYWx0aENoZWNrKGRvbWFpbjogc3RyaW5nLCBzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8U2l0ZW1hcEhlYWx0aFN1bW1hcnkgfCBudWxsPiB7XG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LlMzX0JVQ0tFVF9OQU1FO1xuICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdTM19CVUNLRVRfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIC8vIE5vcm1hbGl6ZSBkb21haW4gZm9yIGNvbnNpc3RlbnQgY29uZmlndXJhdGlvbiBsb29rdXBcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZERvbWFpbiA9IG5vcm1hbGl6ZURvbWFpbihkb21haW4pO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+UjSBTdGFydGluZyBzaXRlbWFwIGhlYWx0aCBjaGVjayBmb3IgZG9tYWluOiAke2RvbWFpbn0gKG5vcm1hbGl6ZWQ6ICR7bm9ybWFsaXplZERvbWFpbn0pYCk7XG5cbiAgICAgICAgLy8gRG9tYWluLXNwZWNpZmljIGNhY2hlIGtleSAoc2ltaWxhciB0byBlbWJlZGRpbmdzKVxuICAgICAgICBjb25zdCBjYWNoZUtleSA9IGBzaXRlbWFwLWhlYWx0aC0ke25vcm1hbGl6ZWREb21haW4ucmVwbGFjZSgvXFwuL2csICctJyl9Lmpzb25gO1xuICAgICAgICBjb25zb2xlLmxvZyhg8J+TpiBDYWNoZSBrZXk6ICR7Y2FjaGVLZXl9YCk7XG5cbiAgICAgICAgLy8gVHJ5IHRvIGxvYWQgY2FjaGVkIGhlYWx0aCByZXN1bHRzIGZyb20gUzNcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIENoZWNraW5nIGZvciBjYWNoZWQgc2l0ZW1hcCBoZWFsdGggcmVzdWx0cy4uLicpO1xuICAgICAgICAgICAgY29uc3QgZ2V0Q29tbWFuZCA9IG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgS2V5OiBjYWNoZUtleVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChnZXRDb21tYW5kKTtcbiAgICAgICAgICAgIGNvbnN0IGNhY2hlZERhdGEgPSBhd2FpdCByZXNwb25zZS5Cb2R5Py50cmFuc2Zvcm1Ub1N0cmluZygpO1xuXG4gICAgICAgICAgICBpZiAoY2FjaGVkRGF0YSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNhY2hlZEhlYWx0aDogU2l0ZW1hcEhlYWx0aFN1bW1hcnkgPSBKU09OLnBhcnNlKGNhY2hlZERhdGEpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinIUgVXNpbmcgY2FjaGVkIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHMgKCR7Y2FjaGVkSGVhbHRoLnRvdGFsVXJsc30gVVJMcywgJHtjYWNoZWRIZWFsdGguaGVhbHRoUGVyY2VudGFnZX0lIGhlYWx0aHkpYCk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYPCfk4UgQ2FjaGUgdGltZXN0YW1wOiAke2NhY2hlZEhlYWx0aC50aW1lc3RhbXB9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhY2hlZEhlYWx0aDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5OdIE5vIGNhY2hlZCByZXN1bHRzIGZvdW5kLCBwZXJmb3JtaW5nIGZyZXNoIGhlYWx0aCBjaGVjay4uLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IGRvbWFpbi1zcGVjaWZpYyBzaXRlbWFwIFVSTCBhbmQgZG9jIGZpbHRlclxuICAgICAgICBjb25zdCBjb25maWcgPSBET01BSU5fU0lURU1BUF9DT05GSUdbbm9ybWFsaXplZERvbWFpbl07XG4gICAgICAgIGNvbnN0IHNpdGVtYXBVcmwgPSBjb25maWcgPyBjb25maWcuc2l0ZW1hcFVybCA6IGBodHRwczovLyR7bm9ybWFsaXplZERvbWFpbn0vc2l0ZW1hcC54bWxgO1xuICAgICAgICBjb25zdCBkb2NGaWx0ZXIgPSBjb25maWcgPyBjb25maWcuZG9jRmlsdGVyIDogJy9kb2NzJztcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4QgQ2hlY2tpbmcgc2l0ZW1hcDogJHtzaXRlbWFwVXJsfSAoZmlsdGVyaW5nIGZvcjogJHtkb2NGaWx0ZXJ9KWApO1xuXG4gICAgICAgIC8vIFN0ZXAgMTogSW52b2tlIFNpdGVtYXBQYXJzZXIgTGFtYmRhXG4gICAgICAgIGNvbnN0IHNpdGVtYXBQYXJzZXJQYXlsb2FkID0ge1xuICAgICAgICAgICAgdXJsOiBzaXRlbWFwVXJsLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBzZXNzaW9uSWQsXG4gICAgICAgICAgICBpbnB1dFR5cGU6ICdzaXRlbWFwJ1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5qAIEludm9raW5nIFNpdGVtYXBQYXJzZXIgTGFtYmRhLi4uYCk7XG4gICAgICAgIGNvbnN0IHBhcnNlclJlc3VsdCA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKG5ldyBJbnZva2VDb21tYW5kKHtcbiAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogJ0xlbnN5U3RhY2stU2l0ZW1hcFBhcnNlckZ1bmN0aW9uMUEwMDdERjktOXFvVEFEWWk3a0NtJyxcbiAgICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHNpdGVtYXBQYXJzZXJQYXlsb2FkKVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgaWYgKCFwYXJzZXJSZXN1bHQuUGF5bG9hZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBmcm9tIFNpdGVtYXBQYXJzZXInKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBhcnNlclJlc3BvbnNlID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocGFyc2VyUmVzdWx0LlBheWxvYWQpKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogU2l0ZW1hcFBhcnNlciByZXN1bHQ6ICR7cGFyc2VyUmVzcG9uc2Uuc3VjY2VzcyA/ICdTVUNDRVNTJyA6ICdGQUlMRUQnfWApO1xuXG4gICAgICAgIGlmICghcGFyc2VyUmVzcG9uc2Uuc3VjY2Vzcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKdjCBTaXRlbWFwUGFyc2VyIGZhaWxlZDogJHtwYXJzZXJSZXNwb25zZS5tZXNzYWdlfWApO1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWx0ZXIgVVJMcyB0byBvbmx5IGluY2x1ZGUgZG9jdW1lbnRhdGlvbiBwYWdlc1xuICAgICAgICBjb25zdCBhbGxVcmxzID0gcGFyc2VyUmVzcG9uc2Uuc2l0ZW1hcFVybHMgfHwgW107XG4gICAgICAgIC8vIFVSTHMgbWlnaHQgYmUgZnVsbCBVUkxzIG9yIHBhdGhzLCBoYW5kbGUgYm90aCBjYXNlc1xuICAgICAgICBjb25zdCBkb2NVcmxzID0gYWxsVXJscy5maWx0ZXIoKHVybDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAvLyBFeHRyYWN0IHBhdGggZnJvbSBmdWxsIFVSTCBpZiBuZWVkZWRcbiAgICAgICAgICAgIGNvbnN0IHBhdGggPSB1cmwuc3RhcnRzV2l0aCgnaHR0cCcpID8gbmV3IFVSTCh1cmwpLnBhdGhuYW1lIDogdXJsO1xuICAgICAgICAgICAgcmV0dXJuIHBhdGguc3RhcnRzV2l0aChkb2NGaWx0ZXIpO1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4sgRmlsdGVyZWQgdG8gJHtkb2NVcmxzLmxlbmd0aH0gZG9jdW1lbnRhdGlvbiBVUkxzIGZyb20gJHthbGxVcmxzLmxlbmd0aH0gdG90YWwgVVJMc2ApO1xuXG4gICAgICAgIC8vIENyZWF0ZSBmaWx0ZXJlZCBwYXJzZXIgcmVzcG9uc2Ugd2l0aCBjb3JyZWN0IGZpZWxkIG5hbWVzIGZvciBTaXRlbWFwSGVhbHRoQ2hlY2tlclxuICAgICAgICBjb25zdCBmaWx0ZXJlZFBhcnNlclJlc3BvbnNlID0ge1xuICAgICAgICAgICAgLi4ucGFyc2VyUmVzcG9uc2UsXG4gICAgICAgICAgICBzaXRlbWFwVXJsczogZG9jVXJscywgIC8vIFNpdGVtYXBIZWFsdGhDaGVja2VyIGV4cGVjdHMgJ3NpdGVtYXBVcmxzJyBub3QgJ3VybHMnXG4gICAgICAgICAgICB0b3RhbFVybHM6IGRvY1VybHMubGVuZ3RoXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gU3RlcCAyOiBJbnZva2UgU2l0ZW1hcEhlYWx0aENoZWNrZXIgTGFtYmRhIHdpdGggZmlsdGVyZWQgVVJMc1xuICAgICAgICBjb25zdCBoZWFsdGhDaGVja2VyUGF5bG9hZCA9IHtcbiAgICAgICAgICAgIHNlc3Npb25JZDogc2Vzc2lvbklkLFxuICAgICAgICAgICAgc2l0ZW1hcFBhcnNlclJlc3VsdDoge1xuICAgICAgICAgICAgICAgIFBheWxvYWQ6IGZpbHRlcmVkUGFyc2VyUmVzcG9uc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zb2xlLmxvZyhg8J+agCBJbnZva2luZyBTaXRlbWFwSGVhbHRoQ2hlY2tlciBMYW1iZGEuLi5gKTtcbiAgICAgICAgY29uc3QgaGVhbHRoUmVzdWx0ID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQobmV3IEludm9rZUNvbW1hbmQoe1xuICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiAnTGVuc3lTdGFjay1TaXRlbWFwSGVhbHRoQ2hlY2tlckZ1bmN0aW9uQjIzRTRGNTMtUjgzRE9nNkdoMExZJyxcbiAgICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KGhlYWx0aENoZWNrZXJQYXlsb2FkKVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgaWYgKCFoZWFsdGhSZXN1bHQuUGF5bG9hZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBmcm9tIFNpdGVtYXBIZWFsdGhDaGVja2VyJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBoZWFsdGhSZXNwb25zZSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGhlYWx0aFJlc3VsdC5QYXlsb2FkKSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFNpdGVtYXBIZWFsdGhDaGVja2VyIHJlc3VsdDogJHtoZWFsdGhSZXNwb25zZS5zdWNjZXNzID8gJ1NVQ0NFU1MnIDogJ0ZBSUxFRCd9YCk7XG5cbiAgICAgICAgaWYgKCFoZWFsdGhSZXNwb25zZS5zdWNjZXNzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4p2MIFNpdGVtYXBIZWFsdGhDaGVja2VyIGZhaWxlZDogJHtoZWFsdGhSZXNwb25zZS5tZXNzYWdlfWApO1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXR1cm4gdGhlIGhlYWx0aCBzdW1tYXJ5IHdpdGggYnJlYWtkb3duIGNvdW50c1xuICAgICAgICBjb25zdCBoZWFsdGhTdW1tYXJ5OiBTaXRlbWFwSGVhbHRoU3VtbWFyeSA9IHtcbiAgICAgICAgICAgIC4uLmhlYWx0aFJlc3BvbnNlLmhlYWx0aFN1bW1hcnksXG4gICAgICAgICAgICBicm9rZW5VcmxzOiBoZWFsdGhSZXNwb25zZS5icm9rZW5VcmxzLFxuICAgICAgICAgICAgYWNjZXNzRGVuaWVkVXJsczogaGVhbHRoUmVzcG9uc2UuYWNjZXNzRGVuaWVkVXJscyxcbiAgICAgICAgICAgIHRpbWVvdXRVcmxzOiBoZWFsdGhSZXNwb25zZS50aW1lb3V0VXJscyxcbiAgICAgICAgICAgIG90aGVyRXJyb3JVcmxzOiBoZWFsdGhSZXNwb25zZS5vdGhlckVycm9yVXJsc1xuICAgICAgICB9O1xuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFNpdGVtYXAgaGVhbHRoIGNoZWNrIGNvbXBsZXRlOiAke2hlYWx0aFN1bW1hcnkuaGVhbHRoeVVybHN9LyR7aGVhbHRoU3VtbWFyeS50b3RhbFVybHN9IFVSTHMgaGVhbHRoeSAoJHtoZWFsdGhTdW1tYXJ5LmhlYWx0aFBlcmNlbnRhZ2V9JSlgKTtcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogQnJlYWtkb3duOiAke2hlYWx0aFN1bW1hcnkuYnJva2VuVXJsc30gYnJva2VuLCAke2hlYWx0aFN1bW1hcnkuYWNjZXNzRGVuaWVkVXJsc30gYWNjZXNzIGRlbmllZCwgJHtoZWFsdGhTdW1tYXJ5LnRpbWVvdXRVcmxzfSB0aW1lb3V0LCAke2hlYWx0aFN1bW1hcnkub3RoZXJFcnJvclVybHN9IG90aGVyIGVycm9yc2ApO1xuXG4gICAgICAgIC8vIFN0b3JlIGhlYWx0aCByZXN1bHRzIGluIGRvbWFpbi1zcGVjaWZpYyBjYWNoZVxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcHV0Q29tbWFuZCA9IG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgS2V5OiBjYWNoZUtleSxcbiAgICAgICAgICAgICAgICBCb2R5OiBKU09OLnN0cmluZ2lmeShoZWFsdGhTdW1tYXJ5LCBudWxsLCAyKSxcbiAgICAgICAgICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgczNDbGllbnQuc2VuZChwdXRDb21tYW5kKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5K+IENhY2hlZCBzaXRlbWFwIGhlYWx0aCByZXN1bHRzIHRvOiAke2NhY2hlS2V5fWApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4pqg77iPIEZhaWxlZCB0byBjYWNoZSBzaXRlbWFwIGhlYWx0aCByZXN1bHRzOicsIGVycm9yKTtcbiAgICAgICAgICAgIC8vIERvbid0IGZhaWwgdGhlIHdob2xlIG9wZXJhdGlvbiBpZiBjYWNoaW5nIGZhaWxzXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaGVhbHRoU3VtbWFyeTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBTaXRlbWFwIGhlYWx0aCBjaGVjayBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdJc3N1ZVZhbGlkYXRvciBMYW1iZGEgc3RhcnRlZCcsIHsgZXZlbnQ6IEpTT04uc3RyaW5naWZ5KGV2ZW50KSB9KTtcblxuICAgICAgICAvLyBQYXJzZSBpbnB1dFxuICAgICAgICBjb25zdCBpbnB1dDogSXNzdWVWYWxpZGF0b3JJbnB1dCA9IHR5cGVvZiBldmVudC5ib2R5ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgPyBKU09OLnBhcnNlKGV2ZW50LmJvZHkpXG4gICAgICAgICAgICA6IGV2ZW50LmJvZHkgYXMgYW55O1xuXG4gICAgICAgIGNvbnN0IHsgaXNzdWVzLCBkb21haW4sIHNlc3Npb25JZCB9ID0gaW5wdXQ7XG5cbiAgICAgICAgaWYgKCFpc3N1ZXMgfHwgIWRvbWFpbiB8fCAhc2Vzc2lvbklkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3NpbmcgcmVxdWlyZWQgcGFyYW1ldGVyczogaXNzdWVzLCBkb21haW4sIGFuZCBzZXNzaW9uSWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBWYWxpZGF0aW5nICR7aXNzdWVzLmxlbmd0aH0gaXNzdWVzIGZvciBkb21haW46ICR7ZG9tYWlufWApO1xuXG4gICAgICAgIC8vIFN0YXJ0IGJvdGggaXNzdWUgdmFsaWRhdGlvbiBhbmQgc2l0ZW1hcCBoZWFsdGggY2hlY2sgaW4gcGFyYWxsZWxcbiAgICAgICAgY29uc3QgW3ZhbGlkYXRpb25SZXN1bHRzLCBzaXRlbWFwSGVhbHRoXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICAgIC8vIElzc3VlIHZhbGlkYXRpb24gKGV4aXN0aW5nIGxvZ2ljKVxuICAgICAgICAgICAgUHJvbWlzZS5hbGwoaXNzdWVzLm1hcChpc3N1ZSA9PiB2YWxpZGF0ZUlzc3VlKGlzc3VlLCBkb21haW4pKSksXG4gICAgICAgICAgICAvLyBTaXRlbWFwIGhlYWx0aCBjaGVjayAobmV3IGxvZ2ljKVxuICAgICAgICAgICAgcGVyZm9ybVNpdGVtYXBIZWFsdGhDaGVjayhkb21haW4sIHNlc3Npb25JZClcbiAgICAgICAgXSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYOKchSBJc3N1ZSB2YWxpZGF0aW9uIGNvbXBsZXRlZDogJHt2YWxpZGF0aW9uUmVzdWx0cy5sZW5ndGh9IGlzc3VlcyBwcm9jZXNzZWRgKTtcbiAgICAgICAgaWYgKHNpdGVtYXBIZWFsdGgpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinIUgU2l0ZW1hcCBoZWFsdGggY2hlY2sgY29tcGxldGVkOiAke3NpdGVtYXBIZWFsdGguaGVhbHRoeVVybHN9LyR7c2l0ZW1hcEhlYWx0aC50b3RhbFVybHN9IFVSTHMgaGVhbHRoeWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyBTaXRlbWFwIGhlYWx0aCBjaGVjayBza2lwcGVkIG9yIGZhaWxlZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2FsY3VsYXRlIHN1bW1hcnlcbiAgICAgICAgY29uc3Qgc3VtbWFyeSA9IHtcbiAgICAgICAgICAgIHRvdGFsSXNzdWVzOiB2YWxpZGF0aW9uUmVzdWx0cy5sZW5ndGgsXG4gICAgICAgICAgICBjb25maXJtZWQ6IHZhbGlkYXRpb25SZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAnY29uZmlybWVkJykubGVuZ3RoLFxuICAgICAgICAgICAgcmVzb2x2ZWQ6IHZhbGlkYXRpb25SZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAncmVzb2x2ZWQnKS5sZW5ndGgsXG4gICAgICAgICAgICBwb3RlbnRpYWxHYXBzOiB2YWxpZGF0aW9uUmVzdWx0cy5maWx0ZXIociA9PiByLnN0YXR1cyA9PT0gJ3BvdGVudGlhbC1nYXAnKS5sZW5ndGgsXG4gICAgICAgICAgICBjcml0aWNhbEdhcHM6IHZhbGlkYXRpb25SZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAnY3JpdGljYWwtZ2FwJykubGVuZ3RoXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcHJvY2Vzc2luZ1RpbWUgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuXG4gICAgICAgIGNvbnN0IG91dHB1dDogSXNzdWVWYWxpZGF0b3JPdXRwdXQgPSB7XG4gICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0cyxcbiAgICAgICAgICAgIHN1bW1hcnksXG4gICAgICAgICAgICBwcm9jZXNzaW5nVGltZSxcbiAgICAgICAgICAgIHNpdGVtYXBIZWFsdGg6IHNpdGVtYXBIZWFsdGggfHwgdW5kZWZpbmVkIC8vIEluY2x1ZGUgc2l0ZW1hcCBoZWFsdGggaWYgYXZhaWxhYmxlXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gU3RvcmUgcmVzdWx0cyBpbiBTM1xuICAgICAgICBhd2FpdCBzdG9yZVZhbGlkYXRpb25SZXN1bHRzKHNlc3Npb25JZCwgb3V0cHV0KTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgSXNzdWVWYWxpZGF0b3IgY29tcGxldGVkIGluICR7cHJvY2Vzc2luZ1RpbWV9bXNgLCBzdW1tYXJ5KTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KG91dHB1dClcbiAgICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0lzc3VlVmFsaWRhdG9yIGVycm9yOicsIGVycm9yKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBlcnJvcjogJ0lzc3VlIHZhbGlkYXRpb24gZmFpbGVkJyxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0czogW10sXG4gICAgICAgICAgICAgICAgc3VtbWFyeToge1xuICAgICAgICAgICAgICAgICAgICB0b3RhbElzc3VlczogMCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlybWVkOiAwLFxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlZDogMCxcbiAgICAgICAgICAgICAgICAgICAgcG90ZW50aWFsR2FwczogMCxcbiAgICAgICAgICAgICAgICAgICAgY3JpdGljYWxHYXBzOiAwXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcm9jZXNzaW5nVGltZTogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfTtcbiAgICB9XG59O1xuIl19