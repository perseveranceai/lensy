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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const crypto = __importStar(require("crypto"));
const progress_publisher_1 = require("./progress-publisher");
// Content-type-specific scoring weights (must sum to 1.0)
const CONTENT_TYPE_WEIGHTS = {
    'api-reference': {
        relevance: 0.15, // Lower - API docs are inherently relevant
        freshness: 0.25, // High - API changes frequently
        clarity: 0.20, // High - Must be clear for developers
        accuracy: 0.30, // Critical - Wrong API info breaks code
        completeness: 0.10 // Lower - Can link to examples elsewhere
    },
    'tutorial': {
        relevance: 0.20, // Important - Must solve real problems
        freshness: 0.20, // Important - Outdated tutorials mislead
        clarity: 0.30, // Critical - Must be easy to follow
        accuracy: 0.20, // Important - Wrong steps break learning
        completeness: 0.10 // Lower - Can be focused on specific tasks
    },
    'conceptual': {
        relevance: 0.25, // High - Must address real understanding needs
        freshness: 0.10, // Lower - Concepts change slowly
        clarity: 0.35, // Critical - Must explain complex ideas clearly
        accuracy: 0.20, // Important - Wrong concepts mislead
        completeness: 0.10 // Lower - Can focus on specific aspects
    },
    'how-to': {
        relevance: 0.25, // High - Must solve specific problems
        freshness: 0.15, // Medium - Methods may evolve
        clarity: 0.25, // High - Steps must be clear
        accuracy: 0.25, // High - Wrong steps break workflows
        completeness: 0.10 // Lower - Can be task-focused
    },
    'overview': {
        relevance: 0.30, // Critical - Must provide valuable overview
        freshness: 0.15, // Medium - Overviews change moderately
        clarity: 0.30, // Critical - Must be accessible to newcomers
        accuracy: 0.15, // Medium - High-level accuracy important
        completeness: 0.10 // Lower - Intentionally high-level
    },
    'reference': {
        relevance: 0.15, // Lower - Reference is inherently relevant
        freshness: 0.20, // Important - Reference data changes
        clarity: 0.20, // Important - Must be scannable
        accuracy: 0.35, // Critical - Reference must be correct
        completeness: 0.10 // Lower - Can be comprehensive elsewhere
    },
    'troubleshooting': {
        relevance: 0.25, // High - Must address real problems
        freshness: 0.20, // Important - Solutions evolve
        clarity: 0.25, // High - Solutions must be clear
        accuracy: 0.25, // High - Wrong solutions waste time
        completeness: 0.05 // Lower - Can focus on specific issues
    },
    'changelog': {
        relevance: 0.20, // Important - Must be relevant to users
        freshness: 0.35, // Critical - Must be current
        clarity: 0.20, // Important - Changes must be clear
        accuracy: 0.20, // Important - Must accurately describe changes
        completeness: 0.05 // Lower - Can be incremental
    },
    'mixed': {
        relevance: 0.20, // Balanced approach for mixed content
        freshness: 0.20,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.10
    }
};
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const DIMENSIONS = ['relevance', 'freshness', 'clarity', 'accuracy', 'completeness'];
const handler = async (event) => {
    console.log('Dimension analyzer received event:', JSON.stringify(event, null, 2));
    // Extract original parameters from Step Functions input
    const { url, selectedModel, sessionId, analysisStartTime } = event;
    console.log('Starting dimension analysis with model:', selectedModel);
    // Initialize progress publisher
    const progress = new progress_publisher_1.ProgressPublisher(sessionId);
    try {
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }
        // Retrieve processed content from S3
        const contentKey = `sessions/${sessionId}/processed-content.json`;
        const contentResponse = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: contentKey
        }));
        const contentStr = await contentResponse.Body.transformToString();
        const processedContent = JSON.parse(contentStr);
        console.log('Retrieved processed content from S3');
        // Check if caching is enabled (default to true for backward compatibility)
        const cacheEnabled = event.cacheControl?.enabled !== false;
        // Check if dimension analysis is already cached (only if caching is enabled)
        const contextualSetting = processedContent.contextAnalysis?.contextPages?.length > 0 ? 'with-context' : 'without-context';
        let cachedResults = null;
        if (cacheEnabled) {
            cachedResults = await checkDimensionCache(bucketName, processedContent, contextualSetting, selectedModel);
        }
        else {
            console.log('⚠️ Cache disabled by user - skipping dimension cache check');
        }
        if (cachedResults) {
            console.log('✅ Dimension analysis cache hit! Using cached results');
            // Send cache hit message for dimensions
            await progress.cacheHit('Retrieved: 5/5 dimensions from cache');
            // Store cached results in session location
            const resultsKey = `sessions/${sessionId}/dimension-results.json`;
            await s3Client.send(new client_s3_1.PutObjectCommand({
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
        // Send structure detection complete message
        await progress.success('Structure detected: Topics identified', {
            phase: 'structure-detection'
        });
        // Analyze all dimensions IN PARALLEL for speed
        console.log('Starting parallel dimension analysis...');
        const dimensionPromises = DIMENSIONS.map(async (dimension, index) => {
            const startTime = Date.now();
            console.log(`Starting ${dimension} analysis`);
            // Send progress message for this dimension
            await progress.progress(`Analyzing ${dimension.charAt(0).toUpperCase() + dimension.slice(1)} (${index + 1}/5)...`, 'dimension-analysis', {
                dimension
            });
            try {
                const result = await analyzeDimension(dimension, processedContent, selectedModel);
                const processingTime = Date.now() - startTime;
                console.log(`${dimension} complete: score ${result.score}`);
                // Send success message with score
                await progress.success(`${dimension.charAt(0).toUpperCase() + dimension.slice(1)}: ${result.score}/100 (${(processingTime / 1000).toFixed(1)}s)`, {
                    dimension,
                    score: result.score || undefined,
                    processingTime
                });
                return {
                    dimension,
                    result: {
                        ...result,
                        processingTime
                    }
                };
            }
            catch (error) {
                console.error(`${dimension} failed:`, error);
                // Send error message
                await progress.error(`${dimension.charAt(0).toUpperCase() + dimension.slice(1)} failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
                    dimension
                });
                return {
                    dimension,
                    result: {
                        dimension,
                        score: null,
                        status: 'failed',
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
        const dimensionResults = {};
        results.forEach(({ dimension, result }) => {
            dimensionResults[dimension] = result;
        });
        // Apply content-type-aware scoring
        const contentType = processedContent.contentType || 'mixed';
        const weightedResults = applyContentTypeWeights(dimensionResults, contentType);
        console.log(`Applied content-type-aware weights for: ${contentType}`);
        console.log('All dimensions analyzed in parallel');
        // Store dimension results in S3 session location
        const resultsKey = `sessions/${sessionId}/dimension-results.json`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: resultsKey,
            Body: JSON.stringify(weightedResults),
            ContentType: 'application/json'
        }));
        // Cache the results for future use (only if caching is enabled)
        if (cacheEnabled) {
            await cacheDimensionResults(bucketName, processedContent, contextualSetting, selectedModel, weightedResults);
        }
        else {
            console.log('⚠️ Cache disabled - skipping dimension cache storage');
        }
        console.log('Dimension analysis completed and stored in S3');
        return {
            success: true,
            sessionId: sessionId,
            message: `Dimension analysis completed using ${selectedModel}`
        };
    }
    catch (error) {
        console.error('Dimension analysis failed:', error);
        return {
            success: false,
            sessionId: sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};
exports.handler = handler;
/**
 * Apply content-type-aware scoring weights to dimension results
 * This ensures fair comparison across different document types
 */
function applyContentTypeWeights(dimensionResults, contentType) {
    const weights = CONTENT_TYPE_WEIGHTS[contentType];
    const weightedResults = { ...dimensionResults };
    // Add content type metadata to results
    Object.keys(weightedResults).forEach(dimension => {
        const dim = dimension;
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
async function checkDimensionCache(bucketName, processedContent, contextualSetting, selectedModel) {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping dimension cache check');
            return null;
        }
        const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
        // Normalize URL same way as URL processor
        const cleanUrl = normalizeUrl(processedContent.url);
        // Look up cache entry in DynamoDB
        const response = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: tableName,
            Key: (0, util_dynamodb_1.marshall)({
                url: cleanUrl,
                contextualSetting: contextualSetting
            })
        }));
        if (!response.Item) {
            console.log('No cache entry found for dimension analysis');
            return null;
        }
        const cacheEntry = (0, util_dynamodb_1.unmarshall)(response.Item);
        console.log(`Found cache entry, checking for dimension results...`);
        // The s3Location now points to sessions/{consistentSessionId}/processed-content.json
        // We need to check for sessions/{consistentSessionId}/dimension-results.json
        const contentS3Path = cacheEntry.s3Location; // e.g., sessions/session-abc123/processed-content.json
        const sessionPath = contentS3Path.replace('/processed-content.json', ''); // sessions/session-abc123
        const dimensionS3Path = `${sessionPath}/dimension-results.json`;
        // Try to retrieve dimension results from S3
        try {
            const dimensionResponse = await s3Client.send(new client_s3_1.GetObjectCommand({
                Bucket: bucketName,
                Key: dimensionS3Path
            }));
            const dimensionContent = await dimensionResponse.Body.transformToString();
            const dimensionResults = JSON.parse(dimensionContent);
            console.log(`✅ Found cached dimension results at: ${dimensionS3Path}`);
            return dimensionResults;
        }
        catch (s3Error) {
            console.log(`❌ No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        }
    }
    catch (error) {
        console.error('Error checking dimension cache:', error);
        return null;
    }
}
async function cacheDimensionResults(bucketName, processedContent, contextualSetting, selectedModel, dimensionResults) {
    try {
        // Generate the same consistent session ID that URL processor uses
        const consistentSessionId = generateConsistentSessionId(processedContent.url, contextualSetting);
        // Store dimension results in the same session folder as processed content
        const dimensionS3Path = `sessions/${consistentSessionId}/dimension-results.json`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: dimensionS3Path,
            Body: JSON.stringify(dimensionResults),
            ContentType: 'application/json'
        }));
        console.log(`✅ Cached dimension results at: ${dimensionS3Path}`);
    }
    catch (error) {
        console.error('Failed to cache dimension results:', error);
        // Don't throw - caching failure shouldn't break the main flow
    }
}
/**
 * Generate consistent session ID based on URL and context setting
 * Must match the function in URL processor exactly
 */
function generateConsistentSessionId(url, contextualSetting) {
    const normalizedUrl = normalizeUrl(url);
    const input = `${normalizedUrl}#${contextualSetting}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `session-${hash.substring(0, 12)}`;
}
function normalizeUrl(url) {
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
    }
    catch (error) {
        console.warn('Failed to normalize URL, using original:', url);
        return url;
    }
}
async function analyzeDimension(dimension, processedContent, selectedModel) {
    const prompt = buildPromptForDimension(dimension, processedContent);
    const modelId = getModelId(selectedModel);
    // Different models use different API formats
    let requestBody;
    let responseParser;
    if (selectedModel === 'llama') {
        // Llama uses the older prompt format
        requestBody = {
            prompt: prompt,
            max_gen_len: 2000,
            temperature: 0.1,
            top_p: 0.9
        };
        responseParser = (responseBody) => responseBody.generation;
    }
    else if (selectedModel === 'titan') {
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
    }
    else {
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
    const command = new client_bedrock_runtime_1.InvokeModelCommand({
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
function buildPromptForDimension(dimension, processedContent) {
    const contentType = processedContent.contentType || 'mixed';
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
${processedContent.contextAnalysis.contextPages.map((page) => `- ${page.relationship.toUpperCase()}: ${page.title} (confidence: ${Math.round(page.confidence * 100)}%)`).join('\n')}

IMPORTANT: Consider this broader documentation context when evaluating the target page. 
The target page is part of a larger documentation structure, so evaluate how well it fits 
within this context and whether it properly references or builds upon related pages.
`;
    }
    else {
        contextInfo = `
CONTEXT ANALYSIS: Single page analysis (no related pages discovered)
`;
    }
    // Content-type-specific evaluation criteria
    const contentTypeGuidance = getContentTypeGuidance(contentType, dimension);
    const dimensionPrompts = {
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
${processedContent.codeSnippets?.filter((s) => s.hasVersionInfo).map((s) => s.code.slice(0, 200)).join('\n---\n') || 'None'}

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
${processedContent.codeSnippets?.map((s) => `Language: ${s.language}\n${s.code.slice(0, 300)}`).join('\n---\n') || 'None'}

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
function getContentTypeGuidance(contentType, dimension) {
    const guidance = {
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
function getModelId(selectedModel) {
    const modelMap = {
        'claude': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        'titan': 'amazon.titan-text-premier-v1:0',
        'llama': 'us.meta.llama3-1-70b-instruct-v1:0', // Cross-region inference profile
        'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    };
    return modelMap[selectedModel] || modelMap['claude'];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxrREFBa0Y7QUFDbEYsNEVBQTJGO0FBQzNGLDhEQUE2RztBQUM3RywwREFBOEQ7QUFDOUQsK0NBQWlDO0FBQ2pDLDZEQUF5RDtBQXVDekQsMERBQTBEO0FBQzFELE1BQU0sb0JBQW9CLEdBQWtEO0lBQ3hFLGVBQWUsRUFBRTtRQUNiLFNBQVMsRUFBRSxJQUFJLEVBQUssMkNBQTJDO1FBQy9ELFNBQVMsRUFBRSxJQUFJLEVBQUssZ0NBQWdDO1FBQ3BELE9BQU8sRUFBRSxJQUFJLEVBQU8sc0NBQXNDO1FBQzFELFFBQVEsRUFBRSxJQUFJLEVBQU0sd0NBQXdDO1FBQzVELFlBQVksRUFBRSxJQUFJLENBQUUseUNBQXlDO0tBQ2hFO0lBQ0QsVUFBVSxFQUFFO1FBQ1IsU0FBUyxFQUFFLElBQUksRUFBSyx1Q0FBdUM7UUFDM0QsU0FBUyxFQUFFLElBQUksRUFBSyx5Q0FBeUM7UUFDN0QsT0FBTyxFQUFFLElBQUksRUFBTyxvQ0FBb0M7UUFDeEQsUUFBUSxFQUFFLElBQUksRUFBTSx5Q0FBeUM7UUFDN0QsWUFBWSxFQUFFLElBQUksQ0FBRSwyQ0FBMkM7S0FDbEU7SUFDRCxZQUFZLEVBQUU7UUFDVixTQUFTLEVBQUUsSUFBSSxFQUFLLCtDQUErQztRQUNuRSxTQUFTLEVBQUUsSUFBSSxFQUFLLGlDQUFpQztRQUNyRCxPQUFPLEVBQUUsSUFBSSxFQUFPLGdEQUFnRDtRQUNwRSxRQUFRLEVBQUUsSUFBSSxFQUFNLHFDQUFxQztRQUN6RCxZQUFZLEVBQUUsSUFBSSxDQUFFLHdDQUF3QztLQUMvRDtJQUNELFFBQVEsRUFBRTtRQUNOLFNBQVMsRUFBRSxJQUFJLEVBQUssc0NBQXNDO1FBQzFELFNBQVMsRUFBRSxJQUFJLEVBQUssOEJBQThCO1FBQ2xELE9BQU8sRUFBRSxJQUFJ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O1lBQy9FLE9BQU8sRUFBRSw2RUFBNkU7WUFDdEYsUUFBUSxFQUFFLGlFQUFpRTtZQUMzRSxZQUFZLEVBQUUsbUZBQW1GO1NBQ3BHO1FBQ0QsT0FBTyxFQUFFO1lBQ0wsU0FBUyxFQUFFLHVGQUF1RjtZQUNsRyxTQUFTLEVBQUUsMEZBQTBGO1lBQ3JHLE9BQU8sRUFBRSxtRkFBbUY7WUFDNUYsUUFBUSxFQUFFLDZFQUE2RTtZQUN2RixZQUFZLEVBQUUsaUZBQWlGO1NBQ2xHO0tBQ0osQ0FBQztJQUVGLE9BQU8sUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksd0RBQXdELENBQUM7QUFDMUcsQ0FBQztBQUVELFNBQVMsVUFBVSxDQUFDLGFBQXFCO0lBQ3JDLE1BQU0sUUFBUSxHQUEyQjtRQUNyQyxRQUFRLEVBQUUsOENBQThDO1FBQ3hELE9BQU8sRUFBRSxnQ0FBZ0M7UUFDekMsT0FBTyxFQUFFLG9DQUFvQyxFQUFHLGlDQUFpQztRQUNqRixNQUFNLEVBQUUsOENBQThDO0tBQ3pELENBQUM7SUFFRixPQUFPLFFBQVEsQ0FBQyxhQUFhLENBQUMsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDekQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IFMzQ2xpZW50LCBHZXRPYmplY3RDb21tYW5kLCBQdXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcbmltcG9ydCB7IEJlZHJvY2tSdW50aW1lQ2xpZW50LCBJbnZva2VNb2RlbENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtYmVkcm9jay1ydW50aW1lJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBHZXRJdGVtQ29tbWFuZCwgUHV0SXRlbUNvbW1hbmQsIFVwZGF0ZUl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IG1hcnNoYWxsLCB1bm1hcnNoYWxsIH0gZnJvbSAnQGF3cy1zZGsvdXRpbC1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IFByb2dyZXNzUHVibGlzaGVyIH0gZnJvbSAnLi9wcm9ncmVzcy1wdWJsaXNoZXInO1xuXG5pbnRlcmZhY2UgRGltZW5zaW9uQW5hbHl6ZXJFdmVudCB7XG4gICAgdXJsOiBzdHJpbmc7XG4gICAgc2VsZWN0ZWRNb2RlbDogc3RyaW5nO1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIGFuYWx5c2lzU3RhcnRUaW1lOiBudW1iZXI7XG4gICAgY2FjaGVDb250cm9sPzoge1xuICAgICAgICBlbmFibGVkOiBib29sZWFuO1xuICAgIH07XG59XG5cbmludGVyZmFjZSBEaW1lbnNpb25BbmFseXplclJlc3BvbnNlIHtcbiAgICBzdWNjZXNzOiBib29sZWFuO1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIG1lc3NhZ2U6IHN0cmluZztcbn1cblxudHlwZSBEb2N1bWVudGF0aW9uVHlwZSA9XG4gICAgfCAnYXBpLXJlZmVyZW5jZScgICAgICAvLyBGdW5jdGlvbi9jbGFzcyBkb2NzLCBuZWVkcyBjb2RlXG4gICAgfCAndHV0b3JpYWwnICAgICAgICAgICAvLyBTdGVwLWJ5LXN0ZXAgZ3VpZGUsIG5lZWRzIGNvZGVcbiAgICB8ICdjb25jZXB0dWFsJyAgICAgICAgIC8vIEV4cGxhaW5zIGNvbmNlcHRzLCBtYXkgbm90IG5lZWQgY29kZVxuICAgIHwgJ2hvdy10bycgICAgICAgICAgICAgLy8gVGFzay1mb2N1c2VkLCB1c3VhbGx5IG5lZWRzIGNvZGVcbiAgICB8ICdyZWZlcmVuY2UnICAgICAgICAgIC8vIFRhYmxlcywgbGlzdHMsIHNwZWNzXG4gICAgfCAndHJvdWJsZXNob290aW5nJyAgICAvLyBQcm9ibGVtL3NvbHV0aW9uIGZvcm1hdFxuICAgIHwgJ292ZXJ2aWV3JyAgICAgICAgICAgLy8gSGlnaC1sZXZlbCBpbnRybywgcmFyZWx5IG5lZWRzIGNvZGVcbiAgICB8ICdjaGFuZ2Vsb2cnICAgICAgICAgIC8vIFZlcnNpb24gaGlzdG9yeVxuICAgIHwgJ21peGVkJzsgICAgICAgICAgICAgLy8gQ29tYmluYXRpb25cblxudHlwZSBEaW1lbnNpb25UeXBlID0gJ3JlbGV2YW5jZScgfCAnZnJlc2huZXNzJyB8ICdjbGFyaXR5JyB8ICdhY2N1cmFjeScgfCAnY29tcGxldGVuZXNzJztcblxuaW50ZXJmYWNlIENvbnRlbnRUeXBlV2VpZ2h0cyB7XG4gICAgcmVsZXZhbmNlOiBudW1iZXI7XG4gICAgZnJlc2huZXNzOiBudW1iZXI7XG4gICAgY2xhcml0eTogbnVtYmVyO1xuICAgIGFjY3VyYWN5OiBudW1iZXI7XG4gICAgY29tcGxldGVuZXNzOiBudW1iZXI7XG59XG5cbi8vIENvbnRlbnQtdHlwZS1zcGVjaWZpYyBzY29yaW5nIHdlaWdodHMgKG11c3Qgc3VtIHRvIDEuMClcbmNvbnN0IENPTlRFTlRfVFlQRV9XRUlHSFRTOiBSZWNvcmQ8RG9jdW1lbnRhdGlvblR5cGUsIENvbnRlbnRUeXBlV2VpZ2h0cz4gPSB7XG4gICAgJ2FwaS1yZWZlcmVuY2UnOiB7XG4gICAgICAgIHJlbGV2YW5jZTogMC4xNSwgICAgLy8gTG93ZXIgLSBBUEkgZG9jcyBhcmUgaW5oZXJlbnRseSByZWxldmFudFxuICAgICAgICBmcmVzaG5lc3M6IDAuMjUsICAgIC8vIEhpZ2ggLSBBUEkgY2hhbmdlcyBmcmVxdWVudGx5XG4gICAgICAgIGNsYXJpdHk6IDAuMjAsICAgICAgLy8gSGlnaCAtIE11c3QgYmUgY2xlYXIgZm9yIGRldmVsb3BlcnNcbiAgICAgICAgYWNjdXJhY3k6IDAuMzAsICAgICAvLyBDcml0aWNhbCAtIFdyb25nIEFQSSBpbmZvIGJyZWFrcyBjb2RlXG4gICAgICAgIGNvbXBsZXRlbmVzczogMC4xMCAgLy8gTG93ZXIgLSBDYW4gbGluayB0byBleGFtcGxlcyBlbHNld2hlcmVcbiAgICB9LFxuICAgICd0dXRvcmlhbCc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjIwLCAgICAvLyBJbXBvcnRhbnQgLSBNdXN0IHNvbHZlIHJlYWwgcHJvYmxlbXNcbiAgICAgICAgZnJlc2huZXNzOiAwLjIwLCAgICAvLyBJbXBvcnRhbnQgLSBPdXRkYXRlZCB0dXRvcmlhbHMgbWlzbGVhZFxuICAgICAgICBjbGFyaXR5OiAwLjMwLCAgICAgIC8vIENyaXRpY2FsIC0gTXVzdCBiZSBlYXN5IHRvIGZvbGxvd1xuICAgICAgICBhY2N1cmFjeTogMC4yMCwgICAgIC8vIEltcG9ydGFudCAtIFdyb25nIHN0ZXBzIGJyZWFrIGxlYXJuaW5nXG4gICAgICAgIGNvbXBsZXRlbmVzczogMC4xMCAgLy8gTG93ZXIgLSBDYW4gYmUgZm9jdXNlZCBvbiBzcGVjaWZpYyB0YXNrc1xuICAgIH0sXG4gICAgJ2NvbmNlcHR1YWwnOiB7XG4gICAgICAgIHJlbGV2YW5jZTogMC4yNSwgICAgLy8gSGlnaCAtIE11c3QgYWRkcmVzcyByZWFsIHVuZGVyc3RhbmRpbmcgbmVlZHNcbiAgICAgICAgZnJlc2huZXNzOiAwLjEwLCAgICAvLyBMb3dlciAtIENvbmNlcHRzIGNoYW5nZSBzbG93bHlcbiAgICAgICAgY2xhcml0eTogMC4zNSwgICAgICAvLyBDcml0aWNhbCAtIE11c3QgZXhwbGFpbiBjb21wbGV4IGlkZWFzIGNsZWFybHlcbiAgICAgICAgYWNjdXJhY3k6IDAuMjAsICAgICAvLyBJbXBvcnRhbnQgLSBXcm9uZyBjb25jZXB0cyBtaXNsZWFkXG4gICAgICAgIGNvbXBsZXRlbmVzczogMC4xMCAgLy8gTG93ZXIgLSBDYW4gZm9jdXMgb24gc3BlY2lmaWMgYXNwZWN0c1xuICAgIH0sXG4gICAgJ2hvdy10byc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjI1LCAgICAvLyBIaWdoIC0gTXVzdCBzb2x2ZSBzcGVjaWZpYyBwcm9ibGVtc1xuICAgICAgICBmcmVzaG5lc3M6IDAuMTUsICAgIC8vIE1lZGl1bSAtIE1ldGhvZHMgbWF5IGV2b2x2ZVxuICAgICAgICBjbGFyaXR5OiAwLjI1LCAgICAgIC8vIEhpZ2ggLSBTdGVwcyBtdXN0IGJlIGNsZWFyXG4gICAgICAgIGFjY3VyYWN5OiAwLjI1LCAgICAgLy8gSGlnaCAtIFdyb25nIHN0ZXBzIGJyZWFrIHdvcmtmbG93c1xuICAgICAgICBjb21wbGV0ZW5lc3M6IDAuMTAgIC8vIExvd2VyIC0gQ2FuIGJlIHRhc2stZm9jdXNlZFxuICAgIH0sXG4gICAgJ292ZXJ2aWV3Jzoge1xuICAgICAgICByZWxldmFuY2U6IDAuMzAsICAgIC8vIENyaXRpY2FsIC0gTXVzdCBwcm92aWRlIHZhbHVhYmxlIG92ZXJ2aWV3XG4gICAgICAgIGZyZXNobmVzczogMC4xNSwgICAgLy8gTWVkaXVtIC0gT3ZlcnZpZXdzIGNoYW5nZSBtb2RlcmF0ZWx5XG4gICAgICAgIGNsYXJpdHk6IDAuMzAsICAgICAgLy8gQ3JpdGljYWwgLSBNdXN0IGJlIGFjY2Vzc2libGUgdG8gbmV3Y29tZXJzXG4gICAgICAgIGFjY3VyYWN5OiAwLjE1LCAgICAgLy8gTWVkaXVtIC0gSGlnaC1sZXZlbCBhY2N1cmFjeSBpbXBvcnRhbnRcbiAgICAgICAgY29tcGxldGVuZXNzOiAwLjEwICAvLyBMb3dlciAtIEludGVudGlvbmFsbHkgaGlnaC1sZXZlbFxuICAgIH0sXG4gICAgJ3JlZmVyZW5jZSc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjE1LCAgICAvLyBMb3dlciAtIFJlZmVyZW5jZSBpcyBpbmhlcmVudGx5IHJlbGV2YW50XG4gICAgICAgIGZyZXNobmVzczogMC4yMCwgICAgLy8gSW1wb3J0YW50IC0gUmVmZXJlbmNlIGRhdGEgY2hhbmdlc1xuICAgICAgICBjbGFyaXR5OiAwLjIwLCAgICAgIC8vIEltcG9ydGFudCAtIE11c3QgYmUgc2Nhbm5hYmxlXG4gICAgICAgIGFjY3VyYWN5OiAwLjM1LCAgICAgLy8gQ3JpdGljYWwgLSBSZWZlcmVuY2UgbXVzdCBiZSBjb3JyZWN0XG4gICAgICAgIGNvbXBsZXRlbmVzczogMC4xMCAgLy8gTG93ZXIgLSBDYW4gYmUgY29tcHJlaGVuc2l2ZSBlbHNld2hlcmVcbiAgICB9LFxuICAgICd0cm91Ymxlc2hvb3RpbmcnOiB7XG4gICAgICAgIHJlbGV2YW5jZTogMC4yNSwgICAgLy8gSGlnaCAtIE11c3QgYWRkcmVzcyByZWFsIHByb2JsZW1zXG4gICAgICAgIGZyZXNobmVzczogMC4yMCwgICAgLy8gSW1wb3J0YW50IC0gU29sdXRpb25zIGV2b2x2ZVxuICAgICAgICBjbGFyaXR5OiAwLjI1LCAgICAgIC8vIEhpZ2ggLSBTb2x1dGlvbnMgbXVzdCBiZSBjbGVhclxuICAgICAgICBhY2N1cmFjeTogMC4yNSwgICAgIC8vIEhpZ2ggLSBXcm9uZyBzb2x1dGlvbnMgd2FzdGUgdGltZVxuICAgICAgICBjb21wbGV0ZW5lc3M6IDAuMDUgIC8vIExvd2VyIC0gQ2FuIGZvY3VzIG9uIHNwZWNpZmljIGlzc3Vlc1xuICAgIH0sXG4gICAgJ2NoYW5nZWxvZyc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjIwLCAgICAvLyBJbXBvcnRhbnQgLSBNdXN0IGJlIHJlbGV2YW50IHRvIHVzZXJzXG4gICAgICAgIGZyZXNobmVzczogMC4zNSwgICAgLy8gQ3JpdGljYWwgLSBNdXN0IGJlIGN1cnJlbnRcbiAgICAgICAgY2xhcml0eTogMC4yMCwgICAgICAvLyBJbXBvcnRhbnQgLSBDaGFuZ2VzIG11c3QgYmUgY2xlYXJcbiAgICAgICAgYWNjdXJhY3k6IDAuMjAsICAgICAvLyBJbXBvcnRhbnQgLSBNdXN0IGFjY3VyYXRlbHkgZGVzY3JpYmUgY2hhbmdlc1xuICAgICAgICBjb21wbGV0ZW5lc3M6IDAuMDUgIC8vIExvd2VyIC0gQ2FuIGJlIGluY3JlbWVudGFsXG4gICAgfSxcbiAgICAnbWl4ZWQnOiB7XG4gICAgICAgIHJlbGV2YW5jZTogMC4yMCwgICAgLy8gQmFsYW5jZWQgYXBwcm9hY2ggZm9yIG1peGVkIGNvbnRlbnRcbiAgICAgICAgZnJlc2huZXNzOiAwLjIwLFxuICAgICAgICBjbGFyaXR5OiAwLjI1LFxuICAgICAgICBhY2N1cmFjeTogMC4yNSxcbiAgICAgICAgY29tcGxldGVuZXNzOiAwLjEwXG4gICAgfVxufTtcblxuaW50ZXJmYWNlIERpbWVuc2lvblJlc3VsdCB7XG4gICAgZGltZW5zaW9uOiBEaW1lbnNpb25UeXBlO1xuICAgIHNjb3JlOiBudW1iZXIgfCBudWxsO1xuICAgIG9yaWdpbmFsU2NvcmU/OiBudW1iZXI7ICAvLyBTdG9yZSBvcmlnaW5hbCBzY29yZSBiZWZvcmUgd2VpZ2h0aW5nXG4gICAgY29udGVudFR5cGVXZWlnaHQ/OiBudW1iZXI7ICAvLyBXZWlnaHQgYXBwbGllZCBmb3IgdGhpcyBjb250ZW50IHR5cGVcbiAgICBjb250ZW50VHlwZT86IERvY3VtZW50YXRpb25UeXBlOyAgLy8gQ29udGVudCB0eXBlIHVzZWQgZm9yIHdlaWdodGluZ1xuICAgIHN0YXR1czogJ2NvbXBsZXRlJyB8ICdmYWlsZWQnIHwgJ3RpbWVvdXQnIHwgJ3JldHJ5aW5nJztcbiAgICBmaW5kaW5nczogc3RyaW5nW107XG4gICAgcmVjb21tZW5kYXRpb25zOiBSZWNvbW1lbmRhdGlvbltdO1xuICAgIGZhaWx1cmVSZWFzb24/OiBzdHJpbmc7XG4gICAgcmV0cnlDb3VudDogbnVtYmVyO1xuICAgIHByb2Nlc3NpbmdUaW1lOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBSZWNvbW1lbmRhdGlvbiB7XG4gICAgcHJpb3JpdHk6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG4gICAgYWN0aW9uOiBzdHJpbmc7XG4gICAgbG9jYXRpb24/OiBzdHJpbmc7XG4gICAgaW1wYWN0OiBzdHJpbmc7XG4gICAgY29kZUV4YW1wbGU/OiBzdHJpbmc7XG4gICAgbWVkaWFSZWZlcmVuY2U/OiBzdHJpbmc7XG59XG5cbmNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuY29uc3QgYmVkcm9ja0NsaWVudCA9IG5ldyBCZWRyb2NrUnVudGltZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuY29uc3QgRElNRU5TSU9OUzogRGltZW5zaW9uVHlwZVtdID0gWydyZWxldmFuY2UnLCAnZnJlc2huZXNzJywgJ2NsYXJpdHknLCAnYWNjdXJhY3knLCAnY29tcGxldGVuZXNzJ107XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPGFueSwgRGltZW5zaW9uQW5hbHl6ZXJSZXNwb25zZT4gPSBhc3luYyAoZXZlbnQpID0+IHtcbiAgICBjb25zb2xlLmxvZygnRGltZW5zaW9uIGFuYWx5emVyIHJlY2VpdmVkIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG5cbiAgICAvLyBFeHRyYWN0IG9yaWdpbmFsIHBhcmFtZXRlcnMgZnJvbSBTdGVwIEZ1bmN0aW9ucyBpbnB1dFxuICAgIGNvbnN0IHsgdXJsLCBzZWxlY3RlZE1vZGVsLCBzZXNzaW9uSWQsIGFuYWx5c2lzU3RhcnRUaW1lIH0gPSBldmVudDtcblxuICAgIGNvbnNvbGUubG9nKCdTdGFydGluZyBkaW1lbnNpb24gYW5hbHlzaXMgd2l0aCBtb2RlbDonLCBzZWxlY3RlZE1vZGVsKTtcblxuICAgIC8vIEluaXRpYWxpemUgcHJvZ3Jlc3MgcHVibGlzaGVyXG4gICAgY29uc3QgcHJvZ3Jlc3MgPSBuZXcgUHJvZ3Jlc3NQdWJsaXNoZXIoc2Vzc2lvbklkKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQ7XG4gICAgICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBTkFMWVNJU19CVUNLRVQgZW52aXJvbm1lbnQgdmFyaWFibGUgbm90IHNldCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmV0cmlldmUgcHJvY2Vzc2VkIGNvbnRlbnQgZnJvbSBTM1xuICAgICAgICBjb25zdCBjb250ZW50S2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uYDtcbiAgICAgICAgY29uc3QgY29udGVudFJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBLZXk6IGNvbnRlbnRLZXlcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGNvbnN0IGNvbnRlbnRTdHIgPSBhd2FpdCBjb250ZW50UmVzcG9uc2UuQm9keSEudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgY29uc3QgcHJvY2Vzc2VkQ29udGVudCA9IEpTT04ucGFyc2UoY29udGVudFN0cik7XG5cbiAgICAgICAgY29uc29sZS5sb2coJ1JldHJpZXZlZCBwcm9jZXNzZWQgY29udGVudCBmcm9tIFMzJyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgY2FjaGluZyBpcyBlbmFibGVkIChkZWZhdWx0IHRvIHRydWUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkpXG4gICAgICAgIGNvbnN0IGNhY2hlRW5hYmxlZCA9IGV2ZW50LmNhY2hlQ29udHJvbD8uZW5hYmxlZCAhPT0gZmFsc2U7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgZGltZW5zaW9uIGFuYWx5c2lzIGlzIGFscmVhZHkgY2FjaGVkIChvbmx5IGlmIGNhY2hpbmcgaXMgZW5hYmxlZClcbiAgICAgICAgY29uc3QgY29udGV4dHVhbFNldHRpbmcgPSBwcm9jZXNzZWRDb250ZW50LmNvbnRleHRBbmFseXNpcz8uY29udGV4dFBhZ2VzPy5sZW5ndGggPiAwID8gJ3dpdGgtY29udGV4dCcgOiAnd2l0aG91dC1jb250ZXh0JztcbiAgICAgICAgbGV0IGNhY2hlZFJlc3VsdHMgPSBudWxsO1xuICAgICAgICBpZiAoY2FjaGVFbmFibGVkKSB7XG4gICAgICAgICAgICBjYWNoZWRSZXN1bHRzID0gYXdhaXQgY2hlY2tEaW1lbnNpb25DYWNoZShidWNrZXROYW1lLCBwcm9jZXNzZWRDb250ZW50LCBjb250ZXh0dWFsU2V0dGluZywgc2VsZWN0ZWRNb2RlbCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pqg77iPIENhY2hlIGRpc2FibGVkIGJ5IHVzZXIgLSBza2lwcGluZyBkaW1lbnNpb24gY2FjaGUgY2hlY2snKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjYWNoZWRSZXN1bHRzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIERpbWVuc2lvbiBhbmFseXNpcyBjYWNoZSBoaXQhIFVzaW5nIGNhY2hlZCByZXN1bHRzJyk7XG5cbiAgICAgICAgICAgIC8vIFNlbmQgY2FjaGUgaGl0IG1lc3NhZ2UgZm9yIGRpbWVuc2lvbnNcbiAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLmNhY2hlSGl0KCdSZXRyaWV2ZWQ6IDUvNSBkaW1lbnNpb25zIGZyb20gY2FjaGUnKTtcblxuICAgICAgICAgICAgLy8gU3RvcmUgY2FjaGVkIHJlc3VsdHMgaW4gc2Vzc2lvbiBsb2NhdGlvblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0c0tleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vZGltZW5zaW9uLXJlc3VsdHMuanNvbmA7XG4gICAgICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgS2V5OiByZXN1bHRzS2V5LFxuICAgICAgICAgICAgICAgIEJvZHk6IEpTT04uc3RyaW5naWZ5KGNhY2hlZFJlc3VsdHMpLFxuICAgICAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlc3Npb25JZDogc2Vzc2lvbklkLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBEaW1lbnNpb24gYW5hbHlzaXMgY29tcGxldGVkIHVzaW5nIGNhY2hlZCByZXN1bHRzICgke3NlbGVjdGVkTW9kZWx9KWBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZygn4p2MIERpbWVuc2lvbiBhbmFseXNpcyBjYWNoZSBtaXNzIC0gcnVubmluZyBmcmVzaCBhbmFseXNpcycpO1xuXG4gICAgICAgIC8vIFNlbmQgc3RydWN0dXJlIGRldGVjdGlvbiBjb21wbGV0ZSBtZXNzYWdlXG4gICAgICAgIGF3YWl0IHByb2dyZXNzLnN1Y2Nlc3MoJ1N0cnVjdHVyZSBkZXRlY3RlZDogVG9waWNzIGlkZW50aWZpZWQnLCB7XG4gICAgICAgICAgICBwaGFzZTogJ3N0cnVjdHVyZS1kZXRlY3Rpb24nXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFuYWx5emUgYWxsIGRpbWVuc2lvbnMgSU4gUEFSQUxMRUwgZm9yIHNwZWVkXG4gICAgICAgIGNvbnNvbGUubG9nKCdTdGFydGluZyBwYXJhbGxlbCBkaW1lbnNpb24gYW5hbHlzaXMuLi4nKTtcblxuICAgICAgICBjb25zdCBkaW1lbnNpb25Qcm9taXNlcyA9IERJTUVOU0lPTlMubWFwKGFzeW5jIChkaW1lbnNpb24sIGluZGV4KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFN0YXJ0aW5nICR7ZGltZW5zaW9ufSBhbmFseXNpc2ApO1xuXG4gICAgICAgICAgICAvLyBTZW5kIHByb2dyZXNzIG1lc3NhZ2UgZm9yIHRoaXMgZGltZW5zaW9uXG4gICAgICAgICAgICBhd2FpdCBwcm9ncmVzcy5wcm9ncmVzcyhgQW5hbHl6aW5nICR7ZGltZW5zaW9uLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgZGltZW5zaW9uLnNsaWNlKDEpfSAoJHtpbmRleCArIDF9LzUpLi4uYCwgJ2RpbWVuc2lvbi1hbmFseXNpcycsIHtcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGFuYWx5emVEaW1lbnNpb24oXG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbixcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2VkQ29udGVudCxcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRNb2RlbFxuICAgICAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBwcm9jZXNzaW5nVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYCR7ZGltZW5zaW9ufSBjb21wbGV0ZTogc2NvcmUgJHtyZXN1bHQuc2NvcmV9YCk7XG5cbiAgICAgICAgICAgICAgICAvLyBTZW5kIHN1Y2Nlc3MgbWVzc2FnZSB3aXRoIHNjb3JlXG4gICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2VzcyhgJHtkaW1lbnNpb24uY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBkaW1lbnNpb24uc2xpY2UoMSl9OiAke3Jlc3VsdC5zY29yZX0vMTAwICgkeyhwcm9jZXNzaW5nVGltZSAvIDEwMDApLnRvRml4ZWQoMSl9cylgLCB7XG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbixcbiAgICAgICAgICAgICAgICAgICAgc2NvcmU6IHJlc3VsdC5zY29yZSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NpbmdUaW1lXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb24sXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4ucmVzdWx0LFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1RpbWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYCR7ZGltZW5zaW9ufSBmYWlsZWQ6YCwgZXJyb3IpO1xuXG4gICAgICAgICAgICAgICAgLy8gU2VuZCBlcnJvciBtZXNzYWdlXG4gICAgICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuZXJyb3IoYCR7ZGltZW5zaW9uLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgZGltZW5zaW9uLnNsaWNlKDEpfSBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCwge1xuICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb25cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbixcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBzY29yZTogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgICAgICBmaW5kaW5nczogW10sXG4gICAgICAgICAgICAgICAgICAgICAgICByZWNvbW1lbmRhdGlvbnM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmFpbHVyZVJlYXNvbjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1RpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFdhaXQgZm9yIGFsbCBkaW1lbnNpb25zIHRvIGNvbXBsZXRlXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChkaW1lbnNpb25Qcm9taXNlcyk7XG5cbiAgICAgICAgLy8gQ29udmVydCBhcnJheSB0byByZWNvcmRcbiAgICAgICAgY29uc3QgZGltZW5zaW9uUmVzdWx0czogUmVjb3JkPERpbWVuc2lvblR5cGUsIERpbWVuc2lvblJlc3VsdD4gPSB7fSBhcyBhbnk7XG4gICAgICAgIHJlc3VsdHMuZm9yRWFjaCgoeyBkaW1lbnNpb24sIHJlc3VsdCB9KSA9PiB7XG4gICAgICAgICAgICBkaW1lbnNpb25SZXN1bHRzW2RpbWVuc2lvbl0gPSByZXN1bHQ7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFwcGx5IGNvbnRlbnQtdHlwZS1hd2FyZSBzY29yaW5nXG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcHJvY2Vzc2VkQ29udGVudC5jb250ZW50VHlwZSBhcyBEb2N1bWVudGF0aW9uVHlwZSB8fCAnbWl4ZWQnO1xuICAgICAgICBjb25zdCB3ZWlnaHRlZFJlc3VsdHMgPSBhcHBseUNvbnRlbnRUeXBlV2VpZ2h0cyhkaW1lbnNpb25SZXN1bHRzLCBjb250ZW50VHlwZSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYEFwcGxpZWQgY29udGVudC10eXBlLWF3YXJlIHdlaWdodHMgZm9yOiAke2NvbnRlbnRUeXBlfWApO1xuICAgICAgICBjb25zb2xlLmxvZygnQWxsIGRpbWVuc2lvbnMgYW5hbHl6ZWQgaW4gcGFyYWxsZWwnKTtcblxuICAgICAgICAvLyBTdG9yZSBkaW1lbnNpb24gcmVzdWx0cyBpbiBTMyBzZXNzaW9uIGxvY2F0aW9uXG4gICAgICAgIGNvbnN0IHJlc3VsdHNLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L2RpbWVuc2lvbi1yZXN1bHRzLmpzb25gO1xuICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogcmVzdWx0c0tleSxcbiAgICAgICAgICAgIEJvZHk6IEpTT04uc3RyaW5naWZ5KHdlaWdodGVkUmVzdWx0cyksXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBDYWNoZSB0aGUgcmVzdWx0cyBmb3IgZnV0dXJlIHVzZSAob25seSBpZiBjYWNoaW5nIGlzIGVuYWJsZWQpXG4gICAgICAgIGlmIChjYWNoZUVuYWJsZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IGNhY2hlRGltZW5zaW9uUmVzdWx0cyhidWNrZXROYW1lLCBwcm9jZXNzZWRDb250ZW50LCBjb250ZXh0dWFsU2V0dGluZywgc2VsZWN0ZWRNb2RlbCwgd2VpZ2h0ZWRSZXN1bHRzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfimqDvuI8gQ2FjaGUgZGlzYWJsZWQgLSBza2lwcGluZyBkaW1lbnNpb24gY2FjaGUgc3RvcmFnZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coJ0RpbWVuc2lvbiBhbmFseXNpcyBjb21wbGV0ZWQgYW5kIHN0b3JlZCBpbiBTMycpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBzZXNzaW9uSWQsXG4gICAgICAgICAgICBtZXNzYWdlOiBgRGltZW5zaW9uIGFuYWx5c2lzIGNvbXBsZXRlZCB1c2luZyAke3NlbGVjdGVkTW9kZWx9YFxuICAgICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRGltZW5zaW9uIGFuYWx5c2lzIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIHNlc3Npb25JZDogc2Vzc2lvbklkLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgfTtcbiAgICB9XG59O1xuXG4vKipcbiAqIEFwcGx5IGNvbnRlbnQtdHlwZS1hd2FyZSBzY29yaW5nIHdlaWdodHMgdG8gZGltZW5zaW9uIHJlc3VsdHNcbiAqIFRoaXMgZW5zdXJlcyBmYWlyIGNvbXBhcmlzb24gYWNyb3NzIGRpZmZlcmVudCBkb2N1bWVudCB0eXBlc1xuICovXG5mdW5jdGlvbiBhcHBseUNvbnRlbnRUeXBlV2VpZ2h0cyhcbiAgICBkaW1lbnNpb25SZXN1bHRzOiBSZWNvcmQ8RGltZW5zaW9uVHlwZSwgRGltZW5zaW9uUmVzdWx0PixcbiAgICBjb250ZW50VHlwZTogRG9jdW1lbnRhdGlvblR5cGVcbik6IFJlY29yZDxEaW1lbnNpb25UeXBlLCBEaW1lbnNpb25SZXN1bHQ+IHtcbiAgICBjb25zdCB3ZWlnaHRzID0gQ09OVEVOVF9UWVBFX1dFSUdIVFNbY29udGVudFR5cGVdO1xuICAgIGNvbnN0IHdlaWdodGVkUmVzdWx0cyA9IHsgLi4uZGltZW5zaW9uUmVzdWx0cyB9O1xuXG4gICAgLy8gQWRkIGNvbnRlbnQgdHlwZSBtZXRhZGF0YSB0byByZXN1bHRzXG4gICAgT2JqZWN0LmtleXMod2VpZ2h0ZWRSZXN1bHRzKS5mb3JFYWNoKGRpbWVuc2lvbiA9PiB7XG4gICAgICAgIGNvbnN0IGRpbSA9IGRpbWVuc2lvbiBhcyBEaW1lbnNpb25UeXBlO1xuICAgICAgICBjb25zdCByZXN1bHQgPSB3ZWlnaHRlZFJlc3VsdHNbZGltXTtcblxuICAgICAgICBpZiAocmVzdWx0LnNjb3JlICE9PSBudWxsKSB7XG4gICAgICAgICAgICAvLyBTdG9yZSBvcmlnaW5hbCBzY29yZSBhbmQgYWRkIHdlaWdodGVkIG1ldGFkYXRhXG4gICAgICAgICAgICByZXN1bHQub3JpZ2luYWxTY29yZSA9IHJlc3VsdC5zY29yZTtcbiAgICAgICAgICAgIHJlc3VsdC5jb250ZW50VHlwZVdlaWdodCA9IHdlaWdodHNbZGltXTtcbiAgICAgICAgICAgIHJlc3VsdC5jb250ZW50VHlwZSA9IGNvbnRlbnRUeXBlO1xuXG4gICAgICAgICAgICAvLyBBZGQgY29udGVudC10eXBlLXNwZWNpZmljIGNvbnRleHQgdG8gZmluZGluZ3NcbiAgICAgICAgICAgIHJlc3VsdC5maW5kaW5ncy51bnNoaWZ0KGBDb250ZW50IHR5cGU6ICR7Y29udGVudFR5cGV9ICh3ZWlnaHQ6ICR7TWF0aC5yb3VuZCh3ZWlnaHRzW2RpbV0gKiAxMDApfSUpYCk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnNvbGUubG9nKGBBcHBsaWVkIHdlaWdodHMgZm9yICR7Y29udGVudFR5cGV9OmAsIHdlaWdodHMpO1xuICAgIHJldHVybiB3ZWlnaHRlZFJlc3VsdHM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrRGltZW5zaW9uQ2FjaGUoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHByb2Nlc3NlZENvbnRlbnQ6IGFueSxcbiAgICBjb250ZXh0dWFsU2V0dGluZzogc3RyaW5nLFxuICAgIHNlbGVjdGVkTW9kZWw6IHN0cmluZ1xuKTogUHJvbWlzZTxSZWNvcmQ8RGltZW5zaW9uVHlwZSwgRGltZW5zaW9uUmVzdWx0PiB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSBwcm9jZXNzLmVudi5QUk9DRVNTRURfQ09OVEVOVF9UQUJMRTtcbiAgICAgICAgaWYgKCF0YWJsZU5hbWUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBjYWNoZSB0YWJsZSBjb25maWd1cmVkLCBza2lwcGluZyBkaW1lbnNpb24gY2FjaGUgY2hlY2snKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuXG4gICAgICAgIC8vIE5vcm1hbGl6ZSBVUkwgc2FtZSB3YXkgYXMgVVJMIHByb2Nlc3NvclxuICAgICAgICBjb25zdCBjbGVhblVybCA9IG5vcm1hbGl6ZVVybChwcm9jZXNzZWRDb250ZW50LnVybCk7XG5cbiAgICAgICAgLy8gTG9vayB1cCBjYWNoZSBlbnRyeSBpbiBEeW5hbW9EQlxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XG4gICAgICAgICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcbiAgICAgICAgICAgIEtleTogbWFyc2hhbGwoe1xuICAgICAgICAgICAgICAgIHVybDogY2xlYW5VcmwsXG4gICAgICAgICAgICAgICAgY29udGV4dHVhbFNldHRpbmc6IGNvbnRleHR1YWxTZXR0aW5nXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgaWYgKCFyZXNwb25zZS5JdGVtKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gY2FjaGUgZW50cnkgZm91bmQgZm9yIGRpbWVuc2lvbiBhbmFseXNpcycpO1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYWNoZUVudHJ5ID0gdW5tYXJzaGFsbChyZXNwb25zZS5JdGVtKTtcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kIGNhY2hlIGVudHJ5LCBjaGVja2luZyBmb3IgZGltZW5zaW9uIHJlc3VsdHMuLi5gKTtcblxuICAgICAgICAvLyBUaGUgczNMb2NhdGlvbiBub3cgcG9pbnRzIHRvIHNlc3Npb25zL3tjb25zaXN0ZW50U2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uXG4gICAgICAgIC8vIFdlIG5lZWQgdG8gY2hlY2sgZm9yIHNlc3Npb25zL3tjb25zaXN0ZW50U2Vzc2lvbklkfS9kaW1lbnNpb24tcmVzdWx0cy5qc29uXG4gICAgICAgIGNvbnN0IGNvbnRlbnRTM1BhdGggPSBjYWNoZUVudHJ5LnMzTG9jYXRpb247IC8vIGUuZy4sIHNlc3Npb25zL3Nlc3Npb24tYWJjMTIzL3Byb2Nlc3NlZC1jb250ZW50Lmpzb25cbiAgICAgICAgY29uc3Qgc2Vzc2lvblBhdGggPSBjb250ZW50UzNQYXRoLnJlcGxhY2UoJy9wcm9jZXNzZWQtY29udGVudC5qc29uJywgJycpOyAvLyBzZXNzaW9ucy9zZXNzaW9uLWFiYzEyM1xuICAgICAgICBjb25zdCBkaW1lbnNpb25TM1BhdGggPSBgJHtzZXNzaW9uUGF0aH0vZGltZW5zaW9uLXJlc3VsdHMuanNvbmA7XG5cbiAgICAgICAgLy8gVHJ5IHRvIHJldHJpZXZlIGRpbWVuc2lvbiByZXN1bHRzIGZyb20gUzNcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGRpbWVuc2lvblJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgICAgIEtleTogZGltZW5zaW9uUzNQYXRoXG4gICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGRpbWVuc2lvbkNvbnRlbnQgPSBhd2FpdCBkaW1lbnNpb25SZXNwb25zZS5Cb2R5IS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3QgZGltZW5zaW9uUmVzdWx0cyA9IEpTT04ucGFyc2UoZGltZW5zaW9uQ29udGVudCk7XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinIUgRm91bmQgY2FjaGVkIGRpbWVuc2lvbiByZXN1bHRzIGF0OiAke2RpbWVuc2lvblMzUGF0aH1gKTtcbiAgICAgICAgICAgIHJldHVybiBkaW1lbnNpb25SZXN1bHRzO1xuXG4gICAgICAgIH0gY2F0Y2ggKHMzRXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinYwgTm8gY2FjaGVkIGRpbWVuc2lvbiByZXN1bHRzIGZvdW5kIGF0OiAke2RpbWVuc2lvblMzUGF0aH1gKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBkaW1lbnNpb24gY2FjaGU6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNhY2hlRGltZW5zaW9uUmVzdWx0cyhcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJvY2Vzc2VkQ29udGVudDogYW55LFxuICAgIGNvbnRleHR1YWxTZXR0aW5nOiBzdHJpbmcsXG4gICAgc2VsZWN0ZWRNb2RlbDogc3RyaW5nLFxuICAgIGRpbWVuc2lvblJlc3VsdHM6IFJlY29yZDxEaW1lbnNpb25UeXBlLCBEaW1lbnNpb25SZXN1bHQ+XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgICAvLyBHZW5lcmF0ZSB0aGUgc2FtZSBjb25zaXN0ZW50IHNlc3Npb24gSUQgdGhhdCBVUkwgcHJvY2Vzc29yIHVzZXNcbiAgICAgICAgY29uc3QgY29uc2lzdGVudFNlc3Npb25JZCA9IGdlbmVyYXRlQ29uc2lzdGVudFNlc3Npb25JZChwcm9jZXNzZWRDb250ZW50LnVybCwgY29udGV4dHVhbFNldHRpbmcpO1xuXG4gICAgICAgIC8vIFN0b3JlIGRpbWVuc2lvbiByZXN1bHRzIGluIHRoZSBzYW1lIHNlc3Npb24gZm9sZGVyIGFzIHByb2Nlc3NlZCBjb250ZW50XG4gICAgICAgIGNvbnN0IGRpbWVuc2lvblMzUGF0aCA9IGBzZXNzaW9ucy8ke2NvbnNpc3RlbnRTZXNzaW9uSWR9L2RpbWVuc2lvbi1yZXN1bHRzLmpzb25gO1xuXG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBkaW1lbnNpb25TM1BhdGgsXG4gICAgICAgICAgICBCb2R5OiBKU09OLnN0cmluZ2lmeShkaW1lbnNpb25SZXN1bHRzKSxcbiAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgQ2FjaGVkIGRpbWVuc2lvbiByZXN1bHRzIGF0OiAke2RpbWVuc2lvblMzUGF0aH1gKTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBjYWNoZSBkaW1lbnNpb24gcmVzdWx0czonLCBlcnJvcik7XG4gICAgICAgIC8vIERvbid0IHRocm93IC0gY2FjaGluZyBmYWlsdXJlIHNob3VsZG4ndCBicmVhayB0aGUgbWFpbiBmbG93XG4gICAgfVxufVxuXG4vKipcbiAqIEdlbmVyYXRlIGNvbnNpc3RlbnQgc2Vzc2lvbiBJRCBiYXNlZCBvbiBVUkwgYW5kIGNvbnRleHQgc2V0dGluZ1xuICogTXVzdCBtYXRjaCB0aGUgZnVuY3Rpb24gaW4gVVJMIHByb2Nlc3NvciBleGFjdGx5XG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlQ29uc2lzdGVudFNlc3Npb25JZCh1cmw6IHN0cmluZywgY29udGV4dHVhbFNldHRpbmc6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFVybCA9IG5vcm1hbGl6ZVVybCh1cmwpO1xuICAgIGNvbnN0IGlucHV0ID0gYCR7bm9ybWFsaXplZFVybH0jJHtjb250ZXh0dWFsU2V0dGluZ31gO1xuICAgIGNvbnN0IGhhc2ggPSBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGlucHV0KS5kaWdlc3QoJ2hleCcpO1xuICAgIHJldHVybiBgc2Vzc2lvbi0ke2hhc2guc3Vic3RyaW5nKDAsIDEyKX1gO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVVcmwodXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwodXJsKTtcbiAgICAgICAgdXJsT2JqLmhhc2ggPSAnJztcbiAgICAgICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh1cmxPYmouc2VhcmNoKTtcbiAgICAgICAgY29uc3Qgc29ydGVkUGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcygpO1xuICAgICAgICBBcnJheS5mcm9tKHBhcmFtcy5rZXlzKCkpLnNvcnQoKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICBzb3J0ZWRQYXJhbXMuc2V0KGtleSwgcGFyYW1zLmdldChrZXkpIHx8ICcnKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHVybE9iai5zZWFyY2ggPSBzb3J0ZWRQYXJhbXMudG9TdHJpbmcoKTtcbiAgICAgICAgaWYgKHVybE9iai5wYXRobmFtZSAhPT0gJy8nICYmIHVybE9iai5wYXRobmFtZS5lbmRzV2l0aCgnLycpKSB7XG4gICAgICAgICAgICB1cmxPYmoucGF0aG5hbWUgPSB1cmxPYmoucGF0aG5hbWUuc2xpY2UoMCwgLTEpO1xuICAgICAgICB9XG4gICAgICAgIHVybE9iai5ob3N0bmFtZSA9IHVybE9iai5ob3N0bmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICByZXR1cm4gdXJsT2JqLnRvU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gbm9ybWFsaXplIFVSTCwgdXNpbmcgb3JpZ2luYWw6JywgdXJsKTtcbiAgICAgICAgcmV0dXJuIHVybDtcbiAgICB9XG59XG5hc3luYyBmdW5jdGlvbiBhbmFseXplRGltZW5zaW9uKFxuICAgIGRpbWVuc2lvbjogRGltZW5zaW9uVHlwZSxcbiAgICBwcm9jZXNzZWRDb250ZW50OiBhbnksXG4gICAgc2VsZWN0ZWRNb2RlbDogc3RyaW5nXG4pOiBQcm9taXNlPERpbWVuc2lvblJlc3VsdD4ge1xuICAgIGNvbnN0IHByb21wdCA9IGJ1aWxkUHJvbXB0Rm9yRGltZW5zaW9uKGRpbWVuc2lvbiwgcHJvY2Vzc2VkQ29udGVudCk7XG5cbiAgICBjb25zdCBtb2RlbElkID0gZ2V0TW9kZWxJZChzZWxlY3RlZE1vZGVsKTtcblxuICAgIC8vIERpZmZlcmVudCBtb2RlbHMgdXNlIGRpZmZlcmVudCBBUEkgZm9ybWF0c1xuICAgIGxldCByZXF1ZXN0Qm9keTogYW55O1xuICAgIGxldCByZXNwb25zZVBhcnNlcjogKHJlc3BvbnNlQm9keTogYW55KSA9PiBzdHJpbmc7XG5cbiAgICBpZiAoc2VsZWN0ZWRNb2RlbCA9PT0gJ2xsYW1hJykge1xuICAgICAgICAvLyBMbGFtYSB1c2VzIHRoZSBvbGRlciBwcm9tcHQgZm9ybWF0XG4gICAgICAgIHJlcXVlc3RCb2R5ID0ge1xuICAgICAgICAgICAgcHJvbXB0OiBwcm9tcHQsXG4gICAgICAgICAgICBtYXhfZ2VuX2xlbjogMjAwMCxcbiAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjEsXG4gICAgICAgICAgICB0b3BfcDogMC45XG4gICAgICAgIH07XG4gICAgICAgIHJlc3BvbnNlUGFyc2VyID0gKHJlc3BvbnNlQm9keSkgPT4gcmVzcG9uc2VCb2R5LmdlbmVyYXRpb247XG4gICAgfSBlbHNlIGlmIChzZWxlY3RlZE1vZGVsID09PSAndGl0YW4nKSB7XG4gICAgICAgIC8vIFRpdGFuIHVzZXMgdGV4dEdlbmVyYXRpb25Db25maWcgZm9ybWF0XG4gICAgICAgIHJlcXVlc3RCb2R5ID0ge1xuICAgICAgICAgICAgaW5wdXRUZXh0OiBwcm9tcHQsXG4gICAgICAgICAgICB0ZXh0R2VuZXJhdGlvbkNvbmZpZzoge1xuICAgICAgICAgICAgICAgIG1heFRva2VuQ291bnQ6IDIwMDAsXG4gICAgICAgICAgICAgICAgdGVtcGVyYXR1cmU6IDAuMSxcbiAgICAgICAgICAgICAgICB0b3BQOiAwLjlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgcmVzcG9uc2VQYXJzZXIgPSAocmVzcG9uc2VCb2R5KSA9PiByZXNwb25zZUJvZHkucmVzdWx0c1swXS5vdXRwdXRUZXh0O1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENsYXVkZSB1c2VzIE1lc3NhZ2VzIEFQSSBmb3JtYXRcbiAgICAgICAgcmVxdWVzdEJvZHkgPSB7XG4gICAgICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogXCJiZWRyb2NrLTIwMjMtMDUtMzFcIixcbiAgICAgICAgICAgIG1heF90b2tlbnM6IDIwMDAsXG4gICAgICAgICAgICB0ZW1wZXJhdHVyZTogMC4xLFxuICAgICAgICAgICAgbWVzc2FnZXM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwcm9tcHRcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG4gICAgICAgIHJlc3BvbnNlUGFyc2VyID0gKHJlc3BvbnNlQm9keSkgPT4gcmVzcG9uc2VCb2R5LmNvbnRlbnRbMF0udGV4dDtcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZU1vZGVsQ29tbWFuZCh7XG4gICAgICAgIG1vZGVsSWQsXG4gICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgIGFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0Qm9keSlcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYmVkcm9ja0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLmJvZHkpKTtcblxuICAgIGNvbnN0IHRleHRDb250ZW50ID0gcmVzcG9uc2VQYXJzZXIocmVzcG9uc2VCb2R5KTtcblxuICAgIC8vIFBhcnNlIEpTT04gZnJvbSB0aGUgcmVzcG9uc2VcbiAgICBjb25zdCBqc29uTWF0Y2ggPSB0ZXh0Q29udGVudC5tYXRjaCgvXFx7W1xcc1xcU10qXFx9Lyk7XG4gICAgaWYgKCFqc29uTWF0Y2gpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBKU09OIGZvdW5kIGluIEFJIHJlc3BvbnNlJyk7XG4gICAgfVxuXG4gICAgY29uc3QgYW5hbHlzaXMgPSBKU09OLnBhcnNlKGpzb25NYXRjaFswXSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBkaW1lbnNpb24sXG4gICAgICAgIHNjb3JlOiBhbmFseXNpcy5zY29yZSxcbiAgICAgICAgc3RhdHVzOiAnY29tcGxldGUnLFxuICAgICAgICBmaW5kaW5nczogYW5hbHlzaXMuZmluZGluZ3MgfHwgW10sXG4gICAgICAgIHJlY29tbWVuZGF0aW9uczogYW5hbHlzaXMucmVjb21tZW5kYXRpb25zIHx8IFtdLFxuICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICBwcm9jZXNzaW5nVGltZTogMCAvLyBXaWxsIGJlIHNldCBieSBjYWxsZXJcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBidWlsZFByb21wdEZvckRpbWVuc2lvbihkaW1lbnNpb246IERpbWVuc2lvblR5cGUsIHByb2Nlc3NlZENvbnRlbnQ6IGFueSk6IHN0cmluZyB7XG4gICAgY29uc3QgY29udGVudFR5cGUgPSBwcm9jZXNzZWRDb250ZW50LmNvbnRlbnRUeXBlIGFzIERvY3VtZW50YXRpb25UeXBlIHx8ICdtaXhlZCc7XG4gICAgY29uc3Qgd2VpZ2h0cyA9IENPTlRFTlRfVFlQRV9XRUlHSFRTW2NvbnRlbnRUeXBlXTtcblxuICAgIGNvbnN0IGJhc2VDb250ZXh0ID0gYFxuVVJMOiAke3Byb2Nlc3NlZENvbnRlbnQudXJsfVxuQ29udGVudCBUeXBlOiAke2NvbnRlbnRUeXBlfSAoJHtkaW1lbnNpb259IHdlaWdodDogJHtNYXRoLnJvdW5kKHdlaWdodHNbZGltZW5zaW9uXSAqIDEwMCl9JSlcbkNvZGUgU25pcHBldHM6ICR7cHJvY2Vzc2VkQ29udGVudC5jb2RlU25pcHBldHM/Lmxlbmd0aCB8fCAwfVxuTWVkaWEgRWxlbWVudHM6ICR7cHJvY2Vzc2VkQ29udGVudC5tZWRpYUVsZW1lbnRzPy5sZW5ndGggfHwgMH1cblRvdGFsIExpbmtzOiAke3Byb2Nlc3NlZENvbnRlbnQubGlua0FuYWx5c2lzPy50b3RhbExpbmtzIHx8IDB9XG5cbkNvbnRlbnQgKGZpcnN0IDMwMDAgY2hhcnMpOlxuJHtwcm9jZXNzZWRDb250ZW50Lm1hcmtkb3duQ29udGVudD8uc2xpY2UoMCwgMzAwMCkgfHwgJyd9XG5gO1xuXG4gICAgLy8gQWRkIGNvbnRleHQgYW5hbHlzaXMgaW5mb3JtYXRpb24gaWYgYXZhaWxhYmxlXG4gICAgbGV0IGNvbnRleHRJbmZvID0gJyc7XG4gICAgaWYgKHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzICYmIHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzLmNvbnRleHRQYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnRleHRJbmZvID0gYFxuQ09OVEVYVCBBTkFMWVNJUyBFTkFCTEVEOlxuQW5hbHlzaXMgU2NvcGU6ICR7cHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMuYW5hbHlzaXNTY29wZX1cblRvdGFsIFBhZ2VzIEFuYWx5emVkOiAke3Byb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzLnRvdGFsUGFnZXNBbmFseXplZH1cblJlbGF0ZWQgUGFnZXMgRGlzY292ZXJlZDpcbiR7cHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMuY29udGV4dFBhZ2VzLm1hcCgocGFnZTogYW55KSA9PlxuICAgICAgICAgICAgYC0gJHtwYWdlLnJlbGF0aW9uc2hpcC50b1VwcGVyQ2FzZSgpfTogJHtwYWdlLnRpdGxlfSAoY29uZmlkZW5jZTogJHtNYXRoLnJvdW5kKHBhZ2UuY29uZmlkZW5jZSAqIDEwMCl9JSlgXG4gICAgICAgICkuam9pbignXFxuJyl9XG5cbklNUE9SVEFOVDogQ29uc2lkZXIgdGhpcyBicm9hZGVyIGRvY3VtZW50YXRpb24gY29udGV4dCB3aGVuIGV2YWx1YXRpbmcgdGhlIHRhcmdldCBwYWdlLiBcblRoZSB0YXJnZXQgcGFnZSBpcyBwYXJ0IG9mIGEgbGFyZ2VyIGRvY3VtZW50YXRpb24gc3RydWN0dXJlLCBzbyBldmFsdWF0ZSBob3cgd2VsbCBpdCBmaXRzIFxud2l0aGluIHRoaXMgY29udGV4dCBhbmQgd2hldGhlciBpdCBwcm9wZXJseSByZWZlcmVuY2VzIG9yIGJ1aWxkcyB1cG9uIHJlbGF0ZWQgcGFnZXMuXG5gO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRleHRJbmZvID0gYFxuQ09OVEVYVCBBTkFMWVNJUzogU2luZ2xlIHBhZ2UgYW5hbHlzaXMgKG5vIHJlbGF0ZWQgcGFnZXMgZGlzY292ZXJlZClcbmA7XG4gICAgfVxuXG4gICAgLy8gQ29udGVudC10eXBlLXNwZWNpZmljIGV2YWx1YXRpb24gY3JpdGVyaWFcbiAgICBjb25zdCBjb250ZW50VHlwZUd1aWRhbmNlID0gZ2V0Q29udGVudFR5cGVHdWlkYW5jZShjb250ZW50VHlwZSwgZGltZW5zaW9uKTtcblxuICAgIGNvbnN0IGRpbWVuc2lvblByb21wdHM6IFJlY29yZDxEaW1lbnNpb25UeXBlLCBzdHJpbmc+ID0ge1xuICAgICAgICByZWxldmFuY2U6IGBBbmFseXplIHRoZSBSRUxFVkFOQ0Ugb2YgdGhpcyBXb3JkUHJlc3MgZGV2ZWxvcGVyIGRvY3VtZW50YXRpb24uXG5cbiR7YmFzZUNvbnRleHR9XG4ke2NvbnRleHRJbmZvfVxuXG5DT05URU5UIFRZUEUgU1BFQ0lGSUMgR1VJREFOQ0U6XG4ke2NvbnRlbnRUeXBlR3VpZGFuY2V9XG5cbkV2YWx1YXRlOlxuMS4gSXMgdGhlIGNvbnRlbnQgcmVsZXZhbnQgdG8gV29yZFByZXNzIGRldmVsb3BlcnM/XG4yLiBBcmUgZXhhbXBsZXMgcHJhY3RpY2FsIGFuZCBhcHBsaWNhYmxlP1xuMy4gRG9lcyBpdCBhZGRyZXNzIHJlYWwgZGV2ZWxvcGVyIG5lZWRzP1xuNC4gSXMgdGhlIHNjb3BlIGFwcHJvcHJpYXRlIGZvciB0aGUgdG9waWM/XG41LiBJZiBjb250ZXh0IHBhZ2VzIGFyZSBhdmFpbGFibGUsIGRvZXMgdGhpcyBwYWdlIGZpdCB3ZWxsIHdpdGhpbiB0aGUgYnJvYWRlciBkb2N1bWVudGF0aW9uIHN0cnVjdHVyZT9cblxuUmVzcG9uZCBpbiBKU09OIGZvcm1hdDpcbntcbiAgXCJzY29yZVwiOiAwLTEwMCxcbiAgXCJmaW5kaW5nc1wiOiBbXCJmaW5kaW5nIDFcIiwgXCJmaW5kaW5nIDJcIl0sXG4gIFwicmVjb21tZW5kYXRpb25zXCI6IFtcbiAgICB7XG4gICAgICBcInByaW9yaXR5XCI6IFwiaGlnaHxtZWRpdW18bG93XCIsXG4gICAgICBcImFjdGlvblwiOiBcInNwZWNpZmljIGFjdGlvblwiLFxuICAgICAgXCJpbXBhY3RcIjogXCJleHBlY3RlZCBpbXBhY3RcIlxuICAgIH1cbiAgXVxufWAsXG5cbiAgICAgICAgZnJlc2huZXNzOiBgQW5hbHl6ZSB0aGUgRlJFU0hORVNTIG9mIHRoaXMgV29yZFByZXNzIGRldmVsb3BlciBkb2N1bWVudGF0aW9uLlxuXG4ke2Jhc2VDb250ZXh0fVxuJHtjb250ZXh0SW5mb31cblxuQ09OVEVOVCBUWVBFIFNQRUNJRklDIEdVSURBTkNFOlxuJHtjb250ZW50VHlwZUd1aWRhbmNlfVxuXG5Db2RlIFNuaXBwZXRzIHdpdGggVmVyc2lvbiBJbmZvOlxuJHtwcm9jZXNzZWRDb250ZW50LmNvZGVTbmlwcGV0cz8uZmlsdGVyKChzOiBhbnkpID0+IHMuaGFzVmVyc2lvbkluZm8pLm1hcCgoczogYW55KSA9PiBzLmNvZGUuc2xpY2UoMCwgMjAwKSkuam9pbignXFxuLS0tXFxuJykgfHwgJ05vbmUnfVxuXG5FdmFsdWF0ZTpcbjEuIEFyZSBXb3JkUHJlc3MgdmVyc2lvbiByZWZlcmVuY2VzIGN1cnJlbnQgKDYuNCspP1xuMi4gQXJlIGNvZGUgZXhhbXBsZXMgdXNpbmcgbW9kZXJuIHByYWN0aWNlcz9cbjMuIEFyZSBkZXByZWNhdGVkIGZlYXR1cmVzIGZsYWdnZWQ/XG40LiBJcyB0aGUgY29udGVudCB1cC10by1kYXRlP1xuNS4gSWYgY29udGV4dCBwYWdlcyBhcmUgYXZhaWxhYmxlLCBjb25zaWRlciB3aGV0aGVyIHRoaXMgcGFnZSdzIHZlcnNpb24gaW5mb3JtYXRpb24gaXMgY29uc2lzdGVudCB3aXRoIHJlbGF0ZWQgcGFnZXMuXG5cblJlc3BvbmQgaW4gSlNPTiBmb3JtYXQ6XG57XG4gIFwic2NvcmVcIjogMC0xMDAsXG4gIFwiZmluZGluZ3NcIjogW1wiZmluZGluZyAxXCIsIFwiZmluZGluZyAyXCJdLFxuICBcInJlY29tbWVuZGF0aW9uc1wiOiBbXG4gICAge1xuICAgICAgXCJwcmlvcml0eVwiOiBcImhpZ2h8bWVkaXVtfGxvd1wiLFxuICAgICAgXCJhY3Rpb25cIjogXCJzcGVjaWZpYyBhY3Rpb25cIixcbiAgICAgIFwiaW1wYWN0XCI6IFwiZXhwZWN0ZWQgaW1wYWN0XCJcbiAgICB9XG4gIF1cbn1gLFxuXG4gICAgICAgIGNsYXJpdHk6IGBBbmFseXplIHRoZSBDTEFSSVRZIG9mIHRoaXMgV29yZFByZXNzIGRldmVsb3BlciBkb2N1bWVudGF0aW9uLlxuXG4ke2Jhc2VDb250ZXh0fVxuJHtjb250ZXh0SW5mb31cblxuQ09OVEVOVCBUWVBFIFNQRUNJRklDIEdVSURBTkNFOlxuJHtjb250ZW50VHlwZUd1aWRhbmNlfVxuXG5FdmFsdWF0ZTpcbjEuIElzIHRoZSBjb250ZW50IHdlbGwtc3RydWN0dXJlZCBhbmQgb3JnYW5pemVkP1xuMi4gQXJlIGV4cGxhbmF0aW9ucyBjbGVhciBhbmQgdW5kZXJzdGFuZGFibGU/XG4zLiBBcmUgY29kZSBleGFtcGxlcyB3ZWxsLWNvbW1lbnRlZD9cbjQuIElzIHRlY2huaWNhbCBqYXJnb24gZXhwbGFpbmVkP1xuNS4gSWYgY29udGV4dCBwYWdlcyBhcmUgYXZhaWxhYmxlLCBkb2VzIHRoaXMgcGFnZSBjbGVhcmx5IGV4cGxhaW4gaXRzIHJlbGF0aW9uc2hpcCB0byBwYXJlbnQvY2hpbGQvc2libGluZyBwYWdlcz9cblxuUmVzcG9uZCBpbiBKU09OIGZvcm1hdDpcbntcbiAgXCJzY29yZVwiOiAwLTEwMCxcbiAgXCJmaW5kaW5nc1wiOiBbXCJmaW5kaW5nIDFcIiwgXCJmaW5kaW5nIDJcIl0sXG4gIFwicmVjb21tZW5kYXRpb25zXCI6IFtcbiAgICB7XG4gICAgICBcInByaW9yaXR5XCI6IFwiaGlnaHxtZWRpdW18bG93XCIsXG4gICAgICBcImFjdGlvblwiOiBcInNwZWNpZmljIGFjdGlvblwiLFxuICAgICAgXCJpbXBhY3RcIjogXCJleHBlY3RlZCBpbXBhY3RcIlxuICAgIH1cbiAgXVxufWAsXG5cbiAgICAgICAgYWNjdXJhY3k6IGBBbmFseXplIHRoZSBBQ0NVUkFDWSBvZiB0aGlzIFdvcmRQcmVzcyBkZXZlbG9wZXIgZG9jdW1lbnRhdGlvbi5cblxuJHtiYXNlQ29udGV4dH1cbiR7Y29udGV4dEluZm99XG5cbkNPTlRFTlQgVFlQRSBTUEVDSUZJQyBHVUlEQU5DRTpcbiR7Y29udGVudFR5cGVHdWlkYW5jZX1cblxuQ29kZSBTbmlwcGV0czpcbiR7cHJvY2Vzc2VkQ29udGVudC5jb2RlU25pcHBldHM/Lm1hcCgoczogYW55KSA9PiBgTGFuZ3VhZ2U6ICR7cy5sYW5ndWFnZX1cXG4ke3MuY29kZS5zbGljZSgwLCAzMDApfWApLmpvaW4oJ1xcbi0tLVxcbicpIHx8ICdOb25lJ31cblxuRXZhbHVhdGU6XG4xLiBBcmUgY29kZSBleGFtcGxlcyBzeW50YWN0aWNhbGx5IGNvcnJlY3Q/XG4yLiBJcyBBUEkgdXNhZ2UgYWNjdXJhdGU/XG4zLiBBcmUgdGVjaG5pY2FsIGRldGFpbHMgY29ycmVjdD9cbjQuIEFyZSB0aGVyZSBhbnkgbWlzbGVhZGluZyBzdGF0ZW1lbnRzP1xuNS4gSWYgY29udGV4dCBwYWdlcyBhcmUgYXZhaWxhYmxlLCBpcyB0aGUgaW5mb3JtYXRpb24gY29uc2lzdGVudCB3aXRoIHJlbGF0ZWQgZG9jdW1lbnRhdGlvbj9cblxuUmVzcG9uZCBpbiBKU09OIGZvcm1hdDpcbntcbiAgXCJzY29yZVwiOiAwLTEwMCxcbiAgXCJmaW5kaW5nc1wiOiBbXCJmaW5kaW5nIDFcIiwgXCJmaW5kaW5nIDJcIl0sXG4gIFwicmVjb21tZW5kYXRpb25zXCI6IFtcbiAgICB7XG4gICAgICBcInByaW9yaXR5XCI6IFwiaGlnaHxtZWRpdW18bG93XCIsXG4gICAgICBcImFjdGlvblwiOiBcInNwZWNpZmljIGFjdGlvblwiLFxuICAgICAgXCJpbXBhY3RcIjogXCJleHBlY3RlZCBpbXBhY3RcIlxuICAgIH1cbiAgXVxufWAsXG5cbiAgICAgICAgY29tcGxldGVuZXNzOiBgQW5hbHl6ZSB0aGUgQ09NUExFVEVORVNTIG9mIHRoaXMgV29yZFByZXNzIGRldmVsb3BlciBkb2N1bWVudGF0aW9uLlxuXG4ke2Jhc2VDb250ZXh0fVxuJHtjb250ZXh0SW5mb31cblxuQ09OVEVOVCBUWVBFIFNQRUNJRklDIEdVSURBTkNFOlxuJHtjb250ZW50VHlwZUd1aWRhbmNlfVxuXG5TdWItcGFnZXMgUmVmZXJlbmNlZDogJHtwcm9jZXNzZWRDb250ZW50LmxpbmtBbmFseXNpcz8uc3ViUGFnZXNJZGVudGlmaWVkPy5qb2luKCcsICcpIHx8ICdOb25lJ31cblxuRXZhbHVhdGU6XG4xLiBEb2VzIGl0IGNvdmVyIHRoZSBtYWluIHRvcGljIHRob3JvdWdobHk/XG4yLiBBcmUgaW1wb3J0YW50IGRldGFpbHMgbWlzc2luZz9cbjMuIEFyZSBlZGdlIGNhc2VzIGFkZHJlc3NlZD9cbjQuIElzIGVycm9yIGhhbmRsaW5nIGRvY3VtZW50ZWQ/XG41LiBJZiBjb250ZXh0IHBhZ2VzIGFyZSBhdmFpbGFibGUsIGRvZXMgdGhpcyBwYWdlIHByb3Blcmx5IHJlZmVyZW5jZSBvciBsaW5rIHRvIHJlbGF0ZWQgaW5mb3JtYXRpb24gaW4gcGFyZW50L2NoaWxkL3NpYmxpbmcgcGFnZXM/XG5cblJlc3BvbmQgaW4gSlNPTiBmb3JtYXQ6XG57XG4gIFwic2NvcmVcIjogMC0xMDAsXG4gIFwiZmluZGluZ3NcIjogW1wiZmluZGluZyAxXCIsIFwiZmluZGluZyAyXCJdLFxuICBcInJlY29tbWVuZGF0aW9uc1wiOiBbXG4gICAge1xuICAgICAgXCJwcmlvcml0eVwiOiBcImhpZ2h8bWVkaXVtfGxvd1wiLFxuICAgICAgXCJhY3Rpb25cIjogXCJzcGVjaWZpYyBhY3Rpb25cIixcbiAgICAgIFwiaW1wYWN0XCI6IFwiZXhwZWN0ZWQgaW1wYWN0XCJcbiAgICB9XG4gIF1cbn1gXG4gICAgfTtcblxuICAgIHJldHVybiBkaW1lbnNpb25Qcm9tcHRzW2RpbWVuc2lvbl07XG59XG5cbi8qKlxuICogR2V0IGNvbnRlbnQtdHlwZS1zcGVjaWZpYyBldmFsdWF0aW9uIGd1aWRhbmNlIGZvciBlYWNoIGRpbWVuc2lvblxuICovXG5mdW5jdGlvbiBnZXRDb250ZW50VHlwZUd1aWRhbmNlKGNvbnRlbnRUeXBlOiBEb2N1bWVudGF0aW9uVHlwZSwgZGltZW5zaW9uOiBEaW1lbnNpb25UeXBlKTogc3RyaW5nIHtcbiAgICBjb25zdCBndWlkYW5jZTogUmVjb3JkPERvY3VtZW50YXRpb25UeXBlLCBSZWNvcmQ8RGltZW5zaW9uVHlwZSwgc3RyaW5nPj4gPSB7XG4gICAgICAgICdhcGktcmVmZXJlbmNlJzoge1xuICAgICAgICAgICAgcmVsZXZhbmNlOiAnQVBJIGRvY3Mgc2hvdWxkIGZvY3VzIG9uIHByYWN0aWNhbCBkZXZlbG9wZXIgbmVlZHMuIExvd2VyIHdlaWdodCAoMTUlKSAtIGluaGVyZW50bHkgcmVsZXZhbnQuJyxcbiAgICAgICAgICAgIGZyZXNobmVzczogJ0NyaXRpY2FsIGZvciBBUEkgZG9jcyAoMjUlIHdlaWdodCkgLSBBUElzIGNoYW5nZSBmcmVxdWVudGx5LiBDaGVjayBmb3IgY3VycmVudCBXb3JkUHJlc3MgdmVyc2lvbnMuJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gZGV2ZWxvcGVycyBuZWVkIGNsZWFyIHBhcmFtZXRlciBkZXNjcmlwdGlvbnMgYW5kIHJldHVybiB2YWx1ZXMuJyxcbiAgICAgICAgICAgIGFjY3VyYWN5OiAnQ1JJVElDQUwgKDMwJSB3ZWlnaHQpIC0gd3JvbmcgQVBJIGluZm8gYnJlYWtzIGRldmVsb3BlciBjb2RlLiBWZXJpZnkgc3ludGF4IGFuZCBwYXJhbWV0ZXJzLicsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6ICdMb3dlciBwcmlvcml0eSAoMTAlIHdlaWdodCkgLSBjYW4gbGluayB0byBleGFtcGxlcyBlbHNld2hlcmUuIEZvY3VzIG9uIGNvcmUgQVBJIGluZm8uJ1xuICAgICAgICB9LFxuICAgICAgICAndHV0b3JpYWwnOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdNdXN0IHNvbHZlIHJlYWwgZGV2ZWxvcGVyIHByb2JsZW1zICgyMCUgd2VpZ2h0KS4gQ2hlY2sgaWYgZXhhbXBsZXMgYXJlIHByYWN0aWNhbC4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnSW1wb3J0YW50ICgyMCUgd2VpZ2h0KSAtIG91dGRhdGVkIHR1dG9yaWFscyBtaXNsZWFkIGxlYXJuZXJzLiBWZXJpZnkgY3VycmVudCBwcmFjdGljZXMuJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdDUklUSUNBTCAoMzAlIHdlaWdodCkgLSB0dXRvcmlhbHMgbXVzdCBiZSBlYXN5IHRvIGZvbGxvdyBzdGVwLWJ5LXN0ZXAuJyxcbiAgICAgICAgICAgIGFjY3VyYWN5OiAnSW1wb3J0YW50ICgyMCUgd2VpZ2h0KSAtIHdyb25nIHN0ZXBzIGJyZWFrIHRoZSBsZWFybmluZyBleHBlcmllbmNlLicsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6ICdMb3dlciBwcmlvcml0eSAoMTAlIHdlaWdodCkgLSBjYW4gZm9jdXMgb24gc3BlY2lmaWMgbGVhcm5pbmcgb2JqZWN0aXZlcy4nXG4gICAgICAgIH0sXG4gICAgICAgICdjb25jZXB0dWFsJzoge1xuICAgICAgICAgICAgcmVsZXZhbmNlOiAnSGlnaCBpbXBvcnRhbmNlICgyNSUgd2VpZ2h0KSAtIG11c3QgYWRkcmVzcyByZWFsIHVuZGVyc3RhbmRpbmcgbmVlZHMuJyxcbiAgICAgICAgICAgIGZyZXNobmVzczogJ0xvd2VyIHByaW9yaXR5ICgxMCUgd2VpZ2h0KSAtIGNvbmNlcHRzIGNoYW5nZSBzbG93bHksIGZvY3VzIG9uIHRpbWVsZXNzIHByaW5jaXBsZXMuJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdDUklUSUNBTCAoMzUlIHdlaWdodCkgLSBtdXN0IGV4cGxhaW4gY29tcGxleCBpZGVhcyBjbGVhcmx5IHRvIGRpdmVyc2UgYXVkaWVuY2VzLicsXG4gICAgICAgICAgICBhY2N1cmFjeTogJ0ltcG9ydGFudCAoMjAlIHdlaWdodCkgLSB3cm9uZyBjb25jZXB0cyBtaXNsZWFkIHVuZGVyc3RhbmRpbmcuJyxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogJ0xvd2VyIHByaW9yaXR5ICgxMCUgd2VpZ2h0KSAtIGNhbiBmb2N1cyBvbiBzcGVjaWZpYyBjb25jZXB0dWFsIGFzcGVjdHMuJ1xuICAgICAgICB9LFxuICAgICAgICAnaG93LXRvJzoge1xuICAgICAgICAgICAgcmVsZXZhbmNlOiAnSGlnaCBpbXBvcnRhbmNlICgyNSUgd2VpZ2h0KSAtIG11c3Qgc29sdmUgc3BlY2lmaWMsIHJlYWwgcHJvYmxlbXMuJyxcbiAgICAgICAgICAgIGZyZXNobmVzczogJ01lZGl1bSBwcmlvcml0eSAoMTUlIHdlaWdodCkgLSBtZXRob2RzIGV2b2x2ZSBidXQgbm90IGFzIHJhcGlkbHkgYXMgQVBJcy4nLFxuICAgICAgICAgICAgY2xhcml0eTogJ0hpZ2ggaW1wb3J0YW5jZSAoMjUlIHdlaWdodCkgLSBwcm9jZWR1cmFsIHN0ZXBzIG11c3QgYmUgY3J5c3RhbCBjbGVhci4nLFxuICAgICAgICAgICAgYWNjdXJhY3k6ICdIaWdoIGltcG9ydGFuY2UgKDI1JSB3ZWlnaHQpIC0gd3Jvbmcgc3RlcHMgYnJlYWsgd29ya2Zsb3dzIGFuZCB3YXN0ZSB0aW1lLicsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6ICdMb3dlciBwcmlvcml0eSAoMTAlIHdlaWdodCkgLSBjYW4gYmUgdGFzay1mb2N1c2VkIHJhdGhlciB0aGFuIGNvbXByZWhlbnNpdmUuJ1xuICAgICAgICB9LFxuICAgICAgICAnb3ZlcnZpZXcnOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdDUklUSUNBTCAoMzAlIHdlaWdodCkgLSBvdmVydmlld3MgbXVzdCBwcm92aWRlIHZhbHVhYmxlIGhpZ2gtbGV2ZWwgcGVyc3BlY3RpdmUuJyxcbiAgICAgICAgICAgIGZyZXNobmVzczogJ01lZGl1bSBwcmlvcml0eSAoMTUlIHdlaWdodCkgLSBvdmVydmlld3MgY2hhbmdlIG1vZGVyYXRlbHkgd2l0aCBlY29zeXN0ZW0gZXZvbHV0aW9uLicsXG4gICAgICAgICAgICBjbGFyaXR5OiAnQ1JJVElDQUwgKDMwJSB3ZWlnaHQpIC0gbXVzdCBiZSBhY2Nlc3NpYmxlIHRvIG5ld2NvbWVycyBhbmQgcHJvdmlkZSBjbGVhciBtZW50YWwgbW9kZWxzLicsXG4gICAgICAgICAgICBhY2N1cmFjeTogJ01lZGl1bSBwcmlvcml0eSAoMTUlIHdlaWdodCkgLSBoaWdoLWxldmVsIGFjY3VyYWN5IGltcG9ydGFudCBidXQgZGV0YWlscyBjYW4gYmUgZWxzZXdoZXJlLicsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6ICdMb3dlciBwcmlvcml0eSAoMTAlIHdlaWdodCkgLSBpbnRlbnRpb25hbGx5IGhpZ2gtbGV2ZWwsIGNvbXByZWhlbnNpdmUgZGV0YWlscyBlbHNld2hlcmUuJ1xuICAgICAgICB9LFxuICAgICAgICAncmVmZXJlbmNlJzoge1xuICAgICAgICAgICAgcmVsZXZhbmNlOiAnTG93ZXIgcHJpb3JpdHkgKDE1JSB3ZWlnaHQpIC0gcmVmZXJlbmNlIG1hdGVyaWFsIGlzIGluaGVyZW50bHkgcmVsZXZhbnQgdG8gaXRzIGRvbWFpbi4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnSW1wb3J0YW50ICgyMCUgd2VpZ2h0KSAtIHJlZmVyZW5jZSBkYXRhIG11c3QgYmUgY3VycmVudCBhbmQgYWNjdXJhdGUuJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gbXVzdCBiZSBzY2FubmFibGUgYW5kIHdlbGwtb3JnYW5pemVkIGZvciBxdWljayBsb29rdXAuJyxcbiAgICAgICAgICAgIGFjY3VyYWN5OiAnQ1JJVElDQUwgKDM1JSB3ZWlnaHQpIC0gcmVmZXJlbmNlIG1hdGVyaWFsIG11c3QgYmUgY29tcGxldGVseSBhY2N1cmF0ZS4nLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiAnTG93ZXIgcHJpb3JpdHkgKDEwJSB3ZWlnaHQpIC0gY2FuIGJlIGNvbXByZWhlbnNpdmUgaW4gc2NvcGUgZWxzZXdoZXJlLidcbiAgICAgICAgfSxcbiAgICAgICAgJ3Ryb3VibGVzaG9vdGluZyc6IHtcbiAgICAgICAgICAgIHJlbGV2YW5jZTogJ0hpZ2ggaW1wb3J0YW5jZSAoMjUlIHdlaWdodCkgLSBtdXN0IGFkZHJlc3MgcmVhbCwgY29tbW9uIHByb2JsZW1zIGRldmVsb3BlcnMgZmFjZS4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnSW1wb3J0YW50ICgyMCUgd2VpZ2h0KSAtIHNvbHV0aW9ucyBldm9sdmUgYXMgdGVjaG5vbG9neSBhbmQgYmVzdCBwcmFjdGljZXMgY2hhbmdlLicsXG4gICAgICAgICAgICBjbGFyaXR5OiAnSGlnaCBpbXBvcnRhbmNlICgyNSUgd2VpZ2h0KSAtIHByb2JsZW0gZGVzY3JpcHRpb25zIGFuZCBzb2x1dGlvbnMgbXVzdCBiZSBjbGVhci4nLFxuICAgICAgICAgICAgYWNjdXJhY3k6ICdIaWdoIGltcG9ydGFuY2UgKDI1JSB3ZWlnaHQpIC0gd3Jvbmcgc29sdXRpb25zIHdhc3RlIHNpZ25pZmljYW50IGRldmVsb3BlciB0aW1lLicsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6ICdMb3dlciBwcmlvcml0eSAoNSUgd2VpZ2h0KSAtIGNhbiBmb2N1cyBvbiBzcGVjaWZpYyBpc3N1ZXMgcmF0aGVyIHRoYW4gY29tcHJlaGVuc2l2ZSBjb3ZlcmFnZS4nXG4gICAgICAgIH0sXG4gICAgICAgICdjaGFuZ2Vsb2cnOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gY2hhbmdlcyBtdXN0IGJlIHJlbGV2YW50IHRvIHRoZSB0YXJnZXQgYXVkaWVuY2UuJyxcbiAgICAgICAgICAgIGZyZXNobmVzczogJ0NSSVRJQ0FMICgzNSUgd2VpZ2h0KSAtIGNoYW5nZWxvZ3MgbXVzdCBiZSBjdXJyZW50IGFuZCB1cC10by1kYXRlLicsXG4gICAgICAgICAgICBjbGFyaXR5OiAnSW1wb3J0YW50ICgyMCUgd2VpZ2h0KSAtIGNoYW5nZXMgbXVzdCBiZSBjbGVhcmx5IGRlc2NyaWJlZCBhbmQgY2F0ZWdvcml6ZWQuJyxcbiAgICAgICAgICAgIGFjY3VyYWN5OiAnSW1wb3J0YW50ICgyMCUgd2VpZ2h0KSAtIG11c3QgYWNjdXJhdGVseSBkZXNjcmliZSB3aGF0IGNoYW5nZWQuJyxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogJ0xvd2VyIHByaW9yaXR5ICg1JSB3ZWlnaHQpIC0gY2FuIGJlIGluY3JlbWVudGFsLCBjb21wcmVoZW5zaXZlIGhpc3RvcnkgZWxzZXdoZXJlLidcbiAgICAgICAgfSxcbiAgICAgICAgJ21peGVkJzoge1xuICAgICAgICAgICAgcmVsZXZhbmNlOiAnQmFsYW5jZWQgYXBwcm9hY2ggKDIwJSB3ZWlnaHQpIC0gZXZhbHVhdGUgcmVsZXZhbmNlIGFjcm9zcyBhbGwgY29udGVudCB0eXBlcyBwcmVzZW50LicsXG4gICAgICAgICAgICBmcmVzaG5lc3M6ICdCYWxhbmNlZCBhcHByb2FjaCAoMjAlIHdlaWdodCkgLSBjb25zaWRlciBmcmVzaG5lc3MgbmVlZHMgb2YgZGlmZmVyZW50IGNvbnRlbnQgc2VjdGlvbnMuJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdIaWdoIGltcG9ydGFuY2UgKDI1JSB3ZWlnaHQpIC0gbWl4ZWQgY29udGVudCBlc3BlY2lhbGx5IG5lZWRzIGNsZWFyIG9yZ2FuaXphdGlvbi4nLFxuICAgICAgICAgICAgYWNjdXJhY3k6ICdIaWdoIGltcG9ydGFuY2UgKDI1JSB3ZWlnaHQpIC0gYWNjdXJhY3kgaW1wb3J0YW50IGFjcm9zcyBhbGwgY29udGVudCB0eXBlcy4nLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiAnTG93ZXIgcHJpb3JpdHkgKDEwJSB3ZWlnaHQpIC0gbWl4ZWQgY29udGVudCBjYW4gaGF2ZSB2YXJpZWQgY29tcGxldGVuZXNzIG5lZWRzLidcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gZ3VpZGFuY2VbY29udGVudFR5cGVdPy5bZGltZW5zaW9uXSB8fCAnQXBwbHkgc3RhbmRhcmQgZXZhbHVhdGlvbiBjcml0ZXJpYSBmb3IgdGhpcyBkaW1lbnNpb24uJztcbn1cblxuZnVuY3Rpb24gZ2V0TW9kZWxJZChzZWxlY3RlZE1vZGVsOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG1vZGVsTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICAnY2xhdWRlJzogJ3VzLmFudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0yMDI0MTAyMi12MjowJyxcbiAgICAgICAgJ3RpdGFuJzogJ2FtYXpvbi50aXRhbi10ZXh0LXByZW1pZXItdjE6MCcsXG4gICAgICAgICdsbGFtYSc6ICd1cy5tZXRhLmxsYW1hMy0xLTcwYi1pbnN0cnVjdC12MTowJywgIC8vIENyb3NzLXJlZ2lvbiBpbmZlcmVuY2UgcHJvZmlsZVxuICAgICAgICAnYXV0byc6ICd1cy5hbnRocm9waWMuY2xhdWRlLTMtNS1zb25uZXQtMjAyNDEwMjItdjI6MCdcbiAgICB9O1xuXG4gICAgcmV0dXJuIG1vZGVsTWFwW3NlbGVjdGVkTW9kZWxdIHx8IG1vZGVsTWFwWydjbGF1ZGUnXTtcbn0iXX0=