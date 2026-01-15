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
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Not found',
                method: httpMethod,
                path: path,
                availableRoutes: ['POST /analyze', 'POST /discover-issues', 'POST /validate-issues', 'GET /status/{sessionId}']
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
        console.log(`Invoking FixGenerator for session ${request.sessionId}`);
        const invokeParams = {
            FunctionName: process.env.FIX_GENERATOR_FUNCTION_NAME || 'LensyStack-FixGeneratorFunction',
            Payload: JSON.stringify({ body: JSON.stringify(request) }) // Pass as API Gateway proxy event body
        };
        const result = await lambdaClient.send(new client_lambda_1.InvokeCommand(invokeParams));
        if (result.Payload) {
            const responsePayload = JSON.parse(new TextDecoder().decode(result.Payload));
            console.log('FixGenerator response:', responsePayload);
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
            throw new Error('No response payload from FixGenerator');
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9sYW1iZGEvYXBpLWhhbmRsZXIvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0Esb0RBQWlHO0FBQ2pHLGtEQUFnRTtBQUNoRSwwREFBcUU7QUFFckUsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFDbkYsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFDakYsTUFBTSxZQUFZLEdBQUcsSUFBSSw0QkFBWSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFlbEYsTUFBTSxPQUFPLEdBQXNCLEtBQUssRUFBRSxLQUFVLEVBQUUsRUFBRTtJQUMzRCxPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7SUFDMUQsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQkFBK0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUU3RSxrREFBa0Q7SUFDbEQsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLFVBQVUsSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLElBQUksRUFBRSxNQUFNLENBQUM7SUFDMUUsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksSUFBSSxLQUFLLENBQUMsT0FBTyxJQUFJLEtBQUssQ0FBQyxjQUFjLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztJQUM3RSxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDO0lBRXhCLE9B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QkFBd0IsRUFBRSxPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZSxFQUFFLENBQUM7U0FDL0gsQ0FBQztLQUNMO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgU0ZOQ2xpZW50LCBTdGFydEV4ZWN1dGlvbkNvbW1hbmQsIERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZm4nO1xuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XG5cbmNvbnN0IHNmbkNsaWVudCA9IG5ldyBTRk5DbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcbmNvbnN0IGxhbWJkYUNsaWVudCA9IG5ldyBMYW1iZGFDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5cbmludGVyZmFjZSBBbmFseXNpc1JlcXVlc3Qge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHNlbGVjdGVkTW9kZWw6ICdjbGF1ZGUnIHwgJ3RpdGFuJyB8ICdsbGFtYScgfCAnYXV0byc7XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgY29udGV4dEFuYWx5c2lzPzoge1xuICAgICAgICBlbmFibGVkOiBib29sZWFuO1xuICAgICAgICBtYXhDb250ZXh0UGFnZXM/OiBudW1iZXI7XG4gICAgfTtcbiAgICBjYWNoZUNvbnRyb2w/OiB7XG4gICAgICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8YW55LCBhbnk+ID0gYXN5bmMgKGV2ZW50OiBhbnkpID0+IHtcbiAgICBjb25zb2xlLmxvZyhcIkxlbnN5IFByb2R1Y3Rpb24gQVBJIC0gRGVwbG95IHYxLjEuMCBSZWFkeVwiKTtcbiAgICBjb25zb2xlLmxvZygnQVBJIEhhbmRsZXIgcmVjZWl2ZWQgcmVxdWVzdDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuXG4gICAgLy8gSGFuZGxlIGJvdGggQVBJIEdhdGV3YXkgVjEgYW5kIFYyIGV2ZW50IGZvcm1hdHNcbiAgICBjb25zdCBodHRwTWV0aG9kID0gZXZlbnQuaHR0cE1ldGhvZCB8fCBldmVudC5yZXF1ZXN0Q29udGV4dD8uaHR0cD8ubWV0aG9kO1xuICAgIGNvbnN0IHBhdGggPSBldmVudC5wYXRoIHx8IGV2ZW50LnJhd1BhdGggfHwgZXZlbnQucmVxdWVzdENvbnRleHQ/Lmh0dHA/LnBhdGg7XG4gICAgY29uc3QgYm9keSA9IGV2ZW50LmJvZHk7XG5cbiAgICBjb25zb2xlLmxvZygnRXh0cmFjdGVkIG1ldGhvZDonLCBodHRwTWV0aG9kLCAncGF0aDonLCBwYXRoKTtcblxuICAgIC8vIENPUlMgaGVhZGVyc1xuICAgIGNvbnN0IGNvcnNIZWFkZXJzID0ge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ09QVElPTlMsUE9TVCxHRVQnLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgfTtcblxuICAgIC8vIEhhbmRsZSBDT1JTIHByZWZsaWdodFxuICAgIGlmIChodHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogJydcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIChwYXRoID09PSAnL2FuYWx5emUnIHx8IHBhdGggPT09ICcvc2Nhbi1kb2MnKSkge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUFuYWx5emVSZXF1ZXN0KGJvZHksIGNvcnNIZWFkZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChodHRwTWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9kaXNjb3Zlci1pc3N1ZXMnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlRGlzY292ZXJJc3N1ZXNSZXF1ZXN0KGJvZHksIGNvcnNIZWFkZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChodHRwTWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy92YWxpZGF0ZS1pc3N1ZXMnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlVmFsaWRhdGVJc3N1ZXNSZXF1ZXN0KGJvZHksIGNvcnNIZWFkZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChodHRwTWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9nZW5lcmF0ZS1maXhlcycpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVHZW5lcmF0ZUZpeGVzUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBwbHktZml4ZXMnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQXBwbHlGaXhlc1JlcXVlc3QoYm9keSwgY29yc0hlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGh0dHBNZXRob2QgPT09ICdHRVQnICYmIHBhdGg/LnN0YXJ0c1dpdGgoJy9zdGF0dXMvJykpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVTdGF0dXNSZXF1ZXN0KHBhdGgsIGNvcnNIZWFkZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBlcnJvcjogJ05vdCBmb3VuZCcsXG4gICAgICAgICAgICAgICAgbWV0aG9kOiBodHRwTWV0aG9kLFxuICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlUm91dGVzOiBbJ1BPU1QgL2FuYWx5emUnLCAnUE9TVCAvZGlzY292ZXItaXNzdWVzJywgJ1BPU1QgL3ZhbGlkYXRlLWlzc3VlcycsICdHRVQgL3N0YXR1cy97c2Vzc2lvbklkfSddXG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignQVBJIEhhbmRsZXIgZXJyb3I6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuICAgIH1cbn07XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUFuYWx5emVSZXF1ZXN0KGJvZHk6IHN0cmluZyB8IG51bGwsIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KSB7XG4gICAgaWYgKCFib2R5KSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgbGV0IGFuYWx5c2lzUmVxdWVzdDogQW5hbHlzaXNSZXF1ZXN0O1xuXG4gICAgdHJ5IHtcbiAgICAgICAgYW5hbHlzaXNSZXF1ZXN0ID0gSlNPTi5wYXJzZShib2R5KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSByZXF1ZXN0XG4gICAgaWYgKCFhbmFseXNpc1JlcXVlc3QudXJsIHx8ICFhbmFseXNpc1JlcXVlc3Quc2Vzc2lvbklkKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBlcnJvcjogJ01pc3NpbmcgcmVxdWlyZWQgZmllbGRzOiB1cmwgYW5kIHNlc3Npb25JZCBhcmUgcmVxdWlyZWQnXG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIFVSTCBmb3JtYXRcbiAgICB0cnkge1xuICAgICAgICBuZXcgVVJMKGFuYWx5c2lzUmVxdWVzdC51cmwpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdJbnZhbGlkIFVSTCBmb3JtYXQnIH0pXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU3RhcnQgU3RlcCBGdW5jdGlvbnMgZXhlY3V0aW9uXG4gICAgY29uc3QgZXhlY3V0aW9uTmFtZSA9IGBhbmFseXNpcy0ke2FuYWx5c2lzUmVxdWVzdC5zZXNzaW9uSWR9LSR7RGF0ZS5ub3coKX1gO1xuICAgIGNvbnN0IHN0YXRlTWFjaGluZUFybiA9IHByb2Nlc3MuZW52LlNUQVRFX01BQ0hJTkVfQVJOO1xuXG4gICAgaWYgKCFzdGF0ZU1hY2hpbmVBcm4pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTVEFURV9NQUNISU5FX0FSTiBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coJ1N0YXJ0aW5nIFN0ZXAgRnVuY3Rpb25zIGV4ZWN1dGlvbjonLCBleGVjdXRpb25OYW1lKTtcblxuICAgIGNvbnN0IHN0YXJ0RXhlY3V0aW9uQ29tbWFuZCA9IG5ldyBTdGFydEV4ZWN1dGlvbkNvbW1hbmQoe1xuICAgICAgICBzdGF0ZU1hY2hpbmVBcm4sXG4gICAgICAgIG5hbWU6IGV4ZWN1dGlvbk5hbWUsXG4gICAgICAgIGlucHV0OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAuLi5hbmFseXNpc1JlcXVlc3QsXG4gICAgICAgICAgICBhbmFseXNpc1N0YXJ0VGltZTogRGF0ZS5ub3coKVxuICAgICAgICB9KVxuICAgIH0pO1xuXG4gICAgY29uc3QgZXhlY3V0aW9uID0gYXdhaXQgc2ZuQ2xpZW50LnNlbmQoc3RhcnRFeGVjdXRpb25Db21tYW5kKTtcblxuICAgIGNvbnNvbGUubG9nKGBTdGFydGVkIGFuYWx5c2lzIGV4ZWN1dGlvbjogJHtleGVjdXRpb24uZXhlY3V0aW9uQXJufWApO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogMjAyLFxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgbWVzc2FnZTogJ0FuYWx5c2lzIHN0YXJ0ZWQnLFxuICAgICAgICAgICAgZXhlY3V0aW9uQXJuOiBleGVjdXRpb24uZXhlY3V0aW9uQXJuLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBhbmFseXNpc1JlcXVlc3Quc2Vzc2lvbklkLFxuICAgICAgICAgICAgc3RhdHVzOiAnc3RhcnRlZCdcbiAgICAgICAgfSlcbiAgICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVTdGF0dXNSZXF1ZXN0KHBhdGg6IHN0cmluZywgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBwYXRoLnNwbGl0KCcvJylbMl07XG5cbiAgICBpZiAoIXNlc3Npb25JZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnU2Vzc2lvbiBJRCBpcyByZXF1aXJlZCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUIHx8ICdsZW5zeS1hbmFseXNpcy05NTE0MTE2NzY1MjUtdXMtZWFzdC0xJztcblxuICAgICAgICAvLyBUcnkgdG8gZ2V0IHRoZSBmaW5hbCByZXBvcnQgZnJvbSBTM1xuICAgICAgICBjb25zdCB7IFMzQ2xpZW50LCBHZXRPYmplY3RDb21tYW5kIH0gPSByZXF1aXJlKCdAYXdzLXNkay9jbGllbnQtczMnKTtcbiAgICAgICAgY29uc3QgczMgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5cbiAgICAgICAgLy8gRmlyc3QsIGNoZWNrIGlmIHRoaXMgaXMgc2l0ZW1hcCBtb2RlIGJ5IGxvb2tpbmcgZm9yIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHNcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXBIZWFsdGhLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L3NpdGVtYXAtaGVhbHRoLXJlc3VsdHMuanNvbmA7XG4gICAgICAgICAgICBjb25zdCBzaXRlbWFwSGVhbHRoUmVzcG9uc2UgPSBhd2FpdCBzMy5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgS2V5OiBzaXRlbWFwSGVhbHRoS2V5XG4gICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXBIZWFsdGhDb250ZW50ID0gYXdhaXQgc2l0ZW1hcEhlYWx0aFJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXBIZWFsdGhSZXN1bHRzID0gSlNPTi5wYXJzZShzaXRlbWFwSGVhbHRoQ29udGVudCk7XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGb3VuZCBzaXRlbWFwIGhlYWx0aCByZXN1bHRzIC0gdGhpcyBpcyBzaXRlbWFwIG1vZGUnKTtcblxuICAgICAgICAgICAgLy8gR2V0IHNlc3Npb24gbWV0YWRhdGEgZm9yIHRpbWluZ1xuICAgICAgICAgICAgbGV0IGFuYWx5c2lzU3RhcnRUaW1lID0gRGF0ZS5ub3coKTsgLy8gZmFsbGJhY2tcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L21ldGFkYXRhLmpzb25gO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhUmVzcG9uc2UgPSBhd2FpdCBzMy5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgICAgICAgICBLZXk6IG1ldGFkYXRhS2V5XG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhU3RyID0gYXdhaXQgbWV0YWRhdGFSZXNwb25zZS5Cb2R5LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBKU09OLnBhcnNlKG1ldGFkYXRhU3RyKTtcbiAgICAgICAgICAgICAgICBhbmFseXNpc1N0YXJ0VGltZSA9IG1ldGFkYXRhLnN0YXJ0VGltZSB8fCBEYXRlLm5vdygpO1xuICAgICAgICAgICAgfSBjYXRjaCAobWV0YWRhdGFFcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBtZXRhZGF0YSBmb3VuZCwgdXNpbmcgY3VycmVudCB0aW1lJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGFjdHVhbEFuYWx5c2lzVGltZSA9IERhdGUubm93KCkgLSBhbmFseXNpc1N0YXJ0VGltZTtcbiAgICAgICAgICAgIGNvbnN0IGhlYWx0aFBlcmNlbnRhZ2UgPSBzaXRlbWFwSGVhbHRoUmVzdWx0cy5oZWFsdGhQZXJjZW50YWdlIHx8IDA7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlcG9ydCA9IHtcbiAgICAgICAgICAgICAgICBvdmVyYWxsU2NvcmU6IGhlYWx0aFBlcmNlbnRhZ2UsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc0FuYWx5emVkOiAxLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNUb3RhbDogMSxcbiAgICAgICAgICAgICAgICBjb25maWRlbmNlOiAnaGlnaCcsXG4gICAgICAgICAgICAgICAgbW9kZWxVc2VkOiAnU2l0ZW1hcCBIZWFsdGggQ2hlY2tlcicsXG4gICAgICAgICAgICAgICAgY2FjaGVTdGF0dXM6ICdtaXNzJyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zOiB7fSxcbiAgICAgICAgICAgICAgICBjb2RlQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgc25pcHBldHNGb3VuZDogMCxcbiAgICAgICAgICAgICAgICAgICAgc3ludGF4RXJyb3JzOiAwLFxuICAgICAgICAgICAgICAgICAgICBkZXByZWNhdGVkTWV0aG9kczogMCxcbiAgICAgICAgICAgICAgICAgICAgbWlzc2luZ1ZlcnNpb25TcGVjczogMCxcbiAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2VzRGV0ZWN0ZWQ6IFtdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtZWRpYUFuYWx5c2lzOiB7XG4gICAgICAgICAgICAgICAgICAgIHZpZGVvc0ZvdW5kOiAwLFxuICAgICAgICAgICAgICAgICAgICBhdWRpb3NGb3VuZDogMCxcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2VzRm91bmQ6IDAsXG4gICAgICAgICAgICAgICAgICAgIGludGVyYWN0aXZlRWxlbWVudHM6IDAsXG4gICAgICAgICAgICAgICAgICAgIGFjY2Vzc2liaWxpdHlJc3N1ZXM6IDAsXG4gICAgICAgICAgICAgICAgICAgIG1pc3NpbmdBbHRUZXh0OiAwXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBsaW5rQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgdG90YWxMaW5rczogMCxcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJuYWxMaW5rczogMCxcbiAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxMaW5rczogMCxcbiAgICAgICAgICAgICAgICAgICAgYnJva2VuTGlua3M6IDAsXG4gICAgICAgICAgICAgICAgICAgIHN1YlBhZ2VzSWRlbnRpZmllZDogW10sXG4gICAgICAgICAgICAgICAgICAgIGxpbmtDb250ZXh0OiAnc2luZ2xlLXBhZ2UnLFxuICAgICAgICAgICAgICAgICAgICBhbmFseXNpc1Njb3BlOiAnY3VycmVudC1wYWdlLW9ubHknXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzaXRlbWFwSGVhbHRoOiB7XG4gICAgICAgICAgICAgICAgICAgIHRvdGFsVXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMudG90YWxVcmxzLFxuICAgICAgICAgICAgICAgICAgICBoZWFsdGh5VXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMuaGVhbHRoeVVybHMsXG4gICAgICAgICAgICAgICAgICAgIGJyb2tlblVybHM6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmxpbmtJc3N1ZXM/LmZpbHRlcigoaXNzdWU6IGFueSkgPT4gaXNzdWUuaXNzdWVUeXBlID09PSAnNDA0JykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGFjY2Vzc0RlbmllZFVybHM6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmxpbmtJc3N1ZXM/LmZpbHRlcigoaXNzdWU6IGFueSkgPT4gaXNzdWUuaXNzdWVUeXBlID09PSAnYWNjZXNzLWRlbmllZCcpLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICB0aW1lb3V0VXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMubGlua0lzc3Vlcz8uZmlsdGVyKChpc3N1ZTogYW55KSA9PiBpc3N1ZS5pc3N1ZVR5cGUgPT09ICd0aW1lb3V0JykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIG90aGVyRXJyb3JVcmxzOiBzaXRlbWFwSGVhbHRoUmVzdWx0cy5saW5rSXNzdWVzPy5maWx0ZXIoKGlzc3VlOiBhbnkpID0+IGlzc3VlLmlzc3VlVHlwZSA9PT0gJ2Vycm9yJykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGhlYWx0aFBlcmNlbnRhZ2U6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmhlYWx0aFBlcmNlbnRhZ2UsXG4gICAgICAgICAgICAgICAgICAgIGxpbmtJc3N1ZXM6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmxpbmtJc3N1ZXMgfHwgW10sXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NpbmdUaW1lOiBzaXRlbWFwSGVhbHRoUmVzdWx0cy5wcm9jZXNzaW5nVGltZVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYW5hbHlzaXNUaW1lOiBhY3R1YWxBbmFseXNpc1RpbWUsXG4gICAgICAgICAgICAgICAgcmV0cnlDb3VudDogMFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICAgICAgICAgICAgICAgIHJlcG9ydFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gY2F0Y2ggKHNpdGVtYXBFcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHMgZm91bmQsIGNoZWNraW5nIGZvciBkb2MgbW9kZSByZXN1bHRzJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBET0MgTU9ERTogQ2hlY2sgZm9yIGRpbWVuc2lvbiByZXN1bHRzXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBkaW1lbnNpb25LZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L2RpbWVuc2lvbi1yZXN1bHRzLmpzb25gO1xuICAgICAgICAgICAgY29uc3QgZGltZW5zaW9uUmVzcG9uc2UgPSBhd2FpdCBzMy5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgS2V5OiBkaW1lbnNpb25LZXlcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgY29uc3QgZGltZW5zaW9uQ29udGVudCA9IGF3YWl0IGRpbWVuc2lvblJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGNvbnN0IGRpbWVuc2lvblJlc3VsdHMgPSBKU09OLnBhcnNlKGRpbWVuc2lvbkNvbnRlbnQpO1xuXG4gICAgICAgICAgICBjb25zdCBjb250ZW50S2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uYDtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IGNvbnRlbnRLZXlcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgY29uc3QgY29udGVudFN0ciA9IGF3YWl0IGNvbnRlbnRSZXNwb25zZS5Cb2R5LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzZWRDb250ZW50ID0gSlNPTi5wYXJzZShjb250ZW50U3RyKTtcblxuICAgICAgICAgICAgbGV0IG1vZGVsVXNlZCA9ICdjbGF1ZGUnOyAvLyBkZWZhdWx0XG4gICAgICAgICAgICBsZXQgYW5hbHlzaXNTdGFydFRpbWUgPSBEYXRlLm5vdygpOyAvLyBmYWxsYmFja1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YUtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vbWV0YWRhdGEuanNvbmA7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIEtleTogbWV0YWRhdGFLZXlcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFTdHIgPSBhd2FpdCBtZXRhZGF0YVJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IEpTT04ucGFyc2UobWV0YWRhdGFTdHIpO1xuICAgICAgICAgICAgICAgIG1vZGVsVXNlZCA9IG1ldGFkYXRhLnNlbGVjdGVkTW9kZWwgfHwgJ2NsYXVkZSc7XG4gICAgICAgICAgICAgICAgYW5hbHlzaXNTdGFydFRpbWUgPSBtZXRhZGF0YS5zdGFydFRpbWUgfHwgRGF0ZS5ub3coKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKG1ldGFkYXRhRXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gbWV0YWRhdGEgZm91bmQsIHVzaW5nIGRlZmF1bHQgbW9kZWwgYW5kIGN1cnJlbnQgdGltZScpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBhY3R1YWxBbmFseXNpc1RpbWUgPSBEYXRlLm5vdygpIC0gYW5hbHlzaXNTdGFydFRpbWU7XG5cbiAgICAgICAgICAgIGNvbnN0IHZhbGlkU2NvcmVzID0gT2JqZWN0LnZhbHVlcyhkaW1lbnNpb25SZXN1bHRzKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKGQ6IGFueSkgPT4gZC5zY29yZSAhPT0gbnVsbCAmJiBkLnN0YXR1cyA9PT0gJ2NvbXBsZXRlJylcbiAgICAgICAgICAgICAgICAubWFwKChkOiBhbnkpID0+IGQuc2NvcmUpO1xuXG4gICAgICAgICAgICBjb25zdCBvdmVyYWxsU2NvcmUgPSB2YWxpZFNjb3Jlcy5sZW5ndGggPiAwXG4gICAgICAgICAgICAgICAgPyBNYXRoLnJvdW5kKHZhbGlkU2NvcmVzLnJlZHVjZSgoc3VtOiBudW1iZXIsIHNjb3JlOiBudW1iZXIpID0+IHN1bSArIHNjb3JlLCAwKSAvIHZhbGlkU2NvcmVzLmxlbmd0aClcbiAgICAgICAgICAgICAgICA6IDA7XG5cbiAgICAgICAgICAgIGxldCBjb250ZXh0QW5hbHlzaXMgPSBudWxsO1xuICAgICAgICAgICAgaWYgKHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzKSB7XG4gICAgICAgICAgICAgICAgY29udGV4dEFuYWx5c2lzID0ge1xuICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBjb250ZXh0UGFnZXM6IHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzLmNvbnRleHRQYWdlcyB8fCBbXSxcbiAgICAgICAgICAgICAgICAgICAgYW5hbHlzaXNTY29wZTogcHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMuYW5hbHlzaXNTY29wZSB8fCAnc2luZ2xlLXBhZ2UnLFxuICAgICAgICAgICAgICAgICAgICB0b3RhbFBhZ2VzQW5hbHl6ZWQ6IHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzLnRvdGFsUGFnZXNBbmFseXplZCB8fCAxXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcmVwb3J0ID0ge1xuICAgICAgICAgICAgICAgIG92ZXJhbGxTY29yZSxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zQW5hbHl6ZWQ6IHZhbGlkU2NvcmVzLmxlbmd0aCxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zVG90YWw6IDUsXG4gICAgICAgICAgICAgICAgY29uZmlkZW5jZTogdmFsaWRTY29yZXMubGVuZ3RoID09PSA1ID8gJ2hpZ2gnIDogdmFsaWRTY29yZXMubGVuZ3RoID49IDMgPyAnbWVkaXVtJyA6ICdsb3cnLFxuICAgICAgICAgICAgICAgIG1vZGVsVXNlZDogbW9kZWxVc2VkLFxuICAgICAgICAgICAgICAgIGNhY2hlU3RhdHVzOiBwcm9jZXNzZWRDb250ZW50LmNhY2hlTWV0YWRhdGE/Lndhc0Zyb21DYWNoZSA/ICdoaXQnIDogJ21pc3MnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6IGRpbWVuc2lvblJlc3VsdHMsXG4gICAgICAgICAgICAgICAgY29kZUFuYWx5c2lzOiB7XG4gICAgICAgICAgICAgICAgICAgIHNuaXBwZXRzRm91bmQ6IHByb2Nlc3NlZENvbnRlbnQuZW5oYW5jZWRDb2RlQW5hbHlzaXM/LmFuYWx5emVkU25pcHBldHMgfHwgcHJvY2Vzc2VkQ29udGVudC5jb2RlU25pcHBldHM/Lmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBzeW50YXhFcnJvcnM6IHByb2Nlc3NlZENvbnRlbnQuZW5oYW5jZWRDb2RlQW5hbHlzaXM/LnN5bnRheEVycm9yRmluZGluZ3M/Lmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBkZXByZWNhdGVkTWV0aG9kczogcHJvY2Vzc2VkQ29udGVudC5lbmhhbmNlZENvZGVBbmFseXNpcz8uZGVwcmVjYXRlZENvZGVGaW5kaW5ncz8ubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIG1pc3NpbmdWZXJzaW9uU3BlY3M6IHByb2Nlc3NlZENvbnRlbnQuY29kZVNuaXBwZXRzPy5maWx0ZXIoKHM6IGFueSkgPT4gIXMuaGFzVmVyc2lvbkluZm8pLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBsYW5ndWFnZXNEZXRlY3RlZDogcHJvY2Vzc2VkQ29udGVudC5jb2RlU25pcHBldHMgPyBbLi4ubmV3IFNldChwcm9jZXNzZWRDb250ZW50LmNvZGVTbmlwcGV0cy5tYXAoKHM6IGFueSkgPT4gcy5sYW5ndWFnZSkuZmlsdGVyKEJvb2xlYW4pKV0gOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgZW5oYW5jZWRBbmFseXNpczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVwcmVjYXRlZEZpbmRpbmdzOiBwcm9jZXNzZWRDb250ZW50LmVuaGFuY2VkQ29kZUFuYWx5c2lzPy5kZXByZWNhdGVkQ29kZUZpbmRpbmdzIHx8IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3ludGF4RXJyb3JGaW5kaW5nczogcHJvY2Vzc2VkQ29udGVudC5lbmhhbmNlZENvZGVBbmFseXNpcz8uc3ludGF4RXJyb3JGaW5kaW5ncyB8fCBbXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtZWRpYUFuYWx5c2lzOiB7XG4gICAgICAgICAgICAgICAgICAgIHZpZGVvc0ZvdW5kOiBwcm9jZXNzZWRDb250ZW50Lm1lZGlhRWxlbWVudHM/LmZpbHRlcigobTogYW55KSA9PiBtLnR5cGUgPT09ICd2aWRlbycpLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBhdWRpb3NGb3VuZDogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS50eXBlID09PSAnYXVkaW8nKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2VzRm91bmQ6IHByb2Nlc3NlZENvbnRlbnQubWVkaWFFbGVtZW50cz8uZmlsdGVyKChtOiBhbnkpID0+IG0udHlwZSA9PT0gJ2ltYWdlJykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGludGVyYWN0aXZlRWxlbWVudHM6IHByb2Nlc3NlZENvbnRlbnQubWVkaWFFbGVtZW50cz8uZmlsdGVyKChtOiBhbnkpID0+IG0udHlwZSA9PT0gJ2ludGVyYWN0aXZlJykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGFjY2Vzc2liaWxpdHlJc3N1ZXM6IHByb2Nlc3NlZENvbnRlbnQubWVkaWFFbGVtZW50cz8uZmlsdGVyKChtOiBhbnkpID0+IG0uYW5hbHlzaXNOb3RlPy5pbmNsdWRlcygnYWNjZXNzaWJpbGl0eScpKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgbWlzc2luZ0FsdFRleHQ6IHByb2Nlc3NlZENvbnRlbnQubWVkaWFFbGVtZW50cz8uZmlsdGVyKChtOiBhbnkpID0+IG0udHlwZSA9PT0gJ2ltYWdlJyAmJiAhbS5hbHQpLmxlbmd0aCB8fCAwXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBsaW5rQW5hbHlzaXM6IHByb2Nlc3NlZENvbnRlbnQubGlua0FuYWx5c2lzIHx8IHByb2Nlc3NlZENvbnRlbnQuZW5oYW5jZWRMaW5rQW5hbHlzaXMgfHwge30sXG4gICAgICAgICAgICAgICAgLi4uKGNvbnRleHRBbmFseXNpcyAmJiB7IGNvbnRleHRBbmFseXNpcyB9KSxcbiAgICAgICAgICAgICAgICBhbmFseXNpc1RpbWU6IGFjdHVhbEFuYWx5c2lzVGltZSxcbiAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgICAgICAgICAgICAgcmVwb3J0XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBjYXRjaCAoZG9jTW9kZUVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnaW5fcHJvZ3Jlc3MnLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiAnQW5hbHlzaXMgaW4gcHJvZ3Jlc3MnXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1N0YXR1cyBjaGVjayBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgZXJyb3I6ICdGYWlsZWQgdG8gY2hlY2sgc3RhdHVzJyxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZURpc2NvdmVySXNzdWVzUmVxdWVzdChib2R5OiBzdHJpbmcgfCBudWxsLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICAgIC8vIC4uLiAocmVzdCBvZiB0aGUgZmlsZSByZW1haW5zIHNhbWUpXG4gICAgaWYgKCFib2R5KSByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KSB9O1xuICAgIGxldCBkaXNjb3ZlclJlcXVlc3Q6IHsgY29tcGFueU5hbWU6IHN0cmluZzsgZG9tYWluOiBzdHJpbmc7IHNlc3Npb25JZDogc3RyaW5nIH07XG4gICAgdHJ5IHsgZGlzY292ZXJSZXF1ZXN0ID0gSlNPTi5wYXJzZShib2R5KTsgfSBjYXRjaCAoZXJyb3IpIHsgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgSlNPTiBpbiByZXF1ZXN0IGJvZHknIH0pIH07IH1cbiAgICBjb25zdCB7IGNvbXBhbnlOYW1lLCBkb21haW4sIHNlc3Npb25JZCB9ID0gZGlzY292ZXJSZXF1ZXN0O1xuICAgIGlmICghZG9tYWluIHx8ICFzZXNzaW9uSWQpIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdNaXNzaW5nIHJlcXVpcmVkIGZpZWxkczogZG9tYWluIGFuZCBzZXNzaW9uSWQnIH0pIH07XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW52b2tlUGFyYW1zID0ge1xuICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiBwcm9jZXNzLmVudi5JU1NVRV9ESVNDT1ZFUkVSX0ZVTkNUSU9OX05BTUUgfHwgJ2xlbnN5LWlzc3VlLWRpc2NvdmVyZXInLFxuICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoeyBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGNvbXBhbnlOYW1lLCBkb21haW4sIHNlc3Npb25JZCB9KSB9KVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZChpbnZva2VQYXJhbXMpKTtcbiAgICAgICAgaWYgKHJlc3VsdC5QYXlsb2FkKSB7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXN1bHQuUGF5bG9hZCkpO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlUGF5bG9hZC5zdGF0dXNDb2RlID09PSAyMDApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpc3N1ZVJlc3VsdHMgPSBKU09OLnBhcnNlKHJlc3BvbnNlUGF5bG9hZC5ib2R5KTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdGF0dXNDb2RlOiAyMDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeShpc3N1ZVJlc3VsdHMpIH07XG4gICAgICAgICAgICB9IGVsc2UgdGhyb3cgbmV3IEVycm9yKGBJc3N1ZURpc2NvdmVyZXIgZmFpbGVkOiAke3Jlc3BvbnNlUGF5bG9hZC5ib2R5fWApO1xuICAgICAgICB9IGVsc2UgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gSXNzdWVEaXNjb3ZlcmVyJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdHVzQ29kZTogNTAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0lzc3VlIGRpc2NvdmVyeSBmYWlsZWQnLCBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyB9KSB9O1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVmFsaWRhdGVJc3N1ZXNSZXF1ZXN0KGJvZHk6IHN0cmluZyB8IG51bGwsIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgICBpZiAoIWJvZHkpIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pIH07XG4gICAgbGV0IHZhbGlkYXRlUmVxdWVzdDogYW55O1xuICAgIHRyeSB7IHZhbGlkYXRlUmVxdWVzdCA9IEpTT04ucGFyc2UoYm9keSk7IH0gY2F0Y2ggKGVycm9yKSB7IHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdJbnZhbGlkIEpTT04gaW4gcmVxdWVzdCBib2R5JyB9KSB9OyB9XG4gICAgY29uc3QgeyBpc3N1ZXMsIGRvbWFpbiwgc2Vzc2lvbklkIH0gPSB2YWxpZGF0ZVJlcXVlc3Q7XG4gICAgaWYgKCFpc3N1ZXMgfHwgIWRvbWFpbiB8fCAhc2Vzc2lvbklkKSByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTWlzc2luZyByZXF1aXJlZCBmaWVsZHM6IGlzc3VlcywgZG9tYWluLCBhbmQgc2Vzc2lvbklkJyB9KSB9O1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGludm9rZVBhcmFtcyA9IHtcbiAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogcHJvY2Vzcy5lbnYuSVNTVUVfVkFMSURBVE9SX0ZVTkNUSU9OX05BTUUgfHwgJ2xlbnN5LWlzc3VlLXZhbGlkYXRvcicsXG4gICAgICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeSh7IGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgaXNzdWVzLCBkb21haW4sIHNlc3Npb25JZCB9KSB9KVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZChpbnZva2VQYXJhbXMpKTtcbiAgICAgICAgaWYgKHJlc3VsdC5QYXlsb2FkKSB7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXN1bHQuUGF5bG9hZCkpO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlUGF5bG9hZC5zdGF0dXNDb2RlID09PSAyMDApIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0cyA9IEpTT04ucGFyc2UocmVzcG9uc2VQYXlsb2FkLmJvZHkpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDIwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHZhbGlkYXRpb25SZXN1bHRzKSB9O1xuICAgICAgICAgICAgfSBlbHNlIHRocm93IG5ldyBFcnJvcihgSXNzdWVWYWxpZGF0b3IgZmFpbGVkOiAke3Jlc3BvbnNlUGF5bG9hZC5ib2R5fWApO1xuICAgICAgICB9IGVsc2UgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gSXNzdWVWYWxpZGF0b3InKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4geyBzdGF0dXNDb2RlOiA1MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSXNzdWUgdmFsaWRhdGlvbiBmYWlsZWQnLCBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyB9KSB9O1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlR2VuZXJhdGVGaXhlc1JlcXVlc3QoYm9keTogc3RyaW5nIHwgbnVsbCwgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuICAgIGlmICghYm9keSkgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSkgfTtcbiAgICBsZXQgcmVxdWVzdDogYW55O1xuICAgIHRyeSB7IHJlcXVlc3QgPSBKU09OLnBhcnNlKGJvZHkpOyB9IGNhdGNoIChlcnJvcikgeyByZXR1cm4geyBzdGF0dXNDb2RlOiA0MDAsIGhlYWRlcnM6IGNvcnNIZWFkZXJzLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScgfSkgfTsgfVxuXG4gICAgaWYgKCFyZXF1ZXN0LnNlc3Npb25JZCkgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ01pc3NpbmcgcmVxdWlyZWQgZmllbGQ6IHNlc3Npb25JZCcgfSkgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBJbnZva2luZyBGaXhHZW5lcmF0b3IgZm9yIHNlc3Npb24gJHtyZXF1ZXN0LnNlc3Npb25JZH1gKTtcbiAgICAgICAgY29uc3QgaW52b2tlUGFyYW1zID0ge1xuICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiBwcm9jZXNzLmVudi5GSVhfR0VORVJBVE9SX0ZVTkNUSU9OX05BTUUgfHwgJ0xlbnN5U3RhY2stRml4R2VuZXJhdG9yRnVuY3Rpb24nLFxuICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoeyBib2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0KSB9KSAvLyBQYXNzIGFzIEFQSSBHYXRld2F5IHByb3h5IGV2ZW50IGJvZHlcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZChpbnZva2VQYXJhbXMpKTtcblxuICAgICAgICBpZiAocmVzdWx0LlBheWxvYWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3VsdC5QYXlsb2FkKSk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRml4R2VuZXJhdG9yIHJlc3BvbnNlOicsIHJlc3BvbnNlUGF5bG9hZCk7XG5cbiAgICAgICAgICAgIC8vIEhhbmRsZSBib3RoIGRpcmVjdCBpbnZvY2F0aW9uIHJlc3BvbnNlIGFuZCBwcm94eSByZXNwb25zZVxuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gcmVzcG9uc2VQYXlsb2FkLmJvZHkgPyBKU09OLnBhcnNlKHJlc3BvbnNlUGF5bG9hZC5ib2R5KSA6IHJlc3BvbnNlUGF5bG9hZDtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c0NvZGUgPSByZXNwb25zZVBheWxvYWQuc3RhdHVzQ29kZSB8fCAyMDA7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzQ29kZSxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZUJvZHkpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gRml4R2VuZXJhdG9yJyk7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGaXggZ2VuZXJhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnRml4IGdlbmVyYXRpb24gZmFpbGVkJywgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicgfSlcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUFwcGx5Rml4ZXNSZXF1ZXN0KGJvZHk6IHN0cmluZyB8IG51bGwsIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgICBpZiAoIWJvZHkpIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgaGVhZGVyczogY29yc0hlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pIH07XG4gICAgbGV0IHJlcXVlc3Q6IGFueTtcbiAgICB0cnkgeyByZXF1ZXN0ID0gSlNPTi5wYXJzZShib2R5KTsgfSBjYXRjaCAoZXJyb3IpIHsgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgSlNPTiBpbiByZXF1ZXN0IGJvZHknIH0pIH07IH1cblxuICAgIGlmICghcmVxdWVzdC5zZXNzaW9uSWQgfHwgIXJlcXVlc3Quc2VsZWN0ZWRGaXhJZHMpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdHVzQ29kZTogNDAwLCBoZWFkZXJzOiBjb3JzSGVhZGVycywgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ01pc3NpbmcgcmVxdWlyZWQgZmllbGRzOiBzZXNzaW9uSWQgYW5kIHNlbGVjdGVkRml4SWRzJyB9KSB9O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBJbnZva2luZyBGaXhBcHBsaWNhdG9yIGZvciBzZXNzaW9uICR7cmVxdWVzdC5zZXNzaW9uSWR9YCk7XG4gICAgICAgIGNvbnN0IGludm9rZVBhcmFtcyA9IHtcbiAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogcHJvY2Vzcy5lbnYuRklYX0FQUExJQ0FUT1JfRlVOQ1RJT05fTkFNRSB8fCAnTGVuc3lTdGFjay1GaXhBcHBsaWNhdG9yRnVuY3Rpb24nLFxuICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoeyBib2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0KSB9KSAvLyBQYXNzIGFzIEFQSSBHYXRld2F5IHByb3h5IGV2ZW50IGJvZHlcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZChpbnZva2VQYXJhbXMpKTtcblxuICAgICAgICBpZiAocmVzdWx0LlBheWxvYWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3VsdC5QYXlsb2FkKSk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRml4QXBwbGljYXRvciByZXNwb25zZTonLCByZXNwb25zZVBheWxvYWQpO1xuXG4gICAgICAgICAgICAvLyBIYW5kbGUgYm90aCBkaXJlY3QgaW52b2NhdGlvbiByZXNwb25zZSBhbmQgcHJveHkgcmVzcG9uc2VcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IHJlc3BvbnNlUGF5bG9hZC5ib2R5ID8gSlNPTi5wYXJzZShyZXNwb25zZVBheWxvYWQuYm9keSkgOiByZXNwb25zZVBheWxvYWQ7XG4gICAgICAgICAgICBjb25zdCBzdGF0dXNDb2RlID0gcmVzcG9uc2VQYXlsb2FkLnN0YXR1c0NvZGUgfHwgMjAwO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvZGUsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2VCb2R5KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gcmVzcG9uc2UgcGF5bG9hZCBmcm9tIEZpeEFwcGxpY2F0b3InKTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZpeCBhcHBsaWNhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnRml4IGFwcGxpY2F0aW9uIGZhaWxlZCcsIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InIH0pXG4gICAgICAgIH07XG4gICAgfVxufVxuIl19