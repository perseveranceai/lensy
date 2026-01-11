"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const jsdom_1 = require("jsdom");
const turndown_1 = __importDefault(require("turndown"));
const turndown_plugin_gfm_1 = require("turndown-plugin-gfm");
const crypto = __importStar(require("crypto"));
const progress_publisher_1 = require("./progress-publisher");
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
/**
 * Generate consistent session ID based on URL and context setting
 * Same URL + context setting = same session ID = cache reuse
 */
function generateConsistentSessionId(url, contextualSetting) {
    const normalizedUrl = normalizeUrl(url);
    const input = `${normalizedUrl}#${contextualSetting}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `session-${hash.substring(0, 12)}`;
}
/**
 * Normalize URL to ensure consistent caching
 * - Remove fragments (#section)
 * - Sort query parameters
 * - Remove trailing slashes
 * - Convert to lowercase hostname
 */
function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        // Remove fragment
        urlObj.hash = '';
        // Sort query parameters for consistency
        const params = new URLSearchParams(urlObj.search);
        const sortedParams = new URLSearchParams();
        Array.from(params.keys()).sort().forEach(key => {
            sortedParams.set(key, params.get(key) || '');
        });
        urlObj.search = sortedParams.toString();
        // Remove trailing slash from pathname (except for root)
        if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }
        // Lowercase hostname for consistency
        urlObj.hostname = urlObj.hostname.toLowerCase();
        return urlObj.toString();
    }
    catch (error) {
        console.warn('Failed to normalize URL, using original:', url);
        return url;
    }
}
const handler = async (event) => {
    console.log('Processing URL:', event.url);
    // Initialize progress publisher
    const progress = new progress_publisher_1.ProgressPublisher(event.sessionId);
    try {
        // Send initial progress
        await progress.progress('Processing URL...', 'url-processing');
        // Check if caching is enabled (default to true for backward compatibility)
        const cacheEnabled = event.cacheControl?.enabled !== false;
        // Generate consistent session ID based on URL + context setting
        const contextEnabled = event.contextAnalysis?.enabled || false;
        const contextualSetting = contextEnabled ? 'with-context' : 'without-context';
        const consistentSessionId = generateConsistentSessionId(event.url, contextualSetting);
        console.log(`Generated consistent session ID: ${consistentSessionId} (context: ${contextEnabled}, cache: ${cacheEnabled})`);
        // Step 1: Check cache first using consistent session ID (only if caching is enabled)
        let cachedContent = null;
        if (cacheEnabled) {
            cachedContent = await checkProcessedContentCache(event.url, contextualSetting);
        }
        else {
            console.log('⚠️ Cache disabled by user - skipping cache check');
            await progress.info('⚠️ Cache disabled - running fresh analysis');
        }
        if (cachedContent && !isCacheExpired(cachedContent)) {
            console.log(`Cache hit! Using cached content from session: ${consistentSessionId}`);
            // Send cache hit message
            await progress.cacheHit(`Cache HIT! ⚡ Using cached analysis from ${new Date(cachedContent.processedAt).toLocaleDateString()}`, {
                cacheStatus: 'hit',
                contentType: cachedContent.contentType
            });
            // Copy cached content to current session location (if different)
            if (consistentSessionId !== event.sessionId) {
                await copyCachedContentToSession(cachedContent.s3Location, event.sessionId);
            }
            // Add cache metadata to the processed content
            await addCacheMetadata(event.sessionId, true);
            // Store session metadata
            await storeSessionMetadata(event);
            return {
                success: true,
                sessionId: event.sessionId,
                message: 'Retrieved from cache'
            };
        }
        console.log('Cache miss or expired, processing fresh content...');
        // Send cache miss message (only if cache was enabled)
        if (cacheEnabled) {
            await progress.cacheMiss('Cache MISS - Running fresh analysis', {
                cacheStatus: 'miss'
            });
        }
        // Fetch HTML content
        await progress.info('Fetching and cleaning content...');
        const response = await fetch(event.url, {
            headers: {
                'User-Agent': 'Lensy Documentation Quality Auditor/1.0'
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const htmlContent = await response.text();
        console.log(`Fetched ${htmlContent.length} characters of HTML content`);
        // Parse HTML with JSDOM
        const dom = new jsdom_1.JSDOM(htmlContent, { url: event.url });
        const document = dom.window.document;
        console.log(`Original HTML size: ${htmlContent.length} chars`);
        // AGGRESSIVE NOISE REDUCTION: Remove noise elements before processing
        const removedCount = removeNoiseElements(document);
        console.log(`Removed ${removedCount} noise elements`);
        // Extract main content area with better content detection
        const mainContent = extractMainContent(document);
        const cleanHtml = mainContent.innerHTML;
        console.log(`After content extraction: ${cleanHtml.length} chars`);
        const reductionPercent = Math.round((1 - cleanHtml.length / htmlContent.length) * 100);
        console.log(`Total reduction: ${reductionPercent}%`);
        // Send content processed message
        await progress.success(`Content processed: ${Math.round(htmlContent.length / 1024)}KB → ${Math.round(cleanHtml.length / 1024)}KB (${reductionPercent}% reduction)`, {
            originalSize: htmlContent.length,
            cleanedSize: cleanHtml.length,
            reductionPercent
        });
        // Extract minimal data for analysis from cleaned content
        const mediaElements = extractMediaElements(document, event.url);
        const codeSnippets = extractCodeSnippets(document);
        const linkAnalysis = analyzeLinkStructure(document, event.url);
        // NEW: Validate internal links
        let linkValidationResult = { linkIssues: [], healthyLinks: 0 };
        if (linkAnalysis.internalLinksForValidation && linkAnalysis.internalLinksForValidation.length > 0) {
            linkValidationResult = await validateInternalLinks(linkAnalysis.internalLinksForValidation, progress);
        }
        // NEW: Enhanced Code Analysis
        let enhancedCodeAnalysis = { deprecatedCode: [], syntaxErrors: [] };
        if (codeSnippets.length > 0) {
            enhancedCodeAnalysis = await analyzeCodeSnippetsEnhanced(codeSnippets, progress);
        }
        // Context Analysis (if enabled)
        let contextAnalysisResult = null;
        if (event.contextAnalysis?.enabled) {
            console.log('Context analysis enabled, discovering related pages...');
            await progress.info('Discovering related pages...');
            const contextPages = discoverContextPages(document, event.url);
            console.log(`Found ${contextPages.length} potential context pages`);
            contextAnalysisResult = {
                contextPages,
                analysisScope: contextPages.length > 0 ? 'with-context' : 'single-page',
                totalPagesAnalyzed: 1 + contextPages.length
            };
            // Log discovered context pages
            contextPages.forEach(page => {
                console.log(`Context page (${page.relationship}): ${page.title} - ${page.url}`);
            });
            // Send context discovery message
            if (contextPages.length > 0) {
                await progress.success(`Context: ${contextPages.length} related pages discovered`, {
                    contextPages: contextPages.length
                });
            }
        }
        // Convert to Markdown with aggressive noise removal
        const turndownService = configureTurndownService();
        const markdownContent = turndownService.turndown(cleanHtml);
        console.log(`Final markdown size: ${markdownContent.length} chars`);
        console.log(`Converted to ${markdownContent.length} characters of clean Markdown`);
        const contentType = await detectContentTypeEnhanced(document, markdownContent, event.url);
        // Send content type detection message
        await progress.success(`Content type: ${contentType}`, {
            contentType
        });
        // Create processed content object
        const processedContent = {
            url: event.url,
            htmlContent: cleanHtml,
            markdownContent: markdownContent,
            mediaElements: mediaElements.slice(0, 10),
            codeSnippets: codeSnippets.slice(0, 15),
            contentType,
            linkAnalysis: {
                ...linkAnalysis,
                linkValidation: {
                    checkedLinks: linkValidationResult.linkIssues.length + linkValidationResult.healthyLinks,
                    linkIssueFindings: linkValidationResult.linkIssues,
                    healthyLinks: linkValidationResult.healthyLinks,
                    brokenLinks: linkValidationResult.linkIssues.filter(link => link.issueType === '404').length,
                    accessDeniedLinks: linkValidationResult.linkIssues.filter(link => link.issueType === 'access-denied').length,
                    timeoutLinks: linkValidationResult.linkIssues.filter(link => link.issueType === 'timeout').length,
                    otherErrors: linkValidationResult.linkIssues.filter(link => link.issueType === 'error').length
                }
            },
            enhancedCodeAnalysis: {
                deprecatedCodeFindings: enhancedCodeAnalysis.deprecatedCode,
                syntaxErrorFindings: enhancedCodeAnalysis.syntaxErrors,
                analyzedSnippets: codeSnippets.length,
                confidenceDistribution: {
                    high: [...enhancedCodeAnalysis.deprecatedCode, ...enhancedCodeAnalysis.syntaxErrors].filter(f => f.confidence === 'high').length,
                    medium: [...enhancedCodeAnalysis.deprecatedCode, ...enhancedCodeAnalysis.syntaxErrors].filter(f => f.confidence === 'medium').length,
                    low: [...enhancedCodeAnalysis.deprecatedCode, ...enhancedCodeAnalysis.syntaxErrors].filter(f => f.confidence === 'low').length
                }
            },
            contextAnalysis: contextAnalysisResult,
            processedAt: new Date().toISOString(),
            noiseReduction: {
                originalSize: htmlContent.length,
                cleanedSize: cleanHtml.length,
                reductionPercent: Math.round((1 - cleanHtml.length / htmlContent.length) * 100)
            }
        };
        // Update linkAnalysis.analysisScope based on context analysis
        if (contextAnalysisResult) {
            processedContent.linkAnalysis.analysisScope = contextAnalysisResult.analysisScope === 'with-context' ? 'with-context' : 'current-page-only';
        }
        // Update brokenLinks count in linkAnalysis (cast to any to add the property)
        processedContent.linkAnalysis.brokenLinks = linkValidationResult.linkIssues.filter(link => link.issueType === '404').length;
        processedContent.linkAnalysis.totalLinkIssues = linkValidationResult.linkIssues.length;
        // Store processed content in S3 session location
        const s3Key = `sessions/${event.sessionId}/processed-content.json`;
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
            Body: JSON.stringify(processedContent),
            ContentType: 'application/json'
        }));
        console.log(`Stored processed content in S3: ${s3Key}`);
        // Store session metadata
        await storeSessionMetadata(event);
        // Add cache metadata to indicate this was NOT from cache
        await addCacheMetadata(event.sessionId, false);
        // Step 3: Store in cache for future use (only if caching is enabled)
        if (cacheEnabled) {
            await storeProcessedContentInCache(event.url, processedContent, contextualSetting);
        }
        else {
            console.log('⚠️ Cache disabled - skipping cache storage');
        }
        // Return ONLY minimal success status - no data at all
        return {
            success: true,
            sessionId: event.sessionId,
            message: 'Content processed and cached'
        };
    }
    catch (error) {
        console.error('URL processing failed:', error);
        return {
            success: false,
            sessionId: event.sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};
exports.handler = handler;
async function checkProcessedContentCache(url, contextualSetting) {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping cache check');
            return null;
        }
        // Clean URL to normalize it (remove fragments, normalize query params)
        const cleanUrl = normalizeUrl(url);
        const response = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: tableName,
            Key: (0, util_dynamodb_1.marshall)({
                url: cleanUrl,
                contextualSetting: contextualSetting
            })
        }));
        if (response.Item) {
            const cacheEntry = (0, util_dynamodb_1.unmarshall)(response.Item);
            console.log(`Cache entry found for ${cleanUrl} (context: ${contextualSetting}), processed at ${cacheEntry.processedAt}`);
            console.log(`Cache S3 location: ${cacheEntry.s3Location}`);
            return cacheEntry;
        }
        console.log(`No cache entry found for ${cleanUrl} (context: ${contextualSetting})`);
        return null;
    }
    catch (error) {
        console.error('Cache check failed:', error);
        return null; // Graceful degradation - continue without cache
    }
}
function isCacheExpired(cacheEntry) {
    const now = Math.floor(Date.now() / 1000);
    return cacheEntry.ttl < now;
}
async function copyCachedContentToSession(cacheS3Location, sessionId) {
    const bucketName = process.env.ANALYSIS_BUCKET;
    if (!bucketName) {
        throw new Error('ANALYSIS_BUCKET environment variable not set');
    }
    try {
        console.log(`Copying cached content from: ${cacheS3Location}`);
        // Get cached content from S3
        const cachedObject = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: cacheS3Location
        }));
        if (!cachedObject.Body) {
            throw new Error('Cached content body is empty');
        }
        const cachedContent = await cachedObject.Body.transformToString();
        // Store in session location
        const sessionKey = `sessions/${sessionId}/processed-content.json`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: sessionKey,
            Body: cachedContent,
            ContentType: 'application/json'
        }));
        console.log(`✅ Copied cached content from ${cacheS3Location} to session: ${sessionKey}`);
    }
    catch (error) {
        console.error('Failed to copy cached content:', error);
        throw error;
    }
}
async function storeSessionMetadata(event) {
    const bucketName = process.env.ANALYSIS_BUCKET;
    if (!bucketName) {
        throw new Error('ANALYSIS_BUCKET environment variable not set');
    }
    const metadataKey = `sessions/${event.sessionId}/metadata.json`;
    await s3Client.send(new client_s3_1.PutObjectCommand({
        Bucket: bucketName,
        Key: metadataKey,
        Body: JSON.stringify({
            url: event.url,
            selectedModel: event.selectedModel,
            sessionId: event.sessionId,
            startTime: event.analysisStartTime
        }),
        ContentType: 'application/json'
    }));
    console.log(`Stored session metadata in S3: ${metadataKey}`);
}
async function addCacheMetadata(sessionId, wasFromCache) {
    const bucketName = process.env.ANALYSIS_BUCKET;
    if (!bucketName) {
        throw new Error('ANALYSIS_BUCKET environment variable not set');
    }
    try {
        // Read the existing processed content
        const contentKey = `sessions/${sessionId}/processed-content.json`;
        const contentResponse = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: contentKey
        }));
        const contentStr = await contentResponse.Body.transformToString();
        const processedContent = JSON.parse(contentStr);
        // Add cache metadata
        processedContent.cacheMetadata = {
            wasFromCache,
            retrievedAt: new Date().toISOString()
        };
        // Write it back
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: contentKey,
            Body: JSON.stringify(processedContent),
            ContentType: 'application/json'
        }));
        console.log(`Added cache metadata: wasFromCache=${wasFromCache}`);
    }
    catch (error) {
        console.error('Failed to add cache metadata:', error);
        // Don't throw - this is not critical
    }
}
async function storeProcessedContentInCache(url, processedContent, contextualSetting) {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!tableName || !bucketName) {
            console.log('Cache not configured, skipping cache storage');
            return;
        }
        // Calculate content hash for the processed content
        const contentHash = crypto.createHash('sha256')
            .update(processedContent.markdownContent)
            .digest('hex');
        // Clean URL to normalize it
        const cleanUrl = normalizeUrl(url);
        // Generate consistent session ID for cache storage
        const consistentSessionId = generateConsistentSessionId(url, contextualSetting);
        // Store processed content in S3 using consistent session ID path
        const cacheS3Key = `sessions/${consistentSessionId}/processed-content.json`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: cacheS3Key,
            Body: JSON.stringify(processedContent),
            ContentType: 'application/json'
        }));
        // Calculate TTL (7 days from now)
        const ttlDays = parseInt(process.env.CACHE_TTL_DAYS || '7');
        const ttl = Math.floor(Date.now() / 1000) + (ttlDays * 24 * 60 * 60);
        // Store index entry in DynamoDB with proper columns
        const cacheIndex = {
            url: cleanUrl,
            contextualSetting: contextualSetting,
            processedAt: new Date().toISOString(),
            contentHash: contentHash,
            s3Location: cacheS3Key,
            ttl: ttl,
            contentType: processedContent.contentType,
            noiseReductionMetrics: processedContent.noiseReduction
        };
        await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
            TableName: tableName,
            Item: (0, util_dynamodb_1.marshall)(cacheIndex)
        }));
        console.log(`Stored cache index for ${cleanUrl} (context: ${contextualSetting}) with TTL ${ttl}`);
        console.log(`Cache S3 location: ${cacheS3Key}`);
    }
    catch (error) {
        console.error('Failed to store in cache:', error);
        // Don't throw - caching failure shouldn't break the main flow
    }
}
function extractMediaElements(document, baseUrl) {
    const mediaElements = [];
    // Extract images
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        mediaElements.push({
            type: 'image',
            src: img.src,
            alt: img.alt || undefined,
            caption: img.title || undefined,
            analysisNote: img.alt ? 'Has alt text' : 'Missing alt text - accessibility concern'
        });
    });
    // Extract videos
    const videos = document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]');
    videos.forEach(video => {
        const src = video.getAttribute('src') || '';
        mediaElements.push({
            type: 'video',
            src,
            analysisNote: 'Video content - consider accessibility and loading impact'
        });
    });
    // Extract interactive elements
    const interactives = document.querySelectorAll('form, button[onclick], [data-interactive]');
    interactives.forEach(() => {
        mediaElements.push({
            type: 'interactive',
            src: '',
            analysisNote: 'Interactive element - may affect documentation usability'
        });
    });
    return mediaElements;
}
function extractCodeSnippets(document) {
    const codeSnippets = [];
    const codeBlocks = document.querySelectorAll('pre code, code');
    codeBlocks.forEach((codeElement, index) => {
        const code = codeElement.textContent || '';
        if (code.trim().length < 10)
            return; // Skip very short snippets
        const language = detectLanguageFromClass(codeElement.className) ||
            detectLanguageFromContent(code);
        codeSnippets.push({
            language,
            code: code.trim().slice(0, 1000),
            lineNumber: index + 1,
            hasVersionInfo: checkForVersionInfo(code)
        });
    });
    return codeSnippets;
}
/**
 * Check if two hostnames are related domains that should be validated together
 * This includes same organization subdomains and common documentation patterns
 */
function isRelatedDomain(linkHostname, baseHostname) {
    // Same hostname (already handled by caller, but included for completeness)
    if (linkHostname === baseHostname) {
        return true;
    }
    // Extract root domains
    const getRootDomain = (hostname) => {
        const parts = hostname.split('.');
        if (parts.length >= 2) {
            return parts.slice(-2).join('.');
        }
        return hostname;
    };
    const linkRoot = getRootDomain(linkHostname);
    const baseRoot = getRootDomain(baseHostname);
    // Same root domain (e.g., docs.x.com and developer.x.com)
    if (linkRoot === baseRoot) {
        return true;
    }
    // Additional cross-domain patterns for organizations that use different root domains
    const crossDomainPatterns = [
        // X/Twitter ecosystem (different root domains)
        ['x.com', 'twitter.com'],
        // GitHub ecosystem
        ['github.com', 'github.io', 'githubapp.com'],
        // Google ecosystem
        ['google.com', 'googleapis.com', 'googleusercontent.com', 'gstatic.com'],
        // Amazon/AWS ecosystem
        ['amazon.com', 'amazonaws.com', 'awsstatic.com'],
        // Microsoft ecosystem
        ['microsoft.com', 'microsoftonline.com', 'azure.com', 'office.com'],
        // Meta/Facebook ecosystem
        ['facebook.com', 'fbcdn.net', 'instagram.com'],
        // Atlassian ecosystem
        ['atlassian.com', 'atlassian.net', 'bitbucket.org'],
        // Salesforce ecosystem
        ['salesforce.com', 'force.com', 'herokuapp.com']
    ];
    // Check if both root domains are in the same cross-domain pattern group
    for (const pattern of crossDomainPatterns) {
        if (pattern.includes(linkRoot) && pattern.includes(baseRoot)) {
            return true;
        }
    }
    return false;
}
function analyzeLinkStructure(document, baseUrl) {
    const links = document.querySelectorAll('a[href]');
    const baseUrlObj = new URL(baseUrl);
    let totalLinks = 0;
    let internalLinks = 0;
    let externalLinks = 0;
    const subPagesIdentified = [];
    const internalLinksForValidation = [];
    links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href)
            return;
        // Skip non-HTTP links
        if (href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('javascript:') ||
            href.startsWith('#')) {
            return;
        }
        totalLinks++;
        try {
            const linkUrl = new URL(href, baseUrl);
            // Check if it's an internal link (same hostname) or related domain link
            const isInternalLink = linkUrl.hostname === baseUrlObj.hostname;
            const isRelatedDomainLink = isRelatedDomain(linkUrl.hostname, baseUrlObj.hostname);
            if (isInternalLink || isRelatedDomainLink) {
                internalLinks++;
                // Store internal and related domain links for validation
                internalLinksForValidation.push({
                    url: linkUrl.href,
                    anchorText: link.textContent?.trim() || href,
                    element: link
                });
                if (linkUrl.pathname !== baseUrlObj.pathname) {
                    const linkText = link.textContent?.trim() || '';
                    if (linkText && !subPagesIdentified.includes(linkText)) {
                        subPagesIdentified.push(linkText);
                    }
                }
            }
            else {
                externalLinks++;
            }
        }
        catch {
            externalLinks++;
        }
    });
    return {
        totalLinks,
        internalLinks,
        externalLinks,
        subPagesIdentified: subPagesIdentified.slice(0, 10),
        linkContext: subPagesIdentified.length > 0 ? 'multi-page-referenced' : 'single-page',
        analysisScope: 'current-page-only',
        internalLinksForValidation // NEW: Links to validate
    };
}
// NEW: Link validation function for internal and related domain links
async function validateInternalLinks(linksToValidate, progress) {
    if (linksToValidate.length === 0) {
        return { linkIssues: [], healthyLinks: 0 };
    }
    // Deduplicate links by URL before validation to avoid redundant HTTP requests
    const uniqueLinksMap = new Map();
    linksToValidate.forEach(link => {
        if (!uniqueLinksMap.has(link.url)) {
            uniqueLinksMap.set(link.url, link);
        }
    });
    const uniqueLinks = Array.from(uniqueLinksMap.values());
    await progress.info(`Checking ${uniqueLinks.length} unique internal and related domain links for accessibility...`);
    const linkIssues = [];
    let healthyLinks = 0;
    const maxConcurrent = 10;
    const timeout = 5000; // 5 seconds
    // Process links in batches to avoid overwhelming the server
    for (let i = 0; i < uniqueLinks.length; i += maxConcurrent) {
        const batch = uniqueLinks.slice(i, i + maxConcurrent);
        const promises = batch.map(async (linkInfo) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                const response = await fetch(linkInfo.url, {
                    method: 'HEAD',
                    headers: {
                        'User-Agent': 'Lensy Documentation Quality Auditor/1.0'
                    },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.status === 404) {
                    const linkIssue = {
                        url: linkInfo.url,
                        status: 404,
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Page not found',
                        issueType: '404'
                    };
                    linkIssues.push(linkIssue);
                    await progress.info(`⚠ Broken link (404): ${linkInfo.url}`);
                }
                else if (response.status === 403) {
                    const linkIssue = {
                        url: linkInfo.url,
                        status: 403,
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Access denied (403 Forbidden)',
                        issueType: 'access-denied'
                    };
                    linkIssues.push(linkIssue);
                    await progress.info(`⚠ Link issue (403): ${linkInfo.url}`);
                }
                else if (response.status >= 400) {
                    const linkIssue = {
                        url: linkInfo.url,
                        status: response.status,
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
                        issueType: 'error'
                    };
                    linkIssues.push(linkIssue);
                    await progress.info(`⚠ Link issue (${response.status}): ${linkInfo.url}`);
                }
                else {
                    healthyLinks++;
                }
            }
            catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    const linkIssue = {
                        url: linkInfo.url,
                        status: 'timeout',
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Request timeout (>5 seconds)',
                        issueType: 'timeout'
                    };
                    linkIssues.push(linkIssue);
                    await progress.info(`⚠ Link timeout: ${linkInfo.url}`);
                }
                else {
                    const linkIssue = {
                        url: linkInfo.url,
                        status: 'error',
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: error instanceof Error ? error.message : 'Unknown error',
                        issueType: 'error'
                    };
                    linkIssues.push(linkIssue);
                    await progress.info(`⚠ Link error: ${linkInfo.url} (${error instanceof Error ? error.message : 'Unknown error'})`);
                }
            }
        });
        await Promise.all(promises);
    }
    // Deduplicate link issues by URL (in case of any edge cases)
    const uniqueLinkIssuesMap = new Map();
    linkIssues.forEach(link => {
        if (!uniqueLinkIssuesMap.has(link.url)) {
            uniqueLinkIssuesMap.set(link.url, link);
        }
    });
    const uniqueLinkIssues = Array.from(uniqueLinkIssuesMap.values());
    // Count broken links (404s only)
    const brokenLinksCount = uniqueLinkIssues.filter(link => link.issueType === '404').length;
    const totalIssuesCount = uniqueLinkIssues.length;
    if (brokenLinksCount > 0 && brokenLinksCount === totalIssuesCount) {
        await progress.success(`✓ Link check complete: ${brokenLinksCount} broken (404), ${healthyLinks} healthy`);
    }
    else if (totalIssuesCount > 0) {
        await progress.success(`✓ Link check complete: ${brokenLinksCount} broken (404), ${totalIssuesCount - brokenLinksCount} other issues, ${healthyLinks} healthy`);
    }
    else {
        await progress.success(`✓ Link check complete: All ${healthyLinks} links healthy`);
    }
    return { linkIssues: uniqueLinkIssues, healthyLinks };
}
// NEW: Enhanced Code Analysis function
async function analyzeCodeSnippetsEnhanced(codeSnippets, progress) {
    if (codeSnippets.length === 0) {
        return { deprecatedCode: [], syntaxErrors: [] };
    }
    await progress.info(`Analyzing ${codeSnippets.length} code snippets for deprecation and syntax issues...`);
    const deprecatedCode = [];
    const syntaxErrors = [];
    // Process code snippets in batches to avoid overwhelming the LLM
    const batchSize = 3;
    for (let i = 0; i < codeSnippets.length; i += batchSize) {
        const batch = codeSnippets.slice(i, i + batchSize);
        for (const snippet of batch) {
            try {
                // Skip very short or simple code snippets to avoid false positives
                if (snippet.code.trim().length < 20 || isSimpleCode(snippet.code)) {
                    continue;
                }
                const analysis = await analyzeCodeSnippetWithLLM(snippet, i + 1);
                if (analysis.deprecatedCode.length > 0) {
                    deprecatedCode.push(...analysis.deprecatedCode);
                    for (const deprecated of analysis.deprecatedCode) {
                        await progress.info(`⚠ Deprecated: ${deprecated.method} in code block ${i + 1}`);
                    }
                }
                if (analysis.syntaxErrors.length > 0) {
                    syntaxErrors.push(...analysis.syntaxErrors);
                    for (const error of analysis.syntaxErrors) {
                        await progress.info(`✗ Syntax error: ${error.description} in code block ${i + 1}`);
                    }
                }
            }
            catch (error) {
                console.error(`Failed to analyze code snippet ${i + 1}:`, error);
                // Continue with other snippets
            }
        }
    }
    await progress.success(`✓ Code analysis complete: ${deprecatedCode.length} deprecated, ${syntaxErrors.length} syntax errors`);
    return { deprecatedCode, syntaxErrors };
}
// Helper function to check if code is too simple to analyze
function isSimpleCode(code) {
    const trimmed = code.trim();
    // Skip single-line comments or very short snippets
    if (trimmed.length < 20)
        return true;
    // Skip pure CSS (already filtered out in markdown processing)
    if (trimmed.includes('{') && trimmed.includes(':') && trimmed.includes(';') && !trimmed.includes('function')) {
        return true;
    }
    // Skip simple HTML tags
    if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.split('\n').length < 3) {
        return true;
    }
    // Skip configuration files without code logic
    if (trimmed.includes('=') && !trimmed.includes('function') && !trimmed.includes('class') && trimmed.split('\n').length < 5) {
        return true;
    }
    return false;
}
// LLM-based code analysis function
async function analyzeCodeSnippetWithLLM(snippet, blockNumber) {
    const prompt = `Analyze this ${snippet.language || 'unknown'} code snippet for deprecated methods and syntax errors.

Code snippet (block ${blockNumber}):
\`\`\`${snippet.language || ''}
${snippet.code}
\`\`\`

Please identify:
1. Deprecated methods, functions, or patterns with version information
2. Definite syntax errors that would prevent code execution

Return your analysis in this JSON format:
{
  "deprecatedCode": [
    {
      "language": "javascript",
      "method": "componentWillMount",
      "location": "code block ${blockNumber}, line 5",
      "deprecatedIn": "React 16.3",
      "removedIn": "React 17",
      "replacement": "useEffect() or componentDidMount()",
      "confidence": "high",
      "codeFragment": "componentWillMount() {"
    }
  ],
  "syntaxErrors": [
    {
      "language": "python",
      "location": "code block ${blockNumber}, line 8",
      "errorType": "SyntaxError",
      "description": "Unclosed string literal",
      "codeFragment": "message = \\"Hello world",
      "confidence": "high"
    }
  ]
}

Important guidelines:
- Only report HIGH CONFIDENCE findings to avoid false positives
- For deprecated code: Include specific version information when known
- For syntax errors: Only report definite errors, not style issues
- Handle incomplete code snippets gracefully (snippets with "..." are often partial)
- Skip simple configuration or markup that isn't executable code
- If uncertain, mark confidence as "medium" or "low"`;
    try {
        const command = new client_bedrock_runtime_1.InvokeModelCommand({
            modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 1000,
                temperature: 0.1,
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })
        });
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiResponse = responseBody.content[0].text.trim();
        // Parse JSON response
        const analysisResult = JSON.parse(aiResponse);
        // Validate and clean the response
        const deprecatedCode = (analysisResult.deprecatedCode || []).map((item) => ({
            language: item.language || snippet.language || 'unknown',
            method: item.method || 'unknown',
            location: item.location || `code block ${blockNumber}`,
            deprecatedIn: item.deprecatedIn || 'unknown version',
            removedIn: item.removedIn,
            replacement: item.replacement || 'see documentation',
            confidence: item.confidence || 'medium',
            codeFragment: item.codeFragment || item.method || ''
        }));
        const syntaxErrors = (analysisResult.syntaxErrors || []).map((item) => ({
            language: item.language || snippet.language || 'unknown',
            location: item.location || `code block ${blockNumber}`,
            errorType: item.errorType || 'SyntaxError',
            description: item.description || 'syntax error detected',
            codeFragment: item.codeFragment || '',
            confidence: item.confidence || 'medium'
        }));
        return { deprecatedCode, syntaxErrors };
    }
    catch (error) {
        console.error('LLM code analysis failed:', error);
        return { deprecatedCode: [], syntaxErrors: [] };
    }
}
function discoverContextPages(document, baseUrl) {
    const contextPages = [];
    const baseUrlObj = new URL(baseUrl);
    const pathSegments = baseUrlObj.pathname.split('/').filter(Boolean);
    // Find parent page (one level up)
    if (pathSegments.length > 1) {
        const parentPath = '/' + pathSegments.slice(0, -1).join('/') + '/';
        const parentUrl = `${baseUrlObj.protocol}//${baseUrlObj.hostname}${parentPath}`;
        // Look for breadcrumb or navigation that might indicate parent title
        const breadcrumbs = document.querySelectorAll('.breadcrumb a, .breadcrumbs a, nav a');
        let parentTitle = 'Parent Documentation';
        breadcrumbs.forEach(link => {
            const href = link.getAttribute('href');
            if (href && href.includes(parentPath)) {
                parentTitle = link.textContent?.trim() || parentTitle;
            }
        });
        contextPages.push({
            url: parentUrl,
            title: parentTitle,
            relationship: 'parent',
            confidence: 0.8
        });
    }
    // Find child pages from internal links
    const links = document.querySelectorAll('a[href]');
    const childPages = new Map();
    links.forEach(link => {
        const href = link.getAttribute('href');
        const linkText = link.textContent?.trim();
        if (!href || !linkText)
            return;
        try {
            const linkUrl = new URL(href, baseUrl);
            // Check if it's a child page (same domain, starts with current path)
            if (linkUrl.hostname === baseUrlObj.hostname &&
                linkUrl.pathname.startsWith(baseUrlObj.pathname) &&
                linkUrl.pathname !== baseUrlObj.pathname) {
                // Avoid duplicates and very long URLs
                if (!childPages.has(linkUrl.href) && linkUrl.pathname.length < 200) {
                    childPages.set(linkUrl.href, linkText);
                }
            }
        }
        catch {
            // Invalid URL, skip
        }
    });
    // Add top child pages (limit to 3)
    Array.from(childPages.entries()).slice(0, 3).forEach(([url, title]) => {
        contextPages.push({
            url,
            title,
            relationship: 'child',
            confidence: 0.7
        });
    });
    // Remove duplicates and limit total context pages
    const uniquePages = contextPages.filter((page, index, self) => index === self.findIndex(p => p.url === page.url));
    return uniquePages.slice(0, 5); // Max 5 context pages
}
// Layer 1: Fast keyword matching (90% of cases, free)
function detectByKeywords(url, title) {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    const searchText = `${urlLower} ${titleLower}`;
    console.log(`🔍 Keyword detection for: ${url}`);
    console.log(`📝 Title: ${title}`);
    // High-confidence keyword matches
    if (searchText.includes('/reference/functions/') ||
        searchText.includes('/reference/classes/') ||
        searchText.includes('/reference/hooks/') ||
        titleLower.includes('()') ||
        titleLower.includes('function') ||
        titleLower.includes('hook')) {
        console.log(`✅ Keyword match: api-reference`);
        return 'api-reference';
    }
    if (searchText.includes('getting-started') ||
        searchText.includes('/tutorial') ||
        titleLower.includes('tutorial') ||
        titleLower.includes('getting started')) {
        console.log(`✅ Keyword match: tutorial`);
        return 'tutorial';
    }
    if (searchText.includes('/explanations/') ||
        searchText.includes('/architecture/') ||
        titleLower.includes('architecture') ||
        titleLower.includes('understanding') ||
        titleLower.includes('explanation')) {
        console.log(`✅ Keyword match: conceptual`);
        return 'conceptual';
    }
    if (searchText.includes('how-to') ||
        searchText.includes('/guides/') ||
        titleLower.includes('how to') ||
        titleLower.includes('create') ||
        titleLower.includes('build')) {
        console.log(`✅ Keyword match: how-to`);
        return 'how-to';
    }
    if (searchText.includes('/intro') ||
        searchText.includes('introduction') ||
        titleLower.includes('introduction') ||
        titleLower.includes('intro')) {
        console.log(`✅ Keyword match: overview`);
        return 'overview';
    }
    if (searchText.includes('/reference-guides/') ||
        searchText.includes('/reference/') ||
        titleLower.includes('reference')) {
        console.log(`✅ Keyword match: reference`);
        return 'reference';
    }
    if (searchText.includes('/troubleshooting/') ||
        searchText.includes('/faq/') ||
        titleLower.includes('troubleshoot') ||
        titleLower.includes('faq')) {
        console.log(`✅ Keyword match: troubleshooting`);
        return 'troubleshooting';
    }
    if (searchText.includes('/changelog/') ||
        searchText.includes('/releases/') ||
        titleLower.includes('changelog') ||
        titleLower.includes('release')) {
        console.log(`✅ Keyword match: changelog`);
        return 'changelog';
    }
    console.log(`❌ No keyword match found`);
    return null; // No clear match - need AI fallback
}
// Layer 2: AI fallback for unclear cases (10% of cases, small cost)
async function detectByAI(url, title, description) {
    console.log(`🤖 Using AI fallback for content type detection`);
    const prompt = `Classify this documentation page type based on URL and metadata:

URL: ${url}
Title: ${title}
Description: ${description || 'N/A'}

Classify as ONE of these types:
- api-reference: Function/class documentation with parameters and return values
- tutorial: Step-by-step learning guide or getting started content
- conceptual: Architecture explanations, theory, or understanding concepts
- how-to: Task-focused guides for accomplishing specific goals
- overview: High-level introductions or summary pages
- reference: Tables, lists, specifications, or reference materials
- troubleshooting: Problem/solution format or FAQ content
- changelog: Version history or release notes
- mixed: Unclear or combination of multiple types

Respond with just the type name (e.g., "api-reference").`;
    try {
        const command = new client_bedrock_runtime_1.InvokeModelCommand({
            modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 50,
                temperature: 0.1,
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })
        });
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiResponse = responseBody.content[0].text.trim().toLowerCase();
        console.log(`🎯 AI response: ${aiResponse}`);
        // Validate AI response
        const validTypes = [
            'api-reference', 'tutorial', 'conceptual', 'how-to',
            'overview', 'reference', 'troubleshooting', 'changelog', 'mixed'
        ];
        if (validTypes.includes(aiResponse)) {
            return aiResponse;
        }
        else {
            console.log(`⚠️ Invalid AI response, defaulting to mixed`);
            return 'mixed';
        }
    }
    catch (error) {
        console.error('AI content type detection failed:', error);
        return 'mixed'; // Fallback to mixed on error
    }
}
// Complete detection with caching
async function detectContentTypeEnhanced(document, markdownContent, url) {
    // Layer 1: Fast keyword detection (90% of cases)
    const keywordType = detectByKeywords(url, document.title);
    if (keywordType) {
        console.log(`✅ Content type detected by keywords: ${keywordType}`);
        return keywordType;
    }
    // Layer 2: AI fallback for unclear cases (10% of cases)
    console.log(`🤖 Using AI fallback for unclear URL: ${url}`);
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || undefined;
    const aiType = await detectByAI(url, document.title, metaDescription);
    console.log(`🎯 Content type detected by AI: ${aiType}`);
    return aiType;
}
// Legacy function for backward compatibility (will be replaced)
function detectContentType(document, markdownContent) {
    // This is the old function - we'll replace calls to this with detectContentTypeEnhanced
    const title = document.title.toLowerCase();
    const content = markdownContent.toLowerCase();
    if (title.includes('api') || content.includes('endpoint')) {
        return 'api-docs';
    }
    if (title.includes('tutorial') || title.includes('guide')) {
        return 'tutorial';
    }
    if (title.includes('reference') || title.includes('documentation')) {
        return 'reference';
    }
    return 'mixed';
}
function detectLanguageFromClass(className) {
    const langMatch = className.match(/(?:lang-|language-)([a-zA-Z0-9]+)/);
    if (langMatch) {
        return langMatch[1].toLowerCase();
    }
    if (className.includes('php'))
        return 'php';
    if (className.includes('js') || className.includes('javascript'))
        return 'javascript';
    if (className.includes('css'))
        return 'css';
    if (className.includes('html'))
        return 'html';
    return '';
}
function detectLanguageFromContent(code) {
    if (code.includes('<?php') || code.includes('->')) {
        return 'php';
    }
    if (code.includes('function') || code.includes('const ') || code.includes('=>')) {
        return 'javascript';
    }
    if (code.includes('{') && code.includes(':') && code.includes(';')) {
        return 'css';
    }
    if (code.includes('<') && code.includes('>')) {
        return 'html';
    }
    return 'text';
}
function checkForVersionInfo(code) {
    const versionPatterns = [
        /since\s+wordpress\s+\d+\.\d+/i,
        /wp\s+\d+\.\d+/i,
        /version\s+\d+\.\d+/i,
        /@since\s+\d+\.\d+/i
    ];
    return versionPatterns.some(pattern => pattern.test(code));
}
/**
 * Remove noise elements from document before conversion
 * Enhanced removal focusing on CSS/JS noise
 */
function removeNoiseElements(document) {
    const noiseSelectors = [
        // Scripts and styles (CRITICAL for removing CSS/JS noise!)
        'script', 'style', 'noscript', 'link[rel="stylesheet"]',
        // Navigation and UI chrome
        'nav', 'header', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        // WordPress.org specific noise
        '.site-header', '.site-footer', '.site-navigation',
        '#secondary', '.navigation', '.breadcrumb', '.breadcrumbs',
        '.edit-link', '.post-navigation', '.comments-area',
        '#wporg-header', '#wporg-footer', '#wporg-sidebar',
        '.wp-block-wporg-sidebar-container',
        '.wp-block-social-links', '.wp-block-navigation',
        // Common noise patterns
        '.advertisement', '.ad', '.ads', '.sidebar', '.comments',
        '.cookie-notice', '.gdpr-notice', '.privacy-notice',
        '.social-share', '.share-buttons', '.related-posts',
        '.author-bio', '.post-meta', '.entry-meta',
        // Form elements (usually not documentation content)
        'form', 'input', 'button[type="submit"]', 'textarea',
        // Hidden elements
        '[style*="display:none"]', '[style*="visibility:hidden"]',
        '.hidden', '.sr-only', '.screen-reader-text',
        // Embeds and widgets
        'iframe', 'embed', 'object', 'video', 'audio',
        '.widget', '.wp-widget', '.sidebar-widget',
        // Skip links and accessibility helpers (not content)
        '.skip-link', '.skip-to-content',
        // WordPress admin and edit links
        '.edit-post-link', '.admin-bar', '#wpadminbar'
    ];
    let removedCount = 0;
    noiseSelectors.forEach(selector => {
        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                el.remove();
                removedCount++;
            });
        }
        catch (e) {
            console.log(`Error with selector ${selector}:`, e instanceof Error ? e.message : String(e));
        }
    });
    return removedCount;
}
/**
 * Extract main content with better content detection
 */
function extractMainContent(document) {
    // Strategy 1: WordPress.org specific content containers
    const wpSelectors = [
        '.entry-content',
        '.post-content',
        'main .entry-content',
        'article .entry-content',
        '.content-area main'
    ];
    for (const selector of wpSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.trim().length > 500) {
            console.log(`Found main content using: ${selector}`);
            return element;
        }
    }
    // Strategy 2: Generic content containers
    const genericSelectors = ['main', 'article', '[role="main"]', '#content'];
    for (const selector of genericSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.trim().length > 500) {
            console.log(`Found main content using: ${selector}`);
            return element;
        }
    }
    console.log('Fallback to document body');
    return document.body;
}
/**
 * Configure Turndown service with aggressive noise removal using built-in methods
 */
function configureTurndownService() {
    const turndown = new turndown_1.default({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
    });
    // Add GitHub Flavored Markdown support (tables, strikethrough, etc.)
    turndown.use(turndown_plugin_gfm_1.gfm);
    // AGGRESSIVE noise removal using Turndown's built-in remove() method
    turndown.remove([
        // Scripts and styles (CRITICAL!)
        'script', 'style', 'noscript', 'link',
        // Navigation and chrome
        'nav', 'footer', 'header', 'aside',
        // Forms and inputs
        'form', 'input', 'button', 'textarea', 'select', 'option',
        // Media and embeds
        'iframe', 'embed', 'object', 'video', 'audio',
        // Meta and hidden content
        'meta', 'title', 'base'
    ]);
    // Custom rule for WordPress callouts/notices
    turndown.addRule('callout', {
        filter: (node) => {
            return node.nodeName === 'DIV' &&
                /notice|warning|info|tip|alert/.test(node.className || '');
        },
        replacement: (content, node) => {
            const className = node.className || '';
            let type = 'Note';
            if (/warning|caution/.test(className))
                type = 'Warning';
            if (/info|note/.test(className))
                type = 'Note';
            if (/tip|hint/.test(className))
                type = 'Tip';
            if (/error|danger/.test(className))
                type = 'Error';
            return `\n> **${type}:** ${content.trim()}\n`;
        }
    });
    // Enhanced code block handling with language detection
    turndown.addRule('codeBlock', {
        filter: (node) => {
            return node.nodeName === 'PRE' && node.querySelector('code');
        },
        replacement: (content, node) => {
            const code = node.querySelector('code');
            const className = code?.className || '';
            // Detect language from class
            let lang = '';
            const langMatch = className.match(/language-(\w+)|lang-(\w+)/);
            if (langMatch) {
                lang = langMatch[1] || langMatch[2];
            }
            else if (className.includes('php')) {
                lang = 'php';
            }
            else if (className.includes('js') || className.includes('javascript')) {
                lang = 'javascript';
            }
            else if (className.includes('css')) {
                lang = 'css';
            }
            else if (className.includes('html')) {
                lang = 'html';
            }
            else if (className.includes('bash') || className.includes('shell')) {
                lang = 'bash';
            }
            const text = code?.textContent || '';
            return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
        }
    });
    return turndown;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLGtEQUFrRjtBQUNsRiw0RUFBMkY7QUFDM0YsOERBQTBGO0FBQzFGLDBEQUE4RDtBQUM5RCxpQ0FBOEI7QUFDOUIsd0RBQXVDO0FBQ3ZDLDZEQUEwQztBQUMxQywrQ0FBaUM7QUFDakMsNkRBQXlEO0FBaUZ6RCxNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNqRixNQUFNLGFBQWEsR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFDbEcsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFFM0Y7OztHQUdHO0FBQ0gsU0FBUywyQkFBMkIsQ0FBQyxHQUFXLEVBQUUsaUJBQXlCO0lBQ3ZFLE1BQU0sYUFBYSxHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUN4QyxNQUFNLEtBQUssR0FBRyxHQUFHLGFBQWEsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO0lBQ3RELE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNyRSxPQUFPLFdBQVcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQztBQUM5QyxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gs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QUFNLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsRUFBRTtnQkFDbkMsSUFBSSxHQUFHLE1BQU0sQ0FBQzthQUNqQjtpQkFBTSxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRTtnQkFDbEUsSUFBSSxHQUFHLE1BQU0sQ0FBQzthQUNqQjtZQUVELE1BQU0sSUFBSSxHQUFHLElBQUksRUFBRSxXQUFXLElBQUksRUFBRSxDQUFDO1lBQ3JDLE9BQU8sV0FBVyxJQUFJLEtBQUssSUFBSSxZQUFZLENBQUM7UUFDaEQsQ0FBQztLQUNKLENBQUMsQ0FBQztJQUVILE9BQU8sUUFBUSxDQUFDO0FBQ3BCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBTM0NsaWVudCwgUHV0T2JqZWN0Q29tbWFuZCwgR2V0T2JqZWN0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XG5pbXBvcnQgeyBCZWRyb2NrUnVudGltZUNsaWVudCwgSW52b2tlTW9kZWxDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZSc7XG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgR2V0SXRlbUNvbW1hbmQsIFB1dEl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IG1hcnNoYWxsLCB1bm1hcnNoYWxsIH0gZnJvbSAnQGF3cy1zZGsvdXRpbC1keW5hbW9kYic7XG5pbXBvcnQgeyBKU0RPTSB9IGZyb20gJ2pzZG9tJztcbmltcG9ydCBUdXJuZG93blNlcnZpY2UgZnJvbSAndHVybmRvd24nO1xuaW1wb3J0IHsgZ2ZtIH0gZnJvbSAndHVybmRvd24tcGx1Z2luLWdmbSc7XG5pbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IFByb2dyZXNzUHVibGlzaGVyIH0gZnJvbSAnLi9wcm9ncmVzcy1wdWJsaXNoZXInO1xuXG4vLyBGb3JjZSByZWJ1aWxkIC0gY2FjaGUgZml4IGRlcGxveW1lbnQgd2l0aCBwcm9ncmVzcyBzdHJlYW1pbmdcblxuaW50ZXJmYWNlIFVSTFByb2Nlc3NvckV2ZW50IHtcbiAgICB1cmw6IHN0cmluZztcbiAgICBzZWxlY3RlZE1vZGVsOiBzdHJpbmc7XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgYW5hbHlzaXNTdGFydFRpbWU6IG51bWJlcjtcbiAgICBjb250ZXh0QW5hbHlzaXM/OiB7XG4gICAgICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgICAgIG1heENvbnRleHRQYWdlcz86IG51bWJlcjtcbiAgICB9O1xuICAgIGNhY2hlQ29udHJvbD86IHtcbiAgICAgICAgZW5hYmxlZDogYm9vbGVhbjtcbiAgICB9O1xufVxuXG5pbnRlcmZhY2UgVVJMUHJvY2Vzc29yUmVzcG9uc2Uge1xuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgUHJvY2Vzc2VkQ29udGVudEluZGV4IHtcbiAgICB1cmw6IHN0cmluZztcbiAgICBjb250ZXh0dWFsU2V0dGluZzogc3RyaW5nO1xuICAgIHByb2Nlc3NlZEF0OiBzdHJpbmc7XG4gICAgY29udGVudEhhc2g6IHN0cmluZztcbiAgICBzM0xvY2F0aW9uOiBzdHJpbmc7XG4gICAgdHRsOiBudW1iZXI7XG4gICAgY29udGVudFR5cGU6IHN0cmluZztcbiAgICBub2lzZVJlZHVjdGlvbk1ldHJpY3M6IHtcbiAgICAgICAgb3JpZ2luYWxTaXplOiBudW1iZXI7XG4gICAgICAgIGNsZWFuZWRTaXplOiBudW1iZXI7XG4gICAgICAgIHJlZHVjdGlvblBlcmNlbnQ6IG51bWJlcjtcbiAgICB9O1xufVxuXG5pbnRlcmZhY2UgQ29udGV4dFBhZ2Uge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgcmVsYXRpb25zaGlwOiAncGFyZW50JyB8ICdjaGlsZCcgfCAnc2libGluZyc7XG4gICAgY29uZmlkZW5jZTogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgTGlua0lzc3VlIHtcbiAgICB1cmw6IHN0cmluZztcbiAgICBzdGF0dXM6IG51bWJlciB8IHN0cmluZztcbiAgICBhbmNob3JUZXh0OiBzdHJpbmc7XG4gICAgc291cmNlTG9jYXRpb246IHN0cmluZztcbiAgICBlcnJvck1lc3NhZ2U6IHN0cmluZztcbiAgICBpc3N1ZVR5cGU6ICc0MDQnIHwgJ2Vycm9yJyB8ICd0aW1lb3V0JyB8ICdhY2Nlc3MtZGVuaWVkJztcbn1cblxuaW50ZXJmYWNlIERlcHJlY2F0ZWRDb2RlRmluZGluZyB7XG4gICAgbGFuZ3VhZ2U6IHN0cmluZztcbiAgICBtZXRob2Q6IHN0cmluZztcbiAgICBsb2NhdGlvbjogc3RyaW5nO1xuICAgIGRlcHJlY2F0ZWRJbjogc3RyaW5nO1xuICAgIHJlbW92ZWRJbj86IHN0cmluZztcbiAgICByZXBsYWNlbWVudDogc3RyaW5nO1xuICAgIGNvbmZpZGVuY2U6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG4gICAgY29kZUZyYWdtZW50OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBTeW50YXhFcnJvckZpbmRpbmcge1xuICAgIGxhbmd1YWdlOiBzdHJpbmc7XG4gICAgbG9jYXRpb246IHN0cmluZztcbiAgICBlcnJvclR5cGU6IHN0cmluZztcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAgIGNvZGVGcmFnbWVudDogc3RyaW5nO1xuICAgIGNvbmZpZGVuY2U6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG59XG5cbmludGVyZmFjZSBDb250ZXh0QW5hbHlzaXNSZXN1bHQge1xuICAgIGNvbnRleHRQYWdlczogQ29udGV4dFBhZ2VbXTtcbiAgICBhbmFseXNpc1Njb3BlOiAnc2luZ2xlLXBhZ2UnIHwgJ3dpdGgtY29udGV4dCc7XG4gICAgdG90YWxQYWdlc0FuYWx5emVkOiBudW1iZXI7XG59XG5cbmNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuY29uc3QgYmVkcm9ja0NsaWVudCA9IG5ldyBCZWRyb2NrUnVudGltZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuLyoqXG4gKiBHZW5lcmF0ZSBjb25zaXN0ZW50IHNlc3Npb24gSUQgYmFzZWQgb24gVVJMIGFuZCBjb250ZXh0IHNldHRpbmdcbiAqIFNhbWUgVVJMICsgY29udGV4dCBzZXR0aW5nID0gc2FtZSBzZXNzaW9uIElEID0gY2FjaGUgcmV1c2VcbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVDb25zaXN0ZW50U2Vzc2lvbklkKHVybDogc3RyaW5nLCBjb250ZXh0dWFsU2V0dGluZzogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkVXJsID0gbm9ybWFsaXplVXJsKHVybCk7XG4gICAgY29uc3QgaW5wdXQgPSBgJHtub3JtYWxpemVkVXJsfSMke2NvbnRleHR1YWxTZXR0aW5nfWA7XG4gICAgY29uc3QgaGFzaCA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoaW5wdXQpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgcmV0dXJuIGBzZXNzaW9uLSR7aGFzaC5zdWJzdHJpbmcoMCwgMTIpfWA7XG59XG5cbi8qKlxuICogTm9ybWFsaXplIFVSTCB0byBlbnN1cmUgY29uc2lzdGVudCBjYWNoaW5nXG4gKiAtIFJlbW92ZSBmcmFnbWVudHMgKCNzZWN0aW9uKVxuICogLSBTb3J0IHF1ZXJ5IHBhcmFtZXRlcnNcbiAqIC0gUmVtb3ZlIHRyYWlsaW5nIHNsYXNoZXNcbiAqIC0gQ29udmVydCB0byBsb3dlcmNhc2UgaG9zdG5hbWVcbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplVXJsKHVybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCB1cmxPYmogPSBuZXcgVVJMKHVybCk7XG5cbiAgICAgICAgLy8gUmVtb3ZlIGZyYWdtZW50XG4gICAgICAgIHVybE9iai5oYXNoID0gJyc7XG5cbiAgICAgICAgLy8gU29ydCBxdWVyeSBwYXJhbWV0ZXJzIGZvciBjb25zaXN0ZW5jeVxuICAgICAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHVybE9iai5zZWFyY2gpO1xuICAgICAgICBjb25zdCBzb3J0ZWRQYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKCk7XG4gICAgICAgIEFycmF5LmZyb20ocGFyYW1zLmtleXMoKSkuc29ydCgpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgIHNvcnRlZFBhcmFtcy5zZXQoa2V5LCBwYXJhbXMuZ2V0KGtleSkgfHwgJycpO1xuICAgICAgICB9KTtcbiAgICAgICAgdXJsT2JqLnNlYXJjaCA9IHNvcnRlZFBhcmFtcy50b1N0cmluZygpO1xuXG4gICAgICAgIC8vIFJlbW92ZSB0cmFpbGluZyBzbGFzaCBmcm9tIHBhdGhuYW1lIChleGNlcHQgZm9yIHJvb3QpXG4gICAgICAgIGlmICh1cmxPYmoucGF0aG5hbWUgIT09ICcvJyAmJiB1cmxPYmoucGF0aG5hbWUuZW5kc1dpdGgoJy8nKSkge1xuICAgICAgICAgICAgdXJsT2JqLnBhdGhuYW1lID0gdXJsT2JqLnBhdGhuYW1lLnNsaWNlKDAsIC0xKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExvd2VyY2FzZSBob3N0bmFtZSBmb3IgY29uc2lzdGVuY3lcbiAgICAgICAgdXJsT2JqLmhvc3RuYW1lID0gdXJsT2JqLmhvc3RuYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgcmV0dXJuIHVybE9iai50b1N0cmluZygpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignRmFpbGVkIHRvIG5vcm1hbGl6ZSBVUkwsIHVzaW5nIG9yaWdpbmFsOicsIHVybCk7XG4gICAgICAgIHJldHVybiB1cmw7XG4gICAgfVxufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxVUkxQcm9jZXNzb3JFdmVudCwgVVJMUHJvY2Vzc29yUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gICAgY29uc29sZS5sb2coJ1Byb2Nlc3NpbmcgVVJMOicsIGV2ZW50LnVybCk7XG5cbiAgICAvLyBJbml0aWFsaXplIHByb2dyZXNzIHB1Ymxpc2hlclxuICAgIGNvbnN0IHByb2dyZXNzID0gbmV3IFByb2dyZXNzUHVibGlzaGVyKGV2ZW50LnNlc3Npb25JZCk7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBTZW5kIGluaXRpYWwgcHJvZ3Jlc3NcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3MucHJvZ3Jlc3MoJ1Byb2Nlc3NpbmcgVVJMLi4uJywgJ3VybC1wcm9jZXNzaW5nJyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgY2FjaGluZyBpcyBlbmFibGVkIChkZWZhdWx0IHRvIHRydWUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkpXG4gICAgICAgIGNvbnN0IGNhY2hlRW5hYmxlZCA9IGV2ZW50LmNhY2hlQ29udHJvbD8uZW5hYmxlZCAhPT0gZmFsc2U7XG5cbiAgICAgICAgLy8gR2VuZXJhdGUgY29uc2lzdGVudCBzZXNzaW9uIElEIGJhc2VkIG9uIFVSTCArIGNvbnRleHQgc2V0dGluZ1xuICAgICAgICBjb25zdCBjb250ZXh0RW5hYmxlZCA9IGV2ZW50LmNvbnRleHRBbmFseXNpcz8uZW5hYmxlZCB8fCBmYWxzZTtcbiAgICAgICAgY29uc3QgY29udGV4dHVhbFNldHRpbmcgPSBjb250ZXh0RW5hYmxlZCA/ICd3aXRoLWNvbnRleHQnIDogJ3dpdGhvdXQtY29udGV4dCc7XG4gICAgICAgIGNvbnN0IGNvbnNpc3RlbnRTZXNzaW9uSWQgPSBnZW5lcmF0ZUNvbnNpc3RlbnRTZXNzaW9uSWQoZXZlbnQudXJsLCBjb250ZXh0dWFsU2V0dGluZyk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYEdlbmVyYXRlZCBjb25zaXN0ZW50IHNlc3Npb24gSUQ6ICR7Y29uc2lzdGVudFNlc3Npb25JZH0gKGNvbnRleHQ6ICR7Y29udGV4dEVuYWJsZWR9LCBjYWNoZTogJHtjYWNoZUVuYWJsZWR9KWApO1xuXG4gICAgICAgIC8vIFN0ZXAgMTogQ2hlY2sgY2FjaGUgZmlyc3QgdXNpbmcgY29uc2lzdGVudCBzZXNzaW9uIElEIChvbmx5IGlmIGNhY2hpbmcgaXMgZW5hYmxlZClcbiAgICAgICAgbGV0IGNhY2hlZENvbnRlbnQgPSBudWxsO1xuICAgICAgICBpZiAoY2FjaGVFbmFibGVkKSB7XG4gICAgICAgICAgICBjYWNoZWRDb250ZW50ID0gYXdhaXQgY2hlY2tQcm9jZXNzZWRDb250ZW50Q2FjaGUoZXZlbnQudXJsLCBjb250ZXh0dWFsU2V0dGluZyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pqg77iPIENhY2hlIGRpc2FibGVkIGJ5IHVzZXIgLSBza2lwcGluZyBjYWNoZSBjaGVjaycpO1xuICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbygn4pqg77iPIENhY2hlIGRpc2FibGVkIC0gcnVubmluZyBmcmVzaCBhbmFseXNpcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNhY2hlZENvbnRlbnQgJiYgIWlzQ2FjaGVFeHBpcmVkKGNhY2hlZENvbnRlbnQpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgQ2FjaGUgaGl0ISBVc2luZyBjYWNoZWQgY29udGVudCBmcm9tIHNlc3Npb246ICR7Y29uc2lzdGVudFNlc3Npb25JZH1gKTtcblxuICAgICAgICAgICAgLy8gU2VuZCBjYWNoZSBoaXQgbWVzc2FnZVxuICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuY2FjaGVIaXQoYENhY2hlIEhJVCEg4pqhIFVzaW5nIGNhY2hlZCBhbmFseXNpcyBmcm9tICR7bmV3IERhdGUoY2FjaGVkQ29udGVudC5wcm9jZXNzZWRBdCkudG9Mb2NhbGVEYXRlU3RyaW5nKCl9YCwge1xuICAgICAgICAgICAgICAgIGNhY2hlU3RhdHVzOiAnaGl0JyxcbiAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogY2FjaGVkQ29udGVudC5jb250ZW50VHlwZVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIENvcHkgY2FjaGVkIGNvbnRlbnQgdG8gY3VycmVudCBzZXNzaW9uIGxvY2F0aW9uIChpZiBkaWZmZXJlbnQpXG4gICAgICAgICAgICBpZiAoY29uc2lzdGVudFNlc3Npb25JZCAhPT0gZXZlbnQuc2Vzc2lvbklkKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgY29weUNhY2hlZENvbnRlbnRUb1Nlc3Npb24oY2FjaGVkQ29udGVudC5zM0xvY2F0aW9uLCBldmVudC5zZXNzaW9uSWQpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBBZGQgY2FjaGUgbWV0YWRhdGEgdG8gdGhlIHByb2Nlc3NlZCBjb250ZW50XG4gICAgICAgICAgICBhd2FpdCBhZGRDYWNoZU1ldGFkYXRhKGV2ZW50LnNlc3Npb25JZCwgdHJ1ZSk7XG5cbiAgICAgICAgICAgIC8vIFN0b3JlIHNlc3Npb24gbWV0YWRhdGFcbiAgICAgICAgICAgIGF3YWl0IHN0b3JlU2Vzc2lvbk1ldGFkYXRhKGV2ZW50KTtcblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlc3Npb25JZDogZXZlbnQuc2Vzc2lvbklkLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdSZXRyaWV2ZWQgZnJvbSBjYWNoZSdcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZygnQ2FjaGUgbWlzcyBvciBleHBpcmVkLCBwcm9jZXNzaW5nIGZyZXNoIGNvbnRlbnQuLi4nKTtcblxuICAgICAgICAvLyBTZW5kIGNhY2hlIG1pc3MgbWVzc2FnZSAob25seSBpZiBjYWNoZSB3YXMgZW5hYmxlZClcbiAgICAgICAgaWYgKGNhY2hlRW5hYmxlZCkge1xuICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuY2FjaGVNaXNzKCdDYWNoZSBNSVNTIC0gUnVubmluZyBmcmVzaCBhbmFseXNpcycsIHtcbiAgICAgICAgICAgICAgICBjYWNoZVN0YXR1czogJ21pc3MnXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyBGZXRjaCBIVE1MIGNvbnRlbnRcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbygnRmV0Y2hpbmcgYW5kIGNsZWFuaW5nIGNvbnRlbnQuLi4nKTtcblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGV2ZW50LnVybCwge1xuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdVc2VyLUFnZW50JzogJ0xlbnN5IERvY3VtZW50YXRpb24gUXVhbGl0eSBBdWRpdG9yLzEuMCdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfTogJHtyZXNwb25zZS5zdGF0dXNUZXh0fWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaHRtbENvbnRlbnQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBGZXRjaGVkICR7aHRtbENvbnRlbnQubGVuZ3RofSBjaGFyYWN0ZXJzIG9mIEhUTUwgY29udGVudGApO1xuXG4gICAgICAgIC8vIFBhcnNlIEhUTUwgd2l0aCBKU0RPTVxuICAgICAgICBjb25zdCBkb20gPSBuZXcgSlNET00oaHRtbENvbnRlbnQsIHsgdXJsOiBldmVudC51cmwgfSk7XG4gICAgICAgIGNvbnN0IGRvY3VtZW50ID0gZG9tLndpbmRvdy5kb2N1bWVudDtcblxuICAgICAgICBjb25zb2xlLmxvZyhgT3JpZ2luYWwgSFRNTCBzaXplOiAke2h0bWxDb250ZW50Lmxlbmd0aH0gY2hhcnNgKTtcblxuICAgICAgICAvLyBBR0dSRVNTSVZFIE5PSVNFIFJFRFVDVElPTjogUmVtb3ZlIG5vaXNlIGVsZW1lbnRzIGJlZm9yZSBwcm9jZXNzaW5nXG4gICAgICAgIGNvbnN0IHJlbW92ZWRDb3VudCA9IHJlbW92ZU5vaXNlRWxlbWVudHMoZG9jdW1lbnQpO1xuICAgICAgICBjb25zb2xlLmxvZyhgUmVtb3ZlZCAke3JlbW92ZWRDb3VudH0gbm9pc2UgZWxlbWVudHNgKTtcblxuICAgICAgICAvLyBFeHRyYWN0IG1haW4gY29udGVudCBhcmVhIHdpdGggYmV0dGVyIGNvbnRlbnQgZGV0ZWN0aW9uXG4gICAgICAgIGNvbnN0IG1haW5Db250ZW50ID0gZXh0cmFjdE1haW5Db250ZW50KGRvY3VtZW50KTtcbiAgICAgICAgY29uc3QgY2xlYW5IdG1sID0gbWFpbkNvbnRlbnQuaW5uZXJIVE1MO1xuICAgICAgICBjb25zb2xlLmxvZyhgQWZ0ZXIgY29udGVudCBleHRyYWN0aW9uOiAke2NsZWFuSHRtbC5sZW5ndGh9IGNoYXJzYCk7XG5cbiAgICAgICAgY29uc3QgcmVkdWN0aW9uUGVyY2VudCA9IE1hdGgucm91bmQoKDEgLSBjbGVhbkh0bWwubGVuZ3RoIC8gaHRtbENvbnRlbnQubGVuZ3RoKSAqIDEwMCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBUb3RhbCByZWR1Y3Rpb246ICR7cmVkdWN0aW9uUGVyY2VudH0lYCk7XG5cbiAgICAgICAgLy8gU2VuZCBjb250ZW50IHByb2Nlc3NlZCBtZXNzYWdlXG4gICAgICAgIGF3YWl0IHByb2dyZXNzLnN1Y2Nlc3MoYENvbnRlbnQgcHJvY2Vzc2VkOiAke01hdGgucm91bmQoaHRtbENvbnRlbnQubGVuZ3RoIC8gMTAyNCl9S0Ig4oaSICR7TWF0aC5yb3VuZChjbGVhbkh0bWwubGVuZ3RoIC8gMTAyNCl9S0IgKCR7cmVkdWN0aW9uUGVyY2VudH0lIHJlZHVjdGlvbilgLCB7XG4gICAgICAgICAgICBvcmlnaW5hbFNpemU6IGh0bWxDb250ZW50Lmxlbmd0aCxcbiAgICAgICAgICAgIGNsZWFuZWRTaXplOiBjbGVhbkh0bWwubGVuZ3RoLFxuICAgICAgICAgICAgcmVkdWN0aW9uUGVyY2VudFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBFeHRyYWN0IG1pbmltYWwgZGF0YSBmb3IgYW5hbHlzaXMgZnJvbSBjbGVhbmVkIGNvbnRlbnRcbiAgICAgICAgY29uc3QgbWVkaWFFbGVtZW50cyA9IGV4dHJhY3RNZWRpYUVsZW1lbnRzKGRvY3VtZW50LCBldmVudC51cmwpO1xuICAgICAgICBjb25zdCBjb2RlU25pcHBldHMgPSBleHRyYWN0Q29kZVNuaXBwZXRzKGRvY3VtZW50KTtcbiAgICAgICAgY29uc3QgbGlua0FuYWx5c2lzID0gYW5hbHl6ZUxpbmtTdHJ1Y3R1cmUoZG9jdW1lbnQsIGV2ZW50LnVybCk7XG5cbiAgICAgICAgLy8gTkVXOiBWYWxpZGF0ZSBpbnRlcm5hbCBsaW5rc1xuICAgICAgICBsZXQgbGlua1ZhbGlkYXRpb25SZXN1bHQ6IHsgbGlua0lzc3VlczogTGlua0lzc3VlW10sIGhlYWx0aHlMaW5rczogbnVtYmVyIH0gPSB7IGxpbmtJc3N1ZXM6IFtdLCBoZWFsdGh5TGlua3M6IDAgfTtcbiAgICAgICAgaWYgKGxpbmtBbmFseXNpcy5pbnRlcm5hbExpbmtzRm9yVmFsaWRhdGlvbiAmJiBsaW5rQW5hbHlzaXMuaW50ZXJuYWxMaW5rc0ZvclZhbGlkYXRpb24ubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgbGlua1ZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB2YWxpZGF0ZUludGVybmFsTGlua3MobGlua0FuYWx5c2lzLmludGVybmFsTGlua3NGb3JWYWxpZGF0aW9uLCBwcm9ncmVzcyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBORVc6IEVuaGFuY2VkIENvZGUgQW5hbHlzaXNcbiAgICAgICAgbGV0IGVuaGFuY2VkQ29kZUFuYWx5c2lzOiB7IGRlcHJlY2F0ZWRDb2RlOiBEZXByZWNhdGVkQ29kZUZpbmRpbmdbXSwgc3ludGF4RXJyb3JzOiBTeW50YXhFcnJvckZpbmRpbmdbXSB9ID0geyBkZXByZWNhdGVkQ29kZTogW10sIHN5bnRheEVycm9yczogW10gfTtcbiAgICAgICAgaWYgKGNvZGVTbmlwcGV0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBlbmhhbmNlZENvZGVBbmFseXNpcyA9IGF3YWl0IGFuYWx5emVDb2RlU25pcHBldHNFbmhhbmNlZChjb2RlU25pcHBldHMsIHByb2dyZXNzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbnRleHQgQW5hbHlzaXMgKGlmIGVuYWJsZWQpXG4gICAgICAgIGxldCBjb250ZXh0QW5hbHlzaXNSZXN1bHQ6IENvbnRleHRBbmFseXNpc1Jlc3VsdCB8IG51bGwgPSBudWxsO1xuICAgICAgICBpZiAoZXZlbnQuY29udGV4dEFuYWx5c2lzPy5lbmFibGVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnQ29udGV4dCBhbmFseXNpcyBlbmFibGVkLCBkaXNjb3ZlcmluZyByZWxhdGVkIHBhZ2VzLi4uJyk7XG4gICAgICAgICAgICBhd2FpdCBwcm9ncmVzcy5pbmZvKCdEaXNjb3ZlcmluZyByZWxhdGVkIHBhZ2VzLi4uJyk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbnRleHRQYWdlcyA9IGRpc2NvdmVyQ29udGV4dFBhZ2VzKGRvY3VtZW50LCBldmVudC51cmwpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7Y29udGV4dFBhZ2VzLmxlbmd0aH0gcG90ZW50aWFsIGNvbnRleHQgcGFnZXNgKTtcblxuICAgICAgICAgICAgY29udGV4dEFuYWx5c2lzUmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgIGNvbnRleHRQYWdlcyxcbiAgICAgICAgICAgICAgICBhbmFseXNpc1Njb3BlOiBjb250ZXh0UGFnZXMubGVuZ3RoID4gMCA/ICd3aXRoLWNvbnRleHQnIDogJ3NpbmdsZS1wYWdlJyxcbiAgICAgICAgICAgICAgICB0b3RhbFBhZ2VzQW5hbHl6ZWQ6IDEgKyBjb250ZXh0UGFnZXMubGVuZ3RoXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBMb2cgZGlzY292ZXJlZCBjb250ZXh0IHBhZ2VzXG4gICAgICAgICAgICBjb250ZXh0UGFnZXMuZm9yRWFjaChwYWdlID0+IHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgQ29udGV4dCBwYWdlICgke3BhZ2UucmVsYXRpb25zaGlwfSk6ICR7cGFnZS50aXRsZX0gLSAke3BhZ2UudXJsfWApO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFNlbmQgY29udGV4dCBkaXNjb3ZlcnkgbWVzc2FnZVxuICAgICAgICAgICAgaWYgKGNvbnRleHRQYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2VzcyhgQ29udGV4dDogJHtjb250ZXh0UGFnZXMubGVuZ3RofSByZWxhdGVkIHBhZ2VzIGRpc2NvdmVyZWRgLCB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHRQYWdlczogY29udGV4dFBhZ2VzLmxlbmd0aFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29udmVydCB0byBNYXJrZG93biB3aXRoIGFnZ3Jlc3NpdmUgbm9pc2UgcmVtb3ZhbFxuICAgICAgICBjb25zdCB0dXJuZG93blNlcnZpY2UgPSBjb25maWd1cmVUdXJuZG93blNlcnZpY2UoKTtcbiAgICAgICAgY29uc3QgbWFya2Rvd25Db250ZW50ID0gdHVybmRvd25TZXJ2aWNlLnR1cm5kb3duKGNsZWFuSHRtbCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBGaW5hbCBtYXJrZG93biBzaXplOiAke21hcmtkb3duQ29udGVudC5sZW5ndGh9IGNoYXJzYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb252ZXJ0ZWQgdG8gJHttYXJrZG93bkNvbnRlbnQubGVuZ3RofSBjaGFyYWN0ZXJzIG9mIGNsZWFuIE1hcmtkb3duYCk7XG5cbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSBhd2FpdCBkZXRlY3RDb250ZW50VHlwZUVuaGFuY2VkKGRvY3VtZW50LCBtYXJrZG93bkNvbnRlbnQsIGV2ZW50LnVybCk7XG5cbiAgICAgICAgLy8gU2VuZCBjb250ZW50IHR5cGUgZGV0ZWN0aW9uIG1lc3NhZ2VcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2VzcyhgQ29udGVudCB0eXBlOiAke2NvbnRlbnRUeXBlfWAsIHtcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBwcm9jZXNzZWQgY29udGVudCBvYmplY3RcbiAgICAgICAgY29uc3QgcHJvY2Vzc2VkQ29udGVudCA9IHtcbiAgICAgICAgICAgIHVybDogZXZlbnQudXJsLFxuICAgICAgICAgICAgaHRtbENvbnRlbnQ6IGNsZWFuSHRtbCwgLy8gU3RvcmUgY2xlYW5lZCBIVE1MLCBub3QgcmF3XG4gICAgICAgICAgICBtYXJrZG93bkNvbnRlbnQ6IG1hcmtkb3duQ29udGVudCwgLy8gQ2xlYW4gbWFya2Rvd25cbiAgICAgICAgICAgIG1lZGlhRWxlbWVudHM6IG1lZGlhRWxlbWVudHMuc2xpY2UoMCwgMTApLCAvLyBMaW1pdCBtZWRpYSBlbGVtZW50c1xuICAgICAgICAgICAgY29kZVNuaXBwZXRzOiBjb2RlU25pcHBldHMuc2xpY2UoMCwgMTUpLCAvLyBMaW1pdCBjb2RlIHNuaXBwZXRzXG4gICAgICAgICAgICBjb250ZW50VHlwZSxcbiAgICAgICAgICAgIGxpbmtBbmFseXNpczoge1xuICAgICAgICAgICAgICAgIC4uLmxpbmtBbmFseXNpcyxcbiAgICAgICAgICAgICAgICBsaW5rVmFsaWRhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICBjaGVja2VkTGlua3M6IGxpbmtWYWxpZGF0aW9uUmVzdWx0LmxpbmtJc3N1ZXMubGVuZ3RoICsgbGlua1ZhbGlkYXRpb25SZXN1bHQuaGVhbHRoeUxpbmtzLFxuICAgICAgICAgICAgICAgICAgICBsaW5rSXNzdWVGaW5kaW5nczogbGlua1ZhbGlkYXRpb25SZXN1bHQubGlua0lzc3VlcyxcbiAgICAgICAgICAgICAgICAgICAgaGVhbHRoeUxpbmtzOiBsaW5rVmFsaWRhdGlvblJlc3VsdC5oZWFsdGh5TGlua3MsXG4gICAgICAgICAgICAgICAgICAgIGJyb2tlbkxpbmtzOiBsaW5rVmFsaWRhdGlvblJlc3VsdC5saW5rSXNzdWVzLmZpbHRlcihsaW5rID0+IGxpbmsuaXNzdWVUeXBlID09PSAnNDA0JykubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICBhY2Nlc3NEZW5pZWRMaW5rczogbGlua1ZhbGlkYXRpb25SZXN1bHQubGlua0lzc3Vlcy5maWx0ZXIobGluayA9PiBsaW5rLmlzc3VlVHlwZSA9PT0gJ2FjY2Vzcy1kZW5pZWQnKS5sZW5ndGgsXG4gICAgICAgICAgICAgICAgICAgIHRpbWVvdXRMaW5rczogbGlua1ZhbGlkYXRpb25SZXN1bHQubGlua0lzc3Vlcy5maWx0ZXIobGluayA9PiBsaW5rLmlzc3VlVHlwZSA9PT0gJ3RpbWVvdXQnKS5sZW5ndGgsXG4gICAgICAgICAgICAgICAgICAgIG90aGVyRXJyb3JzOiBsaW5rVmFsaWRhdGlvblJlc3VsdC5saW5rSXNzdWVzLmZpbHRlcihsaW5rID0+IGxpbmsuaXNzdWVUeXBlID09PSAnZXJyb3InKS5sZW5ndGhcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZW5oYW5jZWRDb2RlQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICBkZXByZWNhdGVkQ29kZUZpbmRpbmdzOiBlbmhhbmNlZENvZGVBbmFseXNpcy5kZXByZWNhdGVkQ29kZSxcbiAgICAgICAgICAgICAgICBzeW50YXhFcnJvckZpbmRpbmdzOiBlbmhhbmNlZENvZGVBbmFseXNpcy5zeW50YXhFcnJvcnMsXG4gICAgICAgICAgICAgICAgYW5hbHl6ZWRTbmlwcGV0czogY29kZVNuaXBwZXRzLmxlbmd0aCxcbiAgICAgICAgICAgICAgICBjb25maWRlbmNlRGlzdHJpYnV0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgIGhpZ2g6IFsuLi5lbmhhbmNlZENvZGVBbmFseXNpcy5kZXByZWNhdGVkQ29kZSwgLi4uZW5oYW5jZWRDb2RlQW5hbHlzaXMuc3ludGF4RXJyb3JzXS5maWx0ZXIoZiA9PiBmLmNvbmZpZGVuY2UgPT09ICdoaWdoJykubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICBtZWRpdW06IFsuLi5lbmhhbmNlZENvZGVBbmFseXNpcy5kZXByZWNhdGVkQ29kZSwgLi4uZW5oYW5jZWRDb2RlQW5hbHlzaXMuc3ludGF4RXJyb3JzXS5maWx0ZXIoZiA9PiBmLmNvbmZpZGVuY2UgPT09ICdtZWRpdW0nKS5sZW5ndGgsXG4gICAgICAgICAgICAgICAgICAgIGxvdzogWy4uLmVuaGFuY2VkQ29kZUFuYWx5c2lzLmRlcHJlY2F0ZWRDb2RlLCAuLi5lbmhhbmNlZENvZGVBbmFseXNpcy5zeW50YXhFcnJvcnNdLmZpbHRlcihmID0+IGYuY29uZmlkZW5jZSA9PT0gJ2xvdycpLmxlbmd0aFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb250ZXh0QW5hbHlzaXM6IGNvbnRleHRBbmFseXNpc1Jlc3VsdCxcbiAgICAgICAgICAgIHByb2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgICAgICAgICAgIG9yaWdpbmFsU2l6ZTogaHRtbENvbnRlbnQubGVuZ3RoLFxuICAgICAgICAgICAgICAgIGNsZWFuZWRTaXplOiBjbGVhbkh0bWwubGVuZ3RoLFxuICAgICAgICAgICAgICAgIHJlZHVjdGlvblBlcmNlbnQ6IE1hdGgucm91bmQoKDEgLSBjbGVhbkh0bWwubGVuZ3RoIC8gaHRtbENvbnRlbnQubGVuZ3RoKSAqIDEwMClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBVcGRhdGUgbGlua0FuYWx5c2lzLmFuYWx5c2lzU2NvcGUgYmFzZWQgb24gY29udGV4dCBhbmFseXNpc1xuICAgICAgICBpZiAoY29udGV4dEFuYWx5c2lzUmVzdWx0KSB7XG4gICAgICAgICAgICBwcm9jZXNzZWRDb250ZW50LmxpbmtBbmFseXNpcy5hbmFseXNpc1Njb3BlID0gY29udGV4dEFuYWx5c2lzUmVzdWx0LmFuYWx5c2lzU2NvcGUgPT09ICd3aXRoLWNvbnRleHQnID8gJ3dpdGgtY29udGV4dCcgOiAnY3VycmVudC1wYWdlLW9ubHknO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXBkYXRlIGJyb2tlbkxpbmtzIGNvdW50IGluIGxpbmtBbmFseXNpcyAoY2FzdCB0byBhbnkgdG8gYWRkIHRoZSBwcm9wZXJ0eSlcbiAgICAgICAgKHByb2Nlc3NlZENvbnRlbnQubGlua0FuYWx5c2lzIGFzIGFueSkuYnJva2VuTGlua3MgPSBsaW5rVmFsaWRhdGlvblJlc3VsdC5saW5rSXNzdWVzLmZpbHRlcihsaW5rID0+IGxpbmsuaXNzdWVUeXBlID09PSAnNDA0JykubGVuZ3RoO1xuICAgICAgICAocHJvY2Vzc2VkQ29udGVudC5saW5rQW5hbHlzaXMgYXMgYW55KS50b3RhbExpbmtJc3N1ZXMgPSBsaW5rVmFsaWRhdGlvblJlc3VsdC5saW5rSXNzdWVzLmxlbmd0aDtcblxuICAgICAgICAvLyBTdG9yZSBwcm9jZXNzZWQgY29udGVudCBpbiBTMyBzZXNzaW9uIGxvY2F0aW9uXG4gICAgICAgIGNvbnN0IHMzS2V5ID0gYHNlc3Npb25zLyR7ZXZlbnQuc2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uYDtcbiAgICAgICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LkFOQUxZU0lTX0JVQ0tFVDtcblxuICAgICAgICBpZiAoIWJ1Y2tldE5hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQU5BTFlTSVNfQlVDS0VUIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBzM0tleSxcbiAgICAgICAgICAgIEJvZHk6IEpTT04uc3RyaW5naWZ5KHByb2Nlc3NlZENvbnRlbnQpLFxuICAgICAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYFN0b3JlZCBwcm9jZXNzZWQgY29udGVudCBpbiBTMzogJHtzM0tleX1gKTtcblxuICAgICAgICAvLyBTdG9yZSBzZXNzaW9uIG1ldGFkYXRhXG4gICAgICAgIGF3YWl0IHN0b3JlU2Vzc2lvbk1ldGFkYXRhKGV2ZW50KTtcblxuICAgICAgICAvLyBBZGQgY2FjaGUgbWV0YWRhdGEgdG8gaW5kaWNhdGUgdGhpcyB3YXMgTk9UIGZyb20gY2FjaGVcbiAgICAgICAgYXdhaXQgYWRkQ2FjaGVNZXRhZGF0YShldmVudC5zZXNzaW9uSWQsIGZhbHNlKTtcblxuICAgICAgICAvLyBTdGVwIDM6IFN0b3JlIGluIGNhY2hlIGZvciBmdXR1cmUgdXNlIChvbmx5IGlmIGNhY2hpbmcgaXMgZW5hYmxlZClcbiAgICAgICAgaWYgKGNhY2hlRW5hYmxlZCkge1xuICAgICAgICAgICAgYXdhaXQgc3RvcmVQcm9jZXNzZWRDb250ZW50SW5DYWNoZShldmVudC51cmwsIHByb2Nlc3NlZENvbnRlbnQsIGNvbnRleHR1YWxTZXR0aW5nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfimqDvuI8gQ2FjaGUgZGlzYWJsZWQgLSBza2lwcGluZyBjYWNoZSBzdG9yYWdlJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXR1cm4gT05MWSBtaW5pbWFsIHN1Y2Nlc3Mgc3RhdHVzIC0gbm8gZGF0YSBhdCBhbGxcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50LnNlc3Npb25JZCxcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IHByb2Nlc3NlZCBhbmQgY2FjaGVkJ1xuICAgICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignVVJMIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBldmVudC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xuICAgICAgICB9O1xuICAgIH1cbn07XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrUHJvY2Vzc2VkQ29udGVudENhY2hlKHVybDogc3RyaW5nLCBjb250ZXh0dWFsU2V0dGluZzogc3RyaW5nKTogUHJvbWlzZTxQcm9jZXNzZWRDb250ZW50SW5kZXggfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuUFJPQ0VTU0VEX0NPTlRFTlRfVEFCTEU7XG4gICAgICAgIGlmICghdGFibGVOYW1lKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gY2FjaGUgdGFibGUgY29uZmlndXJlZCwgc2tpcHBpbmcgY2FjaGUgY2hlY2snKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2xlYW4gVVJMIHRvIG5vcm1hbGl6ZSBpdCAocmVtb3ZlIGZyYWdtZW50cywgbm9ybWFsaXplIHF1ZXJ5IHBhcmFtcylcbiAgICAgICAgY29uc3QgY2xlYW5VcmwgPSBub3JtYWxpemVVcmwodXJsKTtcblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XG4gICAgICAgICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcbiAgICAgICAgICAgIEtleTogbWFyc2hhbGwoe1xuICAgICAgICAgICAgICAgIHVybDogY2xlYW5VcmwsXG4gICAgICAgICAgICAgICAgY29udGV4dHVhbFNldHRpbmc6IGNvbnRleHR1YWxTZXR0aW5nXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgaWYgKHJlc3BvbnNlLkl0ZW0pIHtcbiAgICAgICAgICAgIGNvbnN0IGNhY2hlRW50cnkgPSB1bm1hcnNoYWxsKHJlc3BvbnNlLkl0ZW0pIGFzIFByb2Nlc3NlZENvbnRlbnRJbmRleDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBDYWNoZSBlbnRyeSBmb3VuZCBmb3IgJHtjbGVhblVybH0gKGNvbnRleHQ6ICR7Y29udGV4dHVhbFNldHRpbmd9KSwgcHJvY2Vzc2VkIGF0ICR7Y2FjaGVFbnRyeS5wcm9jZXNzZWRBdH1gKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBDYWNoZSBTMyBsb2NhdGlvbjogJHtjYWNoZUVudHJ5LnMzTG9jYXRpb259YCk7XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVFbnRyeTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBObyBjYWNoZSBlbnRyeSBmb3VuZCBmb3IgJHtjbGVhblVybH0gKGNvbnRleHQ6ICR7Y29udGV4dHVhbFNldHRpbmd9KWApO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdDYWNoZSBjaGVjayBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4gbnVsbDsgLy8gR3JhY2VmdWwgZGVncmFkYXRpb24gLSBjb250aW51ZSB3aXRob3V0IGNhY2hlXG4gICAgfVxufVxuXG5mdW5jdGlvbiBpc0NhY2hlRXhwaXJlZChjYWNoZUVudHJ5OiBQcm9jZXNzZWRDb250ZW50SW5kZXgpOiBib29sZWFuIHtcbiAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcbiAgICByZXR1cm4gY2FjaGVFbnRyeS50dGwgPCBub3c7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvcHlDYWNoZWRDb250ZW50VG9TZXNzaW9uKGNhY2hlUzNMb2NhdGlvbjogc3RyaW5nLCBzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQ7XG4gICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQU5BTFlTSVNfQlVDS0VUIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29weWluZyBjYWNoZWQgY29udGVudCBmcm9tOiAke2NhY2hlUzNMb2NhdGlvbn1gKTtcblxuICAgICAgICAvLyBHZXQgY2FjaGVkIGNvbnRlbnQgZnJvbSBTM1xuICAgICAgICBjb25zdCBjYWNoZWRPYmplY3QgPSBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogY2FjaGVTM0xvY2F0aW9uXG4gICAgICAgIH0pKTtcblxuICAgICAgICBpZiAoIWNhY2hlZE9iamVjdC5Cb2R5KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NhY2hlZCBjb250ZW50IGJvZHkgaXMgZW1wdHknKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNhY2hlZENvbnRlbnQgPSBhd2FpdCBjYWNoZWRPYmplY3QuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuXG4gICAgICAgIC8vIFN0b3JlIGluIHNlc3Npb24gbG9jYXRpb25cbiAgICAgICAgY29uc3Qgc2Vzc2lvbktleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vcHJvY2Vzc2VkLWNvbnRlbnQuanNvbmA7XG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBzZXNzaW9uS2V5LFxuICAgICAgICAgICAgQm9keTogY2FjaGVkQ29udGVudCxcbiAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgQ29waWVkIGNhY2hlZCBjb250ZW50IGZyb20gJHtjYWNoZVMzTG9jYXRpb259IHRvIHNlc3Npb246ICR7c2Vzc2lvbktleX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gY29weSBjYWNoZWQgY29udGVudDonLCBlcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gc3RvcmVTZXNzaW9uTWV0YWRhdGEoZXZlbnQ6IFVSTFByb2Nlc3NvckV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LkFOQUxZU0lTX0JVQ0tFVDtcbiAgICBpZiAoIWJ1Y2tldE5hbWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBTkFMWVNJU19CVUNLRVQgZW52aXJvbm1lbnQgdmFyaWFibGUgbm90IHNldCcpO1xuICAgIH1cblxuICAgIGNvbnN0IG1ldGFkYXRhS2V5ID0gYHNlc3Npb25zLyR7ZXZlbnQuc2Vzc2lvbklkfS9tZXRhZGF0YS5qc29uYDtcbiAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICBLZXk6IG1ldGFkYXRhS2V5LFxuICAgICAgICBCb2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICB1cmw6IGV2ZW50LnVybCxcbiAgICAgICAgICAgIHNlbGVjdGVkTW9kZWw6IGV2ZW50LnNlbGVjdGVkTW9kZWwsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50LnNlc3Npb25JZCxcbiAgICAgICAgICAgIHN0YXJ0VGltZTogZXZlbnQuYW5hbHlzaXNTdGFydFRpbWVcbiAgICAgICAgfSksXG4gICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICB9KSk7XG5cbiAgICBjb25zb2xlLmxvZyhgU3RvcmVkIHNlc3Npb24gbWV0YWRhdGEgaW4gUzM6ICR7bWV0YWRhdGFLZXl9YCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFkZENhY2hlTWV0YWRhdGEoc2Vzc2lvbklkOiBzdHJpbmcsIHdhc0Zyb21DYWNoZTogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQ7XG4gICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQU5BTFlTSVNfQlVDS0VUIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBSZWFkIHRoZSBleGlzdGluZyBwcm9jZXNzZWQgY29udGVudFxuICAgICAgICBjb25zdCBjb250ZW50S2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uYDtcbiAgICAgICAgY29uc3QgY29udGVudFJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBLZXk6IGNvbnRlbnRLZXlcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGNvbnN0IGNvbnRlbnRTdHIgPSBhd2FpdCBjb250ZW50UmVzcG9uc2UuQm9keSEudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgY29uc3QgcHJvY2Vzc2VkQ29udGVudCA9IEpTT04ucGFyc2UoY29udGVudFN0cik7XG5cbiAgICAgICAgLy8gQWRkIGNhY2hlIG1ldGFkYXRhXG4gICAgICAgIHByb2Nlc3NlZENvbnRlbnQuY2FjaGVNZXRhZGF0YSA9IHtcbiAgICAgICAgICAgIHdhc0Zyb21DYWNoZSxcbiAgICAgICAgICAgIHJldHJpZXZlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBXcml0ZSBpdCBiYWNrXG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBjb250ZW50S2V5LFxuICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkocHJvY2Vzc2VkQ29udGVudCksXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgIH0pKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgQWRkZWQgY2FjaGUgbWV0YWRhdGE6IHdhc0Zyb21DYWNoZT0ke3dhc0Zyb21DYWNoZX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gYWRkIGNhY2hlIG1ldGFkYXRhOicsIGVycm9yKTtcbiAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSB0aGlzIGlzIG5vdCBjcml0aWNhbFxuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gc3RvcmVQcm9jZXNzZWRDb250ZW50SW5DYWNoZSh1cmw6IHN0cmluZywgcHJvY2Vzc2VkQ29udGVudDogYW55LCBjb250ZXh0dWFsU2V0dGluZzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuUFJPQ0VTU0VEX0NPTlRFTlRfVEFCTEU7XG4gICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQ7XG5cbiAgICAgICAgaWYgKCF0YWJsZU5hbWUgfHwgIWJ1Y2tldE5hbWUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdDYWNoZSBub3QgY29uZmlndXJlZCwgc2tpcHBpbmcgY2FjaGUgc3RvcmFnZScpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2FsY3VsYXRlIGNvbnRlbnQgaGFzaCBmb3IgdGhlIHByb2Nlc3NlZCBjb250ZW50XG4gICAgICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgICAgICAgICAudXBkYXRlKHByb2Nlc3NlZENvbnRlbnQubWFya2Rvd25Db250ZW50KVxuICAgICAgICAgICAgLmRpZ2VzdCgnaGV4Jyk7XG5cbiAgICAgICAgLy8gQ2xlYW4gVVJMIHRvIG5vcm1hbGl6ZSBpdFxuICAgICAgICBjb25zdCBjbGVhblVybCA9IG5vcm1hbGl6ZVVybCh1cmwpO1xuXG4gICAgICAgIC8vIEdlbmVyYXRlIGNvbnNpc3RlbnQgc2Vzc2lvbiBJRCBmb3IgY2FjaGUgc3RvcmFnZVxuICAgICAgICBjb25zdCBjb25zaXN0ZW50U2Vzc2lvbklkID0gZ2VuZXJhdGVDb25zaXN0ZW50U2Vzc2lvbklkKHVybCwgY29udGV4dHVhbFNldHRpbmcpO1xuXG4gICAgICAgIC8vIFN0b3JlIHByb2Nlc3NlZCBjb250ZW50IGluIFMzIHVzaW5nIGNvbnNpc3RlbnQgc2Vzc2lvbiBJRCBwYXRoXG4gICAgICAgIGNvbnN0IGNhY2hlUzNLZXkgPSBgc2Vzc2lvbnMvJHtjb25zaXN0ZW50U2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uYDtcbiAgICAgICAgYXdhaXQgczNDbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBLZXk6IGNhY2hlUzNLZXksXG4gICAgICAgICAgICBCb2R5OiBKU09OLnN0cmluZ2lmeShwcm9jZXNzZWRDb250ZW50KSxcbiAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIC8vIENhbGN1bGF0ZSBUVEwgKDcgZGF5cyBmcm9tIG5vdylcbiAgICAgICAgY29uc3QgdHRsRGF5cyA9IHBhcnNlSW50KHByb2Nlc3MuZW52LkNBQ0hFX1RUTF9EQVlTIHx8ICc3Jyk7XG4gICAgICAgIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKHR0bERheXMgKiAyNCAqIDYwICogNjApO1xuXG4gICAgICAgIC8vIFN0b3JlIGluZGV4IGVudHJ5IGluIER5bmFtb0RCIHdpdGggcHJvcGVyIGNvbHVtbnNcbiAgICAgICAgY29uc3QgY2FjaGVJbmRleDogUHJvY2Vzc2VkQ29udGVudEluZGV4ID0ge1xuICAgICAgICAgICAgdXJsOiBjbGVhblVybCxcbiAgICAgICAgICAgIGNvbnRleHR1YWxTZXR0aW5nOiBjb250ZXh0dWFsU2V0dGluZyxcbiAgICAgICAgICAgIHByb2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBjb250ZW50SGFzaDogY29udGVudEhhc2gsXG4gICAgICAgICAgICBzM0xvY2F0aW9uOiBjYWNoZVMzS2V5LFxuICAgICAgICAgICAgdHRsOiB0dGwsXG4gICAgICAgICAgICBjb250ZW50VHlwZTogcHJvY2Vzc2VkQ29udGVudC5jb250ZW50VHlwZSxcbiAgICAgICAgICAgIG5vaXNlUmVkdWN0aW9uTWV0cmljczogcHJvY2Vzc2VkQ29udGVudC5ub2lzZVJlZHVjdGlvblxuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBQdXRJdGVtQ29tbWFuZCh7XG4gICAgICAgICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcbiAgICAgICAgICAgIEl0ZW06IG1hcnNoYWxsKGNhY2hlSW5kZXgpXG4gICAgICAgIH0pKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgU3RvcmVkIGNhY2hlIGluZGV4IGZvciAke2NsZWFuVXJsfSAoY29udGV4dDogJHtjb250ZXh0dWFsU2V0dGluZ30pIHdpdGggVFRMICR7dHRsfWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgQ2FjaGUgUzMgbG9jYXRpb246ICR7Y2FjaGVTM0tleX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc3RvcmUgaW4gY2FjaGU6JywgZXJyb3IpO1xuICAgICAgICAvLyBEb24ndCB0aHJvdyAtIGNhY2hpbmcgZmFpbHVyZSBzaG91bGRuJ3QgYnJlYWsgdGhlIG1haW4gZmxvd1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZXh0cmFjdE1lZGlhRWxlbWVudHMoZG9jdW1lbnQ6IERvY3VtZW50LCBiYXNlVXJsOiBzdHJpbmcpIHtcbiAgICBjb25zdCBtZWRpYUVsZW1lbnRzOiBhbnlbXSA9IFtdO1xuXG4gICAgLy8gRXh0cmFjdCBpbWFnZXNcbiAgICBjb25zdCBpbWFnZXMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdpbWcnKTtcbiAgICBpbWFnZXMuZm9yRWFjaChpbWcgPT4ge1xuICAgICAgICBtZWRpYUVsZW1lbnRzLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ2ltYWdlJyxcbiAgICAgICAgICAgIHNyYzogaW1nLnNyYyxcbiAgICAgICAgICAgIGFsdDogaW1nLmFsdCB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICBjYXB0aW9uOiBpbWcudGl0bGUgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgYW5hbHlzaXNOb3RlOiBpbWcuYWx0ID8gJ0hhcyBhbHQgdGV4dCcgOiAnTWlzc2luZyBhbHQgdGV4dCAtIGFjY2Vzc2liaWxpdHkgY29uY2VybidcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBFeHRyYWN0IHZpZGVvc1xuICAgIGNvbnN0IHZpZGVvcyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ3ZpZGVvLCBpZnJhbWVbc3JjKj1cInlvdXR1YmVcIl0sIGlmcmFtZVtzcmMqPVwidmltZW9cIl0nKTtcbiAgICB2aWRlb3MuZm9yRWFjaCh2aWRlbyA9PiB7XG4gICAgICAgIGNvbnN0IHNyYyA9IHZpZGVvLmdldEF0dHJpYnV0ZSgnc3JjJykgfHwgJyc7XG4gICAgICAgIG1lZGlhRWxlbWVudHMucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAndmlkZW8nLFxuICAgICAgICAgICAgc3JjLFxuICAgICAgICAgICAgYW5hbHlzaXNOb3RlOiAnVmlkZW8gY29udGVudCAtIGNvbnNpZGVyIGFjY2Vzc2liaWxpdHkgYW5kIGxvYWRpbmcgaW1wYWN0J1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEV4dHJhY3QgaW50ZXJhY3RpdmUgZWxlbWVudHNcbiAgICBjb25zdCBpbnRlcmFjdGl2ZXMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdmb3JtLCBidXR0b25bb25jbGlja10sIFtkYXRhLWludGVyYWN0aXZlXScpO1xuICAgIGludGVyYWN0aXZlcy5mb3JFYWNoKCgpID0+IHtcbiAgICAgICAgbWVkaWFFbGVtZW50cy5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdpbnRlcmFjdGl2ZScsXG4gICAgICAgICAgICBzcmM6ICcnLFxuICAgICAgICAgICAgYW5hbHlzaXNOb3RlOiAnSW50ZXJhY3RpdmUgZWxlbWVudCAtIG1heSBhZmZlY3QgZG9jdW1lbnRhdGlvbiB1c2FiaWxpdHknXG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1lZGlhRWxlbWVudHM7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RDb2RlU25pcHBldHMoZG9jdW1lbnQ6IERvY3VtZW50KSB7XG4gICAgY29uc3QgY29kZVNuaXBwZXRzOiBhbnlbXSA9IFtdO1xuXG4gICAgY29uc3QgY29kZUJsb2NrcyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ3ByZSBjb2RlLCBjb2RlJyk7XG4gICAgY29kZUJsb2Nrcy5mb3JFYWNoKChjb2RlRWxlbWVudCwgaW5kZXgpID0+IHtcbiAgICAgICAgY29uc3QgY29kZSA9IGNvZGVFbGVtZW50LnRleHRDb250ZW50IHx8ICcnO1xuICAgICAgICBpZiAoY29kZS50cmltKCkubGVuZ3RoIDwgMTApIHJldHVybjsgLy8gU2tpcCB2ZXJ5IHNob3J0IHNuaXBwZXRzXG5cbiAgICAgICAgY29uc3QgbGFuZ3VhZ2UgPSBkZXRlY3RMYW5ndWFnZUZyb21DbGFzcyhjb2RlRWxlbWVudC5jbGFzc05hbWUpIHx8XG4gICAgICAgICAgICBkZXRlY3RMYW5ndWFnZUZyb21Db250ZW50KGNvZGUpO1xuXG4gICAgICAgIGNvZGVTbmlwcGV0cy5wdXNoKHtcbiAgICAgICAgICAgIGxhbmd1YWdlLFxuICAgICAgICAgICAgY29kZTogY29kZS50cmltKCkuc2xpY2UoMCwgMTAwMCksIC8vIExpbWl0IGNvZGUgc25pcHBldCBzaXplXG4gICAgICAgICAgICBsaW5lTnVtYmVyOiBpbmRleCArIDEsXG4gICAgICAgICAgICBoYXNWZXJzaW9uSW5mbzogY2hlY2tGb3JWZXJzaW9uSW5mbyhjb2RlKVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBjb2RlU25pcHBldHM7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgdHdvIGhvc3RuYW1lcyBhcmUgcmVsYXRlZCBkb21haW5zIHRoYXQgc2hvdWxkIGJlIHZhbGlkYXRlZCB0b2dldGhlclxuICogVGhpcyBpbmNsdWRlcyBzYW1lIG9yZ2FuaXphdGlvbiBzdWJkb21haW5zIGFuZCBjb21tb24gZG9jdW1lbnRhdGlvbiBwYXR0ZXJuc1xuICovXG5mdW5jdGlvbiBpc1JlbGF0ZWREb21haW4obGlua0hvc3RuYW1lOiBzdHJpbmcsIGJhc2VIb3N0bmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgLy8gU2FtZSBob3N0bmFtZSAoYWxyZWFkeSBoYW5kbGVkIGJ5IGNhbGxlciwgYnV0IGluY2x1ZGVkIGZvciBjb21wbGV0ZW5lc3MpXG4gICAgaWYgKGxpbmtIb3N0bmFtZSA9PT0gYmFzZUhvc3RuYW1lKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIEV4dHJhY3Qgcm9vdCBkb21haW5zXG4gICAgY29uc3QgZ2V0Um9vdERvbWFpbiA9IChob3N0bmFtZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICAgICAgY29uc3QgcGFydHMgPSBob3N0bmFtZS5zcGxpdCgnLicpO1xuICAgICAgICBpZiAocGFydHMubGVuZ3RoID49IDIpIHtcbiAgICAgICAgICAgIHJldHVybiBwYXJ0cy5zbGljZSgtMikuam9pbignLicpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBob3N0bmFtZTtcbiAgICB9O1xuXG4gICAgY29uc3QgbGlua1Jvb3QgPSBnZXRSb290RG9tYWluKGxpbmtIb3N0bmFtZSk7XG4gICAgY29uc3QgYmFzZVJvb3QgPSBnZXRSb290RG9tYWluKGJhc2VIb3N0bmFtZSk7XG5cbiAgICAvLyBTYW1lIHJvb3QgZG9tYWluIChlLmcuLCBkb2NzLnguY29tIGFuZCBkZXZlbG9wZXIueC5jb20pXG4gICAgaWYgKGxpbmtSb290ID09PSBiYXNlUm9vdCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBBZGRpdGlvbmFsIGNyb3NzLWRvbWFpbiBwYXR0ZXJucyBmb3Igb3JnYW5pemF0aW9ucyB0aGF0IHVzZSBkaWZmZXJlbnQgcm9vdCBkb21haW5zXG4gICAgY29uc3QgY3Jvc3NEb21haW5QYXR0ZXJucyA9IFtcbiAgICAgICAgLy8gWC9Ud2l0dGVyIGVjb3N5c3RlbSAoZGlmZmVyZW50IHJvb3QgZG9tYWlucylcbiAgICAgICAgWyd4LmNvbScsICd0d2l0dGVyLmNvbSddLFxuXG4gICAgICAgIC8vIEdpdEh1YiBlY29zeXN0ZW1cbiAgICAgICAgWydnaXRodWIuY29tJywgJ2dpdGh1Yi5pbycsICdnaXRodWJhcHAuY29tJ10sXG5cbiAgICAgICAgLy8gR29vZ2xlIGVjb3N5c3RlbVxuICAgICAgICBbJ2dvb2dsZS5jb20nLCAnZ29vZ2xlYXBpcy5jb20nLCAnZ29vZ2xldXNlcmNvbnRlbnQuY29tJywgJ2dzdGF0aWMuY29tJ10sXG5cbiAgICAgICAgLy8gQW1hem9uL0FXUyBlY29zeXN0ZW1cbiAgICAgICAgWydhbWF6b24uY29tJywgJ2FtYXpvbmF3cy5jb20nLCAnYXdzc3RhdGljLmNvbSddLFxuXG4gICAgICAgIC8vIE1pY3Jvc29mdCBlY29zeXN0ZW1cbiAgICAgICAgWydtaWNyb3NvZnQuY29tJywgJ21pY3Jvc29mdG9ubGluZS5jb20nLCAnYXp1cmUuY29tJywgJ29mZmljZS5jb20nXSxcblxuICAgICAgICAvLyBNZXRhL0ZhY2Vib29rIGVjb3N5c3RlbVxuICAgICAgICBbJ2ZhY2Vib29rLmNvbScsICdmYmNkbi5uZXQnLCAnaW5zdGFncmFtLmNvbSddLFxuXG4gICAgICAgIC8vIEF0bGFzc2lhbiBlY29zeXN0ZW1cbiAgICAgICAgWydhdGxhc3NpYW4uY29tJywgJ2F0bGFzc2lhbi5uZXQnLCAnYml0YnVja2V0Lm9yZyddLFxuXG4gICAgICAgIC8vIFNhbGVzZm9yY2UgZWNvc3lzdGVtXG4gICAgICAgIFsnc2FsZXNmb3JjZS5jb20nLCAnZm9yY2UuY29tJywgJ2hlcm9rdWFwcC5jb20nXVxuICAgIF07XG5cbiAgICAvLyBDaGVjayBpZiBib3RoIHJvb3QgZG9tYWlucyBhcmUgaW4gdGhlIHNhbWUgY3Jvc3MtZG9tYWluIHBhdHRlcm4gZ3JvdXBcbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgY3Jvc3NEb21haW5QYXR0ZXJucykge1xuICAgICAgICBpZiAocGF0dGVybi5pbmNsdWRlcyhsaW5rUm9vdCkgJiYgcGF0dGVybi5pbmNsdWRlcyhiYXNlUm9vdCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBhbmFseXplTGlua1N0cnVjdHVyZShkb2N1bWVudDogRG9jdW1lbnQsIGJhc2VVcmw6IHN0cmluZykge1xuICAgIGNvbnN0IGxpbmtzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnYVtocmVmXScpO1xuICAgIGNvbnN0IGJhc2VVcmxPYmogPSBuZXcgVVJMKGJhc2VVcmwpO1xuXG4gICAgbGV0IHRvdGFsTGlua3MgPSAwO1xuICAgIGxldCBpbnRlcm5hbExpbmtzID0gMDtcbiAgICBsZXQgZXh0ZXJuYWxMaW5rcyA9IDA7XG4gICAgY29uc3Qgc3ViUGFnZXNJZGVudGlmaWVkOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGludGVybmFsTGlua3NGb3JWYWxpZGF0aW9uOiBBcnJheTx7IHVybDogc3RyaW5nLCBhbmNob3JUZXh0OiBzdHJpbmcsIGVsZW1lbnQ6IEVsZW1lbnQgfT4gPSBbXTtcblxuICAgIGxpbmtzLmZvckVhY2gobGluayA9PiB7XG4gICAgICAgIGNvbnN0IGhyZWYgPSBsaW5rLmdldEF0dHJpYnV0ZSgnaHJlZicpO1xuICAgICAgICBpZiAoIWhyZWYpIHJldHVybjtcblxuICAgICAgICAvLyBTa2lwIG5vbi1IVFRQIGxpbmtzXG4gICAgICAgIGlmIChocmVmLnN0YXJ0c1dpdGgoJ21haWx0bzonKSB8fFxuICAgICAgICAgICAgaHJlZi5zdGFydHNXaXRoKCd0ZWw6JykgfHxcbiAgICAgICAgICAgIGhyZWYuc3RhcnRzV2l0aCgnamF2YXNjcmlwdDonKSB8fFxuICAgICAgICAgICAgaHJlZi5zdGFydHNXaXRoKCcjJykpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRvdGFsTGlua3MrKztcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgbGlua1VybCA9IG5ldyBVUkwoaHJlZiwgYmFzZVVybCk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGl0J3MgYW4gaW50ZXJuYWwgbGluayAoc2FtZSBob3N0bmFtZSkgb3IgcmVsYXRlZCBkb21haW4gbGlua1xuICAgICAgICAgICAgY29uc3QgaXNJbnRlcm5hbExpbmsgPSBsaW5rVXJsLmhvc3RuYW1lID09PSBiYXNlVXJsT2JqLmhvc3RuYW1lO1xuICAgICAgICAgICAgY29uc3QgaXNSZWxhdGVkRG9tYWluTGluayA9IGlzUmVsYXRlZERvbWFpbihsaW5rVXJsLmhvc3RuYW1lLCBiYXNlVXJsT2JqLmhvc3RuYW1lKTtcblxuICAgICAgICAgICAgaWYgKGlzSW50ZXJuYWxMaW5rIHx8IGlzUmVsYXRlZERvbWFpbkxpbmspIHtcbiAgICAgICAgICAgICAgICBpbnRlcm5hbExpbmtzKys7XG5cbiAgICAgICAgICAgICAgICAvLyBTdG9yZSBpbnRlcm5hbCBhbmQgcmVsYXRlZCBkb21haW4gbGlua3MgZm9yIHZhbGlkYXRpb25cbiAgICAgICAgICAgICAgICBpbnRlcm5hbExpbmtzRm9yVmFsaWRhdGlvbi5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgdXJsOiBsaW5rVXJsLmhyZWYsXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvclRleHQ6IGxpbmsudGV4dENvbnRlbnQ/LnRyaW0oKSB8fCBocmVmLFxuICAgICAgICAgICAgICAgICAgICBlbGVtZW50OiBsaW5rXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBpZiAobGlua1VybC5wYXRobmFtZSAhPT0gYmFzZVVybE9iai5wYXRobmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5rVGV4dCA9IGxpbmsudGV4dENvbnRlbnQ/LnRyaW0oKSB8fCAnJztcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxpbmtUZXh0ICYmICFzdWJQYWdlc0lkZW50aWZpZWQuaW5jbHVkZXMobGlua1RleHQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWJQYWdlc0lkZW50aWZpZWQucHVzaChsaW5rVGV4dCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4dGVybmFsTGlua3MrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICBleHRlcm5hbExpbmtzKys7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIHRvdGFsTGlua3MsXG4gICAgICAgIGludGVybmFsTGlua3MsXG4gICAgICAgIGV4dGVybmFsTGlua3MsXG4gICAgICAgIHN1YlBhZ2VzSWRlbnRpZmllZDogc3ViUGFnZXNJZGVudGlmaWVkLnNsaWNlKDAsIDEwKSxcbiAgICAgICAgbGlua0NvbnRleHQ6IHN1YlBhZ2VzSWRlbnRpZmllZC5sZW5ndGggPiAwID8gJ211bHRpLXBhZ2UtcmVmZXJlbmNlZCcgYXMgY29uc3QgOiAnc2luZ2xlLXBhZ2UnIGFzIGNvbnN0LFxuICAgICAgICBhbmFseXNpc1Njb3BlOiAnY3VycmVudC1wYWdlLW9ubHknIGFzICdjdXJyZW50LXBhZ2Utb25seScgfCAnd2l0aC1jb250ZXh0JywgLy8gV2lsbCBiZSB1cGRhdGVkIGJ5IGNvbnRleHQgYW5hbHlzaXMgaWYgZW5hYmxlZFxuICAgICAgICBpbnRlcm5hbExpbmtzRm9yVmFsaWRhdGlvbiAvLyBORVc6IExpbmtzIHRvIHZhbGlkYXRlXG4gICAgfTtcbn1cblxuLy8gTkVXOiBMaW5rIHZhbGlkYXRpb24gZnVuY3Rpb24gZm9yIGludGVybmFsIGFuZCByZWxhdGVkIGRvbWFpbiBsaW5rc1xuYXN5bmMgZnVuY3Rpb24gdmFsaWRhdGVJbnRlcm5hbExpbmtzKFxuICAgIGxpbmtzVG9WYWxpZGF0ZTogQXJyYXk8eyB1cmw6IHN0cmluZywgYW5jaG9yVGV4dDogc3RyaW5nLCBlbGVtZW50OiBFbGVtZW50IH0+LFxuICAgIHByb2dyZXNzOiBQcm9ncmVzc1B1Ymxpc2hlclxuKTogUHJvbWlzZTx7IGxpbmtJc3N1ZXM6IExpbmtJc3N1ZVtdLCBoZWFsdGh5TGlua3M6IG51bWJlciB9PiB7XG4gICAgaWYgKGxpbmtzVG9WYWxpZGF0ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHsgbGlua0lzc3VlczogW10sIGhlYWx0aHlMaW5rczogMCB9O1xuICAgIH1cblxuICAgIC8vIERlZHVwbGljYXRlIGxpbmtzIGJ5IFVSTCBiZWZvcmUgdmFsaWRhdGlvbiB0byBhdm9pZCByZWR1bmRhbnQgSFRUUCByZXF1ZXN0c1xuICAgIGNvbnN0IHVuaXF1ZUxpbmtzTWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgdXJsOiBzdHJpbmcsIGFuY2hvclRleHQ6IHN0cmluZywgZWxlbWVudDogRWxlbWVudCB9PigpO1xuICAgIGxpbmtzVG9WYWxpZGF0ZS5mb3JFYWNoKGxpbmsgPT4ge1xuICAgICAgICBpZiAoIXVuaXF1ZUxpbmtzTWFwLmhhcyhsaW5rLnVybCkpIHtcbiAgICAgICAgICAgIHVuaXF1ZUxpbmtzTWFwLnNldChsaW5rLnVybCwgbGluayk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBjb25zdCB1bmlxdWVMaW5rcyA9IEFycmF5LmZyb20odW5pcXVlTGlua3NNYXAudmFsdWVzKCkpO1xuXG4gICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhgQ2hlY2tpbmcgJHt1bmlxdWVMaW5rcy5sZW5ndGh9IHVuaXF1ZSBpbnRlcm5hbCBhbmQgcmVsYXRlZCBkb21haW4gbGlua3MgZm9yIGFjY2Vzc2liaWxpdHkuLi5gKTtcblxuICAgIGNvbnN0IGxpbmtJc3N1ZXM6IExpbmtJc3N1ZVtdID0gW107XG4gICAgbGV0IGhlYWx0aHlMaW5rcyA9IDA7XG4gICAgY29uc3QgbWF4Q29uY3VycmVudCA9IDEwO1xuICAgIGNvbnN0IHRpbWVvdXQgPSA1MDAwOyAvLyA1IHNlY29uZHNcblxuICAgIC8vIFByb2Nlc3MgbGlua3MgaW4gYmF0Y2hlcyB0byBhdm9pZCBvdmVyd2hlbG1pbmcgdGhlIHNlcnZlclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdW5pcXVlTGlua3MubGVuZ3RoOyBpICs9IG1heENvbmN1cnJlbnQpIHtcbiAgICAgICAgY29uc3QgYmF0Y2ggPSB1bmlxdWVMaW5rcy5zbGljZShpLCBpICsgbWF4Q29uY3VycmVudCk7XG5cbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBiYXRjaC5tYXAoYXN5bmMgKGxpbmtJbmZvKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgdGltZW91dElkID0gc2V0VGltZW91dCgoKSA9PiBjb250cm9sbGVyLmFib3J0KCksIHRpbWVvdXQpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChsaW5rSW5mby51cmwsIHtcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnSEVBRCcsXG4gICAgICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdVc2VyLUFnZW50JzogJ0xlbnN5IERvY3VtZW50YXRpb24gUXVhbGl0eSBBdWRpdG9yLzEuMCdcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXRJZCk7XG5cbiAgICAgICAgICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlua0lzc3VlOiBMaW5rSXNzdWUgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGxpbmtJbmZvLnVybCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogNDA0LFxuICAgICAgICAgICAgICAgICAgICAgICAgYW5jaG9yVGV4dDogbGlua0luZm8uYW5jaG9yVGV4dCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZUxvY2F0aW9uOiAnbWFpbiBwYWdlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZTogJ1BhZ2Ugbm90IGZvdW5kJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzc3VlVHlwZTogJzQwNCdcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgbGlua0lzc3Vlcy5wdXNoKGxpbmtJc3N1ZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhg4pqgIEJyb2tlbiBsaW5rICg0MDQpOiAke2xpbmtJbmZvLnVybH1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtJc3N1ZTogTGlua0lzc3VlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBsaW5rSW5mby51cmwsXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IDQwMyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuY2hvclRleHQ6IGxpbmtJbmZvLmFuY2hvclRleHQsXG4gICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2VMb2NhdGlvbjogJ21haW4gcGFnZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6ICdBY2Nlc3MgZGVuaWVkICg0MDMgRm9yYmlkZGVuKScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpc3N1ZVR5cGU6ICdhY2Nlc3MtZGVuaWVkJ1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBsaW5rSXNzdWVzLnB1c2gobGlua0lzc3VlKTtcblxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBwcm9ncmVzcy5pbmZvKGDimqAgTGluayBpc3N1ZSAoNDAzKTogJHtsaW5rSW5mby51cmx9YCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5zdGF0dXMgPj0gNDAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtJc3N1ZTogTGlua0lzc3VlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBsaW5rSW5mby51cmwsXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuY2hvclRleHQ6IGxpbmtJbmZvLmFuY2hvclRleHQsXG4gICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2VMb2NhdGlvbjogJ21haW4gcGFnZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6IGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfTogJHtyZXNwb25zZS5zdGF0dXNUZXh0fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBpc3N1ZVR5cGU6ICdlcnJvcidcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgbGlua0lzc3Vlcy5wdXNoKGxpbmtJc3N1ZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhg4pqgIExpbmsgaXNzdWUgKCR7cmVzcG9uc2Uuc3RhdHVzfSk6ICR7bGlua0luZm8udXJsfWApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGhlYWx0aHlMaW5rcysrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubmFtZSA9PT0gJ0Fib3J0RXJyb3InKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtJc3N1ZTogTGlua0lzc3VlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBsaW5rSW5mby51cmwsXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICd0aW1lb3V0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuY2hvclRleHQ6IGxpbmtJbmZvLmFuY2hvclRleHQsXG4gICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2VMb2NhdGlvbjogJ21haW4gcGFnZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6ICdSZXF1ZXN0IHRpbWVvdXQgKD41IHNlY29uZHMpJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzc3VlVHlwZTogJ3RpbWVvdXQnXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGxpbmtJc3N1ZXMucHVzaChsaW5rSXNzdWUpO1xuXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmluZm8oYOKaoCBMaW5rIHRpbWVvdXQ6ICR7bGlua0luZm8udXJsfWApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtJc3N1ZTogTGlua0lzc3VlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBsaW5rSW5mby51cmwsXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdlcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICBhbmNob3JUZXh0OiBsaW5rSW5mby5hbmNob3JUZXh0LFxuICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlTG9jYXRpb246ICdtYWluIHBhZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzc3VlVHlwZTogJ2Vycm9yJ1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBsaW5rSXNzdWVzLnB1c2gobGlua0lzc3VlKTtcblxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBwcm9ncmVzcy5pbmZvKGDimqAgTGluayBlcnJvcjogJHtsaW5rSW5mby51cmx9ICgke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfSlgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICB9XG5cbiAgICAvLyBEZWR1cGxpY2F0ZSBsaW5rIGlzc3VlcyBieSBVUkwgKGluIGNhc2Ugb2YgYW55IGVkZ2UgY2FzZXMpXG4gICAgY29uc3QgdW5pcXVlTGlua0lzc3Vlc01hcCA9IG5ldyBNYXA8c3RyaW5nLCBMaW5rSXNzdWU+KCk7XG4gICAgbGlua0lzc3Vlcy5mb3JFYWNoKGxpbmsgPT4ge1xuICAgICAgICBpZiAoIXVuaXF1ZUxpbmtJc3N1ZXNNYXAuaGFzKGxpbmsudXJsKSkge1xuICAgICAgICAgICAgdW5pcXVlTGlua0lzc3Vlc01hcC5zZXQobGluay51cmwsIGxpbmspO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgY29uc3QgdW5pcXVlTGlua0lzc3VlcyA9IEFycmF5LmZyb20odW5pcXVlTGlua0lzc3Vlc01hcC52YWx1ZXMoKSk7XG5cbiAgICAvLyBDb3VudCBicm9rZW4gbGlua3MgKDQwNHMgb25seSlcbiAgICBjb25zdCBicm9rZW5MaW5rc0NvdW50ID0gdW5pcXVlTGlua0lzc3Vlcy5maWx0ZXIobGluayA9PiBsaW5rLmlzc3VlVHlwZSA9PT0gJzQwNCcpLmxlbmd0aDtcbiAgICBjb25zdCB0b3RhbElzc3Vlc0NvdW50ID0gdW5pcXVlTGlua0lzc3Vlcy5sZW5ndGg7XG5cbiAgICBpZiAoYnJva2VuTGlua3NDb3VudCA+IDAgJiYgYnJva2VuTGlua3NDb3VudCA9PT0gdG90YWxJc3N1ZXNDb3VudCkge1xuICAgICAgICBhd2FpdCBwcm9ncmVzcy5zdWNjZXNzKGDinJMgTGluayBjaGVjayBjb21wbGV0ZTogJHticm9rZW5MaW5rc0NvdW50fSBicm9rZW4gKDQwNCksICR7aGVhbHRoeUxpbmtzfSBoZWFsdGh5YCk7XG4gICAgfSBlbHNlIGlmICh0b3RhbElzc3Vlc0NvdW50ID4gMCkge1xuICAgICAgICBhd2FpdCBwcm9ncmVzcy5zdWNjZXNzKGDinJMgTGluayBjaGVjayBjb21wbGV0ZTogJHticm9rZW5MaW5rc0NvdW50fSBicm9rZW4gKDQwNCksICR7dG90YWxJc3N1ZXNDb3VudCAtIGJyb2tlbkxpbmtzQ291bnR9IG90aGVyIGlzc3VlcywgJHtoZWFsdGh5TGlua3N9IGhlYWx0aHlgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBwcm9ncmVzcy5zdWNjZXNzKGDinJMgTGluayBjaGVjayBjb21wbGV0ZTogQWxsICR7aGVhbHRoeUxpbmtzfSBsaW5rcyBoZWFsdGh5YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgbGlua0lzc3VlczogdW5pcXVlTGlua0lzc3VlcywgaGVhbHRoeUxpbmtzIH07XG59XG5cbi8vIE5FVzogRW5oYW5jZWQgQ29kZSBBbmFseXNpcyBmdW5jdGlvblxuYXN5bmMgZnVuY3Rpb24gYW5hbHl6ZUNvZGVTbmlwcGV0c0VuaGFuY2VkKFxuICAgIGNvZGVTbmlwcGV0czogYW55W10sXG4gICAgcHJvZ3Jlc3M6IFByb2dyZXNzUHVibGlzaGVyXG4pOiBQcm9taXNlPHsgZGVwcmVjYXRlZENvZGU6IERlcHJlY2F0ZWRDb2RlRmluZGluZ1tdLCBzeW50YXhFcnJvcnM6IFN5bnRheEVycm9yRmluZGluZ1tdIH0+IHtcbiAgICBpZiAoY29kZVNuaXBwZXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4geyBkZXByZWNhdGVkQ29kZTogW10sIHN5bnRheEVycm9yczogW10gfTtcbiAgICB9XG5cbiAgICBhd2FpdCBwcm9ncmVzcy5pbmZvKGBBbmFseXppbmcgJHtjb2RlU25pcHBldHMubGVuZ3RofSBjb2RlIHNuaXBwZXRzIGZvciBkZXByZWNhdGlvbiBhbmQgc3ludGF4IGlzc3Vlcy4uLmApO1xuXG4gICAgY29uc3QgZGVwcmVjYXRlZENvZGU6IERlcHJlY2F0ZWRDb2RlRmluZGluZ1tdID0gW107XG4gICAgY29uc3Qgc3ludGF4RXJyb3JzOiBTeW50YXhFcnJvckZpbmRpbmdbXSA9IFtdO1xuXG4gICAgLy8gUHJvY2VzcyBjb2RlIHNuaXBwZXRzIGluIGJhdGNoZXMgdG8gYXZvaWQgb3ZlcndoZWxtaW5nIHRoZSBMTE1cbiAgICBjb25zdCBiYXRjaFNpemUgPSAzO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29kZVNuaXBwZXRzLmxlbmd0aDsgaSArPSBiYXRjaFNpemUpIHtcbiAgICAgICAgY29uc3QgYmF0Y2ggPSBjb2RlU25pcHBldHMuc2xpY2UoaSwgaSArIGJhdGNoU2l6ZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBzbmlwcGV0IG9mIGJhdGNoKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIFNraXAgdmVyeSBzaG9ydCBvciBzaW1wbGUgY29kZSBzbmlwcGV0cyB0byBhdm9pZCBmYWxzZSBwb3NpdGl2ZXNcbiAgICAgICAgICAgICAgICBpZiAoc25pcHBldC5jb2RlLnRyaW0oKS5sZW5ndGggPCAyMCB8fCBpc1NpbXBsZUNvZGUoc25pcHBldC5jb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBhbmFseXNpcyA9IGF3YWl0IGFuYWx5emVDb2RlU25pcHBldFdpdGhMTE0oc25pcHBldCwgaSArIDEpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGFuYWx5c2lzLmRlcHJlY2F0ZWRDb2RlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgZGVwcmVjYXRlZENvZGUucHVzaCguLi5hbmFseXNpcy5kZXByZWNhdGVkQ29kZSk7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZGVwcmVjYXRlZCBvZiBhbmFseXNpcy5kZXByZWNhdGVkQ29kZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhg4pqgIERlcHJlY2F0ZWQ6ICR7ZGVwcmVjYXRlZC5tZXRob2R9IGluIGNvZGUgYmxvY2sgJHtpICsgMX1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChhbmFseXNpcy5zeW50YXhFcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBzeW50YXhFcnJvcnMucHVzaCguLi5hbmFseXNpcy5zeW50YXhFcnJvcnMpO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGVycm9yIG9mIGFuYWx5c2lzLnN5bnRheEVycm9ycykge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhg4pyXIFN5bnRheCBlcnJvcjogJHtlcnJvci5kZXNjcmlwdGlvbn0gaW4gY29kZSBibG9jayAke2kgKyAxfWApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBhbmFseXplIGNvZGUgc25pcHBldCAke2kgKyAxfTpgLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgLy8gQ29udGludWUgd2l0aCBvdGhlciBzbmlwcGV0c1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2Vzcyhg4pyTIENvZGUgYW5hbHlzaXMgY29tcGxldGU6ICR7ZGVwcmVjYXRlZENvZGUubGVuZ3RofSBkZXByZWNhdGVkLCAke3N5bnRheEVycm9ycy5sZW5ndGh9IHN5bnRheCBlcnJvcnNgKTtcblxuICAgIHJldHVybiB7IGRlcHJlY2F0ZWRDb2RlLCBzeW50YXhFcnJvcnMgfTtcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIGNvZGUgaXMgdG9vIHNpbXBsZSB0byBhbmFseXplXG5mdW5jdGlvbiBpc1NpbXBsZUNvZGUoY29kZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGNvZGUudHJpbSgpO1xuXG4gICAgLy8gU2tpcCBzaW5nbGUtbGluZSBjb21tZW50cyBvciB2ZXJ5IHNob3J0IHNuaXBwZXRzXG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoIDwgMjApIHJldHVybiB0cnVlO1xuXG4gICAgLy8gU2tpcCBwdXJlIENTUyAoYWxyZWFkeSBmaWx0ZXJlZCBvdXQgaW4gbWFya2Rvd24gcHJvY2Vzc2luZylcbiAgICBpZiAodHJpbW1lZC5pbmNsdWRlcygneycpICYmIHRyaW1tZWQuaW5jbHVkZXMoJzonKSAmJiB0cmltbWVkLmluY2x1ZGVzKCc7JykgJiYgIXRyaW1tZWQuaW5jbHVkZXMoJ2Z1bmN0aW9uJykpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gU2tpcCBzaW1wbGUgSFRNTCB0YWdzXG4gICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aCgnPCcpICYmIHRyaW1tZWQuZW5kc1dpdGgoJz4nKSAmJiB0cmltbWVkLnNwbGl0KCdcXG4nKS5sZW5ndGggPCAzKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIFNraXAgY29uZmlndXJhdGlvbiBmaWxlcyB3aXRob3V0IGNvZGUgbG9naWNcbiAgICBpZiAodHJpbW1lZC5pbmNsdWRlcygnPScpICYmICF0cmltbWVkLmluY2x1ZGVzKCdmdW5jdGlvbicpICYmICF0cmltbWVkLmluY2x1ZGVzKCdjbGFzcycpICYmIHRyaW1tZWQuc3BsaXQoJ1xcbicpLmxlbmd0aCA8IDUpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyBMTE0tYmFzZWQgY29kZSBhbmFseXNpcyBmdW5jdGlvblxuYXN5bmMgZnVuY3Rpb24gYW5hbHl6ZUNvZGVTbmlwcGV0V2l0aExMTShcbiAgICBzbmlwcGV0OiBhbnksXG4gICAgYmxvY2tOdW1iZXI6IG51bWJlclxuKTogUHJvbWlzZTx7IGRlcHJlY2F0ZWRDb2RlOiBEZXByZWNhdGVkQ29kZUZpbmRpbmdbXSwgc3ludGF4RXJyb3JzOiBTeW50YXhFcnJvckZpbmRpbmdbXSB9PiB7XG4gICAgY29uc3QgcHJvbXB0ID0gYEFuYWx5emUgdGhpcyAke3NuaXBwZXQubGFuZ3VhZ2UgfHwgJ3Vua25vd24nfSBjb2RlIHNuaXBwZXQgZm9yIGRlcHJlY2F0ZWQgbWV0aG9kcyBhbmQgc3ludGF4IGVycm9ycy5cblxuQ29kZSBzbmlwcGV0IChibG9jayAke2Jsb2NrTnVtYmVyfSk6XG5cXGBcXGBcXGAke3NuaXBwZXQubGFuZ3VhZ2UgfHwgJyd9XG4ke3NuaXBwZXQuY29kZX1cblxcYFxcYFxcYFxuXG5QbGVhc2UgaWRlbnRpZnk6XG4xLiBEZXByZWNhdGVkIG1ldGhvZHMsIGZ1bmN0aW9ucywgb3IgcGF0dGVybnMgd2l0aCB2ZXJzaW9uIGluZm9ybWF0aW9uXG4yLiBEZWZpbml0ZSBzeW50YXggZXJyb3JzIHRoYXQgd291bGQgcHJldmVudCBjb2RlIGV4ZWN1dGlvblxuXG5SZXR1cm4geW91ciBhbmFseXNpcyBpbiB0aGlzIEpTT04gZm9ybWF0Olxue1xuICBcImRlcHJlY2F0ZWRDb2RlXCI6IFtcbiAgICB7XG4gICAgICBcImxhbmd1YWdlXCI6IFwiamF2YXNjcmlwdFwiLFxuICAgICAgXCJtZXRob2RcIjogXCJjb21wb25lbnRXaWxsTW91bnRcIixcbiAgICAgIFwibG9jYXRpb25cIjogXCJjb2RlIGJsb2NrICR7YmxvY2tOdW1iZXJ9LCBsaW5lIDVcIixcbiAgICAgIFwiZGVwcmVjYXRlZEluXCI6IFwiUmVhY3QgMTYuM1wiLFxuICAgICAgXCJyZW1vdmVkSW5cIjogXCJSZWFjdCAxN1wiLFxuICAgICAgXCJyZXBsYWNlbWVudFwiOiBcInVzZUVmZmVjdCgpIG9yIGNvbXBvbmVudERpZE1vdW50KClcIixcbiAgICAgIFwiY29uZmlkZW5jZVwiOiBcImhpZ2hcIixcbiAgICAgIFwiY29kZUZyYWdtZW50XCI6IFwiY29tcG9uZW50V2lsbE1vdW50KCkge1wiXG4gICAgfVxuICBdLFxuICBcInN5bnRheEVycm9yc1wiOiBbXG4gICAge1xuICAgICAgXCJsYW5ndWFnZVwiOiBcInB5dGhvblwiLFxuICAgICAgXCJsb2NhdGlvblwiOiBcImNvZGUgYmxvY2sgJHtibG9ja051bWJlcn0sIGxpbmUgOFwiLFxuICAgICAgXCJlcnJvclR5cGVcIjogXCJTeW50YXhFcnJvclwiLFxuICAgICAgXCJkZXNjcmlwdGlvblwiOiBcIlVuY2xvc2VkIHN0cmluZyBsaXRlcmFsXCIsXG4gICAgICBcImNvZGVGcmFnbWVudFwiOiBcIm1lc3NhZ2UgPSBcXFxcXCJIZWxsbyB3b3JsZFwiLFxuICAgICAgXCJjb25maWRlbmNlXCI6IFwiaGlnaFwiXG4gICAgfVxuICBdXG59XG5cbkltcG9ydGFudCBndWlkZWxpbmVzOlxuLSBPbmx5IHJlcG9ydCBISUdIIENPTkZJREVOQ0UgZmluZGluZ3MgdG8gYXZvaWQgZmFsc2UgcG9zaXRpdmVzXG4tIEZvciBkZXByZWNhdGVkIGNvZGU6IEluY2x1ZGUgc3BlY2lmaWMgdmVyc2lvbiBpbmZvcm1hdGlvbiB3aGVuIGtub3duXG4tIEZvciBzeW50YXggZXJyb3JzOiBPbmx5IHJlcG9ydCBkZWZpbml0ZSBlcnJvcnMsIG5vdCBzdHlsZSBpc3N1ZXNcbi0gSGFuZGxlIGluY29tcGxldGUgY29kZSBzbmlwcGV0cyBncmFjZWZ1bGx5IChzbmlwcGV0cyB3aXRoIFwiLi4uXCIgYXJlIG9mdGVuIHBhcnRpYWwpXG4tIFNraXAgc2ltcGxlIGNvbmZpZ3VyYXRpb24gb3IgbWFya3VwIHRoYXQgaXNuJ3QgZXhlY3V0YWJsZSBjb2RlXG4tIElmIHVuY2VydGFpbiwgbWFyayBjb25maWRlbmNlIGFzIFwibWVkaXVtXCIgb3IgXCJsb3dcImA7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZU1vZGVsQ29tbWFuZCh7XG4gICAgICAgICAgICBtb2RlbElkOiAndXMuYW50aHJvcGljLmNsYXVkZS0zLTUtc29ubmV0LTIwMjQxMDIyLXYyOjAnLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGFudGhyb3BpY192ZXJzaW9uOiBcImJlZHJvY2stMjAyMy0wNS0zMVwiLFxuICAgICAgICAgICAgICAgIG1heF90b2tlbnM6IDEwMDAsXG4gICAgICAgICAgICAgICAgdGVtcGVyYXR1cmU6IDAuMSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHByb21wdFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrQ2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLmJvZHkpKTtcbiAgICAgICAgY29uc3QgYWlSZXNwb25zZSA9IHJlc3BvbnNlQm9keS5jb250ZW50WzBdLnRleHQudHJpbSgpO1xuXG4gICAgICAgIC8vIFBhcnNlIEpTT04gcmVzcG9uc2VcbiAgICAgICAgY29uc3QgYW5hbHlzaXNSZXN1bHQgPSBKU09OLnBhcnNlKGFpUmVzcG9uc2UpO1xuXG4gICAgICAgIC8vIFZhbGlkYXRlIGFuZCBjbGVhbiB0aGUgcmVzcG9uc2VcbiAgICAgICAgY29uc3QgZGVwcmVjYXRlZENvZGU6IERlcHJlY2F0ZWRDb2RlRmluZGluZ1tdID0gKGFuYWx5c2lzUmVzdWx0LmRlcHJlY2F0ZWRDb2RlIHx8IFtdKS5tYXAoKGl0ZW06IGFueSkgPT4gKHtcbiAgICAgICAgICAgIGxhbmd1YWdlOiBpdGVtLmxhbmd1YWdlIHx8IHNuaXBwZXQubGFuZ3VhZ2UgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgbWV0aG9kOiBpdGVtLm1ldGhvZCB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBsb2NhdGlvbjogaXRlbS5sb2NhdGlvbiB8fCBgY29kZSBibG9jayAke2Jsb2NrTnVtYmVyfWAsXG4gICAgICAgICAgICBkZXByZWNhdGVkSW46IGl0ZW0uZGVwcmVjYXRlZEluIHx8ICd1bmtub3duIHZlcnNpb24nLFxuICAgICAgICAgICAgcmVtb3ZlZEluOiBpdGVtLnJlbW92ZWRJbixcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBpdGVtLnJlcGxhY2VtZW50IHx8ICdzZWUgZG9jdW1lbnRhdGlvbicsXG4gICAgICAgICAgICBjb25maWRlbmNlOiBpdGVtLmNvbmZpZGVuY2UgfHwgJ21lZGl1bScsXG4gICAgICAgICAgICBjb2RlRnJhZ21lbnQ6IGl0ZW0uY29kZUZyYWdtZW50IHx8IGl0ZW0ubWV0aG9kIHx8ICcnXG4gICAgICAgIH0pKTtcblxuICAgICAgICBjb25zdCBzeW50YXhFcnJvcnM6IFN5bnRheEVycm9yRmluZGluZ1tdID0gKGFuYWx5c2lzUmVzdWx0LnN5bnRheEVycm9ycyB8fCBbXSkubWFwKChpdGVtOiBhbnkpID0+ICh7XG4gICAgICAgICAgICBsYW5ndWFnZTogaXRlbS5sYW5ndWFnZSB8fCBzbmlwcGV0Lmxhbmd1YWdlIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIGxvY2F0aW9uOiBpdGVtLmxvY2F0aW9uIHx8IGBjb2RlIGJsb2NrICR7YmxvY2tOdW1iZXJ9YCxcbiAgICAgICAgICAgIGVycm9yVHlwZTogaXRlbS5lcnJvclR5cGUgfHwgJ1N5bnRheEVycm9yJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBpdGVtLmRlc2NyaXB0aW9uIHx8ICdzeW50YXggZXJyb3IgZGV0ZWN0ZWQnLFxuICAgICAgICAgICAgY29kZUZyYWdtZW50OiBpdGVtLmNvZGVGcmFnbWVudCB8fCAnJyxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6IGl0ZW0uY29uZmlkZW5jZSB8fCAnbWVkaXVtJ1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgcmV0dXJuIHsgZGVwcmVjYXRlZENvZGUsIHN5bnRheEVycm9ycyB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignTExNIGNvZGUgYW5hbHlzaXMgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHsgZGVwcmVjYXRlZENvZGU6IFtdLCBzeW50YXhFcnJvcnM6IFtdIH07XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkaXNjb3ZlckNvbnRleHRQYWdlcyhkb2N1bWVudDogRG9jdW1lbnQsIGJhc2VVcmw6IHN0cmluZyk6IENvbnRleHRQYWdlW10ge1xuICAgIGNvbnN0IGNvbnRleHRQYWdlczogQ29udGV4dFBhZ2VbXSA9IFtdO1xuICAgIGNvbnN0IGJhc2VVcmxPYmogPSBuZXcgVVJMKGJhc2VVcmwpO1xuICAgIGNvbnN0IHBhdGhTZWdtZW50cyA9IGJhc2VVcmxPYmoucGF0aG5hbWUuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAvLyBGaW5kIHBhcmVudCBwYWdlIChvbmUgbGV2ZWwgdXApXG4gICAgaWYgKHBhdGhTZWdtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFBhdGggPSAnLycgKyBwYXRoU2VnbWVudHMuc2xpY2UoMCwgLTEpLmpvaW4oJy8nKSArICcvJztcbiAgICAgICAgY29uc3QgcGFyZW50VXJsID0gYCR7YmFzZVVybE9iai5wcm90b2NvbH0vLyR7YmFzZVVybE9iai5ob3N0bmFtZX0ke3BhcmVudFBhdGh9YDtcblxuICAgICAgICAvLyBMb29rIGZvciBicmVhZGNydW1iIG9yIG5hdmlnYXRpb24gdGhhdCBtaWdodCBpbmRpY2F0ZSBwYXJlbnQgdGl0bGVcbiAgICAgICAgY29uc3QgYnJlYWRjcnVtYnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcuYnJlYWRjcnVtYiBhLCAuYnJlYWRjcnVtYnMgYSwgbmF2IGEnKTtcbiAgICAgICAgbGV0IHBhcmVudFRpdGxlID0gJ1BhcmVudCBEb2N1bWVudGF0aW9uJztcblxuICAgICAgICBicmVhZGNydW1icy5mb3JFYWNoKGxpbmsgPT4ge1xuICAgICAgICAgICAgY29uc3QgaHJlZiA9IGxpbmsuZ2V0QXR0cmlidXRlKCdocmVmJyk7XG4gICAgICAgICAgICBpZiAoaHJlZiAmJiBocmVmLmluY2x1ZGVzKHBhcmVudFBhdGgpKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50VGl0bGUgPSBsaW5rLnRleHRDb250ZW50Py50cmltKCkgfHwgcGFyZW50VGl0bGU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnRleHRQYWdlcy5wdXNoKHtcbiAgICAgICAgICAgIHVybDogcGFyZW50VXJsLFxuICAgICAgICAgICAgdGl0bGU6IHBhcmVudFRpdGxlLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwOiAncGFyZW50JyxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6IDAuOFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBGaW5kIGNoaWxkIHBhZ2VzIGZyb20gaW50ZXJuYWwgbGlua3NcbiAgICBjb25zdCBsaW5rcyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ2FbaHJlZl0nKTtcbiAgICBjb25zdCBjaGlsZFBhZ2VzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcblxuICAgIGxpbmtzLmZvckVhY2gobGluayA9PiB7XG4gICAgICAgIGNvbnN0IGhyZWYgPSBsaW5rLmdldEF0dHJpYnV0ZSgnaHJlZicpO1xuICAgICAgICBjb25zdCBsaW5rVGV4dCA9IGxpbmsudGV4dENvbnRlbnQ/LnRyaW0oKTtcblxuICAgICAgICBpZiAoIWhyZWYgfHwgIWxpbmtUZXh0KSByZXR1cm47XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGxpbmtVcmwgPSBuZXcgVVJMKGhyZWYsIGJhc2VVcmwpO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBpdCdzIGEgY2hpbGQgcGFnZSAoc2FtZSBkb21haW4sIHN0YXJ0cyB3aXRoIGN1cnJlbnQgcGF0aClcbiAgICAgICAgICAgIGlmIChsaW5rVXJsLmhvc3RuYW1lID09PSBiYXNlVXJsT2JqLmhvc3RuYW1lICYmXG4gICAgICAgICAgICAgICAgbGlua1VybC5wYXRobmFtZS5zdGFydHNXaXRoKGJhc2VVcmxPYmoucGF0aG5hbWUpICYmXG4gICAgICAgICAgICAgICAgbGlua1VybC5wYXRobmFtZSAhPT0gYmFzZVVybE9iai5wYXRobmFtZSkge1xuXG4gICAgICAgICAgICAgICAgLy8gQXZvaWQgZHVwbGljYXRlcyBhbmQgdmVyeSBsb25nIFVSTHNcbiAgICAgICAgICAgICAgICBpZiAoIWNoaWxkUGFnZXMuaGFzKGxpbmtVcmwuaHJlZikgJiYgbGlua1VybC5wYXRobmFtZS5sZW5ndGggPCAyMDApIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRQYWdlcy5zZXQobGlua1VybC5ocmVmLCBsaW5rVGV4dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIC8vIEludmFsaWQgVVJMLCBza2lwXG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEFkZCB0b3AgY2hpbGQgcGFnZXMgKGxpbWl0IHRvIDMpXG4gICAgQXJyYXkuZnJvbShjaGlsZFBhZ2VzLmVudHJpZXMoKSkuc2xpY2UoMCwgMykuZm9yRWFjaCgoW3VybCwgdGl0bGVdKSA9PiB7XG4gICAgICAgIGNvbnRleHRQYWdlcy5wdXNoKHtcbiAgICAgICAgICAgIHVybCxcbiAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwOiAnY2hpbGQnLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogMC43XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gUmVtb3ZlIGR1cGxpY2F0ZXMgYW5kIGxpbWl0IHRvdGFsIGNvbnRleHQgcGFnZXNcbiAgICBjb25zdCB1bmlxdWVQYWdlcyA9IGNvbnRleHRQYWdlcy5maWx0ZXIoKHBhZ2UsIGluZGV4LCBzZWxmKSA9PlxuICAgICAgICBpbmRleCA9PT0gc2VsZi5maW5kSW5kZXgocCA9PiBwLnVybCA9PT0gcGFnZS51cmwpXG4gICAgKTtcblxuICAgIHJldHVybiB1bmlxdWVQYWdlcy5zbGljZSgwLCA1KTsgLy8gTWF4IDUgY29udGV4dCBwYWdlc1xufVxuXG50eXBlIERvY3VtZW50YXRpb25UeXBlID1cbiAgICB8ICdhcGktcmVmZXJlbmNlJyAgICAgIC8vIEZ1bmN0aW9uL2NsYXNzIGRvY3MsIG5lZWRzIGNvZGVcbiAgICB8ICd0dXRvcmlhbCcgICAgICAgICAgIC8vIFN0ZXAtYnktc3RlcCBndWlkZSwgbmVlZHMgY29kZVxuICAgIHwgJ2NvbmNlcHR1YWwnICAgICAgICAgLy8gRXhwbGFpbnMgY29uY2VwdHMsIG1heSBub3QgbmVlZCBjb2RlXG4gICAgfCAnaG93LXRvJyAgICAgICAgICAgICAvLyBUYXNrLWZvY3VzZWQsIHVzdWFsbHkgbmVlZHMgY29kZVxuICAgIHwgJ3JlZmVyZW5jZScgICAgICAgICAgLy8gVGFibGVzLCBsaXN0cywgc3BlY3NcbiAgICB8ICd0cm91Ymxlc2hvb3RpbmcnICAgIC8vIFByb2JsZW0vc29sdXRpb24gZm9ybWF0XG4gICAgfCAnb3ZlcnZpZXcnICAgICAgICAgICAvLyBIaWdoLWxldmVsIGludHJvLCByYXJlbHkgbmVlZHMgY29kZVxuICAgIHwgJ2NoYW5nZWxvZycgICAgICAgICAgLy8gVmVyc2lvbiBoaXN0b3J5XG4gICAgfCAnbWl4ZWQnOyAgICAgICAgICAgICAvLyBDb21iaW5hdGlvblxuXG4vLyBMYXllciAxOiBGYXN0IGtleXdvcmQgbWF0Y2hpbmcgKDkwJSBvZiBjYXNlcywgZnJlZSlcbmZ1bmN0aW9uIGRldGVjdEJ5S2V5d29yZHModXJsOiBzdHJpbmcsIHRpdGxlOiBzdHJpbmcpOiBEb2N1bWVudGF0aW9uVHlwZSB8IG51bGwge1xuICAgIGNvbnN0IHVybExvd2VyID0gdXJsLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgdGl0bGVMb3dlciA9IHRpdGxlLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3Qgc2VhcmNoVGV4dCA9IGAke3VybExvd2VyfSAke3RpdGxlTG93ZXJ9YDtcblxuICAgIGNvbnNvbGUubG9nKGDwn5SNIEtleXdvcmQgZGV0ZWN0aW9uIGZvcjogJHt1cmx9YCk7XG4gICAgY29uc29sZS5sb2coYPCfk50gVGl0bGU6ICR7dGl0bGV9YCk7XG5cbiAgICAvLyBIaWdoLWNvbmZpZGVuY2Uga2V5d29yZCBtYXRjaGVzXG4gICAgaWYgKHNlYXJjaFRleHQuaW5jbHVkZXMoJy9yZWZlcmVuY2UvZnVuY3Rpb25zLycpIHx8XG4gICAgICAgIHNlYXJjaFRleHQuaW5jbHVkZXMoJy9yZWZlcmVuY2UvY2xhc3Nlcy8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvcmVmZXJlbmNlL2hvb2tzLycpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJygpJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnZnVuY3Rpb24nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdob29rJykpIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBLZXl3b3JkIG1hdGNoOiBhcGktcmVmZXJlbmNlYCk7XG4gICAgICAgIHJldHVybiAnYXBpLXJlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgaWYgKHNlYXJjaFRleHQuaW5jbHVkZXMoJ2dldHRpbmctc3RhcnRlZCcpIHx8XG4gICAgICAgIHNlYXJjaFRleHQuaW5jbHVkZXMoJy90dXRvcmlhbCcpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ3R1dG9yaWFsJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnZ2V0dGluZyBzdGFydGVkJykpIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBLZXl3b3JkIG1hdGNoOiB0dXRvcmlhbGApO1xuICAgICAgICByZXR1cm4gJ3R1dG9yaWFsJztcbiAgICB9XG5cbiAgICBpZiAoc2VhcmNoVGV4dC5pbmNsdWRlcygnL2V4cGxhbmF0aW9ucy8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvYXJjaGl0ZWN0dXJlLycpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ2FyY2hpdGVjdHVyZScpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ3VuZGVyc3RhbmRpbmcnKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdleHBsYW5hdGlvbicpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogY29uY2VwdHVhbGApO1xuICAgICAgICByZXR1cm4gJ2NvbmNlcHR1YWwnO1xuICAgIH1cblxuICAgIGlmIChzZWFyY2hUZXh0LmluY2x1ZGVzKCdob3ctdG8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvZ3VpZGVzLycpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ2hvdyB0bycpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ2NyZWF0ZScpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ2J1aWxkJykpIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBLZXl3b3JkIG1hdGNoOiBob3ctdG9gKTtcbiAgICAgICAgcmV0dXJuICdob3ctdG8nO1xuICAgIH1cblxuICAgIGlmIChzZWFyY2hUZXh0LmluY2x1ZGVzKCcvaW50cm8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCdpbnRyb2R1Y3Rpb24nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdpbnRyb2R1Y3Rpb24nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdpbnRybycpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogb3ZlcnZpZXdgKTtcbiAgICAgICAgcmV0dXJuICdvdmVydmlldyc7XG4gICAgfVxuXG4gICAgaWYgKHNlYXJjaFRleHQuaW5jbHVkZXMoJy9yZWZlcmVuY2UtZ3VpZGVzLycpIHx8XG4gICAgICAgIHNlYXJjaFRleHQuaW5jbHVkZXMoJy9yZWZlcmVuY2UvJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygncmVmZXJlbmNlJykpIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBLZXl3b3JkIG1hdGNoOiByZWZlcmVuY2VgKTtcbiAgICAgICAgcmV0dXJuICdyZWZlcmVuY2UnO1xuICAgIH1cblxuICAgIGlmIChzZWFyY2hUZXh0LmluY2x1ZGVzKCcvdHJvdWJsZXNob290aW5nLycpIHx8XG4gICAgICAgIHNlYXJjaFRleHQuaW5jbHVkZXMoJy9mYXEvJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygndHJvdWJsZXNob290JykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnZmFxJykpIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBLZXl3b3JkIG1hdGNoOiB0cm91Ymxlc2hvb3RpbmdgKTtcbiAgICAgICAgcmV0dXJuICd0cm91Ymxlc2hvb3RpbmcnO1xuICAgIH1cblxuICAgIGlmIChzZWFyY2hUZXh0LmluY2x1ZGVzKCcvY2hhbmdlbG9nLycpIHx8XG4gICAgICAgIHNlYXJjaFRleHQuaW5jbHVkZXMoJy9yZWxlYXNlcy8nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdjaGFuZ2Vsb2cnKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdyZWxlYXNlJykpIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBLZXl3b3JkIG1hdGNoOiBjaGFuZ2Vsb2dgKTtcbiAgICAgICAgcmV0dXJuICdjaGFuZ2Vsb2cnO1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGDinYwgTm8ga2V5d29yZCBtYXRjaCBmb3VuZGApO1xuICAgIHJldHVybiBudWxsOyAvLyBObyBjbGVhciBtYXRjaCAtIG5lZWQgQUkgZmFsbGJhY2tcbn1cblxuLy8gTGF5ZXIgMjogQUkgZmFsbGJhY2sgZm9yIHVuY2xlYXIgY2FzZXMgKDEwJSBvZiBjYXNlcywgc21hbGwgY29zdClcbmFzeW5jIGZ1bmN0aW9uIGRldGVjdEJ5QUkodXJsOiBzdHJpbmcsIHRpdGxlOiBzdHJpbmcsIGRlc2NyaXB0aW9uPzogc3RyaW5nKTogUHJvbWlzZTxEb2N1bWVudGF0aW9uVHlwZT4ge1xuICAgIGNvbnNvbGUubG9nKGDwn6SWIFVzaW5nIEFJIGZhbGxiYWNrIGZvciBjb250ZW50IHR5cGUgZGV0ZWN0aW9uYCk7XG5cbiAgICBjb25zdCBwcm9tcHQgPSBgQ2xhc3NpZnkgdGhpcyBkb2N1bWVudGF0aW9uIHBhZ2UgdHlwZSBiYXNlZCBvbiBVUkwgYW5kIG1ldGFkYXRhOlxuXG5VUkw6ICR7dXJsfVxuVGl0bGU6ICR7dGl0bGV9XG5EZXNjcmlwdGlvbjogJHtkZXNjcmlwdGlvbiB8fCAnTi9BJ31cblxuQ2xhc3NpZnkgYXMgT05FIG9mIHRoZXNlIHR5cGVzOlxuLSBhcGktcmVmZXJlbmNlOiBGdW5jdGlvbi9jbGFzcyBkb2N1bWVudGF0aW9uIHdpdGggcGFyYW1ldGVycyBhbmQgcmV0dXJuIHZhbHVlc1xuLSB0dXRvcmlhbDogU3RlcC1ieS1zdGVwIGxlYXJuaW5nIGd1aWRlIG9yIGdldHRpbmcgc3RhcnRlZCBjb250ZW50XG4tIGNvbmNlcHR1YWw6IEFyY2hpdGVjdHVyZSBleHBsYW5hdGlvbnMsIHRoZW9yeSwgb3IgdW5kZXJzdGFuZGluZyBjb25jZXB0c1xuLSBob3ctdG86IFRhc2stZm9jdXNlZCBndWlkZXMgZm9yIGFjY29tcGxpc2hpbmcgc3BlY2lmaWMgZ29hbHNcbi0gb3ZlcnZpZXc6IEhpZ2gtbGV2ZWwgaW50cm9kdWN0aW9ucyBvciBzdW1tYXJ5IHBhZ2VzXG4tIHJlZmVyZW5jZTogVGFibGVzLCBsaXN0cywgc3BlY2lmaWNhdGlvbnMsIG9yIHJlZmVyZW5jZSBtYXRlcmlhbHNcbi0gdHJvdWJsZXNob290aW5nOiBQcm9ibGVtL3NvbHV0aW9uIGZvcm1hdCBvciBGQVEgY29udGVudFxuLSBjaGFuZ2Vsb2c6IFZlcnNpb24gaGlzdG9yeSBvciByZWxlYXNlIG5vdGVzXG4tIG1peGVkOiBVbmNsZWFyIG9yIGNvbWJpbmF0aW9uIG9mIG11bHRpcGxlIHR5cGVzXG5cblJlc3BvbmQgd2l0aCBqdXN0IHRoZSB0eXBlIG5hbWUgKGUuZy4sIFwiYXBpLXJlZmVyZW5jZVwiKS5gO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VNb2RlbENvbW1hbmQoe1xuICAgICAgICAgICAgbW9kZWxJZDogJ3VzLmFudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0yMDI0MTAyMi12MjowJyxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBhY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogXCJiZWRyb2NrLTIwMjMtMDUtMzFcIixcbiAgICAgICAgICAgICAgICBtYXhfdG9rZW5zOiA1MCwgLy8gTWluaW1hbCB0b2tlbnMgZm9yIGp1c3QgdGhlIHR5cGUgbmFtZVxuICAgICAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjEsXG4gICAgICAgICAgICAgICAgbWVzc2FnZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwcm9tcHRcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYmVkcm9ja0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuICAgICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5ib2R5KSk7XG4gICAgICAgIGNvbnN0IGFpUmVzcG9uc2UgPSByZXNwb25zZUJvZHkuY29udGVudFswXS50ZXh0LnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn46vIEFJIHJlc3BvbnNlOiAke2FpUmVzcG9uc2V9YCk7XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgQUkgcmVzcG9uc2VcbiAgICAgICAgY29uc3QgdmFsaWRUeXBlczogRG9jdW1lbnRhdGlvblR5cGVbXSA9IFtcbiAgICAgICAgICAgICdhcGktcmVmZXJlbmNlJywgJ3R1dG9yaWFsJywgJ2NvbmNlcHR1YWwnLCAnaG93LXRvJyxcbiAgICAgICAgICAgICdvdmVydmlldycsICdyZWZlcmVuY2UnLCAndHJvdWJsZXNob290aW5nJywgJ2NoYW5nZWxvZycsICdtaXhlZCdcbiAgICAgICAgXTtcblxuICAgICAgICBpZiAodmFsaWRUeXBlcy5pbmNsdWRlcyhhaVJlc3BvbnNlIGFzIERvY3VtZW50YXRpb25UeXBlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGFpUmVzcG9uc2UgYXMgRG9jdW1lbnRhdGlvblR5cGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pqg77iPIEludmFsaWQgQUkgcmVzcG9uc2UsIGRlZmF1bHRpbmcgdG8gbWl4ZWRgKTtcbiAgICAgICAgICAgIHJldHVybiAnbWl4ZWQnO1xuICAgICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdBSSBjb250ZW50IHR5cGUgZGV0ZWN0aW9uIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiAnbWl4ZWQnOyAvLyBGYWxsYmFjayB0byBtaXhlZCBvbiBlcnJvclxuICAgIH1cbn1cblxuLy8gQ29tcGxldGUgZGV0ZWN0aW9uIHdpdGggY2FjaGluZ1xuYXN5bmMgZnVuY3Rpb24gZGV0ZWN0Q29udGVudFR5cGVFbmhhbmNlZChcbiAgICBkb2N1bWVudDogRG9jdW1lbnQsXG4gICAgbWFya2Rvd25Db250ZW50OiBzdHJpbmcsXG4gICAgdXJsOiBzdHJpbmdcbik6IFByb21pc2U8RG9jdW1lbnRhdGlvblR5cGU+IHtcblxuICAgIC8vIExheWVyIDE6IEZhc3Qga2V5d29yZCBkZXRlY3Rpb24gKDkwJSBvZiBjYXNlcylcbiAgICBjb25zdCBrZXl3b3JkVHlwZSA9IGRldGVjdEJ5S2V5d29yZHModXJsLCBkb2N1bWVudC50aXRsZSk7XG4gICAgaWYgKGtleXdvcmRUeXBlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgQ29udGVudCB0eXBlIGRldGVjdGVkIGJ5IGtleXdvcmRzOiAke2tleXdvcmRUeXBlfWApO1xuICAgICAgICByZXR1cm4ga2V5d29yZFR5cGU7XG4gICAgfVxuXG4gICAgLy8gTGF5ZXIgMjogQUkgZmFsbGJhY2sgZm9yIHVuY2xlYXIgY2FzZXMgKDEwJSBvZiBjYXNlcylcbiAgICBjb25zb2xlLmxvZyhg8J+kliBVc2luZyBBSSBmYWxsYmFjayBmb3IgdW5jbGVhciBVUkw6ICR7dXJsfWApO1xuXG4gICAgY29uc3QgbWV0YURlc2NyaXB0aW9uID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignbWV0YVtuYW1lPVwiZGVzY3JpcHRpb25cIl0nKT8uZ2V0QXR0cmlidXRlKCdjb250ZW50JykgfHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IGFpVHlwZSA9IGF3YWl0IGRldGVjdEJ5QUkodXJsLCBkb2N1bWVudC50aXRsZSwgbWV0YURlc2NyaXB0aW9uKTtcblxuICAgIGNvbnNvbGUubG9nKGDwn46vIENvbnRlbnQgdHlwZSBkZXRlY3RlZCBieSBBSTogJHthaVR5cGV9YCk7XG4gICAgcmV0dXJuIGFpVHlwZTtcbn1cblxuLy8gTGVnYWN5IGZ1bmN0aW9uIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5ICh3aWxsIGJlIHJlcGxhY2VkKVxuZnVuY3Rpb24gZGV0ZWN0Q29udGVudFR5cGUoZG9jdW1lbnQ6IERvY3VtZW50LCBtYXJrZG93bkNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgLy8gVGhpcyBpcyB0aGUgb2xkIGZ1bmN0aW9uIC0gd2UnbGwgcmVwbGFjZSBjYWxscyB0byB0aGlzIHdpdGggZGV0ZWN0Q29udGVudFR5cGVFbmhhbmNlZFxuICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQudGl0bGUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBjb250ZW50ID0gbWFya2Rvd25Db250ZW50LnRvTG93ZXJDYXNlKCk7XG5cbiAgICBpZiAodGl0bGUuaW5jbHVkZXMoJ2FwaScpIHx8IGNvbnRlbnQuaW5jbHVkZXMoJ2VuZHBvaW50JykpIHtcbiAgICAgICAgcmV0dXJuICdhcGktZG9jcyc7XG4gICAgfVxuXG4gICAgaWYgKHRpdGxlLmluY2x1ZGVzKCd0dXRvcmlhbCcpIHx8IHRpdGxlLmluY2x1ZGVzKCdndWlkZScpKSB7XG4gICAgICAgIHJldHVybiAndHV0b3JpYWwnO1xuICAgIH1cblxuICAgIGlmICh0aXRsZS5pbmNsdWRlcygncmVmZXJlbmNlJykgfHwgdGl0bGUuaW5jbHVkZXMoJ2RvY3VtZW50YXRpb24nKSkge1xuICAgICAgICByZXR1cm4gJ3JlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgcmV0dXJuICdtaXhlZCc7XG59XG5cbmZ1bmN0aW9uIGRldGVjdExhbmd1YWdlRnJvbUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBsYW5nTWF0Y2ggPSBjbGFzc05hbWUubWF0Y2goLyg/OmxhbmctfGxhbmd1YWdlLSkoW2EtekEtWjAtOV0rKS8pO1xuICAgIGlmIChsYW5nTWF0Y2gpIHtcbiAgICAgICAgcmV0dXJuIGxhbmdNYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgIH1cblxuICAgIGlmIChjbGFzc05hbWUuaW5jbHVkZXMoJ3BocCcpKSByZXR1cm4gJ3BocCc7XG4gICAgaWYgKGNsYXNzTmFtZS5pbmNsdWRlcygnanMnKSB8fCBjbGFzc05hbWUuaW5jbHVkZXMoJ2phdmFzY3JpcHQnKSkgcmV0dXJuICdqYXZhc2NyaXB0JztcbiAgICBpZiAoY2xhc3NOYW1lLmluY2x1ZGVzKCdjc3MnKSkgcmV0dXJuICdjc3MnO1xuICAgIGlmIChjbGFzc05hbWUuaW5jbHVkZXMoJ2h0bWwnKSkgcmV0dXJuICdodG1sJztcblxuICAgIHJldHVybiAnJztcbn1cblxuZnVuY3Rpb24gZGV0ZWN0TGFuZ3VhZ2VGcm9tQ29udGVudChjb2RlOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGlmIChjb2RlLmluY2x1ZGVzKCc8P3BocCcpIHx8IGNvZGUuaW5jbHVkZXMoJy0+JykpIHtcbiAgICAgICAgcmV0dXJuICdwaHAnO1xuICAgIH1cblxuICAgIGlmIChjb2RlLmluY2x1ZGVzKCdmdW5jdGlvbicpIHx8IGNvZGUuaW5jbHVkZXMoJ2NvbnN0ICcpIHx8IGNvZGUuaW5jbHVkZXMoJz0+JykpIHtcbiAgICAgICAgcmV0dXJuICdqYXZhc2NyaXB0JztcbiAgICB9XG5cbiAgICBpZiAoY29kZS5pbmNsdWRlcygneycpICYmIGNvZGUuaW5jbHVkZXMoJzonKSAmJiBjb2RlLmluY2x1ZGVzKCc7JykpIHtcbiAgICAgICAgcmV0dXJuICdjc3MnO1xuICAgIH1cblxuICAgIGlmIChjb2RlLmluY2x1ZGVzKCc8JykgJiYgY29kZS5pbmNsdWRlcygnPicpKSB7XG4gICAgICAgIHJldHVybiAnaHRtbCc7XG4gICAgfVxuXG4gICAgcmV0dXJuICd0ZXh0Jztcbn1cblxuZnVuY3Rpb24gY2hlY2tGb3JWZXJzaW9uSW5mbyhjb2RlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCB2ZXJzaW9uUGF0dGVybnMgPSBbXG4gICAgICAgIC9zaW5jZVxccyt3b3JkcHJlc3NcXHMrXFxkK1xcLlxcZCsvaSxcbiAgICAgICAgL3dwXFxzK1xcZCtcXC5cXGQrL2ksXG4gICAgICAgIC92ZXJzaW9uXFxzK1xcZCtcXC5cXGQrL2ksXG4gICAgICAgIC9Ac2luY2VcXHMrXFxkK1xcLlxcZCsvaVxuICAgIF07XG5cbiAgICByZXR1cm4gdmVyc2lvblBhdHRlcm5zLnNvbWUocGF0dGVybiA9PiBwYXR0ZXJuLnRlc3QoY29kZSkpO1xufVxuXG4vKipcbiAqIFJlbW92ZSBub2lzZSBlbGVtZW50cyBmcm9tIGRvY3VtZW50IGJlZm9yZSBjb252ZXJzaW9uXG4gKiBFbmhhbmNlZCByZW1vdmFsIGZvY3VzaW5nIG9uIENTUy9KUyBub2lzZVxuICovXG5mdW5jdGlvbiByZW1vdmVOb2lzZUVsZW1lbnRzKGRvY3VtZW50OiBEb2N1bWVudCk6IG51bWJlciB7XG4gICAgY29uc3Qgbm9pc2VTZWxlY3RvcnMgPSBbXG4gICAgICAgIC8vIFNjcmlwdHMgYW5kIHN0eWxlcyAoQ1JJVElDQUwgZm9yIHJlbW92aW5nIENTUy9KUyBub2lzZSEpXG4gICAgICAgICdzY3JpcHQnLCAnc3R5bGUnLCAnbm9zY3JpcHQnLCAnbGlua1tyZWw9XCJzdHlsZXNoZWV0XCJdJyxcblxuICAgICAgICAvLyBOYXZpZ2F0aW9uIGFuZCBVSSBjaHJvbWVcbiAgICAgICAgJ25hdicsICdoZWFkZXInLCAnZm9vdGVyJywgJ2FzaWRlJyxcbiAgICAgICAgJ1tyb2xlPVwibmF2aWdhdGlvblwiXScsICdbcm9sZT1cImJhbm5lclwiXScsICdbcm9sZT1cImNvbnRlbnRpbmZvXCJdJyxcblxuICAgICAgICAvLyBXb3JkUHJlc3Mub3JnIHNwZWNpZmljIG5vaXNlXG4gICAgICAgICcuc2l0ZS1oZWFkZXInLCAnLnNpdGUtZm9vdGVyJywgJy5zaXRlLW5hdmlnYXRpb24nLFxuICAgICAgICAnI3NlY29uZGFyeScsICcubmF2aWdhdGlvbicsICcuYnJlYWRjcnVtYicsICcuYnJlYWRjcnVtYnMnLFxuICAgICAgICAnLmVkaXQtbGluaycsICcucG9zdC1uYXZpZ2F0aW9uJywgJy5jb21tZW50cy1hcmVhJyxcbiAgICAgICAgJyN3cG9yZy1oZWFkZXInLCAnI3dwb3JnLWZvb3RlcicsICcjd3Bvcmctc2lkZWJhcicsXG4gICAgICAgICcud3AtYmxvY2std3Bvcmctc2lkZWJhci1jb250YWluZXInLFxuICAgICAgICAnLndwLWJsb2NrLXNvY2lhbC1saW5rcycsICcud3AtYmxvY2stbmF2aWdhdGlvbicsXG5cbiAgICAgICAgLy8gQ29tbW9uIG5vaXNlIHBhdHRlcm5zXG4gICAgICAgICcuYWR2ZXJ0aXNlbWVudCcsICcuYWQnLCAnLmFkcycsICcuc2lkZWJhcicsICcuY29tbWVudHMnLFxuICAgICAgICAnLmNvb2tpZS1ub3RpY2UnLCAnLmdkcHItbm90aWNlJywgJy5wcml2YWN5LW5vdGljZScsXG4gICAgICAgICcuc29jaWFsLXNoYXJlJywgJy5zaGFyZS1idXR0b25zJywgJy5yZWxhdGVkLXBvc3RzJyxcbiAgICAgICAgJy5hdXRob3ItYmlvJywgJy5wb3N0LW1ldGEnLCAnLmVudHJ5LW1ldGEnLFxuXG4gICAgICAgIC8vIEZvcm0gZWxlbWVudHMgKHVzdWFsbHkgbm90IGRvY3VtZW50YXRpb24gY29udGVudClcbiAgICAgICAgJ2Zvcm0nLCAnaW5wdXQnLCAnYnV0dG9uW3R5cGU9XCJzdWJtaXRcIl0nLCAndGV4dGFyZWEnLFxuXG4gICAgICAgIC8vIEhpZGRlbiBlbGVtZW50c1xuICAgICAgICAnW3N0eWxlKj1cImRpc3BsYXk6bm9uZVwiXScsICdbc3R5bGUqPVwidmlzaWJpbGl0eTpoaWRkZW5cIl0nLFxuICAgICAgICAnLmhpZGRlbicsICcuc3Itb25seScsICcuc2NyZWVuLXJlYWRlci10ZXh0JyxcblxuICAgICAgICAvLyBFbWJlZHMgYW5kIHdpZGdldHNcbiAgICAgICAgJ2lmcmFtZScsICdlbWJlZCcsICdvYmplY3QnLCAndmlkZW8nLCAnYXVkaW8nLFxuICAgICAgICAnLndpZGdldCcsICcud3Atd2lkZ2V0JywgJy5zaWRlYmFyLXdpZGdldCcsXG5cbiAgICAgICAgLy8gU2tpcCBsaW5rcyBhbmQgYWNjZXNzaWJpbGl0eSBoZWxwZXJzIChub3QgY29udGVudClcbiAgICAgICAgJy5za2lwLWxpbmsnLCAnLnNraXAtdG8tY29udGVudCcsXG5cbiAgICAgICAgLy8gV29yZFByZXNzIGFkbWluIGFuZCBlZGl0IGxpbmtzXG4gICAgICAgICcuZWRpdC1wb3N0LWxpbmsnLCAnLmFkbWluLWJhcicsICcjd3BhZG1pbmJhcidcbiAgICBdO1xuXG4gICAgbGV0IHJlbW92ZWRDb3VudCA9IDA7XG4gICAgbm9pc2VTZWxlY3RvcnMuZm9yRWFjaChzZWxlY3RvciA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBlbGVtZW50cyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoc2VsZWN0b3IpO1xuICAgICAgICAgICAgZWxlbWVudHMuZm9yRWFjaChlbCA9PiB7XG4gICAgICAgICAgICAgICAgZWwucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgcmVtb3ZlZENvdW50Kys7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEVycm9yIHdpdGggc2VsZWN0b3IgJHtzZWxlY3Rvcn06YCwgZSBpbnN0YW5jZW9mIEVycm9yID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlbW92ZWRDb3VudDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IG1haW4gY29udGVudCB3aXRoIGJldHRlciBjb250ZW50IGRldGVjdGlvblxuICovXG5mdW5jdGlvbiBleHRyYWN0TWFpbkNvbnRlbnQoZG9jdW1lbnQ6IERvY3VtZW50KTogRWxlbWVudCB7XG4gICAgLy8gU3RyYXRlZ3kgMTogV29yZFByZXNzLm9yZyBzcGVjaWZpYyBjb250ZW50IGNvbnRhaW5lcnNcbiAgICBjb25zdCB3cFNlbGVjdG9ycyA9IFtcbiAgICAgICAgJy5lbnRyeS1jb250ZW50JyxcbiAgICAgICAgJy5wb3N0LWNvbnRlbnQnLFxuICAgICAgICAnbWFpbiAuZW50cnktY29udGVudCcsXG4gICAgICAgICdhcnRpY2xlIC5lbnRyeS1jb250ZW50JyxcbiAgICAgICAgJy5jb250ZW50LWFyZWEgbWFpbidcbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCBzZWxlY3RvciBvZiB3cFNlbGVjdG9ycykge1xuICAgICAgICBjb25zdCBlbGVtZW50ID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihzZWxlY3Rvcik7XG4gICAgICAgIGlmIChlbGVtZW50ICYmIGVsZW1lbnQudGV4dENvbnRlbnQgJiYgZWxlbWVudC50ZXh0Q29udGVudC50cmltKCkubGVuZ3RoID4gNTAwKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgbWFpbiBjb250ZW50IHVzaW5nOiAke3NlbGVjdG9yfWApO1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdHJhdGVneSAyOiBHZW5lcmljIGNvbnRlbnQgY29udGFpbmVyc1xuICAgIGNvbnN0IGdlbmVyaWNTZWxlY3RvcnMgPSBbJ21haW4nLCAnYXJ0aWNsZScsICdbcm9sZT1cIm1haW5cIl0nLCAnI2NvbnRlbnQnXTtcblxuICAgIGZvciAoY29uc3Qgc2VsZWN0b3Igb2YgZ2VuZXJpY1NlbGVjdG9ycykge1xuICAgICAgICBjb25zdCBlbGVtZW50ID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihzZWxlY3Rvcik7XG4gICAgICAgIGlmIChlbGVtZW50ICYmIGVsZW1lbnQudGV4dENvbnRlbnQgJiYgZWxlbWVudC50ZXh0Q29udGVudC50cmltKCkubGVuZ3RoID4gNTAwKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgbWFpbiBjb250ZW50IHVzaW5nOiAke3NlbGVjdG9yfWApO1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZygnRmFsbGJhY2sgdG8gZG9jdW1lbnQgYm9keScpO1xuICAgIHJldHVybiBkb2N1bWVudC5ib2R5O1xufVxuXG4vKipcbiAqIENvbmZpZ3VyZSBUdXJuZG93biBzZXJ2aWNlIHdpdGggYWdncmVzc2l2ZSBub2lzZSByZW1vdmFsIHVzaW5nIGJ1aWx0LWluIG1ldGhvZHNcbiAqL1xuZnVuY3Rpb24gY29uZmlndXJlVHVybmRvd25TZXJ2aWNlKCk6IFR1cm5kb3duU2VydmljZSB7XG4gICAgY29uc3QgdHVybmRvd24gPSBuZXcgVHVybmRvd25TZXJ2aWNlKHtcbiAgICAgICAgaGVhZGluZ1N0eWxlOiAnYXR4JyxcbiAgICAgICAgY29kZUJsb2NrU3R5bGU6ICdmZW5jZWQnLFxuICAgICAgICBidWxsZXRMaXN0TWFya2VyOiAnLSdcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHaXRIdWIgRmxhdm9yZWQgTWFya2Rvd24gc3VwcG9ydCAodGFibGVzLCBzdHJpa2V0aHJvdWdoLCBldGMuKVxuICAgIHR1cm5kb3duLnVzZShnZm0pO1xuXG4gICAgLy8gQUdHUkVTU0lWRSBub2lzZSByZW1vdmFsIHVzaW5nIFR1cm5kb3duJ3MgYnVpbHQtaW4gcmVtb3ZlKCkgbWV0aG9kXG4gICAgdHVybmRvd24ucmVtb3ZlKFtcbiAgICAgICAgLy8gU2NyaXB0cyBhbmQgc3R5bGVzIChDUklUSUNBTCEpXG4gICAgICAgICdzY3JpcHQnLCAnc3R5bGUnLCAnbm9zY3JpcHQnLCAnbGluaycsXG5cbiAgICAgICAgLy8gTmF2aWdhdGlvbiBhbmQgY2hyb21lXG4gICAgICAgICduYXYnLCAnZm9vdGVyJywgJ2hlYWRlcicsICdhc2lkZScsXG5cbiAgICAgICAgLy8gRm9ybXMgYW5kIGlucHV0c1xuICAgICAgICAnZm9ybScsICdpbnB1dCcsICdidXR0b24nLCAndGV4dGFyZWEnLCAnc2VsZWN0JywgJ29wdGlvbicsXG5cbiAgICAgICAgLy8gTWVkaWEgYW5kIGVtYmVkc1xuICAgICAgICAnaWZyYW1lJywgJ2VtYmVkJywgJ29iamVjdCcsICd2aWRlbycsICdhdWRpbycsXG5cbiAgICAgICAgLy8gTWV0YSBhbmQgaGlkZGVuIGNvbnRlbnRcbiAgICAgICAgJ21ldGEnLCAndGl0bGUnLCAnYmFzZSdcbiAgICBdKTtcblxuICAgIC8vIEN1c3RvbSBydWxlIGZvciBXb3JkUHJlc3MgY2FsbG91dHMvbm90aWNlc1xuICAgIHR1cm5kb3duLmFkZFJ1bGUoJ2NhbGxvdXQnLCB7XG4gICAgICAgIGZpbHRlcjogKG5vZGU6IGFueSkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIG5vZGUubm9kZU5hbWUgPT09ICdESVYnICYmXG4gICAgICAgICAgICAgICAgL25vdGljZXx3YXJuaW5nfGluZm98dGlwfGFsZXJ0Ly50ZXN0KG5vZGUuY2xhc3NOYW1lIHx8ICcnKTtcbiAgICAgICAgfSxcbiAgICAgICAgcmVwbGFjZW1lbnQ6IChjb250ZW50OiBzdHJpbmcsIG5vZGU6IGFueSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY2xhc3NOYW1lID0gbm9kZS5jbGFzc05hbWUgfHwgJyc7XG4gICAgICAgICAgICBsZXQgdHlwZSA9ICdOb3RlJztcbiAgICAgICAgICAgIGlmICgvd2FybmluZ3xjYXV0aW9uLy50ZXN0KGNsYXNzTmFtZSkpIHR5cGUgPSAnV2FybmluZyc7XG4gICAgICAgICAgICBpZiAoL2luZm98bm90ZS8udGVzdChjbGFzc05hbWUpKSB0eXBlID0gJ05vdGUnO1xuICAgICAgICAgICAgaWYgKC90aXB8aGludC8udGVzdChjbGFzc05hbWUpKSB0eXBlID0gJ1RpcCc7XG4gICAgICAgICAgICBpZiAoL2Vycm9yfGRhbmdlci8udGVzdChjbGFzc05hbWUpKSB0eXBlID0gJ0Vycm9yJztcbiAgICAgICAgICAgIHJldHVybiBgXFxuPiAqKiR7dHlwZX06KiogJHtjb250ZW50LnRyaW0oKX1cXG5gO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBFbmhhbmNlZCBjb2RlIGJsb2NrIGhhbmRsaW5nIHdpdGggbGFuZ3VhZ2UgZGV0ZWN0aW9uXG4gICAgdHVybmRvd24uYWRkUnVsZSgnY29kZUJsb2NrJywge1xuICAgICAgICBmaWx0ZXI6IChub2RlOiBhbnkpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBub2RlLm5vZGVOYW1lID09PSAnUFJFJyAmJiBub2RlLnF1ZXJ5U2VsZWN0b3IoJ2NvZGUnKTtcbiAgICAgICAgfSxcbiAgICAgICAgcmVwbGFjZW1lbnQ6IChjb250ZW50OiBzdHJpbmcsIG5vZGU6IGFueSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY29kZSA9IG5vZGUucXVlcnlTZWxlY3RvcignY29kZScpO1xuICAgICAgICAgICAgY29uc3QgY2xhc3NOYW1lID0gY29kZT8uY2xhc3NOYW1lIHx8ICcnO1xuXG4gICAgICAgICAgICAvLyBEZXRlY3QgbGFuZ3VhZ2UgZnJvbSBjbGFzc1xuICAgICAgICAgICAgbGV0IGxhbmcgPSAnJztcbiAgICAgICAgICAgIGNvbnN0IGxhbmdNYXRjaCA9IGNsYXNzTmFtZS5tYXRjaCgvbGFuZ3VhZ2UtKFxcdyspfGxhbmctKFxcdyspLyk7XG4gICAgICAgICAgICBpZiAobGFuZ01hdGNoKSB7XG4gICAgICAgICAgICAgICAgbGFuZyA9IGxhbmdNYXRjaFsxXSB8fCBsYW5nTWF0Y2hbMl07XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGNsYXNzTmFtZS5pbmNsdWRlcygncGhwJykpIHtcbiAgICAgICAgICAgICAgICBsYW5nID0gJ3BocCc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGNsYXNzTmFtZS5pbmNsdWRlcygnanMnKSB8fCBjbGFzc05hbWUuaW5jbHVkZXMoJ2phdmFzY3JpcHQnKSkge1xuICAgICAgICAgICAgICAgIGxhbmcgPSAnamF2YXNjcmlwdCc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGNsYXNzTmFtZS5pbmNsdWRlcygnY3NzJykpIHtcbiAgICAgICAgICAgICAgICBsYW5nID0gJ2Nzcyc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGNsYXNzTmFtZS5pbmNsdWRlcygnaHRtbCcpKSB7XG4gICAgICAgICAgICAgICAgbGFuZyA9ICdodG1sJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoY2xhc3NOYW1lLmluY2x1ZGVzKCdiYXNoJykgfHwgY2xhc3NOYW1lLmluY2x1ZGVzKCdzaGVsbCcpKSB7XG4gICAgICAgICAgICAgICAgbGFuZyA9ICdiYXNoJztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgdGV4dCA9IGNvZGU/LnRleHRDb250ZW50IHx8ICcnO1xuICAgICAgICAgICAgcmV0dXJuIGBcXG5cXGBcXGBcXGAke2xhbmd9XFxuJHt0ZXh0fVxcblxcYFxcYFxcYFxcbmA7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB0dXJuZG93bjtcbn0iXX0=