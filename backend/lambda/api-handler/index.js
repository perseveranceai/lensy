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
        if (httpMethod === 'POST' && path === '/analyze') {
            return await handleAnalyzeRequest(body, corsHeaders);
        }
        if (httpMethod === 'POST' && path === '/discover-issues') {
            return await handleDiscoverIssuesRequest(body, corsHeaders);
        }
        if (httpMethod === 'POST' && path === '/validate-issues') {
            return await handleValidateIssuesRequest(body, corsHeaders);
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
        // Check for both sitemap mode and doc mode results
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
            // Build sitemap health report
            const report = {
                overallScore: healthPercentage,
                dimensionsAnalyzed: 1, // We analyzed "health" dimension
                dimensionsTotal: 1,
                confidence: 'high', // Sitemap health checking is deterministic
                modelUsed: 'Sitemap Health Checker',
                cacheStatus: 'miss', // Sitemap health is always fresh
                dimensions: {}, // No dimension analysis in sitemap mode
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
            // Not sitemap mode, try doc mode
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
            // Get processed content for additional info
            const contentKey = `sessions/${sessionId}/processed-content.json`;
            const contentResponse = await s3.send(new GetObjectCommand({
                Bucket: bucketName,
                Key: contentKey
            }));
            const contentStr = await contentResponse.Body.transformToString();
            const processedContent = JSON.parse(contentStr);
            console.log('Retrieved processed content keys:', Object.keys(processedContent));
            console.log('Context analysis check:', !!processedContent.contextAnalysis);
            // Get session metadata to retrieve the model used and start time
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
            // Calculate actual analysis time
            const actualAnalysisTime = Date.now() - analysisStartTime;
            // Build the report
            const validScores = Object.values(dimensionResults)
                .filter((d) => d.score !== null && d.status === 'complete')
                .map((d) => d.score);
            const overallScore = validScores.length > 0
                ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
                : 0;
            // Generate context analysis summary from processed content if available
            let contextAnalysis = null;
            if (processedContent.contextAnalysis) {
                console.log('Found context analysis in processed content:', processedContent.contextAnalysis);
                contextAnalysis = {
                    enabled: true,
                    contextPages: processedContent.contextAnalysis.contextPages || [],
                    analysisScope: processedContent.contextAnalysis.analysisScope || 'single-page',
                    totalPagesAnalyzed: processedContent.contextAnalysis.totalPagesAnalyzed || 1
                };
                console.log('Generated context analysis for report:', contextAnalysis);
            }
            else {
                console.log('No context analysis found in processed content');
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
                    snippetsFound: processedContent.codeSnippets?.length || 0,
                    syntaxErrors: 0,
                    deprecatedMethods: 0,
                    missingVersionSpecs: processedContent.codeSnippets?.filter((s) => !s.hasVersionInfo).length || 0,
                    languagesDetected: processedContent.codeSnippets ? [...new Set(processedContent.codeSnippets.map((s) => s.language).filter(Boolean))] : []
                },
                mediaAnalysis: {
                    videosFound: processedContent.mediaElements?.filter((m) => m.type === 'video').length || 0,
                    audiosFound: processedContent.mediaElements?.filter((m) => m.type === 'audio').length || 0,
                    imagesFound: processedContent.mediaElements?.filter((m) => m.type === 'image').length || 0,
                    interactiveElements: processedContent.mediaElements?.filter((m) => m.type === 'interactive').length || 0,
                    accessibilityIssues: processedContent.mediaElements?.filter((m) => m.analysisNote?.includes('accessibility')).length || 0,
                    missingAltText: processedContent.mediaElements?.filter((m) => m.type === 'image' && !m.alt).length || 0
                },
                linkAnalysis: processedContent.linkAnalysis || {},
                ...(contextAnalysis && { contextAnalysis }), // Only include if not undefined
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
            // Neither sitemap nor doc mode results found - analysis still in progress
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
    if (!body) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Request body is required' })
        };
    }
    let discoverRequest;
    try {
        discoverRequest = JSON.parse(body);
    }
    catch (error) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
    }
    const { companyName, domain, sessionId } = discoverRequest;
    if (!domain || !sessionId) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing required fields: domain and sessionId' })
        };
    }
    try {
        console.log('Invoking IssueDiscoverer Lambda for:', { companyName, domain, sessionId });
        // Invoke the IssueDiscoverer Lambda function directly
        const invokeParams = {
            FunctionName: process.env.ISSUE_DISCOVERER_FUNCTION_NAME || 'lensy-issue-discoverer',
            Payload: JSON.stringify({
                body: JSON.stringify({ companyName, domain, sessionId })
            })
        };
        const result = await lambdaClient.send(new client_lambda_1.InvokeCommand(invokeParams));
        if (result.Payload) {
            const responsePayload = JSON.parse(new TextDecoder().decode(result.Payload));
            if (responsePayload.statusCode === 200) {
                const issueResults = JSON.parse(responsePayload.body);
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify(issueResults)
                };
            }
            else {
                throw new Error(`IssueDiscoverer failed: ${responsePayload.body}`);
            }
        }
        else {
            throw new Error('No response payload from IssueDiscoverer');
        }
    }
    catch (error) {
        console.error('Issue discovery failed:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Issue discovery failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
}
/**
 * Handle issue validation request
 */
async function handleValidateIssuesRequest(body, corsHeaders) {
    if (!body) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Request body is required' })
        };
    }
    let validateRequest;
    try {
        validateRequest = JSON.parse(body);
    }
    catch (error) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
    }
    const { issues, domain, sessionId } = validateRequest;
    if (!issues || !domain || !sessionId) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing required fields: issues, domain, and sessionId' })
        };
    }
    try {
        console.log('Invoking IssueValidator Lambda for:', { issueCount: issues.length, domain, sessionId });
        // Invoke the IssueValidator Lambda function directly
        const invokeParams = {
            FunctionName: process.env.ISSUE_VALIDATOR_FUNCTION_NAME || 'lensy-issue-validator',
            Payload: JSON.stringify({
                body: JSON.stringify({ issues, domain, sessionId })
            })
        };
        const result = await lambdaClient.send(new client_lambda_1.InvokeCommand(invokeParams));
        if (result.Payload) {
            const responsePayload = JSON.parse(new TextDecoder().decode(result.Payload));
            if (responsePayload.statusCode === 200) {
                const validationResults = JSON.parse(responsePayload.body);
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify(validationResults)
                };
            }
            else {
                throw new Error(`IssueValidator failed: ${responsePayload.body}`);
            }
        }
        else {
            throw new Error('No response payload from IssueValidator');
        }
    }
    catch (error) {
        console.error('Issue validation failed:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Issue validation failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxvREFBaUc7QUFDakcsa0RBQWdFO0FBQ2hFLDBEQUFxRTtBQUVyRSxNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNuRixNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNqRixNQUFNLFlBQVksR0FBRyxJQUFJLDRCQUFZLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxFQUFFLENBQUMsQ0FBQztBQWVsRixNQUFNLE9BQU8sR0FBc0IsS0FBSyxFQUFFLEtBQVUsRUFBRSxFQUFFO0lBQzNELE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFN0Usa0RBQWtEO0lBQ2xELE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLGNBQWMsRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDO0lBQzFFLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUM7SUFDN0UsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQztJQUV4QixPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFFNUQsZUFBZTtJQUNmLE1BQU0sV0FBVyxHQUFHO1FBQ2hCLDZCQUE2QixFQUFFLEdBQUc7UUFDbEMsOEJBQThCLEVBQUUsaURBQWlEO1FBQ2pGLDhCQUE4QixFQUFFLGtCQUFrQjtRQUNsRCxjQUFjLEVBQUUsa0JBQWtCO0tBQ3JDLENBQUM7SUFFRix3QkFBd0I7SUFDeEIsSUFBSSxVQUFVLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDM0IsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLEVBQUU7U0FDWCxDQUFDO0lBQ04sQ0FBQztJQUVELElBQUksQ0FBQztRQUNELElBQUksVUFBVSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDL0MsT0FBTyxNQUFNLG9CQUFvQixDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQztRQUN6RCxDQUFDO1FBRUQsSUFBSSxVQUFVLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxrQkFBa0IsRUFBRSxDQUFDO1lBQ3ZELE9BQU8sTUFBTSwyQkFBMkIsQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFDaEUsQ0FBQztRQUVELElBQUksVUFBVSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztZQUN2RCxPQUFPLE1BQU0sMkJBQTJCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ2hFLENBQUM7UUFFRCxJQUFJLFVBQVUsS0FBSyxLQUFLLElBQUksSUFBSSxFQUFFLFVBQVUsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ3ZELE9BQU8sTUFBTSxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFDeEQsQ0FBQztRQUVELE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQixLQUFLLEVBQUUsV0FBVztnQkFDbEIsTUFBTSxFQUFFLFVBQVU7Z0JBQ2xCLElBQUksRUFBRSxJQUFJO2dCQUNWLGVBQWUsRUFBRSxDQUFDLGVBQWUsRUFBRSx1QkFBdUIsRUFBRSx1QkFBdUIsRUFBRSx5QkFBeUIsQ0FBQzthQUNsSCxDQUFDO1NBQ0wsQ0FBQztJQUVOLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMzQyxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsS0FBSyxFQUFFLHVCQUF1QjtnQkFDOUIsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7YUFDcEUsQ0FBQztTQUNMLENBQUM7SUFDTixDQUFDO0FBQ0wsQ0FBQyxDQUFDO0FBbEVXLFFBQUEsT0FBTyxXQWtFbEI7QUFFRixLQUFLLFVBQVUsb0JBQW9CLENBQUMsSUFBbUIsRUFBRSxXQUFtQztJQUN4RixJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDUixPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSwwQkFBMEIsRUFBRSxDQUFDO1NBQzlELENBQUM7SUFDTixDQUFDO0lBRUQsSUFBSSxlQUFnQyxDQUFDO0lBRXJDLElBQUksQ0FBQztRQUNELGVBQWUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3ZDLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsOEJBQThCLEVBQUUsQ0FBQztTQUNsRSxDQUFDO0lBQ04sQ0FBQztJQUVELG1CQUFtQjtJQUNuQixJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNyRCxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsS0FBSyxFQUFFLHlEQUF5RDthQUNuRSxDQUFDO1NBQ0wsQ0FBQztJQUNOLENBQUM7SUFFRCxzQkFBc0I7SUFDdEIsSUFBSSxDQUFDO1FBQ0QsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsb0JBQW9CLEVBQUUsQ0FBQztTQUN4RCxDQUFDO0lBQ04sQ0FBQztJQUVELGlDQUFpQztJQUNqQyxNQUFNLGFBQWEsR0FBRyxZQUFZLGVBQWUsQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUM7SUFDNUUsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQztJQUV0RCxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QsQ0FBQyxDQUFDO0lBQ3RFLENBQUM7SUFFRCxPQUFPLENBQUMsR0FBRyxDQUFDLG9DQUFvQyxFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBRWpFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxrQ0FBcUIsQ0FBQztRQUNwRCxlQUFlO1FBQ2YsSUFBSSxFQUFFLGFBQWE7UUFDbkIsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDbEIsR0FBRyxlQUFlO1lBQ2xCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7U0FDaEMsQ0FBQztLQUNMLENBQUMsQ0FBQztJQUVILE1BQU0sU0FBUyxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO0lBRTlELE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLFNBQVMsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFDO0lBRXJFLE9BQU87UUFDSCxVQUFVLEVBQUUsR0FBRztRQUNmLE9BQU8sRUFBRSxXQUFXO1FBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO1lBQ2pCLE9BQU8sRUFBRSxrQkFBa0I7WUFDM0IsWUFBWSxFQUFFLFNBQVMsQ0FBQyxZQUFZO1lBQ3BDLFNBQVMsRUFBRSxlQUFlLENBQUMsU0FBUztZQUNwQyxNQUFNLEVBQUUsU0FBUztTQUNwQixDQUFDO0tBQ0wsQ0FBQztBQUNOLENBQUM7QUFFRCxLQUFLLFVBQVUsbUJBQW1CLENBQUMsSUFBWSxFQUFFLFdBQW1DO0lBQ2hGLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFckMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2IsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsd0JBQXdCLEVBQUUsQ0FBQztTQUM1RCxDQUFDO0lBQ04sQ0FBQztJQUVELElBQUksQ0FBQztRQUNELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLHVDQUF1QyxDQUFDO1FBRTFGLHNDQUFzQztRQUN0QyxtREFBbUQ7UUFFbkQsTUFBTSxFQUFFLFFBQVEsRUFBRSxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3JFLE1BQU0sRUFBRSxHQUFHLElBQUksUUFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFFM0UsNkVBQTZFO1FBQzdFLElBQUksQ0FBQztZQUNELE1BQU0sZ0JBQWdCLEdBQUcsWUFBWSxTQUFTLDhCQUE4QixDQUFDO1lBQzdFLE1BQU0scUJBQXFCLEdBQUcsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksZ0JBQWdCLENBQUM7Z0JBQzdELE1BQU0sRUFBRSxVQUFVO2dCQUNsQixHQUFHLEVBQUUsZ0JBQWdCO2FBQ3hCLENBQUMsQ0FBQyxDQUFDO1lBRUosTUFBTSxvQkFBb0IsR0FBRyxNQUFNLHFCQUFxQixDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ2xGLE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1lBRTlELE9BQU8sQ0FBQyxHQUFHLENBQUMscURBQXFELENBQUMsQ0FBQztZQUVuRSxrQ0FBa0M7WUFDbEMsSUFBSSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxXQUFXO1lBQy9DLElBQUksQ0FBQztnQkFDRCxNQUFNLFdBQVcsR0FBRyxZQUFZLFNBQVMsZ0JBQWdCLENBQUM7Z0JBQzFELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksZ0JBQWdCLENBQUM7b0JBQ3hELE1BQU0sRUFBRSxVQUFVO29CQUNsQixHQUFHLEVBQUUsV0FBVztpQkFDbkIsQ0FBQyxDQUFDLENBQUM7Z0JBQ0osTUFBTSxXQUFXLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztnQkFDcEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQztnQkFDekMsaUJBQWlCLEdBQUcsUUFBUSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDekQsQ0FBQztZQUFDLE9BQU8sYUFBYSxFQUFFLENBQUM7Z0JBQ3JCLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUNBQXVDLENBQUMsQ0FBQztZQUN6RCxDQUFDO1lBRUQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsaUJBQWlCLENBQUM7WUFDMUQsTUFBTSxnQkFBZ0IsR0FBRyxvQkFBb0IsQ0FBQyxnQkFBZ0IsSUFBSSxDQUFDLENBQUM7WUFFcEUsOEJBQThCO1lBQzlCLE1BQU0sTUFBTSxHQUFHO2dCQUNYLFlBQVksRUFBRSxnQkFBZ0I7Z0JBQzlCLGtCQUFrQixFQUFFLENBQUMsRUFBRSxpQ0FBaUM7Z0JBQ3hELGVBQWUsRUFBRSxDQUFDO2dCQUNsQixVQUFVLEVBQUUsTUFBTSxFQUFFLDJDQUEyQztnQkFDL0QsU0FBUyxFQUFFLHdCQUF3QjtnQkFDbkMsV0FBVyxFQUFFLE1BQU0sRUFBRSxpQ0FBaUM7Z0JBQ3RELFVBQVUsRUFBRSxFQUFFLEVBQUUsd0NBQXdDO2dCQUN4RCxZQUFZLEVBQUU7b0JBQ1YsYUFBYSxFQUFFLENBQUM7b0JBQ2hCLFlBQVksRUFBRSxDQUFDO29CQUNmLGlCQUFpQixFQUFFLENBQUM7b0JBQ3BCLG1CQUFtQixFQUFFLENBQUM7b0JBQ3RCLGlCQUFpQixFQUFFLEVBQUU7aUJBQ3hCO2dCQUNELGFBQWEsRUFBRTtvQkFDWCxXQUFXLEVBQUUsQ0FBQztvQkFDZCxXQUFXLEVBQUUsQ0FBQztvQkFDZCxXQUFXLEVBQUUsQ0FBQztvQkFDZCxtQkFBbUIsRUFBRSxDQUFDO29CQUN0QixtQkFBbUIsRUFBRSxDQUFDO29CQUN0QixjQUFjLEVBQUUsQ0FBQztpQkFDcEI7Z0JBQ0QsWUFBWSxFQUFFO29CQUNWLFVBQVUsRUFBRSxDQUFDO29CQUNiLGFBQWEsRUFBRSxDQUFDO29CQUNoQixhQUFhLEVBQUUsQ0FBQztvQkFDaEIsV0FBVyxFQUFFLENBQUM7b0JBQ2Qsa0JBQWtCLEVBQUUsRUFBRTtvQkFDdEIsV0FBVyxFQUFFLGFBQWE7b0JBQzFCLGFBQWEsRUFBRSxtQkFBbUI7aUJBQ3JDO2dCQUNELGFBQWEsRUFBRTtvQkFDWCxTQUFTLEVBQUUsb0JBQW9CLENBQUMsU0FBUztvQkFDekMsV0FBVyxFQUFFLG9CQUFvQixDQUFDLFdBQVc7b0JBQzdDLFVBQVUsRUFBRSxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUMxRyxnQkFBZ0IsRUFBRSxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsU0FBUyxLQUFLLGVBQWUsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUMxSCxXQUFXLEVBQUUsb0JBQW9CLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDLEtBQVUsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQztvQkFDL0csY0FBYyxFQUFFLG9CQUFvQixDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQyxLQUFVLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLEtBQUssT0FBTyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQ2hILGdCQUFnQixFQUFFLG9CQUFvQixDQUFDLGdCQUFnQjtvQkFDdkQsVUFBVSxFQUFFLG9CQUFvQixDQUFDLFVBQVUsSUFBSSxFQUFFO29CQUNqRCxjQUFjLEVBQUUsb0JBQW9CLENBQUMsY0FBYztpQkFDdEQ7Z0JBQ0QsWUFBWSxFQUFFLGtCQUFrQjtnQkFDaEMsVUFBVSxFQUFFLENBQUM7YUFDaEIsQ0FBQztZQUVGLE9BQU87Z0JBQ0gsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNqQixTQUFTO29CQUNULE1BQU0sRUFBRSxXQUFXO29CQUNuQixNQUFNO2lCQUNULENBQUM7YUFDTCxDQUFDO1FBRU4sQ0FBQztRQUFDLE9BQU8sWUFBWSxFQUFFLENBQUM7WUFDcEIsaUNBQWlDO1lBQ2pDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0VBQWdFLENBQUMsQ0FBQztRQUNsRixDQUFDO1FBRUQsd0NBQXdDO1FBQ3hDLElBQUksQ0FBQztZQUNELE1BQU0sWUFBWSxHQUFHLFlBQVksU0FBUyx5QkFBeUIsQ0FBQztZQUNwRSxNQUFNLGlCQUFpQixHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLGdCQUFnQixDQUFDO2dCQUN6RCxNQUFNLEVBQUUsVUFBVTtnQkFDbEIsR0FBRyxFQUFFLFlBQVk7YUFDcEIsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLGdCQUFnQixHQUFHLE1BQU0saUJBQWlCLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDMUUsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFFdEQsNENBQTRDO1lBQzVDLE1BQU0sVUFBVSxHQUFHLFlBQVksU0FBUyx5QkFBeUIsQ0FBQztZQUNsRSxNQUFNLGVBQWUsR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQztnQkFDdkQsTUFBTSxFQUFFLFVBQVU7Z0JBQ2xCLEdBQUcsRUFBRSxVQUFVO2FBQ2xCLENBQUMsQ0FBQyxDQUFDO1lBRUosTUFBTSxVQUFVLEdBQUcsTUFBTSxlQUFlLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDbEUsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBRWhELE9BQU8sQ0FBQyxHQUFHLENBQUMsbUNBQW1DLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7WUFDaEYsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsRUFBRSxDQUFDLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxDQUFDLENBQUM7WUFFM0UsaUVBQWlFO1lBQ2pFLElBQUksU0FBUyxHQUFHLFFBQVEsQ0FBQyxDQUFDLFVBQVU7WUFDcEMsSUFBSSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxXQUFXO1lBQy9DLElBQUksQ0FBQztnQkFDRCxNQUFNLFdBQVcsR0FBRyxZQUFZLFNBQVMsZ0JBQWdCLENBQUM7Z0JBQzFELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksZ0JBQWdCLENBQUM7b0JBQ3hELE1BQU0sRUFBRSxVQUFVO29CQUNsQixHQUFHLEVBQUUsV0FBVztpQkFDbkIsQ0FBQyxDQUFDLENBQUM7Z0JBQ0osTUFBTSxXQUFXLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztnQkFDcEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQztnQkFDekMsU0FBUyxHQUFHLFFBQVEsQ0FBQyxhQUFhLElBQUksUUFBUSxDQUFDO2dCQUMvQyxpQkFBaUIsR0FBRyxRQUFRLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUN6RCxDQUFDO1lBQUMsT0FBTyxhQUFhLEVBQUUsQ0FBQztnQkFDckIsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5REFBeUQsQ0FBQyxDQUFDO1lBQzNFLENBQUM7WUFFRCxpQ0FBaUM7WUFDakMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsaUJBQWlCLENBQUM7WUFFMUQsbUJBQW1CO1lBQ25CLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQUM7aUJBQzlDLE1BQU0sQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQyxDQUFDLE1BQU0sS0FBSyxVQUFVLENBQUM7aUJBQy9ELEdBQUcsQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTlCLE1BQU0sWUFBWSxHQUFHLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQztnQkFDdkMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQVcsRUFBRSxLQUFhLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEdBQUcsV0FBVyxDQUFDLE1BQU0sQ0FBQztnQkFDckcsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUVSLHdFQUF3RTtZQUN4RSxJQUFJLGVBQWUsR0FBRyxJQUFJLENBQUM7WUFDM0IsSUFBSSxnQkFBZ0IsQ0FBQyxlQUFlLEVBQUUsQ0FBQztnQkFDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4Q0FBOEMsRUFBRSxnQkFBZ0IsQ0FBQyxlQUFlLENBQUMsQ0FBQztnQkFFOUYsZUFBZSxHQUFHO29CQUNkLE9BQU8sRUFBRSxJQUFJO29CQUNiLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxlQUFlLENBQUMsWUFBWSxJQUFJLEVBQUU7b0JBQ2pFLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxlQUFlLENBQUMsYUFBYSxJQUFJLGFBQWE7b0JBQzlFLGtCQUFrQixFQUFFLGdCQUFnQixDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsSUFBSSxDQUFDO2lCQUMvRSxDQUFDO2dCQUVGLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0NBQXdDLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFDM0UsQ0FBQztpQkFBTSxDQUFDO2dCQUNKLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0RBQWdELENBQUMsQ0FBQztZQUNsRSxDQUFDO1lBRUQsTUFBTSxNQUFNLEdBQUc7Z0JBQ1gsWUFBWTtnQkFDWixrQkFBa0IsRUFBRSxXQUFXLENBQUMsTUFBTTtnQkFDdEMsZUFBZSxFQUFFLENBQUM7Z0JBQ2xCLFVBQVUsRUFBRSxXQUFXLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLO2dCQUMxRixTQUFTLEVBQUUsU0FBUztnQkFDcEIsV0FBVyxFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTTtnQkFDMUUsVUFBVSxFQUFFLGdCQUFnQjtnQkFDNUIsWUFBWSxFQUFFO29CQUNWLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxZQUFZLEVBQUUsTUFBTSxJQUFJLENBQUM7b0JBQ3pELFlBQVksRUFBRSxDQUFDO29CQUNmLGlCQUFpQixFQUFFLENBQUM7b0JBQ3BCLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUNyRyxpQkFBaUIsRUFBRSxnQkFBZ0IsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtpQkFDbEo7Z0JBQ0QsYUFBYSxFQUFFO29CQUNYLFdBQVcsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO29CQUMvRixXQUFXLEVBQUUsZ0JBQWdCLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxPQUFPLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQztvQkFDL0YsV0FBVyxFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssT0FBTyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQy9GLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssYUFBYSxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQzdHLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLEVBQUUsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQzlILGNBQWMsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQztpQkFDL0c7Z0JBQ0QsWUFBWSxFQUFFLGdCQUFnQixDQUFDLFlBQVksSUFBSSxFQUFFO2dCQUNqRCxHQUFHLENBQUMsZUFBZSxJQUFJLEVBQUUsZUFBZSxFQUFFLENBQUMsRUFBRSxnQ0FBZ0M7Z0JBQzdFLFlBQVksRUFBRSxrQkFBa0I7Z0JBQ2hDLFVBQVUsRUFBRSxDQUFDO2FBQ2hCLENBQUM7WUFFRixPQUFPO2dCQUNILFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDakIsU0FBUztvQkFDVCxNQUFNLEVBQUUsV0FBVztvQkFDbkIsTUFBTTtpQkFDVCxDQUFDO2FBQ0wsQ0FBQztRQUVOLENBQUM7UUFBQyxPQUFPLFlBQVksRUFBRSxDQUFDO1lBQ3BCLDBFQUEwRTtZQUMxRSxPQUFPO2dCQUNILFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDakIsU0FBUztvQkFDVCxNQUFNLEVBQUUsYUFBYTtvQkFDckIsT0FBTyxFQUFFLHNCQUFzQjtpQkFDbEMsQ0FBQzthQUNMLENBQUM7UUFDTixDQUFDO0lBRUwsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLHNCQUFzQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzdDLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQixLQUFLLEVBQUUsd0JBQXdCO2dCQUMvQixPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTthQUNwRSxDQUFDO1NBQ0wsQ0FBQztJQUNOLENBQUM7QUFDTCxDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLElBQW1CLEVBQUUsV0FBbUM7SUFDL0YsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ1IsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsMEJBQTBCLEVBQUUsQ0FBQztTQUM5RCxDQUFDO0lBQ04sQ0FBQztJQUVELElBQUksZUFBMkUsQ0FBQztJQUVoRixJQUFJLENBQUM7UUFDRCxlQUFlLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2QyxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDhCQUE4QixFQUFFLENBQUM7U0FDbEUsQ0FBQztJQUNOLENBQUM7SUFFRCxNQUFNLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxlQUFlLENBQUM7SUFFM0QsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ3hCLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLCtDQUErQyxFQUFFLENBQUM7U0FDbkYsQ0FBQztJQUNOLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDRCxPQUFPLENBQUMsR0FBRyxDQUFDLHNDQUFzQyxFQUFFLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBRXhGLHNEQUFzRDtRQUN0RCxNQUFNLFlBQVksR0FBRztZQUNqQixZQUFZLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsSUFBSSx3QkFBd0I7WUFDcEYsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsQ0FBQzthQUMzRCxDQUFDO1NBQ0wsQ0FBQztRQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLDZCQUFhLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztRQUV4RSxJQUFJLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNqQixNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksV0FBVyxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBRTdFLElBQUksZUFBZSxDQUFDLFVBQVUsS0FBSyxHQUFHLEVBQUUsQ0FBQztnQkFDckMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3RELE9BQU87b0JBQ0gsVUFBVSxFQUFFLEdBQUc7b0JBQ2YsT0FBTyxFQUFFLFdBQVc7b0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQztpQkFDckMsQ0FBQztZQUNOLENBQUM7aUJBQU0sQ0FBQztnQkFDSixNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixlQUFlLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUN2RSxDQUFDO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDSixNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUM7UUFDaEUsQ0FBQztJQUVMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNoRCxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsS0FBSyxFQUFFLHdCQUF3QjtnQkFDL0IsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7YUFDcEUsQ0FBQztTQUNMLENBQUM7SUFDTixDQUFDO0FBQ0wsQ0FBQztBQUdEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLDJCQUEyQixDQUFDLElBQW1CLEVBQUUsV0FBbUM7SUFDL0YsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ1IsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsMEJBQTBCLEVBQUUsQ0FBQztTQUM5RCxDQUFDO0lBQ04sQ0FBQztJQUVELElBQUksZUFBb0IsQ0FBQztJQUN6QixJQUFJLENBQUM7UUFDRCxlQUFlLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2QyxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDhCQUE4QixFQUFFLENBQUM7U0FDbEUsQ0FBQztJQUNOLENBQUM7SUFFRCxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxlQUFlLENBQUM7SUFFdEQsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ25DLE9BQU87WUFDSCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHdEQUF3RCxFQUFFLENBQUM7U0FDNUYsQ0FBQztJQUNOLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDRCxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxFQUFFLEVBQUUsVUFBVSxFQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFFckcscURBQXFEO1FBQ3JELE1BQU0sWUFBWSxHQUFHO1lBQ2pCLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixJQUFJLHVCQUF1QjtZQUNsRixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxDQUFDO2FBQ3RELENBQUM7U0FDTCxDQUFDO1FBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksNkJBQWEsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO1FBRXhFLElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2pCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxXQUFXLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFFN0UsSUFBSSxlQUFlLENBQUMsVUFBVSxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUNyQyxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUMzRCxPQUFPO29CQUNILFVBQVUsRUFBRSxHQUFHO29CQUNmLE9BQU8sRUFBRSxXQUFXO29CQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQztpQkFDMUMsQ0FBQztZQUNOLENBQUM7aUJBQU0sQ0FBQztnQkFDSixNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixlQUFlLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUN0RSxDQUFDO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDSixNQUFNLElBQUksS0FBSyxDQUFDLHlDQUF5QyxDQUFDLENBQUM7UUFDL0QsQ0FBQztJQUVMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQywwQkFBMEIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNqRCxPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDakIsS0FBSyxFQUFFLHlCQUF5QjtnQkFDaEMsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7YUFDcEUsQ0FBQztTQUNMLENBQUM7SUFDTixDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgU0ZOQ2xpZW50LCBTdGFydEV4ZWN1dGlvbkNvbW1hbmQsIERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZm4nO1xuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XG5cbmNvbnN0IHNmbkNsaWVudCA9IG5ldyBTRk5DbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcbmNvbnN0IGxhbWJkYUNsaWVudCA9IG5ldyBMYW1iZGFDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5cbmludGVyZmFjZSBBbmFseXNpc1JlcXVlc3Qge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHNlbGVjdGVkTW9kZWw6ICdjbGF1ZGUnIHwgJ3RpdGFuJyB8ICdsbGFtYScgfCAnYXV0byc7XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgY29udGV4dEFuYWx5c2lzPzoge1xuICAgICAgICBlbmFibGVkOiBib29sZWFuO1xuICAgICAgICBtYXhDb250ZXh0UGFnZXM/OiBudW1iZXI7XG4gICAgfTtcbiAgICBjYWNoZUNvbnRyb2w/OiB7XG4gICAgICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8YW55LCBhbnk+ID0gYXN5bmMgKGV2ZW50OiBhbnkpID0+IHtcbiAgICBjb25zb2xlLmxvZygnQVBJIEhhbmRsZXIgcmVjZWl2ZWQgcmVxdWVzdDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuXG4gICAgLy8gSGFuZGxlIGJvdGggQVBJIEdhdGV3YXkgVjEgYW5kIFYyIGV2ZW50IGZvcm1hdHNcbiAgICBjb25zdCBodHRwTWV0aG9kID0gZXZlbnQuaHR0cE1ldGhvZCB8fCBldmVudC5yZXF1ZXN0Q29udGV4dD8uaHR0cD8ubWV0aG9kO1xuICAgIGNvbnN0IHBhdGggPSBldmVudC5wYXRoIHx8IGV2ZW50LnJhd1BhdGggfHwgZXZlbnQucmVxdWVzdENvbnRleHQ/Lmh0dHA/LnBhdGg7XG4gICAgY29uc3QgYm9keSA9IGV2ZW50LmJvZHk7XG5cbiAgICBjb25zb2xlLmxvZygnRXh0cmFjdGVkIG1ldGhvZDonLCBodHRwTWV0aG9kLCAncGF0aDonLCBwYXRoKTtcblxuICAgIC8vIENPUlMgaGVhZGVyc1xuICAgIGNvbnN0IGNvcnNIZWFkZXJzID0ge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ09QVElPTlMsUE9TVCxHRVQnLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgfTtcblxuICAgIC8vIEhhbmRsZSBDT1JTIHByZWZsaWdodFxuICAgIGlmIChodHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogJydcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYW5hbHl6ZScpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVBbmFseXplUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvZGlzY292ZXItaXNzdWVzJykge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZURpc2NvdmVySXNzdWVzUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvdmFsaWRhdGUtaXNzdWVzJykge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZVZhbGlkYXRlSXNzdWVzUmVxdWVzdChib2R5LCBjb3JzSGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaHR0cE1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aD8uc3RhcnRzV2l0aCgnL3N0YXR1cy8nKSkge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZVN0YXR1c1JlcXVlc3QocGF0aCwgY29yc0hlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGVycm9yOiAnTm90IGZvdW5kJyxcbiAgICAgICAgICAgICAgICBtZXRob2Q6IGh0dHBNZXRob2QsXG4gICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVSb3V0ZXM6IFsnUE9TVCAvYW5hbHl6ZScsICdQT1NUIC9kaXNjb3Zlci1pc3N1ZXMnLCAnUE9TVCAvdmFsaWRhdGUtaXNzdWVzJywgJ0dFVCAvc3RhdHVzL3tzZXNzaW9uSWR9J11cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdBUEkgSGFuZGxlciBlcnJvcjonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICBlcnJvcjogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxufTtcblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQW5hbHl6ZVJlcXVlc3QoYm9keTogc3RyaW5nIHwgbnVsbCwgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICBpZiAoIWJvZHkpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBsZXQgYW5hbHlzaXNSZXF1ZXN0OiBBbmFseXNpc1JlcXVlc3Q7XG5cbiAgICB0cnkge1xuICAgICAgICBhbmFseXNpc1JlcXVlc3QgPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdJbnZhbGlkIEpTT04gaW4gcmVxdWVzdCBib2R5JyB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHJlcXVlc3RcbiAgICBpZiAoIWFuYWx5c2lzUmVxdWVzdC51cmwgfHwgIWFuYWx5c2lzUmVxdWVzdC5zZXNzaW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGVycm9yOiAnTWlzc2luZyByZXF1aXJlZCBmaWVsZHM6IHVybCBhbmQgc2Vzc2lvbklkIGFyZSByZXF1aXJlZCdcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgVVJMIGZvcm1hdFxuICAgIHRyeSB7XG4gICAgICAgIG5ldyBVUkwoYW5hbHlzaXNSZXF1ZXN0LnVybCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgVVJMIGZvcm1hdCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBTdGFydCBTdGVwIEZ1bmN0aW9ucyBleGVjdXRpb25cbiAgICBjb25zdCBleGVjdXRpb25OYW1lID0gYGFuYWx5c2lzLSR7YW5hbHlzaXNSZXF1ZXN0LnNlc3Npb25JZH0tJHtEYXRlLm5vdygpfWA7XG4gICAgY29uc3Qgc3RhdGVNYWNoaW5lQXJuID0gcHJvY2Vzcy5lbnYuU1RBVEVfTUFDSElORV9BUk47XG5cbiAgICBpZiAoIXN0YXRlTWFjaGluZUFybikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NUQVRFX01BQ0hJTkVfQVJOIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZygnU3RhcnRpbmcgU3RlcCBGdW5jdGlvbnMgZXhlY3V0aW9uOicsIGV4ZWN1dGlvbk5hbWUpO1xuXG4gICAgY29uc3Qgc3RhcnRFeGVjdXRpb25Db21tYW5kID0gbmV3IFN0YXJ0RXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICAgIHN0YXRlTWFjaGluZUFybixcbiAgICAgICAgbmFtZTogZXhlY3V0aW9uTmFtZSxcbiAgICAgICAgaW5wdXQ6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIC4uLmFuYWx5c2lzUmVxdWVzdCxcbiAgICAgICAgICAgIGFuYWx5c2lzU3RhcnRUaW1lOiBEYXRlLm5vdygpXG4gICAgICAgIH0pXG4gICAgfSk7XG5cbiAgICBjb25zdCBleGVjdXRpb24gPSBhd2FpdCBzZm5DbGllbnQuc2VuZChzdGFydEV4ZWN1dGlvbkNvbW1hbmQpO1xuXG4gICAgY29uc29sZS5sb2coYFN0YXJ0ZWQgYW5hbHlzaXMgZXhlY3V0aW9uOiAke2V4ZWN1dGlvbi5leGVjdXRpb25Bcm59YCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDIsXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBtZXNzYWdlOiAnQW5hbHlzaXMgc3RhcnRlZCcsXG4gICAgICAgICAgICBleGVjdXRpb25Bcm46IGV4ZWN1dGlvbi5leGVjdXRpb25Bcm4sXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGFuYWx5c2lzUmVxdWVzdC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBzdGF0dXM6ICdzdGFydGVkJ1xuICAgICAgICB9KVxuICAgIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVN0YXR1c1JlcXVlc3QocGF0aDogc3RyaW5nLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHBhdGguc3BsaXQoJy8nKVsyXTtcblxuICAgIGlmICghc2Vzc2lvbklkKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdTZXNzaW9uIElEIGlzIHJlcXVpcmVkJyB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQgfHwgJ2xlbnN5LWFuYWx5c2lzLTk1MTQxMTY3NjUyNS11cy1lYXN0LTEnO1xuXG4gICAgICAgIC8vIFRyeSB0byBnZXQgdGhlIGZpbmFsIHJlcG9ydCBmcm9tIFMzXG4gICAgICAgIC8vIENoZWNrIGZvciBib3RoIHNpdGVtYXAgbW9kZSBhbmQgZG9jIG1vZGUgcmVzdWx0c1xuXG4gICAgICAgIGNvbnN0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSA9IHJlcXVpcmUoJ0Bhd3Mtc2RrL2NsaWVudC1zMycpO1xuICAgICAgICBjb25zdCBzMyA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuICAgICAgICAvLyBGaXJzdCwgY2hlY2sgaWYgdGhpcyBpcyBzaXRlbWFwIG1vZGUgYnkgbG9va2luZyBmb3Igc2l0ZW1hcCBoZWFsdGggcmVzdWx0c1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcEhlYWx0aEtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vc2l0ZW1hcC1oZWFsdGgtcmVzdWx0cy5qc29uYDtcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXBIZWFsdGhSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IHNpdGVtYXBIZWFsdGhLZXlcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcEhlYWx0aENvbnRlbnQgPSBhd2FpdCBzaXRlbWFwSGVhbHRoUmVzcG9uc2UuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcEhlYWx0aFJlc3VsdHMgPSBKU09OLnBhcnNlKHNpdGVtYXBIZWFsdGhDb250ZW50KTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZvdW5kIHNpdGVtYXAgaGVhbHRoIHJlc3VsdHMgLSB0aGlzIGlzIHNpdGVtYXAgbW9kZScpO1xuXG4gICAgICAgICAgICAvLyBHZXQgc2Vzc2lvbiBtZXRhZGF0YSBmb3IgdGltaW5nXG4gICAgICAgICAgICBsZXQgYW5hbHlzaXNTdGFydFRpbWUgPSBEYXRlLm5vdygpOyAvLyBmYWxsYmFja1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YUtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vbWV0YWRhdGEuanNvbmA7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIEtleTogbWV0YWRhdGFLZXlcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFTdHIgPSBhd2FpdCBtZXRhZGF0YVJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IEpTT04ucGFyc2UobWV0YWRhdGFTdHIpO1xuICAgICAgICAgICAgICAgIGFuYWx5c2lzU3RhcnRUaW1lID0gbWV0YWRhdGEuc3RhcnRUaW1lIHx8IERhdGUubm93KCk7XG4gICAgICAgICAgICB9IGNhdGNoIChtZXRhZGF0YUVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIG1ldGFkYXRhIGZvdW5kLCB1c2luZyBjdXJyZW50IHRpbWUnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgYWN0dWFsQW5hbHlzaXNUaW1lID0gRGF0ZS5ub3coKSAtIGFuYWx5c2lzU3RhcnRUaW1lO1xuICAgICAgICAgICAgY29uc3QgaGVhbHRoUGVyY2VudGFnZSA9IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmhlYWx0aFBlcmNlbnRhZ2UgfHwgMDtcblxuICAgICAgICAgICAgLy8gQnVpbGQgc2l0ZW1hcCBoZWFsdGggcmVwb3J0XG4gICAgICAgICAgICBjb25zdCByZXBvcnQgPSB7XG4gICAgICAgICAgICAgICAgb3ZlcmFsbFNjb3JlOiBoZWFsdGhQZXJjZW50YWdlLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNBbmFseXplZDogMSwgLy8gV2UgYW5hbHl6ZWQgXCJoZWFsdGhcIiBkaW1lbnNpb25cbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zVG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLCAvLyBTaXRlbWFwIGhlYWx0aCBjaGVja2luZyBpcyBkZXRlcm1pbmlzdGljXG4gICAgICAgICAgICAgICAgbW9kZWxVc2VkOiAnU2l0ZW1hcCBIZWFsdGggQ2hlY2tlcicsXG4gICAgICAgICAgICAgICAgY2FjaGVTdGF0dXM6ICdtaXNzJywgLy8gU2l0ZW1hcCBoZWFsdGggaXMgYWx3YXlzIGZyZXNoXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uczoge30sIC8vIE5vIGRpbWVuc2lvbiBhbmFseXNpcyBpbiBzaXRlbWFwIG1vZGVcbiAgICAgICAgICAgICAgICBjb2RlQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgc25pcHBldHNGb3VuZDogMCxcbiAgICAgICAgICAgICAgICAgICAgc3ludGF4RXJyb3JzOiAwLFxuICAgICAgICAgICAgICAgICAgICBkZXByZWNhdGVkTWV0aG9kczogMCxcbiAgICAgICAgICAgICAgICAgICAgbWlzc2luZ1ZlcnNpb25TcGVjczogMCxcbiAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2VzRGV0ZWN0ZWQ6IFtdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtZWRpYUFuYWx5c2lzOiB7XG4gICAgICAgICAgICAgICAgICAgIHZpZGVvc0ZvdW5kOiAwLFxuICAgICAgICAgICAgICAgICAgICBhdWRpb3NGb3VuZDogMCxcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2VzRm91bmQ6IDAsXG4gICAgICAgICAgICAgICAgICAgIGludGVyYWN0aXZlRWxlbWVudHM6IDAsXG4gICAgICAgICAgICAgICAgICAgIGFjY2Vzc2liaWxpdHlJc3N1ZXM6IDAsXG4gICAgICAgICAgICAgICAgICAgIG1pc3NpbmdBbHRUZXh0OiAwXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBsaW5rQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgdG90YWxMaW5rczogMCxcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJuYWxMaW5rczogMCxcbiAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxMaW5rczogMCxcbiAgICAgICAgICAgICAgICAgICAgYnJva2VuTGlua3M6IDAsXG4gICAgICAgICAgICAgICAgICAgIHN1YlBhZ2VzSWRlbnRpZmllZDogW10sXG4gICAgICAgICAgICAgICAgICAgIGxpbmtDb250ZXh0OiAnc2luZ2xlLXBhZ2UnLFxuICAgICAgICAgICAgICAgICAgICBhbmFseXNpc1Njb3BlOiAnY3VycmVudC1wYWdlLW9ubHknXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzaXRlbWFwSGVhbHRoOiB7XG4gICAgICAgICAgICAgICAgICAgIHRvdGFsVXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMudG90YWxVcmxzLFxuICAgICAgICAgICAgICAgICAgICBoZWFsdGh5VXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMuaGVhbHRoeVVybHMsXG4gICAgICAgICAgICAgICAgICAgIGJyb2tlblVybHM6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmxpbmtJc3N1ZXM/LmZpbHRlcigoaXNzdWU6IGFueSkgPT4gaXNzdWUuaXNzdWVUeXBlID09PSAnNDA0JykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGFjY2Vzc0RlbmllZFVybHM6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmxpbmtJc3N1ZXM/LmZpbHRlcigoaXNzdWU6IGFueSkgPT4gaXNzdWUuaXNzdWVUeXBlID09PSAnYWNjZXNzLWRlbmllZCcpLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICB0aW1lb3V0VXJsczogc2l0ZW1hcEhlYWx0aFJlc3VsdHMubGlua0lzc3Vlcz8uZmlsdGVyKChpc3N1ZTogYW55KSA9PiBpc3N1ZS5pc3N1ZVR5cGUgPT09ICd0aW1lb3V0JykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIG90aGVyRXJyb3JVcmxzOiBzaXRlbWFwSGVhbHRoUmVzdWx0cy5saW5rSXNzdWVzPy5maWx0ZXIoKGlzc3VlOiBhbnkpID0+IGlzc3VlLmlzc3VlVHlwZSA9PT0gJ2Vycm9yJykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGhlYWx0aFBlcmNlbnRhZ2U6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmhlYWx0aFBlcmNlbnRhZ2UsXG4gICAgICAgICAgICAgICAgICAgIGxpbmtJc3N1ZXM6IHNpdGVtYXBIZWFsdGhSZXN1bHRzLmxpbmtJc3N1ZXMgfHwgW10sXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NpbmdUaW1lOiBzaXRlbWFwSGVhbHRoUmVzdWx0cy5wcm9jZXNzaW5nVGltZVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYW5hbHlzaXNUaW1lOiBhY3R1YWxBbmFseXNpc1RpbWUsXG4gICAgICAgICAgICAgICAgcmV0cnlDb3VudDogMFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICAgICAgICAgICAgICAgIHJlcG9ydFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gY2F0Y2ggKHNpdGVtYXBFcnJvcikge1xuICAgICAgICAgICAgLy8gTm90IHNpdGVtYXAgbW9kZSwgdHJ5IGRvYyBtb2RlXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gc2l0ZW1hcCBoZWFsdGggcmVzdWx0cyBmb3VuZCwgY2hlY2tpbmcgZm9yIGRvYyBtb2RlIHJlc3VsdHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERPQyBNT0RFOiBDaGVjayBmb3IgZGltZW5zaW9uIHJlc3VsdHNcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGRpbWVuc2lvbktleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vZGltZW5zaW9uLXJlc3VsdHMuanNvbmA7XG4gICAgICAgICAgICBjb25zdCBkaW1lbnNpb25SZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IGRpbWVuc2lvbktleVxuICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICBjb25zdCBkaW1lbnNpb25Db250ZW50ID0gYXdhaXQgZGltZW5zaW9uUmVzcG9uc2UuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3QgZGltZW5zaW9uUmVzdWx0cyA9IEpTT04ucGFyc2UoZGltZW5zaW9uQ29udGVudCk7XG5cbiAgICAgICAgICAgIC8vIEdldCBwcm9jZXNzZWQgY29udGVudCBmb3IgYWRkaXRpb25hbCBpbmZvXG4gICAgICAgICAgICBjb25zdCBjb250ZW50S2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uYDtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IGNvbnRlbnRLZXlcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgY29uc3QgY29udGVudFN0ciA9IGF3YWl0IGNvbnRlbnRSZXNwb25zZS5Cb2R5LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzZWRDb250ZW50ID0gSlNPTi5wYXJzZShjb250ZW50U3RyKTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1JldHJpZXZlZCBwcm9jZXNzZWQgY29udGVudCBrZXlzOicsIE9iamVjdC5rZXlzKHByb2Nlc3NlZENvbnRlbnQpKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdDb250ZXh0IGFuYWx5c2lzIGNoZWNrOicsICEhcHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMpO1xuXG4gICAgICAgICAgICAvLyBHZXQgc2Vzc2lvbiBtZXRhZGF0YSB0byByZXRyaWV2ZSB0aGUgbW9kZWwgdXNlZCBhbmQgc3RhcnQgdGltZVxuICAgICAgICAgICAgbGV0IG1vZGVsVXNlZCA9ICdjbGF1ZGUnOyAvLyBkZWZhdWx0XG4gICAgICAgICAgICBsZXQgYW5hbHlzaXNTdGFydFRpbWUgPSBEYXRlLm5vdygpOyAvLyBmYWxsYmFja1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YUtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vbWV0YWRhdGEuanNvbmA7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFSZXNwb25zZSA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIEtleTogbWV0YWRhdGFLZXlcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFTdHIgPSBhd2FpdCBtZXRhZGF0YVJlc3BvbnNlLkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IEpTT04ucGFyc2UobWV0YWRhdGFTdHIpO1xuICAgICAgICAgICAgICAgIG1vZGVsVXNlZCA9IG1ldGFkYXRhLnNlbGVjdGVkTW9kZWwgfHwgJ2NsYXVkZSc7XG4gICAgICAgICAgICAgICAgYW5hbHlzaXNTdGFydFRpbWUgPSBtZXRhZGF0YS5zdGFydFRpbWUgfHwgRGF0ZS5ub3coKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKG1ldGFkYXRhRXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gbWV0YWRhdGEgZm91bmQsIHVzaW5nIGRlZmF1bHQgbW9kZWwgYW5kIGN1cnJlbnQgdGltZScpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYWxjdWxhdGUgYWN0dWFsIGFuYWx5c2lzIHRpbWVcbiAgICAgICAgICAgIGNvbnN0IGFjdHVhbEFuYWx5c2lzVGltZSA9IERhdGUubm93KCkgLSBhbmFseXNpc1N0YXJ0VGltZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgdGhlIHJlcG9ydFxuICAgICAgICAgICAgY29uc3QgdmFsaWRTY29yZXMgPSBPYmplY3QudmFsdWVzKGRpbWVuc2lvblJlc3VsdHMpXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoZDogYW55KSA9PiBkLnNjb3JlICE9PSBudWxsICYmIGQuc3RhdHVzID09PSAnY29tcGxldGUnKVxuICAgICAgICAgICAgICAgIC5tYXAoKGQ6IGFueSkgPT4gZC5zY29yZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IG92ZXJhbGxTY29yZSA9IHZhbGlkU2NvcmVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICA/IE1hdGgucm91bmQodmFsaWRTY29yZXMucmVkdWNlKChzdW06IG51bWJlciwgc2NvcmU6IG51bWJlcikgPT4gc3VtICsgc2NvcmUsIDApIC8gdmFsaWRTY29yZXMubGVuZ3RoKVxuICAgICAgICAgICAgICAgIDogMDtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgY29udGV4dCBhbmFseXNpcyBzdW1tYXJ5IGZyb20gcHJvY2Vzc2VkIGNvbnRlbnQgaWYgYXZhaWxhYmxlXG4gICAgICAgICAgICBsZXQgY29udGV4dEFuYWx5c2lzID0gbnVsbDtcbiAgICAgICAgICAgIGlmIChwcm9jZXNzZWRDb250ZW50LmNvbnRleHRBbmFseXNpcykge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGb3VuZCBjb250ZXh0IGFuYWx5c2lzIGluIHByb2Nlc3NlZCBjb250ZW50OicsIHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzKTtcblxuICAgICAgICAgICAgICAgIGNvbnRleHRBbmFseXNpcyA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dFBhZ2VzOiBwcm9jZXNzZWRDb250ZW50LmNvbnRleHRBbmFseXNpcy5jb250ZXh0UGFnZXMgfHwgW10sXG4gICAgICAgICAgICAgICAgICAgIGFuYWx5c2lzU2NvcGU6IHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzLmFuYWx5c2lzU2NvcGUgfHwgJ3NpbmdsZS1wYWdlJyxcbiAgICAgICAgICAgICAgICAgICAgdG90YWxQYWdlc0FuYWx5emVkOiBwcm9jZXNzZWRDb250ZW50LmNvbnRleHRBbmFseXNpcy50b3RhbFBhZ2VzQW5hbHl6ZWQgfHwgMVxuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnR2VuZXJhdGVkIGNvbnRleHQgYW5hbHlzaXMgZm9yIHJlcG9ydDonLCBjb250ZXh0QW5hbHlzaXMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gY29udGV4dCBhbmFseXNpcyBmb3VuZCBpbiBwcm9jZXNzZWQgY29udGVudCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXBvcnQgPSB7XG4gICAgICAgICAgICAgICAgb3ZlcmFsbFNjb3JlLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNBbmFseXplZDogdmFsaWRTY29yZXMubGVuZ3RoLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNUb3RhbDogNSxcbiAgICAgICAgICAgICAgICBjb25maWRlbmNlOiB2YWxpZFNjb3Jlcy5sZW5ndGggPT09IDUgPyAnaGlnaCcgOiB2YWxpZFNjb3Jlcy5sZW5ndGggPj0gMyA/ICdtZWRpdW0nIDogJ2xvdycsXG4gICAgICAgICAgICAgICAgbW9kZWxVc2VkOiBtb2RlbFVzZWQsXG4gICAgICAgICAgICAgICAgY2FjaGVTdGF0dXM6IHByb2Nlc3NlZENvbnRlbnQuY2FjaGVNZXRhZGF0YT8ud2FzRnJvbUNhY2hlID8gJ2hpdCcgOiAnbWlzcycsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uczogZGltZW5zaW9uUmVzdWx0cyxcbiAgICAgICAgICAgICAgICBjb2RlQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgc25pcHBldHNGb3VuZDogcHJvY2Vzc2VkQ29udGVudC5jb2RlU25pcHBldHM/Lmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBzeW50YXhFcnJvcnM6IDAsXG4gICAgICAgICAgICAgICAgICAgIGRlcHJlY2F0ZWRNZXRob2RzOiAwLFxuICAgICAgICAgICAgICAgICAgICBtaXNzaW5nVmVyc2lvblNwZWNzOiBwcm9jZXNzZWRDb250ZW50LmNvZGVTbmlwcGV0cz8uZmlsdGVyKChzOiBhbnkpID0+ICFzLmhhc1ZlcnNpb25JbmZvKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2VzRGV0ZWN0ZWQ6IHByb2Nlc3NlZENvbnRlbnQuY29kZVNuaXBwZXRzID8gWy4uLm5ldyBTZXQocHJvY2Vzc2VkQ29udGVudC5jb2RlU25pcHBldHMubWFwKChzOiBhbnkpID0+IHMubGFuZ3VhZ2UpLmZpbHRlcihCb29sZWFuKSldIDogW11cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1lZGlhQW5hbHlzaXM6IHtcbiAgICAgICAgICAgICAgICAgICAgdmlkZW9zRm91bmQ6IHByb2Nlc3NlZENvbnRlbnQubWVkaWFFbGVtZW50cz8uZmlsdGVyKChtOiBhbnkpID0+IG0udHlwZSA9PT0gJ3ZpZGVvJykubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGF1ZGlvc0ZvdW5kOiBwcm9jZXNzZWRDb250ZW50Lm1lZGlhRWxlbWVudHM/LmZpbHRlcigobTogYW55KSA9PiBtLnR5cGUgPT09ICdhdWRpbycpLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBpbWFnZXNGb3VuZDogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS50eXBlID09PSAnaW1hZ2UnKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJhY3RpdmVFbGVtZW50czogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS50eXBlID09PSAnaW50ZXJhY3RpdmUnKS5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgYWNjZXNzaWJpbGl0eUlzc3VlczogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS5hbmFseXNpc05vdGU/LmluY2x1ZGVzKCdhY2Nlc3NpYmlsaXR5JykpLmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBtaXNzaW5nQWx0VGV4dDogcHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5maWx0ZXIoKG06IGFueSkgPT4gbS50eXBlID09PSAnaW1hZ2UnICYmICFtLmFsdCkubGVuZ3RoIHx8IDBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGxpbmtBbmFseXNpczogcHJvY2Vzc2VkQ29udGVudC5saW5rQW5hbHlzaXMgfHwge30sXG4gICAgICAgICAgICAgICAgLi4uKGNvbnRleHRBbmFseXNpcyAmJiB7IGNvbnRleHRBbmFseXNpcyB9KSwgLy8gT25seSBpbmNsdWRlIGlmIG5vdCB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICBhbmFseXNpc1RpbWU6IGFjdHVhbEFuYWx5c2lzVGltZSxcbiAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgICAgICAgICAgICAgcmVwb3J0XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBjYXRjaCAoZG9jTW9kZUVycm9yKSB7XG4gICAgICAgICAgICAvLyBOZWl0aGVyIHNpdGVtYXAgbm9yIGRvYyBtb2RlIHJlc3VsdHMgZm91bmQgLSBhbmFseXNpcyBzdGlsbCBpbiBwcm9ncmVzc1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2luX3Byb2dyZXNzJyxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0FuYWx5c2lzIGluIHByb2dyZXNzJ1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdTdGF0dXMgY2hlY2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGVycm9yOiAnRmFpbGVkIHRvIGNoZWNrIHN0YXR1cycsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVEaXNjb3Zlcklzc3Vlc1JlcXVlc3QoYm9keTogc3RyaW5nIHwgbnVsbCwgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICBpZiAoIWJvZHkpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBsZXQgZGlzY292ZXJSZXF1ZXN0OiB7IGNvbXBhbnlOYW1lOiBzdHJpbmc7IGRvbWFpbjogc3RyaW5nOyBzZXNzaW9uSWQ6IHN0cmluZyB9O1xuXG4gICAgdHJ5IHtcbiAgICAgICAgZGlzY292ZXJSZXF1ZXN0ID0gSlNPTi5wYXJzZShib2R5KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCB7IGNvbXBhbnlOYW1lLCBkb21haW4sIHNlc3Npb25JZCB9ID0gZGlzY292ZXJSZXF1ZXN0O1xuXG4gICAgaWYgKCFkb21haW4gfHwgIXNlc3Npb25JZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTWlzc2luZyByZXF1aXJlZCBmaWVsZHM6IGRvbWFpbiBhbmQgc2Vzc2lvbklkJyB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdJbnZva2luZyBJc3N1ZURpc2NvdmVyZXIgTGFtYmRhIGZvcjonLCB7IGNvbXBhbnlOYW1lLCBkb21haW4sIHNlc3Npb25JZCB9KTtcblxuICAgICAgICAvLyBJbnZva2UgdGhlIElzc3VlRGlzY292ZXJlciBMYW1iZGEgZnVuY3Rpb24gZGlyZWN0bHlcbiAgICAgICAgY29uc3QgaW52b2tlUGFyYW1zID0ge1xuICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiBwcm9jZXNzLmVudi5JU1NVRV9ESVNDT1ZFUkVSX0ZVTkNUSU9OX05BTUUgfHwgJ2xlbnN5LWlzc3VlLWRpc2NvdmVyZXInLFxuICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgY29tcGFueU5hbWUsIGRvbWFpbiwgc2Vzc2lvbklkIH0pXG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKG5ldyBJbnZva2VDb21tYW5kKGludm9rZVBhcmFtcykpO1xuXG4gICAgICAgIGlmIChyZXN1bHQuUGF5bG9hZCkge1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzdWx0LlBheWxvYWQpKTtcblxuICAgICAgICAgICAgaWYgKHJlc3BvbnNlUGF5bG9hZC5zdGF0dXNDb2RlID09PSAyMDApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpc3N1ZVJlc3VsdHMgPSBKU09OLnBhcnNlKHJlc3BvbnNlUGF5bG9hZC5ib2R5KTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShpc3N1ZVJlc3VsdHMpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJc3N1ZURpc2NvdmVyZXIgZmFpbGVkOiAke3Jlc3BvbnNlUGF5bG9hZC5ib2R5fWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gSXNzdWVEaXNjb3ZlcmVyJyk7XG4gICAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0lzc3VlIGRpc2NvdmVyeSBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgZXJyb3I6ICdJc3N1ZSBkaXNjb3ZlcnkgZmFpbGVkJyxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfTtcbiAgICB9XG59XG5cblxuLyoqXG4gKiBIYW5kbGUgaXNzdWUgdmFsaWRhdGlvbiByZXF1ZXN0XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVZhbGlkYXRlSXNzdWVzUmVxdWVzdChib2R5OiBzdHJpbmcgfCBudWxsLCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgaWYgKCFib2R5KSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgbGV0IHZhbGlkYXRlUmVxdWVzdDogYW55O1xuICAgIHRyeSB7XG4gICAgICAgIHZhbGlkYXRlUmVxdWVzdCA9IEpTT04ucGFyc2UoYm9keSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgSlNPTiBpbiByZXF1ZXN0IGJvZHknIH0pXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgeyBpc3N1ZXMsIGRvbWFpbiwgc2Vzc2lvbklkIH0gPSB2YWxpZGF0ZVJlcXVlc3Q7XG5cbiAgICBpZiAoIWlzc3VlcyB8fCAhZG9tYWluIHx8ICFzZXNzaW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ01pc3NpbmcgcmVxdWlyZWQgZmllbGRzOiBpc3N1ZXMsIGRvbWFpbiwgYW5kIHNlc3Npb25JZCcgfSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZygnSW52b2tpbmcgSXNzdWVWYWxpZGF0b3IgTGFtYmRhIGZvcjonLCB7IGlzc3VlQ291bnQ6IGlzc3Vlcy5sZW5ndGgsIGRvbWFpbiwgc2Vzc2lvbklkIH0pO1xuXG4gICAgICAgIC8vIEludm9rZSB0aGUgSXNzdWVWYWxpZGF0b3IgTGFtYmRhIGZ1bmN0aW9uIGRpcmVjdGx5XG4gICAgICAgIGNvbnN0IGludm9rZVBhcmFtcyA9IHtcbiAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogcHJvY2Vzcy5lbnYuSVNTVUVfVkFMSURBVE9SX0ZVTkNUSU9OX05BTUUgfHwgJ2xlbnN5LWlzc3VlLXZhbGlkYXRvcicsXG4gICAgICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBpc3N1ZXMsIGRvbWFpbiwgc2Vzc2lvbklkIH0pXG4gICAgICAgICAgICB9KVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKG5ldyBJbnZva2VDb21tYW5kKGludm9rZVBhcmFtcykpO1xuXG4gICAgICAgIGlmIChyZXN1bHQuUGF5bG9hZCkge1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzdWx0LlBheWxvYWQpKTtcblxuICAgICAgICAgICAgaWYgKHJlc3BvbnNlUGF5bG9hZC5zdGF0dXNDb2RlID09PSAyMDApIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0cyA9IEpTT04ucGFyc2UocmVzcG9uc2VQYXlsb2FkLmJvZHkpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHZhbGlkYXRpb25SZXN1bHRzKVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSXNzdWVWYWxpZGF0b3IgZmFpbGVkOiAke3Jlc3BvbnNlUGF5bG9hZC5ib2R5fWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gSXNzdWVWYWxpZGF0b3InKTtcbiAgICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignSXNzdWUgdmFsaWRhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgZXJyb3I6ICdJc3N1ZSB2YWxpZGF0aW9uIGZhaWxlZCcsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgfVxufVxuIl19