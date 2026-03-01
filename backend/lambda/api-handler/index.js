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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const https = __importStar(require("https"));
const url_1 = require("url");
const sfnClient = new client_sfn_1.SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const handler = async (event) => {
    console.log("Lensy Production API - Deploy v1.1.0 Ready");
    console.log('API Handler received request:', JSON.stringify(event, null, 2));
    // Handle both API Gateway V1 and V2 event formats
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const path = event.path || event.rawPath || event.requestContext?.http?.path;
    const body = event.body;
    console.log('Extracted method:', httpMethod, 'path:', path);
    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
        'Content-Type': 'application/json'
    };
    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }
    try {
        if (httpMethod === 'POST' && (path === '/analyze' || path === '/scan-doc')) {
            return await handleAnalyzeRequest(body, corsHeaders);
        }
        if (httpMethod === 'POST' && path === '/github-issues') {
            return await handleGithubIssuesRequest(body, corsHeaders, 'fetch');
        }
        if (httpMethod === 'POST' && path === '/github-issues/analyze') {
            return await handleGithubIssuesRequest(body, corsHeaders, 'analyze');
        }
        if (httpMethod === 'POST' && path === '/github-issues/build-kb') {
            return await handleGithubIssuesRequest(body, corsHeaders, 'build-kb');
        }
        if (httpMethod === 'POST' && path === '/github-issues/create-pr') {
            return await handleGithubIssuesRequest(body, corsHeaders, 'create-pr');
        }
        if (httpMethod === 'GET' && path?.startsWith('/github-issues/results/')) {
            return await handleGithubIssuesResultsRequest(path, corsHeaders);
        }
        if (httpMethod === 'GET' && path === '/github-issues/preview-docs') {
            const queryParams = event.queryStringParameters || {};
            return await handlePreviewDocsRequest(queryParams.domain, corsHeaders);
        }
        if (httpMethod === 'POST' && path === '/discover-issues') {
            return await handleDiscoverIssuesRequest(body, corsHeaders);
        }
        if (httpMethod === 'POST' && path === '/validate-issues') {
            return await handleValidateIssuesRequest(body, corsHeaders);
        }
        if (httpMethod === 'POST' && path === '/generate-fixes') {
            return await handleGenerateFixesRequest(body, corsHeaders);
        }
        if (httpMethod === 'POST' && path === '/apply-fixes') {
            return await handleApplyFixesRequest(body, corsHeaders);
        }
        if (httpMethod === 'GET' && path?.startsWith('/status/')) {
            return await handleStatusRequest(path, corsHeaders);
        }
        if (httpMethod === 'GET' && (path?.startsWith('/sessions/') && path.endsWith('/fixes'))) {
            return await handleGetFixesRequest(path, corsHeaders);
        }
        if (httpMethod === 'GET' && path?.startsWith('/get-fixes/')) {
            return await handleGetFixesRequest(path, corsHeaders);
        }
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Not found',
                method: httpMethod,
                path: path,
                availableRoutes: [
                    'POST /analyze',
                    'POST /discover-issues',
                    'POST /validate-issues',
                    'GET /status/{sessionId}',
                    'GET /get-fixes/{sessionId}',
                    'GET /sessions/{sessionId}/fixes'
                ]
            })
        };
    }
    catch (error) {
        console.error('API Handler error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
};
exports.handler = handler;
async function handleAnalyzeRequest(body, corsHeaders) {
    if (!body) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Request body is required' })
        };
    }
    let analysisRequest;
    try {
        analysisRequest = JSON.parse(body);
    }
    catch (error) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
    }
    // Validate request
    if (!analysisRequest.url || !analysisRequest.sessionId) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Missing required fields: url and sessionId are required'
            })
        };
    }
    // Validate URL format
    try {
        new url_1.URL(analysisRequest.url);
    }
    catch (error) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Invalid URL format' })
        };
    }
    // Start Step Functions execution
    const executionName = `analysis-${analysisRequest.sessionId}-${Date.now()}`;
    const stateMachineArn = process.env.STATE_MACHINE_ARN;
    if (!stateMachineArn) {
        throw new Error('STATE_MACHINE_ARN environment variable not set');
    }
    console.log('Starting Step Functions execution:', executionName);
    const startExecutionCommand = new client_sfn_1.StartExecutionCommand({
        stateMachineArn,
        name: executionName,
        input: JSON.stringify({
            ...analysisRequest,
            analysisStartTime: Date.now()
        })
    });
    const execution = await sfnClient.send(startExecutionCommand);
    console.log(`Started analysis execution: ${execution.executionArn}`);
    return {
        statusCode: 202,
        headers: corsHeaders,
        body: JSON.stringify({
            message: 'Analysis started',
            executionArn: execution.executionArn,
            sessionId: analysisRequest.sessionId,
            status: 'started'
        })
    };
}
async function handleStatusRequest(path, corsHeaders) {
    const sessionId = path.split('/')[2];
    if (!sessionId) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Session ID is required' })
        };
    }
    try {
        const bucketName = process.env.ANALYSIS_BUCKET || 'lensy-analysis-951411676525-us-east-1';
        // Try to get the final report from S3
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
        // First, check if this is sitemap mode by looking for sitemap health results
        try {
            const sitemapHealthKey = `sessions/${sessionId}/sitemap-health-results.json`;
            const sitemapHealthResponse = await s3.send(new GetObjectCommand({
                Bucket: bucketName,
                Key: sitemapHealthKey
            }));
            const sitemapHealthContent = await sitemapHealthResponse.Body.transformToString();
            const sitemapHealthResults = JSON.parse(sitemapHealthContent);
            console.log('Found sitemap health results - this is sitemap mode');
            // Get session metadata for timing
            let analysisStartTime = Date.now(); // fallback
            try {
                const metadataKey = `sessions/${sessionId}/metadata.json`;
                const metadataResponse = await s3.send(new GetObjectCommand({
                    Bucket: bucketName,
                    Key: metadataKey
                }));
                const metadataStr = await metadataResponse.Body.transformToString();
                const metadata = JSON.parse(metadataStr);
                analysisStartTime = metadata.startTime || Date.now();
            }
            catch (metadataError) {
                console.log('No metadata found, using current time');
            }
            const actualAnalysisTime = Date.now() - analysisStartTime;
            const healthPercentage = sitemapHealthResults.healthPercentage || 0;
            const report = {
                overallScore: healthPercentage,
                dimensionsAnalyzed: 1,
                dimensionsTotal: 1,
                confidence: 'high',
                modelUsed: 'Sitemap Health Checker',
                cacheStatus: 'miss',
                dimensions: {},
                codeAnalysis: {
                    snippetsFound: 0,
                    syntaxErrors: 0,
                    deprecatedMethods: 0,
                    missingVersionSpecs: 0,
                    languagesDetected: []
                },
                mediaAnalysis: {
                    videosFound: 0,
                    audiosFound: 0,
                    imagesFound: 0,
                    interactiveElements: 0,
                    accessibilityIssues: 0,
                    missingAltText: 0
                },
                linkAnalysis: {
                    totalLinks: 0,
                    internalLinks: 0,
                    externalLinks: 0,
                    brokenLinks: 0,
                    subPagesIdentified: [],
                    linkContext: 'single-page',
                    analysisScope: 'current-page-only'
                },
                sitemapHealth: {
                    totalUrls: sitemapHealthResults.totalUrls,
                    healthyUrls: sitemapHealthResults.healthyUrls,
                    brokenUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === '404').length || 0,
                    accessDeniedUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === 'access-denied').length || 0,
                    timeoutUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === 'timeout').length || 0,
                    otherErrorUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === 'error').length || 0,
                    healthPercentage: sitemapHealthResults.healthPercentage,
                    linkIssues: sitemapHealthResults.linkIssues || [],
                    processingTime: sitemapHealthResults.processingTime
                },
                analysisTime: actualAnalysisTime,
                retryCount: 0
            };
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    sessionId,
                    status: 'completed',
                    report
                })
            };
        }
        catch (sitemapError) {
            console.log('No sitemap health results found, checking for doc mode results');
        }
        // DOC MODE: Check for dimension results
        try {
            const dimensionKey = `sessions/${sessionId}/dimension-results.json`;
            const dimensionResponse = await s3.send(new GetObjectCommand({
                Bucket: bucketName,
                Key: dimensionKey
            }));
            const dimensionContent = await dimensionResponse.Body.transformToString();
            const dimensionResults = JSON.parse(dimensionContent);
            const contentKey = `sessions/${sessionId}/processed-content.json`;
            const contentResponse = await s3.send(new GetObjectCommand({
                Bucket: bucketName,
                Key: contentKey
            }));
            const contentStr = await contentResponse.Body.transformToString();
            const processedContent = JSON.parse(contentStr);
            let modelUsed = 'claude'; // default
            let analysisStartTime = Date.now(); // fallback
            try {
                const metadataKey = `sessions/${sessionId}/metadata.json`;
                const metadataResponse = await s3.send(new GetObjectCommand({
                    Bucket: bucketName,
                    Key: metadataKey
                }));
                const metadataStr = await metadataResponse.Body.transformToString();
                const metadata = JSON.parse(metadataStr);
                modelUsed = metadata.selectedModel || 'claude';
                analysisStartTime = metadata.startTime || Date.now();
            }
            catch (metadataError) {
                console.log('No metadata found, using default model and current time');
            }
            const actualAnalysisTime = Date.now() - analysisStartTime;
            const validScores = Object.values(dimensionResults)
                .filter((d) => d.score !== null && d.status === 'complete')
                .map((d) => d.score);
            const overallScore = validScores.length > 0
                ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
                : 0;
            let contextAnalysis = null;
            if (processedContent.contextAnalysis) {
                contextAnalysis = {
                    enabled: true,
                    contextPages: processedContent.contextAnalysis.contextPages || [],
                    analysisScope: processedContent.contextAnalysis.analysisScope || 'single-page',
                    totalPagesAnalyzed: processedContent.contextAnalysis.totalPagesAnalyzed || 1
                };
            }
            const report = {
                overallScore,
                dimensionsAnalyzed: validScores.length,
                dimensionsTotal: 5,
                confidence: validScores.length === 5 ? 'high' : validScores.length >= 3 ? 'medium' : 'low',
                modelUsed: modelUsed,
                cacheStatus: processedContent.cacheMetadata?.wasFromCache ? 'hit' : 'miss',
                dimensions: dimensionResults,
                codeAnalysis: {
                    snippetsFound: processedContent.enhancedCodeAnalysis?.analyzedSnippets || processedContent.codeSnippets?.length || 0,
                    syntaxErrors: processedContent.enhancedCodeAnalysis?.syntaxErrorFindings?.length || 0,
                    deprecatedMethods: processedContent.enhancedCodeAnalysis?.deprecatedCodeFindings?.length || 0,
                    missingVersionSpecs: processedContent.codeSnippets?.filter((s) => !s.hasVersionInfo).length || 0,
                    languagesDetected: processedContent.codeSnippets ? [...new Set(processedContent.codeSnippets.map((s) => s.language).filter(Boolean))] : [],
                    enhancedAnalysis: {
                        deprecatedFindings: processedContent.enhancedCodeAnalysis?.deprecatedCodeFindings || [],
                        syntaxErrorFindings: processedContent.enhancedCodeAnalysis?.syntaxErrorFindings || []
                    }
                },
                mediaAnalysis: {
                    videosFound: processedContent.mediaElements?.filter((m) => m.type === 'video').length || 0,
                    audiosFound: processedContent.mediaElements?.filter((m) => m.type === 'audio').length || 0,
                    imagesFound: processedContent.mediaElements?.filter((m) => m.type === 'image').length || 0,
                    interactiveElements: processedContent.mediaElements?.filter((m) => m.type === 'interactive').length || 0,
                    accessibilityIssues: processedContent.mediaElements?.filter((m) => m.analysisNote?.includes('accessibility')).length || 0,
                    missingAltText: processedContent.mediaElements?.filter((m) => m.type === 'image' && !m.alt).length || 0
                },
                linkAnalysis: processedContent.linkAnalysis || processedContent.enhancedLinkAnalysis || {},
                ...(contextAnalysis && { contextAnalysis }),
                urlSlugAnalysis: processedContent.urlSlugAnalysis || undefined,
                analysisTime: actualAnalysisTime,
                retryCount: 0,
                aiReadiness: undefined,
                sitemapHealth: undefined // Will be populated below
            };
            console.log('DEBUG: About to fetch AI Readiness for session:', sessionId);
            // [NEW] Try to fetch AI Readiness results
            try {
                const aiReadinessKey = `sessions/${sessionId}/ai-readiness-results.json`; // Fixed filename
                console.log(`Attempting to fetch AI Readiness from key: ${aiReadinessKey}`);
                const aiReadinessResponse = await s3.send(new GetObjectCommand({
                    Bucket: bucketName,
                    Key: aiReadinessKey
                }));
                const aiReadinessContent = await aiReadinessResponse.Body.transformToString();
                report.aiReadiness = JSON.parse(aiReadinessContent);
                console.log('Successfully retrieved AI Readiness results');
            }
            catch (aiError) {
                console.log('No AI Readiness results found:', aiError);
            }
            // [NEW] Try to fetch sitemap health for Doc Mode
            try {
                const sitemapHealthKey = `sessions/${sessionId}/doc-mode-sitemap-health.json`;
                console.log(`Attempting to fetch sitemap health from key: ${sitemapHealthKey}`);
                const sitemapHealthResponse = await s3.send(new GetObjectCommand({
                    Bucket: bucketName,
                    Key: sitemapHealthKey
                }));
                const sitemapHealthContent = await sitemapHealthResponse.Body.transformToString();
                const rawSitemapHealth = JSON.parse(sitemapHealthContent);
                // Add to report with default values for missing fields
                report.sitemapHealth = {
                    ...rawSitemapHealth,
                    brokenUrls: rawSitemapHealth.brokenUrls || 0,
                    accessDeniedUrls: rawSitemapHealth.accessDeniedUrls || 0,
                    timeoutUrls: rawSitemapHealth.timeoutUrls || 0,
                    otherErrorUrls: rawSitemapHealth.otherErrorUrls || 0
                };
                console.log('Successfully retrieved sitemap health results');
            }
            catch (sitemapError) {
                console.log('No sitemap health results found:', sitemapError);
            }
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    sessionId,
                    status: 'completed',
                    report
                })
            };
        }
        catch (docModeError) {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    sessionId,
                    status: 'in_progress',
                    message: 'Analysis in progress'
                })
            };
        }
    }
    catch (error) {
        console.error('Status check failed:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to check status',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
}
async function handleGithubIssuesRequest(body, corsHeaders, mode) {
    if (!body)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Request body is required' }) };
    try {
        const requestBody = JSON.parse(body);
        // Feature flag: route to agent Lambda if enabled
        // Note: 'fetch' stays on legacy path — agent fetch exceeds API Gateway 29s timeout
        // due to multiple LLM roundtrips in LangGraph loop
        const useAgent = process.env.USE_AGENT_FOR_GITHUB_ISSUES === 'true';
        if (useAgent && mode !== 'fetch') {
            return await routeToAgentLambda(requestBody, corsHeaders, mode);
        }
        // Legacy path: invoke github-issues-analyzer Lambda directly
        // When analyzing with crawlUrl, use async invoke (crawl+summarize can take >29s)
        if ((mode === 'analyze' || mode === 'build-kb') && requestBody.crawlUrl) {
            console.log(`Async invoke for crawl analysis: ${requestBody.crawlUrl}, sessionId: ${requestBody.sessionId}`);
            const invokeCommand = new client_lambda_1.InvokeCommand({
                FunctionName: process.env.GITHUB_ISSUES_ANALYZER_FUNCTION_NAME || 'LensyGitHubIssuesAnalyzerFunction',
                InvocationType: 'Event',
                Payload: JSON.stringify({ ...requestBody, mode })
            });
            await lambdaClient.send(invokeCommand);
            return {
                statusCode: 202,
                headers: corsHeaders,
                body: JSON.stringify({
                    status: 'processing',
                    message: 'Analysis started asynchronously. Results will be available via WebSocket and polling.',
                    sessionId: requestBody.sessionId
                })
            };
        }
        // Synchronous invoke for fetch, create-pr, and analyze without crawlUrl
        const invokeCommand = new client_lambda_1.InvokeCommand({
            FunctionName: process.env.GITHUB_ISSUES_ANALYZER_FUNCTION_NAME || 'LensyGitHubIssuesAnalyzerFunction',
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({ ...requestBody, mode })
        });
        const lambdaResponse = await lambdaClient.send(invokeCommand);
        const responsePayload = JSON.parse(new TextDecoder().decode(lambdaResponse.Payload));
        // If the lambda returned a proper API response, extract the body
        if (responsePayload.statusCode) {
            return {
                statusCode: responsePayload.statusCode,
                headers: corsHeaders,
                body: responsePayload.body
            };
        }
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(responsePayload)
        };
    }
    catch (error) {
        console.error('GitHub issues request error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: `GitHub issues analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}` })
        };
    }
}
/**
 * Route GitHub Issues requests to the Agent Handler Lambda (LangGraph + MCP).
 * Maps API modes to agent operations and handles sync/async invocations.
 */
async function routeToAgentLambda(requestBody, corsHeaders, mode) {
    const agentFunctionName = process.env.AGENT_HANDLER_FUNCTION_NAME;
    if (!agentFunctionName) {
        throw new Error('AGENT_HANDLER_FUNCTION_NAME environment variable not set');
    }
    // Map API mode to agent operation
    const operationMap = {
        'fetch': 'fetch',
        'analyze': 'analyze',
        'build-kb': 'build-kb',
        'create-pr': 'create-pr'
    };
    const agentPayload = {
        mode: 'github-issues',
        operation: operationMap[mode] || mode,
        owner: requestBody.owner,
        repo: requestBody.repo,
        issues: requestBody.issues,
        docsUrl: requestBody.docsUrl,
        crawlUrl: requestBody.crawlUrl,
        filePath: requestBody.filePath,
        originalText: requestBody.originalText,
        correctedText: requestBody.correctedText,
        issueNumber: requestBody.issueNumber,
        issueTitle: requestBody.issueTitle,
        gapType: requestBody.gapType,
        confidence: requestBody.confidence,
        sessionId: requestBody.sessionId,
    };
    // Async: build-kb and analyze are always async through agent (long-running operations)
    // The agent orchestrates KB building + analysis which can take minutes
    const isAsync = (mode === 'build-kb') || (mode === 'analyze');
    if (isAsync) {
        console.log(`[Agent] Async invoke for ${mode}, sessionId: ${requestBody.sessionId}`);
        const invokeCommand = new client_lambda_1.InvokeCommand({
            FunctionName: agentFunctionName,
            InvocationType: 'Event',
            Payload: JSON.stringify(agentPayload)
        });
        await lambdaClient.send(invokeCommand);
        return {
            statusCode: 202,
            headers: corsHeaders,
            body: JSON.stringify({
                status: 'processing',
                message: 'Analysis started asynchronously via agent. Results will be available via WebSocket and polling.',
                sessionId: requestBody.sessionId,
                engine: 'agent'
            })
        };
    }
    // Sync: fetch, create-pr, analyze without crawlUrl
    console.log(`[Agent] Sync invoke for ${mode}`);
    const invokeCommand = new client_lambda_1.InvokeCommand({
        FunctionName: agentFunctionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(agentPayload)
    });
    const lambdaResponse = await lambdaClient.send(invokeCommand);
    const responsePayload = JSON.parse(new TextDecoder().decode(lambdaResponse.Payload));
    // Agent handler returns { statusCode, headers, body } for sync operations
    if (responsePayload.statusCode) {
        return {
            statusCode: responsePayload.statusCode,
            headers: corsHeaders,
            body: responsePayload.body
        };
    }
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(responsePayload)
    };
}
async function handleGithubIssuesResultsRequest(path, corsHeaders) {
    const parts = path.split('/');
    const sessionId = parts[3]; // /github-issues/results/{sessionId}
    if (!sessionId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Session ID is required' }) };
    }
    try {
        const bucketName = process.env.ANALYSIS_BUCKET || 'lensy-analysis-951411676525-us-east-1';
        const key = `github-issues-results/${sessionId}.json`;
        console.log(`Fetching GitHub issues results for session ${sessionId} from ${bucketName}/${key}`);
        const response = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: key
        }));
        const content = await response.Body?.transformToString();
        if (!content)
            throw new Error('Empty response from S3');
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: content
        };
    }
    catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return {
                statusCode: 202,
                headers: corsHeaders,
                body: JSON.stringify({ status: 'processing', message: 'Analysis still in progress', sessionId })
            };
        }
        console.error('Failed to get GitHub issues results:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Failed to retrieve results', message: error instanceof Error ? error.message : 'Unknown error' })
        };
    }
}
// ─── Preview Docs (lightweight — no crawl, no Bedrock) ──────────────────────
// Fetches llms.txt or sitemap.xml at a domain to show user what will be crawled.
function quickFetch(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new url_1.URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: { 'User-Agent': 'Lensy-Preview/1.0', 'Accept': 'text/plain,text/xml,application/xml,*/*' }
        };
        const req = https.request(options, (res) => {
            // Follow single redirect
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                quickFetch(res.headers.location, timeoutMs).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}
async function handlePreviewDocsRequest(rawDomain, corsHeaders) {
    if (!rawDomain) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'domain query parameter is required' }) };
    }
    // Normalize domain: strip protocol, www, trailing slash
    let domain = rawDomain.trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
    if (!domain) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid domain provided' }) };
    }
    const baseUrl = `https://${domain}`;
    // Check S3 cache — if KB already exists, tell the frontend so it can skip "Build Knowledge Base" button
    let cached = false;
    let cachedPageCount = 0;
    let cachedAt = null;
    try {
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (bucketName) {
            const safeDomain = domain.replace(/[^a-zA-Z0-9._-]/g, '_');
            const cacheKey = `${safeDomain}/llms-cache.json`;
            const cacheResponse = await s3Client.send(new client_s3_1.GetObjectCommand({
                Bucket: bucketName,
                Key: cacheKey
            }));
            const cacheBody = await cacheResponse.Body?.transformToString();
            if (cacheBody) {
                const cacheData = JSON.parse(cacheBody);
                // Validate TTL (168 hours = 7 days)
                const cacheAge = Date.now() - new Date(cacheData.createdAt).getTime();
                const ttlMs = 168 * 60 * 60 * 1000;
                if (cacheAge <= ttlMs) {
                    cached = true;
                    cachedPageCount = cacheData.pageCount || 0;
                    cachedAt = cacheData.createdAt;
                }
            }
        }
    }
    catch {
        // No cache or error — proceed normally
    }
    // Try llms.txt first
    try {
        const llmsTxt = await quickFetch(`${baseUrl}/llms.txt`);
        if (llmsTxt && llmsTxt.length > 50) {
            // Count pages and extract top-level categories from heading hierarchy
            const lines = llmsTxt.split('\n');
            const pageLinks = lines.filter(l => /\[.+\]\(.+\)/.test(l.trim()));
            const categories = lines
                .filter(l => l.match(/^-\s+[A-Z]/) && !l.includes('[')).map(l => l.replace(/^-\s+/, '').trim())
                .concat(lines.filter(l => l.startsWith('## ') || l.startsWith('# '))
                .map(l => l.replace(/^#+\s+/, '').trim()))
                .filter(Boolean).slice(0, 10);
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    found: true,
                    source: 'llms.txt',
                    sourceUrl: `${baseUrl}/llms.txt`,
                    pageCount: pageLinks.length || Math.floor(llmsTxt.length / 80),
                    categories,
                    domain,
                    cached,
                    cachedPageCount,
                    cachedAt
                })
            };
        }
    }
    catch { /* llms.txt not found, try sitemap */ }
    // Try sitemap.xml
    try {
        const sitemap = await quickFetch(`${baseUrl}/sitemap.xml`);
        if (sitemap && sitemap.length > 50) {
            const urlMatches = sitemap.match(/<loc>(.*?)<\/loc>/gi) || [];
            const urls = urlMatches.map(m => m.replace(/<\/?loc>/gi, '').trim());
            const docsPatterns = [/\/docs\//i, /\/documentation\//i, /\/guide/i, /\/tutorial/i, /\/api\//i, /\/reference/i];
            const docsUrls = urls.filter(u => docsPatterns.some(p => p.test(u)));
            const displayUrls = docsUrls.length > 0 ? docsUrls : urls;
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    found: true,
                    source: 'sitemap.xml',
                    sourceUrl: `${baseUrl}/sitemap.xml`,
                    pageCount: displayUrls.length,
                    categories: [],
                    domain,
                    cached,
                    cachedPageCount,
                    cachedAt
                })
            };
        }
    }
    catch { /* sitemap not found either */ }
    // Neither found
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            found: false,
            source: null,
            domain,
            message: `Could not find llms.txt or sitemap.xml at ${domain}. Please check the URL or provide the direct link to your llms.txt / sitemap.xml.`
        })
    };
}
async function handleDiscoverIssuesRequest(body, corsHeaders) {
    // ... (rest of the file remains same)
    if (!body)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Request body is required' }) };
    let discoverRequest;
    try {
        discoverRequest = JSON.parse(body);
    }
    catch (error) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }
    const { companyName, domain, sessionId } = discoverRequest;
    if (!domain || !sessionId)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing required fields: domain and sessionId' }) };
    try {
        const invokeParams = {
            FunctionName: process.env.ISSUE_DISCOVERER_FUNCTION_NAME || 'lensy-issue-discoverer',
            Payload: JSON.stringify({ body: JSON.stringify({ companyName, domain, sessionId }) })
        };
        const result = await lambdaClient.send(new client_lambda_1.InvokeCommand(invokeParams));
        if (result.Payload) {
            const responsePayload = JSON.parse(new TextDecoder().decode(result.Payload));
            if (responsePayload.statusCode === 200) {
                const issueResults = JSON.parse(responsePayload.body);
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(issueResults) };
            }
            else
                throw new Error(`IssueDiscoverer failed: ${responsePayload.body}`);
        }
        else
            throw new Error('No response payload from IssueDiscoverer');
    }
    catch (error) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Issue discovery failed', message: error instanceof Error ? error.message : 'Unknown error' }) };
    }
}
async function handleValidateIssuesRequest(body, corsHeaders) {
    if (!body)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Request body is required' }) };
    let validateRequest;
    try {
        validateRequest = JSON.parse(body);
    }
    catch (error) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }
    const { issues, domain, sessionId } = validateRequest;
    if (!issues || !domain || !sessionId)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing required fields: issues, domain, and sessionId' }) };
    try {
        const invokeParams = {
            FunctionName: process.env.ISSUE_VALIDATOR_FUNCTION_NAME || 'lensy-issue-validator',
            Payload: JSON.stringify({ body: JSON.stringify({ issues, domain, sessionId }) })
        };
        const result = await lambdaClient.send(new client_lambda_1.InvokeCommand(invokeParams));
        if (result.Payload) {
            const responsePayload = JSON.parse(new TextDecoder().decode(result.Payload));
            if (responsePayload.statusCode === 200) {
                const validationResults = JSON.parse(responsePayload.body);
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(validationResults) };
            }
            else
                throw new Error(`IssueValidator failed: ${responsePayload.body}`);
        }
        else
            throw new Error('No response payload from IssueValidator');
    }
    catch (error) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Issue validation failed', message: error instanceof Error ? error.message : 'Unknown error' }) };
    }
}
async function handleGenerateFixesRequest(body, corsHeaders) {
    if (!body)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Request body is required' }) };
    let request;
    try {
        request = JSON.parse(body);
    }
    catch (error) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }
    if (!request.sessionId)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing required field: sessionId' }) };
    try {
        console.log(`Invoking FixGenerator ASYNC for session ${request.sessionId}`);
        const invokeParams = {
            FunctionName: process.env.FIX_GENERATOR_FUNCTION_NAME || 'LensyStack-FixGeneratorFunction',
            InvocationType: 'Event',
            Payload: JSON.stringify({ body: JSON.stringify(request) })
        };
        await lambdaClient.send(new client_lambda_1.InvokeCommand(invokeParams));
        return {
            statusCode: 202,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: 'Fix generation started asynchronously',
                sessionId: request.sessionId
            })
        };
    }
    catch (error) {
        console.error('Fix generation failed:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Fix generation failed', message: error instanceof Error ? error.message : 'Unknown error' })
        };
    }
}
async function handleApplyFixesRequest(body, corsHeaders) {
    if (!body)
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Request body is required' }) };
    let request;
    try {
        request = JSON.parse(body);
    }
    catch (error) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }
    if (!request.sessionId || !request.selectedFixIds) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing required fields: sessionId and selectedFixIds' }) };
    }
    try {
        console.log(`Invoking FixApplicator for session ${request.sessionId}`);
        const invokeParams = {
            FunctionName: process.env.FIX_APPLICATOR_FUNCTION_NAME || 'LensyStack-FixApplicatorFunction',
            Payload: JSON.stringify({ body: JSON.stringify(request) }) // Pass as API Gateway proxy event body
        };
        const result = await lambdaClient.send(new client_lambda_1.InvokeCommand(invokeParams));
        if (result.Payload) {
            const responsePayload = JSON.parse(new TextDecoder().decode(result.Payload));
            console.log('FixApplicator response:', responsePayload);
            // Check for Lambda execution errors (e.g. Runtime.ImportModuleError)
            if (responsePayload.errorType || responsePayload.errorMessage) {
                throw new Error(`FixApplicator Lambda Error: ${responsePayload.errorMessage || responsePayload.errorType}`);
            }
            // Handle both direct invocation response and proxy response
            const responseBody = responsePayload.body ? JSON.parse(responsePayload.body) : responsePayload;
            const statusCode = responsePayload.statusCode || 200;
            return {
                statusCode,
                headers: corsHeaders,
                body: JSON.stringify(responseBody)
            };
        }
        else {
            throw new Error('No response payload from FixApplicator');
        }
    }
    catch (error) {
        console.error('Fix application failed:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Fix application failed', message: error instanceof Error ? error.message : 'Unknown error' })
        };
    }
}
async function handleGetFixesRequest(path, corsHeaders) {
    // Extract sessionId: 
    // Format 1: /get-fixes/{sessionId}
    // Format 2: /sessions/{sessionId}/fixes
    const parts = path.split('/');
    let sessionId = '';
    if (path.startsWith('/get-fixes/')) {
        sessionId = parts[2];
    }
    else if (path.startsWith('/sessions/')) {
        sessionId = parts[2];
    }
    if (!sessionId) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Session ID is required' })
        };
    }
    try {
        const bucketName = process.env.ANALYSIS_BUCKET || 'lensy-analysis-951411676525-us-east-1';
        const fixesKey = `sessions/${sessionId}/fixes.json`;
        console.log(`Fetching fixes for session ${sessionId} from ${bucketName}/${fixesKey}`);
        const response = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: fixesKey
        }));
        const content = await response.Body?.transformToString();
        if (!content)
            throw new Error('Empty response from S3');
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: content
        };
    }
    catch (error) {
        console.error('Failed to get fixes:', error);
        if (error.name === 'NoSuchKey') {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Fixes not found for this session', sessionId })
            };
        }
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to retrieve fixes',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9sYW1iZGEvYXBpLWhhbmRsZXIvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxvREFBaUc7QUFDakcsa0RBQWdFO0FBQ2hFLDBEQUFxRTtBQUNyRSw2Q0FBK0I7QUFDL0IsNkJBQTBCO0FBRTFCLE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBQ25GLE1BQU0sUUFBUSxHQUFHLElBQUksb0JBQVEsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBQ2pGLE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBZWxGLE1BQU0sT0FBTyxHQUFzQixLQUFLLEVBQUUsS0FBVSxFQUFFLEVBQUU7SUFDM0QsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO0lBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFN0Usa0RBQWtEO0lBQ2xELE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLGNBQWMsRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDO0lBQzFFLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUM7SUFDN0UsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQztJQUV4QixPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFFNUQsZUFBZTtJQUNmLE1BQU0sV0FBVyxHQUFHO1FBQ2hCLDZCQUE2QixFQUFFLEdBQUc7UUFDbEMsOEJBQThCLEVBQUUsaURBQWlEO1FBQ2pGLDhCQUE4QixFQUFFLGtCQUFrQjtRQUNsRCxjQUFjLEVBQUUsa0JBQWtCO0tBQ3JDLENBQUM7SUFFRix3QkFBd0I7SUFDeEIsSUFBSSxVQUFVLEtBQUssU0FBUyxFQUFFO1FBQzFCLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxFQUFFO1NBQ1gsQ0FBQztLQUNMO0lBRUQsSUFBSTtRQUNBLElBQUksVUFBVSxLQUFLLE1BQU0sSUFBSSxDQUFDLElBQUksS0FBSyxVQUFVLElBQUksSUFBSSxLQUFLLFdBQVcsQ0FBQyxFQUFFO1lBQ3hFLE9BQU8sTUFBTSxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDeEQ7UUFFRCxJQUFJLFVBQVUsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLGdCQUFnQixFQUFFO1lBQ3BELE9BQU8sTUFBTSx5QkFBeUIsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1NBQ3RFO1FBRUQsSUFBSSxVQUFVLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyx3QkFBd0IsRUFBRTtZQUM1RCxPQUFPLE1BQU0seUJBQXlCLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQztTQUN4RTtRQUVELElBQUksVUFBVSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUsseUJBQXlCLEVBQUU7WUFDN0QsT0FBTyxNQUFNLHlCQUF5QixDQUFDLElBQUksRUFBRSxXQUFXLEVBQUUsVUFBVSxDQUFDLENBQUM7U0FDekU7UUFFRCxJQUFJLFVBQVUsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLDBCQUEwQixFQUFFO1lBQzlELE9BQU8sTUFBTSx5QkFBeUIsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQzFFO1FBRUQsSUFBSSxVQUFVLEtBQUssS0FBSyxJQUFJLElBQUksRUFBRSxVQUFVLENBQUMseUJBQXlCLENBQUMsRUFBRTtZQUNyRSxPQUFPLE1BQU0sZ0NBQWdDLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQ3BFO1FBRUQsSUFBSSxVQUFVLEtBQUssS0FBSyxJQUFJLElBQUksS0FBSyw2QkFBNkIsRUFBRTtZQUNoRSxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMscUJBQXFCLElBQUksRUFBRSxDQUFDO1lBQ3RELE9BQU8sTUFBTSx3QkFBd0IsQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQzFFO1FBRUQsSUFBSSxVQUFVLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxrQkFBa0IsRUFBRTtZQUN0RCxPQUFPLE1BQU0sMkJBQTJCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQy9EO1FBRUQsSUFBSSxVQUFVLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxrQkFBa0IsRUFBRTtZQUN0RCxPQUFPLE1BQU0sMkJBQTJCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQy9EO1FBRUQsSUFBSSxVQUFVLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxpQkFBaUIsRUFBRTtZQUNyRCxPQUFPLE1BQU0sMEJBQTBCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQzlEO1FBRUQsSUFBSSxVQUFVLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxjQUFjLEVBQUU7WUFDbEQsT0FBTyxNQUFNLHVCQUF1QixDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQztTQUMzRDtRQUVELElBQUksVUFBVSxLQUFLLEtBQUssSUFBSSxJQUFJLEVBQUUsVUFBVSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1lBQ3RELE9BQU8sTUFBTSxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDdkQ7UUFFRCxJQUFJLFVBQVUsS0FBSyxLQUFLLElBQUksQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLFlBQVksQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRTtZQUNyRixPQUFPLE1BQU0scUJBQXFCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQ3pEO1FBRUQsSUFBSSxVQUFVLEtBQUssS0FBSyxJQUFJLElBQUksRUFBRSxVQUFVLENBQUMsYUFBYSxDQUFDLEVBQUU7WUFDekQsT0FBTyxNQUFNLHFCQUFxQixDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQztTQUN6RDtRQUVELE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQixLQUFLLEVBQUUsV0FBVztnQkFDbEIsTUFBTSxFQUFFLFVBQVU7Z0JBQ2xCLElBQUksRUFBRSxJQUFJO2dCQUNWLGVBQWUsRUFBRTtvQkFDYixlQUFlO29CQUNmLHVCQUF1QjtvQkFDdkIsdUJBQXVCO29CQUN2Qix5QkFBeUI7b0JBQ3pCLDRCQUE0QjtvQkFDNUIsaUNBQWlDO2lCQUNwQzthQUNKLENBQUM7U0FDTCxDQUFDO0tBRUw7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNaLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0MsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ2pCLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlO2FBQ3BFLENBQUM7U0FDTCxDQUFDO0tBQ0w7QUFDTCxDQUFDLENBQUM7QUFuSFcsUUFBQSxPQUFPLFdBbUhsQjtBQUVGLEtBQUssVUFBVSxvQkFBb0IsQ0FBQyxJQUFtQixFQUFFLFdBQW1DO0lBQ3hGLElBQUksQ0FBQyxJQUFJLEVBQUU7UUFDUCxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSwwQkFBMEIsRUFBRSxDQUFDO1NBQzlELENBQUM7S0FDTDtJQUVELElBQUksZUFBZ0MsQ0FBQztJQUVyQyxJQUFJO1FBQ0EsZUFBZSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7S0FDdEM7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNaLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDhCQUE4QixFQUFFLENBQUM7U0FDbEUsQ0FBQztLQUNMO0lBRUQsbUJBQW1CO0lBQ25CLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLFNBQVMsRUFBRTtRQUNwRCxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsS0FBSyxFQUFFLHlEQUF5RDthQUNuRSxDQUFDO1NBQ0wsQ0FBQztLQUNMO0lBRUQsc0JBQXNCO0lBQ3RCLElBQUk7UUFDQSxJQUFJLFNBQUcsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDaEM7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNaLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLG9CQUFvQixFQUFFLENBQUM7U0FDeEQsQ0FBQztLQUNMO0lBRUQsaUNBQWlDO0lBQ2pDLE1BQU0sYUFBYSxHQUFHLFlBQVksZUFBZSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQztJQUM1RSxNQUFNLGVBQWUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDO0lBRXRELElBQUksQ0FBQyxlQUFlLEVBQUU7UUFDbEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QsQ0FBQyxDQUFDO0tBQ3JFO0lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQ0FBb0MsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUVqRSxNQUFNLHFCQUFxQixHQUFHLElBQUksa0NBQXFCLENBQUM7UUFDcEQsZUFBZTtRQUNmLElBQUksRUFBRSxhQUFhO1FBQ25CLEtBQUssRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO1lBQ2xCLEdBQUcsZUFBZTtZQUNsQixpQkFBaUIsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1NBQ2hDLENBQUM7S0FDTCxDQUFDLENBQUM7SUFFSCxNQUFNLFNBQVMsR0FBRyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztJQUU5RCxPQUFPLENBQUMsR0FBRyxDQUFDLCtCQUErQixTQUFTLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQztJQUVyRSxPQUFPO1FBQ0gsVUFBVSxFQUFFLEdBQUc7UUFDZixPQUFPLEVBQUUsV0FBVztRQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztZQUNqQixPQUFPLEVBQUUsa0JBQWtCO1lBQzNCLFlBQVksRUFBRSxTQUFTLENBQUMsWUFBWTtZQUNwQyxTQUFTLEVBQUUsZUFBZSxDQUFDLFNBQVM7WUFDcEMsTUFBTSxFQUFFLFNBQVM7U0FDcEIsQ0FBQztLQUNMLENBQUM7QUFDTixDQUFDO0FBRUQsS0FBSyxVQUFVLG1CQUFtQixDQUFDLElBQVksRUFBRSxXQUFtQztJQUNoRixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXJDLElBQUksQ0FBQyxTQUFTLEVBQUU7UUFDWixPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSx3QkFBd0IsRUFBRSxDQUFDO1NBQzVELENBQUM7S0FDTDtJQUVELElBQUk7UUFDQSxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsSUFBSSx1Q0FBdUMsQ0FBQztRQUUxRixzQ0FBc0M7UUFDdEMsTUFBTSxFQUFFLFFBQVEsRUFBRSxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3JFLE1BQU0sRUFBRSxHQUFHLElBQUksUUFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFFM0UsNkVBQTZFO1FBQzdFLElBQUk7WUFDQSxNQUFNLGdCQUFnQixHQUFHLFlBQVksU0FBUyw4QkFBOEIsQ0FBQztZQUM3RSxNQUFNLHFCQUFxQixHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLGdCQUFnQixDQUFDO2dCQUM3RCxNQUFNLEVBQUUsVUFBVTtnQkFDbEIsR0FBRyxFQUFFLGdCQUFnQjthQUN4QixDQUFDLENBQUMsQ0FBQztZQUVKLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNsRixNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUU5RCxPQUFPLENBQUMsR0FBRyxDQUFDLHFEQUFxRCxDQUFDLENBQUM7WUFFbkUsa0NBQWtDO1lBQ2xDLElBQUksaUJBQWlCLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsV0FBVztZQUMvQyxJQUFJO2dCQUNBLE1BQU0sV0FBVyxHQUFHLFlBQVksU0FBUyxnQkFBZ0IsQ0FBQztnQkFDMUQsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQztvQkFDeEQsTUFBTSxFQUFFLFVBQVU7b0JBQ2xCLEdBQUcsRUFBRSxXQUFXO2lCQUNuQixDQUFDLENBQUMsQ0FBQztnQkFDSixNQUFNLFdBQVcsR0FBRyxNQUFNLGdCQUFnQixDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUNwRSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO2dCQUN6QyxpQkFBaUIsR0FBRyxRQUFRLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQzthQUN4RDtZQUFDLE9BQU8sYUFBYSxFQUFFO2dCQUNwQixPQUFPLENBQUMsR0FBRyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7YUFDeEQ7WUFFRCxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxpQkFBaUIsQ0FBQztZQUMxRCxNQUFNLGdCQUFnQixHQUFHLG9CQUFvQixDQUFDLGdCQUFnQixJQUFJLENBQUMsQ0FBQztZQUVwRSxNQUFNLE1BQU0sR0FBRztnQkFDWCxZQUFZLEVBQUUsZ0JBQWdCO2dCQUM5QixrQkFBa0IsRUFBRSxDQUFDO2dCQUNyQixlQUFlLEVBQUUsQ0FBQztnQkFDbEIsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLFNBQVMsRUFBRSx3QkFBd0I7Z0JBQ25DLFdBQVcsRUFBRSxNQUFNO2dCQUNuQixVQUFVLEVBQUUsRUFBRTtnQkFDZCxZQUFZLEVBQUU7b0JBQ1YsYUFBYSxFQUFFLENBQUM7b0JBQ2hCLFlBQVksRUFBRSxDQUFDO29CQUNmLGlCQUFpQixFQUFFLENBQUM7b0JBQ3BCLG1CQUFtQixFQUFFLENBQUM7b0JBQ3RCLGlCQUFpQixFQUFFLEVBQUU7aUJBQ3hCO2dCQUNELGFBQWEsRUFBRTtvQkFDWCxXQUFXLEVBQUUsQ0FBQztvQkFDZCxXQUFXLEVBQUUsQ0FBQztvQkFDZCxXQUFXLEVBQUUsQ0FBQztvQkFDZCxtQkFBbUIsRUFBRSxDQUFDO29CQUN0QixtQkFBbUIsRUFBRSxDQUFDO29CQUN0QixjQUFjLEVBQUUsQ0FBQztpQkFDcEI7Z0JBQ0QsWUFBWSxFQUFFO29CQUNWLFVBQVUsRUFBRSxDQUFDO29CQUNiLGFBQWEsRUFBRSxDQUFDO29CQUNoQixhQUFhLEVBQUUsQ0FBQztvQkFDaEIsV0FBVyxFQUFFLENBQUM7b0JBQ2Qsa0JBQWtCLEVBQUUsRUFBRTtvQkFDdEIsV0FBVyxFQUFFLGFBQWE7b0JBQzFCLGFBQWEsRUFBRSxtQkFBbUI7aUJBQ3JDO2dCQUNELGFBQWEsRUFBRTtvQkFDWCxTQUFTLEVBQUUsb0JBQW9CLENBQUMsU0FBUztvQkFDekMsV0FBVyxFQUFFLG9CQUFvQixDQUFDLFdBQVc7b0JBQzdDLFVBQVUsRUFBRSxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUMxRyxnQkFBZ0IsRUFBRSxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsU0FBUyxLQUFLLGVBQWUsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUMxSCxXQUFXLEVBQUUsb0JBQW9CLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDLEtBQVUsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQztvQkFDL0csY0FBYyxFQUFFLG9CQUFvQixDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQyxLQUFVLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLEtBQUssT0FBTyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQ2hILGdCQUFnQixFQUFFLG9CQUFvQixDQUFDLGdCQUFnQjtvQkFDdkQsVUFBVSxFQUFFLG9CQUFvQixDQUFDLFVBQVUsSUFBSSxFQUFFO29CQUNqRCxjQUFjLEVBQUUsb0JBQW9CLENBQUMsY0FBYztpQkFDdEQ7Z0JBQ0QsWUFBWSxFQUFFLGtCQUFrQjtnQkFDaEMsVUFBVSxFQUFFLENBQUM7YUFDaEIsQ0FBQztZQUVGLE9BQU87Z0JBQ0gsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNqQixTQUFTO29CQUNULE1BQU0sRUFBRSxXQUFXO29CQUNuQixNQUFNO2lCQUNULENBQUM7YUFDTCxDQUFDO1NBRUw7UUFBQyxPQUFPLFlBQVksRUFBRTtZQUNuQixPQUFPLENBQUMsR0FBRyxDQUFDLGdFQUFnRSxDQUFDLENBQUM7U0FDakY7UUFFRCx3Q0FBd0M7UUFDeEMsSUFBSTtZQUNBLE1BQU0sWUFBWSxHQUFHLFlBQVksU0FBUyx5QkFBeUIsQ0FBQztZQUNwRSxNQUFNLGlCQUFpQixHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLGdCQUFnQixDQUFDO2dCQUN6RCxNQUFNLEVBQUUsVUFBVTtnQkFDbEIsR0FBRyxFQUFFLFlBQVk7YUFDcEIsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLGdCQUFnQixHQUFHLE1BQU0saUJBQWlCLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDMUUsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFFdEQsTUFBTSxVQUFVLEdBQUcsWUFBWSxTQUFTLHlCQUF5QixDQUFDO1lBQ2xFLE1BQU0sZUFBZSxHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLGdCQUFnQixDQUFDO2dCQUN2RCxNQUFNLEVBQUUsVUFBVTtnQkFDbEIsR0FBRyxFQUFFLFVBQVU7YUFDbEIsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLFVBQVUsR0FBRyxNQUFNLGVBQWUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNsRSxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUM7WUFFaEQsSUFBSSxTQUFTLEdBQUcsUUFBUSxDQUFDLENBQUMsVUFBVTtZQUNwQyxJQUFJLGlCQUFpQixHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLFdBQVc7WUFDL0MsSUFBSTtnQkFDQSxNQUFNLFdBQVcsR0FBRyxZQUFZLFNBQVMsZ0JBQWdCLENBQUM7Z0JBQzFELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksZ0JBQWdCLENBQUM7b0JBQ3hELE1BQU0sRUFBRSxVQUFVO29CQUNsQixHQUFHLEVBQUUsV0FBVztpQkFDbkIsQ0FBQyxDQUFDLENBQUM7Z0JBQ0osTUFBTSxXQUFXLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztnQkFDcEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQztnQkFDekMsU0FBUyxHQUFHLFFBQVEsQ0FBQyxhQUFhLElBQUksUUFBUSxDQUFDO2dCQUMvQyxpQkFBaUIsR0FBRyxRQUFRLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQzthQUN4RDtZQUFDLE9BQU8sYUFBYSxFQUFFO2dCQUNwQixPQUFPLENBQUMsR0FBRyxDQUFDLHlEQUF5RCxDQUFDLENBQUM7YUFDMUU7WUFFRCxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxpQkFBaUIsQ0FBQztZQUUxRCxNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDO2lCQUM5QyxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLEtBQUssSUFBSSxJQUFJLENBQUMsQ0FBQyxNQUFNLEtBQUssVUFBVSxDQUFDO2lCQUMvRCxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUU5QixNQUFNLFlBQVksR0FBRyxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUM7Z0JBQ3ZDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFXLEVBQUUsS0FBYSxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUM7Z0JBQ3JHLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFUixJQUFJLGVBQWUsR0FBRyxJQUFJLENBQUM7WUFDM0IsSUFBSSxnQkFBZ0IsQ0FBQyxlQUFlLEVBQUU7Z0JBQ2xDLGVBQWUsR0FBRztvQkFDZCxPQUFPLEVBQUUsSUFBSTtvQkFDYixZQUFZLEVBQUUsZ0JBQWdCLENBQUMsZUFBZSxDQUFDLFlBQVksSUFBSSxFQUFFO29CQUNqRSxhQUFhLEVBQUUsZ0JBQWdCLENBQUMsZUFBZSxDQUFDLGFBQWEsSUFBSSxhQUFhO29CQUM5RSxrQkFBa0IsRUFBRSxnQkFBZ0IsQ0FBQyxlQUFlLENBQUMsa0JBQWtCLElBQUksQ0FBQztpQkFDL0UsQ0FBQzthQUNMO1lBRUQsTUFBTSxNQUFNLEdBQUc7Z0JBQ1gsWUFBWTtnQkFDWixrQkFBa0IsRUFBRSxXQUFXLENBQUMsTUFBTTtnQkFDdEMsZUFBZSxFQUFFLENBQUM7Z0JBQ2xCLFVBQVUsRUFBRSxXQUFXLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLO2dCQUMxRixTQUFTLEVBQUUsU0FBUztnQkFDcEIsV0FBVyxFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTTtnQkFDMUUsVUFBVSxFQUFFLGdCQUFnQjtnQkFDNUIsWUFBWSxFQUFFO29CQUNWLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxvQkFBb0IsRUFBRSxnQkFBZ0IsSUFBSSxnQkFBZ0IsQ0FBQyxZQUFZLEVBQUUsTUFBTSxJQUFJLENBQUM7b0JBQ3BILFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxvQkFBb0IsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLElBQUksQ0FBQztvQkFDckYsaUJBQWlCLEVBQUUsZ0JBQWdCLENBQUMsb0JBQW9CLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSxJQUFJLENBQUM7b0JBQzdGLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUNyRyxpQkFBaUIsRUFBRSxnQkFBZ0IsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtvQkFDL0ksZ0JBQWdCLEVBQUU7d0JBQ2Qsa0JBQWtCLEVBQUUsZ0JBQWdCLENBQUMsb0JBQW9CLEVBQUUsc0JBQXNCLElBQUksRUFBRTt3QkFDdkYsbUJBQW1CLEVBQUUsZ0JBQWdCLENBQUMsb0JBQW9CLEVBQUUsbUJBQW1CLElBQUksRUFBRTtxQkFDeEY7aUJBQ0o7Z0JBQ0QsYUFBYSxFQUFFO29CQUNYLFdBQVcsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUMvRixXQUFXLEVBQUUsZ0JBQWdCLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxPQUFPLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQztvQkFDL0YsV0FBVyxFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssT0FBTyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQy9GLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssYUFBYSxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQzdHLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLEVBQUUsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQzlILGNBQWMsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQztpQkFDL0c7Z0JBQ0QsWUFBWSxFQUFFLGdCQUFnQixDQUFDLFlBQVksSUFBSSxnQkFBZ0IsQ0FBQyxvQkFBb0IsSUFBSSxFQUFFO2dCQUMxRixHQUFHLENBQUMsZUFBZSxJQUFJLEVBQUUsZUFBZSxFQUFFLENBQUM7Z0JBQzNDLGVBQWUsRUFBRSxnQkFBZ0IsQ0FBQyxlQUFlLElBQUksU0FBUztnQkFDOUQsWUFBWSxFQUFFLGtCQUFrQjtnQkFDaEMsVUFBVSxFQUFFLENBQUM7Z0JBQ2IsV0FBVyxFQUFFLFNBQVM7Z0JBQ3RCLGFBQWEsRUFBRSxTQUFTLENBQUMsMEJBQTBCO2FBQ3RELENBQUM7WUFFRixPQUFPLENBQUMsR0FBRyxDQUFDLGlEQUFpRCxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBRTFFLDBDQUEwQztZQUMxQyxJQUFJO2dCQUNBLE1BQU0sY0FBYyxHQUFHLFlBQVksU0FBUyw0QkFBNEIsQ0FBQyxDQUFDLGlCQUFpQjtnQkFDM0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4Q0FBOEMsY0FBYyxFQUFFLENBQUMsQ0FBQztnQkFDNUUsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQztvQkFDM0QsTUFBTSxFQUFFLFVBQVU7b0JBQ2xCLEdBQUcsRUFBRSxjQUFjO2lCQUN0QixDQUFDLENBQUMsQ0FBQztnQkFDSixNQUFNLGtCQUFrQixHQUFHLE1BQU0sbUJBQW1CLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7Z0JBQzlFLE1BQU0sQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO2dCQUNwRCxPQUFPLENBQUMsR0FBRyxDQUFDLDZDQUE2QyxDQUFDLENBQUM7YUFDOUQ7WUFBQyxPQUFPLE9BQU8sRUFBRTtnQkFDZCxPQUFPLENBQUMsR0FBRyxDQUFDLGdDQUFnQyxFQUFFLE9BQU8sQ0FBQyxDQUFDO2FBQzFEO1lBRUQsaURBQWlEO1lBQ2pELElBQUk7Z0JBQ0EsTUFBTSxnQkFBZ0IsR0FBRyxZQUFZLFNBQVMsK0JBQStCLENBQUM7Z0JBQzlFLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0RBQWdELGdCQUFnQixFQUFFLENBQUMsQ0FBQztnQkFDaEYsTUFBTSxxQkFBcUIsR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQztvQkFDN0QsTUFBTSxFQUFFLFVBQVU7b0JBQ2xCLEdBQUcsRUFBRSxnQkFBZ0I7aUJBQ3hCLENBQUMsQ0FBQyxDQUFDO2dCQUNKLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztnQkFDbEYsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUM7Z0JBRTFELHVEQUF1RDtnQkFDdkQsTUFBTSxDQUFDLGFBQWEsR0FBRztvQkFDbkIsR0FBRyxnQkFBZ0I7b0JBQ25CLFVBQVUsRUFBRSxnQkFBZ0IsQ0FBQyxVQUFVLElBQUksQ0FBQztvQkFDNUMsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUMsZ0JBQWdCLElBQUksQ0FBQztvQkFDeEQsV0FBVyxFQUFFLGdCQUFnQixDQUFDLFdBQVcsSUFBSSxDQUFDO29CQUM5QyxjQUFjLEVBQUUsZ0JBQWdCLENBQUMsY0FBYyxJQUFJLENBQUM7aUJBQ3ZELENBQUM7Z0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO2FBQ2hFO1lBQUMsT0FBTyxZQUFZLEVBQUU7Z0JBQ25CLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0NBQWtDLEVBQUUsWUFBWSxDQUFDLENBQUM7YUFDakU7WUFFRCxPQUFPO2dCQUNILFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDakIsU0FBUztvQkFDVCxNQUFNLEVBQUUsV0FBVztvQkFDbkIsTUFBTTtpQkFDVCxDQUFDO2FBQ0wsQ0FBQztTQUVMO1FBQUMsT0FBTyxZQUFZLEVBQUU7WUFDbkIsT0FBTztnQkFDSCxVQUFVLEVBQUUsR0FBRztnQkFDZixPQUFPLEVBQUUsV0FBVztnQkFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ2pCLFNBQVM7b0JBQ1QsTUFBTSxFQUFFLGFBQWE7b0JBQ3JCLE9BQU8sRUFBRSxzQkFBc0I7aUJBQ2xDLENBQUM7YUFDTCxDQUFDO1NBQ0w7S0FFSjtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ1osT0FBTyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3QyxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsS0FBSyxFQUFFLHdCQUF3QjtnQkFDL0IsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7YUFDcEUsQ0FBQztTQUNMLENBQUM7S0FDTDtBQUNMLENBQUM7QUFFRCxLQUFLLFVBQVUseUJBQXlCLENBQUMsSUFBbUIsRUFBRSxXQUFtQyxFQUFFLElBQW9EO0lBQ25KLElBQUksQ0FBQyxJQUFJO1FBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSwwQkFBMEIsRUFBRSxDQUFDLEVBQUUsQ0FBQztJQUV6SCxJQUFJO1FBQ0EsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVyQyxpREFBaUQ7UUFDakQsbUZBQW1GO1FBQ25GLG1EQUFtRDtRQUNuRCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixLQUFLLE1BQU0sQ0FBQztRQUNwRSxJQUFJLFFBQVEsSUFBSSxJQUFJLEtBQUssT0FBTyxFQUFFO1lBQzlCLE9BQU8sTUFBTSxrQkFBa0IsQ0FBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLElBQUksQ0FBQyxDQUFDO1NBQ25FO1FBRUQsNkRBQTZEO1FBQzdELGlGQUFpRjtRQUNqRixJQUFJLENBQUMsSUFBSSxLQUFLLFNBQVMsSUFBSSxJQUFJLEtBQUssVUFBVSxDQUFDLElBQUksV0FBVyxDQUFDLFFBQVEsRUFBRTtZQUNyRSxPQUFPLENBQUMsR0FBRyxDQUFDLG9DQUFvQyxXQUFXLENBQUMsUUFBUSxnQkFBZ0IsV0FBVyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7WUFDN0csTUFBTSxhQUFhLEdBQUcsSUFBSSw2QkFBYSxDQUFDO2dCQUNwQyxZQUFZLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQ0FBb0MsSUFBSSxtQ0FBbUM7Z0JBQ3JHLGNBQWMsRUFBRSxPQUFPO2dCQUN2QixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEdBQUcsV0FBVyxFQUFFLElBQUksRUFBRSxDQUFDO2FBQ3BELENBQUMsQ0FBQztZQUVILE1BQU0sWUFBWSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUV2QyxPQUFPO2dCQUNILFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDakIsTUFBTSxFQUFFLFlBQVk7b0JBQ3BCLE9BQU8sRUFBRSx1RkFBdUY7b0JBQ2hHLFNBQVMsRUFBRSxXQUFXLENBQUMsU0FBUztpQkFDbkMsQ0FBQzthQUNMLENBQUM7U0FDTDtRQUVELHdFQUF3RTtRQUN4RSxNQUFNLGFBQWEsR0FBRyxJQUFJLDZCQUFhLENBQUM7WUFDcEMsWUFBWSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0NBQW9DLElBQUksbUNBQW1DO1lBQ3JHLGNBQWMsRUFBRSxpQkFBaUI7WUFDakMsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxHQUFHLFdBQVcsRUFBRSxJQUFJLEVBQUUsQ0FBQztTQUNwRCxDQUFDLENBQUM7UUFFSCxNQUFNLGNBQWMsR0FBRyxNQUFNLFlBQVksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDOUQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLFdBQVcsRUFBRSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztRQUVyRixpRUFBaUU7UUFDakUsSUFBSSxlQUFlLENBQUMsVUFBVSxFQUFFO1lBQzVCLE9BQU87Z0JBQ0gsVUFBVSxFQUFFLGVBQWUsQ0FBQyxVQUFVO2dCQUN0QyxPQUFPLEVBQUUsV0FBVztnQkFDcEIsSUFBSSxFQUFFLGVBQWUsQ0FBQyxJQUFJO2FBQzdCLENBQUM7U0FDTDtRQUVELE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGVBQWUsQ0FBQztTQUN4QyxDQUFDO0tBQ0w7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNaLE9BQU8sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDckQsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsa0NBQWtDLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUM7U0FDaEksQ0FBQztLQUNMO0FBQ0wsQ0FBQztBQUVEOzs7R0FHRztBQUNILEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxXQUFnQixFQUFFLFdBQW1DLEVBQUUsSUFBWTtJQUNqRyxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLENBQUM7SUFDbEUsSUFBSSxDQUFDLGlCQUFpQixFQUFFO1FBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsMERBQTBELENBQUMsQ0FBQztLQUMvRTtJQUVELGtDQUFrQztJQUNsQyxNQUFNLFlBQVksR0FBMkI7UUFDekMsT0FBTyxFQUFFLE9BQU87UUFDaEIsU0FBUyxFQUFFLFNBQVM7UUFDcEIsVUFBVSxFQUFFLFVBQVU7UUFDdEIsV0FBVyxFQUFFLFdBQVc7S0FDM0IsQ0FBQztJQUVGLE1BQU0sWUFBWSxHQUFHO1FBQ2pCLElBQUksRUFBRSxlQUFlO1FBQ3JCLFNBQVMsRUFBRSxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSTtRQUNyQyxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUs7UUFDeEIsSUFBSSxFQUFFLFdBQVcsQ0FBQyxJQUFJO1FBQ3RCLE1BQU0sRUFBRSxXQUFXLENBQUMsTUFBTTtRQUMxQixPQUFPLEVBQUUsV0FBVyxDQUFDLE9BQU87UUFDNUIsUUFBUSxFQUFFLFdBQVcsQ0FBQyxRQUFRO1FBQzlCLFFBQVEsRUFBRSxXQUFXLENBQUMsUUFBUTtRQUM5QixZQUFZLEVBQUUsV0FBVyxDQUFDLFlBQVk7UUFDdEMsYUFBYSxFQUFFLFdBQVcsQ0FBQyxhQUFhO1FBQ3hDLFdBQVcsRUFBRSxXQUFXLENBQUMsV0FBVztRQUNwQyxVQUFVLEVBQUUsV0FBVyxDQUFDLFVBQVU7UUFDbEMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxPQUFPO1FBQzVCLFVBQVUsRUFBRSxXQUFXLENBQUMsVUFBVTtRQUNsQyxTQUFTLEVBQUUsV0FBVyxDQUFDLFNBQVM7S0FDbkMsQ0FBQztJQUVGLHVGQUF1RjtJQUN2Rix1RUFBdUU7SUFDdkUsTUFBTSxPQUFPLEdBQUcsQ0FBQyxJQUFJLEtBQUssVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssU0FBUyxDQUFDLENBQUM7SUFFOUQsSUFBSSxPQUFPLEVBQUU7UUFDVCxPQUFPLENBQUMsR0FBRyxDQUFDLDRCQUE0QixJQUFJLGdCQUFnQixXQUFXLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNyRixNQUFNLGFBQWEsR0FBRyxJQUFJLDZCQUFhLENBQUM7WUFDcEMsWUFBWSxFQUFFLGlCQUFpQjtZQUMvQixjQUFjLEVBQUUsT0FBTztZQUN2QixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUM7U0FDeEMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBRXZDLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQixNQUFNLEVBQUUsWUFBWTtnQkFDcEIsT0FBTyxFQUFFLGlHQUFpRztnQkFDMUcsU0FBUyxFQUFFLFdBQVcsQ0FBQyxTQUFTO2dCQUNoQyxNQUFNLEVBQUUsT0FBTzthQUNsQixDQUFDO1NBQ0wsQ0FBQztLQUNMO0lBRUQsbURBQW1EO0lBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLElBQUksRUFBRSxDQUFDLENBQUM7SUFDL0MsTUFBTSxhQUFhLEdBQUcsSUFBSSw2QkFBYSxDQUFDO1FBQ3BDLFlBQVksRUFBRSxpQkFBaUI7UUFDL0IsY0FBYyxFQUFFLGlCQUFpQjtRQUNqQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUM7S0FDeEMsQ0FBQyxDQUFDO0lBRUgsTUFBTSxjQUFjLEdBQUcsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzlELE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxXQUFXLEVBQUUsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7SUFFckYsMEVBQTBFO0lBQzFFLElBQUksZUFBZSxDQUFDLFVBQVUsRUFBRTtRQUM1QixPQUFPO1lBQ0gsVUFBVSxFQUFFLGVBQWUsQ0FBQyxVQUFVO1lBQ3RDLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxlQUFlLENBQUMsSUFBSTtTQUM3QixDQUFDO0tBQ0w7SUFFRCxPQUFPO1FBQ0gsVUFBVSxFQUFFLEdBQUc7UUFDZixPQUFPLEVBQUUsV0FBVztRQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUM7S0FDeEMsQ0FBQztBQUNOLENBQUM7QUFFRCxLQUFLLFVBQVUsZ0NBQWdDLENBQUMsSUFBWSxFQUFFLFdBQW1DO0lBQzdGLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDOUIsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMscUNBQXFDO0lBRWpFLElBQUksQ0FBQyxTQUFTLEVBQUU7UUFDWixPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHdCQUF3QixFQUFFLENBQUMsRUFBRSxDQUFDO0tBQy9HO0lBRUQsSUFBSTtRQUNBLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLHVDQUF1QyxDQUFDO1FBQzFGLE1BQU0sR0FBRyxHQUFHLHlCQUF5QixTQUFTLE9BQU8sQ0FBQztRQUV0RCxPQUFPLENBQUMsR0FBRyxDQUFDLDhDQUE4QyxTQUFTLFNBQVMsVUFBVSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFFakcsTUFBTSxRQUFRLEdBQUcsTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksNEJBQWdCLENBQUM7WUFDdEQsTUFBTSxFQUFFLFVBQVU7WUFDbEIsR0FBRyxFQUFFLEdBQUc7U0FDWCxDQUFDLENBQUMsQ0FBQztRQUVKLE1BQU0sT0FBTyxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRSxDQUFDO1FBQ3pELElBQUksQ0FBQyxPQUFPO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO1FBRXhELE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxPQUFPO1NBQ2hCLENBQUM7S0FDTDtJQUFDLE9BQU8sS0FBVSxFQUFFO1FBQ2pCLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxXQUFXLElBQUksS0FBSyxDQUFDLFNBQVMsRUFBRSxjQUFjLEtBQUssR0FBRyxFQUFFO1lBQ3ZFLE9BQU87Z0JBQ0gsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxPQUFPLEVBQUUsNEJBQTRCLEVBQUUsU0FBUyxFQUFFLENBQUM7YUFDbkcsQ0FBQztTQUNMO1FBQ0QsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3RCxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSw0QkFBNEIsRUFBRSxPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZSxFQUFFLENBQUM7U0FDbkksQ0FBQztLQUNMO0FBQ0wsQ0FBQztBQUVELCtFQUErRTtBQUMvRSxpRkFBaUY7QUFFakYsU0FBUyxVQUFVLENBQUMsR0FBVyxFQUFFLFNBQVMsR0FBRyxJQUFJO0lBQzdDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsTUFBTSxTQUFTLEdBQUcsSUFBSSxTQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDL0IsTUFBTSxPQUFPLEdBQUc7WUFDWixRQUFRLEVBQUUsU0FBUyxDQUFDLFFBQVE7WUFDNUIsSUFBSSxFQUFFLFNBQVMsQ0FBQyxRQUFRLEdBQUcsU0FBUyxDQUFDLE1BQU07WUFDM0MsTUFBTSxFQUFFLEtBQUs7WUFDYixPQUFPLEVBQUUsRUFBRSxZQUFZLEVBQUUsbUJBQW1CLEVBQUUsUUFBUSxFQUFFLHlDQUF5QyxFQUFFO1NBQ3RHLENBQUM7UUFDRixNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3ZDLHlCQUF5QjtZQUN6QixJQUFJLEdBQUcsQ0FBQyxVQUFVLElBQUksR0FBRyxDQUFDLFVBQVUsSUFBSSxHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUU7Z0JBQ3pGLFVBQVUsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUN4RSxPQUFPO2FBQ1Y7WUFDRCxJQUFJLEdBQUcsQ0FBQyxVQUFVLElBQUksR0FBRyxDQUFDLFVBQVUsSUFBSSxHQUFHLEVBQUU7Z0JBQ3pDLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQzVDLE9BQU87YUFDVjtZQUNELElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUNkLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDLENBQUM7WUFDekMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDdkMsQ0FBQyxDQUFDLENBQUM7UUFDSCxHQUFHLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUN4QixHQUFHLENBQUMsVUFBVSxDQUFDLFNBQVMsRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2xGLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUNkLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELEtBQUssVUFBVSx3QkFBd0IsQ0FBQyxTQUE2QixFQUFFLFdBQW1DO0lBQ3RHLElBQUksQ0FBQyxTQUFTLEVBQUU7UUFDWixPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLG9DQUFvQyxFQUFFLENBQUMsRUFBRSxDQUFDO0tBQzNIO0lBRUQsd0RBQXdEO0lBQ3hELElBQUksTUFBTSxHQUFHLFNBQVMsQ0FBQyxJQUFJLEVBQUU7U0FDeEIsT0FBTyxDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUM7U0FDNUIsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUM7U0FDckIsT0FBTyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztJQUUxQixJQUFJLENBQUMsTUFBTSxFQUFFO1FBQ1QsT0FBTyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSx5QkFBeUIsRUFBRSxDQUFDLEVBQUUsQ0FBQztLQUNoSDtJQUVELE1BQU0sT0FBTyxHQUFHLFdBQVcsTUFBTSxFQUFFLENBQUM7SUFFcEMsd0dBQXdHO0lBQ3hHLElBQUksTUFBTSxHQUFHLEtBQUssQ0FBQztJQUNuQixJQUFJLGVBQWUsR0FBRyxDQUFDLENBQUM7SUFDeEIsSUFBSSxRQUFRLEdBQWtCLElBQUksQ0FBQztJQUNuQyxJQUFJO1FBQ0EsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUM7UUFDL0MsSUFBSSxVQUFVLEVBQUU7WUFDWixNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQzNELE1BQU0sUUFBUSxHQUFHLEdBQUcsVUFBVSxrQkFBa0IsQ0FBQztZQUNqRCxNQUFNLGFBQWEsR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSw0QkFBZ0IsQ0FBQztnQkFDM0QsTUFBTSxFQUFFLFVBQVU7Z0JBQ2xCLEdBQUcsRUFBRSxRQUFRO2FBQ2hCLENBQUMsQ0FBQyxDQUFDO1lBQ0osTUFBTSxTQUFTLEdBQUcsTUFBTSxhQUFhLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFLENBQUM7WUFDaEUsSUFBSSxTQUFTLEVBQUU7Z0JBQ1gsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDeEMsb0NBQW9DO2dCQUNwQyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUN0RSxNQUFNLEtBQUssR0FBRyxHQUFHLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUM7Z0JBQ25DLElBQUksUUFBUSxJQUFJLEtBQUssRUFBRTtvQkFDbkIsTUFBTSxHQUFHLElBQUksQ0FBQztvQkFDZCxlQUFlLEdBQUcsU0FBUyxDQUFDLFNBQVMsSUFBSSxDQUFDLENBQUM7b0JBQzNDLFFBQVEsR0FBRyxTQUFTLENBQUMsU0FBUyxDQUFDO2lCQUNsQzthQUNKO1NBQ0o7S0FDSjtJQUFDLE1BQU07UUFDSix1Q0FBdUM7S0FDMUM7SUFFRCxxQkFBcUI7SUFDckIsSUFBSTtRQUNBLE1BQU0sT0FBTyxHQUFHLE1BQU0sVUFBVSxDQUFDLEdBQUcsT0FBTyxXQUFXLENBQUMsQ0FBQztRQUN4RCxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLEVBQUUsRUFBRTtZQUNoQyxzRUFBc0U7WUFDdEUsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNsQyxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ25FLE1BQU0sVUFBVSxHQUFHLEtBQUs7aUJBQ25CLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7aUJBQzlGLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO2lCQUMvRCxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO2lCQUM3QyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUVsQyxPQUFPO2dCQUNILFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDakIsS0FBSyxFQUFFLElBQUk7b0JBQ1gsTUFBTSxFQUFFLFVBQVU7b0JBQ2xCLFNBQVMsRUFBRSxHQUFHLE9BQU8sV0FBVztvQkFDaEMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxNQUFNLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztvQkFDOUQsVUFBVTtvQkFDVixNQUFNO29CQUNOLE1BQU07b0JBQ04sZUFBZTtvQkFDZixRQUFRO2lCQUNYLENBQUM7YUFDTCxDQUFDO1NBQ0w7S0FDSjtJQUFDLE1BQU0sRUFBRSxxQ0FBcUMsRUFBRTtJQUVqRCxrQkFBa0I7SUFDbEIsSUFBSTtRQUNBLE1BQU0sT0FBTyxHQUFHLE1BQU0sVUFBVSxDQUFDLEdBQUcsT0FBTyxjQUFjLENBQUMsQ0FBQztRQUMzRCxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLEVBQUUsRUFBRTtZQUNoQyxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLElBQUksRUFBRSxDQUFDO1lBQzlELE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQ3JFLE1BQU0sWUFBWSxHQUFHLENBQUMsV0FBVyxFQUFFLG9CQUFvQixFQUFFLFVBQVUsRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLGNBQWMsQ0FBQyxDQUFDO1lBQ2hILE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDckUsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1lBRTFELE9BQU87Z0JBQ0gsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNqQixLQUFLLEVBQUUsSUFBSTtvQkFDWCxNQUFNLEVBQUUsYUFBYTtvQkFDckIsU0FBUyxFQUFFLEdBQUcsT0FBTyxjQUFjO29CQUNuQyxTQUFTLEVBQUUsV0FBVyxDQUFDLE1BQU07b0JBQzdCLFVBQVUsRUFBRSxFQUFFO29CQUNkLE1BQU07b0JBQ04sTUFBTTtvQkFDTixlQUFlO29CQUNmLFFBQVE7aUJBQ1gsQ0FBQzthQUNMLENBQUM7U0FDTDtLQUNKO0lBQUMsTUFBTSxFQUFFLDhCQUE4QixFQUFFO0lBRTFDLGdCQUFnQjtJQUNoQixPQUFPO1FBQ0gsVUFBVSxFQUFFLEdBQUc7UUFDZixPQUFPLEVBQUUsV0FBVztRQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztZQUNqQixLQUFLLEVBQUUsS0FBSztZQUNaLE1BQU0sRUFBRSxJQUFJO1lBQ1osTUFBTTtZQUNOLE9BQU8sRUFBRSw2Q0FBNkMsTUFBTSxtRkFBbUY7U0FDbEosQ0FBQztLQUNMLENBQUM7QUFDTixDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLElBQW1CLEVBQUUsV0FBbUM7SUFDL0Ysc0NBQXNDO0lBQ3RDLElBQUksQ0FBQyxJQUFJO1FBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSwwQkFBMEIsRUFBRSxDQUFDLEVBQUUsQ0FBQztJQUN6SCxJQUFJLGVBQTJFLENBQUM7SUFDaEYsSUFBSTtRQUFFLGVBQWUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0tBQUU7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsOEJBQThCLEVBQUUsQ0FBQyxFQUFFLENBQUM7S0FBRTtJQUNoTCxNQUFNLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxlQUFlLENBQUM7SUFDM0QsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLFNBQVM7UUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLCtDQUErQyxFQUFFLENBQUMsRUFBRSxDQUFDO0lBQzlKLElBQUk7UUFDQSxNQUFNLFlBQVksR0FBRztZQUNqQixZQUFZLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsSUFBSSx3QkFBd0I7WUFDcEYsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLENBQUMsRUFBRSxDQUFDO1NBQ3hGLENBQUM7UUFDRixNQUFNLE1BQU0sR0FBRyxNQUFNLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSw2QkFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7UUFDeEUsSUFBSSxNQUFNLENBQUMsT0FBTyxFQUFFO1lBQ2hCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxXQUFXLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDN0UsSUFBSSxlQUFlLENBQUMsVUFBVSxLQUFLLEdBQUcsRUFBRTtnQkFDcEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3RELE9BQU8sRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQzthQUN4Rjs7Z0JBQU0sTUFBTSxJQUFJLEtBQUssQ0FBQywyQkFBMkIsZUFBZSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7U0FDN0U7O1lBQU0sTUFBTSxJQUFJLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDO0tBQ3RFO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDWixPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHdCQUF3QixFQUFFLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxFQUFFLENBQUM7S0FDbEw7QUFDTCxDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLElBQW1CLEVBQUUsV0FBbUM7SUFDL0YsSUFBSSxDQUFDLElBQUk7UUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDBCQUEwQixFQUFFLENBQUMsRUFBRSxDQUFDO0lBQ3pILElBQUksZUFBb0IsQ0FBQztJQUN6QixJQUFJO1FBQUUsZUFBZSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7S0FBRTtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSw4QkFBOEIsRUFBRSxDQUFDLEVBQUUsQ0FBQztLQUFFO0lBQ2hMLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLGVBQWUsQ0FBQztJQUN0RCxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsU0FBUztRQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsd0RBQXdELEVBQUUsQ0FBQyxFQUFFLENBQUM7SUFDbEwsSUFBSTtRQUNBLE1BQU0sWUFBWSxHQUFHO1lBQ2pCLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixJQUFJLHVCQUF1QjtZQUNsRixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7U0FDbkYsQ0FBQztRQUNGLE1BQU0sTUFBTSxHQUFHLE1BQU0sWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLDZCQUFhLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztRQUN4RSxJQUFJLE1BQU0sQ0FBQyxPQUFPLEVBQUU7WUFDaEIsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLFdBQVcsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUM3RSxJQUFJLGVBQWUsQ0FBQyxVQUFVLEtBQUssR0FBRyxFQUFFO2dCQUNwQyxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUMzRCxPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQzthQUM3Rjs7Z0JBQU0sTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsZUFBZSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7U0FDNUU7O1lBQU0sTUFBTSxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO0tBQ3JFO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDWixPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHlCQUF5QixFQUFFLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxFQUFFLENBQUM7S0FDbkw7QUFDTCxDQUFDO0FBRUQsS0FBSyxVQUFVLDBCQUEwQixDQUFDLElBQW1CLEVBQUUsV0FBbUM7SUFDOUYsSUFBSSxDQUFDLElBQUk7UUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDBCQUEwQixFQUFFLENBQUMsRUFBRSxDQUFDO0lBQ3pILElBQUksT0FBWSxDQUFDO0lBQ2pCLElBQUk7UUFBRSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztLQUFFO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDhCQUE4QixFQUFFLENBQUMsRUFBRSxDQUFDO0tBQUU7SUFFeEssSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTO1FBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxtQ0FBbUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztJQUUvSSxJQUFJO1FBQ0EsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQ0FBMkMsT0FBTyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDNUUsTUFBTSxZQUFZLEdBQUc7WUFDakIsWUFBWSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLElBQUksaUNBQWlDO1lBQzFGLGNBQWMsRUFBRSxPQUFnQjtZQUNoQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7U0FDN0QsQ0FBQztRQUVGLE1BQU0sWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLDZCQUFhLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztRQUV6RCxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTyxFQUFFLHVDQUF1QztnQkFDaEQsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2FBQy9CLENBQUM7U0FDTCxDQUFDO0tBQ0w7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNaLE9BQU8sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDL0MsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUUsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWUsRUFBRSxDQUFDO1NBQzlILENBQUM7S0FDTDtBQUNMLENBQUM7QUFFRCxLQUFLLFVBQVUsdUJBQXVCLENBQUMsSUFBbUIsRUFBRSxXQUFtQztJQUMzRixJQUFJLENBQUMsSUFBSTtRQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsMEJBQTBCLEVBQUUsQ0FBQyxFQUFFLENBQUM7SUFDekgsSUFBSSxPQUFZLENBQUM7SUFDakIsSUFBSTtRQUFFLE9BQU8sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0tBQUU7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsOEJBQThCLEVBQUUsQ0FBQyxFQUFFLENBQUM7S0FBRTtJQUV4SyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLEVBQUU7UUFDL0MsT0FBTyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSx1REFBdUQsRUFBRSxDQUFDLEVBQUUsQ0FBQztLQUM5STtJQUVELElBQUk7UUFDQSxPQUFPLENBQUMsR0FBRyxDQUFDLHNDQUFzQyxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUN2RSxNQUFNLFlBQVksR0FBRztZQUNqQixZQUFZLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsSUFBSSxrQ0FBa0M7WUFDNUYsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsdUNBQXVDO1NBQ3JHLENBQUM7UUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSw2QkFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7UUFFeEUsSUFBSSxNQUFNLENBQUMsT0FBTyxFQUFFO1lBQ2hCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxXQUFXLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDN0UsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsRUFBRSxlQUFlLENBQUMsQ0FBQztZQUV4RCxxRUFBcUU7WUFDckUsSUFBSSxlQUFlLENBQUMsU0FBUyxJQUFJLGVBQWUsQ0FBQyxZQUFZLEVBQUU7Z0JBQzNELE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLGVBQWUsQ0FBQyxZQUFZLElBQUksZUFBZSxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7YUFDL0c7WUFFRCw0REFBNEQ7WUFDNUQsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQztZQUMvRixNQUFNLFVBQVUsR0FBRyxlQUFlLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQztZQUVyRCxPQUFPO2dCQUNILFVBQVU7Z0JBQ1YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQzthQUNyQyxDQUFDO1NBQ0w7YUFBTTtZQUNILE1BQU0sSUFBSSxLQUFLLENBQUMsd0NBQXdDLENBQUMsQ0FBQztTQUM3RDtLQUNKO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDWixPQUFPLENBQUMsS0FBSyxDQUFDLHlCQUF5QixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2hELE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHdCQUF3QixFQUFFLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztTQUMvSCxDQUFDO0tBQ0w7QUFDTCxDQUFDO0FBRUQsS0FBSyxVQUFVLHFCQUFxQixDQUFDLElBQVksRUFBRSxXQUFtQztJQUNsRixzQkFBc0I7SUFDdEIsbUNBQW1DO0lBQ25DLHdDQUF3QztJQUN4QyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzlCLElBQUksU0FBUyxHQUFHLEVBQUUsQ0FBQztJQUVuQixJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLEVBQUU7UUFDaEMsU0FBUyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztLQUN4QjtTQUFNLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsRUFBRTtRQUN0QyxTQUFTLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0tBQ3hCO0lBRUQsSUFBSSxDQUFDLFNBQVMsRUFBRTtRQUNaLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHdCQUF3QixFQUFFLENBQUM7U0FDNUQsQ0FBQztLQUNMO0lBRUQsSUFBSTtRQUNBLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLHVDQUF1QyxDQUFDO1FBQzFGLE1BQU0sUUFBUSxHQUFHLFlBQVksU0FBUyxhQUFhLENBQUM7UUFFcEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsU0FBUyxTQUFTLFVBQVUsSUFBSSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRXRGLE1BQU0sUUFBUSxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLDRCQUFnQixDQUFDO1lBQ3RELE1BQU0sRUFBRSxVQUFVO1lBQ2xCLEdBQUcsRUFBRSxRQUFRO1NBQ2hCLENBQUMsQ0FBQyxDQUFDO1FBRUosTUFBTSxPQUFPLEdBQUcsTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFLENBQUM7UUFDekQsSUFBSSxDQUFDLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7UUFFeEQsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLE9BQU87U0FDaEIsQ0FBQztLQUVMO0lBQUMsT0FBTyxLQUFVLEVBQUU7UUFDakIsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3QyxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssV0FBVyxFQUFFO1lBQzVCLE9BQU87Z0JBQ0gsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLGtDQUFrQyxFQUFFLFNBQVMsRUFBRSxDQUFDO2FBQ2pGLENBQUM7U0FDTDtRQUNELE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQixLQUFLLEVBQUUsMEJBQTBCO2dCQUNqQyxPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTthQUNwRSxDQUFDO1NBQ0wsQ0FBQztLQUNMO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgU0ZOQ2xpZW50LCBTdGFydEV4ZWN1dGlvbkNvbW1hbmQsIERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZm4nO1xuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdodHRwcyc7XG5pbXBvcnQgeyBVUkwgfSBmcm9tICd1cmwnO1xuXG5jb25zdCBzZm5DbGllbnQgPSBuZXcgU0ZOQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuXG5pbnRlcmZhY2UgQW5hbHlzaXNSZXF1ZXN0IHtcbiAgICB1cmw6IHN0cmluZztcbiAgICBzZWxlY3RlZE1vZGVsOiAnY2xhdWRlJyB8ICd0aXRhbicgfCAnbGxhbWEnIHwgJ2F1dG8nO1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIGNvbnRleHRBbmFseXNpcz86IHtcbiAgICAgICAgZW5hYmxlZDogYm9vbGVhbjtcbiAgICAgICAgbWF4Q29udGV4dFBhZ2VzPzogbnVtYmVyO1xuICAgIH07XG4gICAgY2FjaGVDb250cm9sPzoge1xuICAgICAgICBlbmFibGVkOiBib29sZWFuO1xuICAgIH07XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPGFueSwgYW55PiA9IGFzeW5jIChldmVudDogYW55KSA9PiB7XG4gICAgY29uc29sZS5sb2coXCJMZW5zeSBQcm9kdWN0aW9uIEFQSSAtIERlcGxveSB2MS4xLjAgUmVhZHlcIik7XG4gICAgY29uc29sZS5sb2coJ0FQSSBIYW5kbGVyIHJlY2VpdmVkIHJlcXVlc3Q6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICAgIC8vIEhhbmRsZSBib3RoIEFQSSBHYXRld2F5IFYxIGFuZCBWMiBldmVudCBmb3JtYXRzXG4gICAgY29uc3QgaHR0cE1ldGhvZCA9IGV2ZW50Lmh0dHBNZXRob2QgfHwgZXZlbnQucmVxdWVzdENvbnRleHQ/Lmh0dHA/Lm1ldGhvZDtcbiAgICBjb25zdCBwYXRoID0gZXZlbnQucGF0aCB8fCBldmVudC5yYXdQYXRoIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5odHRwPy5wYXRoO1xuICAgIGNvbnN0IGJvZHkgPSBldmVudC5ib2R5O1xuXG4gICAgY29uc29sZS5sb2coJ0V4dHJhY3RlZCBtZXRob2Q6JywgaHR0cE1ldGhvZCwgJ3BhdGg6JywgcGF0aCk7XG5cbiAgICAvLyBDT1JTIGhlYWRlcnNcbiAgICBjb25zdCBjb3JzSGVhZGVycyA9IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXknLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdPUFRJT05TLFBPU1QsR0VUJyxcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgIH07XG5cbiAgICAvLyBIYW5kbGUgQ09SUyBwcmVmbGlnaHRcbiAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6ICcnXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKGh0dHBNZXRob2QgPT09ICdQT1NUJyAmJiAocGF0aCA9PT0gJy9hbmFseXplJyB8fCBwYXRoID09PSAnL3NjYW4tZG9jJykpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVBbmFseXplUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvZ2l0aHViLWlzc3VlcycpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVHaXRodWJJc3N1ZXNSZXF1ZXN0KGJvZHksIGNvcnNIZWFkZXJzLCAnZmV0Y2gnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChodHRwTWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9naXRodWItaXNzdWVzL2FuYWx5emUnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlR2l0aHViSXNzdWVzUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycywgJ2FuYWx5emUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChodHRwTWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9naXRodWItaXNzdWVzL2J1aWxkLWtiJykge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUdpdGh1Yklzc3Vlc1JlcXVlc3QoYm9keSwgY29yc0hlYWRlcnMsICdidWlsZC1rYicpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGh0dHBNZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2dpdGh1Yi1pc3N1ZXMvY3JlYXRlLXByJykge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUdpdGh1Yklzc3Vlc1JlcXVlc3QoYm9keSwgY29yc0hlYWRlcnMsICdjcmVhdGUtcHInKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChodHRwTWV0aG9kID09PSAnR0VUJyAmJiBwYXRoPy5zdGFydHNXaXRoKCcvZ2l0aHViLWlzc3Vlcy9yZXN1bHRzLycpKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlR2l0aHViSXNzdWVzUmVzdWx0c1JlcXVlc3QocGF0aCwgY29yc0hlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGh0dHBNZXRob2QgPT09ICdHRVQnICYmIHBhdGggPT09ICcvZ2l0aHViLWlzc3Vlcy9wcmV2aWV3LWRvY3MnKSB7XG4gICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IGV2ZW50LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyB8fCB7fTtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVQcmV2aWV3RG9jc1JlcXVlc3QocXVlcnlQYXJhbXMuZG9tYWluLCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvZGlzY292ZXItaXNzdWVzJykge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZURpc2NvdmVySXNzdWVzUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvdmFsaWRhdGUtaXNzdWVzJykge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZVZhbGlkYXRlSXNzdWVzUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvZ2VuZXJhdGUtZml4ZXMnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlR2VuZXJhdGVGaXhlc1JlcXVlc3QoYm9keSwgY29yc0hlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGh0dHBNZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwcGx5LWZpeGVzJykge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUFwcGx5Rml4ZXNSZXF1ZXN0KGJvZHksIGNvcnNIZWFkZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChodHRwTWV0aG9kID09PSAnR0VUJyAmJiBwYXRoPy5zdGFydHNXaXRoKCcvc3RhdHVzLycpKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlU3RhdHVzUmVxdWVzdChwYXRoLCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ0dFVCcgJiYgKHBhdGg/LnN0YXJ0c1dpdGgoJy9zZXNzaW9ucy8nKSAmJiBwYXRoLmVuZHNXaXRoKCcvZml4ZXMnKSkpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVHZXRGaXhlc1JlcXVlc3QocGF0aCwgY29yc0hlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGh0dHBNZXRob2QgPT09ICdHRVQnICYmIHBhdGg/LnN0YXJ0c1dpdGgoJy9nZXQtZml4ZXMvJykpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVHZXRGaXhlc1JlcXVlc3QocGF0aCwgY29yc0hlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGVycm9yOiAnTm90IGZvdW5kJyxcbiAgICAgICAgICAgICAgICBtZXRob2Q6IGh0dHBNZXRob2QsXG4gICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVSb3V0ZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgJ1BPU1QgL2FuYWx5emUnLFxuICAgICAgICAgICAgICAgICAgICAnUE9TVCAvZGlzY292ZXItaXNzdWVzJyxcbiAgICAgICAgICAgICAgICAgICAgJ1BPU1QgL3ZhbGlkYXRlLWlzc3VlcycsXG4gICAgICAgICAgICAgICAgICAgICdHRVQgL3N0YXR1cy97c2Vzc2lvbklkfScsXG4gICAgICAgICAgICAgICAgICAgICdHRVQgL2dldC1maXhlcy97c2Vzc2lvbklkfScsXG4gICAgICAgICAgICAgICAgICAgICdHRVQgL3Nlc3Npb25zL3tzZXNzaW9uSWR9L2ZpeGVzJ1xuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdBUEkgSGFuZGxlciBlcnJvcjonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBlcnJvcjogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxufTtcblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQW5hbHl6ZVJlcXVlc3QoYm9keTogc3RyaW5nIHwgbnVsbCwgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICBpZiAoIWJvZHkpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBsZXQgYW5hbHlzaXNSZXF1ZXN0OiBBbmFseXNpc1JlcXVlc3Q7XG5cbiAgICB0cnkge1xuICAgICAgICBhbmFseXNpc1JlcXVlc3QgPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdJbnZhbGlkIEpTT04gaW4gcmVxdWVzdCBib2R5JyB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHJlcXVlc3RcbiAgICBpZiAoIWFuYWx5c2lzUmVxdWVzdC51cmwgfHwgIWFuYWx5c2lzUmVxdWVzdC5zZXNzaW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGVycm9yOiAnTWlzc2luZyByZXF1aXJlZCBmaWVsZHM6IHVybCBhbmQgc2Vzc2lvbklkIGFyZSByZXF1aXJlZCdcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgVVJMIGZvcm1hdFxuICAgIHRyeSB7XG4gICAgICAgIG5ldyBVUkwoYW5hbHlzaXNSZXF1ZXN0LnVybCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgVVJMIGZvcm1hdCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBTdGFydCBTdGVwIEZ1bmN0aW9ucyBleGVjdXRpb25cbiAgICBjb25zdCBleGVjdXRpb25OYW1lID0gYGFuYWx5c2lzLSR7YW5hbHlzaXNSZXF1ZXN0LnNlc3Npb25JZH0tJHtEYXRlLm5vdygpfWA7XG4gICAgY29uc3Qgc3RhdGVNYWNoaW5lQXJuID0gcHJvY2Vzcy5lbnYuU1RBVEVfTUFDSElORV9BUk47XG5cbiAgICBpZiAoIXN0YXRlTWFjaGluZUFybikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NUQVRFX01BQ0hJTkVfQVJOIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZygnU3RhcnRpbmcgU3RlcCBGdW5jdGlvbnMgZXhlY3V0aW9uOicsIGV4ZWN1dGlvbk5hbWUpO1xuXG4gICAgY29uc3Qgc3RhcnRFeGVjdXRpb25Db21tYW5kID0gbmV3IFN0YXJ0RXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICAgIHN0YXRlTWFjaGluZUFybixcbiAgICAgICAgbmFtZTogZXhlY3V0aW9uTmFtZSxcbiAgICAgICAgaW5wdXQ6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIC4uLmFuYWx5c2lzUmVxdWVzdCxcbiAgICAgICAgICAgIGFuYWx5c2lzU3RhcnRUaW1lOiBEYXRlLm5vdygpXG4gICAgICAgIH0pXG4gICAgfSk7XG5cbiAgICBjb25zdCBleGVjdXRpb24gPSBhd2FpdCBzZm5DbGllbnQuc2VuZChzdGFydEV4ZWN1dGlvbkNvbW1hbmQpO1xuXG4gICAgY29uc29sZS5sb2coYFN0YXJ0ZWQgYW5hbHlzaXMgZXhlY3V0aW9uOiAke2V4ZWN1dGlvbi5leGVjdXRpb25Bcm59YCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDIsXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBtZXNzYWdlOiAnQW5hbHlzaXMgc3RhcnRlZCcsXG4gICAgICAgICAgICBleGVjdXRpb25Bcm46IGV4ZWN1dGlvbi5leGVjdXRpb25Bcm4sXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGFuYWx5c2lzUmVxdWVzdC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBzdGF0dXM6ICdzdGFydGVkJ1xuICAgICAgICB9KVxuICAgIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVN0YXR1c1JlcXVlc3QocGF0aDogc3RyaW5nLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHBhdGguc3BsaXQoJy8nKVsyXTtcblxuICAgIGlmICghc2Vzc2lvbklkKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdTZXNzaW9uIElEIGlzIHJlcXVpcmVkJyB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQgfHwgJ2xlbnN5LWFuYWx5c2lzLTk1MTQxMTY3NjUyNS11cy1lYXN0LTEnO1xuXG4gICAgICAgIC8vIFRyeSB0byBnZXQgdGhlIGZpbmFsIHJlcG9ydCBmcm9tIFMzXG4gICAgICAgIGNvbnN0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSA9IHJlcXVpcmUoJ0Bhd3Mtc2RrL2NsaWVudC1zMycpO1xuICAgICAgICBjb25zdCBzMyA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuICAgICAgICAvLyBGaXJzdCwgY2hlY2sgaWYgdGhpcyBpcyBzaXRlbWFwIG1vZGUgYnkgbG9va2luZyBmb3Igc2l0ZW1hcCBoZWFsdGggcmVzdWx0c1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcEhlYWx0aEtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vc2l0ZW1hcC1oZWFsdGgtcmVzdWx0cy5qc29uYDtcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXBIZWFsdGhSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IHNpdGVtYXBIZWFsdGhLZXlcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcEhlYWx0aENvbnRlbnQgPSBhd2FpdCBzaXRlbWFwSGVhbHRoUmVzcG9uc2UuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcEhlYWx0aFJlc3VsdHMgPSBKU09OLnBhcnNlKHNpdGVtYXBIZWFsdGhDb250ZW50KTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZvdW5kIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHMgLSB0aGlzIGlzIHNpdGVtYXAgbW9kZScpO1xuXG4gICAgICAgICAgICAvLyBHZXQgc2Vzc2lvbiBtZXRhZGF0YSBmb3IgdGltaW5nXG4gICAgICAgICAgICBsZXQgYW5hbHlzaXNTdGFydFRpbWUgPSBEYXRlLm5vdygpOyAvLyBmYWxsYmFja1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YUtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vbWV0YWRhdGEuanNvbmA7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIEtleTogbWV0YWRhdGFLZXlcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFTdHIgPSBhd2FpdCBtZXRhZGF0YVJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IEpTT04ucGFyc2UobWV0YWRhdGFTdHIpO1xuICAgICAgICAgICAgICAgIGFuYWx5c2lzU3RhcnRUaW1lID0gbWV0YWRhdGEuc3RhcnRUaW1lIHx8IERhdGUubm93KCk7XG4gICAgICAgICAgICB9IGNhdGNoIChtZXRhZGF0YUVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIG1ldGFkYXRhIGZvdW5kLCB1c2luZyBjdXJyZW50IHRpbWUnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgYWN0dWFsQW5hbHlzaXNUaW1lID0gRGF0ZS5ub3coKSAtIGFuYWx5c2lzU3RhcnRUaW1lO1xuICAgICAgICAgICAgY29uc3QgaGVhbHRoUGVyY2VudGFnZSA9IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmhlYWx0aFBlcmNlbnRhZ2UgfHwgMDtcblxuICAgICAgICAgICAgY29uc3QgcmVwb3J0ID0ge1xuICAgICAgICAgICAgICAgIG92ZXJhbGxTY29yZTogaGVhbHRoUGVyY2VudGFnZSxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zQW5hbHl6ZWQ6IDEsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc1RvdGFsOiAxLFxuICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgICAgICBtb2RlbFVzZWQ6ICdTaXRlbWFwIEhlYWx0aCBDaGVja2VyJyxcbiAgICAgICAgICAgICAgICBjYWNoZVN0YXR1czogJ21pc3MnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6IHt9LFxuICAgICAgICAgICAgICAgIGNvZGVBbmFseXNpczoge1xuICAgICAgICAgICAgICAgICAgICBzbmlwcGV0c0ZvdW5kOiAwLFxuICAgICAgICAgICAgICAgICAgICBzeW50YXhFcnJvcnM6IDAsXG4gICAgICAgICAgICAgICAgICAgIGRlcHJlY2F0ZWRNZXRob2RzOiAwLFxuICAgICAgICAgICAgICAgICAgICBtaXNzaW5nVmVyc2lvblNwZWNzOiAwLFxuICAgICAgICAgICAgICAgICAgICBsYW5ndWFnZXNEZXRlY3RlZDogW11cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1lZGlhQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgdmlkZW9zRm91bmQ6IDAsXG4gICAgICAgICAgICAgICAgICAgIGF1ZGlvc0ZvdW5kOiAwLFxuICAgICAgICAgICAgICAgICAgICBpbWFnZXNGb3VuZDogMCxcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJhY3RpdmVFbGVtZW50czogMCxcbiAgICAgICAgICAgICAgICAgICAgYWNjZXNzaWJpbGl0eUlzc3VlczogMCxcbiAgICAgICAgICAgICAgICAgICAgbWlzc2luZ0FsdFRleHQ6IDBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGxpbmtBbmFseXNpczoge1xuICAgICAgICAgICAgICAgICAgICB0b3RhbExpbmtzOiAwLFxuICAgICAgICAgICAgICAgICAgICBpbnRlcm5hbExpbmtzOiAwLFxuICAgICAgICAgICAgICAgICAgICBleHRlcm5hbExpbmtzOiAwLFxuICAgICAgICAgICAgICAgICAgICBicm9rZW5MaW5rczogMCxcbiAgICAgICAgICAgICAgICAgICAgc3ViUGFnZXNJZGVudGlmaWVkOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgbGlua0NvbnRleHQ6ICdzaW5nbGUtcGFnZScsXG4gICAgICAgICAgICAgICAgICAgIGFuYWx5c2lzU2NvcGU6ICdjdXJyZW50LXBhZ2Utb25seSdcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHNpdGVtYXBIZWFsdGg6IHtcbiAgICAgICAgICAgICAgICAgICAgdG90YWxVcmxzOiBzaXRlbWFwSGVhbHRoUmVzdWx0cy50b3RhbFVybHMsXG4gICAgICAgICAgICAgICAgICAgIGhlYWx0aHlVcmxzOiBzaXRlbWFwSGVhbHRoUmVzdWx0cy5oZWFsdGh5VXJscyxcbiAgICAgICAgICAgICAgICAgICAgYnJva2VuVXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMubGlua0lzc3Vlcz8uZmlsdGVyKChpc3N1ZTogYW55KSA9PiBpc3N1ZS5pc3N1ZVR5cGUgPT09ICc0MDQnKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgYWNjZXNzRGVuaWVkVXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMubGlua0lzc3Vlcz8uZmlsdGVyKChpc3N1ZTogYW55KSA9PiBpc3N1ZS5pc3N1ZVR5cGUgPT09ICdhY2Nlc3MtZGVuaWVkJykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIHRpbWVvdXRVcmxzOiBzaXRlbWFwSGVhbHRoUmVzdWx0cy5saW5rSXNzdWVzPy5maWx0ZXIoKGlzc3VlOiBhbnkpID0+IGlzc3VlLmlzc3VlVHlwZSA9PT0gJ3RpbWVvdXQnKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgb3RoZXJFcnJvclVybHM6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmxpbmtJc3N1ZXM/LmZpbHRlcigoaXNzdWU6IGFueSkgPT4gaXNzdWUuaXNzdWVUeXBlID09PSAnZXJyb3InKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgaGVhbHRoUGVyY2VudGFnZTogc2l0ZW1hcEhlYWx0aFJlc3VsdHMuaGVhbHRoUGVyY2VudGFnZSxcbiAgICAgICAgICAgICAgICAgICAgbGlua0lzc3Vlczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMubGlua0lzc3VlcyB8fCBbXSxcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1RpbWU6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLnByb2Nlc3NpbmdUaW1lXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBhbmFseXNpc1RpbWU6IGFjdHVhbEFuYWx5c2lzVGltZSxcbiAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgICAgICAgICAgICAgcmVwb3J0XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBjYXRjaCAoc2l0ZW1hcEVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gc2l0ZW1hcCBoZWFsdGggcmVzdWx0cyBmb3VuZCwgY2hlY2tpbmcgZm9yIGRvYyBtb2RlIHJlc3VsdHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERPQyBNT0RFOiBDaGVjayBmb3IgZGltZW5zaW9uIHJlc3VsdHNcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGRpbWVuc2lvbktleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vZGltZW5zaW9uLXJlc3VsdHMuanNvbmA7XG4gICAgICAgICAgICBjb25zdCBkaW1lbnNpb25SZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IGRpbWVuc2lvbktleVxuICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICBjb25zdCBkaW1lbnNpb25Db250ZW50ID0gYXdhaXQgZGltZW5zaW9uUmVzcG9uc2UuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3QgZGltZW5zaW9uUmVzdWx0cyA9IEpTT04ucGFyc2UoZGltZW5zaW9uQ29udGVudCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L3Byb2Nlc3NlZC1jb250ZW50Lmpzb25gO1xuICAgICAgICAgICAgY29uc3QgY29udGVudFJlc3BvbnNlID0gYXdhaXQgczMuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgICAgIEtleTogY29udGVudEtleVxuICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICBjb25zdCBjb250ZW50U3RyID0gYXdhaXQgY29udGVudFJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NlZENvbnRlbnQgPSBKU09OLnBhcnNlKGNvbnRlbnRTdHIpO1xuXG4gICAgICAgICAgICBsZXQgbW9kZWxVc2VkID0gJ2NsYXVkZSc7IC8vIGRlZmF1bHRcbiAgICAgICAgICAgIGxldCBhbmFseXNpc1N0YXJ0VGltZSA9IERhdGUubm93KCk7IC8vIGZhbGxiYWNrXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhS2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9tZXRhZGF0YS5qc29uYDtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YVJlc3BvbnNlID0gYXdhaXQgczMuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgS2V5OiBtZXRhZGF0YUtleVxuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YVN0ciA9IGF3YWl0IG1ldGFkYXRhUmVzcG9uc2UuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gSlNPTi5wYXJzZShtZXRhZGF0YVN0cik7XG4gICAgICAgICAgICAgICAgbW9kZWxVc2VkID0gbWV0YWRhdGEuc2VsZWN0ZWRNb2RlbCB8fCAnY2xhdWRlJztcbiAgICAgICAgICAgICAgICBhbmFseXNpc1N0YXJ0VGltZSA9IG1ldGFkYXRhLnN0YXJ0VGltZSB8fCBEYXRlLm5vdygpO1xuICAgICAgICAgICAgfSBjYXRjaCAobWV0YWRhdGFFcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBtZXRhZGF0YSBmb3VuZCwgdXNpbmcgZGVmYXVsdCBtb2RlbCBhbmQgY3VycmVudCB0aW1lJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGFjdHVhbEFuYWx5c2lzVGltZSA9IERhdGUubm93KCkgLSBhbmFseXNpc1N0YXJ0VGltZTtcblxuICAgICAgICAgICAgY29uc3QgdmFsaWRTY29yZXMgPSBPYmplY3QudmFsdWVzKGRpbWVuc2lvblJlc3VsdHMpXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoZDogYW55KSA9PiBkLnNjb3JlICE9PSBudWxsICYmIGQuc3RhdHVzID09PSAnY29tcGxldGUnKVxuICAgICAgICAgICAgICAgIC5tYXAoKGQ6IGFueSkgPT4gZC5zY29yZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IG92ZXJhbGxTY29yZSA9IHZhbGlkU2NvcmVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICA/IE1hdGgucm91bmQodmFsaWRTY29yZXMucmVkdWNlKChzdW06IG51bWJlciwgc2NvcmU6IG51bWJlcikgPT4gc3VtICsgc2NvcmUsIDApIC8gdmFsaWRTY29yZXMubGVuZ3RoKVxuICAgICAgICAgICAgICAgIDogMDtcblxuICAgICAgICAgICAgbGV0IGNvbnRleHRBbmFseXNpcyA9IG51bGw7XG4gICAgICAgICAgICBpZiAocHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMpIHtcbiAgICAgICAgICAgICAgICBjb250ZXh0QW5hbHlzaXMgPSB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHRQYWdlczogcHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMuY29udGV4dFBhZ2VzIHx8IFtdLFxuICAgICAgICAgICAgICAgICAgICBhbmFseXNpc1Njb3BlOiBwcm9jZXNzZWRDb250ZW50LmNvbnRleHRBbmFseXNpcy5hbmFseXNpc1Njb3BlIHx8ICdzaW5nbGUtcGFnZScsXG4gICAgICAgICAgICAgICAgICAgIHRvdGFsUGFnZXNBbmFseXplZDogcHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMudG90YWxQYWdlc0FuYWx5emVkIHx8IDFcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXBvcnQgPSB7XG4gICAgICAgICAgICAgICAgb3ZlcmFsbFNjb3JlLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNBbmFseXplZDogdmFsaWRTY29yZXMubGVuZ3RoLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNUb3RhbDogNSxcbiAgICAgICAgICAgICAgICBjb25maWRlbmNlOiB2YWxpZFNjb3Jlcy5sZW5ndGggPT09IDUgPyAnaGlnaCcgOiB2YWxpZFNjb3Jlcy5sZW5ndGggPj0gMyA/ICdtZWRpdW0nIDogJ2xvdycsXG4gICAgICAgICAgICAgICAgbW9kZWxVc2VkOiBtb2RlbFVzZWQsXG4gICAgICAgICAgICAgICAgY2FjaGVTdGF0dXM6IHByb2Nlc3NlZENvbnRlbnQuY2FjaGVNZXRhZGF0YT8ud2FzRnJvbUNhY2hlID8gJ2hpdCcgOiAnbWlzcycsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uczogZGltZW5zaW9uUmVzdWx0cyxcbiAgICAgICAgICAgICAgICBjb2RlQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgc25pcHBldHNGb3VuZDogcHJvY2Vzc2VkQ29udGVudC5lbmhhbmNlZENvZGVBbmFseXNpcz8uYW5hbHl6ZWRTbmlwcGV0cyB8fCBwcm9jZXNzZWRDb250ZW50LmNvZGVTbmlwcGV0cz8ubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIHN5bnRheEVycm9yczogcHJvY2Vzc2VkQ29udGVudC5lbmhhbmNlZENvZGVBbmFseXNpcz8uc3ludGF4RXJyb3JGaW5kaW5ncz8ubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGRlcHJlY2F0ZWRNZXRob2RzOiBwcm9jZXNzZWRDb250ZW50LmVuaGFuY2VkQ29kZUFuYWx5c2lzPy5kZXByZWNhdGVkQ29kZUZpbmRpbmdzPy5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgbWlzc2luZ1ZlcnNpb25TcGVjczogcHJvY2Vzc2VkQ29udGVudC5jb2RlU25pcHBldHM/LmZpbHRlcigoczogYW55KSA9PiAhcy5oYXNWZXJzaW9uSW5mbykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGxhbmd1YWdlc0RldGVjdGVkOiBwcm9jZXNzZWRDb250ZW50LmNvZGVTbmlwcGV0cyA/IFsuLi5uZXcgU2V0KHByb2Nlc3NlZENvbnRlbnQuY29kZVNuaXBwZXRzLm1hcCgoczogYW55KSA9PiBzLmxhbmd1YWdlKS5maWx0ZXIoQm9vbGVhbikpXSA6IFtdLFxuICAgICAgICAgICAgICAgICAgICBlbmhhbmNlZEFuYWx5c2lzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZXByZWNhdGVkRmluZGluZ3M6IHByb2Nlc3NlZENvbnRlbnQuZW5oYW5jZWRDb2RlQW5hbHlzaXM/LmRlcHJlY2F0ZWRDb2RlRmluZGluZ3MgfHwgW10sXG4gICAgICAgICAgICAgICAgICAgICAgICBzeW50YXhFcnJvckZpbmRpbmdzOiBwcm9jZXNzZWRDb250ZW50LmVuaGFuY2VkQ29kZUFuYWx5c2lzPy5zeW50YXhFcnJvckZpbmRpbmdzIHx8IFtdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1lZGlhQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgdmlkZW9zRm91bmQ6IHByb2Nlc3NlZENvbnRlbnQubWVkaWFFbGVtZW50cz8uZmlsdGVyKChtOiBhbnkpID0+IG0udHlwZSA9PT0gJ3ZpZGVvJykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGF1ZGlvc0ZvdW5kOiBwcm9jZXNzZWRDb250ZW50Lm1lZGlhRWxlbWVudHM/LmZpbHRlcigobTogYW55KSA9PiBtLnR5cGUgPT09ICdhdWRpbycpLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBpbWFnZXNGb3VuZDogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS50eXBlID09PSAnaW1hZ2UnKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJhY3RpdmVFbGVtZW50czogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS50eXBlID09PSAnaW50ZXJhY3RpdmUnKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgYWNjZXNzaWJpbGl0eUlzc3VlczogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS5hbmFseXNpc05vdGU/LmluY2x1ZGVzKCdhY2Nlc3NpYmlsaXR5JykpLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBtaXNzaW5nQWx0VGV4dDogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS50eXBlID09PSAnaW1hZ2UnICYmICFtLmFsdCkubGVuZ3RoIHx8IDBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGxpbmtBbmFseXNpczogcHJvY2Vzc2VkQ29udGVudC5saW5rQW5hbHlzaXMgfHwgcHJvY2Vzc2VkQ29udGVudC5lbmhhbmNlZExpbmtBbmFseXNpcyB8fCB7fSxcbiAgICAgICAgICAgICAgICAuLi4oY29udGV4dEFuYWx5c2lzICYmIHsgY29udGV4dEFuYWx5c2lzIH0pLFxuICAgICAgICAgICAgICAgIHVybFNsdWdBbmFseXNpczogcHJvY2Vzc2VkQ29udGVudC51cmxTbHVnQW5hbHlzaXMgfHwgdW5kZWZpbmVkLCAvLyBbTkVXXSBJbmNsdWRlIFVSTCBzbHVnIGFuYWx5c2lzXG4gICAgICAgICAgICAgICAgYW5hbHlzaXNUaW1lOiBhY3R1YWxBbmFseXNpc1RpbWUsXG4gICAgICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICAgICAgICBhaVJlYWRpbmVzczogdW5kZWZpbmVkLCAvLyBXaWxsIGJlIHBvcHVsYXRlZCBiZWxvd1xuICAgICAgICAgICAgICAgIHNpdGVtYXBIZWFsdGg6IHVuZGVmaW5lZCAvLyBXaWxsIGJlIHBvcHVsYXRlZCBiZWxvd1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0RFQlVHOiBBYm91dCB0byBmZXRjaCBBSSBSZWFkaW5lc3MgZm9yIHNlc3Npb246Jywgc2Vzc2lvbklkKTtcblxuICAgICAgICAgICAgLy8gW05FV10gVHJ5IHRvIGZldGNoIEFJIFJlYWRpbmVzcyByZXN1bHRzXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFpUmVhZGluZXNzS2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9haS1yZWFkaW5lc3MtcmVzdWx0cy5qc29uYDsgLy8gRml4ZWQgZmlsZW5hbWVcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgQXR0ZW1wdGluZyB0byBmZXRjaCBBSSBSZWFkaW5lc3MgZnJvbSBrZXk6ICR7YWlSZWFkaW5lc3NLZXl9YCk7XG4gICAgICAgICAgICAgICAgY29uc3QgYWlSZWFkaW5lc3NSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIEtleTogYWlSZWFkaW5lc3NLZXlcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgY29uc3QgYWlSZWFkaW5lc3NDb250ZW50ID0gYXdhaXQgYWlSZWFkaW5lc3NSZXNwb25zZS5Cb2R5LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgcmVwb3J0LmFpUmVhZGluZXNzID0gSlNPTi5wYXJzZShhaVJlYWRpbmVzc0NvbnRlbnQpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTdWNjZXNzZnVsbHkgcmV0cmlldmVkIEFJIFJlYWRpbmVzcyByZXN1bHRzJyk7XG4gICAgICAgICAgICB9IGNhdGNoIChhaUVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIEFJIFJlYWRpbmVzcyByZXN1bHRzIGZvdW5kOicsIGFpRXJyb3IpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBbTkVXXSBUcnkgdG8gZmV0Y2ggc2l0ZW1hcCBoZWFsdGggZm9yIERvYyBNb2RlXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNpdGVtYXBIZWFsdGhLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L2RvYy1tb2RlLXNpdGVtYXAtaGVhbHRoLmpzb25gO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBBdHRlbXB0aW5nIHRvIGZldGNoIHNpdGVtYXAgaGVhbHRoIGZyb20ga2V5OiAke3NpdGVtYXBIZWFsdGhLZXl9YCk7XG4gICAgICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcEhlYWx0aFJlc3BvbnNlID0gYXdhaXQgczMuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgS2V5OiBzaXRlbWFwSGVhbHRoS2V5XG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHNpdGVtYXBIZWFsdGhDb250ZW50ID0gYXdhaXQgc2l0ZW1hcEhlYWx0aFJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICBjb25zdCByYXdTaXRlbWFwSGVhbHRoID0gSlNPTi5wYXJzZShzaXRlbWFwSGVhbHRoQ29udGVudCk7XG5cbiAgICAgICAgICAgICAgICAvLyBBZGQgdG8gcmVwb3J0IHdpdGggZGVmYXVsdCB2YWx1ZXMgZm9yIG1pc3NpbmcgZmllbGRzXG4gICAgICAgICAgICAgICAgcmVwb3J0LnNpdGVtYXBIZWFsdGggPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnJhd1NpdGVtYXBIZWFsdGgsXG4gICAgICAgICAgICAgICAgICAgIGJyb2tlblVybHM6IHJhd1NpdGVtYXBIZWFsdGguYnJva2VuVXJscyB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBhY2Nlc3NEZW5pZWRVcmxzOiByYXdTaXRlbWFwSGVhbHRoLmFjY2Vzc0RlbmllZFVybHMgfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgdGltZW91dFVybHM6IHJhd1NpdGVtYXBIZWFsdGgudGltZW91dFVybHMgfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgb3RoZXJFcnJvclVybHM6IHJhd1NpdGVtYXBIZWFsdGgub3RoZXJFcnJvclVybHMgfHwgMFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1N1Y2Nlc3NmdWxseSByZXRyaWV2ZWQgc2l0ZW1hcCBoZWFsdGggcmVzdWx0cycpO1xuICAgICAgICAgICAgfSBjYXRjaCAoc2l0ZW1hcEVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHMgZm91bmQ6Jywgc2l0ZW1hcEVycm9yKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICAgICAgICAgICAgICAgIHJlcG9ydFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gY2F0Y2ggKGRvY01vZGVFcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2luX3Byb2dyZXNzJyxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0FuYWx5c2lzIGluIHByb2dyZXNzJ1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdTdGF0dXMgY2hlY2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGVycm9yOiAnRmFpbGVkIHRvIGNoZWNrIHN0YXR1cycsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVHaXRodWJJc3N1ZXNSZXF1ZXN0KGJvZHk6IHN0cmluZyB8IG51bGwsIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBtb2RlOiAnZmV0Y2gnIHwgJ2FuYWx5emUnIHwgJ2NyZWF0ZS1wcicgfCAnYnVpbGQta2InKSB7XG4gICAgaWYgKCFib2R5KSByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KSB9O1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVxdWVzdEJvZHkgPSBKU09OLnBhcnNlKGJvZHkpO1xuXG4gICAgICAgIC8vIEZlYXR1cmUgZmxhZzogcm91dGUgdG8gYWdlbnQgTGFtYmRhIGlmIGVuYWJsZWRcbiAgICAgICAgLy8gTm90ZTogJ2ZldGNoJyBzdGF5cyBvbiBsZWdhY3kgcGF0aCDigJQgYWdlbnQgZmV0Y2ggZXhjZWVkcyBBUEkgR2F0ZXdheSAyOXMgdGltZW91dFxuICAgICAgICAvLyBkdWUgdG8gbXVsdGlwbGUgTExNIHJvdW5kdHJpcHMgaW4gTGFuZ0dyYXBoIGxvb3BcbiAgICAgICAgY29uc3QgdXNlQWdlbnQgPSBwcm9jZXNzLmVudi5VU0VfQUdFTlRfRk9SX0dJVEhVQl9JU1NVRVMgPT09ICd0cnVlJztcbiAgICAgICAgaWYgKHVzZUFnZW50ICYmIG1vZGUgIT09ICdmZXRjaCcpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCByb3V0ZVRvQWdlbnRMYW1iZGEocmVxdWVzdEJvZHksIGNvcnNIZWFkZXJzLCBtb2RlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExlZ2FjeSBwYXRoOiBpbnZva2UgZ2l0aHViLWlzc3Vlcy1hbmFseXplciBMYW1iZGEgZGlyZWN0bHlcbiAgICAgICAgLy8gV2hlbiBhbmFseXppbmcgd2l0aCBjcmF3bFVybCwgdXNlIGFzeW5jIGludm9rZSAoY3Jhd2wrc3VtbWFyaXplIGNhbiB0YWtlID4yOXMpXG4gICAgICAgIGlmICgobW9kZSA9PT0gJ2FuYWx5emUnIHx8IG1vZGUgPT09ICdidWlsZC1rYicpICYmIHJlcXVlc3RCb2R5LmNyYXdsVXJsKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgQXN5bmMgaW52b2tlIGZvciBjcmF3bCBhbmFseXNpczogJHtyZXF1ZXN0Qm9keS5jcmF3bFVybH0sIHNlc3Npb25JZDogJHtyZXF1ZXN0Qm9keS5zZXNzaW9uSWR9YCk7XG4gICAgICAgICAgICBjb25zdCBpbnZva2VDb21tYW5kID0gbmV3IEludm9rZUNvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogcHJvY2Vzcy5lbnYuR0lUSFVCX0lTU1VFU19BTkFMWVpFUl9GVU5DVElPTl9OQU1FIHx8ICdMZW5zeUdpdEh1Yklzc3Vlc0FuYWx5emVyRnVuY3Rpb24nLFxuICAgICAgICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnRXZlbnQnLCAvLyBBc3luYyDigJQgcmV0dXJucyBpbW1lZGlhdGVseVxuICAgICAgICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHsgLi4ucmVxdWVzdEJvZHksIG1vZGUgfSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChpbnZva2VDb21tYW5kKTtcblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDIsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdwcm9jZXNzaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0FuYWx5c2lzIHN0YXJ0ZWQgYXN5bmNocm9ub3VzbHkuIFJlc3VsdHMgd2lsbCBiZSBhdmFpbGFibGUgdmlhIFdlYlNvY2tldCBhbmQgcG9sbGluZy4nLFxuICAgICAgICAgICAgICAgICAgICBzZXNzaW9uSWQ6IHJlcXVlc3RCb2R5LnNlc3Npb25JZFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU3luY2hyb25vdXMgaW52b2tlIGZvciBmZXRjaCwgY3JlYXRlLXByLCBhbmQgYW5hbHl6ZSB3aXRob3V0IGNyYXdsVXJsXG4gICAgICAgIGNvbnN0IGludm9rZUNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XG4gICAgICAgICAgICBGdW5jdGlvbk5hbWU6IHByb2Nlc3MuZW52LkdJVEhVQl9JU1NVRVNfQU5BTFlaRVJfRlVOQ1RJT05fTkFNRSB8fCAnTGVuc3lHaXRIdWJJc3N1ZXNBbmFseXplckZ1bmN0aW9uJyxcbiAgICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnUmVxdWVzdFJlc3BvbnNlJyxcbiAgICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHsgLi4ucmVxdWVzdEJvZHksIG1vZGUgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgbGFtYmRhUmVzcG9uc2UgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChpbnZva2VDb21tYW5kKTtcbiAgICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUobGFtYmRhUmVzcG9uc2UuUGF5bG9hZCkpO1xuXG4gICAgICAgIC8vIElmIHRoZSBsYW1iZGEgcmV0dXJuZWQgYSBwcm9wZXIgQVBJIHJlc3BvbnNlLCBleHRyYWN0IHRoZSBib2R5XG4gICAgICAgIGlmIChyZXNwb25zZVBheWxvYWQuc3RhdHVzQ29kZSkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiByZXNwb25zZVBheWxvYWQuc3RhdHVzQ29kZSxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiByZXNwb25zZVBheWxvYWQuYm9keVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlUGF5bG9hZClcbiAgICAgICAgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdHaXRIdWIgaXNzdWVzIHJlcXVlc3QgZXJyb3I6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBgR2l0SHViIGlzc3VlcyBhbmFseXNpcyBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCB9KVxuICAgICAgICB9O1xuICAgIH1cbn1cblxuLyoqXG4gKiBSb3V0ZSBHaXRIdWIgSXNzdWVzIHJlcXVlc3RzIHRvIHRoZSBBZ2VudCBIYW5kbGVyIExhbWJkYSAoTGFuZ0dyYXBoICsgTUNQKS5cbiAqIE1hcHMgQVBJIG1vZGVzIHRvIGFnZW50IG9wZXJhdGlvbnMgYW5kIGhhbmRsZXMgc3luYy9hc3luYyBpbnZvY2F0aW9ucy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcm91dGVUb0FnZW50TGFtYmRhKHJlcXVlc3RCb2R5OiBhbnksIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBtb2RlOiBzdHJpbmcpIHtcbiAgICBjb25zdCBhZ2VudEZ1bmN0aW9uTmFtZSA9IHByb2Nlc3MuZW52LkFHRU5UX0hBTkRMRVJfRlVOQ1RJT05fTkFNRTtcbiAgICBpZiAoIWFnZW50RnVuY3Rpb25OYW1lKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQUdFTlRfSEFORExFUl9GVU5DVElPTl9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICAvLyBNYXAgQVBJIG1vZGUgdG8gYWdlbnQgb3BlcmF0aW9uXG4gICAgY29uc3Qgb3BlcmF0aW9uTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICAnZmV0Y2gnOiAnZmV0Y2gnLFxuICAgICAgICAnYW5hbHl6ZSc6ICdhbmFseXplJyxcbiAgICAgICAgJ2J1aWxkLWtiJzogJ2J1aWxkLWtiJyxcbiAgICAgICAgJ2NyZWF0ZS1wcic6ICdjcmVhdGUtcHInXG4gICAgfTtcblxuICAgIGNvbnN0IGFnZW50UGF5bG9hZCA9IHtcbiAgICAgICAgbW9kZTogJ2dpdGh1Yi1pc3N1ZXMnLFxuICAgICAgICBvcGVyYXRpb246IG9wZXJhdGlvbk1hcFttb2RlXSB8fCBtb2RlLFxuICAgICAgICBvd25lcjogcmVxdWVzdEJvZHkub3duZXIsXG4gICAgICAgIHJlcG86IHJlcXVlc3RCb2R5LnJlcG8sXG4gICAgICAgIGlzc3VlczogcmVxdWVzdEJvZHkuaXNzdWVzLFxuICAgICAgICBkb2NzVXJsOiByZXF1ZXN0Qm9keS5kb2NzVXJsLFxuICAgICAgICBjcmF3bFVybDogcmVxdWVzdEJvZHkuY3Jhd2xVcmwsXG4gICAgICAgIGZpbGVQYXRoOiByZXF1ZXN0Qm9keS5maWxlUGF0aCxcbiAgICAgICAgb3JpZ2luYWxUZXh0OiByZXF1ZXN0Qm9keS5vcmlnaW5hbFRleHQsXG4gICAgICAgIGNvcnJlY3RlZFRleHQ6IHJlcXVlc3RCb2R5LmNvcnJlY3RlZFRleHQsXG4gICAgICAgIGlzc3VlTnVtYmVyOiByZXF1ZXN0Qm9keS5pc3N1ZU51bWJlcixcbiAgICAgICAgaXNzdWVUaXRsZTogcmVxdWVzdEJvZHkuaXNzdWVUaXRsZSxcbiAgICAgICAgZ2FwVHlwZTogcmVxdWVzdEJvZHkuZ2FwVHlwZSxcbiAgICAgICAgY29uZmlkZW5jZTogcmVxdWVzdEJvZHkuY29uZmlkZW5jZSxcbiAgICAgICAgc2Vzc2lvbklkOiByZXF1ZXN0Qm9keS5zZXNzaW9uSWQsXG4gICAgfTtcblxuICAgIC8vIEFzeW5jOiBidWlsZC1rYiBhbmQgYW5hbHl6ZSBhcmUgYWx3YXlzIGFzeW5jIHRocm91Z2ggYWdlbnQgKGxvbmctcnVubmluZyBvcGVyYXRpb25zKVxuICAgIC8vIFRoZSBhZ2VudCBvcmNoZXN0cmF0ZXMgS0IgYnVpbGRpbmcgKyBhbmFseXNpcyB3aGljaCBjYW4gdGFrZSBtaW51dGVzXG4gICAgY29uc3QgaXNBc3luYyA9IChtb2RlID09PSAnYnVpbGQta2InKSB8fCAobW9kZSA9PT0gJ2FuYWx5emUnKTtcblxuICAgIGlmIChpc0FzeW5jKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBbQWdlbnRdIEFzeW5jIGludm9rZSBmb3IgJHttb2RlfSwgc2Vzc2lvbklkOiAke3JlcXVlc3RCb2R5LnNlc3Npb25JZH1gKTtcbiAgICAgICAgY29uc3QgaW52b2tlQ29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcbiAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogYWdlbnRGdW5jdGlvbk5hbWUsXG4gICAgICAgICAgICBJbnZvY2F0aW9uVHlwZTogJ0V2ZW50JyxcbiAgICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KGFnZW50UGF5bG9hZClcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoaW52b2tlQ29tbWFuZCk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMixcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIHN0YXR1czogJ3Byb2Nlc3NpbmcnLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdBbmFseXNpcyBzdGFydGVkIGFzeW5jaHJvbm91c2x5IHZpYSBhZ2VudC4gUmVzdWx0cyB3aWxsIGJlIGF2YWlsYWJsZSB2aWEgV2ViU29ja2V0IGFuZCBwb2xsaW5nLicsXG4gICAgICAgICAgICAgICAgc2Vzc2lvbklkOiByZXF1ZXN0Qm9keS5zZXNzaW9uSWQsXG4gICAgICAgICAgICAgICAgZW5naW5lOiAnYWdlbnQnXG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFN5bmM6IGZldGNoLCBjcmVhdGUtcHIsIGFuYWx5emUgd2l0aG91dCBjcmF3bFVybFxuICAgIGNvbnNvbGUubG9nKGBbQWdlbnRdIFN5bmMgaW52b2tlIGZvciAke21vZGV9YCk7XG4gICAgY29uc3QgaW52b2tlQ29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcbiAgICAgICAgRnVuY3Rpb25OYW1lOiBhZ2VudEZ1bmN0aW9uTmFtZSxcbiAgICAgICAgSW52b2NhdGlvblR5cGU6ICdSZXF1ZXN0UmVzcG9uc2UnLFxuICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShhZ2VudFBheWxvYWQpXG4gICAgfSk7XG5cbiAgICBjb25zdCBsYW1iZGFSZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGludm9rZUNvbW1hbmQpO1xuICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGxhbWJkYVJlc3BvbnNlLlBheWxvYWQpKTtcblxuICAgIC8vIEFnZW50IGhhbmRsZXIgcmV0dXJucyB7IHN0YXR1c0NvZGUsIGhlYWRlcnMsIGJvZHkgfSBmb3Igc3luYyBvcGVyYXRpb25zXG4gICAgaWYgKHJlc3BvbnNlUGF5bG9hZC5zdGF0dXNDb2RlKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiByZXNwb25zZVBheWxvYWQuc3RhdHVzQ29kZSxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogcmVzcG9uc2VQYXlsb2FkLmJvZHlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZVBheWxvYWQpXG4gICAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlR2l0aHViSXNzdWVzUmVzdWx0c1JlcXVlc3QocGF0aDogc3RyaW5nLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICAgIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHBhcnRzWzNdOyAvLyAvZ2l0aHViLWlzc3Vlcy9yZXN1bHRzL3tzZXNzaW9uSWR9XG5cbiAgICBpZiAoIXNlc3Npb25JZCkge1xuICAgICAgICByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnU2Vzc2lvbiBJRCBpcyByZXF1aXJlZCcgfSkgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUIHx8ICdsZW5zeS1hbmFseXNpcy05NTE0MTE2NzY1MjUtdXMtZWFzdC0xJztcbiAgICAgICAgY29uc3Qga2V5ID0gYGdpdGh1Yi1pc3N1ZXMtcmVzdWx0cy8ke3Nlc3Npb25JZH0uanNvbmA7XG5cbiAgICAgICAgY29uc29sZS5sb2coYEZldGNoaW5nIEdpdEh1YiBpc3N1ZXMgcmVzdWx0cyBmb3Igc2Vzc2lvbiAke3Nlc3Npb25JZH0gZnJvbSAke2J1Y2tldE5hbWV9LyR7a2V5fWApO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBLZXk6IGtleVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHJlc3BvbnNlLkJvZHk/LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgIGlmICghY29udGVudCkgdGhyb3cgbmV3IEVycm9yKCdFbXB0eSByZXNwb25zZSBmcm9tIFMzJyk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogY29udGVudFxuICAgICAgICB9O1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgaWYgKGVycm9yLm5hbWUgPT09ICdOb1N1Y2hLZXknIHx8IGVycm9yLiRtZXRhZGF0YT8uaHR0cFN0YXR1c0NvZGUgPT09IDQwNCkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDIsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBzdGF0dXM6ICdwcm9jZXNzaW5nJywgbWVzc2FnZTogJ0FuYWx5c2lzIHN0aWxsIGluIHByb2dyZXNzJywgc2Vzc2lvbklkIH0pXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBnZXQgR2l0SHViIGlzc3VlcyByZXN1bHRzOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ZhaWxlZCB0byByZXRyaWV2ZSByZXN1bHRzJywgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicgfSlcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbi8vIOKUgOKUgOKUgCBQcmV2aWV3IERvY3MgKGxpZ2h0d2VpZ2h0IOKAlCBubyBjcmF3bCwgbm8gQmVkcm9jaykg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBGZXRjaGVzIGxsbXMudHh0IG9yIHNpdGVtYXAueG1sIGF0IGEgZG9tYWluIHRvIHNob3cgdXNlciB3aGF0IHdpbGwgYmUgY3Jhd2xlZC5cblxuZnVuY3Rpb24gcXVpY2tGZXRjaCh1cmw6IHN0cmluZywgdGltZW91dE1zID0gODAwMCk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpO1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgICAgICAgaG9zdG5hbWU6IHBhcnNlZFVybC5ob3N0bmFtZSxcbiAgICAgICAgICAgIHBhdGg6IHBhcnNlZFVybC5wYXRobmFtZSArIHBhcnNlZFVybC5zZWFyY2gsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgaGVhZGVyczogeyAnVXNlci1BZ2VudCc6ICdMZW5zeS1QcmV2aWV3LzEuMCcsICdBY2NlcHQnOiAndGV4dC9wbGFpbix0ZXh0L3htbCxhcHBsaWNhdGlvbi94bWwsKi8qJyB9XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IHJlcSA9IGh0dHBzLnJlcXVlc3Qob3B0aW9ucywgKHJlcykgPT4ge1xuICAgICAgICAgICAgLy8gRm9sbG93IHNpbmdsZSByZWRpcmVjdFxuICAgICAgICAgICAgaWYgKHJlcy5zdGF0dXNDb2RlICYmIHJlcy5zdGF0dXNDb2RlID49IDMwMCAmJiByZXMuc3RhdHVzQ29kZSA8IDQwMCAmJiByZXMuaGVhZGVycy5sb2NhdGlvbikge1xuICAgICAgICAgICAgICAgIHF1aWNrRmV0Y2gocmVzLmhlYWRlcnMubG9jYXRpb24sIHRpbWVvdXRNcykudGhlbihyZXNvbHZlKS5jYXRjaChyZWplY3QpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXMuc3RhdHVzQ29kZSAmJiByZXMuc3RhdHVzQ29kZSA+PSA0MDApIHtcbiAgICAgICAgICAgICAgICByZWplY3QobmV3IEVycm9yKGBIVFRQICR7cmVzLnN0YXR1c0NvZGV9YCkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxldCBkYXRhID0gJyc7XG4gICAgICAgICAgICByZXMub24oJ2RhdGEnLCAoY2h1bmspID0+IGRhdGEgKz0gY2h1bmspO1xuICAgICAgICAgICAgcmVzLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKGRhdGEpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJlcS5vbignZXJyb3InLCByZWplY3QpO1xuICAgICAgICByZXEuc2V0VGltZW91dCh0aW1lb3V0TXMsICgpID0+IHsgcmVxLmRlc3Ryb3koKTsgcmVqZWN0KG5ldyBFcnJvcigndGltZW91dCcpKTsgfSk7XG4gICAgICAgIHJlcS5lbmQoKTtcbiAgICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlUHJldmlld0RvY3NSZXF1ZXN0KHJhd0RvbWFpbjogc3RyaW5nIHwgdW5kZWZpbmVkLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICAgIGlmICghcmF3RG9tYWluKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdkb21haW4gcXVlcnkgcGFyYW1ldGVyIGlzIHJlcXVpcmVkJyB9KSB9O1xuICAgIH1cblxuICAgIC8vIE5vcm1hbGl6ZSBkb21haW46IHN0cmlwIHByb3RvY29sLCB3d3csIHRyYWlsaW5nIHNsYXNoXG4gICAgbGV0IGRvbWFpbiA9IHJhd0RvbWFpbi50cmltKClcbiAgICAgICAgLnJlcGxhY2UoL15odHRwcz86XFwvXFwvL2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvXnd3d1xcLi8sICcnKVxuICAgICAgICAucmVwbGFjZSgvXFwvLiokLywgJycpO1xuXG4gICAgaWYgKCFkb21haW4pIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgZG9tYWluIHByb3ZpZGVkJyB9KSB9O1xuICAgIH1cblxuICAgIGNvbnN0IGJhc2VVcmwgPSBgaHR0cHM6Ly8ke2RvbWFpbn1gO1xuXG4gICAgLy8gQ2hlY2sgUzMgY2FjaGUg4oCUIGlmIEtCIGFscmVhZHkgZXhpc3RzLCB0ZWxsIHRoZSBmcm9udGVuZCBzbyBpdCBjYW4gc2tpcCBcIkJ1aWxkIEtub3dsZWRnZSBCYXNlXCIgYnV0dG9uXG4gICAgbGV0IGNhY2hlZCA9IGZhbHNlO1xuICAgIGxldCBjYWNoZWRQYWdlQ291bnQgPSAwO1xuICAgIGxldCBjYWNoZWRBdDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LkFOQUxZU0lTX0JVQ0tFVDtcbiAgICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgICAgIGNvbnN0IHNhZmVEb21haW4gPSBkb21haW4ucmVwbGFjZSgvW15hLXpBLVowLTkuXy1dL2csICdfJyk7XG4gICAgICAgICAgICBjb25zdCBjYWNoZUtleSA9IGAke3NhZmVEb21haW59L2xsbXMtY2FjaGUuanNvbmA7XG4gICAgICAgICAgICBjb25zdCBjYWNoZVJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgICAgIEtleTogY2FjaGVLZXlcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIGNvbnN0IGNhY2hlQm9keSA9IGF3YWl0IGNhY2hlUmVzcG9uc2UuQm9keT8udHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGlmIChjYWNoZUJvZHkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjYWNoZURhdGEgPSBKU09OLnBhcnNlKGNhY2hlQm9keSk7XG4gICAgICAgICAgICAgICAgLy8gVmFsaWRhdGUgVFRMICgxNjggaG91cnMgPSA3IGRheXMpXG4gICAgICAgICAgICAgICAgY29uc3QgY2FjaGVBZ2UgPSBEYXRlLm5vdygpIC0gbmV3IERhdGUoY2FjaGVEYXRhLmNyZWF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHR0bE1zID0gMTY4ICogNjAgKiA2MCAqIDEwMDA7XG4gICAgICAgICAgICAgICAgaWYgKGNhY2hlQWdlIDw9IHR0bE1zKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhY2hlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGNhY2hlZFBhZ2VDb3VudCA9IGNhY2hlRGF0YS5wYWdlQ291bnQgfHwgMDtcbiAgICAgICAgICAgICAgICAgICAgY2FjaGVkQXQgPSBjYWNoZURhdGEuY3JlYXRlZEF0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBObyBjYWNoZSBvciBlcnJvciDigJQgcHJvY2VlZCBub3JtYWxseVxuICAgIH1cblxuICAgIC8vIFRyeSBsbG1zLnR4dCBmaXJzdFxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGxsbXNUeHQgPSBhd2FpdCBxdWlja0ZldGNoKGAke2Jhc2VVcmx9L2xsbXMudHh0YCk7XG4gICAgICAgIGlmIChsbG1zVHh0ICYmIGxsbXNUeHQubGVuZ3RoID4gNTApIHtcbiAgICAgICAgICAgIC8vIENvdW50IHBhZ2VzIGFuZCBleHRyYWN0IHRvcC1sZXZlbCBjYXRlZ29yaWVzIGZyb20gaGVhZGluZyBoaWVyYXJjaHlcbiAgICAgICAgICAgIGNvbnN0IGxpbmVzID0gbGxtc1R4dC5zcGxpdCgnXFxuJyk7XG4gICAgICAgICAgICBjb25zdCBwYWdlTGlua3MgPSBsaW5lcy5maWx0ZXIobCA9PiAvXFxbLitcXF1cXCguK1xcKS8udGVzdChsLnRyaW0oKSkpO1xuICAgICAgICAgICAgY29uc3QgY2F0ZWdvcmllcyA9IGxpbmVzXG4gICAgICAgICAgICAgICAgLmZpbHRlcihsID0+IGwubWF0Y2goL14tXFxzK1tBLVpdLykgJiYgIWwuaW5jbHVkZXMoJ1snKSkubWFwKGwgPT4gbC5yZXBsYWNlKC9eLVxccysvLCAnJykudHJpbSgpKVxuICAgICAgICAgICAgICAgIC5jb25jYXQobGluZXMuZmlsdGVyKGwgPT4gbC5zdGFydHNXaXRoKCcjIyAnKSB8fCBsLnN0YXJ0c1dpdGgoJyMgJykpXG4gICAgICAgICAgICAgICAgICAgIC5tYXAobCA9PiBsLnJlcGxhY2UoL14jK1xccysvLCAnJykudHJpbSgpKSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pLnNsaWNlKDAsIDEwKTtcblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBmb3VuZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgc291cmNlOiAnbGxtcy50eHQnLFxuICAgICAgICAgICAgICAgICAgICBzb3VyY2VVcmw6IGAke2Jhc2VVcmx9L2xsbXMudHh0YCxcbiAgICAgICAgICAgICAgICAgICAgcGFnZUNvdW50OiBwYWdlTGlua3MubGVuZ3RoIHx8IE1hdGguZmxvb3IobGxtc1R4dC5sZW5ndGggLyA4MCksXG4gICAgICAgICAgICAgICAgICAgIGNhdGVnb3JpZXMsXG4gICAgICAgICAgICAgICAgICAgIGRvbWFpbixcbiAgICAgICAgICAgICAgICAgICAgY2FjaGVkLFxuICAgICAgICAgICAgICAgICAgICBjYWNoZWRQYWdlQ291bnQsXG4gICAgICAgICAgICAgICAgICAgIGNhY2hlZEF0XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIHsgLyogbGxtcy50eHQgbm90IGZvdW5kLCB0cnkgc2l0ZW1hcCAqLyB9XG5cbiAgICAvLyBUcnkgc2l0ZW1hcC54bWxcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgcXVpY2tGZXRjaChgJHtiYXNlVXJsfS9zaXRlbWFwLnhtbGApO1xuICAgICAgICBpZiAoc2l0ZW1hcCAmJiBzaXRlbWFwLmxlbmd0aCA+IDUwKSB7XG4gICAgICAgICAgICBjb25zdCB1cmxNYXRjaGVzID0gc2l0ZW1hcC5tYXRjaCgvPGxvYz4oLio/KTxcXC9sb2M+L2dpKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IHVybHMgPSB1cmxNYXRjaGVzLm1hcChtID0+IG0ucmVwbGFjZSgvPFxcLz9sb2M+L2dpLCAnJykudHJpbSgpKTtcbiAgICAgICAgICAgIGNvbnN0IGRvY3NQYXR0ZXJucyA9IFsvXFwvZG9jc1xcLy9pLCAvXFwvZG9jdW1lbnRhdGlvblxcLy9pLCAvXFwvZ3VpZGUvaSwgL1xcL3R1dG9yaWFsL2ksIC9cXC9hcGlcXC8vaSwgL1xcL3JlZmVyZW5jZS9pXTtcbiAgICAgICAgICAgIGNvbnN0IGRvY3NVcmxzID0gdXJscy5maWx0ZXIodSA9PiBkb2NzUGF0dGVybnMuc29tZShwID0+IHAudGVzdCh1KSkpO1xuICAgICAgICAgICAgY29uc3QgZGlzcGxheVVybHMgPSBkb2NzVXJscy5sZW5ndGggPiAwID8gZG9jc1VybHMgOiB1cmxzO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIGZvdW5kOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBzb3VyY2U6ICdzaXRlbWFwLnhtbCcsXG4gICAgICAgICAgICAgICAgICAgIHNvdXJjZVVybDogYCR7YmFzZVVybH0vc2l0ZW1hcC54bWxgLFxuICAgICAgICAgICAgICAgICAgICBwYWdlQ291bnQ6IGRpc3BsYXlVcmxzLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgY2F0ZWdvcmllczogW10sXG4gICAgICAgICAgICAgICAgICAgIGRvbWFpbixcbiAgICAgICAgICAgICAgICAgICAgY2FjaGVkLFxuICAgICAgICAgICAgICAgICAgICBjYWNoZWRQYWdlQ291bnQsXG4gICAgICAgICAgICAgICAgICAgIGNhY2hlZEF0XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIHsgLyogc2l0ZW1hcCBub3QgZm91bmQgZWl0aGVyICovIH1cblxuICAgIC8vIE5laXRoZXIgZm91bmRcbiAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBmb3VuZDogZmFsc2UsXG4gICAgICAgICAgICBzb3VyY2U6IG51bGwsXG4gICAgICAgICAgICBkb21haW4sXG4gICAgICAgICAgICBtZXNzYWdlOiBgQ291bGQgbm90IGZpbmQgbGxtcy50eHQgb3Igc2l0ZW1hcC54bWwgYXQgJHtkb21haW59LiBQbGVhc2UgY2hlY2sgdGhlIFVSTCBvciBwcm92aWRlIHRoZSBkaXJlY3QgbGluayB0byB5b3VyIGxsbXMudHh0IC8gc2l0ZW1hcC54bWwuYFxuICAgICAgICB9KVxuICAgIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZURpc2NvdmVySXNzdWVzUmVxdWVzdChib2R5OiBzdHJpbmcgfCBudWxsLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICAgIC8vIC4uLiAocmVzdCBvZiB0aGUgZmlsZSByZW1haW5zIHNhbWUpXG4gICAgaWYgKCFib2R5KSByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KSB9O1xuICAgIGxldCBkaXNjb3ZlclJlcXVlc3Q6IHsgY29tcGFueU5hbWU6IHN0cmluZzsgZG9tYWluOiBzdHJpbmc7IHNlc3Npb25JZDogc3RyaW5nIH07XG4gICAgdHJ5IHsgZGlzY292ZXJSZXF1ZXN0ID0gSlNPTi5wYXJzZShib2R5KTsgfSBjYXRjaCAoZXJyb3IpIHsgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgSlNPTiBpbiByZXF1ZXN0IGJvZHknIH0pIH07IH1cbiAgICBjb25zdCB7IGNvbXBhbnlOYW1lLCBkb21haW4sIHNlc3Npb25JZCB9ID0gZGlzY292ZXJSZXF1ZXN0O1xuICAgIGlmICghZG9tYWluIHx8ICFzZXNzaW9uSWQpIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdNaXNzaW5nIHJlcXVpcmVkIGZpZWxkczogZG9tYWluIGFuZCBzZXNzaW9uSWQnIH0pIH07XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW52b2tlUGFyYW1zID0ge1xuICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiBwcm9jZXNzLmVudi5JU1NVRV9ESVNDT1ZFUkVSX0ZVTkNUSU9OX05BTUUgfHwgJ2xlbnN5LWlzc3VlLWRpc2NvdmVyZXInLFxuICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoeyBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGNvbXBhbnlOYW1lLCBkb21haW4sIHNlc3Npb25JZCB9KSB9KVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZChpbnZva2VQYXJhbXMpKTtcbiAgICAgICAgaWYgKHJlc3VsdC5QYXlsb2FkKSB7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXN1bHQuUGF5bG9hZCkpO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlUGF5bG9hZC5zdGF0dXNDb2RlID09PSAyMDApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpc3N1ZVJlc3VsdHMgPSBKU09OLnBhcnNlKHJlc3BvbnNlUGF5bG9hZC5ib2R5KTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdGF0dXNDb2RlOiAyMDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeShpc3N1ZVJlc3VsdHMpIH07XG4gICAgICAgICAgICB9IGVsc2UgdGhyb3cgbmV3IEVycm9yKGBJc3N1ZURpc2NvdmVyZXIgZmFpbGVkOiAke3Jlc3BvbnNlUGF5bG9hZC5ib2R5fWApO1xuICAgICAgICB9IGVsc2UgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gSXNzdWVEaXNjb3ZlcmVyJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdHVzQ29kZTogNTAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0lzc3VlIGRpc2NvdmVyeSBmYWlsZWQnLCBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyB9KSB9O1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVmFsaWRhdGVJc3N1ZXNSZXF1ZXN0KGJvZHk6IHN0cmluZyB8IG51bGwsIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgICBpZiAoIWJvZHkpIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pIH07XG4gICAgbGV0IHZhbGlkYXRlUmVxdWVzdDogYW55O1xuICAgIHRyeSB7IHZhbGlkYXRlUmVxdWVzdCA9IEpTT04ucGFyc2UoYm9keSk7IH0gY2F0Y2ggKGVycm9yKSB7IHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdJbnZhbGlkIEpTT04gaW4gcmVxdWVzdCBib2R5JyB9KSB9OyB9XG4gICAgY29uc3QgeyBpc3N1ZXMsIGRvbWFpbiwgc2Vzc2lvbklkIH0gPSB2YWxpZGF0ZVJlcXVlc3Q7XG4gICAgaWYgKCFpc3N1ZXMgfHwgIWRvbWFpbiB8fCAhc2Vzc2lvbklkKSByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTWlzc2luZyByZXF1aXJlZCBmaWVsZHM6IGlzc3VlcywgZG9tYWluLCBhbmQgc2Vzc2lvbklkJyB9KSB9O1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGludm9rZVBhcmFtcyA9IHtcbiAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogcHJvY2Vzcy5lbnYuSVNTVUVfVkFMSURBVE9SX0ZVTkNUSU9OX05BTUUgfHwgJ2xlbnN5LWlzc3VlLXZhbGlkYXRvcicsXG4gICAgICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeSh7IGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgaXNzdWVzLCBkb21haW4sIHNlc3Npb25JZCB9KSB9KVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZChpbnZva2VQYXJhbXMpKTtcbiAgICAgICAgaWYgKHJlc3VsdC5QYXlsb2FkKSB7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXN1bHQuUGF5bG9hZCkpO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlUGF5bG9hZC5zdGF0dXNDb2RlID09PSAyMDApIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0cyA9IEpTT04ucGFyc2UocmVzcG9uc2VQYXlsb2FkLmJvZHkpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDIwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHZhbGlkYXRpb25SZXN1bHRzKSB9O1xuICAgICAgICAgICAgfSBlbHNlIHRocm93IG5ldyBFcnJvcihgSXNzdWVWYWxpZGF0b3IgZmFpbGVkOiAke3Jlc3BvbnNlUGF5bG9hZC5ib2R5fWApO1xuICAgICAgICB9IGVsc2UgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gSXNzdWVWYWxpZGF0b3InKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4geyBzdGF0dXNDb2RlOiA1MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSXNzdWUgdmFsaWRhdGlvbiBmYWlsZWQnLCBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyB9KSB9O1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlR2VuZXJhdGVGaXhlc1JlcXVlc3QoYm9keTogc3RyaW5nIHwgbnVsbCwgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuICAgIGlmICghYm9keSkgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSkgfTtcbiAgICBsZXQgcmVxdWVzdDogYW55O1xuICAgIHRyeSB7IHJlcXVlc3QgPSBKU09OLnBhcnNlKGJvZHkpOyB9IGNhdGNoIChlcnJvcikgeyByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScgfSkgfTsgfVxuXG4gICAgaWYgKCFyZXF1ZXN0LnNlc3Npb25JZCkgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ01pc3NpbmcgcmVxdWlyZWQgZmllbGQ6IHNlc3Npb25JZCcgfSkgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBJbnZva2luZyBGaXhHZW5lcmF0b3IgQVNZTkMgZm9yIHNlc3Npb24gJHtyZXF1ZXN0LnNlc3Npb25JZH1gKTtcbiAgICAgICAgY29uc3QgaW52b2tlUGFyYW1zID0ge1xuICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiBwcm9jZXNzLmVudi5GSVhfR0VORVJBVE9SX0ZVTkNUSU9OX05BTUUgfHwgJ0xlbnN5U3RhY2stRml4R2VuZXJhdG9yRnVuY3Rpb24nLFxuICAgICAgICAgICAgSW52b2NhdGlvblR5cGU6ICdFdmVudCcgYXMgY29uc3QsIC8vIEFzeW5jaHJvbm91cyBpbnZvY2F0aW9uXG4gICAgICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeSh7IGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlcXVlc3QpIH0pXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQobmV3IEludm9rZUNvbW1hbmQoaW52b2tlUGFyYW1zKSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMixcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ0ZpeCBnZW5lcmF0aW9uIHN0YXJ0ZWQgYXN5bmNocm9ub3VzbHknLFxuICAgICAgICAgICAgICAgIHNlc3Npb25JZDogcmVxdWVzdC5zZXNzaW9uSWRcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRml4IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ZpeCBnZW5lcmF0aW9uIGZhaWxlZCcsIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InIH0pXG4gICAgICAgIH07XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVBcHBseUZpeGVzUmVxdWVzdChib2R5OiBzdHJpbmcgfCBudWxsLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgaWYgKCFib2R5KSByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KSB9O1xuICAgIGxldCByZXF1ZXN0OiBhbnk7XG4gICAgdHJ5IHsgcmVxdWVzdCA9IEpTT04ucGFyc2UoYm9keSk7IH0gY2F0Y2ggKGVycm9yKSB7IHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdJbnZhbGlkIEpTT04gaW4gcmVxdWVzdCBib2R5JyB9KSB9OyB9XG5cbiAgICBpZiAoIXJlcXVlc3Quc2Vzc2lvbklkIHx8ICFyZXF1ZXN0LnNlbGVjdGVkRml4SWRzKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdNaXNzaW5nIHJlcXVpcmVkIGZpZWxkczogc2Vzc2lvbklkIGFuZCBzZWxlY3RlZEZpeElkcycgfSkgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZyhgSW52b2tpbmcgRml4QXBwbGljYXRvciBmb3Igc2Vzc2lvbiAke3JlcXVlc3Quc2Vzc2lvbklkfWApO1xuICAgICAgICBjb25zdCBpbnZva2VQYXJhbXMgPSB7XG4gICAgICAgICAgICBGdW5jdGlvbk5hbWU6IHByb2Nlc3MuZW52LkZJWF9BUFBMSUNBVE9SX0ZVTkNUSU9OX05BTUUgfHwgJ0xlbnN5U3RhY2stRml4QXBwbGljYXRvckZ1bmN0aW9uJyxcbiAgICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHsgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxdWVzdCkgfSkgLy8gUGFzcyBhcyBBUEkgR2F0ZXdheSBwcm94eSBldmVudCBib2R5XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQobmV3IEludm9rZUNvbW1hbmQoaW52b2tlUGFyYW1zKSk7XG5cbiAgICAgICAgaWYgKHJlc3VsdC5QYXlsb2FkKSB7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXN1bHQuUGF5bG9hZCkpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZpeEFwcGxpY2F0b3IgcmVzcG9uc2U6JywgcmVzcG9uc2VQYXlsb2FkKTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIExhbWJkYSBleGVjdXRpb24gZXJyb3JzIChlLmcuIFJ1bnRpbWUuSW1wb3J0TW9kdWxlRXJyb3IpXG4gICAgICAgICAgICBpZiAocmVzcG9uc2VQYXlsb2FkLmVycm9yVHlwZSB8fCByZXNwb25zZVBheWxvYWQuZXJyb3JNZXNzYWdlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGaXhBcHBsaWNhdG9yIExhbWJkYSBFcnJvcjogJHtyZXNwb25zZVBheWxvYWQuZXJyb3JNZXNzYWdlIHx8IHJlc3BvbnNlUGF5bG9hZC5lcnJvclR5cGV9YCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEhhbmRsZSBib3RoIGRpcmVjdCBpbnZvY2F0aW9uIHJlc3BvbnNlIGFuZCBwcm94eSByZXNwb25zZVxuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gcmVzcG9uc2VQYXlsb2FkLmJvZHkgPyBKU09OLnBhcnNlKHJlc3BvbnNlUGF5bG9hZC5ib2R5KSA6IHJlc3BvbnNlUGF5bG9hZDtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c0NvZGUgPSByZXNwb25zZVBheWxvYWQuc3RhdHVzQ29kZSB8fCAyMDA7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzQ29kZSxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZUJvZHkpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gRml4QXBwbGljYXRvcicpO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRml4IGFwcGxpY2F0aW9uIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdGaXggYXBwbGljYXRpb24gZmFpbGVkJywgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicgfSlcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUdldEZpeGVzUmVxdWVzdChwYXRoOiBzdHJpbmcsIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KSB7XG4gICAgLy8gRXh0cmFjdCBzZXNzaW9uSWQ6IFxuICAgIC8vIEZvcm1hdCAxOiAvZ2V0LWZpeGVzL3tzZXNzaW9uSWR9XG4gICAgLy8gRm9ybWF0IDI6IC9zZXNzaW9ucy97c2Vzc2lvbklkfS9maXhlc1xuICAgIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICAgIGxldCBzZXNzaW9uSWQgPSAnJztcblxuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoJy9nZXQtZml4ZXMvJykpIHtcbiAgICAgICAgc2Vzc2lvbklkID0gcGFydHNbMl07XG4gICAgfSBlbHNlIGlmIChwYXRoLnN0YXJ0c1dpdGgoJy9zZXNzaW9ucy8nKSkge1xuICAgICAgICBzZXNzaW9uSWQgPSBwYXJ0c1syXTtcbiAgICB9XG5cbiAgICBpZiAoIXNlc3Npb25JZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnU2Vzc2lvbiBJRCBpcyByZXF1aXJlZCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUIHx8ICdsZW5zeS1hbmFseXNpcy05NTE0MTE2NzY1MjUtdXMtZWFzdC0xJztcbiAgICAgICAgY29uc3QgZml4ZXNLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L2ZpeGVzLmpzb25gO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBmaXhlcyBmb3Igc2Vzc2lvbiAke3Nlc3Npb25JZH0gZnJvbSAke2J1Y2tldE5hbWV9LyR7Zml4ZXNLZXl9YCk7XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogZml4ZXNLZXlcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZXNwb25zZS5Cb2R5Py50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICBpZiAoIWNvbnRlbnQpIHRocm93IG5ldyBFcnJvcignRW1wdHkgcmVzcG9uc2UgZnJvbSBTMycpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IGNvbnRlbnRcbiAgICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGdldCBmaXhlczonLCBlcnJvcik7XG4gICAgICAgIGlmIChlcnJvci5uYW1lID09PSAnTm9TdWNoS2V5Jykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ZpeGVzIG5vdCBmb3VuZCBmb3IgdGhpcyBzZXNzaW9uJywgc2Vzc2lvbklkIH0pXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBlcnJvcjogJ0ZhaWxlZCB0byByZXRyaWV2ZSBmaXhlcycsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxufVxuIl19