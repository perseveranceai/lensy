import { Handler } from 'aws-lambda';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

interface AnalysisRequest {
    url: string;
    selectedModel: 'claude' | 'titan' | 'llama' | 'auto';
    sessionId: string;
    contextAnalysis?: {
        enabled: boolean;
        maxContextPages?: number;
    };
    cacheControl?: {
        enabled: boolean;
    };
}

export const handler: Handler<any, any> = async (event: any) => {
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
                availableRoutes: ['POST /analyze', 'GET /status/{sessionId}']
            })
        };

    } catch (error) {
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

async function handleAnalyzeRequest(body: string | null, corsHeaders: Record<string, string>) {
    if (!body) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Request body is required' })
        };
    }

    let analysisRequest: AnalysisRequest;

    try {
        analysisRequest = JSON.parse(body);
    } catch (error) {
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
    } catch (error) {
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

    const startExecutionCommand = new StartExecutionCommand({
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

async function handleStatusRequest(path: string, corsHeaders: Record<string, string>) {
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
        // The report-generator stores it as the Step Functions output
        // We need to check if dimension-results.json exists (analysis complete)

        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

        try {
            // Check if dimension results exist (means analysis is complete or in progress)
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
            } catch (metadataError) {
                console.log('No metadata found, using default model and current time');
            }

            // Calculate actual analysis time
            const actualAnalysisTime = Date.now() - analysisStartTime;

            // Build the report
            const validScores = Object.values(dimensionResults)
                .filter((d: any) => d.score !== null && d.status === 'complete')
                .map((d: any) => d.score);

            const overallScore = validScores.length > 0
                ? Math.round(validScores.reduce((sum: number, score: number) => sum + score, 0) / validScores.length)
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
            } else {
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
                    missingVersionSpecs: processedContent.codeSnippets?.filter((s: any) => !s.hasVersionInfo).length || 0,
                    languagesDetected: [...new Set(processedContent.codeSnippets?.map((s: any) => s.language).filter(Boolean))] || []
                },
                mediaAnalysis: {
                    videosFound: processedContent.mediaElements?.filter((m: any) => m.type === 'video').length || 0,
                    audiosFound: processedContent.mediaElements?.filter((m: any) => m.type === 'audio').length || 0,
                    imagesFound: processedContent.mediaElements?.filter((m: any) => m.type === 'image').length || 0,
                    interactiveElements: processedContent.mediaElements?.filter((m: any) => m.type === 'interactive').length || 0,
                    accessibilityIssues: processedContent.mediaElements?.filter((m: any) => m.analysisNote?.includes('accessibility')).length || 0,
                    missingAltText: processedContent.mediaElements?.filter((m: any) => m.type === 'image' && !m.alt).length || 0
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

        } catch (s3Error) {
            // Results not ready yet
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

    } catch (error) {
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