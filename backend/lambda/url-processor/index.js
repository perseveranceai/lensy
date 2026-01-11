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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
            htmlContent: cleanHtml, // Store cleaned HTML, not raw
            markdownContent: markdownContent, // Clean markdown
            mediaElements: mediaElements.slice(0, 10), // Limit media elements
            codeSnippets: codeSnippets.slice(0, 15), // Limit code snippets
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
            code: code.trim().slice(0, 1000), // Limit code snippet size
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
        analysisScope: 'current-page-only', // Will be updated by context analysis if enabled
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
                max_tokens: 50, // Minimal tokens for just the type name
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxrREFBa0Y7QUFDbEYsNEVBQTJGO0FBQzNGLDhEQUEwRjtBQUMxRiwwREFBOEQ7QUFDOUQsaUNBQThCO0FBQzlCLHdEQUF1QztBQUN2Qyw2REFBMEM7QUFDMUMsK0NBQWlDO0FBQ2pDLDZEQUF5RDtBQWlGekQsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFDakYsTUFBTSxhQUFhLEdBQUcsSUFBSSw2Q0FBb0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBQ2xHLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBRTNGOzs7R0FHRztBQUNILFNBQVMsMkJBQTJCLENBQUMsR0FBVyxFQUFFLGlCQUF5QjtJQUN2RSxNQUFNLGFBQWEsR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDeEMsTUFBTSxLQUFLLEdBQUcsR0FBRyxhQUFhLElBQUksaUJBQWlCLEVBQUUsQ0FBQztJQUN0RCxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDckUsT0FBTyxXQUFXLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDOUMsQ0FBQztBQUVEOzs7Ozs7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Q0FBQyxDQUFDLENBQUMsQ0FBQztZQUN4QyxDQUFDO2lCQUFNLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNuQyxJQUFJLEdBQUcsS0FBSyxDQUFDO1lBQ2pCLENBQUM7aUJBQU0sSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztnQkFDdEUsSUFBSSxHQUFHLFlBQVksQ0FBQztZQUN4QixDQUFDO2lCQUFNLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNuQyxJQUFJLEdBQUcsS0FBSyxDQUFDO1lBQ2pCLENBQUM7aUJBQU0sSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBQ3BDLElBQUksR0FBRyxNQUFNLENBQUM7WUFDbEIsQ0FBQztpQkFBTSxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUNuRSxJQUFJLEdBQUcsTUFBTSxDQUFDO1lBQ2xCLENBQUM7WUFFRCxNQUFNLElBQUksR0FBRyxJQUFJLEVBQUUsV0FBVyxJQUFJLEVBQUUsQ0FBQztZQUNyQyxPQUFPLFdBQVcsSUFBSSxLQUFLLElBQUksWUFBWSxDQUFDO1FBQ2hELENBQUM7S0FDSixDQUFDLENBQUM7SUFFSCxPQUFPLFFBQVEsQ0FBQztBQUNwQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSGFuZGxlciB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUzNDbGllbnQsIFB1dE9iamVjdENvbW1hbmQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgQmVkcm9ja1J1bnRpbWVDbGllbnQsIEludm9rZU1vZGVsQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1iZWRyb2NrLXJ1bnRpbWUnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQsIEdldEl0ZW1Db21tYW5kLCBQdXRJdGVtQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBtYXJzaGFsbCwgdW5tYXJzaGFsbCB9IGZyb20gJ0Bhd3Mtc2RrL3V0aWwtZHluYW1vZGInO1xuaW1wb3J0IHsgSlNET00gfSBmcm9tICdqc2RvbSc7XG5pbXBvcnQgVHVybmRvd25TZXJ2aWNlIGZyb20gJ3R1cm5kb3duJztcbmltcG9ydCB7IGdmbSB9IGZyb20gJ3R1cm5kb3duLXBsdWdpbi1nZm0nO1xuaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBQcm9ncmVzc1B1Ymxpc2hlciB9IGZyb20gJy4vcHJvZ3Jlc3MtcHVibGlzaGVyJztcblxuLy8gRm9yY2UgcmVidWlsZCAtIGNhY2hlIGZpeCBkZXBsb3ltZW50IHdpdGggcHJvZ3Jlc3Mgc3RyZWFtaW5nXG5cbmludGVyZmFjZSBVUkxQcm9jZXNzb3JFdmVudCB7XG4gICAgdXJsOiBzdHJpbmc7XG4gICAgc2VsZWN0ZWRNb2RlbDogc3RyaW5nO1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIGFuYWx5c2lzU3RhcnRUaW1lOiBudW1iZXI7XG4gICAgY29udGV4dEFuYWx5c2lzPzoge1xuICAgICAgICBlbmFibGVkOiBib29sZWFuO1xuICAgICAgICBtYXhDb250ZXh0UGFnZXM/OiBudW1iZXI7XG4gICAgfTtcbiAgICBjYWNoZUNvbnRyb2w/OiB7XG4gICAgICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgfTtcbn1cblxuaW50ZXJmYWNlIFVSTFByb2Nlc3NvclJlc3BvbnNlIHtcbiAgICBzdWNjZXNzOiBib29sZWFuO1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFByb2Nlc3NlZENvbnRlbnRJbmRleCB7XG4gICAgdXJsOiBzdHJpbmc7XG4gICAgY29udGV4dHVhbFNldHRpbmc6IHN0cmluZztcbiAgICBwcm9jZXNzZWRBdDogc3RyaW5nO1xuICAgIGNvbnRlbnRIYXNoOiBzdHJpbmc7XG4gICAgczNMb2NhdGlvbjogc3RyaW5nO1xuICAgIHR0bDogbnVtYmVyO1xuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmc7XG4gICAgbm9pc2VSZWR1Y3Rpb25NZXRyaWNzOiB7XG4gICAgICAgIG9yaWdpbmFsU2l6ZTogbnVtYmVyO1xuICAgICAgICBjbGVhbmVkU2l6ZTogbnVtYmVyO1xuICAgICAgICByZWR1Y3Rpb25QZXJjZW50OiBudW1iZXI7XG4gICAgfTtcbn1cblxuaW50ZXJmYWNlIENvbnRleHRQYWdlIHtcbiAgICB1cmw6IHN0cmluZztcbiAgICB0aXRsZTogc3RyaW5nO1xuICAgIHJlbGF0aW9uc2hpcDogJ3BhcmVudCcgfCAnY2hpbGQnIHwgJ3NpYmxpbmcnO1xuICAgIGNvbmZpZGVuY2U6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIExpbmtJc3N1ZSB7XG4gICAgdXJsOiBzdHJpbmc7XG4gICAgc3RhdHVzOiBudW1iZXIgfCBzdHJpbmc7XG4gICAgYW5jaG9yVGV4dDogc3RyaW5nO1xuICAgIHNvdXJjZUxvY2F0aW9uOiBzdHJpbmc7XG4gICAgZXJyb3JNZXNzYWdlOiBzdHJpbmc7XG4gICAgaXNzdWVUeXBlOiAnNDA0JyB8ICdlcnJvcicgfCAndGltZW91dCcgfCAnYWNjZXNzLWRlbmllZCc7XG59XG5cbmludGVyZmFjZSBEZXByZWNhdGVkQ29kZUZpbmRpbmcge1xuICAgIGxhbmd1YWdlOiBzdHJpbmc7XG4gICAgbWV0aG9kOiBzdHJpbmc7XG4gICAgbG9jYXRpb246IHN0cmluZztcbiAgICBkZXByZWNhdGVkSW46IHN0cmluZztcbiAgICByZW1vdmVkSW4/OiBzdHJpbmc7XG4gICAgcmVwbGFjZW1lbnQ6IHN0cmluZztcbiAgICBjb25maWRlbmNlOiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnO1xuICAgIGNvZGVGcmFnbWVudDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgU3ludGF4RXJyb3JGaW5kaW5nIHtcbiAgICBsYW5ndWFnZTogc3RyaW5nO1xuICAgIGxvY2F0aW9uOiBzdHJpbmc7XG4gICAgZXJyb3JUeXBlOiBzdHJpbmc7XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgICBjb2RlRnJhZ21lbnQ6IHN0cmluZztcbiAgICBjb25maWRlbmNlOiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnO1xufVxuXG5pbnRlcmZhY2UgQ29udGV4dEFuYWx5c2lzUmVzdWx0IHtcbiAgICBjb250ZXh0UGFnZXM6IENvbnRleHRQYWdlW107XG4gICAgYW5hbHlzaXNTY29wZTogJ3NpbmdsZS1wYWdlJyB8ICd3aXRoLWNvbnRleHQnO1xuICAgIHRvdGFsUGFnZXNBbmFseXplZDogbnVtYmVyO1xufVxuXG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcbmNvbnN0IGJlZHJvY2tDbGllbnQgPSBuZXcgQmVkcm9ja1J1bnRpbWVDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5cbi8qKlxuICogR2VuZXJhdGUgY29uc2lzdGVudCBzZXNzaW9uIElEIGJhc2VkIG9uIFVSTCBhbmQgY29udGV4dCBzZXR0aW5nXG4gKiBTYW1lIFVSTCArIGNvbnRleHQgc2V0dGluZyA9IHNhbWUgc2Vzc2lvbiBJRCA9IGNhY2hlIHJldXNlXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlQ29uc2lzdGVudFNlc3Npb25JZCh1cmw6IHN0cmluZywgY29udGV4dHVhbFNldHRpbmc6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFVybCA9IG5vcm1hbGl6ZVVybCh1cmwpO1xuICAgIGNvbnN0IGlucHV0ID0gYCR7bm9ybWFsaXplZFVybH0jJHtjb250ZXh0dWFsU2V0dGluZ31gO1xuICAgIGNvbnN0IGhhc2ggPSBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGlucHV0KS5kaWdlc3QoJ2hleCcpO1xuICAgIHJldHVybiBgc2Vzc2lvbi0ke2hhc2guc3Vic3RyaW5nKDAsIDEyKX1gO1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBVUkwgdG8gZW5zdXJlIGNvbnNpc3RlbnQgY2FjaGluZ1xuICogLSBSZW1vdmUgZnJhZ21lbnRzICgjc2VjdGlvbilcbiAqIC0gU29ydCBxdWVyeSBwYXJhbWV0ZXJzXG4gKiAtIFJlbW92ZSB0cmFpbGluZyBzbGFzaGVzXG4gKiAtIENvbnZlcnQgdG8gbG93ZXJjYXNlIGhvc3RuYW1lXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVVybCh1cmw6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdXJsT2JqID0gbmV3IFVSTCh1cmwpO1xuXG4gICAgICAgIC8vIFJlbW92ZSBmcmFnbWVudFxuICAgICAgICB1cmxPYmouaGFzaCA9ICcnO1xuXG4gICAgICAgIC8vIFNvcnQgcXVlcnkgcGFyYW1ldGVycyBmb3IgY29uc2lzdGVuY3lcbiAgICAgICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh1cmxPYmouc2VhcmNoKTtcbiAgICAgICAgY29uc3Qgc29ydGVkUGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcygpO1xuICAgICAgICBBcnJheS5mcm9tKHBhcmFtcy5rZXlzKCkpLnNvcnQoKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICBzb3J0ZWRQYXJhbXMuc2V0KGtleSwgcGFyYW1zLmdldChrZXkpIHx8ICcnKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHVybE9iai5zZWFyY2ggPSBzb3J0ZWRQYXJhbXMudG9TdHJpbmcoKTtcblxuICAgICAgICAvLyBSZW1vdmUgdHJhaWxpbmcgc2xhc2ggZnJvbSBwYXRobmFtZSAoZXhjZXB0IGZvciByb290KVxuICAgICAgICBpZiAodXJsT2JqLnBhdGhuYW1lICE9PSAnLycgJiYgdXJsT2JqLnBhdGhuYW1lLmVuZHNXaXRoKCcvJykpIHtcbiAgICAgICAgICAgIHVybE9iai5wYXRobmFtZSA9IHVybE9iai5wYXRobmFtZS5zbGljZSgwLCAtMSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMb3dlcmNhc2UgaG9zdG5hbWUgZm9yIGNvbnNpc3RlbmN5XG4gICAgICAgIHVybE9iai5ob3N0bmFtZSA9IHVybE9iai5ob3N0bmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIHJldHVybiB1cmxPYmoudG9TdHJpbmcoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBub3JtYWxpemUgVVJMLCB1c2luZyBvcmlnaW5hbDonLCB1cmwpO1xuICAgICAgICByZXR1cm4gdXJsO1xuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8VVJMUHJvY2Vzc29yRXZlbnQsIFVSTFByb2Nlc3NvclJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xuICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIFVSTDonLCBldmVudC51cmwpO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBwcm9ncmVzcyBwdWJsaXNoZXJcbiAgICBjb25zdCBwcm9ncmVzcyA9IG5ldyBQcm9ncmVzc1B1Ymxpc2hlcihldmVudC5zZXNzaW9uSWQpO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gU2VuZCBpbml0aWFsIHByb2dyZXNzXG4gICAgICAgIGF3YWl0IHByb2dyZXNzLnByb2dyZXNzKCdQcm9jZXNzaW5nIFVSTC4uLicsICd1cmwtcHJvY2Vzc2luZycpO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIGNhY2hpbmcgaXMgZW5hYmxlZCAoZGVmYXVsdCB0byB0cnVlIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxuICAgICAgICBjb25zdCBjYWNoZUVuYWJsZWQgPSBldmVudC5jYWNoZUNvbnRyb2w/LmVuYWJsZWQgIT09IGZhbHNlO1xuXG4gICAgICAgIC8vIEdlbmVyYXRlIGNvbnNpc3RlbnQgc2Vzc2lvbiBJRCBiYXNlZCBvbiBVUkwgKyBjb250ZXh0IHNldHRpbmdcbiAgICAgICAgY29uc3QgY29udGV4dEVuYWJsZWQgPSBldmVudC5jb250ZXh0QW5hbHlzaXM/LmVuYWJsZWQgfHwgZmFsc2U7XG4gICAgICAgIGNvbnN0IGNvbnRleHR1YWxTZXR0aW5nID0gY29udGV4dEVuYWJsZWQgPyAnd2l0aC1jb250ZXh0JyA6ICd3aXRob3V0LWNvbnRleHQnO1xuICAgICAgICBjb25zdCBjb25zaXN0ZW50U2Vzc2lvbklkID0gZ2VuZXJhdGVDb25zaXN0ZW50U2Vzc2lvbklkKGV2ZW50LnVybCwgY29udGV4dHVhbFNldHRpbmcpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBHZW5lcmF0ZWQgY29uc2lzdGVudCBzZXNzaW9uIElEOiAke2NvbnNpc3RlbnRTZXNzaW9uSWR9IChjb250ZXh0OiAke2NvbnRleHRFbmFibGVkfSwgY2FjaGU6ICR7Y2FjaGVFbmFibGVkfSlgKTtcblxuICAgICAgICAvLyBTdGVwIDE6IENoZWNrIGNhY2hlIGZpcnN0IHVzaW5nIGNvbnNpc3RlbnQgc2Vzc2lvbiBJRCAob25seSBpZiBjYWNoaW5nIGlzIGVuYWJsZWQpXG4gICAgICAgIGxldCBjYWNoZWRDb250ZW50ID0gbnVsbDtcbiAgICAgICAgaWYgKGNhY2hlRW5hYmxlZCkge1xuICAgICAgICAgICAgY2FjaGVkQ29udGVudCA9IGF3YWl0IGNoZWNrUHJvY2Vzc2VkQ29udGVudENhY2hlKGV2ZW50LnVybCwgY29udGV4dHVhbFNldHRpbmcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ+KaoO+4jyBDYWNoZSBkaXNhYmxlZCBieSB1c2VyIC0gc2tpcHBpbmcgY2FjaGUgY2hlY2snKTtcbiAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmluZm8oJ+KaoO+4jyBDYWNoZSBkaXNhYmxlZCAtIHJ1bm5pbmcgZnJlc2ggYW5hbHlzaXMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjYWNoZWRDb250ZW50ICYmICFpc0NhY2hlRXhwaXJlZChjYWNoZWRDb250ZW50KSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYENhY2hlIGhpdCEgVXNpbmcgY2FjaGVkIGNvbnRlbnQgZnJvbSBzZXNzaW9uOiAke2NvbnNpc3RlbnRTZXNzaW9uSWR9YCk7XG5cbiAgICAgICAgICAgIC8vIFNlbmQgY2FjaGUgaGl0IG1lc3NhZ2VcbiAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmNhY2hlSGl0KGBDYWNoZSBISVQhIOKaoSBVc2luZyBjYWNoZWQgYW5hbHlzaXMgZnJvbSAke25ldyBEYXRlKGNhY2hlZENvbnRlbnQucHJvY2Vzc2VkQXQpLnRvTG9jYWxlRGF0ZVN0cmluZygpfWAsIHtcbiAgICAgICAgICAgICAgICBjYWNoZVN0YXR1czogJ2hpdCcsXG4gICAgICAgICAgICAgICAgY29udGVudFR5cGU6IGNhY2hlZENvbnRlbnQuY29udGVudFR5cGVcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBDb3B5IGNhY2hlZCBjb250ZW50IHRvIGN1cnJlbnQgc2Vzc2lvbiBsb2NhdGlvbiAoaWYgZGlmZmVyZW50KVxuICAgICAgICAgICAgaWYgKGNvbnNpc3RlbnRTZXNzaW9uSWQgIT09IGV2ZW50LnNlc3Npb25JZCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGNvcHlDYWNoZWRDb250ZW50VG9TZXNzaW9uKGNhY2hlZENvbnRlbnQuczNMb2NhdGlvbiwgZXZlbnQuc2Vzc2lvbklkKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQWRkIGNhY2hlIG1ldGFkYXRhIHRvIHRoZSBwcm9jZXNzZWQgY29udGVudFxuICAgICAgICAgICAgYXdhaXQgYWRkQ2FjaGVNZXRhZGF0YShldmVudC5zZXNzaW9uSWQsIHRydWUpO1xuXG4gICAgICAgICAgICAvLyBTdG9yZSBzZXNzaW9uIG1ldGFkYXRhXG4gICAgICAgICAgICBhd2FpdCBzdG9yZVNlc3Npb25NZXRhZGF0YShldmVudCk7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50LnNlc3Npb25JZCxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiAnUmV0cmlldmVkIGZyb20gY2FjaGUnXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coJ0NhY2hlIG1pc3Mgb3IgZXhwaXJlZCwgcHJvY2Vzc2luZyBmcmVzaCBjb250ZW50Li4uJyk7XG5cbiAgICAgICAgLy8gU2VuZCBjYWNoZSBtaXNzIG1lc3NhZ2UgKG9ubHkgaWYgY2FjaGUgd2FzIGVuYWJsZWQpXG4gICAgICAgIGlmIChjYWNoZUVuYWJsZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmNhY2hlTWlzcygnQ2FjaGUgTUlTUyAtIFJ1bm5pbmcgZnJlc2ggYW5hbHlzaXMnLCB7XG4gICAgICAgICAgICAgICAgY2FjaGVTdGF0dXM6ICdtaXNzJ1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gRmV0Y2ggSFRNTCBjb250ZW50XG4gICAgICAgIGF3YWl0IHByb2dyZXNzLmluZm8oJ0ZldGNoaW5nIGFuZCBjbGVhbmluZyBjb250ZW50Li4uJyk7XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChldmVudC51cmwsIHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnVXNlci1BZ2VudCc6ICdMZW5zeSBEb2N1bWVudGF0aW9uIFF1YWxpdHkgQXVkaXRvci8xLjAnXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGh0bWxDb250ZW50ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpO1xuICAgICAgICBjb25zb2xlLmxvZyhgRmV0Y2hlZCAke2h0bWxDb250ZW50Lmxlbmd0aH0gY2hhcmFjdGVycyBvZiBIVE1MIGNvbnRlbnRgKTtcblxuICAgICAgICAvLyBQYXJzZSBIVE1MIHdpdGggSlNET01cbiAgICAgICAgY29uc3QgZG9tID0gbmV3IEpTRE9NKGh0bWxDb250ZW50LCB7IHVybDogZXZlbnQudXJsIH0pO1xuICAgICAgICBjb25zdCBkb2N1bWVudCA9IGRvbS53aW5kb3cuZG9jdW1lbnQ7XG5cbiAgICAgICAgY29uc29sZS5sb2coYE9yaWdpbmFsIEhUTUwgc2l6ZTogJHtodG1sQ29udGVudC5sZW5ndGh9IGNoYXJzYCk7XG5cbiAgICAgICAgLy8gQUdHUkVTU0lWRSBOT0lTRSBSRURVQ1RJT046IFJlbW92ZSBub2lzZSBlbGVtZW50cyBiZWZvcmUgcHJvY2Vzc2luZ1xuICAgICAgICBjb25zdCByZW1vdmVkQ291bnQgPSByZW1vdmVOb2lzZUVsZW1lbnRzKGRvY3VtZW50KTtcbiAgICAgICAgY29uc29sZS5sb2coYFJlbW92ZWQgJHtyZW1vdmVkQ291bnR9IG5vaXNlIGVsZW1lbnRzYCk7XG5cbiAgICAgICAgLy8gRXh0cmFjdCBtYWluIGNvbnRlbnQgYXJlYSB3aXRoIGJldHRlciBjb250ZW50IGRldGVjdGlvblxuICAgICAgICBjb25zdCBtYWluQ29udGVudCA9IGV4dHJhY3RNYWluQ29udGVudChkb2N1bWVudCk7XG4gICAgICAgIGNvbnN0IGNsZWFuSHRtbCA9IG1haW5Db250ZW50LmlubmVySFRNTDtcbiAgICAgICAgY29uc29sZS5sb2coYEFmdGVyIGNvbnRlbnQgZXh0cmFjdGlvbjogJHtjbGVhbkh0bWwubGVuZ3RofSBjaGFyc2ApO1xuXG4gICAgICAgIGNvbnN0IHJlZHVjdGlvblBlcmNlbnQgPSBNYXRoLnJvdW5kKCgxIC0gY2xlYW5IdG1sLmxlbmd0aCAvIGh0bWxDb250ZW50Lmxlbmd0aCkgKiAxMDApO1xuICAgICAgICBjb25zb2xlLmxvZyhgVG90YWwgcmVkdWN0aW9uOiAke3JlZHVjdGlvblBlcmNlbnR9JWApO1xuXG4gICAgICAgIC8vIFNlbmQgY29udGVudCBwcm9jZXNzZWQgbWVzc2FnZVxuICAgICAgICBhd2FpdCBwcm9ncmVzcy5zdWNjZXNzKGBDb250ZW50IHByb2Nlc3NlZDogJHtNYXRoLnJvdW5kKGh0bWxDb250ZW50Lmxlbmd0aCAvIDEwMjQpfUtCIOKGkiAke01hdGgucm91bmQoY2xlYW5IdG1sLmxlbmd0aCAvIDEwMjQpfUtCICgke3JlZHVjdGlvblBlcmNlbnR9JSByZWR1Y3Rpb24pYCwge1xuICAgICAgICAgICAgb3JpZ2luYWxTaXplOiBodG1sQ29udGVudC5sZW5ndGgsXG4gICAgICAgICAgICBjbGVhbmVkU2l6ZTogY2xlYW5IdG1sLmxlbmd0aCxcbiAgICAgICAgICAgIHJlZHVjdGlvblBlcmNlbnRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRXh0cmFjdCBtaW5pbWFsIGRhdGEgZm9yIGFuYWx5c2lzIGZyb20gY2xlYW5lZCBjb250ZW50XG4gICAgICAgIGNvbnN0IG1lZGlhRWxlbWVudHMgPSBleHRyYWN0TWVkaWFFbGVtZW50cyhkb2N1bWVudCwgZXZlbnQudXJsKTtcbiAgICAgICAgY29uc3QgY29kZVNuaXBwZXRzID0gZXh0cmFjdENvZGVTbmlwcGV0cyhkb2N1bWVudCk7XG4gICAgICAgIGNvbnN0IGxpbmtBbmFseXNpcyA9IGFuYWx5emVMaW5rU3RydWN0dXJlKGRvY3VtZW50LCBldmVudC51cmwpO1xuXG4gICAgICAgIC8vIE5FVzogVmFsaWRhdGUgaW50ZXJuYWwgbGlua3NcbiAgICAgICAgbGV0IGxpbmtWYWxpZGF0aW9uUmVzdWx0OiB7IGxpbmtJc3N1ZXM6IExpbmtJc3N1ZVtdLCBoZWFsdGh5TGlua3M6IG51bWJlciB9ID0geyBsaW5rSXNzdWVzOiBbXSwgaGVhbHRoeUxpbmtzOiAwIH07XG4gICAgICAgIGlmIChsaW5rQW5hbHlzaXMuaW50ZXJuYWxMaW5rc0ZvclZhbGlkYXRpb24gJiYgbGlua0FuYWx5c2lzLmludGVybmFsTGlua3NGb3JWYWxpZGF0aW9uLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGxpbmtWYWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdmFsaWRhdGVJbnRlcm5hbExpbmtzKGxpbmtBbmFseXNpcy5pbnRlcm5hbExpbmtzRm9yVmFsaWRhdGlvbiwgcHJvZ3Jlc3MpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTkVXOiBFbmhhbmNlZCBDb2RlIEFuYWx5c2lzXG4gICAgICAgIGxldCBlbmhhbmNlZENvZGVBbmFseXNpczogeyBkZXByZWNhdGVkQ29kZTogRGVwcmVjYXRlZENvZGVGaW5kaW5nW10sIHN5bnRheEVycm9yczogU3ludGF4RXJyb3JGaW5kaW5nW10gfSA9IHsgZGVwcmVjYXRlZENvZGU6IFtdLCBzeW50YXhFcnJvcnM6IFtdIH07XG4gICAgICAgIGlmIChjb2RlU25pcHBldHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZW5oYW5jZWRDb2RlQW5hbHlzaXMgPSBhd2FpdCBhbmFseXplQ29kZVNuaXBwZXRzRW5oYW5jZWQoY29kZVNuaXBwZXRzLCBwcm9ncmVzcyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb250ZXh0IEFuYWx5c2lzIChpZiBlbmFibGVkKVxuICAgICAgICBsZXQgY29udGV4dEFuYWx5c2lzUmVzdWx0OiBDb250ZXh0QW5hbHlzaXNSZXN1bHQgfCBudWxsID0gbnVsbDtcbiAgICAgICAgaWYgKGV2ZW50LmNvbnRleHRBbmFseXNpcz8uZW5hYmxlZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0NvbnRleHQgYW5hbHlzaXMgZW5hYmxlZCwgZGlzY292ZXJpbmcgcmVsYXRlZCBwYWdlcy4uLicpO1xuICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbygnRGlzY292ZXJpbmcgcmVsYXRlZCBwYWdlcy4uLicpO1xuXG4gICAgICAgICAgICBjb25zdCBjb250ZXh0UGFnZXMgPSBkaXNjb3ZlckNvbnRleHRQYWdlcyhkb2N1bWVudCwgZXZlbnQudXJsKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2NvbnRleHRQYWdlcy5sZW5ndGh9IHBvdGVudGlhbCBjb250ZXh0IHBhZ2VzYCk7XG5cbiAgICAgICAgICAgIGNvbnRleHRBbmFseXNpc1Jlc3VsdCA9IHtcbiAgICAgICAgICAgICAgICBjb250ZXh0UGFnZXMsXG4gICAgICAgICAgICAgICAgYW5hbHlzaXNTY29wZTogY29udGV4dFBhZ2VzLmxlbmd0aCA+IDAgPyAnd2l0aC1jb250ZXh0JyA6ICdzaW5nbGUtcGFnZScsXG4gICAgICAgICAgICAgICAgdG90YWxQYWdlc0FuYWx5emVkOiAxICsgY29udGV4dFBhZ2VzLmxlbmd0aFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgLy8gTG9nIGRpc2NvdmVyZWQgY29udGV4dCBwYWdlc1xuICAgICAgICAgICAgY29udGV4dFBhZ2VzLmZvckVhY2gocGFnZSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYENvbnRleHQgcGFnZSAoJHtwYWdlLnJlbGF0aW9uc2hpcH0pOiAke3BhZ2UudGl0bGV9IC0gJHtwYWdlLnVybH1gKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBTZW5kIGNvbnRleHQgZGlzY292ZXJ5IG1lc3NhZ2VcbiAgICAgICAgICAgIGlmIChjb250ZXh0UGFnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLnN1Y2Nlc3MoYENvbnRleHQ6ICR7Y29udGV4dFBhZ2VzLmxlbmd0aH0gcmVsYXRlZCBwYWdlcyBkaXNjb3ZlcmVkYCwge1xuICAgICAgICAgICAgICAgICAgICBjb250ZXh0UGFnZXM6IGNvbnRleHRQYWdlcy5sZW5ndGhcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbnZlcnQgdG8gTWFya2Rvd24gd2l0aCBhZ2dyZXNzaXZlIG5vaXNlIHJlbW92YWxcbiAgICAgICAgY29uc3QgdHVybmRvd25TZXJ2aWNlID0gY29uZmlndXJlVHVybmRvd25TZXJ2aWNlKCk7XG4gICAgICAgIGNvbnN0IG1hcmtkb3duQ29udGVudCA9IHR1cm5kb3duU2VydmljZS50dXJuZG93bihjbGVhbkh0bWwpO1xuICAgICAgICBjb25zb2xlLmxvZyhgRmluYWwgbWFya2Rvd24gc2l6ZTogJHttYXJrZG93bkNvbnRlbnQubGVuZ3RofSBjaGFyc2ApO1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29udmVydGVkIHRvICR7bWFya2Rvd25Db250ZW50Lmxlbmd0aH0gY2hhcmFjdGVycyBvZiBjbGVhbiBNYXJrZG93bmApO1xuXG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gYXdhaXQgZGV0ZWN0Q29udGVudFR5cGVFbmhhbmNlZChkb2N1bWVudCwgbWFya2Rvd25Db250ZW50LCBldmVudC51cmwpO1xuXG4gICAgICAgIC8vIFNlbmQgY29udGVudCB0eXBlIGRldGVjdGlvbiBtZXNzYWdlXG4gICAgICAgIGF3YWl0IHByb2dyZXNzLnN1Y2Nlc3MoYENvbnRlbnQgdHlwZTogJHtjb250ZW50VHlwZX1gLCB7XG4gICAgICAgICAgICBjb250ZW50VHlwZVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgcHJvY2Vzc2VkIGNvbnRlbnQgb2JqZWN0XG4gICAgICAgIGNvbnN0IHByb2Nlc3NlZENvbnRlbnQgPSB7XG4gICAgICAgICAgICB1cmw6IGV2ZW50LnVybCxcbiAgICAgICAgICAgIGh0bWxDb250ZW50OiBjbGVhbkh0bWwsIC8vIFN0b3JlIGNsZWFuZWQgSFRNTCwgbm90IHJhd1xuICAgICAgICAgICAgbWFya2Rvd25Db250ZW50OiBtYXJrZG93bkNvbnRlbnQsIC8vIENsZWFuIG1hcmtkb3duXG4gICAgICAgICAgICBtZWRpYUVsZW1lbnRzOiBtZWRpYUVsZW1lbnRzLnNsaWNlKDAsIDEwKSwgLy8gTGltaXQgbWVkaWEgZWxlbWVudHNcbiAgICAgICAgICAgIGNvZGVTbmlwcGV0czogY29kZVNuaXBwZXRzLnNsaWNlKDAsIDE1KSwgLy8gTGltaXQgY29kZSBzbmlwcGV0c1xuICAgICAgICAgICAgY29udGVudFR5cGUsXG4gICAgICAgICAgICBsaW5rQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAuLi5saW5rQW5hbHlzaXMsXG4gICAgICAgICAgICAgICAgbGlua1ZhbGlkYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgY2hlY2tlZExpbmtzOiBsaW5rVmFsaWRhdGlvblJlc3VsdC5saW5rSXNzdWVzLmxlbmd0aCArIGxpbmtWYWxpZGF0aW9uUmVzdWx0LmhlYWx0aHlMaW5rcyxcbiAgICAgICAgICAgICAgICAgICAgbGlua0lzc3VlRmluZGluZ3M6IGxpbmtWYWxpZGF0aW9uUmVzdWx0LmxpbmtJc3N1ZXMsXG4gICAgICAgICAgICAgICAgICAgIGhlYWx0aHlMaW5rczogbGlua1ZhbGlkYXRpb25SZXN1bHQuaGVhbHRoeUxpbmtzLFxuICAgICAgICAgICAgICAgICAgICBicm9rZW5MaW5rczogbGlua1ZhbGlkYXRpb25SZXN1bHQubGlua0lzc3Vlcy5maWx0ZXIobGluayA9PiBsaW5rLmlzc3VlVHlwZSA9PT0gJzQwNCcpLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgYWNjZXNzRGVuaWVkTGlua3M6IGxpbmtWYWxpZGF0aW9uUmVzdWx0LmxpbmtJc3N1ZXMuZmlsdGVyKGxpbmsgPT4gbGluay5pc3N1ZVR5cGUgPT09ICdhY2Nlc3MtZGVuaWVkJykubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICB0aW1lb3V0TGlua3M6IGxpbmtWYWxpZGF0aW9uUmVzdWx0LmxpbmtJc3N1ZXMuZmlsdGVyKGxpbmsgPT4gbGluay5pc3N1ZVR5cGUgPT09ICd0aW1lb3V0JykubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICBvdGhlckVycm9yczogbGlua1ZhbGlkYXRpb25SZXN1bHQubGlua0lzc3Vlcy5maWx0ZXIobGluayA9PiBsaW5rLmlzc3VlVHlwZSA9PT0gJ2Vycm9yJykubGVuZ3RoXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGVuaGFuY2VkQ29kZUFuYWx5c2lzOiB7XG4gICAgICAgICAgICAgICAgZGVwcmVjYXRlZENvZGVGaW5kaW5nczogZW5oYW5jZWRDb2RlQW5hbHlzaXMuZGVwcmVjYXRlZENvZGUsXG4gICAgICAgICAgICAgICAgc3ludGF4RXJyb3JGaW5kaW5nczogZW5oYW5jZWRDb2RlQW5hbHlzaXMuc3ludGF4RXJyb3JzLFxuICAgICAgICAgICAgICAgIGFuYWx5emVkU25pcHBldHM6IGNvZGVTbmlwcGV0cy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgY29uZmlkZW5jZURpc3RyaWJ1dGlvbjoge1xuICAgICAgICAgICAgICAgICAgICBoaWdoOiBbLi4uZW5oYW5jZWRDb2RlQW5hbHlzaXMuZGVwcmVjYXRlZENvZGUsIC4uLmVuaGFuY2VkQ29kZUFuYWx5c2lzLnN5bnRheEVycm9yc10uZmlsdGVyKGYgPT4gZi5jb25maWRlbmNlID09PSAnaGlnaCcpLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgbWVkaXVtOiBbLi4uZW5oYW5jZWRDb2RlQW5hbHlzaXMuZGVwcmVjYXRlZENvZGUsIC4uLmVuaGFuY2VkQ29kZUFuYWx5c2lzLnN5bnRheEVycm9yc10uZmlsdGVyKGYgPT4gZi5jb25maWRlbmNlID09PSAnbWVkaXVtJykubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICBsb3c6IFsuLi5lbmhhbmNlZENvZGVBbmFseXNpcy5kZXByZWNhdGVkQ29kZSwgLi4uZW5oYW5jZWRDb2RlQW5hbHlzaXMuc3ludGF4RXJyb3JzXS5maWx0ZXIoZiA9PiBmLmNvbmZpZGVuY2UgPT09ICdsb3cnKS5sZW5ndGhcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29udGV4dEFuYWx5c2lzOiBjb250ZXh0QW5hbHlzaXNSZXN1bHQsXG4gICAgICAgICAgICBwcm9jZXNzZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgICAgICAgICAgICBvcmlnaW5hbFNpemU6IGh0bWxDb250ZW50Lmxlbmd0aCxcbiAgICAgICAgICAgICAgICBjbGVhbmVkU2l6ZTogY2xlYW5IdG1sLmxlbmd0aCxcbiAgICAgICAgICAgICAgICByZWR1Y3Rpb25QZXJjZW50OiBNYXRoLnJvdW5kKCgxIC0gY2xlYW5IdG1sLmxlbmd0aCAvIGh0bWxDb250ZW50Lmxlbmd0aCkgKiAxMDApXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gVXBkYXRlIGxpbmtBbmFseXNpcy5hbmFseXNpc1Njb3BlIGJhc2VkIG9uIGNvbnRleHQgYW5hbHlzaXNcbiAgICAgICAgaWYgKGNvbnRleHRBbmFseXNpc1Jlc3VsdCkge1xuICAgICAgICAgICAgcHJvY2Vzc2VkQ29udGVudC5saW5rQW5hbHlzaXMuYW5hbHlzaXNTY29wZSA9IGNvbnRleHRBbmFseXNpc1Jlc3VsdC5hbmFseXNpc1Njb3BlID09PSAnd2l0aC1jb250ZXh0JyA/ICd3aXRoLWNvbnRleHQnIDogJ2N1cnJlbnQtcGFnZS1vbmx5JztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVwZGF0ZSBicm9rZW5MaW5rcyBjb3VudCBpbiBsaW5rQW5hbHlzaXMgKGNhc3QgdG8gYW55IHRvIGFkZCB0aGUgcHJvcGVydHkpXG4gICAgICAgIChwcm9jZXNzZWRDb250ZW50LmxpbmtBbmFseXNpcyBhcyBhbnkpLmJyb2tlbkxpbmtzID0gbGlua1ZhbGlkYXRpb25SZXN1bHQubGlua0lzc3Vlcy5maWx0ZXIobGluayA9PiBsaW5rLmlzc3VlVHlwZSA9PT0gJzQwNCcpLmxlbmd0aDtcbiAgICAgICAgKHByb2Nlc3NlZENvbnRlbnQubGlua0FuYWx5c2lzIGFzIGFueSkudG90YWxMaW5rSXNzdWVzID0gbGlua1ZhbGlkYXRpb25SZXN1bHQubGlua0lzc3Vlcy5sZW5ndGg7XG5cbiAgICAgICAgLy8gU3RvcmUgcHJvY2Vzc2VkIGNvbnRlbnQgaW4gUzMgc2Vzc2lvbiBsb2NhdGlvblxuICAgICAgICBjb25zdCBzM0tleSA9IGBzZXNzaW9ucy8ke2V2ZW50LnNlc3Npb25JZH0vcHJvY2Vzc2VkLWNvbnRlbnQuanNvbmA7XG4gICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQ7XG5cbiAgICAgICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FOQUxZU0lTX0JVQ0tFVCBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogczNLZXksXG4gICAgICAgICAgICBCb2R5OiBKU09OLnN0cmluZ2lmeShwcm9jZXNzZWRDb250ZW50KSxcbiAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBTdG9yZWQgcHJvY2Vzc2VkIGNvbnRlbnQgaW4gUzM6ICR7czNLZXl9YCk7XG5cbiAgICAgICAgLy8gU3RvcmUgc2Vzc2lvbiBtZXRhZGF0YVxuICAgICAgICBhd2FpdCBzdG9yZVNlc3Npb25NZXRhZGF0YShldmVudCk7XG5cbiAgICAgICAgLy8gQWRkIGNhY2hlIG1ldGFkYXRhIHRvIGluZGljYXRlIHRoaXMgd2FzIE5PVCBmcm9tIGNhY2hlXG4gICAgICAgIGF3YWl0IGFkZENhY2hlTWV0YWRhdGEoZXZlbnQuc2Vzc2lvbklkLCBmYWxzZSk7XG5cbiAgICAgICAgLy8gU3RlcCAzOiBTdG9yZSBpbiBjYWNoZSBmb3IgZnV0dXJlIHVzZSAob25seSBpZiBjYWNoaW5nIGlzIGVuYWJsZWQpXG4gICAgICAgIGlmIChjYWNoZUVuYWJsZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IHN0b3JlUHJvY2Vzc2VkQ29udGVudEluQ2FjaGUoZXZlbnQudXJsLCBwcm9jZXNzZWRDb250ZW50LCBjb250ZXh0dWFsU2V0dGluZyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pqg77iPIENhY2hlIGRpc2FibGVkIC0gc2tpcHBpbmcgY2FjaGUgc3RvcmFnZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmV0dXJuIE9OTFkgbWluaW1hbCBzdWNjZXNzIHN0YXR1cyAtIG5vIGRhdGEgYXQgYWxsXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBldmVudC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBtZXNzYWdlOiAnQ29udGVudCBwcm9jZXNzZWQgYW5kIGNhY2hlZCdcbiAgICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1VSTCBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIHNlc3Npb25JZDogZXZlbnQuc2Vzc2lvbklkLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgfTtcbiAgICB9XG59O1xuXG5hc3luYyBmdW5jdGlvbiBjaGVja1Byb2Nlc3NlZENvbnRlbnRDYWNoZSh1cmw6IHN0cmluZywgY29udGV4dHVhbFNldHRpbmc6IHN0cmluZyk6IFByb21pc2U8UHJvY2Vzc2VkQ29udGVudEluZGV4IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHByb2Nlc3MuZW52LlBST0NFU1NFRF9DT05URU5UX1RBQkxFO1xuICAgICAgICBpZiAoIXRhYmxlTmFtZSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGNhY2hlIHRhYmxlIGNvbmZpZ3VyZWQsIHNraXBwaW5nIGNhY2hlIGNoZWNrJyk7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENsZWFuIFVSTCB0byBub3JtYWxpemUgaXQgKHJlbW92ZSBmcmFnbWVudHMsIG5vcm1hbGl6ZSBxdWVyeSBwYXJhbXMpXG4gICAgICAgIGNvbnN0IGNsZWFuVXJsID0gbm9ybWFsaXplVXJsKHVybCk7XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xuICAgICAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXG4gICAgICAgICAgICBLZXk6IG1hcnNoYWxsKHtcbiAgICAgICAgICAgICAgICB1cmw6IGNsZWFuVXJsLFxuICAgICAgICAgICAgICAgIGNvbnRleHR1YWxTZXR0aW5nOiBjb250ZXh0dWFsU2V0dGluZ1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGlmIChyZXNwb25zZS5JdGVtKSB7XG4gICAgICAgICAgICBjb25zdCBjYWNoZUVudHJ5ID0gdW5tYXJzaGFsbChyZXNwb25zZS5JdGVtKSBhcyBQcm9jZXNzZWRDb250ZW50SW5kZXg7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgQ2FjaGUgZW50cnkgZm91bmQgZm9yICR7Y2xlYW5Vcmx9IChjb250ZXh0OiAke2NvbnRleHR1YWxTZXR0aW5nfSksIHByb2Nlc3NlZCBhdCAke2NhY2hlRW50cnkucHJvY2Vzc2VkQXR9YCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgQ2FjaGUgUzMgbG9jYXRpb246ICR7Y2FjaGVFbnRyeS5zM0xvY2F0aW9ufWApO1xuICAgICAgICAgICAgcmV0dXJuIGNhY2hlRW50cnk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhgTm8gY2FjaGUgZW50cnkgZm91bmQgZm9yICR7Y2xlYW5Vcmx9IChjb250ZXh0OiAke2NvbnRleHR1YWxTZXR0aW5nfSlgKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignQ2FjaGUgY2hlY2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIG51bGw7IC8vIEdyYWNlZnVsIGRlZ3JhZGF0aW9uIC0gY29udGludWUgd2l0aG91dCBjYWNoZVxuICAgIH1cbn1cblxuZnVuY3Rpb24gaXNDYWNoZUV4cGlyZWQoY2FjaGVFbnRyeTogUHJvY2Vzc2VkQ29udGVudEluZGV4KTogYm9vbGVhbiB7XG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gICAgcmV0dXJuIGNhY2hlRW50cnkudHRsIDwgbm93O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjb3B5Q2FjaGVkQ29udGVudFRvU2Vzc2lvbihjYWNoZVMzTG9jYXRpb246IHN0cmluZywgc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUO1xuICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FOQUxZU0lTX0JVQ0tFVCBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coYENvcHlpbmcgY2FjaGVkIGNvbnRlbnQgZnJvbTogJHtjYWNoZVMzTG9jYXRpb259YCk7XG5cbiAgICAgICAgLy8gR2V0IGNhY2hlZCBjb250ZW50IGZyb20gUzNcbiAgICAgICAgY29uc3QgY2FjaGVkT2JqZWN0ID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBLZXk6IGNhY2hlUzNMb2NhdGlvblxuICAgICAgICB9KSk7XG5cbiAgICAgICAgaWYgKCFjYWNoZWRPYmplY3QuQm9keSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYWNoZWQgY29udGVudCBib2R5IGlzIGVtcHR5Jyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYWNoZWRDb250ZW50ID0gYXdhaXQgY2FjaGVkT2JqZWN0LkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcblxuICAgICAgICAvLyBTdG9yZSBpbiBzZXNzaW9uIGxvY2F0aW9uXG4gICAgICAgIGNvbnN0IHNlc3Npb25LZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L3Byb2Nlc3NlZC1jb250ZW50Lmpzb25gO1xuICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogc2Vzc2lvbktleSxcbiAgICAgICAgICAgIEJvZHk6IGNhY2hlZENvbnRlbnQsXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgIH0pKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIENvcGllZCBjYWNoZWQgY29udGVudCBmcm9tICR7Y2FjaGVTM0xvY2F0aW9ufSB0byBzZXNzaW9uOiAke3Nlc3Npb25LZXl9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGNvcHkgY2FjaGVkIGNvbnRlbnQ6JywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN0b3JlU2Vzc2lvbk1ldGFkYXRhKGV2ZW50OiBVUkxQcm9jZXNzb3JFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQ7XG4gICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQU5BTFlTSVNfQlVDS0VUIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBtZXRhZGF0YUtleSA9IGBzZXNzaW9ucy8ke2V2ZW50LnNlc3Npb25JZH0vbWV0YWRhdGEuanNvbmA7XG4gICAgYXdhaXQgczNDbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgS2V5OiBtZXRhZGF0YUtleSxcbiAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgdXJsOiBldmVudC51cmwsXG4gICAgICAgICAgICBzZWxlY3RlZE1vZGVsOiBldmVudC5zZWxlY3RlZE1vZGVsLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBldmVudC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBzdGFydFRpbWU6IGV2ZW50LmFuYWx5c2lzU3RhcnRUaW1lXG4gICAgICAgIH0pLFxuICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgfSkpO1xuXG4gICAgY29uc29sZS5sb2coYFN0b3JlZCBzZXNzaW9uIG1ldGFkYXRhIGluIFMzOiAke21ldGFkYXRhS2V5fWApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBhZGRDYWNoZU1ldGFkYXRhKHNlc3Npb25JZDogc3RyaW5nLCB3YXNGcm9tQ2FjaGU6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUO1xuICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FOQUxZU0lTX0JVQ0tFVCBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gUmVhZCB0aGUgZXhpc3RpbmcgcHJvY2Vzc2VkIGNvbnRlbnRcbiAgICAgICAgY29uc3QgY29udGVudEtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vcHJvY2Vzc2VkLWNvbnRlbnQuanNvbmA7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRSZXNwb25zZSA9IGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBjb250ZW50S2V5XG4gICAgICAgIH0pKTtcblxuICAgICAgICBjb25zdCBjb250ZW50U3RyID0gYXdhaXQgY29udGVudFJlc3BvbnNlLkJvZHkhLnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IHByb2Nlc3NlZENvbnRlbnQgPSBKU09OLnBhcnNlKGNvbnRlbnRTdHIpO1xuXG4gICAgICAgIC8vIEFkZCBjYWNoZSBtZXRhZGF0YVxuICAgICAgICBwcm9jZXNzZWRDb250ZW50LmNhY2hlTWV0YWRhdGEgPSB7XG4gICAgICAgICAgICB3YXNGcm9tQ2FjaGUsXG4gICAgICAgICAgICByZXRyaWV2ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gV3JpdGUgaXQgYmFja1xuICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogY29udGVudEtleSxcbiAgICAgICAgICAgIEJvZHk6IEpTT04uc3RyaW5naWZ5KHByb2Nlc3NlZENvbnRlbnQpLFxuICAgICAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYEFkZGVkIGNhY2hlIG1ldGFkYXRhOiB3YXNGcm9tQ2FjaGU9JHt3YXNGcm9tQ2FjaGV9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGFkZCBjYWNoZSBtZXRhZGF0YTonLCBlcnJvcik7XG4gICAgICAgIC8vIERvbid0IHRocm93IC0gdGhpcyBpcyBub3QgY3JpdGljYWxcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN0b3JlUHJvY2Vzc2VkQ29udGVudEluQ2FjaGUodXJsOiBzdHJpbmcsIHByb2Nlc3NlZENvbnRlbnQ6IGFueSwgY29udGV4dHVhbFNldHRpbmc6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHByb2Nlc3MuZW52LlBST0NFU1NFRF9DT05URU5UX1RBQkxFO1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUO1xuXG4gICAgICAgIGlmICghdGFibGVOYW1lIHx8ICFidWNrZXROYW1lKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnQ2FjaGUgbm90IGNvbmZpZ3VyZWQsIHNraXBwaW5nIGNhY2hlIHN0b3JhZ2UnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENhbGN1bGF0ZSBjb250ZW50IGhhc2ggZm9yIHRoZSBwcm9jZXNzZWQgY29udGVudFxuICAgICAgICBjb25zdCBjb250ZW50SGFzaCA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKVxuICAgICAgICAgICAgLnVwZGF0ZShwcm9jZXNzZWRDb250ZW50Lm1hcmtkb3duQ29udGVudClcbiAgICAgICAgICAgIC5kaWdlc3QoJ2hleCcpO1xuXG4gICAgICAgIC8vIENsZWFuIFVSTCB0byBub3JtYWxpemUgaXRcbiAgICAgICAgY29uc3QgY2xlYW5VcmwgPSBub3JtYWxpemVVcmwodXJsKTtcblxuICAgICAgICAvLyBHZW5lcmF0ZSBjb25zaXN0ZW50IHNlc3Npb24gSUQgZm9yIGNhY2hlIHN0b3JhZ2VcbiAgICAgICAgY29uc3QgY29uc2lzdGVudFNlc3Npb25JZCA9IGdlbmVyYXRlQ29uc2lzdGVudFNlc3Npb25JZCh1cmwsIGNvbnRleHR1YWxTZXR0aW5nKTtcblxuICAgICAgICAvLyBTdG9yZSBwcm9jZXNzZWQgY29udGVudCBpbiBTMyB1c2luZyBjb25zaXN0ZW50IHNlc3Npb24gSUQgcGF0aFxuICAgICAgICBjb25zdCBjYWNoZVMzS2V5ID0gYHNlc3Npb25zLyR7Y29uc2lzdGVudFNlc3Npb25JZH0vcHJvY2Vzc2VkLWNvbnRlbnQuanNvbmA7XG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBjYWNoZVMzS2V5LFxuICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkocHJvY2Vzc2VkQ29udGVudCksXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBDYWxjdWxhdGUgVFRMICg3IGRheXMgZnJvbSBub3cpXG4gICAgICAgIGNvbnN0IHR0bERheXMgPSBwYXJzZUludChwcm9jZXNzLmVudi5DQUNIRV9UVExfREFZUyB8fCAnNycpO1xuICAgICAgICBjb25zdCB0dGwgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICh0dGxEYXlzICogMjQgKiA2MCAqIDYwKTtcblxuICAgICAgICAvLyBTdG9yZSBpbmRleCBlbnRyeSBpbiBEeW5hbW9EQiB3aXRoIHByb3BlciBjb2x1bW5zXG4gICAgICAgIGNvbnN0IGNhY2hlSW5kZXg6IFByb2Nlc3NlZENvbnRlbnRJbmRleCA9IHtcbiAgICAgICAgICAgIHVybDogY2xlYW5VcmwsXG4gICAgICAgICAgICBjb250ZXh0dWFsU2V0dGluZzogY29udGV4dHVhbFNldHRpbmcsXG4gICAgICAgICAgICBwcm9jZXNzZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgY29udGVudEhhc2g6IGNvbnRlbnRIYXNoLFxuICAgICAgICAgICAgczNMb2NhdGlvbjogY2FjaGVTM0tleSxcbiAgICAgICAgICAgIHR0bDogdHRsLFxuICAgICAgICAgICAgY29udGVudFR5cGU6IHByb2Nlc3NlZENvbnRlbnQuY29udGVudFR5cGUsXG4gICAgICAgICAgICBub2lzZVJlZHVjdGlvbk1ldHJpY3M6IHByb2Nlc3NlZENvbnRlbnQubm9pc2VSZWR1Y3Rpb25cbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xuICAgICAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXG4gICAgICAgICAgICBJdGVtOiBtYXJzaGFsbChjYWNoZUluZGV4KVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYFN0b3JlZCBjYWNoZSBpbmRleCBmb3IgJHtjbGVhblVybH0gKGNvbnRleHQ6ICR7Y29udGV4dHVhbFNldHRpbmd9KSB3aXRoIFRUTCAke3R0bH1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYENhY2hlIFMzIGxvY2F0aW9uOiAke2NhY2hlUzNLZXl9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHN0b3JlIGluIGNhY2hlOicsIGVycm9yKTtcbiAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBjYWNoaW5nIGZhaWx1cmUgc2hvdWxkbid0IGJyZWFrIHRoZSBtYWluIGZsb3dcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RNZWRpYUVsZW1lbnRzKGRvY3VtZW50OiBEb2N1bWVudCwgYmFzZVVybDogc3RyaW5nKSB7XG4gICAgY29uc3QgbWVkaWFFbGVtZW50czogYW55W10gPSBbXTtcblxuICAgIC8vIEV4dHJhY3QgaW1hZ2VzXG4gICAgY29uc3QgaW1hZ2VzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnaW1nJyk7XG4gICAgaW1hZ2VzLmZvckVhY2goaW1nID0+IHtcbiAgICAgICAgbWVkaWFFbGVtZW50cy5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdpbWFnZScsXG4gICAgICAgICAgICBzcmM6IGltZy5zcmMsXG4gICAgICAgICAgICBhbHQ6IGltZy5hbHQgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgY2FwdGlvbjogaW1nLnRpdGxlIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIGFuYWx5c2lzTm90ZTogaW1nLmFsdCA/ICdIYXMgYWx0IHRleHQnIDogJ01pc3NpbmcgYWx0IHRleHQgLSBhY2Nlc3NpYmlsaXR5IGNvbmNlcm4nXG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gRXh0cmFjdCB2aWRlb3NcbiAgICBjb25zdCB2aWRlb3MgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCd2aWRlbywgaWZyYW1lW3NyYyo9XCJ5b3V0dWJlXCJdLCBpZnJhbWVbc3JjKj1cInZpbWVvXCJdJyk7XG4gICAgdmlkZW9zLmZvckVhY2godmlkZW8gPT4ge1xuICAgICAgICBjb25zdCBzcmMgPSB2aWRlby5nZXRBdHRyaWJ1dGUoJ3NyYycpIHx8ICcnO1xuICAgICAgICBtZWRpYUVsZW1lbnRzLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ3ZpZGVvJyxcbiAgICAgICAgICAgIHNyYyxcbiAgICAgICAgICAgIGFuYWx5c2lzTm90ZTogJ1ZpZGVvIGNvbnRlbnQgLSBjb25zaWRlciBhY2Nlc3NpYmlsaXR5IGFuZCBsb2FkaW5nIGltcGFjdCdcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGludGVyYWN0aXZlIGVsZW1lbnRzXG4gICAgY29uc3QgaW50ZXJhY3RpdmVzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnZm9ybSwgYnV0dG9uW29uY2xpY2tdLCBbZGF0YS1pbnRlcmFjdGl2ZV0nKTtcbiAgICBpbnRlcmFjdGl2ZXMuZm9yRWFjaCgoKSA9PiB7XG4gICAgICAgIG1lZGlhRWxlbWVudHMucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAnaW50ZXJhY3RpdmUnLFxuICAgICAgICAgICAgc3JjOiAnJyxcbiAgICAgICAgICAgIGFuYWx5c2lzTm90ZTogJ0ludGVyYWN0aXZlIGVsZW1lbnQgLSBtYXkgYWZmZWN0IGRvY3VtZW50YXRpb24gdXNhYmlsaXR5J1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBtZWRpYUVsZW1lbnRzO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0Q29kZVNuaXBwZXRzKGRvY3VtZW50OiBEb2N1bWVudCkge1xuICAgIGNvbnN0IGNvZGVTbmlwcGV0czogYW55W10gPSBbXTtcblxuICAgIGNvbnN0IGNvZGVCbG9ja3MgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdwcmUgY29kZSwgY29kZScpO1xuICAgIGNvZGVCbG9ja3MuZm9yRWFjaCgoY29kZUVsZW1lbnQsIGluZGV4KSA9PiB7XG4gICAgICAgIGNvbnN0IGNvZGUgPSBjb2RlRWxlbWVudC50ZXh0Q29udGVudCB8fCAnJztcbiAgICAgICAgaWYgKGNvZGUudHJpbSgpLmxlbmd0aCA8IDEwKSByZXR1cm47IC8vIFNraXAgdmVyeSBzaG9ydCBzbmlwcGV0c1xuXG4gICAgICAgIGNvbnN0IGxhbmd1YWdlID0gZGV0ZWN0TGFuZ3VhZ2VGcm9tQ2xhc3MoY29kZUVsZW1lbnQuY2xhc3NOYW1lKSB8fFxuICAgICAgICAgICAgZGV0ZWN0TGFuZ3VhZ2VGcm9tQ29udGVudChjb2RlKTtcblxuICAgICAgICBjb2RlU25pcHBldHMucHVzaCh7XG4gICAgICAgICAgICBsYW5ndWFnZSxcbiAgICAgICAgICAgIGNvZGU6IGNvZGUudHJpbSgpLnNsaWNlKDAsIDEwMDApLCAvLyBMaW1pdCBjb2RlIHNuaXBwZXQgc2l6ZVxuICAgICAgICAgICAgbGluZU51bWJlcjogaW5kZXggKyAxLFxuICAgICAgICAgICAgaGFzVmVyc2lvbkluZm86IGNoZWNrRm9yVmVyc2lvbkluZm8oY29kZSlcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29kZVNuaXBwZXRzO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIHR3byBob3N0bmFtZXMgYXJlIHJlbGF0ZWQgZG9tYWlucyB0aGF0IHNob3VsZCBiZSB2YWxpZGF0ZWQgdG9nZXRoZXJcbiAqIFRoaXMgaW5jbHVkZXMgc2FtZSBvcmdhbml6YXRpb24gc3ViZG9tYWlucyBhbmQgY29tbW9uIGRvY3VtZW50YXRpb24gcGF0dGVybnNcbiAqL1xuZnVuY3Rpb24gaXNSZWxhdGVkRG9tYWluKGxpbmtIb3N0bmFtZTogc3RyaW5nLCBiYXNlSG9zdG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIC8vIFNhbWUgaG9zdG5hbWUgKGFscmVhZHkgaGFuZGxlZCBieSBjYWxsZXIsIGJ1dCBpbmNsdWRlZCBmb3IgY29tcGxldGVuZXNzKVxuICAgIGlmIChsaW5rSG9zdG5hbWUgPT09IGJhc2VIb3N0bmFtZSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IHJvb3QgZG9tYWluc1xuICAgIGNvbnN0IGdldFJvb3REb21haW4gPSAoaG9zdG5hbWU6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gaG9zdG5hbWUuc3BsaXQoJy4nKTtcbiAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA+PSAyKSB7XG4gICAgICAgICAgICByZXR1cm4gcGFydHMuc2xpY2UoLTIpLmpvaW4oJy4nKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaG9zdG5hbWU7XG4gICAgfTtcblxuICAgIGNvbnN0IGxpbmtSb290ID0gZ2V0Um9vdERvbWFpbihsaW5rSG9zdG5hbWUpO1xuICAgIGNvbnN0IGJhc2VSb290ID0gZ2V0Um9vdERvbWFpbihiYXNlSG9zdG5hbWUpO1xuXG4gICAgLy8gU2FtZSByb290IGRvbWFpbiAoZS5nLiwgZG9jcy54LmNvbSBhbmQgZGV2ZWxvcGVyLnguY29tKVxuICAgIGlmIChsaW5rUm9vdCA9PT0gYmFzZVJvb3QpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gQWRkaXRpb25hbCBjcm9zcy1kb21haW4gcGF0dGVybnMgZm9yIG9yZ2FuaXphdGlvbnMgdGhhdCB1c2UgZGlmZmVyZW50IHJvb3QgZG9tYWluc1xuICAgIGNvbnN0IGNyb3NzRG9tYWluUGF0dGVybnMgPSBbXG4gICAgICAgIC8vIFgvVHdpdHRlciBlY29zeXN0ZW0gKGRpZmZlcmVudCByb290IGRvbWFpbnMpXG4gICAgICAgIFsneC5jb20nLCAndHdpdHRlci5jb20nXSxcblxuICAgICAgICAvLyBHaXRIdWIgZWNvc3lzdGVtXG4gICAgICAgIFsnZ2l0aHViLmNvbScsICdnaXRodWIuaW8nLCAnZ2l0aHViYXBwLmNvbSddLFxuXG4gICAgICAgIC8vIEdvb2dsZSBlY29zeXN0ZW1cbiAgICAgICAgWydnb29nbGUuY29tJywgJ2dvb2dsZWFwaXMuY29tJywgJ2dvb2dsZXVzZXJjb250ZW50LmNvbScsICdnc3RhdGljLmNvbSddLFxuXG4gICAgICAgIC8vIEFtYXpvbi9BV1MgZWNvc3lzdGVtXG4gICAgICAgIFsnYW1hem9uLmNvbScsICdhbWF6b25hd3MuY29tJywgJ2F3c3N0YXRpYy5jb20nXSxcblxuICAgICAgICAvLyBNaWNyb3NvZnQgZWNvc3lzdGVtXG4gICAgICAgIFsnbWljcm9zb2Z0LmNvbScsICdtaWNyb3NvZnRvbmxpbmUuY29tJywgJ2F6dXJlLmNvbScsICdvZmZpY2UuY29tJ10sXG5cbiAgICAgICAgLy8gTWV0YS9GYWNlYm9vayBlY29zeXN0ZW1cbiAgICAgICAgWydmYWNlYm9vay5jb20nLCAnZmJjZG4ubmV0JywgJ2luc3RhZ3JhbS5jb20nXSxcblxuICAgICAgICAvLyBBdGxhc3NpYW4gZWNvc3lzdGVtXG4gICAgICAgIFsnYXRsYXNzaWFuLmNvbScsICdhdGxhc3NpYW4ubmV0JywgJ2JpdGJ1Y2tldC5vcmcnXSxcblxuICAgICAgICAvLyBTYWxlc2ZvcmNlIGVjb3N5c3RlbVxuICAgICAgICBbJ3NhbGVzZm9yY2UuY29tJywgJ2ZvcmNlLmNvbScsICdoZXJva3VhcHAuY29tJ11cbiAgICBdO1xuXG4gICAgLy8gQ2hlY2sgaWYgYm90aCByb290IGRvbWFpbnMgYXJlIGluIHRoZSBzYW1lIGNyb3NzLWRvbWFpbiBwYXR0ZXJuIGdyb3VwXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGNyb3NzRG9tYWluUGF0dGVybnMpIHtcbiAgICAgICAgaWYgKHBhdHRlcm4uaW5jbHVkZXMobGlua1Jvb3QpICYmIHBhdHRlcm4uaW5jbHVkZXMoYmFzZVJvb3QpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gYW5hbHl6ZUxpbmtTdHJ1Y3R1cmUoZG9jdW1lbnQ6IERvY3VtZW50LCBiYXNlVXJsOiBzdHJpbmcpIHtcbiAgICBjb25zdCBsaW5rcyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ2FbaHJlZl0nKTtcbiAgICBjb25zdCBiYXNlVXJsT2JqID0gbmV3IFVSTChiYXNlVXJsKTtcblxuICAgIGxldCB0b3RhbExpbmtzID0gMDtcbiAgICBsZXQgaW50ZXJuYWxMaW5rcyA9IDA7XG4gICAgbGV0IGV4dGVybmFsTGlua3MgPSAwO1xuICAgIGNvbnN0IHN1YlBhZ2VzSWRlbnRpZmllZDogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBpbnRlcm5hbExpbmtzRm9yVmFsaWRhdGlvbjogQXJyYXk8eyB1cmw6IHN0cmluZywgYW5jaG9yVGV4dDogc3RyaW5nLCBlbGVtZW50OiBFbGVtZW50IH0+ID0gW107XG5cbiAgICBsaW5rcy5mb3JFYWNoKGxpbmsgPT4ge1xuICAgICAgICBjb25zdCBocmVmID0gbGluay5nZXRBdHRyaWJ1dGUoJ2hyZWYnKTtcbiAgICAgICAgaWYgKCFocmVmKSByZXR1cm47XG5cbiAgICAgICAgLy8gU2tpcCBub24tSFRUUCBsaW5rc1xuICAgICAgICBpZiAoaHJlZi5zdGFydHNXaXRoKCdtYWlsdG86JykgfHxcbiAgICAgICAgICAgIGhyZWYuc3RhcnRzV2l0aCgndGVsOicpIHx8XG4gICAgICAgICAgICBocmVmLnN0YXJ0c1dpdGgoJ2phdmFzY3JpcHQ6JykgfHxcbiAgICAgICAgICAgIGhyZWYuc3RhcnRzV2l0aCgnIycpKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0b3RhbExpbmtzKys7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGxpbmtVcmwgPSBuZXcgVVJMKGhyZWYsIGJhc2VVcmwpO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBpdCdzIGFuIGludGVybmFsIGxpbmsgKHNhbWUgaG9zdG5hbWUpIG9yIHJlbGF0ZWQgZG9tYWluIGxpbmtcbiAgICAgICAgICAgIGNvbnN0IGlzSW50ZXJuYWxMaW5rID0gbGlua1VybC5ob3N0bmFtZSA9PT0gYmFzZVVybE9iai5ob3N0bmFtZTtcbiAgICAgICAgICAgIGNvbnN0IGlzUmVsYXRlZERvbWFpbkxpbmsgPSBpc1JlbGF0ZWREb21haW4obGlua1VybC5ob3N0bmFtZSwgYmFzZVVybE9iai5ob3N0bmFtZSk7XG5cbiAgICAgICAgICAgIGlmIChpc0ludGVybmFsTGluayB8fCBpc1JlbGF0ZWREb21haW5MaW5rKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJuYWxMaW5rcysrO1xuXG4gICAgICAgICAgICAgICAgLy8gU3RvcmUgaW50ZXJuYWwgYW5kIHJlbGF0ZWQgZG9tYWluIGxpbmtzIGZvciB2YWxpZGF0aW9uXG4gICAgICAgICAgICAgICAgaW50ZXJuYWxMaW5rc0ZvclZhbGlkYXRpb24ucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIHVybDogbGlua1VybC5ocmVmLFxuICAgICAgICAgICAgICAgICAgICBhbmNob3JUZXh0OiBsaW5rLnRleHRDb250ZW50Py50cmltKCkgfHwgaHJlZixcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudDogbGlua1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKGxpbmtVcmwucGF0aG5hbWUgIT09IGJhc2VVcmxPYmoucGF0aG5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlua1RleHQgPSBsaW5rLnRleHRDb250ZW50Py50cmltKCkgfHwgJyc7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaW5rVGV4dCAmJiAhc3ViUGFnZXNJZGVudGlmaWVkLmluY2x1ZGVzKGxpbmtUZXh0KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3ViUGFnZXNJZGVudGlmaWVkLnB1c2gobGlua1RleHQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBleHRlcm5hbExpbmtzKys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgZXh0ZXJuYWxMaW5rcysrO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0b3RhbExpbmtzLFxuICAgICAgICBpbnRlcm5hbExpbmtzLFxuICAgICAgICBleHRlcm5hbExpbmtzLFxuICAgICAgICBzdWJQYWdlc0lkZW50aWZpZWQ6IHN1YlBhZ2VzSWRlbnRpZmllZC5zbGljZSgwLCAxMCksXG4gICAgICAgIGxpbmtDb250ZXh0OiBzdWJQYWdlc0lkZW50aWZpZWQubGVuZ3RoID4gMCA/ICdtdWx0aS1wYWdlLXJlZmVyZW5jZWQnIGFzIGNvbnN0IDogJ3NpbmdsZS1wYWdlJyBhcyBjb25zdCxcbiAgICAgICAgYW5hbHlzaXNTY29wZTogJ2N1cnJlbnQtcGFnZS1vbmx5JyBhcyAnY3VycmVudC1wYWdlLW9ubHknIHwgJ3dpdGgtY29udGV4dCcsIC8vIFdpbGwgYmUgdXBkYXRlZCBieSBjb250ZXh0IGFuYWx5c2lzIGlmIGVuYWJsZWRcbiAgICAgICAgaW50ZXJuYWxMaW5rc0ZvclZhbGlkYXRpb24gLy8gTkVXOiBMaW5rcyB0byB2YWxpZGF0ZVxuICAgIH07XG59XG5cbi8vIE5FVzogTGluayB2YWxpZGF0aW9uIGZ1bmN0aW9uIGZvciBpbnRlcm5hbCBhbmQgcmVsYXRlZCBkb21haW4gbGlua3NcbmFzeW5jIGZ1bmN0aW9uIHZhbGlkYXRlSW50ZXJuYWxMaW5rcyhcbiAgICBsaW5rc1RvVmFsaWRhdGU6IEFycmF5PHsgdXJsOiBzdHJpbmcsIGFuY2hvclRleHQ6IHN0cmluZywgZWxlbWVudDogRWxlbWVudCB9PixcbiAgICBwcm9ncmVzczogUHJvZ3Jlc3NQdWJsaXNoZXJcbik6IFByb21pc2U8eyBsaW5rSXNzdWVzOiBMaW5rSXNzdWVbXSwgaGVhbHRoeUxpbmtzOiBudW1iZXIgfT4ge1xuICAgIGlmIChsaW5rc1RvVmFsaWRhdGUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiB7IGxpbmtJc3N1ZXM6IFtdLCBoZWFsdGh5TGlua3M6IDAgfTtcbiAgICB9XG5cbiAgICAvLyBEZWR1cGxpY2F0ZSBsaW5rcyBieSBVUkwgYmVmb3JlIHZhbGlkYXRpb24gdG8gYXZvaWQgcmVkdW5kYW50IEhUVFAgcmVxdWVzdHNcbiAgICBjb25zdCB1bmlxdWVMaW5rc01hcCA9IG5ldyBNYXA8c3RyaW5nLCB7IHVybDogc3RyaW5nLCBhbmNob3JUZXh0OiBzdHJpbmcsIGVsZW1lbnQ6IEVsZW1lbnQgfT4oKTtcbiAgICBsaW5rc1RvVmFsaWRhdGUuZm9yRWFjaChsaW5rID0+IHtcbiAgICAgICAgaWYgKCF1bmlxdWVMaW5rc01hcC5oYXMobGluay51cmwpKSB7XG4gICAgICAgICAgICB1bmlxdWVMaW5rc01hcC5zZXQobGluay51cmwsIGxpbmspO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgY29uc3QgdW5pcXVlTGlua3MgPSBBcnJheS5mcm9tKHVuaXF1ZUxpbmtzTWFwLnZhbHVlcygpKTtcblxuICAgIGF3YWl0IHByb2dyZXNzLmluZm8oYENoZWNraW5nICR7dW5pcXVlTGlua3MubGVuZ3RofSB1bmlxdWUgaW50ZXJuYWwgYW5kIHJlbGF0ZWQgZG9tYWluIGxpbmtzIGZvciBhY2Nlc3NpYmlsaXR5Li4uYCk7XG5cbiAgICBjb25zdCBsaW5rSXNzdWVzOiBMaW5rSXNzdWVbXSA9IFtdO1xuICAgIGxldCBoZWFsdGh5TGlua3MgPSAwO1xuICAgIGNvbnN0IG1heENvbmN1cnJlbnQgPSAxMDtcbiAgICBjb25zdCB0aW1lb3V0ID0gNTAwMDsgLy8gNSBzZWNvbmRzXG5cbiAgICAvLyBQcm9jZXNzIGxpbmtzIGluIGJhdGNoZXMgdG8gYXZvaWQgb3ZlcndoZWxtaW5nIHRoZSBzZXJ2ZXJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVuaXF1ZUxpbmtzLmxlbmd0aDsgaSArPSBtYXhDb25jdXJyZW50KSB7XG4gICAgICAgIGNvbnN0IGJhdGNoID0gdW5pcXVlTGlua3Muc2xpY2UoaSwgaSArIG1heENvbmN1cnJlbnQpO1xuXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gYmF0Y2gubWFwKGFzeW5jIChsaW5rSW5mbykgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRpbWVvdXRJZCA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCB0aW1lb3V0KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2gobGlua0luZm8udXJsLCB7XG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ0hFQUQnLFxuICAgICAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnVXNlci1BZ2VudCc6ICdMZW5zeSBEb2N1bWVudGF0aW9uIFF1YWxpdHkgQXVkaXRvci8xLjAnXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWxcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDA0KSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtJc3N1ZTogTGlua0lzc3VlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBsaW5rSW5mby51cmwsXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IDQwNCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuY2hvclRleHQ6IGxpbmtJbmZvLmFuY2hvclRleHQsXG4gICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2VMb2NhdGlvbjogJ21haW4gcGFnZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6ICdQYWdlIG5vdCBmb3VuZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBpc3N1ZVR5cGU6ICc0MDQnXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGxpbmtJc3N1ZXMucHVzaChsaW5rSXNzdWUpO1xuXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmluZm8oYOKaoCBCcm9rZW4gbGluayAoNDA0KTogJHtsaW5rSW5mby51cmx9YCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5rSXNzdWU6IExpbmtJc3N1ZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogbGlua0luZm8udXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiA0MDMsXG4gICAgICAgICAgICAgICAgICAgICAgICBhbmNob3JUZXh0OiBsaW5rSW5mby5hbmNob3JUZXh0LFxuICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlTG9jYXRpb246ICdtYWluIHBhZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiAnQWNjZXNzIGRlbmllZCAoNDAzIEZvcmJpZGRlbiknLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXNzdWVUeXBlOiAnYWNjZXNzLWRlbmllZCdcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgbGlua0lzc3Vlcy5wdXNoKGxpbmtJc3N1ZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhg4pqgIExpbmsgaXNzdWUgKDQwMyk6ICR7bGlua0luZm8udXJsfWApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocmVzcG9uc2Uuc3RhdHVzID49IDQwMCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5rSXNzdWU6IExpbmtJc3N1ZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogbGlua0luZm8udXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgICAgICAgICAgICAgICAgICBhbmNob3JUZXh0OiBsaW5rSW5mby5hbmNob3JUZXh0LFxuICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlTG9jYXRpb246ICdtYWluIHBhZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiBgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXNzdWVUeXBlOiAnZXJyb3InXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGxpbmtJc3N1ZXMucHVzaChsaW5rSXNzdWUpO1xuXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmluZm8oYOKaoCBMaW5rIGlzc3VlICgke3Jlc3BvbnNlLnN0YXR1c30pOiAke2xpbmtJbmZvLnVybH1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBoZWFsdGh5TGlua3MrKztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm5hbWUgPT09ICdBYm9ydEVycm9yJykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5rSXNzdWU6IExpbmtJc3N1ZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogbGlua0luZm8udXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAndGltZW91dCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBhbmNob3JUZXh0OiBsaW5rSW5mby5hbmNob3JUZXh0LFxuICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlTG9jYXRpb246ICdtYWluIHBhZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiAnUmVxdWVzdCB0aW1lb3V0ICg+NSBzZWNvbmRzKScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpc3N1ZVR5cGU6ICd0aW1lb3V0J1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBsaW5rSXNzdWVzLnB1c2gobGlua0lzc3VlKTtcblxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBwcm9ncmVzcy5pbmZvKGDimqAgTGluayB0aW1lb3V0OiAke2xpbmtJbmZvLnVybH1gKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5rSXNzdWU6IExpbmtJc3N1ZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogbGlua0luZm8udXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICAgICAgICAgICAgICAgICAgYW5jaG9yVGV4dDogbGlua0luZm8uYW5jaG9yVGV4dCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZUxvY2F0aW9uOiAnbWFpbiBwYWdlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICBpc3N1ZVR5cGU6ICdlcnJvcidcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgbGlua0lzc3Vlcy5wdXNoKGxpbmtJc3N1ZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhg4pqgIExpbmsgZXJyb3I6ICR7bGlua0luZm8udXJsfSAoJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ30pYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgfVxuXG4gICAgLy8gRGVkdXBsaWNhdGUgbGluayBpc3N1ZXMgYnkgVVJMIChpbiBjYXNlIG9mIGFueSBlZGdlIGNhc2VzKVxuICAgIGNvbnN0IHVuaXF1ZUxpbmtJc3N1ZXNNYXAgPSBuZXcgTWFwPHN0cmluZywgTGlua0lzc3VlPigpO1xuICAgIGxpbmtJc3N1ZXMuZm9yRWFjaChsaW5rID0+IHtcbiAgICAgICAgaWYgKCF1bmlxdWVMaW5rSXNzdWVzTWFwLmhhcyhsaW5rLnVybCkpIHtcbiAgICAgICAgICAgIHVuaXF1ZUxpbmtJc3N1ZXNNYXAuc2V0KGxpbmsudXJsLCBsaW5rKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIGNvbnN0IHVuaXF1ZUxpbmtJc3N1ZXMgPSBBcnJheS5mcm9tKHVuaXF1ZUxpbmtJc3N1ZXNNYXAudmFsdWVzKCkpO1xuXG4gICAgLy8gQ291bnQgYnJva2VuIGxpbmtzICg0MDRzIG9ubHkpXG4gICAgY29uc3QgYnJva2VuTGlua3NDb3VudCA9IHVuaXF1ZUxpbmtJc3N1ZXMuZmlsdGVyKGxpbmsgPT4gbGluay5pc3N1ZVR5cGUgPT09ICc0MDQnKS5sZW5ndGg7XG4gICAgY29uc3QgdG90YWxJc3N1ZXNDb3VudCA9IHVuaXF1ZUxpbmtJc3N1ZXMubGVuZ3RoO1xuXG4gICAgaWYgKGJyb2tlbkxpbmtzQ291bnQgPiAwICYmIGJyb2tlbkxpbmtzQ291bnQgPT09IHRvdGFsSXNzdWVzQ291bnQpIHtcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2Vzcyhg4pyTIExpbmsgY2hlY2sgY29tcGxldGU6ICR7YnJva2VuTGlua3NDb3VudH0gYnJva2VuICg0MDQpLCAke2hlYWx0aHlMaW5rc30gaGVhbHRoeWApO1xuICAgIH0gZWxzZSBpZiAodG90YWxJc3N1ZXNDb3VudCA+IDApIHtcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2Vzcyhg4pyTIExpbmsgY2hlY2sgY29tcGxldGU6ICR7YnJva2VuTGlua3NDb3VudH0gYnJva2VuICg0MDQpLCAke3RvdGFsSXNzdWVzQ291bnQgLSBicm9rZW5MaW5rc0NvdW50fSBvdGhlciBpc3N1ZXMsICR7aGVhbHRoeUxpbmtzfSBoZWFsdGh5YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2Vzcyhg4pyTIExpbmsgY2hlY2sgY29tcGxldGU6IEFsbCAke2hlYWx0aHlMaW5rc30gbGlua3MgaGVhbHRoeWApO1xuICAgIH1cblxuICAgIHJldHVybiB7IGxpbmtJc3N1ZXM6IHVuaXF1ZUxpbmtJc3N1ZXMsIGhlYWx0aHlMaW5rcyB9O1xufVxuXG4vLyBORVc6IEVuaGFuY2VkIENvZGUgQW5hbHlzaXMgZnVuY3Rpb25cbmFzeW5jIGZ1bmN0aW9uIGFuYWx5emVDb2RlU25pcHBldHNFbmhhbmNlZChcbiAgICBjb2RlU25pcHBldHM6IGFueVtdLFxuICAgIHByb2dyZXNzOiBQcm9ncmVzc1B1Ymxpc2hlclxuKTogUHJvbWlzZTx7IGRlcHJlY2F0ZWRDb2RlOiBEZXByZWNhdGVkQ29kZUZpbmRpbmdbXSwgc3ludGF4RXJyb3JzOiBTeW50YXhFcnJvckZpbmRpbmdbXSB9PiB7XG4gICAgaWYgKGNvZGVTbmlwcGV0cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHsgZGVwcmVjYXRlZENvZGU6IFtdLCBzeW50YXhFcnJvcnM6IFtdIH07XG4gICAgfVxuXG4gICAgYXdhaXQgcHJvZ3Jlc3MuaW5mbyhgQW5hbHl6aW5nICR7Y29kZVNuaXBwZXRzLmxlbmd0aH0gY29kZSBzbmlwcGV0cyBmb3IgZGVwcmVjYXRpb24gYW5kIHN5bnRheCBpc3N1ZXMuLi5gKTtcblxuICAgIGNvbnN0IGRlcHJlY2F0ZWRDb2RlOiBEZXByZWNhdGVkQ29kZUZpbmRpbmdbXSA9IFtdO1xuICAgIGNvbnN0IHN5bnRheEVycm9yczogU3ludGF4RXJyb3JGaW5kaW5nW10gPSBbXTtcblxuICAgIC8vIFByb2Nlc3MgY29kZSBzbmlwcGV0cyBpbiBiYXRjaGVzIHRvIGF2b2lkIG92ZXJ3aGVsbWluZyB0aGUgTExNXG4gICAgY29uc3QgYmF0Y2hTaXplID0gMztcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvZGVTbmlwcGV0cy5sZW5ndGg7IGkgKz0gYmF0Y2hTaXplKSB7XG4gICAgICAgIGNvbnN0IGJhdGNoID0gY29kZVNuaXBwZXRzLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc25pcHBldCBvZiBiYXRjaCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBTa2lwIHZlcnkgc2hvcnQgb3Igc2ltcGxlIGNvZGUgc25pcHBldHMgdG8gYXZvaWQgZmFsc2UgcG9zaXRpdmVzXG4gICAgICAgICAgICAgICAgaWYgKHNuaXBwZXQuY29kZS50cmltKCkubGVuZ3RoIDwgMjAgfHwgaXNTaW1wbGVDb2RlKHNuaXBwZXQuY29kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgYW5hbHlzaXMgPSBhd2FpdCBhbmFseXplQ29kZVNuaXBwZXRXaXRoTExNKHNuaXBwZXQsIGkgKyAxKTtcblxuICAgICAgICAgICAgICAgIGlmIChhbmFseXNpcy5kZXByZWNhdGVkQ29kZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlcHJlY2F0ZWRDb2RlLnB1c2goLi4uYW5hbHlzaXMuZGVwcmVjYXRlZENvZGUpO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGRlcHJlY2F0ZWQgb2YgYW5hbHlzaXMuZGVwcmVjYXRlZENvZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmluZm8oYOKaoCBEZXByZWNhdGVkOiAke2RlcHJlY2F0ZWQubWV0aG9kfSBpbiBjb2RlIGJsb2NrICR7aSArIDF9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoYW5hbHlzaXMuc3ludGF4RXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgc3ludGF4RXJyb3JzLnB1c2goLi4uYW5hbHlzaXMuc3ludGF4RXJyb3JzKTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBlcnJvciBvZiBhbmFseXNpcy5zeW50YXhFcnJvcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmluZm8oYOKclyBTeW50YXggZXJyb3I6ICR7ZXJyb3IuZGVzY3JpcHRpb259IGluIGNvZGUgYmxvY2sgJHtpICsgMX1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gYW5hbHl6ZSBjb2RlIHNuaXBwZXQgJHtpICsgMX06YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggb3RoZXIgc25pcHBldHNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHByb2dyZXNzLnN1Y2Nlc3MoYOKckyBDb2RlIGFuYWx5c2lzIGNvbXBsZXRlOiAke2RlcHJlY2F0ZWRDb2RlLmxlbmd0aH0gZGVwcmVjYXRlZCwgJHtzeW50YXhFcnJvcnMubGVuZ3RofSBzeW50YXggZXJyb3JzYCk7XG5cbiAgICByZXR1cm4geyBkZXByZWNhdGVkQ29kZSwgc3ludGF4RXJyb3JzIH07XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBjb2RlIGlzIHRvbyBzaW1wbGUgdG8gYW5hbHl6ZVxuZnVuY3Rpb24gaXNTaW1wbGVDb2RlKGNvZGU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBjb2RlLnRyaW0oKTtcblxuICAgIC8vIFNraXAgc2luZ2xlLWxpbmUgY29tbWVudHMgb3IgdmVyeSBzaG9ydCBzbmlwcGV0c1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA8IDIwKSByZXR1cm4gdHJ1ZTtcblxuICAgIC8vIFNraXAgcHVyZSBDU1MgKGFscmVhZHkgZmlsdGVyZWQgb3V0IGluIG1hcmtkb3duIHByb2Nlc3NpbmcpXG4gICAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoJ3snKSAmJiB0cmltbWVkLmluY2x1ZGVzKCc6JykgJiYgdHJpbW1lZC5pbmNsdWRlcygnOycpICYmICF0cmltbWVkLmluY2x1ZGVzKCdmdW5jdGlvbicpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIFNraXAgc2ltcGxlIEhUTUwgdGFnc1xuICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoJzwnKSAmJiB0cmltbWVkLmVuZHNXaXRoKCc+JykgJiYgdHJpbW1lZC5zcGxpdCgnXFxuJykubGVuZ3RoIDwgMykge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBTa2lwIGNvbmZpZ3VyYXRpb24gZmlsZXMgd2l0aG91dCBjb2RlIGxvZ2ljXG4gICAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoJz0nKSAmJiAhdHJpbW1lZC5pbmNsdWRlcygnZnVuY3Rpb24nKSAmJiAhdHJpbW1lZC5pbmNsdWRlcygnY2xhc3MnKSAmJiB0cmltbWVkLnNwbGl0KCdcXG4nKS5sZW5ndGggPCA1KSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuLy8gTExNLWJhc2VkIGNvZGUgYW5hbHlzaXMgZnVuY3Rpb25cbmFzeW5jIGZ1bmN0aW9uIGFuYWx5emVDb2RlU25pcHBldFdpdGhMTE0oXG4gICAgc25pcHBldDogYW55LFxuICAgIGJsb2NrTnVtYmVyOiBudW1iZXJcbik6IFByb21pc2U8eyBkZXByZWNhdGVkQ29kZTogRGVwcmVjYXRlZENvZGVGaW5kaW5nW10sIHN5bnRheEVycm9yczogU3ludGF4RXJyb3JGaW5kaW5nW10gfT4ge1xuICAgIGNvbnN0IHByb21wdCA9IGBBbmFseXplIHRoaXMgJHtzbmlwcGV0Lmxhbmd1YWdlIHx8ICd1bmtub3duJ30gY29kZSBzbmlwcGV0IGZvciBkZXByZWNhdGVkIG1ldGhvZHMgYW5kIHN5bnRheCBlcnJvcnMuXG5cbkNvZGUgc25pcHBldCAoYmxvY2sgJHtibG9ja051bWJlcn0pOlxuXFxgXFxgXFxgJHtzbmlwcGV0Lmxhbmd1YWdlIHx8ICcnfVxuJHtzbmlwcGV0LmNvZGV9XG5cXGBcXGBcXGBcblxuUGxlYXNlIGlkZW50aWZ5OlxuMS4gRGVwcmVjYXRlZCBtZXRob2RzLCBmdW5jdGlvbnMsIG9yIHBhdHRlcm5zIHdpdGggdmVyc2lvbiBpbmZvcm1hdGlvblxuMi4gRGVmaW5pdGUgc3ludGF4IGVycm9ycyB0aGF0IHdvdWxkIHByZXZlbnQgY29kZSBleGVjdXRpb25cblxuUmV0dXJuIHlvdXIgYW5hbHlzaXMgaW4gdGhpcyBKU09OIGZvcm1hdDpcbntcbiAgXCJkZXByZWNhdGVkQ29kZVwiOiBbXG4gICAge1xuICAgICAgXCJsYW5ndWFnZVwiOiBcImphdmFzY3JpcHRcIixcbiAgICAgIFwibWV0aG9kXCI6IFwiY29tcG9uZW50V2lsbE1vdW50XCIsXG4gICAgICBcImxvY2F0aW9uXCI6IFwiY29kZSBibG9jayAke2Jsb2NrTnVtYmVyfSwgbGluZSA1XCIsXG4gICAgICBcImRlcHJlY2F0ZWRJblwiOiBcIlJlYWN0IDE2LjNcIixcbiAgICAgIFwicmVtb3ZlZEluXCI6IFwiUmVhY3QgMTdcIixcbiAgICAgIFwicmVwbGFjZW1lbnRcIjogXCJ1c2VFZmZlY3QoKSBvciBjb21wb25lbnREaWRNb3VudCgpXCIsXG4gICAgICBcImNvbmZpZGVuY2VcIjogXCJoaWdoXCIsXG4gICAgICBcImNvZGVGcmFnbWVudFwiOiBcImNvbXBvbmVudFdpbGxNb3VudCgpIHtcIlxuICAgIH1cbiAgXSxcbiAgXCJzeW50YXhFcnJvcnNcIjogW1xuICAgIHtcbiAgICAgIFwibGFuZ3VhZ2VcIjogXCJweXRob25cIixcbiAgICAgIFwibG9jYXRpb25cIjogXCJjb2RlIGJsb2NrICR7YmxvY2tOdW1iZXJ9LCBsaW5lIDhcIixcbiAgICAgIFwiZXJyb3JUeXBlXCI6IFwiU3ludGF4RXJyb3JcIixcbiAgICAgIFwiZGVzY3JpcHRpb25cIjogXCJVbmNsb3NlZCBzdHJpbmcgbGl0ZXJhbFwiLFxuICAgICAgXCJjb2RlRnJhZ21lbnRcIjogXCJtZXNzYWdlID0gXFxcXFwiSGVsbG8gd29ybGRcIixcbiAgICAgIFwiY29uZmlkZW5jZVwiOiBcImhpZ2hcIlxuICAgIH1cbiAgXVxufVxuXG5JbXBvcnRhbnQgZ3VpZGVsaW5lczpcbi0gT25seSByZXBvcnQgSElHSCBDT05GSURFTkNFIGZpbmRpbmdzIHRvIGF2b2lkIGZhbHNlIHBvc2l0aXZlc1xuLSBGb3IgZGVwcmVjYXRlZCBjb2RlOiBJbmNsdWRlIHNwZWNpZmljIHZlcnNpb24gaW5mb3JtYXRpb24gd2hlbiBrbm93blxuLSBGb3Igc3ludGF4IGVycm9yczogT25seSByZXBvcnQgZGVmaW5pdGUgZXJyb3JzLCBub3Qgc3R5bGUgaXNzdWVzXG4tIEhhbmRsZSBpbmNvbXBsZXRlIGNvZGUgc25pcHBldHMgZ3JhY2VmdWxseSAoc25pcHBldHMgd2l0aCBcIi4uLlwiIGFyZSBvZnRlbiBwYXJ0aWFsKVxuLSBTa2lwIHNpbXBsZSBjb25maWd1cmF0aW9uIG9yIG1hcmt1cCB0aGF0IGlzbid0IGV4ZWN1dGFibGUgY29kZVxuLSBJZiB1bmNlcnRhaW4sIG1hcmsgY29uZmlkZW5jZSBhcyBcIm1lZGl1bVwiIG9yIFwibG93XCJgO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VNb2RlbENvbW1hbmQoe1xuICAgICAgICAgICAgbW9kZWxJZDogJ3VzLmFudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0yMDI0MTAyMi12MjowJyxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBhY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogXCJiZWRyb2NrLTIwMjMtMDUtMzFcIixcbiAgICAgICAgICAgICAgICBtYXhfdG9rZW5zOiAxMDAwLFxuICAgICAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjEsXG4gICAgICAgICAgICAgICAgbWVzc2FnZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwcm9tcHRcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYmVkcm9ja0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuICAgICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5ib2R5KSk7XG4gICAgICAgIGNvbnN0IGFpUmVzcG9uc2UgPSByZXNwb25zZUJvZHkuY29udGVudFswXS50ZXh0LnRyaW0oKTtcblxuICAgICAgICAvLyBQYXJzZSBKU09OIHJlc3BvbnNlXG4gICAgICAgIGNvbnN0IGFuYWx5c2lzUmVzdWx0ID0gSlNPTi5wYXJzZShhaVJlc3BvbnNlKTtcblxuICAgICAgICAvLyBWYWxpZGF0ZSBhbmQgY2xlYW4gdGhlIHJlc3BvbnNlXG4gICAgICAgIGNvbnN0IGRlcHJlY2F0ZWRDb2RlOiBEZXByZWNhdGVkQ29kZUZpbmRpbmdbXSA9IChhbmFseXNpc1Jlc3VsdC5kZXByZWNhdGVkQ29kZSB8fCBbXSkubWFwKChpdGVtOiBhbnkpID0+ICh7XG4gICAgICAgICAgICBsYW5ndWFnZTogaXRlbS5sYW5ndWFnZSB8fCBzbmlwcGV0Lmxhbmd1YWdlIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIG1ldGhvZDogaXRlbS5tZXRob2QgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgbG9jYXRpb246IGl0ZW0ubG9jYXRpb24gfHwgYGNvZGUgYmxvY2sgJHtibG9ja051bWJlcn1gLFxuICAgICAgICAgICAgZGVwcmVjYXRlZEluOiBpdGVtLmRlcHJlY2F0ZWRJbiB8fCAndW5rbm93biB2ZXJzaW9uJyxcbiAgICAgICAgICAgIHJlbW92ZWRJbjogaXRlbS5yZW1vdmVkSW4sXG4gICAgICAgICAgICByZXBsYWNlbWVudDogaXRlbS5yZXBsYWNlbWVudCB8fCAnc2VlIGRvY3VtZW50YXRpb24nLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogaXRlbS5jb25maWRlbmNlIHx8ICdtZWRpdW0nLFxuICAgICAgICAgICAgY29kZUZyYWdtZW50OiBpdGVtLmNvZGVGcmFnbWVudCB8fCBpdGVtLm1ldGhvZCB8fCAnJ1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc3Qgc3ludGF4RXJyb3JzOiBTeW50YXhFcnJvckZpbmRpbmdbXSA9IChhbmFseXNpc1Jlc3VsdC5zeW50YXhFcnJvcnMgfHwgW10pLm1hcCgoaXRlbTogYW55KSA9PiAoe1xuICAgICAgICAgICAgbGFuZ3VhZ2U6IGl0ZW0ubGFuZ3VhZ2UgfHwgc25pcHBldC5sYW5ndWFnZSB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBsb2NhdGlvbjogaXRlbS5sb2NhdGlvbiB8fCBgY29kZSBibG9jayAke2Jsb2NrTnVtYmVyfWAsXG4gICAgICAgICAgICBlcnJvclR5cGU6IGl0ZW0uZXJyb3JUeXBlIHx8ICdTeW50YXhFcnJvcicsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogaXRlbS5kZXNjcmlwdGlvbiB8fCAnc3ludGF4IGVycm9yIGRldGVjdGVkJyxcbiAgICAgICAgICAgIGNvZGVGcmFnbWVudDogaXRlbS5jb2RlRnJhZ21lbnQgfHwgJycsXG4gICAgICAgICAgICBjb25maWRlbmNlOiBpdGVtLmNvbmZpZGVuY2UgfHwgJ21lZGl1bSdcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHJldHVybiB7IGRlcHJlY2F0ZWRDb2RlLCBzeW50YXhFcnJvcnMgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0xMTSBjb2RlIGFuYWx5c2lzIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7IGRlcHJlY2F0ZWRDb2RlOiBbXSwgc3ludGF4RXJyb3JzOiBbXSB9O1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGlzY292ZXJDb250ZXh0UGFnZXMoZG9jdW1lbnQ6IERvY3VtZW50LCBiYXNlVXJsOiBzdHJpbmcpOiBDb250ZXh0UGFnZVtdIHtcbiAgICBjb25zdCBjb250ZXh0UGFnZXM6IENvbnRleHRQYWdlW10gPSBbXTtcbiAgICBjb25zdCBiYXNlVXJsT2JqID0gbmV3IFVSTChiYXNlVXJsKTtcbiAgICBjb25zdCBwYXRoU2VnbWVudHMgPSBiYXNlVXJsT2JqLnBhdGhuYW1lLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuXG4gICAgLy8gRmluZCBwYXJlbnQgcGFnZSAob25lIGxldmVsIHVwKVxuICAgIGlmIChwYXRoU2VnbWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gJy8nICsgcGF0aFNlZ21lbnRzLnNsaWNlKDAsIC0xKS5qb2luKCcvJykgKyAnLyc7XG4gICAgICAgIGNvbnN0IHBhcmVudFVybCA9IGAke2Jhc2VVcmxPYmoucHJvdG9jb2x9Ly8ke2Jhc2VVcmxPYmouaG9zdG5hbWV9JHtwYXJlbnRQYXRofWA7XG5cbiAgICAgICAgLy8gTG9vayBmb3IgYnJlYWRjcnVtYiBvciBuYXZpZ2F0aW9uIHRoYXQgbWlnaHQgaW5kaWNhdGUgcGFyZW50IHRpdGxlXG4gICAgICAgIGNvbnN0IGJyZWFkY3J1bWJzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLmJyZWFkY3J1bWIgYSwgLmJyZWFkY3J1bWJzIGEsIG5hdiBhJyk7XG4gICAgICAgIGxldCBwYXJlbnRUaXRsZSA9ICdQYXJlbnQgRG9jdW1lbnRhdGlvbic7XG5cbiAgICAgICAgYnJlYWRjcnVtYnMuZm9yRWFjaChsaW5rID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGhyZWYgPSBsaW5rLmdldEF0dHJpYnV0ZSgnaHJlZicpO1xuICAgICAgICAgICAgaWYgKGhyZWYgJiYgaHJlZi5pbmNsdWRlcyhwYXJlbnRQYXRoKSkge1xuICAgICAgICAgICAgICAgIHBhcmVudFRpdGxlID0gbGluay50ZXh0Q29udGVudD8udHJpbSgpIHx8IHBhcmVudFRpdGxlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBjb250ZXh0UGFnZXMucHVzaCh7XG4gICAgICAgICAgICB1cmw6IHBhcmVudFVybCxcbiAgICAgICAgICAgIHRpdGxlOiBwYXJlbnRUaXRsZSxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcDogJ3BhcmVudCcsXG4gICAgICAgICAgICBjb25maWRlbmNlOiAwLjhcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gRmluZCBjaGlsZCBwYWdlcyBmcm9tIGludGVybmFsIGxpbmtzXG4gICAgY29uc3QgbGlua3MgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdhW2hyZWZdJyk7XG4gICAgY29uc3QgY2hpbGRQYWdlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG5cbiAgICBsaW5rcy5mb3JFYWNoKGxpbmsgPT4ge1xuICAgICAgICBjb25zdCBocmVmID0gbGluay5nZXRBdHRyaWJ1dGUoJ2hyZWYnKTtcbiAgICAgICAgY29uc3QgbGlua1RleHQgPSBsaW5rLnRleHRDb250ZW50Py50cmltKCk7XG5cbiAgICAgICAgaWYgKCFocmVmIHx8ICFsaW5rVGV4dCkgcmV0dXJuO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBsaW5rVXJsID0gbmV3IFVSTChocmVmLCBiYXNlVXJsKTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgaXQncyBhIGNoaWxkIHBhZ2UgKHNhbWUgZG9tYWluLCBzdGFydHMgd2l0aCBjdXJyZW50IHBhdGgpXG4gICAgICAgICAgICBpZiAobGlua1VybC5ob3N0bmFtZSA9PT0gYmFzZVVybE9iai5ob3N0bmFtZSAmJlxuICAgICAgICAgICAgICAgIGxpbmtVcmwucGF0aG5hbWUuc3RhcnRzV2l0aChiYXNlVXJsT2JqLnBhdGhuYW1lKSAmJlxuICAgICAgICAgICAgICAgIGxpbmtVcmwucGF0aG5hbWUgIT09IGJhc2VVcmxPYmoucGF0aG5hbWUpIHtcblxuICAgICAgICAgICAgICAgIC8vIEF2b2lkIGR1cGxpY2F0ZXMgYW5kIHZlcnkgbG9uZyBVUkxzXG4gICAgICAgICAgICAgICAgaWYgKCFjaGlsZFBhZ2VzLmhhcyhsaW5rVXJsLmhyZWYpICYmIGxpbmtVcmwucGF0aG5hbWUubGVuZ3RoIDwgMjAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkUGFnZXMuc2V0KGxpbmtVcmwuaHJlZiwgbGlua1RleHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBJbnZhbGlkIFVSTCwgc2tpcFxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgdG9wIGNoaWxkIHBhZ2VzIChsaW1pdCB0byAzKVxuICAgIEFycmF5LmZyb20oY2hpbGRQYWdlcy5lbnRyaWVzKCkpLnNsaWNlKDAsIDMpLmZvckVhY2goKFt1cmwsIHRpdGxlXSkgPT4ge1xuICAgICAgICBjb250ZXh0UGFnZXMucHVzaCh7XG4gICAgICAgICAgICB1cmwsXG4gICAgICAgICAgICB0aXRsZSxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcDogJ2NoaWxkJyxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6IDAuN1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFJlbW92ZSBkdXBsaWNhdGVzIGFuZCBsaW1pdCB0b3RhbCBjb250ZXh0IHBhZ2VzXG4gICAgY29uc3QgdW5pcXVlUGFnZXMgPSBjb250ZXh0UGFnZXMuZmlsdGVyKChwYWdlLCBpbmRleCwgc2VsZikgPT5cbiAgICAgICAgaW5kZXggPT09IHNlbGYuZmluZEluZGV4KHAgPT4gcC51cmwgPT09IHBhZ2UudXJsKVxuICAgICk7XG5cbiAgICByZXR1cm4gdW5pcXVlUGFnZXMuc2xpY2UoMCwgNSk7IC8vIE1heCA1IGNvbnRleHQgcGFnZXNcbn1cblxudHlwZSBEb2N1bWVudGF0aW9uVHlwZSA9XG4gICAgfCAnYXBpLXJlZmVyZW5jZScgICAgICAvLyBGdW5jdGlvbi9jbGFzcyBkb2NzLCBuZWVkcyBjb2RlXG4gICAgfCAndHV0b3JpYWwnICAgICAgICAgICAvLyBTdGVwLWJ5LXN0ZXAgZ3VpZGUsIG5lZWRzIGNvZGVcbiAgICB8ICdjb25jZXB0dWFsJyAgICAgICAgIC8vIEV4cGxhaW5zIGNvbmNlcHRzLCBtYXkgbm90IG5lZWQgY29kZVxuICAgIHwgJ2hvdy10bycgICAgICAgICAgICAgLy8gVGFzay1mb2N1c2VkLCB1c3VhbGx5IG5lZWRzIGNvZGVcbiAgICB8ICdyZWZlcmVuY2UnICAgICAgICAgIC8vIFRhYmxlcywgbGlzdHMsIHNwZWNzXG4gICAgfCAndHJvdWJsZXNob290aW5nJyAgICAvLyBQcm9ibGVtL3NvbHV0aW9uIGZvcm1hdFxuICAgIHwgJ292ZXJ2aWV3JyAgICAgICAgICAgLy8gSGlnaC1sZXZlbCBpbnRybywgcmFyZWx5IG5lZWRzIGNvZGVcbiAgICB8ICdjaGFuZ2Vsb2cnICAgICAgICAgIC8vIFZlcnNpb24gaGlzdG9yeVxuICAgIHwgJ21peGVkJzsgICAgICAgICAgICAgLy8gQ29tYmluYXRpb25cblxuLy8gTGF5ZXIgMTogRmFzdCBrZXl3b3JkIG1hdGNoaW5nICg5MCUgb2YgY2FzZXMsIGZyZWUpXG5mdW5jdGlvbiBkZXRlY3RCeUtleXdvcmRzKHVybDogc3RyaW5nLCB0aXRsZTogc3RyaW5nKTogRG9jdW1lbnRhdGlvblR5cGUgfCBudWxsIHtcbiAgICBjb25zdCB1cmxMb3dlciA9IHVybC50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IHRpdGxlTG93ZXIgPSB0aXRsZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IHNlYXJjaFRleHQgPSBgJHt1cmxMb3dlcn0gJHt0aXRsZUxvd2VyfWA7XG5cbiAgICBjb25zb2xlLmxvZyhg8J+UjSBLZXl3b3JkIGRldGVjdGlvbiBmb3I6ICR7dXJsfWApO1xuICAgIGNvbnNvbGUubG9nKGDwn5OdIFRpdGxlOiAke3RpdGxlfWApO1xuXG4gICAgLy8gSGlnaC1jb25maWRlbmNlIGtleXdvcmQgbWF0Y2hlc1xuICAgIGlmIChzZWFyY2hUZXh0LmluY2x1ZGVzKCcvcmVmZXJlbmNlL2Z1bmN0aW9ucy8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvcmVmZXJlbmNlL2NsYXNzZXMvJykgfHxcbiAgICAgICAgc2VhcmNoVGV4dC5pbmNsdWRlcygnL3JlZmVyZW5jZS9ob29rcy8nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCcoKScpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ2Z1bmN0aW9uJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnaG9vaycpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogYXBpLXJlZmVyZW5jZWApO1xuICAgICAgICByZXR1cm4gJ2FwaS1yZWZlcmVuY2UnO1xuICAgIH1cblxuICAgIGlmIChzZWFyY2hUZXh0LmluY2x1ZGVzKCdnZXR0aW5nLXN0YXJ0ZWQnKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvdHV0b3JpYWwnKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCd0dXRvcmlhbCcpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ2dldHRpbmcgc3RhcnRlZCcpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogdHV0b3JpYWxgKTtcbiAgICAgICAgcmV0dXJuICd0dXRvcmlhbCc7XG4gICAgfVxuXG4gICAgaWYgKHNlYXJjaFRleHQuaW5jbHVkZXMoJy9leHBsYW5hdGlvbnMvJykgfHxcbiAgICAgICAgc2VhcmNoVGV4dC5pbmNsdWRlcygnL2FyY2hpdGVjdHVyZS8nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdhcmNoaXRlY3R1cmUnKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCd1bmRlcnN0YW5kaW5nJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnZXhwbGFuYXRpb24nKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIEtleXdvcmQgbWF0Y2g6IGNvbmNlcHR1YWxgKTtcbiAgICAgICAgcmV0dXJuICdjb25jZXB0dWFsJztcbiAgICB9XG5cbiAgICBpZiAoc2VhcmNoVGV4dC5pbmNsdWRlcygnaG93LXRvJykgfHxcbiAgICAgICAgc2VhcmNoVGV4dC5pbmNsdWRlcygnL2d1aWRlcy8nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdob3cgdG8nKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdjcmVhdGUnKSB8fFxuICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKCdidWlsZCcpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogaG93LXRvYCk7XG4gICAgICAgIHJldHVybiAnaG93LXRvJztcbiAgICB9XG5cbiAgICBpZiAoc2VhcmNoVGV4dC5pbmNsdWRlcygnL2ludHJvJykgfHxcbiAgICAgICAgc2VhcmNoVGV4dC5pbmNsdWRlcygnaW50cm9kdWN0aW9uJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnaW50cm9kdWN0aW9uJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnaW50cm8nKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIEtleXdvcmQgbWF0Y2g6IG92ZXJ2aWV3YCk7XG4gICAgICAgIHJldHVybiAnb3ZlcnZpZXcnO1xuICAgIH1cblxuICAgIGlmIChzZWFyY2hUZXh0LmluY2x1ZGVzKCcvcmVmZXJlbmNlLWd1aWRlcy8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvcmVmZXJlbmNlLycpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ3JlZmVyZW5jZScpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogcmVmZXJlbmNlYCk7XG4gICAgICAgIHJldHVybiAncmVmZXJlbmNlJztcbiAgICB9XG5cbiAgICBpZiAoc2VhcmNoVGV4dC5pbmNsdWRlcygnL3Ryb3VibGVzaG9vdGluZy8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvZmFxLycpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ3Ryb3VibGVzaG9vdCcpIHx8XG4gICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoJ2ZhcScpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogdHJvdWJsZXNob290aW5nYCk7XG4gICAgICAgIHJldHVybiAndHJvdWJsZXNob290aW5nJztcbiAgICB9XG5cbiAgICBpZiAoc2VhcmNoVGV4dC5pbmNsdWRlcygnL2NoYW5nZWxvZy8nKSB8fFxuICAgICAgICBzZWFyY2hUZXh0LmluY2x1ZGVzKCcvcmVsZWFzZXMvJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygnY2hhbmdlbG9nJykgfHxcbiAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcygncmVsZWFzZScpKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgS2V5d29yZCBtYXRjaDogY2hhbmdlbG9nYCk7XG4gICAgICAgIHJldHVybiAnY2hhbmdlbG9nJztcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhg4p2MIE5vIGtleXdvcmQgbWF0Y2ggZm91bmRgKTtcbiAgICByZXR1cm4gbnVsbDsgLy8gTm8gY2xlYXIgbWF0Y2ggLSBuZWVkIEFJIGZhbGxiYWNrXG59XG5cbi8vIExheWVyIDI6IEFJIGZhbGxiYWNrIGZvciB1bmNsZWFyIGNhc2VzICgxMCUgb2YgY2FzZXMsIHNtYWxsIGNvc3QpXG5hc3luYyBmdW5jdGlvbiBkZXRlY3RCeUFJKHVybDogc3RyaW5nLCB0aXRsZTogc3RyaW5nLCBkZXNjcmlwdGlvbj86IHN0cmluZyk6IFByb21pc2U8RG9jdW1lbnRhdGlvblR5cGU+IHtcbiAgICBjb25zb2xlLmxvZyhg8J+kliBVc2luZyBBSSBmYWxsYmFjayBmb3IgY29udGVudCB0eXBlIGRldGVjdGlvbmApO1xuXG4gICAgY29uc3QgcHJvbXB0ID0gYENsYXNzaWZ5IHRoaXMgZG9jdW1lbnRhdGlvbiBwYWdlIHR5cGUgYmFzZWQgb24gVVJMIGFuZCBtZXRhZGF0YTpcblxuVVJMOiAke3VybH1cblRpdGxlOiAke3RpdGxlfVxuRGVzY3JpcHRpb246ICR7ZGVzY3JpcHRpb24gfHwgJ04vQSd9XG5cbkNsYXNzaWZ5IGFzIE9ORSBvZiB0aGVzZSB0eXBlczpcbi0gYXBpLXJlZmVyZW5jZTogRnVuY3Rpb24vY2xhc3MgZG9jdW1lbnRhdGlvbiB3aXRoIHBhcmFtZXRlcnMgYW5kIHJldHVybiB2YWx1ZXNcbi0gdHV0b3JpYWw6IFN0ZXAtYnktc3RlcCBsZWFybmluZyBndWlkZSBvciBnZXR0aW5nIHN0YXJ0ZWQgY29udGVudFxuLSBjb25jZXB0dWFsOiBBcmNoaXRlY3R1cmUgZXhwbGFuYXRpb25zLCB0aGVvcnksIG9yIHVuZGVyc3RhbmRpbmcgY29uY2VwdHNcbi0gaG93LXRvOiBUYXNrLWZvY3VzZWQgZ3VpZGVzIGZvciBhY2NvbXBsaXNoaW5nIHNwZWNpZmljIGdvYWxzXG4tIG92ZXJ2aWV3OiBIaWdoLWxldmVsIGludHJvZHVjdGlvbnMgb3Igc3VtbWFyeSBwYWdlc1xuLSByZWZlcmVuY2U6IFRhYmxlcywgbGlzdHMsIHNwZWNpZmljYXRpb25zLCBvciByZWZlcmVuY2UgbWF0ZXJpYWxzXG4tIHRyb3VibGVzaG9vdGluZzogUHJvYmxlbS9zb2x1dGlvbiBmb3JtYXQgb3IgRkFRIGNvbnRlbnRcbi0gY2hhbmdlbG9nOiBWZXJzaW9uIGhpc3Rvcnkgb3IgcmVsZWFzZSBub3Rlc1xuLSBtaXhlZDogVW5jbGVhciBvciBjb21iaW5hdGlvbiBvZiBtdWx0aXBsZSB0eXBlc1xuXG5SZXNwb25kIHdpdGgganVzdCB0aGUgdHlwZSBuYW1lIChlLmcuLCBcImFwaS1yZWZlcmVuY2VcIikuYDtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxDb21tYW5kKHtcbiAgICAgICAgICAgIG1vZGVsSWQ6ICd1cy5hbnRocm9waWMuY2xhdWRlLTMtNS1zb25uZXQtMjAyNDEwMjItdjI6MCcsXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgYWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgYW50aHJvcGljX3ZlcnNpb246IFwiYmVkcm9jay0yMDIzLTA1LTMxXCIsXG4gICAgICAgICAgICAgICAgbWF4X3Rva2VuczogNTAsIC8vIE1pbmltYWwgdG9rZW5zIGZvciBqdXN0IHRoZSB0eXBlIG5hbWVcbiAgICAgICAgICAgICAgICB0ZW1wZXJhdHVyZTogMC4xLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcHJvbXB0XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGJlZHJvY2tDbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuYm9keSkpO1xuICAgICAgICBjb25zdCBhaVJlc3BvbnNlID0gcmVzcG9uc2VCb2R5LmNvbnRlbnRbMF0udGV4dC50cmltKCkudG9Mb3dlckNhc2UoKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OryBBSSByZXNwb25zZTogJHthaVJlc3BvbnNlfWApO1xuXG4gICAgICAgIC8vIFZhbGlkYXRlIEFJIHJlc3BvbnNlXG4gICAgICAgIGNvbnN0IHZhbGlkVHlwZXM6IERvY3VtZW50YXRpb25UeXBlW10gPSBbXG4gICAgICAgICAgICAnYXBpLXJlZmVyZW5jZScsICd0dXRvcmlhbCcsICdjb25jZXB0dWFsJywgJ2hvdy10bycsXG4gICAgICAgICAgICAnb3ZlcnZpZXcnLCAncmVmZXJlbmNlJywgJ3Ryb3VibGVzaG9vdGluZycsICdjaGFuZ2Vsb2cnLCAnbWl4ZWQnXG4gICAgICAgIF07XG5cbiAgICAgICAgaWYgKHZhbGlkVHlwZXMuaW5jbHVkZXMoYWlSZXNwb25zZSBhcyBEb2N1bWVudGF0aW9uVHlwZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBhaVJlc3BvbnNlIGFzIERvY3VtZW50YXRpb25UeXBlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyBJbnZhbGlkIEFJIHJlc3BvbnNlLCBkZWZhdWx0aW5nIHRvIG1peGVkYCk7XG4gICAgICAgICAgICByZXR1cm4gJ21peGVkJztcbiAgICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignQUkgY29udGVudCB0eXBlIGRldGVjdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4gJ21peGVkJzsgLy8gRmFsbGJhY2sgdG8gbWl4ZWQgb24gZXJyb3JcbiAgICB9XG59XG5cbi8vIENvbXBsZXRlIGRldGVjdGlvbiB3aXRoIGNhY2hpbmdcbmFzeW5jIGZ1bmN0aW9uIGRldGVjdENvbnRlbnRUeXBlRW5oYW5jZWQoXG4gICAgZG9jdW1lbnQ6IERvY3VtZW50LFxuICAgIG1hcmtkb3duQ29udGVudDogc3RyaW5nLFxuICAgIHVybDogc3RyaW5nXG4pOiBQcm9taXNlPERvY3VtZW50YXRpb25UeXBlPiB7XG5cbiAgICAvLyBMYXllciAxOiBGYXN0IGtleXdvcmQgZGV0ZWN0aW9uICg5MCUgb2YgY2FzZXMpXG4gICAgY29uc3Qga2V5d29yZFR5cGUgPSBkZXRlY3RCeUtleXdvcmRzKHVybCwgZG9jdW1lbnQudGl0bGUpO1xuICAgIGlmIChrZXl3b3JkVHlwZSkge1xuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIENvbnRlbnQgdHlwZSBkZXRlY3RlZCBieSBrZXl3b3JkczogJHtrZXl3b3JkVHlwZX1gKTtcbiAgICAgICAgcmV0dXJuIGtleXdvcmRUeXBlO1xuICAgIH1cblxuICAgIC8vIExheWVyIDI6IEFJIGZhbGxiYWNrIGZvciB1bmNsZWFyIGNhc2VzICgxMCUgb2YgY2FzZXMpXG4gICAgY29uc29sZS5sb2coYPCfpJYgVXNpbmcgQUkgZmFsbGJhY2sgZm9yIHVuY2xlYXIgVVJMOiAke3VybH1gKTtcblxuICAgIGNvbnN0IG1ldGFEZXNjcmlwdGlvbiA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ21ldGFbbmFtZT1cImRlc2NyaXB0aW9uXCJdJyk/LmdldEF0dHJpYnV0ZSgnY29udGVudCcpIHx8IHVuZGVmaW5lZDtcbiAgICBjb25zdCBhaVR5cGUgPSBhd2FpdCBkZXRlY3RCeUFJKHVybCwgZG9jdW1lbnQudGl0bGUsIG1ldGFEZXNjcmlwdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZyhg8J+OryBDb250ZW50IHR5cGUgZGV0ZWN0ZWQgYnkgQUk6ICR7YWlUeXBlfWApO1xuICAgIHJldHVybiBhaVR5cGU7XG59XG5cbi8vIExlZ2FjeSBmdW5jdGlvbiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eSAod2lsbCBiZSByZXBsYWNlZClcbmZ1bmN0aW9uIGRldGVjdENvbnRlbnRUeXBlKGRvY3VtZW50OiBEb2N1bWVudCwgbWFya2Rvd25Db250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIC8vIFRoaXMgaXMgdGhlIG9sZCBmdW5jdGlvbiAtIHdlJ2xsIHJlcGxhY2UgY2FsbHMgdG8gdGhpcyB3aXRoIGRldGVjdENvbnRlbnRUeXBlRW5oYW5jZWRcbiAgICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LnRpdGxlLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgY29udGVudCA9IG1hcmtkb3duQ29udGVudC50b0xvd2VyQ2FzZSgpO1xuXG4gICAgaWYgKHRpdGxlLmluY2x1ZGVzKCdhcGknKSB8fCBjb250ZW50LmluY2x1ZGVzKCdlbmRwb2ludCcpKSB7XG4gICAgICAgIHJldHVybiAnYXBpLWRvY3MnO1xuICAgIH1cblxuICAgIGlmICh0aXRsZS5pbmNsdWRlcygndHV0b3JpYWwnKSB8fCB0aXRsZS5pbmNsdWRlcygnZ3VpZGUnKSkge1xuICAgICAgICByZXR1cm4gJ3R1dG9yaWFsJztcbiAgICB9XG5cbiAgICBpZiAodGl0bGUuaW5jbHVkZXMoJ3JlZmVyZW5jZScpIHx8IHRpdGxlLmluY2x1ZGVzKCdkb2N1bWVudGF0aW9uJykpIHtcbiAgICAgICAgcmV0dXJuICdyZWZlcmVuY2UnO1xuICAgIH1cblxuICAgIHJldHVybiAnbWl4ZWQnO1xufVxuXG5mdW5jdGlvbiBkZXRlY3RMYW5ndWFnZUZyb21DbGFzcyhjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgbGFuZ01hdGNoID0gY2xhc3NOYW1lLm1hdGNoKC8oPzpsYW5nLXxsYW5ndWFnZS0pKFthLXpBLVowLTldKykvKTtcbiAgICBpZiAobGFuZ01hdGNoKSB7XG4gICAgICAgIHJldHVybiBsYW5nTWF0Y2hbMV0udG9Mb3dlckNhc2UoKTtcbiAgICB9XG5cbiAgICBpZiAoY2xhc3NOYW1lLmluY2x1ZGVzKCdwaHAnKSkgcmV0dXJuICdwaHAnO1xuICAgIGlmIChjbGFzc05hbWUuaW5jbHVkZXMoJ2pzJykgfHwgY2xhc3NOYW1lLmluY2x1ZGVzKCdqYXZhc2NyaXB0JykpIHJldHVybiAnamF2YXNjcmlwdCc7XG4gICAgaWYgKGNsYXNzTmFtZS5pbmNsdWRlcygnY3NzJykpIHJldHVybiAnY3NzJztcbiAgICBpZiAoY2xhc3NOYW1lLmluY2x1ZGVzKCdodG1sJykpIHJldHVybiAnaHRtbCc7XG5cbiAgICByZXR1cm4gJyc7XG59XG5cbmZ1bmN0aW9uIGRldGVjdExhbmd1YWdlRnJvbUNvbnRlbnQoY29kZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBpZiAoY29kZS5pbmNsdWRlcygnPD9waHAnKSB8fCBjb2RlLmluY2x1ZGVzKCctPicpKSB7XG4gICAgICAgIHJldHVybiAncGhwJztcbiAgICB9XG5cbiAgICBpZiAoY29kZS5pbmNsdWRlcygnZnVuY3Rpb24nKSB8fCBjb2RlLmluY2x1ZGVzKCdjb25zdCAnKSB8fCBjb2RlLmluY2x1ZGVzKCc9PicpKSB7XG4gICAgICAgIHJldHVybiAnamF2YXNjcmlwdCc7XG4gICAgfVxuXG4gICAgaWYgKGNvZGUuaW5jbHVkZXMoJ3snKSAmJiBjb2RlLmluY2x1ZGVzKCc6JykgJiYgY29kZS5pbmNsdWRlcygnOycpKSB7XG4gICAgICAgIHJldHVybiAnY3NzJztcbiAgICB9XG5cbiAgICBpZiAoY29kZS5pbmNsdWRlcygnPCcpICYmIGNvZGUuaW5jbHVkZXMoJz4nKSkge1xuICAgICAgICByZXR1cm4gJ2h0bWwnO1xuICAgIH1cblxuICAgIHJldHVybiAndGV4dCc7XG59XG5cbmZ1bmN0aW9uIGNoZWNrRm9yVmVyc2lvbkluZm8oY29kZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdmVyc2lvblBhdHRlcm5zID0gW1xuICAgICAgICAvc2luY2VcXHMrd29yZHByZXNzXFxzK1xcZCtcXC5cXGQrL2ksXG4gICAgICAgIC93cFxccytcXGQrXFwuXFxkKy9pLFxuICAgICAgICAvdmVyc2lvblxccytcXGQrXFwuXFxkKy9pLFxuICAgICAgICAvQHNpbmNlXFxzK1xcZCtcXC5cXGQrL2lcbiAgICBdO1xuXG4gICAgcmV0dXJuIHZlcnNpb25QYXR0ZXJucy5zb21lKHBhdHRlcm4gPT4gcGF0dGVybi50ZXN0KGNvZGUpKTtcbn1cblxuLyoqXG4gKiBSZW1vdmUgbm9pc2UgZWxlbWVudHMgZnJvbSBkb2N1bWVudCBiZWZvcmUgY29udmVyc2lvblxuICogRW5oYW5jZWQgcmVtb3ZhbCBmb2N1c2luZyBvbiBDU1MvSlMgbm9pc2VcbiAqL1xuZnVuY3Rpb24gcmVtb3ZlTm9pc2VFbGVtZW50cyhkb2N1bWVudDogRG9jdW1lbnQpOiBudW1iZXIge1xuICAgIGNvbnN0IG5vaXNlU2VsZWN0b3JzID0gW1xuICAgICAgICAvLyBTY3JpcHRzIGFuZCBzdHlsZXMgKENSSVRJQ0FMIGZvciByZW1vdmluZyBDU1MvSlMgbm9pc2UhKVxuICAgICAgICAnc2NyaXB0JywgJ3N0eWxlJywgJ25vc2NyaXB0JywgJ2xpbmtbcmVsPVwic3R5bGVzaGVldFwiXScsXG5cbiAgICAgICAgLy8gTmF2aWdhdGlvbiBhbmQgVUkgY2hyb21lXG4gICAgICAgICduYXYnLCAnaGVhZGVyJywgJ2Zvb3RlcicsICdhc2lkZScsXG4gICAgICAgICdbcm9sZT1cIm5hdmlnYXRpb25cIl0nLCAnW3JvbGU9XCJiYW5uZXJcIl0nLCAnW3JvbGU9XCJjb250ZW50aW5mb1wiXScsXG5cbiAgICAgICAgLy8gV29yZFByZXNzLm9yZyBzcGVjaWZpYyBub2lzZVxuICAgICAgICAnLnNpdGUtaGVhZGVyJywgJy5zaXRlLWZvb3RlcicsICcuc2l0ZS1uYXZpZ2F0aW9uJyxcbiAgICAgICAgJyNzZWNvbmRhcnknLCAnLm5hdmlnYXRpb24nLCAnLmJyZWFkY3J1bWInLCAnLmJyZWFkY3J1bWJzJyxcbiAgICAgICAgJy5lZGl0LWxpbmsnLCAnLnBvc3QtbmF2aWdhdGlvbicsICcuY29tbWVudHMtYXJlYScsXG4gICAgICAgICcjd3BvcmctaGVhZGVyJywgJyN3cG9yZy1mb290ZXInLCAnI3dwb3JnLXNpZGViYXInLFxuICAgICAgICAnLndwLWJsb2NrLXdwb3JnLXNpZGViYXItY29udGFpbmVyJyxcbiAgICAgICAgJy53cC1ibG9jay1zb2NpYWwtbGlua3MnLCAnLndwLWJsb2NrLW5hdmlnYXRpb24nLFxuXG4gICAgICAgIC8vIENvbW1vbiBub2lzZSBwYXR0ZXJuc1xuICAgICAgICAnLmFkdmVydGlzZW1lbnQnLCAnLmFkJywgJy5hZHMnLCAnLnNpZGViYXInLCAnLmNvbW1lbnRzJyxcbiAgICAgICAgJy5jb29raWUtbm90aWNlJywgJy5nZHByLW5vdGljZScsICcucHJpdmFjeS1ub3RpY2UnLFxuICAgICAgICAnLnNvY2lhbC1zaGFyZScsICcuc2hhcmUtYnV0dG9ucycsICcucmVsYXRlZC1wb3N0cycsXG4gICAgICAgICcuYXV0aG9yLWJpbycsICcucG9zdC1tZXRhJywgJy5lbnRyeS1tZXRhJyxcblxuICAgICAgICAvLyBGb3JtIGVsZW1lbnRzICh1c3VhbGx5IG5vdCBkb2N1bWVudGF0aW9uIGNvbnRlbnQpXG4gICAgICAgICdmb3JtJywgJ2lucHV0JywgJ2J1dHRvblt0eXBlPVwic3VibWl0XCJdJywgJ3RleHRhcmVhJyxcblxuICAgICAgICAvLyBIaWRkZW4gZWxlbWVudHNcbiAgICAgICAgJ1tzdHlsZSo9XCJkaXNwbGF5Om5vbmVcIl0nLCAnW3N0eWxlKj1cInZpc2liaWxpdHk6aGlkZGVuXCJdJyxcbiAgICAgICAgJy5oaWRkZW4nLCAnLnNyLW9ubHknLCAnLnNjcmVlbi1yZWFkZXItdGV4dCcsXG5cbiAgICAgICAgLy8gRW1iZWRzIGFuZCB3aWRnZXRzXG4gICAgICAgICdpZnJhbWUnLCAnZW1iZWQnLCAnb2JqZWN0JywgJ3ZpZGVvJywgJ2F1ZGlvJyxcbiAgICAgICAgJy53aWRnZXQnLCAnLndwLXdpZGdldCcsICcuc2lkZWJhci13aWRnZXQnLFxuXG4gICAgICAgIC8vIFNraXAgbGlua3MgYW5kIGFjY2Vzc2liaWxpdHkgaGVscGVycyAobm90IGNvbnRlbnQpXG4gICAgICAgICcuc2tpcC1saW5rJywgJy5za2lwLXRvLWNvbnRlbnQnLFxuXG4gICAgICAgIC8vIFdvcmRQcmVzcyBhZG1pbiBhbmQgZWRpdCBsaW5rc1xuICAgICAgICAnLmVkaXQtcG9zdC1saW5rJywgJy5hZG1pbi1iYXInLCAnI3dwYWRtaW5iYXInXG4gICAgXTtcblxuICAgIGxldCByZW1vdmVkQ291bnQgPSAwO1xuICAgIG5vaXNlU2VsZWN0b3JzLmZvckVhY2goc2VsZWN0b3IgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZWxlbWVudHMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTtcbiAgICAgICAgICAgIGVsZW1lbnRzLmZvckVhY2goZWwgPT4ge1xuICAgICAgICAgICAgICAgIGVsLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIHJlbW92ZWRDb3VudCsrO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBFcnJvciB3aXRoIHNlbGVjdG9yICR7c2VsZWN0b3J9OmAsIGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiByZW1vdmVkQ291bnQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCBtYWluIGNvbnRlbnQgd2l0aCBiZXR0ZXIgY29udGVudCBkZXRlY3Rpb25cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdE1haW5Db250ZW50KGRvY3VtZW50OiBEb2N1bWVudCk6IEVsZW1lbnQge1xuICAgIC8vIFN0cmF0ZWd5IDE6IFdvcmRQcmVzcy5vcmcgc3BlY2lmaWMgY29udGVudCBjb250YWluZXJzXG4gICAgY29uc3Qgd3BTZWxlY3RvcnMgPSBbXG4gICAgICAgICcuZW50cnktY29udGVudCcsXG4gICAgICAgICcucG9zdC1jb250ZW50JyxcbiAgICAgICAgJ21haW4gLmVudHJ5LWNvbnRlbnQnLFxuICAgICAgICAnYXJ0aWNsZSAuZW50cnktY29udGVudCcsXG4gICAgICAgICcuY29udGVudC1hcmVhIG1haW4nXG4gICAgXTtcblxuICAgIGZvciAoY29uc3Qgc2VsZWN0b3Igb2Ygd3BTZWxlY3RvcnMpIHtcbiAgICAgICAgY29uc3QgZWxlbWVudCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xuICAgICAgICBpZiAoZWxlbWVudCAmJiBlbGVtZW50LnRleHRDb250ZW50ICYmIGVsZW1lbnQudGV4dENvbnRlbnQudHJpbSgpLmxlbmd0aCA+IDUwMCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kIG1haW4gY29udGVudCB1c2luZzogJHtzZWxlY3Rvcn1gKTtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gU3RyYXRlZ3kgMjogR2VuZXJpYyBjb250ZW50IGNvbnRhaW5lcnNcbiAgICBjb25zdCBnZW5lcmljU2VsZWN0b3JzID0gWydtYWluJywgJ2FydGljbGUnLCAnW3JvbGU9XCJtYWluXCJdJywgJyNjb250ZW50J107XG5cbiAgICBmb3IgKGNvbnN0IHNlbGVjdG9yIG9mIGdlbmVyaWNTZWxlY3RvcnMpIHtcbiAgICAgICAgY29uc3QgZWxlbWVudCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xuICAgICAgICBpZiAoZWxlbWVudCAmJiBlbGVtZW50LnRleHRDb250ZW50ICYmIGVsZW1lbnQudGV4dENvbnRlbnQudHJpbSgpLmxlbmd0aCA+IDUwMCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kIG1haW4gY29udGVudCB1c2luZzogJHtzZWxlY3Rvcn1gKTtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coJ0ZhbGxiYWNrIHRvIGRvY3VtZW50IGJvZHknKTtcbiAgICByZXR1cm4gZG9jdW1lbnQuYm9keTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmUgVHVybmRvd24gc2VydmljZSB3aXRoIGFnZ3Jlc3NpdmUgbm9pc2UgcmVtb3ZhbCB1c2luZyBidWlsdC1pbiBtZXRob2RzXG4gKi9cbmZ1bmN0aW9uIGNvbmZpZ3VyZVR1cm5kb3duU2VydmljZSgpOiBUdXJuZG93blNlcnZpY2Uge1xuICAgIGNvbnN0IHR1cm5kb3duID0gbmV3IFR1cm5kb3duU2VydmljZSh7XG4gICAgICAgIGhlYWRpbmdTdHlsZTogJ2F0eCcsXG4gICAgICAgIGNvZGVCbG9ja1N0eWxlOiAnZmVuY2VkJyxcbiAgICAgICAgYnVsbGV0TGlzdE1hcmtlcjogJy0nXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgR2l0SHViIEZsYXZvcmVkIE1hcmtkb3duIHN1cHBvcnQgKHRhYmxlcywgc3RyaWtldGhyb3VnaCwgZXRjLilcbiAgICB0dXJuZG93bi51c2UoZ2ZtKTtcblxuICAgIC8vIEFHR1JFU1NJVkUgbm9pc2UgcmVtb3ZhbCB1c2luZyBUdXJuZG93bidzIGJ1aWx0LWluIHJlbW92ZSgpIG1ldGhvZFxuICAgIHR1cm5kb3duLnJlbW92ZShbXG4gICAgICAgIC8vIFNjcmlwdHMgYW5kIHN0eWxlcyAoQ1JJVElDQUwhKVxuICAgICAgICAnc2NyaXB0JywgJ3N0eWxlJywgJ25vc2NyaXB0JywgJ2xpbmsnLFxuXG4gICAgICAgIC8vIE5hdmlnYXRpb24gYW5kIGNocm9tZVxuICAgICAgICAnbmF2JywgJ2Zvb3RlcicsICdoZWFkZXInLCAnYXNpZGUnLFxuXG4gICAgICAgIC8vIEZvcm1zIGFuZCBpbnB1dHNcbiAgICAgICAgJ2Zvcm0nLCAnaW5wdXQnLCAnYnV0dG9uJywgJ3RleHRhcmVhJywgJ3NlbGVjdCcsICdvcHRpb24nLFxuXG4gICAgICAgIC8vIE1lZGlhIGFuZCBlbWJlZHNcbiAgICAgICAgJ2lmcmFtZScsICdlbWJlZCcsICdvYmplY3QnLCAndmlkZW8nLCAnYXVkaW8nLFxuXG4gICAgICAgIC8vIE1ldGEgYW5kIGhpZGRlbiBjb250ZW50XG4gICAgICAgICdtZXRhJywgJ3RpdGxlJywgJ2Jhc2UnXG4gICAgXSk7XG5cbiAgICAvLyBDdXN0b20gcnVsZSBmb3IgV29yZFByZXNzIGNhbGxvdXRzL25vdGljZXNcbiAgICB0dXJuZG93bi5hZGRSdWxlKCdjYWxsb3V0Jywge1xuICAgICAgICBmaWx0ZXI6IChub2RlOiBhbnkpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBub2RlLm5vZGVOYW1lID09PSAnRElWJyAmJlxuICAgICAgICAgICAgICAgIC9ub3RpY2V8d2FybmluZ3xpbmZvfHRpcHxhbGVydC8udGVzdChub2RlLmNsYXNzTmFtZSB8fCAnJyk7XG4gICAgICAgIH0sXG4gICAgICAgIHJlcGxhY2VtZW50OiAoY29udGVudDogc3RyaW5nLCBub2RlOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IG5vZGUuY2xhc3NOYW1lIHx8ICcnO1xuICAgICAgICAgICAgbGV0IHR5cGUgPSAnTm90ZSc7XG4gICAgICAgICAgICBpZiAoL3dhcm5pbmd8Y2F1dGlvbi8udGVzdChjbGFzc05hbWUpKSB0eXBlID0gJ1dhcm5pbmcnO1xuICAgICAgICAgICAgaWYgKC9pbmZvfG5vdGUvLnRlc3QoY2xhc3NOYW1lKSkgdHlwZSA9ICdOb3RlJztcbiAgICAgICAgICAgIGlmICgvdGlwfGhpbnQvLnRlc3QoY2xhc3NOYW1lKSkgdHlwZSA9ICdUaXAnO1xuICAgICAgICAgICAgaWYgKC9lcnJvcnxkYW5nZXIvLnRlc3QoY2xhc3NOYW1lKSkgdHlwZSA9ICdFcnJvcic7XG4gICAgICAgICAgICByZXR1cm4gYFxcbj4gKioke3R5cGV9OioqICR7Y29udGVudC50cmltKCl9XFxuYDtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gRW5oYW5jZWQgY29kZSBibG9jayBoYW5kbGluZyB3aXRoIGxhbmd1YWdlIGRldGVjdGlvblxuICAgIHR1cm5kb3duLmFkZFJ1bGUoJ2NvZGVCbG9jaycsIHtcbiAgICAgICAgZmlsdGVyOiAobm9kZTogYW55KSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gbm9kZS5ub2RlTmFtZSA9PT0gJ1BSRScgJiYgbm9kZS5xdWVyeVNlbGVjdG9yKCdjb2RlJyk7XG4gICAgICAgIH0sXG4gICAgICAgIHJlcGxhY2VtZW50OiAoY29udGVudDogc3RyaW5nLCBub2RlOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvZGUgPSBub2RlLnF1ZXJ5U2VsZWN0b3IoJ2NvZGUnKTtcbiAgICAgICAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IGNvZGU/LmNsYXNzTmFtZSB8fCAnJztcblxuICAgICAgICAgICAgLy8gRGV0ZWN0IGxhbmd1YWdlIGZyb20gY2xhc3NcbiAgICAgICAgICAgIGxldCBsYW5nID0gJyc7XG4gICAgICAgICAgICBjb25zdCBsYW5nTWF0Y2ggPSBjbGFzc05hbWUubWF0Y2goL2xhbmd1YWdlLShcXHcrKXxsYW5nLShcXHcrKS8pO1xuICAgICAgICAgICAgaWYgKGxhbmdNYXRjaCkge1xuICAgICAgICAgICAgICAgIGxhbmcgPSBsYW5nTWF0Y2hbMV0gfHwgbGFuZ01hdGNoWzJdO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChjbGFzc05hbWUuaW5jbHVkZXMoJ3BocCcpKSB7XG4gICAgICAgICAgICAgICAgbGFuZyA9ICdwaHAnO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChjbGFzc05hbWUuaW5jbHVkZXMoJ2pzJykgfHwgY2xhc3NOYW1lLmluY2x1ZGVzKCdqYXZhc2NyaXB0JykpIHtcbiAgICAgICAgICAgICAgICBsYW5nID0gJ2phdmFzY3JpcHQnO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChjbGFzc05hbWUuaW5jbHVkZXMoJ2NzcycpKSB7XG4gICAgICAgICAgICAgICAgbGFuZyA9ICdjc3MnO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChjbGFzc05hbWUuaW5jbHVkZXMoJ2h0bWwnKSkge1xuICAgICAgICAgICAgICAgIGxhbmcgPSAnaHRtbCc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGNsYXNzTmFtZS5pbmNsdWRlcygnYmFzaCcpIHx8IGNsYXNzTmFtZS5pbmNsdWRlcygnc2hlbGwnKSkge1xuICAgICAgICAgICAgICAgIGxhbmcgPSAnYmFzaCc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSBjb2RlPy50ZXh0Q29udGVudCB8fCAnJztcbiAgICAgICAgICAgIHJldHVybiBgXFxuXFxgXFxgXFxgJHtsYW5nfVxcbiR7dGV4dH1cXG5cXGBcXGBcXGBcXG5gO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHVybmRvd247XG59Il19