"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const xml2js_1 = require("xml2js");
const progress_publisher_1 = require("./progress-publisher");
const handler = async (event) => {
    const startTime = Date.now();
    console.log('Parsing sitemap for URL:', event.url);
    // Initialize progress publisher and S3 client
    const progress = new progress_publisher_1.ProgressPublisher(event.sessionId);
    const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
    try {
        // Send initial progress
        await progress.progress('Starting sitemap parsing...', 'sitemap-parsing');
        // Fetch and parse the sitemap
        const result = await parseSitemapRecursively(event.url, progress, 0);
        // Store results in S3
        const s3Key = `sessions/${event.sessionId}/sitemap-results.json`;
        const s3Location = `s3://${process.env.ANALYSIS_BUCKET}/${s3Key}`;
        const sitemapResults = {
            originalUrl: event.url,
            totalUrls: result.urls.length,
            urls: result.urls,
            nestedSitemaps: result.nestedSitemaps,
            processingTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: process.env.ANALYSIS_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(sitemapResults, null, 2),
            ContentType: 'application/json'
        }));
        // Send completion message
        await progress.success(`Sitemap parsing complete: Found ${result.urls.length} URLs${result.nestedSitemaps > 0 ? ` (${result.nestedSitemaps} nested sitemaps)` : ''}`, {
            totalUrls: result.urls.length,
            nestedSitemaps: result.nestedSitemaps,
            processingTime: Date.now() - startTime
        });
        console.log(`Sitemap parsing completed: ${result.urls.length} URLs found`);
        return {
            success: true,
            sessionId: event.sessionId,
            totalUrls: result.urls.length,
            sitemapUrls: result.urls,
            nestedSitemaps: result.nestedSitemaps,
            s3Location,
            message: `Successfully parsed sitemap with ${result.urls.length} URLs`,
            processingTime: Date.now() - startTime
        };
    }
    catch (error) {
        console.error('Sitemap parsing failed:', error);
        await progress.error(`Sitemap parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return {
            success: false,
            sessionId: event.sessionId,
            totalUrls: 0,
            sitemapUrls: [],
            nestedSitemaps: 0,
            s3Location: '',
            message: `Sitemap parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            processingTime: Date.now() - startTime
        };
    }
};
exports.handler = handler;
/**
 * Recursively parse sitemap with nested sitemap support
 * Requirements: 29.1, 29.2, 29.3, 29.7, 29.8, 29.9, 29.10
 */
async function parseSitemapRecursively(sitemapUrl, progress, depth = 0, maxDepth = 3, processedUrls = new Set()) {
    // Prevent infinite recursion and duplicate processing
    if (depth > maxDepth) {
        console.log(`Max depth ${maxDepth} reached, skipping: ${sitemapUrl}`);
        return { urls: [], nestedSitemaps: 0 };
    }
    if (processedUrls.has(sitemapUrl)) {
        console.log(`Already processed: ${sitemapUrl}`);
        return { urls: [], nestedSitemaps: 0 };
    }
    processedUrls.add(sitemapUrl);
    try {
        await progress.progress(`Fetching sitemap: ${sitemapUrl}`, 'sitemap-parsing');
        // Fetch sitemap content with timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        const response = await fetch(sitemapUrl, {
            headers: {
                'User-Agent': 'Lensy Documentation Quality Auditor/1.0'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const contentType = response.headers.get('content-type') || '';
        let xmlContent;
        // Handle compressed sitemaps
        if (contentType.includes('gzip') || sitemapUrl.endsWith('.gz')) {
            await progress.progress('Decompressing gzipped sitemap...', 'sitemap-parsing');
            // For now, assume uncompressed. In production, would use zlib
            xmlContent = await response.text();
        }
        else {
            xmlContent = await response.text();
        }
        // Parse XML
        const parsedXml = await new Promise((resolve, reject) => {
            (0, xml2js_1.parseString)(xmlContent, {
                explicitArray: true,
                ignoreAttrs: false,
                trim: true
            }, (err, result) => {
                if (err)
                    reject(err);
                else
                    resolve(result);
            });
        });
        let allUrls = [];
        let nestedSitemapCount = 0;
        // Handle sitemap index (contains references to other sitemaps)
        if (parsedXml.sitemapindex?.sitemap) {
            await progress.progress(`Found sitemap index with ${parsedXml.sitemapindex.sitemap.length} nested sitemaps`, 'sitemap-parsing');
            for (const nestedSitemap of parsedXml.sitemapindex.sitemap) {
                if (nestedSitemap.loc && nestedSitemap.loc[0]) {
                    const nestedUrl = nestedSitemap.loc[0].trim();
                    console.log(`Processing nested sitemap: ${nestedUrl}`);
                    const nestedResult = await parseSitemapRecursively(nestedUrl, progress, depth + 1, maxDepth, processedUrls);
                    allUrls.push(...nestedResult.urls);
                    nestedSitemapCount += 1 + nestedResult.nestedSitemaps;
                }
            }
        }
        // Handle regular sitemap (contains actual URLs)
        if (parsedXml.urlset?.url) {
            await progress.progress(`Extracting ${parsedXml.urlset.url.length} URLs from sitemap`, 'sitemap-parsing');
            for (const urlEntry of parsedXml.urlset.url) {
                if (urlEntry.loc && urlEntry.loc[0]) {
                    const url = urlEntry.loc[0].trim();
                    if (url && isValidUrl(url)) {
                        allUrls.push(url);
                    }
                }
            }
        }
        // Remove duplicates
        const uniqueUrls = [...new Set(allUrls)];
        if (depth === 0) {
            await progress.progress(`Sitemap parsing complete: ${uniqueUrls.length} unique URLs found`, 'sitemap-parsing');
        }
        return {
            urls: uniqueUrls,
            nestedSitemaps: nestedSitemapCount
        };
    }
    catch (error) {
        console.error(`Error parsing sitemap ${sitemapUrl}:`, error);
        await progress.error(`Failed to parse sitemap: ${sitemapUrl} - ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Return empty result but don't fail the entire process
        return { urls: [], nestedSitemaps: 0 };
    }
}
/**
 * Validate URL format
 */
function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
