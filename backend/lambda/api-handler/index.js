"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_lambda_1 = require("@aws-sdk/client-lambda");
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
        new URL(analysisRequest.url);
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
            // [NEW] Try to fetch cached sitemap health data for Doc Mode (session-specific)
            let cachedSitemapHealth = null;
            try {
                const sitemapHealthKey = `sessions/${sessionId}/doc-mode-sitemap-health.json`;
                console.log(`Attempting to fetch Doc Mode sitemap health from key: ${sitemapHealthKey}`);
                const healthResponse = await s3.send(new GetObjectCommand({
                    Bucket: bucketName,
                    Key: sitemapHealthKey
                }));
                const healthContent = await healthResponse.Body.transformToString();
                const rawHealth = JSON.parse(healthContent);
                cachedSitemapHealth = {
                    ...rawHealth,
                    brokenUrls: rawHealth.brokenUrls || 0,
                    accessDeniedUrls: rawHealth.accessDeniedUrls || 0,
                    timeoutUrls: rawHealth.timeoutUrls || 0,
                    otherErrorUrls: rawHealth.otherErrorUrls || 0
                };
                console.log('Successfully retrieved Doc Mode sitemap health data');
            }
            catch (err) {
                console.log('No Doc Mode sitemap health data found:', err);
                // Non-blocking
            }
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
                sitemapHealth: cachedSitemapHealth || undefined,
                aiReadiness: undefined // Will be populated below
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
