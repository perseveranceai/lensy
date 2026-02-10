"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_apigatewaymanagementapi_1 = require("@aws-sdk/client-apigatewaymanagementapi");
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
// Progress publisher class
class ProgressPublisher {
    constructor(sessionId) {
        this.apiGatewayClient = null;
        this.connectionId = null;
        this.sessionId = sessionId;
        const websocketEndpoint = process.env.WEBSOCKET_ENDPOINT;
        if (websocketEndpoint) {
            this.apiGatewayClient = new client_apigatewaymanagementapi_1.ApiGatewayManagementApiClient({
                endpoint: websocketEndpoint,
                region: process.env.AWS_REGION || 'us-east-1'
            });
        }
    }
    async progress(message, phase) {
        console.log(`[PROGRESS] ${message}`);
        await this.sendMessage('progress', message, phase);
    }
    async success(message, metadata) {
        console.log(`[SUCCESS] ${message}`);
        await this.sendMessage('success', message, undefined, metadata);
    }
    async error(message) {
        console.error(`[ERROR] ${message}`);
        await this.sendMessage('error', message);
    }
    async sendMessage(type, message, phase, metadata) {
        if (!this.apiGatewayClient)
            return;
        try {
            const payload = {
                type,
                message,
                timestamp: Date.now(),
                ...(phase && { phase }),
                ...(metadata && { metadata })
            };
            // Get connection ID from DynamoDB (simplified - in production you'd query DynamoDB)
            // For now, we'll just log and skip WebSocket if connection not available
            if (!this.connectionId) {
                console.log('WebSocket not available, skipping message:', payload);
                return;
            }
            await this.apiGatewayClient.send(new client_apigatewaymanagementapi_1.PostToConnectionCommand({
                ConnectionId: this.connectionId,
                Data: Buffer.from(JSON.stringify(payload))
            }));
        }
        catch (error) {
            console.error('Failed to send WebSocket message:', error);
        }
    }
}
const handler = async (event) => {
    console.log('Sitemap Health for Doc Mode received event:', JSON.stringify(event, null, 2));
    const { url, sessionId, analysisStartTime } = event;
    const startTime = Date.now();
    const progress = new ProgressPublisher(sessionId);
    try {
        // Step 1: Extract domain from URL
        await progress.progress('Discovering sitemap URL...', 'sitemap-discovery');
        const urlObj = new URL(url);
        const domain = `${urlObj.protocol}//${urlObj.hostname}`;
        console.log(`Extracted domain: ${domain}`);
        // Step 2: Attempt sitemap discovery
        let sitemapUrl = null;
        let skippedGzipUrl = null; // [NEW] Track skipped Gzip URLs
        let lastDiscoveryError = null; // [NEW] Track discovery errors
        let discoveryMethod = 'not-found';
        // Try to find sitemap in robots.txt
        try {
            console.log(`Checking robots.txt at ${domain}/robots.txt`);
            const robotsResponse = await fetch(`${domain}/robots.txt`, {
                signal: AbortSignal.timeout(5000)
            });
            if (robotsResponse.ok) {
                const robotsText = await robotsResponse.text();
                const sitemapMatch = robotsText.match(/Sitemap:\s*(https?:\/\/[^\s]+)/i);
                if (sitemapMatch) {
                    sitemapUrl = sitemapMatch[1].trim();
                    // [NEW] Check .gz accessibility instead of skipping
                    if (sitemapUrl.endsWith('.gz')) {
                        console.log(`Found gzipped sitemap in robots.txt: ${sitemapUrl}, checking accessibility...`);
                        try {
                            const gzipCheckResponse = await fetch(sitemapUrl, {
                                method: 'HEAD',
                                signal: AbortSignal.timeout(5000)
                            });
                            if (gzipCheckResponse.ok) {
                                // Accessible but has parsing issues (XML Parsing Error: not well-formed)
                                lastDiscoveryError = `Sitemap at ${sitemapUrl} is accessible but has XML parsing issues (compressed/not well-formed). The sitemap may need to be regenerated in standard XML format.`;
                                console.log(lastDiscoveryError);
                            }
                            else {
                                // Not accessible
                                lastDiscoveryError = `Access Denied (${gzipCheckResponse.status}) at ${sitemapUrl}`;
                                console.log(lastDiscoveryError);
                            }
                        }
                        catch (gzipError) {
                            lastDiscoveryError = `Failed to access ${sitemapUrl}: ${gzipError instanceof Error ? gzipError.message : 'Unknown error'}`;
                            console.log(lastDiscoveryError);
                        }
                        skippedGzipUrl = sitemapUrl;
                        sitemapUrl = null;
                    }
                    else {
                        discoveryMethod = 'robots.txt';
                        console.log(`Found sitemap in robots.txt: ${sitemapUrl}`);
                    }
                }
            }
        }
        catch (error) {
            console.log('Error fetching robots.txt:', error);
        }
        // Try direct paths if robots.txt didn't work
        if (!sitemapUrl) {
            const directPaths = [
                `${domain}/sitemap.xml`,
                `${domain}/sitemap_index.xml`,
                `${domain}/sitemap/sitemap.xml`
            ];
            for (const path of directPaths) {
                try {
                    console.log(`Trying direct path: ${path}`);
                    const response = await fetch(path, {
                        method: 'HEAD',
                        signal: AbortSignal.timeout(3000)
                    });
                    if (response.ok) {
                        sitemapUrl = path;
                        discoveryMethod = 'direct';
                        console.log(`Found sitemap at: ${path}`);
                        break;
                    }
                    else {
                        // Capture error status for reporting if we find nothing
                        if (response.status === 403 || response.status === 401) {
                            lastDiscoveryError = `Access Denied (${response.status}) at ${path}`;
                        }
                    }
                }
                catch (error) {
                    console.log(`Path ${path} not accessible`);
                    lastDiscoveryError = `Connection failed for ${path}`;
                }
            }
        }
        // Step 3: If no sitemap found, return gracefully but report issues
        if (!sitemapUrl) {
            // Determine the best message to show
            let status = 'not-found';
            let message = 'No accessible sitemap found';
            if (skippedGzipUrl) {
                // Prioritize .gz sitemap message since it's from robots.txt
                status = 'error';
                if (lastDiscoveryError && lastDiscoveryError.includes('not accessible')) {
                    // .gz file had access/permission issues
                    message = `Sitemap listed in robots.txt at ${skippedGzipUrl} — permission issue: the file is not accessible (possible 403/401 error).`;
                } else {
                    // .gz file is accessible but has parsing issues
                    message = `Sitemap listed in robots.txt at ${skippedGzipUrl} — XML parsing issue: the file is accessible but not well-formed. The sitemap may need to be regenerated in standard XML format.`;
                }
                await progress.progress(message, 'sitemap-discovery');
            }
            else if (lastDiscoveryError) {
                status = 'error';
                message = `Sitemap discovery failed: ${lastDiscoveryError}`;
                await progress.progress(message, 'sitemap-discovery');
            }
            else {
                await progress.progress('Sitemap not found for domain, skipping health check', 'sitemap-discovery');
            }
            const result = {
                success: true,
                sitemapUrl: null,
                discoveryMethod: 'not-found',
                healthResults: null,
                error: message, // Use the constructed message
                processingTime: Date.now() - startTime
            };
            // Store result in S3 with error details if applicable
            await s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: process.env.ANALYSIS_BUCKET,
                Key: `sessions/${sessionId}/doc-mode-sitemap-health.json`,
                Body: JSON.stringify({
                    sitemapStatus: status,
                    error: message,
                    sitemapUrl: null,
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                }),
                ContentType: 'application/json'
            }));
            return result;
        }
        // Step 4: Parse sitemap using existing SitemapParser Lambda
        await progress.progress(`Parsing sitemap (${sitemapUrl})...`, 'sitemap-parsing');
        const parserResponse = await lambdaClient.send(new client_lambda_1.InvokeCommand({
            FunctionName: process.env.SITEMAP_PARSER_FUNCTION_NAME || 'LensyStack-SitemapParserFunction',
            Payload: JSON.stringify({
                sitemapUrl,
                sessionId,
                maxUrls: 500 // Limit to 500 URLs
            })
        }));
        const parserResult = JSON.parse(new TextDecoder().decode(parserResponse.Payload));
        console.log('SitemapParser result:', parserResult);
        if (!parserResult.success) {
            throw new Error(`Sitemap parsing failed: ${parserResult.error}`);
        }
        // The parser stores URLs in S3, we need to read them from there
        let urls = [];
        try {
            const sitemapResultsKey = `sessions/${sessionId}/sitemap-results.json`;
            const sitemapResultsResponse = await s3Client.send(new client_s3_1.GetObjectCommand({
                Bucket: process.env.ANALYSIS_BUCKET,
                Key: sitemapResultsKey
            }));
            if (sitemapResultsResponse.Body) {
                const content = await sitemapResultsResponse.Body.transformToString();
                const sitemapData = JSON.parse(content);
                urls = sitemapData.urls || [];
            }
        }
        catch (error) {
            console.log('Could not read sitemap results from S3:', error);
        }
        await progress.progress(`Parsing sitemap (${urls.length} URLs found)...`, 'sitemap-parsing');
        if (urls.length === 0) {
            // No URLs found, store empty result
            await s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: process.env.ANALYSIS_BUCKET,
                Key: `sessions/${sessionId}/doc-mode-sitemap-health.json`,
                Body: JSON.stringify({
                    sitemapStatus: 'success',
                    sitemapUrl,
                    totalUrls: 0,
                    healthyUrls: 0,
                    linkIssues: [],
                    healthPercentage: 100,
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                    discoveryMethod
                }),
                ContentType: 'application/json'
            }));
            return {
                success: true,
                sitemapUrl,
                discoveryMethod,
                healthResults: null,
                processingTime: Date.now() - startTime
            };
        }
        // Step 5: Check health using existing SitemapHealthChecker Lambda
        await progress.progress(`Checking health of ${urls.length} URLs...`, 'sitemap-health-check');
        const healthCheckerResponse = await lambdaClient.send(new client_lambda_1.InvokeCommand({
            FunctionName: process.env.SITEMAP_HEALTH_CHECKER_FUNCTION_NAME || 'LensyStack-SitemapHealthCheckerFunction',
            Payload: JSON.stringify({
                urls,
                sessionId
            })
        }));
        const healthResult = JSON.parse(new TextDecoder().decode(healthCheckerResponse.Payload));
        console.log('SitemapHealthChecker result:', healthResult);
        if (!healthResult.success) {
            // Health check failed, but we should still store the result gracefully
            console.log(`Health check failed: ${healthResult.error || healthResult.message || 'Unknown error'}`);
            await s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: process.env.ANALYSIS_BUCKET,
                Key: `sessions/${sessionId}/doc-mode-sitemap-health.json`,
                Body: JSON.stringify({
                    sitemapStatus: 'error',
                    sitemapUrl,
                    error: healthResult.error || healthResult.message || 'Health check failed',
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                }),
                ContentType: 'application/json'
            }));
            return {
                success: true, // Return success so Doc Mode continues
                sitemapUrl,
                discoveryMethod,
                healthResults: null,
                error: healthResult.error || healthResult.message,
                processingTime: Date.now() - startTime
            };
        }
        // Step 6: Store results in S3
        const healthSummary = {
            sitemapStatus: 'success',
            totalUrls: healthResult.totalUrls,
            healthyUrls: healthResult.healthyUrls,
            linkIssues: healthResult.linkIssues || [],
            healthPercentage: healthResult.healthPercentage,
            processingTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            sitemapUrl,
            discoveryMethod
        };
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: process.env.ANALYSIS_BUCKET,
            Key: `sessions/${sessionId}/doc-mode-sitemap-health.json`,
            Body: JSON.stringify(healthSummary),
            ContentType: 'application/json'
        }));
        await progress.success(`Sitemap health: ${healthResult.healthyUrls}/${healthResult.totalUrls} URLs healthy (${healthResult.healthPercentage}%)`, {
            totalUrls: healthResult.totalUrls,
            healthyUrls: healthResult.healthyUrls,
            healthPercentage: healthResult.healthPercentage
        });
        return {
            success: true,
            sitemapUrl,
            discoveryMethod,
            healthResults: healthSummary,
            processingTime: Date.now() - startTime
        };
    }
    catch (error) {
        console.error('Sitemap health check failed:', error);
        await progress.error(`Sitemap health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Store error result in S3 so report generator knows it failed
        try {
            await s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: process.env.ANALYSIS_BUCKET,
                Key: `sessions/${sessionId}/doc-mode-sitemap-health.json`,
                Body: JSON.stringify({
                    sitemapStatus: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error',
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                }),
                ContentType: 'application/json'
            }));
        }
        catch (s3Error) {
            console.error('Failed to store error result in S3:', s3Error);
        }
        return {
            success: false,
            sitemapUrl: null,
            discoveryMethod: 'not-found',
            healthResults: null,
            error: error instanceof Error ? error.message : 'Unknown error',
            processingTime: Date.now() - startTime
        };
    }
};
exports.handler = handler;
