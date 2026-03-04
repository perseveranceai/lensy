import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as crypto from 'crypto';

import { writeSessionArtifact, readSessionArtifact, writeToS3, readFromS3, ANALYSIS_BUCKET } from '../shared/s3-helpers';
import { invokeBedrockModel, getModelId } from '../shared/bedrock-helpers';
import { createProgressHelper } from './publish-progress';
import { deriveSafeDomain, queryKB, writePageToKB, summarizeAndParsePage, type KBPageEntry, type PageSummary } from '../shared/page-summarizer';

/**
 * Tool 2: Process URL
 * Ported from: url-processor/index.ts (1791 lines)
 *
 * Fetches a URL, strips HTML noise, converts to Markdown via Turndown,
 * validates internal links, extracts code snippets with LLM-based
 * deprecation/syntax analysis, extracts media elements, discovers
 * context pages (parent/child/sibling), detects content type,
 * analyzes URL slug quality with Levenshtein distance, and caches
 * results in DynamoDB with a 7-day TTL.
 *
 * Stores the full processed content artifact at:
 *   sessions/${sessionId}/processed-content.json
 */

// ─── Module-level clients ────────────────────────────────────
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

// ─── Interfaces ──────────────────────────────────────────────

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
    // KB enrichment fields (populated from DynamoDB Page Knowledge Base)
    documentationType?: string;
    topic?: string;
    covers?: string[];
    codeExamples?: string;
    keyTerms?: string[];
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
    segment: string;
    fullPath: string;
    suggestion: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    editDistance: number;
}

interface UrlSlugAnalysis {
    analyzedUrl: string;
    pathSegments: string[];
    issues: UrlSlugIssue[];
    overallStatus: 'clean' | 'issues-found';
}

type DocumentationType =
    | 'api-reference'
    | 'tutorial'
    | 'conceptual'
    | 'how-to'
    | 'reference'
    | 'troubleshooting'
    | 'overview'
    | 'changelog'
    | 'mixed'
    | 'blog-post'
    | 'landing-page'
    | 'marketing-page'
    | 'non-documentation';

// ─── Technical terms allowlist ───────────────────────────────
const TECH_TERMS_ALLOWLIST = [
    'api', 'cli', 'sdk', 'cdn', 'url', 'uri', 'sql', 'css', 'html', 'json', 'xml', 'yaml', 'jwt', 'oauth',
    'async', 'sync', 'auth', 'config', 'init', 'env', 'repo', 'src', 'dist', 'dev', 'prod', 'docs', 'utils',
    'webhook', 'frontend', 'backend', 'middleware', 'microservice', 'kubernetes', 'nginx', 'redis',
    'v1', 'v2', 'v3', 'next', 'latest', 'beta', 'alpha', 'guides', 'guide', 'tutorial', 'tutorials',
    'html', 'htm', 'php', 'jsp', 'aspx', 'pdf', 'md', 'txt',
    'quickstart', 'getting', 'started', 'getstarted', 'intro', 'overview', 'faq', 'faqs'
];

// ─── Common typos dictionary ─────────────────────────────────
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

// ─── Pure helper functions ───────────────────────────────────

/**
 * Normalize URL to ensure consistent caching.
 * - Remove fragments (#section)
 * - Sort query parameters
 * - Remove trailing slashes
 * - Lowercase hostname
 */
function normalizeUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        urlObj.hash = '';

        const params = new URLSearchParams(urlObj.search);
        const sortedParams = new URLSearchParams();
        Array.from(params.keys()).sort().forEach(key => {
            sortedParams.set(key, params.get(key) || '');
        });
        urlObj.search = sortedParams.toString();

        if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }

        urlObj.hostname = urlObj.hostname.toLowerCase();
        return urlObj.toString();
    } catch {
        console.warn('Failed to normalize URL, using original:', url);
        return url;
    }
}

/**
 * Generate consistent session ID based on URL and context setting.
 * Same URL + context setting = same session ID = cache reuse.
 */
function generateConsistentSessionId(url: string, contextualSetting: string): string {
    const normalizedUrl = normalizeUrl(url);
    const input = `${normalizedUrl}#${contextualSetting}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `session-${hash.substring(0, 12)}`;
}

/**
 * Calculate Levenshtein distance between two strings.
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
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Analyze URL slug quality for typos and misspellings.
 */
function analyzeUrlSlugQuality(url: string): UrlSlugAnalysis {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;

        const pathParts = pathname.split('/').filter(part => part.length > 0);
        const lastPart = pathParts[pathParts.length - 1] || '';
        const filenameWithoutExt = lastPart.replace(/\.(html?|php|jsp|aspx|pdf|md|txt)$/i, '');

        const allParts = [...pathParts.slice(0, -1), filenameWithoutExt].filter(p => p.length > 0);

        const segments: string[] = [];
        allParts.forEach(part => {
            const words = part.split(/[-_]/);
            segments.push(...words);
        });

        const normalizedSegments = segments
            .filter(seg => seg.length > 0)
            .map(seg => seg.toLowerCase());

        const issues: UrlSlugIssue[] = [];

        normalizedSegments.forEach(segment => {
            if (TECH_TERMS_ALLOWLIST.includes(segment)) return;
            if (segment.length <= 2) return;
            if (/^\d+$/.test(segment)) return;

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

// ─── DynamoDB cache helpers ──────────────────────────────────

async function checkProcessedContentCache(url: string, contextualSetting: string): Promise<ProcessedContentIndex | null> {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping cache check');
            return null;
        }

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
        return null;
    }
}

function isCacheExpired(cacheEntry: ProcessedContentIndex): boolean {
    const now = Math.floor(Date.now() / 1000);
    return cacheEntry.ttl < now;
}

async function copyCachedContentToSession(cacheS3Location: string, sessionId: string): Promise<void> {
    const bucketName = ANALYSIS_BUCKET;
    if (!bucketName) throw new Error('ANALYSIS_BUCKET environment variable not set');

    console.log(`Copying cached content from: ${cacheS3Location}`);
    const cached = await readFromS3<any>(bucketName, cacheS3Location);
    if (!cached) throw new Error('Cached content body is empty');

    await writeToS3(bucketName, `sessions/${sessionId}/processed-content.json`, cached);
    console.log(`Copied cached content from ${cacheS3Location} to session: sessions/${sessionId}/processed-content.json`);
}

async function storeSessionMetadata(sessionId: string, url: string, selectedModel: string): Promise<void> {
    await writeSessionArtifact(sessionId, 'metadata.json', {
        url,
        selectedModel,
        sessionId,
        startTime: Date.now()
    });
    console.log(`Stored session metadata in S3`);
}

async function addCacheMetadata(sessionId: string, wasFromCache: boolean): Promise<void> {
    try {
        const processedContent = await readSessionArtifact<any>(sessionId, 'processed-content.json');
        if (!processedContent) return;

        processedContent.cacheMetadata = {
            wasFromCache,
            retrievedAt: new Date().toISOString()
        };

        await writeSessionArtifact(sessionId, 'processed-content.json', processedContent);
        console.log(`Added cache metadata: wasFromCache=${wasFromCache}`);
    } catch (error) {
        console.error('Failed to add cache metadata:', error);
    }
}

async function storeProcessedContentInCache(url: string, processedContent: any, contextualSetting: string): Promise<void> {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        const bucketName = ANALYSIS_BUCKET;

        if (!tableName || !bucketName) {
            console.log('Cache not configured, skipping cache storage');
            return;
        }

        const contentHash = crypto.createHash('sha256')
            .update(processedContent.markdownContent)
            .digest('hex');

        const cleanUrl = normalizeUrl(url);
        const consistentSessionId = generateConsistentSessionId(url, contextualSetting);

        const cacheS3Key = `sessions/${consistentSessionId}/processed-content.json`;
        await writeToS3(bucketName, cacheS3Key, processedContent);

        const ttlDays = parseInt(process.env.CACHE_TTL_DAYS || '7');
        const ttl = Math.floor(Date.now() / 1000) + (ttlDays * 24 * 60 * 60);

        const cacheIndex: ProcessedContentIndex = {
            url: cleanUrl,
            contextualSetting,
            processedAt: new Date().toISOString(),
            contentHash,
            s3Location: cacheS3Key,
            ttl,
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
    }
}

// ─── HTML extraction helpers ─────────────────────────────────

function extractMediaElements(document: Document, baseUrl: string): any[] {
    const mediaElements: any[] = [];

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

    const videos = document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]');
    videos.forEach(video => {
        const src = video.getAttribute('src') || '';
        mediaElements.push({
            type: 'video',
            src,
            analysisNote: 'Video content - consider accessibility and loading impact'
        });
    });

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

function extractCodeSnippets(document: Document): any[] {
    const codeSnippets: any[] = [];

    const codeBlocks = document.querySelectorAll('pre code, code');
    codeBlocks.forEach((codeElement, index) => {
        const code = codeElement.textContent || '';
        if (code.trim().length < 10) return;

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

function detectLanguageFromClass(className: string): string {
    const langMatch = className.match(/(?:lang-|language-)([a-zA-Z0-9]+)/);
    if (langMatch) return langMatch[1].toLowerCase();

    if (className.includes('php')) return 'php';
    if (className.includes('js') || className.includes('javascript')) return 'javascript';
    if (className.includes('css')) return 'css';
    if (className.includes('html')) return 'html';

    return '';
}

function detectLanguageFromContent(code: string): string {
    if (code.includes('<?php') || code.includes('->')) return 'php';
    if (code.includes('function') || code.includes('const ') || code.includes('=>')) return 'javascript';
    if (code.includes('{') && code.includes(':') && code.includes(';')) return 'css';
    if (code.includes('<') && code.includes('>')) return 'html';
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

// ─── Related-domain detection ────────────────────────────────

function isRelatedDomain(linkHostname: string, baseHostname: string): boolean {
    if (linkHostname === baseHostname) return true;

    const getRootDomain = (hostname: string): string => {
        const parts = hostname.split('.');
        if (parts.length >= 2) return parts.slice(-2).join('.');
        return hostname;
    };

    const linkRoot = getRootDomain(linkHostname);
    const baseRoot = getRootDomain(baseHostname);

    if (linkRoot === baseRoot) return true;

    const crossDomainPatterns = [
        ['x.com', 'twitter.com'],
        ['github.com', 'github.io', 'githubapp.com'],
        ['google.com', 'googleapis.com', 'googleusercontent.com', 'gstatic.com'],
        ['amazon.com', 'amazonaws.com', 'awsstatic.com'],
        ['microsoft.com', 'microsoftonline.com', 'azure.com', 'office.com'],
        ['facebook.com', 'fbcdn.net', 'instagram.com'],
        ['atlassian.com', 'atlassian.net', 'bitbucket.org'],
        ['salesforce.com', 'force.com', 'herokuapp.com']
    ];

    for (const pattern of crossDomainPatterns) {
        if (pattern.includes(linkRoot) && pattern.includes(baseRoot)) return true;
    }

    return false;
}

// ─── Link analysis ───────────────────────────────────────────

function analyzeLinkStructure(document: Document, baseUrl: string) {
    const links = document.querySelectorAll('a[href]');
    const baseUrlObj = new URL(baseUrl);

    let totalLinks = 0;
    let internalLinks = 0;
    let externalLinks = 0;
    const subPagesIdentified: string[] = [];
    const internalLinksForValidation: Array<{ url: string; anchorText: string; element: Element }> = [];

    links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;

        if (href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('javascript:') ||
            href.startsWith('#')) {
            return;
        }

        totalLinks++;

        try {
            const linkUrl = new URL(href, baseUrl);
            const isInternalLink = linkUrl.hostname === baseUrlObj.hostname;
            const isRelatedDomainLink = isRelatedDomain(linkUrl.hostname, baseUrlObj.hostname);

            if (isInternalLink || isRelatedDomainLink) {
                internalLinks++;

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
        analysisScope: 'current-page-only' as 'current-page-only' | 'with-context',
        internalLinksForValidation
    };
}

// ─── Link validation ─────────────────────────────────────────

/**
 * Retry a link check with GET when HEAD fails.
 * Some servers block HEAD requests or return errors for them.
 */
async function retryWithGet(url: string, timeout: number): Promise<{
    ok: boolean;
    status?: number;
    statusText?: string;
    timedOut?: boolean;
    errorMessage?: string;
}> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'Lensy Documentation Quality Auditor/1.0' },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status < 400) {
            return { ok: true };
        }
        return { ok: false, status: response.status, statusText: response.statusText };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return { ok: false, timedOut: true };
        }
        return { ok: false, errorMessage: error instanceof Error ? error.message : 'Unknown error' };
    }
}

async function validateInternalLinks(
    linksToValidate: Array<{ url: string; anchorText: string; element: Element }>,
    progress: ReturnType<typeof createProgressHelper>
): Promise<{ linkIssues: LinkIssue[]; healthyLinks: number }> {
    if (linksToValidate.length === 0) return { linkIssues: [], healthyLinks: 0 };

    const uniqueLinksMap = new Map<string, { url: string; anchorText: string; element: Element }>();
    linksToValidate.forEach(link => {
        if (!uniqueLinksMap.has(link.url)) uniqueLinksMap.set(link.url, link);
    });
    const uniqueLinks = Array.from(uniqueLinksMap.values());

    await progress.info(`Checking ${uniqueLinks.length} unique internal and related domain links for accessibility...`);

    const linkIssues: LinkIssue[] = [];
    let healthyLinks = 0;
    const maxConcurrent = 10;
    const timeout = 10000; // 10s timeout (increased from 5s to reduce false positives)

    for (let i = 0; i < uniqueLinks.length; i += maxConcurrent) {
        const batch = uniqueLinks.slice(i, i + maxConcurrent);

        const promises = batch.map(async (linkInfo) => {
            try {
                // Step 1: Try HEAD request first (fast, low bandwidth)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch(linkInfo.url, {
                    method: 'HEAD',
                    headers: { 'User-Agent': 'Lensy Documentation Quality Auditor/1.0' },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.status === 404) {
                    // 404 from HEAD is definitive — no retry needed
                    linkIssues.push({
                        url: linkInfo.url,
                        status: 404,
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Page not found',
                        issueType: '404'
                    });
                    await progress.info(`Warning: Broken link (404): ${linkInfo.url}`);
                } else if (response.status >= 400) {
                    // Non-404 error from HEAD — some servers block HEAD requests.
                    // Retry with GET before reporting as an issue.
                    const getResult = await retryWithGet(linkInfo.url, timeout);
                    if (getResult.ok) {
                        healthyLinks++;
                    } else {
                        const issueType = (getResult.status === 401 || getResult.status === 403) ? 'access-denied' : 'error';
                        const errorMessage = (getResult.status === 401 || getResult.status === 403)
                            ? `Access denied (${getResult.status} ${getResult.status === 401 ? 'Unauthorized' : 'Forbidden'})`
                            : `HTTP ${getResult.status}: ${getResult.statusText}`;
                        linkIssues.push({
                            url: linkInfo.url,
                            status: getResult.status,
                            anchorText: linkInfo.anchorText,
                            sourceLocation: 'main page',
                            errorMessage,
                            issueType
                        });
                        await progress.info(`Warning: Link issue (${getResult.status}): ${linkInfo.url}`);
                    }
                } else {
                    healthyLinks++;
                }
            } catch (error) {
                // HEAD failed (timeout or network error) — retry with GET
                const getResult = await retryWithGet(linkInfo.url, timeout);
                if (getResult.ok) {
                    healthyLinks++;
                } else if (getResult.timedOut) {
                    linkIssues.push({
                        url: linkInfo.url,
                        status: 'timeout',
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: 'Request timeout (HEAD + GET both timed out after 10s)',
                        issueType: 'timeout'
                    });
                    await progress.info(`Warning: Link timeout: ${linkInfo.url}`);
                } else {
                    linkIssues.push({
                        url: linkInfo.url,
                        status: getResult.status || 'error',
                        anchorText: linkInfo.anchorText,
                        sourceLocation: 'main page',
                        errorMessage: getResult.errorMessage || 'Unknown error',
                        issueType: 'error'
                    });
                    await progress.info(`Warning: Link error: ${linkInfo.url} (${getResult.errorMessage || 'Unknown error'})`);
                }
            }
        });

        await Promise.all(promises);
    }

    // Deduplicate link issues by URL
    const uniqueLinkIssuesMap = new Map<string, LinkIssue>();
    linkIssues.forEach(link => {
        if (!uniqueLinkIssuesMap.has(link.url)) uniqueLinkIssuesMap.set(link.url, link);
    });
    const uniqueLinkIssues = Array.from(uniqueLinkIssuesMap.values());

    const brokenLinksCount = uniqueLinkIssues.filter(link => link.issueType === '404').length;
    const totalIssuesCount = uniqueLinkIssues.length;

    if (brokenLinksCount > 0 && brokenLinksCount === totalIssuesCount) {
        await progress.success(`Link check complete: ${brokenLinksCount} broken (404), ${healthyLinks} healthy`);
    } else if (totalIssuesCount > 0) {
        await progress.success(`Link check complete: ${brokenLinksCount} broken (404), ${totalIssuesCount - brokenLinksCount} other issues, ${healthyLinks} healthy`);
    } else {
        await progress.success(`Link check complete: All ${healthyLinks} links healthy`);
    }

    return { linkIssues: uniqueLinkIssues, healthyLinks };
}

// ─── Enhanced code analysis ──────────────────────────────────

function isSimpleCode(code: string): boolean {
    const trimmed = code.trim();
    if (trimmed.length < 20) return true;
    if (trimmed.includes('{') && trimmed.includes(':') && trimmed.includes(';') && !trimmed.includes('function')) return true;
    if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.split('\n').length < 3) return true;
    if (trimmed.includes('=') && !trimmed.includes('function') && !trimmed.includes('class') && trimmed.split('\n').length < 5) return true;
    return false;
}

async function analyzeCodeSnippetWithLLM(
    snippet: any,
    blockNumber: number
): Promise<{ deprecatedCode: DeprecatedCodeFinding[]; syntaxErrors: SyntaxErrorFinding[] }> {
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
        const aiResponse = await invokeBedrockModel(prompt, {
            maxTokens: 1000,
            temperature: 0.1
        });

        // Try to extract JSON from markdown code block
        const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonString = jsonMatch ? jsonMatch[1].trim() : aiResponse.trim();
        const analysisResult = JSON.parse(jsonString);

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

async function analyzeCodeSnippetsEnhanced(
    codeSnippets: any[],
    progress: ReturnType<typeof createProgressHelper>
): Promise<{ deprecatedCode: DeprecatedCodeFinding[]; syntaxErrors: SyntaxErrorFinding[] }> {
    if (codeSnippets.length === 0) return { deprecatedCode: [], syntaxErrors: [] };

    await progress.info(`Analyzing ${codeSnippets.length} code snippets for deprecation and syntax issues...`);

    const deprecatedCode: DeprecatedCodeFinding[] = [];
    const syntaxErrors: SyntaxErrorFinding[] = [];

    const batchSize = 3;
    for (let i = 0; i < codeSnippets.length; i += batchSize) {
        const batch = codeSnippets.slice(i, i + batchSize);

        for (const snippet of batch) {
            try {
                if (snippet.code.trim().length < 20 || isSimpleCode(snippet.code)) continue;

                const analysis = await analyzeCodeSnippetWithLLM(snippet, i + 1);

                if (analysis.deprecatedCode.length > 0) {
                    deprecatedCode.push(...analysis.deprecatedCode);
                    for (const deprecated of analysis.deprecatedCode) {
                        await progress.info(`Warning: Deprecated: ${deprecated.method} in code block ${i + 1}`);
                    }
                }

                if (analysis.syntaxErrors.length > 0) {
                    syntaxErrors.push(...analysis.syntaxErrors);
                    for (const err of analysis.syntaxErrors) {
                        await progress.info(`Error: Syntax error: ${err.description} in code block ${i + 1}`);
                    }
                }
            } catch (error) {
                console.error(`Failed to analyze code snippet ${i + 1}:`, error);
            }
        }
    }

    await progress.success(`Code analysis complete: ${deprecatedCode.length} deprecated, ${syntaxErrors.length} syntax errors`);
    return { deprecatedCode, syntaxErrors };
}

// ─── Context page discovery ──────────────────────────────────

function discoverContextPages(document: Document, baseUrl: string): ContextPage[] {
    const contextPages: ContextPage[] = [];
    const baseUrlObj = new URL(baseUrl);
    const pathSegments = baseUrlObj.pathname.split('/').filter(Boolean);

    // Find parent page (one level up)
    if (pathSegments.length > 1) {
        const parentPath = '/' + pathSegments.slice(0, -1).join('/') + '/';
        const parentUrl = `${baseUrlObj.protocol}//${baseUrlObj.hostname}${parentPath}`;

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

            if (linkUrl.hostname === baseUrlObj.hostname &&
                linkUrl.pathname.startsWith(baseUrlObj.pathname) &&
                linkUrl.pathname !== baseUrlObj.pathname) {
                if (!childPages.has(linkUrl.href) && linkUrl.pathname.length < 200) {
                    childPages.set(linkUrl.href, linkText);
                }
            }
        } catch {
            // Invalid URL, skip
        }
    });

    Array.from(childPages.entries()).slice(0, 3).forEach(([url, title]) => {
        contextPages.push({
            url,
            title,
            relationship: 'child',
            confidence: 0.7
        });
    });

    const uniquePages = contextPages.filter((page, index, self) =>
        index === self.findIndex(p => p.url === page.url)
    );

    return uniquePages.slice(0, 5);
}

// ─── Content validation gate ────────────────────────────────

function validateContentReadability(markdown: string, url: string): { valid: boolean; reason?: string } {
    const trimmed = markdown.trim();

    if (trimmed.length < 100) {
        return {
            valid: false,
            reason: `Insufficient content extracted (${trimmed.length} characters). The page may require JavaScript rendering, authentication, or may be empty. Lensy uses static HTML fetching and cannot process SPAs, Google Docs, or auth-walled pages.`
        };
    }

    const loadingPatterns = /^(loading|please wait|styles are loading|initializing|redirecting|just a moment|checking your browser|enable javascript)/i;
    if (loadingPatterns.test(trimmed)) {
        return {
            valid: false,
            reason: 'Page appears to be a JavaScript-rendered application. Only the loading state was captured. Lensy requires server-rendered HTML content.'
        };
    }

    return { valid: true };
}

// ─── Non-documentation URL patterns ─────────────────────────

const NON_DOC_URL_PATTERNS = [
    '/blog/', '/news/', '/press/', '/about/', '/pricing/',
    '/careers/', '/contact/', '/signup/', '/login/', '/checkout/',
    '/cart/', '/landing/', '/campaign/', '/newsletter/',
    '/events/', '/webinar/', '/podcast/', '/community/',
    '/forum/', '/support/tickets/', '/store/', '/shop/',
];

function isNonDocumentationUrl(url: string): boolean {
    const urlLower = url.toLowerCase();
    return NON_DOC_URL_PATTERNS.some(p => urlLower.includes(p));
}

// ─── Content type detection ──────────────────────────────────

function detectByKeywords(url: string, title: string): DocumentationType | null {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    const searchText = `${urlLower} ${titleLower}`;

    console.log(`Keyword detection for: ${url}`);
    console.log(`Title: ${title}`);

    // ── Negative patterns first — block non-documentation URLs ──
    if (isNonDocumentationUrl(url)) {
        console.log(`Keyword match: non-documentation (negative URL pattern)`);
        return 'non-documentation';
    }

    if (searchText.includes('/reference/functions/') ||
        searchText.includes('/reference/classes/') ||
        searchText.includes('/reference/hooks/') ||
        titleLower.includes('()') ||
        titleLower.includes('function') ||
        titleLower.includes('hook')) {
        console.log(`Keyword match: api-reference`);
        return 'api-reference';
    }

    if (searchText.includes('getting-started') ||
        searchText.includes('/tutorial') ||
        titleLower.includes('tutorial') ||
        titleLower.includes('getting started')) {
        console.log(`Keyword match: tutorial`);
        return 'tutorial';
    }

    if (searchText.includes('/explanations/') ||
        searchText.includes('/architecture/') ||
        titleLower.includes('architecture') ||
        titleLower.includes('understanding') ||
        titleLower.includes('explanation')) {
        console.log(`Keyword match: conceptual`);
        return 'conceptual';
    }

    if (searchText.includes('how-to') ||
        searchText.includes('/guides/') ||
        titleLower.includes('how to') ||
        titleLower.includes('create')) {
        console.log(`Keyword match: how-to`);
        return 'how-to';
    }

    if (searchText.includes('/intro') ||
        searchText.includes('introduction') ||
        titleLower.includes('introduction') ||
        titleLower.includes('intro')) {
        console.log(`Keyword match: overview`);
        return 'overview';
    }

    if (searchText.includes('/reference-guides/') ||
        searchText.includes('/reference/') ||
        titleLower.includes('reference')) {
        console.log(`Keyword match: reference`);
        return 'reference';
    }

    if (searchText.includes('/troubleshooting/') ||
        searchText.includes('/faq/') ||
        titleLower.includes('troubleshoot') ||
        titleLower.includes('faq')) {
        console.log(`Keyword match: troubleshooting`);
        return 'troubleshooting';
    }

    if (searchText.includes('/changelog/') ||
        searchText.includes('/releases/') ||
        titleLower.includes('changelog') ||
        titleLower.includes('release')) {
        console.log(`Keyword match: changelog`);
        return 'changelog';
    }

    console.log(`No keyword match found`);
    return null;
}

async function detectByAI(url: string, title: string, description?: string): Promise<DocumentationType> {
    console.log(`Using AI fallback for content type detection`);

    const prompt = `Classify this page type based on URL and metadata:

URL: ${url}
Title: ${title}
Description: ${description || 'N/A'}

Classify as ONE of these types:
DOCUMENTATION TYPES:
- api-reference: Function/class documentation with parameters and return values
- tutorial: Step-by-step learning guide or getting started content
- conceptual: Architecture explanations, theory, or understanding concepts
- how-to: Task-focused guides for accomplishing specific goals
- overview: High-level introductions or summary pages
- reference: Tables, lists, specifications, or reference materials
- troubleshooting: Problem/solution format or FAQ content
- changelog: Version history or release notes
- mixed: Unclear or combination of multiple documentation types

NON-DOCUMENTATION TYPES (if the page is NOT documentation):
- blog-post: Blog articles, opinion pieces, news posts
- landing-page: Product pages, feature pages, marketing content
- marketing-page: Pricing, about us, careers, contact pages
- non-documentation: Any other non-documentation content

Respond with just the type name (e.g., "api-reference" or "blog-post").`;

    try {
        const aiResponse = await invokeBedrockModel(prompt, {
            maxTokens: 50,
            temperature: 0.1
        });

        const cleaned = aiResponse.trim().toLowerCase();
        console.log(`AI response: ${cleaned}`);

        const validTypes: DocumentationType[] = [
            'api-reference', 'tutorial', 'conceptual', 'how-to',
            'overview', 'reference', 'troubleshooting', 'changelog', 'mixed',
            'blog-post', 'landing-page', 'marketing-page', 'non-documentation'
        ];

        if (validTypes.includes(cleaned as DocumentationType)) {
            return cleaned as DocumentationType;
        } else {
            console.log(`Invalid AI response, defaulting to mixed`);
            return 'mixed';
        }
    } catch (error) {
        console.error('AI content type detection failed:', error);
        return 'mixed';
    }
}

async function detectContentTypeEnhanced(
    document: Document,
    markdownContent: string,
    url: string
): Promise<DocumentationType> {
    const keywordType = detectByKeywords(url, document.title);
    if (keywordType) {
        console.log(`Content type detected by keywords: ${keywordType}`);
        return keywordType;
    }

    console.log(`Using AI fallback for unclear URL: ${url}`);
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || undefined;
    const aiType = await detectByAI(url, document.title, metaDescription);
    console.log(`Content type detected by AI: ${aiType}`);
    return aiType;
}

// ─── Noise removal ───────────────────────────────────────────

function removeNoiseElements(document: Document): number {
    const noiseSelectors = [
        'script', 'style', 'noscript', 'link[rel="stylesheet"]',
        'nav', 'header', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '.site-header', '.site-footer', '.site-navigation',
        '#secondary', '.navigation', '.breadcrumb', '.breadcrumbs',
        '.edit-link', '.post-navigation', '.comments-area',
        '#wporg-header', '#wporg-footer', '#wporg-sidebar',
        '.wp-block-wporg-sidebar-container',
        '.wp-block-social-links', '.wp-block-navigation',
        '.advertisement', '.ad', '.ads', '.sidebar', '.comments',
        '.cookie-notice', '.gdpr-notice', '.privacy-notice',
        '.social-share', '.share-buttons', '.related-posts',
        '.author-bio', '.post-meta', '.entry-meta',
        'form', 'input', 'button[type="submit"]', 'textarea',
        '[style*="display:none"]', '[style*="visibility:hidden"]',
        '.hidden', '.sr-only', '.screen-reader-text',
        'iframe', 'embed', 'object', 'video', 'audio',
        '.widget', '.wp-widget', '.sidebar-widget',
        '.skip-link', '.skip-to-content',
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

// ─── Main content extraction ─────────────────────────────────

function extractMainContent(document: Document): Element {
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

// ─── Turndown configuration ─────────────────────────────────

function configureTurndownService(): TurndownService {
    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
    });

    turndown.use(gfm);

    turndown.remove([
        'script', 'style', 'noscript', 'link',
        'nav', 'footer', 'header', 'aside',
        'form', 'input', 'button', 'textarea', 'select', 'option',
        'iframe', 'embed', 'object', 'video', 'audio',
        'meta', 'title', 'base'
    ]);

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

    turndown.addRule('codeBlock', {
        filter: (node: any) => {
            return node.nodeName === 'PRE' && node.querySelector('code');
        },
        replacement: (_content: string, node: any) => {
            const code = node.querySelector('code');
            const className = code?.className || '';

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

// ═══════════════════════════════════════════════════════════════
// THE TOOL
// ═══════════════════════════════════════════════════════════════

export const processUrlTool = tool(
    async (input): Promise<string> => {
        console.log(JSON.stringify({ sessionId: input.sessionId, tool: 'process_url', event: 'started', url: input.url }));

        const progress = createProgressHelper(input.sessionId);

        try {
            // ── Initial progress ───────────────────────────────
            await progress.progress('Processing URL...', 'url-processing');

            // ── URL slug quality analysis ──────────────────────
            await progress.info('Analyzing URL slug quality...');
            const urlSlugAnalysis = analyzeUrlSlugQuality(input.url);

            if (urlSlugAnalysis.overallStatus === 'issues-found') {
                urlSlugAnalysis.issues.forEach(issue => {
                    console.log(`URL slug issue detected: '${issue.segment}' -> '${issue.suggestion}' (confidence: ${issue.confidence})`);
                });
                await progress.info(`Found ${urlSlugAnalysis.issues.length} URL slug issue(s)`);
            } else {
                console.log('URL slug quality: No issues found');
            }

            // ── Cache control ──────────────────────────────────
            const cacheEnabled = input.cacheEnabled !== false;
            const contextEnabled = input.contextAnalysisEnabled || false;
            const contextualSetting = contextEnabled ? 'with-context' : 'without-context';
            const consistentSessionId = generateConsistentSessionId(input.url, contextualSetting);

            console.log(`Generated consistent session ID: ${consistentSessionId} (context: ${contextEnabled}, cache: ${cacheEnabled})`);

            // ── Step 1: Check cache ────────────────────────────
            let cachedContent: ProcessedContentIndex | null = null;
            if (cacheEnabled) {
                cachedContent = await checkProcessedContentCache(input.url, contextualSetting);
            } else {
                console.log('Cache disabled by user - skipping cache check');
                await progress.info('Cache disabled - running fresh analysis');
            }

            if (cachedContent && !isCacheExpired(cachedContent)) {
                console.log(`Cache hit! Using cached content from session: ${consistentSessionId}`);

                await progress.cacheHit(`Cache HIT! Using cached analysis from ${new Date(cachedContent.processedAt).toLocaleDateString()}`, {
                    cacheStatus: 'hit',
                    contentType: cachedContent.contentType
                });

                if (consistentSessionId !== input.sessionId) {
                    await copyCachedContentToSession(cachedContent.s3Location, input.sessionId);
                }

                await addCacheMetadata(input.sessionId, true);
                await storeSessionMetadata(input.sessionId, input.url, input.selectedModel);

                // Read back to compute summary metrics
                const cached = await readSessionArtifact<any>(input.sessionId, 'processed-content.json');
                const wordCount = cached?.markdownContent
                    ? cached.markdownContent.split(/\s+/).filter(Boolean).length
                    : 0;

                return JSON.stringify({
                    success: true,
                    sessionId: input.sessionId,
                    cacheStatus: 'hit',
                    wordCount,
                    linkCount: cached?.linkAnalysis?.totalLinks ?? 0,
                    codeSnippets: cached?.codeSnippets?.length ?? 0,
                    contentType: cachedContent.contentType,
                    message: 'Retrieved from cache'
                });
            }

            console.log('Cache miss or expired, processing fresh content...');

            if (cacheEnabled) {
                await progress.cacheMiss('Cache MISS - Running fresh analysis', { cacheStatus: 'miss' });
            }

            // ── Step 2: Fetch HTML ─────────────────────────────
            await progress.info('Fetching and cleaning content...');

            const response = await fetch(input.url, {
                headers: { 'User-Agent': 'Lensy Documentation Quality Auditor/1.0' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const htmlContent = await response.text();
            console.log(`Fetched ${htmlContent.length} characters of HTML content`);

            // ── Parse & clean ──────────────────────────────────
            const dom = new JSDOM(htmlContent, { url: input.url });
            const document = dom.window.document;

            console.log(`Original HTML size: ${htmlContent.length} chars`);

            const removedCount = removeNoiseElements(document);
            console.log(`Removed ${removedCount} noise elements`);

            const mainContent = extractMainContent(document);
            const cleanHtml = mainContent.innerHTML;
            console.log(`After content extraction: ${cleanHtml.length} chars`);

            const reductionPercent = Math.round((1 - cleanHtml.length / htmlContent.length) * 100);
            console.log(`Total reduction: ${reductionPercent}%`);

            await progress.success(
                `Content processed: ${Math.round(htmlContent.length / 1024)}KB -> ${Math.round(cleanHtml.length / 1024)}KB (${reductionPercent}% reduction)`,
                { originalSize: htmlContent.length, cleanedSize: cleanHtml.length, reductionPercent }
            );

            // ── Extract analysis data ──────────────────────────
            const mediaElements = extractMediaElements(document, input.url);
            const codeSnippets = extractCodeSnippets(document);
            const linkAnalysis = analyzeLinkStructure(document, input.url);

            // ── Validate internal links ────────────────────────
            let linkValidationResult: { linkIssues: LinkIssue[]; healthyLinks: number } = { linkIssues: [], healthyLinks: 0 };
            if (linkAnalysis.internalLinksForValidation && linkAnalysis.internalLinksForValidation.length > 0) {
                linkValidationResult = await validateInternalLinks(linkAnalysis.internalLinksForValidation, progress);
            }

            // ── Enhanced code analysis ─────────────────────────
            let enhancedCodeAnalysis: { deprecatedCode: DeprecatedCodeFinding[]; syntaxErrors: SyntaxErrorFinding[] } = { deprecatedCode: [], syntaxErrors: [] };
            if (codeSnippets.length > 0) {
                enhancedCodeAnalysis = await analyzeCodeSnippetsEnhanced(codeSnippets, progress);
            }

            // ── Context analysis ───────────────────────────────
            let contextAnalysisResult: ContextAnalysisResult | null = null;
            if (contextEnabled) {
                console.log('Context analysis enabled, discovering related pages...');
                await progress.info('Discovering related pages...');

                const contextPages = discoverContextPages(document, input.url);
                console.log(`Found ${contextPages.length} potential context pages`);

                // ── KB enrichment: read from DynamoDB Page Knowledge Base ──
                const safeDomain = deriveSafeDomain(input.url);
                let kbPages: KBPageEntry[] = [];
                try {
                    kbPages = await queryKB(safeDomain);
                    if (kbPages.length > 0) {
                        console.log(`[KB] Found ${kbPages.length} pages in Knowledge Base for ${safeDomain}`);
                        // Enrich discovered context pages with KB data
                        for (const page of contextPages) {
                            const kbEntry = kbPages.find(p => p.url === page.url);
                            if (kbEntry) {
                                page.documentationType = kbEntry.documentationType;
                                page.topic = kbEntry.topic;
                                page.covers = kbEntry.covers;
                                page.codeExamples = kbEntry.codeExamples;
                                page.keyTerms = kbEntry.keyTerms;
                                console.log(`[KB] Enriched context page: ${page.title} (${kbEntry.documentationType})`);
                            }
                        }
                    } else {
                        console.log(`[KB] No pages found in Knowledge Base for ${safeDomain}`);
                    }
                } catch (err) {
                    console.error(`[KB] Failed to query Knowledge Base:`, err);
                }

                // ── Fetch & summarize top context pages not in KB (Step 4.6) ──
                const unenrichedPages = contextPages.filter(p => !p.topic);
                const pagesToFetch = unenrichedPages.slice(0, 3); // Top 3 not in KB
                if (pagesToFetch.length > 0) {
                    console.log(`[KB] Fetching ${pagesToFetch.length} context pages not in KB...`);
                    await progress.info(`Fetching ${pagesToFetch.length} related pages for deeper context...`);

                    for (const page of pagesToFetch) {
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 15000);
                            const resp = await fetch(page.url, {
                                headers: { 'User-Agent': 'Lensy Documentation Quality Auditor/1.0' },
                                signal: controller.signal
                            });
                            clearTimeout(timeoutId);

                            if (resp.ok) {
                                const html = await resp.text();
                                // Quick extraction: use JSDOM to get text content
                                const ctxDom = new JSDOM(html);
                                const ctxBody = ctxDom.window.document.body;
                                // Remove nav/footer/script/style
                                ctxBody.querySelectorAll('nav, footer, script, style, header').forEach(el => el.remove());
                                const rawContent = ctxBody.textContent?.replace(/\s+/g, ' ').trim() || '';

                                if (rawContent.length > 200) {
                                    // Summarize with Haiku and write to KB
                                    const pageSummary = await summarizeAndParsePage(page.url, page.title, rawContent, undefined);
                                    page.documentationType = pageSummary.documentationType;
                                    page.topic = pageSummary.topic;
                                    page.covers = pageSummary.covers;
                                    page.codeExamples = pageSummary.codeExamples;
                                    page.keyTerms = pageSummary.keyTerms;

                                    // Write to KB (non-blocking, fire-and-forget)
                                    writePageToKB(safeDomain, pageSummary, 'doc-audit').catch(err =>
                                        console.error(`[KB] Failed to write context page ${page.url}:`, err)
                                    );
                                    console.log(`[KB] Fetched & summarized context page: ${page.title}`);
                                }
                            }
                        } catch (err) {
                            console.log(`[KB] Failed to fetch context page ${page.url}: ${err}`);
                        }
                    }
                }

                contextAnalysisResult = {
                    contextPages,
                    analysisScope: contextPages.length > 0 ? 'with-context' : 'single-page',
                    totalPagesAnalyzed: 1 + contextPages.length
                };

                contextPages.forEach(page => {
                    console.log(`Context page (${page.relationship}): ${page.title} - ${page.url}${page.topic ? ` [KB: ${page.documentationType}]` : ''}`);
                });

                if (contextPages.length > 0) {
                    const enrichedCount = contextPages.filter(p => p.topic).length;
                    await progress.success(`Context: ${contextPages.length} related pages discovered (${enrichedCount} enriched from KB)`, {
                        contextPages: contextPages.length,
                        enrichedFromKB: enrichedCount
                    });
                }
            }

            // ── Markdown conversion ────────────────────────────
            const turndownService = configureTurndownService();
            const markdownContent = turndownService.turndown(cleanHtml);
            console.log(`Final markdown size: ${markdownContent.length} chars`);

            // ── Content validation gate ────────────────────────
            const contentValidation = validateContentReadability(markdownContent, input.url);
            if (!contentValidation.valid) {
                console.log(`Content validation FAILED: ${contentValidation.reason}`);
                console.log(JSON.stringify({ sessionId: input.sessionId, tool: 'process_url', event: 'content_gate_failed', reason: contentValidation.reason, contentLength: markdownContent.trim().length }));
                await progress.error(`Content validation failed: ${contentValidation.reason}`);
                return JSON.stringify({
                    success: false,
                    sessionId: input.sessionId,
                    cacheStatus: 'miss',
                    wordCount: 0,
                    linkCount: 0,
                    codeSnippets: 0,
                    contentGateFailed: true,
                    message: contentValidation.reason
                });
            }

            const contentType = await detectContentTypeEnhanced(document, markdownContent, input.url);

            // ── Non-documentation type gate ─────────────────────
            const nonDocTypes: DocumentationType[] = ['blog-post', 'landing-page', 'marketing-page', 'non-documentation'];
            if (nonDocTypes.includes(contentType)) {
                const reason = `This URL appears to be a ${contentType.replace('-', ' ')} rather than documentation. Lensy analyzes technical documentation pages (API references, tutorials, guides, etc.). Please provide a documentation URL.`;
                console.log(JSON.stringify({ sessionId: input.sessionId, tool: 'process_url', event: 'non_doc_type_blocked', contentType }));
                await progress.error(reason);
                return JSON.stringify({
                    success: false,
                    sessionId: input.sessionId,
                    cacheStatus: 'miss',
                    wordCount: 0,
                    linkCount: 0,
                    codeSnippets: 0,
                    contentGateFailed: true,
                    contentType,
                    message: reason
                });
            }

            console.log(JSON.stringify({ sessionId: input.sessionId, tool: 'process_url', event: 'content_type_detected', contentType, markdownLength: markdownContent.length }));
            await progress.success(`Content type: ${contentType}`, { contentType });

            // ── Build processed content object ─────────────────
            const processedContent: any = {
                url: input.url,
                htmlContent: cleanHtml,
                markdownContent,
                mediaElements: mediaElements.slice(0, 10),
                codeSnippets: codeSnippets.slice(0, 15),
                contentType,
                urlSlugAnalysis,
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

            // Update analysisScope based on context
            if (contextAnalysisResult) {
                processedContent.linkAnalysis.analysisScope = contextAnalysisResult.analysisScope === 'with-context' ? 'with-context' : 'current-page-only';
            }

            processedContent.linkAnalysis.brokenLinks = linkValidationResult.linkIssues.filter(link => link.issueType === '404').length;
            processedContent.linkAnalysis.totalLinkIssues = linkValidationResult.linkIssues.length;

            // ── Store processed content in S3 ──────────────────
            await writeSessionArtifact(input.sessionId, 'processed-content.json', processedContent);
            console.log(`Stored processed content in S3: sessions/${input.sessionId}/processed-content.json`);

            // ── Write current page to DynamoDB KB (Step 4.2) ──
            try {
                const safeDomainForKB = deriveSafeDomain(input.url);
                const currentPageSummary = await summarizeAndParsePage(
                    input.url,
                    document.title || input.url,
                    markdownContent,
                    undefined
                );
                await writePageToKB(safeDomainForKB, currentPageSummary, 'doc-audit');
                console.log(`[KB] Wrote current page to KB: ${input.url}`);
            } catch (err) {
                console.error(`[KB] Failed to write current page to KB (non-fatal):`, err);
            }

            // ── Store session metadata ─────────────────────────
            await storeSessionMetadata(input.sessionId, input.url, input.selectedModel);

            // ── Add cache metadata ─────────────────────────────
            await addCacheMetadata(input.sessionId, false);

            // ── Store in DynamoDB cache ────────────────────────
            if (cacheEnabled) {
                await storeProcessedContentInCache(input.url, processedContent, contextualSetting);
            } else {
                console.log('Cache disabled - skipping cache storage');
            }

            // ── Return summary ─────────────────────────────────
            const wordCount = markdownContent.split(/\s+/).filter(Boolean).length;

            return JSON.stringify({
                success: true,
                sessionId: input.sessionId,
                cacheStatus: 'miss',
                wordCount,
                linkCount: linkAnalysis.totalLinks,
                internalLinks: linkAnalysis.internalLinks,
                externalLinks: linkAnalysis.externalLinks,
                brokenLinks: linkValidationResult.linkIssues.filter(l => l.issueType === '404').length,
                codeSnippets: codeSnippets.length,
                deprecatedCodeFindings: enhancedCodeAnalysis.deprecatedCode.length,
                syntaxErrorFindings: enhancedCodeAnalysis.syntaxErrors.length,
                mediaElements: mediaElements.length,
                contentType,
                noiseReductionPercent: reductionPercent,
                urlSlugIssues: urlSlugAnalysis.issues.length,
                contextPagesDiscovered: contextAnalysisResult?.contextPages.length ?? 0,
                message: 'Content processed and cached'
            });

        } catch (error) {
            console.error('URL processing failed:', error);
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            await progress.error(`URL processing failed: ${errMsg}`);

            return JSON.stringify({
                success: false,
                sessionId: input.sessionId,
                cacheStatus: 'miss',
                wordCount: 0,
                linkCount: 0,
                codeSnippets: 0,
                message: errMsg
            });
        }
    },
    {
        name: 'process_url',
        description:
            'Fetches a documentation URL, strips HTML noise, converts to clean Markdown, ' +
            'validates internal links, extracts and analyzes code snippets for deprecated ' +
            'methods and syntax errors via LLM, extracts media elements, discovers context ' +
            'pages (parent/child/sibling), detects content type, and analyzes URL slug ' +
            'quality. Results are cached in DynamoDB with a 7-day TTL. Stores the full ' +
            'processed content artifact at sessions/{sessionId}/processed-content.json. ' +
            'Call this AFTER detect_input_type confirms the URL is a doc page.',
        schema: z.object({
            url: z.string().describe('The documentation URL to process'),
            sessionId: z.string().describe('The analysis session ID'),
            selectedModel: z.string().describe('The selected AI model identifier (e.g., "claude", "auto")'),
            contextAnalysisEnabled: z.boolean().optional().default(false).describe('Enable context analysis to discover parent/child/sibling pages'),
            maxContextPages: z.number().optional().default(5).describe('Maximum number of context pages to discover'),
            cacheEnabled: z.boolean().optional().default(true).describe('Enable DynamoDB caching (7-day TTL). Set false to force fresh analysis')
        })
    }
);
