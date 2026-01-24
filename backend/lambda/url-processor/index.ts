import { Handler } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as crypto from 'crypto';
import { ProgressPublisher } from './progress-publisher';

// Force rebuild - cache fix deployment with progress streaming

interface URLProcessorEvent {
    url: string;
    selectedModel: string;
    sessionId: string;
    analysisStartTime: number;
    contextAnalysis?: {
        enabled: boolean;
        maxContextPages?: number;
    };
    cacheControl?: {
        enabled: boolean;
    };
}

interface URLProcessorResponse {
    success: boolean;
    sessionId: string;
    message: string;
}

interface ProcessedContentIndex {
    url: string;
    contextualSetting: string;
    processedAt: string;
    contentHash: string;
    s3Location: string;
    ttl: number;
    contentType: string;
    noiseReductionMetrics: {
        originalSize: number;
        cleanedSize: number;
        reductionPercent: number;
    };
}

interface ContextPage {
    url: string;
    title: string;
    relationship: 'parent' | 'child' | 'sibling';
    confidence: number;
}

interface LinkIssue {
    url: string;
    status: number | string;
    anchorText: string;
    sourceLocation: string;
    errorMessage: string;
    issueType: '404' | 'error' | 'timeout' | 'access-denied';
}

interface DeprecatedCodeFinding {
    language: string;
    method: string;
    location: string;
    deprecatedIn: string;
    removedIn?: string;
    replacement: string;
    confidence: 'high' | 'medium' | 'low';
    codeFragment: string;
}

interface SyntaxErrorFinding {
    language: string;
    location: string;
    errorType: string;
    description: string;
    codeFragment: string;
    confidence: 'high' | 'medium' | 'low';
}

interface ContextAnalysisResult {
    contextPages: ContextPage[];
    analysisScope: 'single-page' | 'with-context';
    totalPagesAnalyzed: number;
}

interface UrlSlugIssue {
    segment: string;           // The problematic word
    fullPath: string;          // Where in the URL it appears
    suggestion: string;        // Recommended correction
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    editDistance: number;      // Levenshtein distance from suggestion
}

interface UrlSlugAnalysis {
    analyzedUrl: string;
    pathSegments: string[];
    issues: UrlSlugIssue[];
    overallStatus: 'clean' | 'issues-found';
}

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Generate consistent session ID based on URL and context setting
 * Same URL + context setting = same session ID = cache reuse
 */
function generateConsistentSessionId(url: string, contextualSetting: string): string {
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
function normalizeUrl(url: string): string {
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
    } catch (error) {
        console.warn('Failed to normalize URL, using original:', url);
        return url;
    }
}

/**
 * Technical terms allowlist - common abbreviations and tech terms that shouldn't be flagged as typos
 */
const TECH_TERMS_ALLOWLIST = [
    // Common abbreviations
    'api', 'cli', 'sdk', 'cdn', 'url', 'uri', 'sql', 'css', 'html', 'json', 'xml', 'yaml', 'jwt', 'oauth',
    // Dev shorthand
    'async', 'sync', 'auth', 'config', 'init', 'env', 'repo', 'src', 'dist', 'dev', 'prod', 'docs', 'utils',
    // Common tech terms
    'webhook', 'frontend', 'backend', 'middleware', 'microservice', 'kubernetes', 'nginx', 'redis',
    // Version/path segments to skip
    'v1', 'v2', 'v3', 'next', 'latest', 'beta', 'alpha', 'guides', 'guide', 'tutorial', 'tutorials',
    // File extensions and common path segments
    'html', 'htm', 'php', 'jsp', 'aspx', 'pdf', 'md', 'txt',
    // Common documentation terms
    'quickstart', 'getting', 'started', 'getstarted', 'intro', 'overview', 'faq', 'faqs'
];

/**
 * Common typos dictionary - maps misspelled words to correct spellings
 */
const COMMON_TYPOS: { [key: string]: string } = {
    'steteful': 'stateful',
    'configration': 'configuration',
    'authenication': 'authentication',
    'initalize': 'initialize',
    'asyncronous': 'asynchronous',
    'retreive': 'retrieve',
    'recieve': 'receive',
    'occured': 'occurred',
    'seperate': 'separate',
    'enviroment': 'environment',
    'persistance': 'persistence',
    'refrence': 'reference',
    'defintion': 'definition',
    'exection': 'execution',
    'implmentation': 'implementation',
    'documention': 'documentation',
    'compatiblity': 'compatibility',
    'availablity': 'availability',
    'performace': 'performance'
};

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Analyze URL slug quality for typos and misspellings
 */
function analyzeUrlSlugQuality(url: string): UrlSlugAnalysis {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;

        // Extract filename without extension
        const pathParts = pathname.split('/').filter(part => part.length > 0);
        const lastPart = pathParts[pathParts.length - 1] || '';
        const filenameWithoutExt = lastPart.replace(/\.(html?|php|jsp|aspx|pdf|md|txt)$/i, '');

        // Combine all path parts for analysis
        const allParts = [...pathParts.slice(0, -1), filenameWithoutExt].filter(p => p.length > 0);

        // Split by hyphens and underscores to get individual words
        const segments: string[] = [];
        allParts.forEach(part => {
            const words = part.split(/[-_]/);
            segments.push(...words);
        });

        // Filter out empty segments and normalize
        const normalizedSegments = segments
            .filter(seg => seg.length > 0)
            .map(seg => seg.toLowerCase());

        const issues: UrlSlugIssue[] = [];

        // Check each segment
        normalizedSegments.forEach(segment => {
            // Skip if in allowlist
            if (TECH_TERMS_ALLOWLIST.includes(segment)) {
                return;
            }

            // Skip very short segments (likely abbreviations)
            if (segment.length <= 2) {
                return;
            }

            // Skip numeric segments
            if (/^\d+$/.test(segment)) {
                return;
            }

            // Check against common typos
            if (COMMON_TYPOS[segment]) {
                const suggestion = COMMON_TYPOS[segment];
                const editDist = levenshteinDistance(segment, suggestion);

                issues.push({
                    segment,
                    fullPath: pathname,
                    suggestion,
                    confidence: 'HIGH',
                    editDistance: editDist
                });
            }
        });

        return {
            analyzedUrl: url,
            pathSegments: normalizedSegments,
            issues,
            overallStatus: issues.length > 0 ? 'issues-found' : 'clean'
        };
    } catch (error) {
        console.error('URL slug analysis failed:', error);
        return {
            analyzedUrl: url,
            pathSegments: [],
            issues: [],
            overallStatus: 'clean'
        };
    }
}

export const handler: Handler<URLProcessorEvent, URLProcessorResponse> = async (event) => {
    console.log('Processing URL:', event.url);

    // Initialize progress publisher
    const progress = new ProgressPublisher(event.sessionId);

    try {
        // Send initial progress
        await progress.progress('Processing URL...', 'url-processing');

        // NEW: Analyze URL slug quality early in the pipeline
        await progress.info('Analyzing URL slug quality...');
        const urlSlugAnalysis = analyzeUrlSlugQuality(event.url);

        if (urlSlugAnalysis.overallStatus === 'issues-found') {
            urlSlugAnalysis.issues.forEach(issue => {
                console.log(`⚠️ URL slug issue detected: '${issue.segment}' → '${issue.suggestion}' (confidence: ${issue.confidence})`);
            });
            await progress.info(`⚠️ Found ${urlSlugAnalysis.issues.length} URL slug issue(s)`);
        } else {
            console.log('✓ URL slug quality: No issues found');
        }

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
        } else {
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
        const dom = new JSDOM(htmlContent, { url: event.url });
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
        let linkValidationResult: { linkIssues: LinkIssue[], healthyLinks: number } = { linkIssues: [], healthyLinks: 0 };
        if (linkAnalysis.internalLinksForValidation && linkAnalysis.internalLinksForValidation.length > 0) {
            linkValidationResult = await validateInternalLinks(linkAnalysis.internalLinksForValidation, progress);
        }

        // NEW: Enhanced Code Analysis
        let enhancedCodeAnalysis: { deprecatedCode: DeprecatedCodeFinding[], syntaxErrors: SyntaxErrorFinding[] } = { deprecatedCode: [], syntaxErrors: [] };
        if (codeSnippets.length > 0) {
            enhancedCodeAnalysis = await analyzeCodeSnippetsEnhanced(codeSnippets, progress);
        }

        // Context Analysis (if enabled)
        let contextAnalysisResult: ContextAnalysisResult | null = null;
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
            urlSlugAnalysis, // NEW: Add URL slug analysis results
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
        (processedContent.linkAnalysis as any).brokenLinks = linkValidationResult.linkIssues.filter(link => link.issueType === '404').length;
        (processedContent.linkAnalysis as any).totalLinkIssues = linkValidationResult.linkIssues.length;

        // Store processed content in S3 session location
        const s3Key = `sessions/${event.sessionId}/processed-content.json`;
        const bucketName = process.env.ANALYSIS_BUCKET;

        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }

        await s3Client.send(new PutObjectCommand({
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
        } else {
            console.log('⚠️ Cache disabled - skipping cache storage');
        }

        // Return ONLY minimal success status - no data at all
        return {
            success: true,
            sessionId: event.sessionId,
            message: 'Content processed and cached'
        };

    } catch (error) {
        console.error('URL processing failed:', error);
        return {
            success: false,
            sessionId: event.sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

async function checkProcessedContentCache(url: string, contextualSetting: string): Promise<ProcessedContentIndex | null> {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping cache check');
            return null;
        }

        // Clean URL to normalize it (remove fragments, normalize query params)
        const cleanUrl = normalizeUrl(url);

        const response = await dynamoClient.send(new GetItemCommand({
            TableName: tableName,
            Key: marshall({
                url: cleanUrl,
                contextualSetting: contextualSetting
            })
        }));

        if (response.Item) {
            const cacheEntry = unmarshall(response.Item) as ProcessedContentIndex;
            console.log(`Cache entry found for ${cleanUrl} (context: ${contextualSetting}), processed at ${cacheEntry.processedAt}`);
            console.log(`Cache S3 location: ${cacheEntry.s3Location}`);
            return cacheEntry;
        }

        console.log(`No cache entry found for ${cleanUrl} (context: ${contextualSetting})`);
        return null;
    } catch (error) {
        console.error('Cache check failed:', error);
        return null; // Graceful degradation - continue without cache
    }
}

function isCacheExpired(cacheEntry: ProcessedContentIndex): boolean {
    const now = Math.floor(Date.now() / 1000);
    return cacheEntry.ttl < now;
}

async function copyCachedContentToSession(cacheS3Location: string, sessionId: string): Promise<void> {
    const bucketName = process.env.ANALYSIS_BUCKET;
    if (!bucketName) {
        throw new Error('ANALYSIS_BUCKET environment variable not set');
    }

    try {
        console.log(`Copying cached content from: ${cacheS3Location}`);

        // Get cached content from S3
        const cachedObject = await s3Client.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: cacheS3Location
        }));

        if (!cachedObject.Body) {
            throw new Error('Cached content body is empty');
        }

        const cachedContent = await cachedObject.Body.transformToString();

        // Store in session location
        const sessionKey = `sessions/${sessionId}/processed-content.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: sessionKey,
            Body: cachedContent,
            ContentType: 'application/json'
        }));

        console.log(`✅ Copied cached content from ${cacheS3Location} to session: ${sessionKey}`);
    } catch (error) {
        console.error('Failed to copy cached content:', error);
        throw error;
    }
}

async function storeSessionMetadata(event: URLProcessorEvent): Promise<void> {
    const bucketName = process.env.ANALYSIS_BUCKET;
    if (!bucketName) {
        throw new Error('ANALYSIS_BUCKET environment variable not set');
    }

    const metadataKey = `sessions/${event.sessionId}/metadata.json`;
    await s3Client.send(new PutObjectCommand({
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

async function addCacheMetadata(sessionId: string, wasFromCache: boolean): Promise<void> {
    const bucketName = process.env.ANALYSIS_BUCKET;
    if (!bucketName) {
        throw new Error('ANALYSIS_BUCKET environment variable not set');
    }

    try {
        // Read the existing processed content
        const contentKey = `sessions/${sessionId}/processed-content.json`;
        const contentResponse = await s3Client.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: contentKey
        }));

        const contentStr = await contentResponse.Body!.transformToString();
        const processedContent = JSON.parse(contentStr);

        // Add cache metadata
        processedContent.cacheMetadata = {
            wasFromCache,
            retrievedAt: new Date().toISOString()
        };

        // Write it back
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: contentKey,
            Body: JSON.stringify(processedContent),
            ContentType: 'application/json'
        }));

        console.log(`Added cache metadata: wasFromCache=${wasFromCache}`);
    } catch (error) {
        console.error('Failed to add cache metadata:', error);
        // Don't throw - this is not critical
    }
}

async function storeProcessedContentInCache(url: string, processedContent: any, contextualSetting: string): Promise<void> {
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
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: cacheS3Key,
            Body: JSON.stringify(processedContent),
            ContentType: 'application/json'
        }));

        // Calculate TTL (7 days from now)
        const ttlDays = parseInt(process.env.CACHE_TTL_DAYS || '7');
        const ttl = Math.floor(Date.now() / 1000) + (ttlDays * 24 * 60 * 60);

        // Store index entry in DynamoDB with proper columns
        const cacheIndex: ProcessedContentIndex = {
            url: cleanUrl,
            contextualSetting: contextualSetting,
            processedAt: new Date().toISOString(),
            contentHash: contentHash,
            s3Location: cacheS3Key,
            ttl: ttl,
            contentType: processedContent.contentType,
            noiseReductionMetrics: processedContent.noiseReduction
        };

        await dynamoClient.send(new PutItemCommand({
            TableName: tableName,
            Item: marshall(cacheIndex)
        }));

        console.log(`Stored cache index for ${cleanUrl} (context: ${contextualSetting}) with TTL ${ttl}`);
        console.log(`Cache S3 location: ${cacheS3Key}`);
    } catch (error) {
        console.error('Failed to store in cache:', error);
        // Don't throw - caching failure shouldn't break the main flow
    }
}

function extractMediaElements(document: Document, baseUrl: string) {
    const mediaElements: any[] = [];

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

function extractCodeSnippets(document: Document) {
    const codeSnippets: any[] = [];

    const codeBlocks = document.querySelectorAll('pre code, code');
    codeBlocks.forEach((codeElement, index) => {
        const code = codeElement.textContent || '';
        if (code.trim().length < 10) return; // Skip very short snippets

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
function isRelatedDomain(linkHostname: string, baseHostname: string): boolean {
    // Same hostname (already handled by caller, but included for completeness)
    if (linkHostname === baseHostname) {
        return true;
    }

    // Extract root domains
    const getRootDomain = (hostname: string): string => {
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

function analyzeLinkStructure(document: Document, baseUrl: string) {
    const links = document.querySelectorAll('a[href]');
    const baseUrlObj = new URL(baseUrl);

    let totalLinks = 0;
    let internalLinks = 0;
    let externalLinks = 0;
    const subPagesIdentified: string[] = [];
    const internalLinksForValidation: Array<{ url: string, anchorText: string, element: Element }> = [];

    links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;

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
            } else {
                externalLinks++;
            }
        } catch {
            externalLinks++;
        }
    });

    return {
        totalLinks,
        internalLinks,
        externalLinks,
        subPagesIdentified: subPagesIdentified.slice(0, 10),
        linkContext: subPagesIdentified.length > 0 ? 'multi-page-referenced' as const : 'single-page' as const,
        analysisScope: 'current-page-only' as 'current-page-only' | 'with-context', // Will be updated by context analysis if enabled
        internalLinksForValidation // NEW: Links to validate
    };
}

// NEW: Link validation function for internal and related domain links
async function validateInternalLinks(
    linksToValidate: Array<{ url: string, anchorText: string, element: Element }>,
    progress: ProgressPublisher
): Promise<{ linkIssues: LinkIssue[], healthyLinks: number }> {
    if (linksToValidate.length === 0) {
        return { linkIssues: [], healthyLinks: 0 };
    }

    // Deduplicate links by URL before validation to avoid redundant HTTP requests
    const uniqueLinksMap = new Map<string, { url: string, anchorText: string, element: Element }>();
    linksToValidate.forEach(link => {
        if (!uniqueLinksMap.has(link.url)) {
            uniqueLinksMap.set(link.url, link);
        }
    });
    const uniqueLinks = Array.from(uniqueLinksMap.values());

    await progress.info(`Checking ${uniqueLinks.length} unique internal and related domain links for accessibility...`);

    const linkIssues: LinkIssue[] = [];
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
                    const linkIssue: LinkIssue = {
                        url: linkInfo.url,
                        status: 404,
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Page not found',
                        issueType: '404'
                    };
                    linkIssues.push(linkIssue);

                    await progress.info(`⚠ Broken link (404): ${linkInfo.url}`);
                } else if (response.status === 403) {
                    const linkIssue: LinkIssue = {
                        url: linkInfo.url,
                        status: 403,
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Access denied (403 Forbidden)',
                        issueType: 'access-denied'
                    };
                    linkIssues.push(linkIssue);

                    await progress.info(`⚠ Link issue (403): ${linkInfo.url}`);
                } else if (response.status >= 400) {
                    const linkIssue: LinkIssue = {
                        url: linkInfo.url,
                        status: response.status,
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
                        issueType: 'error'
                    };
                    linkIssues.push(linkIssue);

                    await progress.info(`⚠ Link issue (${response.status}): ${linkInfo.url}`);
                } else {
                    healthyLinks++;
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    const linkIssue: LinkIssue = {
                        url: linkInfo.url,
                        status: 'timeout',
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Request timeout (>5 seconds)',
                        issueType: 'timeout'
                    };
                    linkIssues.push(linkIssue);

                    await progress.info(`⚠ Link timeout: ${linkInfo.url}`);
                } else {
                    const linkIssue: LinkIssue = {
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
    const uniqueLinkIssuesMap = new Map<string, LinkIssue>();
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
    } else if (totalIssuesCount > 0) {
        await progress.success(`✓ Link check complete: ${brokenLinksCount} broken (404), ${totalIssuesCount - brokenLinksCount} other issues, ${healthyLinks} healthy`);
    } else {
        await progress.success(`✓ Link check complete: All ${healthyLinks} links healthy`);
    }

    return { linkIssues: uniqueLinkIssues, healthyLinks };
}

// NEW: Enhanced Code Analysis function
async function analyzeCodeSnippetsEnhanced(
    codeSnippets: any[],
    progress: ProgressPublisher
): Promise<{ deprecatedCode: DeprecatedCodeFinding[], syntaxErrors: SyntaxErrorFinding[] }> {
    if (codeSnippets.length === 0) {
        return { deprecatedCode: [], syntaxErrors: [] };
    }

    await progress.info(`Analyzing ${codeSnippets.length} code snippets for deprecation and syntax issues...`);

    const deprecatedCode: DeprecatedCodeFinding[] = [];
    const syntaxErrors: SyntaxErrorFinding[] = [];

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

            } catch (error) {
                console.error(`Failed to analyze code snippet ${i + 1}:`, error);
                // Continue with other snippets
            }
        }
    }

    await progress.success(`✓ Code analysis complete: ${deprecatedCode.length} deprecated, ${syntaxErrors.length} syntax errors`);

    return { deprecatedCode, syntaxErrors };
}

// Helper function to check if code is too simple to analyze
function isSimpleCode(code: string): boolean {
    const trimmed = code.trim();

    // Skip single-line comments or very short snippets
    if (trimmed.length < 20) return true;

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
async function analyzeCodeSnippetWithLLM(
    snippet: any,
    blockNumber: number
): Promise<{ deprecatedCode: DeprecatedCodeFinding[], syntaxErrors: SyntaxErrorFinding[] }> {
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
        const command = new InvokeModelCommand({
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
        const deprecatedCode: DeprecatedCodeFinding[] = (analysisResult.deprecatedCode || []).map((item: any) => ({
            language: item.language || snippet.language || 'unknown',
            method: item.method || 'unknown',
            location: item.location || `code block ${blockNumber}`,
            deprecatedIn: item.deprecatedIn || 'unknown version',
            removedIn: item.removedIn,
            replacement: item.replacement || 'see documentation',
            confidence: item.confidence || 'medium',
            codeFragment: item.codeFragment || item.method || ''
        }));

        const syntaxErrors: SyntaxErrorFinding[] = (analysisResult.syntaxErrors || []).map((item: any) => ({
            language: item.language || snippet.language || 'unknown',
            location: item.location || `code block ${blockNumber}`,
            errorType: item.errorType || 'SyntaxError',
            description: item.description || 'syntax error detected',
            codeFragment: item.codeFragment || '',
            confidence: item.confidence || 'medium'
        }));

        return { deprecatedCode, syntaxErrors };

    } catch (error) {
        console.error('LLM code analysis failed:', error);
        return { deprecatedCode: [], syntaxErrors: [] };
    }
}

function discoverContextPages(document: Document, baseUrl: string): ContextPage[] {
    const contextPages: ContextPage[] = [];
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
    const childPages = new Map<string, string>();

    links.forEach(link => {
        const href = link.getAttribute('href');
        const linkText = link.textContent?.trim();

        if (!href || !linkText) return;

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
        } catch {
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
    const uniquePages = contextPages.filter((page, index, self) =>
        index === self.findIndex(p => p.url === page.url)
    );

    return uniquePages.slice(0, 5); // Max 5 context pages
}

type DocumentationType =
    | 'api-reference'      // Function/class docs, needs code
    | 'tutorial'           // Step-by-step guide, needs code
    | 'conceptual'         // Explains concepts, may not need code
    | 'how-to'             // Task-focused, usually needs code
    | 'reference'          // Tables, lists, specs
    | 'troubleshooting'    // Problem/solution format
    | 'overview'           // High-level intro, rarely needs code
    | 'changelog'          // Version history
    | 'mixed';             // Combination

// Layer 1: Fast keyword matching (90% of cases, free)
function detectByKeywords(url: string, title: string): DocumentationType | null {
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
async function detectByAI(url: string, title: string, description?: string): Promise<DocumentationType> {
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
        const command = new InvokeModelCommand({
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
        const validTypes: DocumentationType[] = [
            'api-reference', 'tutorial', 'conceptual', 'how-to',
            'overview', 'reference', 'troubleshooting', 'changelog', 'mixed'
        ];

        if (validTypes.includes(aiResponse as DocumentationType)) {
            return aiResponse as DocumentationType;
        } else {
            console.log(`⚠️ Invalid AI response, defaulting to mixed`);
            return 'mixed';
        }

    } catch (error) {
        console.error('AI content type detection failed:', error);
        return 'mixed'; // Fallback to mixed on error
    }
}

// Complete detection with caching
async function detectContentTypeEnhanced(
    document: Document,
    markdownContent: string,
    url: string
): Promise<DocumentationType> {

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
function detectContentType(document: Document, markdownContent: string): string {
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

function detectLanguageFromClass(className: string): string {
    const langMatch = className.match(/(?:lang-|language-)([a-zA-Z0-9]+)/);
    if (langMatch) {
        return langMatch[1].toLowerCase();
    }

    if (className.includes('php')) return 'php';
    if (className.includes('js') || className.includes('javascript')) return 'javascript';
    if (className.includes('css')) return 'css';
    if (className.includes('html')) return 'html';

    return '';
}

function detectLanguageFromContent(code: string): string {
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

function checkForVersionInfo(code: string): boolean {
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
function removeNoiseElements(document: Document): number {
    const noiseSelectors = [
        // Scripts and styles (CRITICAL for removing CSS/JS noise!)
        'script', 'style', 'noscript', 'link[rel="stylesheet"]',

        // Navigation and UI chrome
        'nav', 'header', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',

        // Platform specific noise
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

        // Common admin and edit links
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
        } catch (e) {
            console.log(`Error with selector ${selector}:`, e instanceof Error ? e.message : String(e));
        }
    });

    return removedCount;
}

/**
 * Extract main content with better content detection
 */
function extractMainContent(document: Document): Element {
    // Strategy 1: Specific content containers
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
function configureTurndownService(): TurndownService {
    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
    });

    // Add GitHub Flavored Markdown support (tables, strikethrough, etc.)
    turndown.use(gfm);

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

    // Custom rule for platform callouts/notices
    turndown.addRule('callout', {
        filter: (node: any) => {
            return node.nodeName === 'DIV' &&
                /notice|warning|info|tip|alert/.test(node.className || '');
        },
        replacement: (content: string, node: any) => {
            const className = node.className || '';
            let type = 'Note';
            if (/warning|caution/.test(className)) type = 'Warning';
            if (/info|note/.test(className)) type = 'Note';
            if (/tip|hint/.test(className)) type = 'Tip';
            if (/error|danger/.test(className)) type = 'Error';
            return `\n> **${type}:** ${content.trim()}\n`;
        }
    });

    // Enhanced code block handling with language detection
    turndown.addRule('codeBlock', {
        filter: (node: any) => {
            return node.nodeName === 'PRE' && node.querySelector('code');
        },
        replacement: (content: string, node: any) => {
            const code = node.querySelector('code');
            const className = code?.className || '';

            // Detect language from class
            let lang = '';
            const langMatch = className.match(/language-(\w+)|lang-(\w+)/);
            if (langMatch) {
                lang = langMatch[1] || langMatch[2];
            } else if (className.includes('php')) {
                lang = 'php';
            } else if (className.includes('js') || className.includes('javascript')) {
                lang = 'javascript';
            } else if (className.includes('css')) {
                lang = 'css';
            } else if (className.includes('html')) {
                lang = 'html';
            } else if (className.includes('bash') || className.includes('shell')) {
                lang = 'bash';
            }

            const text = code?.textContent || '';
            return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
        }
    });

    return turndown;
}