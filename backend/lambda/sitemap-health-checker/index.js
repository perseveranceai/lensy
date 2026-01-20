"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const progress_publisher_1 = require("./progress-publisher");
const handler = async (event) => {
    const startTime = Date.now();
    console.log('Starting sitemap health check for session:', event.sessionId);
    // Initialize progress publisher and S3 client
    const progress = new progress_publisher_1.ProgressPublisher(event.sessionId);
    const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
    try {
        // Check if sitemap parsing was successful
        if (!event.sitemapParserResult.Payload.success) {
            throw new Error('Sitemap parsing failed, cannot perform health check');
        }
        const totalUrls = event.sitemapParserResult.Payload.totalUrls;
        const sitemapUrls = event.sitemapParserResult.Payload.sitemapUrls;
        if (totalUrls === 0) {
            await progress.info('No URLs found in sitemap, skipping health check');
            const emptyHealthSummary = {
                totalUrls: 0,
                healthyUrls: 0,
                linkIssues: [],
                healthPercentage: 100,
                processingTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
            return {
                success: true,
                sessionId: event.sessionId,
                totalUrls: 0,
                healthyUrls: 0,
                brokenUrls: 0,
                accessDeniedUrls: 0,
                timeoutUrls: 0,
                otherErrorUrls: 0,
                healthSummary: emptyHealthSummary,
                s3Location: '',
                message: 'No URLs to check',
                processingTime: Date.now() - startTime
            };
        }
        await progress.progress(`Starting bulk health check for ${totalUrls} URLs from sitemap`, 'sitemap-health-check');
        // Perform bulk link validation
        const healthCheckResult = await performBulkLinkValidation(sitemapUrls, progress);
        // Calculate health statistics
        const brokenUrls = healthCheckResult.linkIssues.filter(issue => issue.issueType === '404').length;
        const accessDeniedUrls = healthCheckResult.linkIssues.filter(issue => issue.issueType === 'access-denied').length;
        const timeoutUrls = healthCheckResult.linkIssues.filter(issue => issue.issueType === 'timeout').length;
        const otherErrorUrls = healthCheckResult.linkIssues.filter(issue => issue.issueType === 'error').length;
        const healthyUrls = totalUrls - healthCheckResult.linkIssues.length;
        const healthPercentage = Math.round((healthyUrls / totalUrls) * 100);
        // Create health summary
        const healthSummary = {
            totalUrls,
            healthyUrls,
            linkIssues: healthCheckResult.linkIssues,
            healthPercentage,
            processingTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };
        // Store results in S3
        const s3Key = `sessions/${event.sessionId}/sitemap-health-results.json`;
        const s3Location = `s3://${process.env.ANALYSIS_BUCKET}/${s3Key}`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: process.env.ANALYSIS_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(healthSummary, null, 2),
            ContentType: 'application/json'
        }));
        // Send completion message
        await progress.success(`Sitemap health check complete: ${healthyUrls}/${totalUrls} URLs healthy (${healthPercentage}%)`, {
            totalUrls,
            healthyUrls,
            brokenUrls,
            healthPercentage,
            processingTime: Date.now() - startTime
        });
        console.log(`Sitemap health check completed: ${healthyUrls}/${totalUrls} URLs healthy`);
        // [NEW] Cache results by domain for Doc Mode reuse
        try {
            if (sitemapUrls.length > 0) {
                // Extract domain from first URL
                const firstUrl = new URL(sitemapUrls[0]);
                const domain = firstUrl.hostname;
                const normalizedDomain = normalizeDomain(domain);
                // Construct cache key matches report-generator expectation
                const cacheKey = `sitemap-health-${normalizedDomain.replace(/\./g, '-')}.json`;
                console.log(`Caching domain-level health results to: ${cacheKey}`);
                await s3Client.send(new client_s3_1.PutObjectCommand({
                    Bucket: process.env.ANALYSIS_BUCKET,
                    Key: cacheKey, // Root level, not session level
                    Body: JSON.stringify(healthSummary, null, 2),
                    ContentType: 'application/json'
                }));
            }
        }
        catch (error) {
            console.warn('Failed to cache domain-level health results:', error);
            // Non-blocking
        }
        return {
            success: true,
            sessionId: event.sessionId,
            totalUrls,
            healthyUrls,
            brokenUrls,
            accessDeniedUrls,
            timeoutUrls,
            otherErrorUrls,
            healthSummary,
            s3Location,
            message: `Health check complete: ${healthyUrls}/${totalUrls} URLs healthy (${healthPercentage}%)`,
            processingTime: Date.now() - startTime
        };
    }
    catch (error) {
        console.error('Sitemap health check failed:', error);
        await progress.error(`Sitemap health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return {
            success: false,
            sessionId: event.sessionId,
            totalUrls: 0,
            healthyUrls: 0,
            brokenUrls: 0,
            accessDeniedUrls: 0,
            timeoutUrls: 0,
            otherErrorUrls: 0,
            healthSummary: {
                totalUrls: 0,
                healthyUrls: 0,
                linkIssues: [],
                healthPercentage: 0,
                processingTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            },
            s3Location: '',
            message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            processingTime: Date.now() - startTime
        };
    }
};
exports.handler = handler;
/**
 * Normalize domain to match configuration keys
 */
function normalizeDomain(domain) {
    // Remove protocol and trailing slashes
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // Handle specific mappings if needed (copying logic from issue-validator)
    if (cleanDomain === 'knock.app') {
        return 'docs.knock.app';
    }
    return cleanDomain;
}
/**
 * Perform bulk link validation for sitemap URLs
 * Requirements: 30.1, 30.2, 30.3, 30.8, 30.9, 30.10
 */
async function performBulkLinkValidation(urls, progress) {
    if (urls.length === 0) {
        return { linkIssues: [] };
    }
    // Remove duplicates
    const uniqueUrls = [...new Set(urls)];
    await progress.progress(`Checking ${uniqueUrls.length} unique URLs for accessibility`, 'sitemap-health-check');
    const linkIssues = [];
    const maxConcurrent = 10; // Limit concurrent requests to avoid overwhelming servers
    const timeout = 8000; // 8 second timeout (longer than single page validation)
    let processedCount = 0;
    // Process URLs in batches to control concurrency
    for (let i = 0; i < uniqueUrls.length; i += maxConcurrent) {
        const batch = uniqueUrls.slice(i, i + maxConcurrent);
        const promises = batch.map(async (url) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; Lensy Documentation Quality Auditor/1.0; +https://lensy.dev/bot)'
                    },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.status === 404) {
                    const linkIssue = {
                        url,
                        status: 404,
                        errorMessage: 'Page not found (404)',
                        issueType: '404'
                    };
                    linkIssues.push(linkIssue);
                }
                else if (response.status === 403) {
                    const linkIssue = {
                        url,
                        status: 403,
                        errorMessage: 'Access denied (403 Forbidden)',
                        issueType: 'access-denied'
                    };
                    linkIssues.push(linkIssue);
                }
                else if (response.status >= 400) {
                    const linkIssue = {
                        url,
                        status: response.status,
                        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
                        issueType: 'error'
                    };
                    linkIssues.push(linkIssue);
                }
                // 2xx and 3xx responses are considered healthy (no action needed)
            }
            catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    const linkIssue = {
                        url,
                        status: 'timeout',
                        errorMessage: 'Request timeout (>8 seconds)',
                        issueType: 'timeout'
                    };
                    linkIssues.push(linkIssue);
                }
                else {
                    const linkIssue = {
                        url,
                        status: 'error',
                        errorMessage: error instanceof Error ? error.message : 'Unknown error',
                        issueType: 'error'
                    };
                    linkIssues.push(linkIssue);
                }
            }
        });
        await Promise.all(promises);
        processedCount += batch.length;
        // Progress update every batch
        const progressPercentage = Math.round((processedCount / uniqueUrls.length) * 100);
        await progress.progress(`Health check progress: ${processedCount}/${uniqueUrls.length} URLs checked (${progressPercentage}%)`, 'sitemap-health-check', { processedCount, totalUrls: uniqueUrls.length, progressPercentage });
    }
    // Final summary
    const brokenCount = linkIssues.filter(issue => issue.issueType === '404').length;
    const accessDeniedCount = linkIssues.filter(issue => issue.issueType === 'access-denied').length;
    const timeoutCount = linkIssues.filter(issue => issue.issueType === 'timeout').length;
    const errorCount = linkIssues.filter(issue => issue.issueType === 'error').length;
    const healthyCount = uniqueUrls.length - linkIssues.length;
    let summaryMessage = `Health check complete: ${healthyCount} healthy`;
    if (brokenCount > 0)
        summaryMessage += `, ${brokenCount} broken (404)`;
    if (accessDeniedCount > 0)
        summaryMessage += `, ${accessDeniedCount} access denied (403)`;
    if (timeoutCount > 0)
        summaryMessage += `, ${timeoutCount} timeout`;
    if (errorCount > 0)
        summaryMessage += `, ${errorCount} other errors`;
    await progress.info(summaryMessage);
    return { linkIssues };
}
