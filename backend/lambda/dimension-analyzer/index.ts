import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';

interface DimensionAnalyzerEvent {
    url: string;
    selectedModel: string;
    sessionId: string;
    analysisStartTime: number;
}

interface DimensionAnalyzerResponse {
    success: boolean;
    sessionId: string;
    message: string;
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

type DimensionType = 'relevance' | 'freshness' | 'clarity' | 'accuracy' | 'completeness';

interface ContentTypeWeights {
    relevance: number;
    freshness: number;
    clarity: number;
    accuracy: number;
    completeness: number;
}

// Content-type-specific scoring weights (must sum to 1.0)
const CONTENT_TYPE_WEIGHTS: Record<DocumentationType, ContentTypeWeights> = {
    'api-reference': {
        relevance: 0.15,    // Lower - API docs are inherently relevant
        freshness: 0.25,    // High - API changes frequently
        clarity: 0.20,      // High - Must be clear for developers
        accuracy: 0.30,     // Critical - Wrong API info breaks code
        completeness: 0.10  // Lower - Can link to examples elsewhere
    },
    'tutorial': {
        relevance: 0.20,    // Important - Must solve real problems
        freshness: 0.20,    // Important - Outdated tutorials mislead
        clarity: 0.30,      // Critical - Must be easy to follow
        accuracy: 0.20,     // Important - Wrong steps break learning
        completeness: 0.10  // Lower - Can be focused on specific tasks
    },
    'conceptual': {
        relevance: 0.25,    // High - Must address real understanding needs
        freshness: 0.10,    // Lower - Concepts change slowly
        clarity: 0.35,      // Critical - Must explain complex ideas clearly
        accuracy: 0.20,     // Important - Wrong concepts mislead
        completeness: 0.10  // Lower - Can focus on specific aspects
    },
    'how-to': {
        relevance: 0.25,    // High - Must solve specific problems
        freshness: 0.15,    // Medium - Methods may evolve
        clarity: 0.25,      // High - Steps must be clear
        accuracy: 0.25,     // High - Wrong steps break workflows
        completeness: 0.10  // Lower - Can be task-focused
    },
    'overview': {
        relevance: 0.30,    // Critical - Must provide valuable overview
        freshness: 0.15,    // Medium - Overviews change moderately
        clarity: 0.30,      // Critical - Must be accessible to newcomers
        accuracy: 0.15,     // Medium - High-level accuracy important
        completeness: 0.10  // Lower - Intentionally high-level
    },
    'reference': {
        relevance: 0.15,    // Lower - Reference is inherently relevant
        freshness: 0.20,    // Important - Reference data changes
        clarity: 0.20,      // Important - Must be scannable
        accuracy: 0.35,     // Critical - Reference must be correct
        completeness: 0.10  // Lower - Can be comprehensive elsewhere
    },
    'troubleshooting': {
        relevance: 0.25,    // High - Must address real problems
        freshness: 0.20,    // Important - Solutions evolve
        clarity: 0.25,      // High - Solutions must be clear
        accuracy: 0.25,     // High - Wrong solutions waste time
        completeness: 0.05  // Lower - Can focus on specific issues
    },
    'changelog': {
        relevance: 0.20,    // Important - Must be relevant to users
        freshness: 0.35,    // Critical - Must be current
        clarity: 0.20,      // Important - Changes must be clear
        accuracy: 0.20,     // Important - Must accurately describe changes
        completeness: 0.05  // Lower - Can be incremental
    },
    'mixed': {
        relevance: 0.20,    // Balanced approach for mixed content
        freshness: 0.20,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.10
    }
};

interface DimensionResult {
    dimension: DimensionType;
    score: number | null;
    originalScore?: number;  // Store original score before weighting
    contentTypeWeight?: number;  // Weight applied for this content type
    contentType?: DocumentationType;  // Content type used for weighting
    status: 'complete' | 'failed' | 'timeout' | 'retrying';
    findings: string[];
    recommendations: Recommendation[];
    failureReason?: string;
    retryCount: number;
    processingTime: number;
}

interface Recommendation {
    priority: 'high' | 'medium' | 'low';
    action: string;
    location?: string;
    impact: string;
    codeExample?: string;
    mediaReference?: string;
}

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const DIMENSIONS: DimensionType[] = ['relevance', 'freshness', 'clarity', 'accuracy', 'completeness'];

export const handler: Handler<any, DimensionAnalyzerResponse> = async (event) => {
    console.log('Dimension analyzer received event:', JSON.stringify(event, null, 2));

    // Extract original parameters from Step Functions input
    const { url, selectedModel, sessionId, analysisStartTime } = event;

    console.log('Starting dimension analysis with model:', selectedModel);

    try {
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }

        // Retrieve processed content from S3
        const contentKey = `sessions/${sessionId}/processed-content.json`;
        const contentResponse = await s3Client.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: contentKey
        }));

        const contentStr = await contentResponse.Body!.transformToString();
        const processedContent = JSON.parse(contentStr);

        console.log('Retrieved processed content from S3');

        // Check if dimension analysis is already cached
        const contextualSetting = processedContent.contextAnalysis?.contextPages?.length > 0 ? 'with-context' : 'without-context';
        const cachedResults = await checkDimensionCache(bucketName, processedContent, contextualSetting, selectedModel);

        if (cachedResults) {
            console.log('✅ Dimension analysis cache hit! Using cached results');

            // Store cached results in session location
            const resultsKey = `sessions/${sessionId}/dimension-results.json`;
            await s3Client.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: resultsKey,
                Body: JSON.stringify(cachedResults),
                ContentType: 'application/json'
            }));

            return {
                success: true,
                sessionId: sessionId,
                message: `Dimension analysis completed using cached results (${selectedModel})`
            };
        }

        console.log('❌ Dimension analysis cache miss - running fresh analysis');

        // Analyze all dimensions IN PARALLEL for speed
        console.log('Starting parallel dimension analysis...');
        const dimensionPromises = DIMENSIONS.map(async (dimension) => {
            const startTime = Date.now();
            console.log(`Starting ${dimension} analysis`);

            try {
                const result = await analyzeDimension(
                    dimension,
                    processedContent,
                    selectedModel
                );

                console.log(`${dimension} complete: score ${result.score}`);
                return {
                    dimension,
                    result: {
                        ...result,
                        processingTime: Date.now() - startTime
                    }
                };
            } catch (error) {
                console.error(`${dimension} failed:`, error);
                return {
                    dimension,
                    result: {
                        dimension,
                        score: null,
                        status: 'failed' as const,
                        findings: [],
                        recommendations: [],
                        failureReason: error instanceof Error ? error.message : 'Unknown error',
                        retryCount: 0,
                        processingTime: Date.now() - startTime
                    }
                };
            }
        });

        // Wait for all dimensions to complete
        const results = await Promise.all(dimensionPromises);

        // Convert array to record
        const dimensionResults: Record<DimensionType, DimensionResult> = {} as any;
        results.forEach(({ dimension, result }) => {
            dimensionResults[dimension] = result;
        });

        // Apply content-type-aware scoring
        const contentType = processedContent.contentType as DocumentationType || 'mixed';
        const weightedResults = applyContentTypeWeights(dimensionResults, contentType);

        console.log(`Applied content-type-aware weights for: ${contentType}`);
        console.log('All dimensions analyzed in parallel');

        // Store dimension results in S3 session location
        const resultsKey = `sessions/${sessionId}/dimension-results.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: resultsKey,
            Body: JSON.stringify(weightedResults),
            ContentType: 'application/json'
        }));

        // Cache the results for future use
        await cacheDimensionResults(bucketName, processedContent, contextualSetting, selectedModel, weightedResults);

        console.log('Dimension analysis completed and stored in S3');

        return {
            success: true,
            sessionId: sessionId,
            message: `Dimension analysis completed using ${selectedModel}`
        };

    } catch (error) {
        console.error('Dimension analysis failed:', error);
        return {
            success: false,
            sessionId: sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

/**
 * Apply content-type-aware scoring weights to dimension results
 * This ensures fair comparison across different document types
 */
function applyContentTypeWeights(
    dimensionResults: Record<DimensionType, DimensionResult>,
    contentType: DocumentationType
): Record<DimensionType, DimensionResult> {
    const weights = CONTENT_TYPE_WEIGHTS[contentType];
    const weightedResults = { ...dimensionResults };

    // Add content type metadata to results
    Object.keys(weightedResults).forEach(dimension => {
        const dim = dimension as DimensionType;
        const result = weightedResults[dim];

        if (result.score !== null) {
            // Store original score and add weighted metadata
            result.originalScore = result.score;
            result.contentTypeWeight = weights[dim];
            result.contentType = contentType;

            // Add content-type-specific context to findings
            result.findings.unshift(`Content type: ${contentType} (weight: ${Math.round(weights[dim] * 100)}%)`);
        }
    });

    console.log(`Applied weights for ${contentType}:`, weights);
    return weightedResults;
}

async function checkDimensionCache(
    bucketName: string,
    processedContent: any,
    contextualSetting: string,
    selectedModel: string
): Promise<Record<DimensionType, DimensionResult> | null> {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping dimension cache check');
            return null;
        }

        const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

        // Normalize URL same way as URL processor
        const cleanUrl = normalizeUrl(processedContent.url);

        // Look up cache entry in DynamoDB
        const response = await dynamoClient.send(new GetItemCommand({
            TableName: tableName,
            Key: marshall({
                url: cleanUrl,
                contextualSetting: contextualSetting
            })
        }));

        if (!response.Item) {
            console.log('No cache entry found for dimension analysis');
            return null;
        }

        const cacheEntry = unmarshall(response.Item);
        console.log(`Found cache entry, checking for dimension results...`);

        // The s3Location now points to sessions/{consistentSessionId}/processed-content.json
        // We need to check for sessions/{consistentSessionId}/dimension-results.json
        const contentS3Path = cacheEntry.s3Location; // e.g., sessions/session-abc123/processed-content.json
        const sessionPath = contentS3Path.replace('/processed-content.json', ''); // sessions/session-abc123
        const dimensionS3Path = `${sessionPath}/dimension-results.json`;

        // Try to retrieve dimension results from S3
        try {
            const dimensionResponse = await s3Client.send(new GetObjectCommand({
                Bucket: bucketName,
                Key: dimensionS3Path
            }));

            const dimensionContent = await dimensionResponse.Body!.transformToString();
            const dimensionResults = JSON.parse(dimensionContent);

            console.log(`✅ Found cached dimension results at: ${dimensionS3Path}`);
            return dimensionResults;

        } catch (s3Error) {
            console.log(`❌ No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        }

    } catch (error) {
        console.error('Error checking dimension cache:', error);
        return null;
    }
}

async function cacheDimensionResults(
    bucketName: string,
    processedContent: any,
    contextualSetting: string,
    selectedModel: string,
    dimensionResults: Record<DimensionType, DimensionResult>
): Promise<void> {
    try {
        // Generate the same consistent session ID that URL processor uses
        const consistentSessionId = generateConsistentSessionId(processedContent.url, contextualSetting);

        // Store dimension results in the same session folder as processed content
        const dimensionS3Path = `sessions/${consistentSessionId}/dimension-results.json`;

        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: dimensionS3Path,
            Body: JSON.stringify(dimensionResults),
            ContentType: 'application/json'
        }));

        console.log(`✅ Cached dimension results at: ${dimensionS3Path}`);

    } catch (error) {
        console.error('Failed to cache dimension results:', error);
        // Don't throw - caching failure shouldn't break the main flow
    }
}

/**
 * Generate consistent session ID based on URL and context setting
 * Must match the function in URL processor exactly
 */
function generateConsistentSessionId(url: string, contextualSetting: string): string {
    const normalizedUrl = normalizeUrl(url);
    const input = `${normalizedUrl}#${contextualSetting}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `session-${hash.substring(0, 12)}`;
}

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
    } catch (error) {
        console.warn('Failed to normalize URL, using original:', url);
        return url;
    }
}
async function analyzeDimension(
    dimension: DimensionType,
    processedContent: any,
    selectedModel: string
): Promise<DimensionResult> {
    const prompt = buildPromptForDimension(dimension, processedContent);

    const modelId = getModelId(selectedModel);

    // Different models use different API formats
    let requestBody: any;
    let responseParser: (responseBody: any) => string;

    if (selectedModel === 'llama') {
        // Llama uses the older prompt format
        requestBody = {
            prompt: prompt,
            max_gen_len: 2000,
            temperature: 0.1,
            top_p: 0.9
        };
        responseParser = (responseBody) => responseBody.generation;
    } else if (selectedModel === 'titan') {
        // Titan uses textGenerationConfig format
        requestBody = {
            inputText: prompt,
            textGenerationConfig: {
                maxTokenCount: 2000,
                temperature: 0.1,
                topP: 0.9
            }
        };
        responseParser = (responseBody) => responseBody.results[0].outputText;
    } else {
        // Claude uses Messages API format
        requestBody = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 2000,
            temperature: 0.1,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        };
        responseParser = (responseBody) => responseBody.content[0].text;
    }

    const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody)
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const textContent = responseParser(responseBody);

    // Parse JSON from the response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return {
        dimension,
        score: analysis.score,
        status: 'complete',
        findings: analysis.findings || [],
        recommendations: analysis.recommendations || [],
        retryCount: 0,
        processingTime: 0 // Will be set by caller
    };
}

function buildPromptForDimension(dimension: DimensionType, processedContent: any): string {
    const contentType = processedContent.contentType as DocumentationType || 'mixed';
    const weights = CONTENT_TYPE_WEIGHTS[contentType];

    const baseContext = `
URL: ${processedContent.url}
Content Type: ${contentType} (${dimension} weight: ${Math.round(weights[dimension] * 100)}%)
Code Snippets: ${processedContent.codeSnippets?.length || 0}
Media Elements: ${processedContent.mediaElements?.length || 0}
Total Links: ${processedContent.linkAnalysis?.totalLinks || 0}

Content (first 3000 chars):
${processedContent.markdownContent?.slice(0, 3000) || ''}
`;

    // Add context analysis information if available
    let contextInfo = '';
    if (processedContent.contextAnalysis && processedContent.contextAnalysis.contextPages.length > 0) {
        contextInfo = `
CONTEXT ANALYSIS ENABLED:
Analysis Scope: ${processedContent.contextAnalysis.analysisScope}
Total Pages Analyzed: ${processedContent.contextAnalysis.totalPagesAnalyzed}
Related Pages Discovered:
${processedContent.contextAnalysis.contextPages.map((page: any) =>
            `- ${page.relationship.toUpperCase()}: ${page.title} (confidence: ${Math.round(page.confidence * 100)}%)`
        ).join('\n')}

IMPORTANT: Consider this broader documentation context when evaluating the target page. 
The target page is part of a larger documentation structure, so evaluate how well it fits 
within this context and whether it properly references or builds upon related pages.
`;
    } else {
        contextInfo = `
CONTEXT ANALYSIS: Single page analysis (no related pages discovered)
`;
    }

    // Content-type-specific evaluation criteria
    const contentTypeGuidance = getContentTypeGuidance(contentType, dimension);

    const dimensionPrompts: Record<DimensionType, string> = {
        relevance: `Analyze the RELEVANCE of this WordPress developer documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Evaluate:
1. Is the content relevant to WordPress developers?
2. Are examples practical and applicable?
3. Does it address real developer needs?
4. Is the scope appropriate for the topic?
5. If context pages are available, does this page fit well within the broader documentation structure?

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact"
    }
  ]
}`,

        freshness: `Analyze the FRESHNESS of this WordPress developer documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Code Snippets with Version Info:
${processedContent.codeSnippets?.filter((s: any) => s.hasVersionInfo).map((s: any) => s.code.slice(0, 200)).join('\n---\n') || 'None'}

Evaluate:
1. Are WordPress version references current (6.4+)?
2. Are code examples using modern practices?
3. Are deprecated features flagged?
4. Is the content up-to-date?
5. If context pages are available, consider whether this page's version information is consistent with related pages.

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact"
    }
  ]
}`,

        clarity: `Analyze the CLARITY of this WordPress developer documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Evaluate:
1. Is the content well-structured and organized?
2. Are explanations clear and understandable?
3. Are code examples well-commented?
4. Is technical jargon explained?
5. If context pages are available, does this page clearly explain its relationship to parent/child/sibling pages?

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact"
    }
  ]
}`,

        accuracy: `Analyze the ACCURACY of this WordPress developer documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Code Snippets:
${processedContent.codeSnippets?.map((s: any) => `Language: ${s.language}\n${s.code.slice(0, 300)}`).join('\n---\n') || 'None'}

Evaluate:
1. Are code examples syntactically correct?
2. Is API usage accurate?
3. Are technical details correct?
4. Are there any misleading statements?
5. If context pages are available, is the information consistent with related documentation?

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact"
    }
  ]
}`,

        completeness: `Analyze the COMPLETENESS of this WordPress developer documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Sub-pages Referenced: ${processedContent.linkAnalysis?.subPagesIdentified?.join(', ') || 'None'}

Evaluate:
1. Does it cover the main topic thoroughly?
2. Are important details missing?
3. Are edge cases addressed?
4. Is error handling documented?
5. If context pages are available, does this page properly reference or link to related information in parent/child/sibling pages?

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact"
    }
  ]
}`
    };

    return dimensionPrompts[dimension];
}

/**
 * Get content-type-specific evaluation guidance for each dimension
 */
function getContentTypeGuidance(contentType: DocumentationType, dimension: DimensionType): string {
    const guidance: Record<DocumentationType, Record<DimensionType, string>> = {
        'api-reference': {
            relevance: 'API docs should focus on practical developer needs. Lower weight (15%) - inherently relevant.',
            freshness: 'Critical for API docs (25% weight) - APIs change frequently. Check for current WordPress versions.',
            clarity: 'Important (20% weight) - developers need clear parameter descriptions and return values.',
            accuracy: 'CRITICAL (30% weight) - wrong API info breaks developer code. Verify syntax and parameters.',
            completeness: 'Lower priority (10% weight) - can link to examples elsewhere. Focus on core API info.'
        },
        'tutorial': {
            relevance: 'Must solve real developer problems (20% weight). Check if examples are practical.',
            freshness: 'Important (20% weight) - outdated tutorials mislead learners. Verify current practices.',
            clarity: 'CRITICAL (30% weight) - tutorials must be easy to follow step-by-step.',
            accuracy: 'Important (20% weight) - wrong steps break the learning experience.',
            completeness: 'Lower priority (10% weight) - can focus on specific learning objectives.'
        },
        'conceptual': {
            relevance: 'High importance (25% weight) - must address real understanding needs.',
            freshness: 'Lower priority (10% weight) - concepts change slowly, focus on timeless principles.',
            clarity: 'CRITICAL (35% weight) - must explain complex ideas clearly to diverse audiences.',
            accuracy: 'Important (20% weight) - wrong concepts mislead understanding.',
            completeness: 'Lower priority (10% weight) - can focus on specific conceptual aspects.'
        },
        'how-to': {
            relevance: 'High importance (25% weight) - must solve specific, real problems.',
            freshness: 'Medium priority (15% weight) - methods evolve but not as rapidly as APIs.',
            clarity: 'High importance (25% weight) - procedural steps must be crystal clear.',
            accuracy: 'High importance (25% weight) - wrong steps break workflows and waste time.',
            completeness: 'Lower priority (10% weight) - can be task-focused rather than comprehensive.'
        },
        'overview': {
            relevance: 'CRITICAL (30% weight) - overviews must provide valuable high-level perspective.',
            freshness: 'Medium priority (15% weight) - overviews change moderately with ecosystem evolution.',
            clarity: 'CRITICAL (30% weight) - must be accessible to newcomers and provide clear mental models.',
            accuracy: 'Medium priority (15% weight) - high-level accuracy important but details can be elsewhere.',
            completeness: 'Lower priority (10% weight) - intentionally high-level, comprehensive details elsewhere.'
        },
        'reference': {
            relevance: 'Lower priority (15% weight) - reference material is inherently relevant to its domain.',
            freshness: 'Important (20% weight) - reference data must be current and accurate.',
            clarity: 'Important (20% weight) - must be scannable and well-organized for quick lookup.',
            accuracy: 'CRITICAL (35% weight) - reference material must be completely accurate.',
            completeness: 'Lower priority (10% weight) - can be comprehensive in scope elsewhere.'
        },
        'troubleshooting': {
            relevance: 'High importance (25% weight) - must address real, common problems developers face.',
            freshness: 'Important (20% weight) - solutions evolve as technology and best practices change.',
            clarity: 'High importance (25% weight) - problem descriptions and solutions must be clear.',
            accuracy: 'High importance (25% weight) - wrong solutions waste significant developer time.',
            completeness: 'Lower priority (5% weight) - can focus on specific issues rather than comprehensive coverage.'
        },
        'changelog': {
            relevance: 'Important (20% weight) - changes must be relevant to the target audience.',
            freshness: 'CRITICAL (35% weight) - changelogs must be current and up-to-date.',
            clarity: 'Important (20% weight) - changes must be clearly described and categorized.',
            accuracy: 'Important (20% weight) - must accurately describe what changed.',
            completeness: 'Lower priority (5% weight) - can be incremental, comprehensive history elsewhere.'
        },
        'mixed': {
            relevance: 'Balanced approach (20% weight) - evaluate relevance across all content types present.',
            freshness: 'Balanced approach (20% weight) - consider freshness needs of different content sections.',
            clarity: 'High importance (25% weight) - mixed content especially needs clear organization.',
            accuracy: 'High importance (25% weight) - accuracy important across all content types.',
            completeness: 'Lower priority (10% weight) - mixed content can have varied completeness needs.'
        }
    };

    return guidance[contentType]?.[dimension] || 'Apply standard evaluation criteria for this dimension.';
}

function getModelId(selectedModel: string): string {
    const modelMap: Record<string, string> = {
        'claude': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        'titan': 'amazon.titan-text-premier-v1:0',
        'llama': 'us.meta.llama3-1-70b-instruct-v1:0',  // Cross-region inference profile
        'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    };

    return modelMap[selectedModel] || modelMap['claude'];
}