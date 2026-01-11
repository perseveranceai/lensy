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
const client_s3_1 = require("@aws-sdk/client-s3");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const crypto = __importStar(require("crypto"));
const progress_publisher_1 = require("./progress-publisher");
// Content-type-specific scoring weights (must sum to 1.0)
const CONTENT_TYPE_WEIGHTS = {
    'api-reference': {
        relevance: 0.15,
        freshness: 0.25,
        clarity: 0.20,
        accuracy: 0.30,
        completeness: 0.10 // Lower - Can link to examples elsewhere
    },
    'tutorial': {
        relevance: 0.20,
        freshness: 0.20,
        clarity: 0.30,
        accuracy: 0.20,
        completeness: 0.10 // Lower - Can be focused on specific tasks
    },
    'conceptual': {
        relevance: 0.25,
        freshness: 0.10,
        clarity: 0.35,
        accuracy: 0.20,
        completeness: 0.10 // Lower - Can focus on specific aspects
    },
    'how-to': {
        relevance: 0.25,
        freshness: 0.15,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.10 // Lower - Can be task-focused
    },
    'overview': {
        relevance: 0.30,
        freshness: 0.15,
        clarity: 0.30,
        accuracy: 0.15,
        completeness: 0.10 // Lower - Intentionally high-level
    },
    'reference': {
        relevance: 0.15,
        freshness: 0.20,
        clarity: 0.20,
        accuracy: 0.35,
        completeness: 0.10 // Lower - Can be comprehensive elsewhere
    },
    'troubleshooting': {
        relevance: 0.25,
        freshness: 0.20,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.05 // Lower - Can focus on specific issues
    },
    'changelog': {
        relevance: 0.20,
        freshness: 0.35,
        clarity: 0.20,
        accuracy: 0.20,
        completeness: 0.05 // Lower - Can be incremental
    },
    'mixed': {
        relevance: 0.20,
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
        'llama': 'us.meta.llama3-1-70b-instruct-v1:0',
        'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    };
    return modelMap[selectedModel] || modelMap['claude'];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLGtEQUFrRjtBQUNsRiw0RUFBMkY7QUFDM0YsOERBQTZHO0FBQzdHLDBEQUE4RDtBQUM5RCwrQ0FBaUM7QUFDakMsNkRBQXlEO0FBdUN6RCwwREFBMEQ7QUFDMUQsTUFBTSxvQkFBb0IsR0FBa0Q7SUFDeEUsZUFBZSxFQUFFO1FBQ2IsU0FBUyxFQUFFLElBQUk7UUFDZixTQUFTLEVBQUUsSUFBSTtRQUNmLE9BQU8sRUFBRSxJQUFJO1FBQ2IsUUFBUSxFQUFFLElBQUk7UUFDZCxZQUFZLEVBQUUsSUFBSSxDQUFFLHlDQUF5QztLQUNoRTtJQUNELFVBQVUsRUFBRTtRQUNSLFNBQVMsRUFBRSxJQUFJO1FBQ2YsU0FBUyxFQUFFLElBQUk7UUFDZixPQUFPLEVBQUUsSUFBSTtRQUNiLFFBQVEsRUFBRSxJQUFJO1FBQ2QsWUFBWSxFQUFFLElBQUksQ0FBRSwyQ0FBMkM7S0FDbEU7SUFDRCxZQUFZLEVBQUU7UUFDVixTQUFTLEVBQUUsSUFBSTtRQUNmLFNBQVMsRUFBRSxJQUFJO1FBQ2YsT0FBTyxFQUFFLElBQUk7UUFDYixRQUFRLEVBQUUsSUFBSTtRQUNkLFlBQVksRUFBRSxJQUFJLENBQUUsd0NBQXdDO0tBQy9EO0lBQ0QsUUFBUSxFQUFFO1FBQ04sU0FBUyxFQUFFLElBQUk7UUFDZixTQUFTLEVBQUUsSUFBSTtRQUNmLE9BQU8sRUFBRSxJQUFJO1FBQ2IsUUFBUSxFQUFFLElBQUk7UUFDZCxZQUFZLEVBQUUsSUFBSSxDQUFFLDhCQUE4QjtLQUNyRDtJQUNELFVBQVUsRUFBRTtRQUNSLFNBQVMsRUFBRSxJQUFJO1FBQ2YsU0FBUyxFQUFFLElBQUk7UUFDZixPQUFPLEVBQUUsSUFBSTtRQUNiLFFBQVEsRUFBRSxJQUFJO1FBQ2QsWUFBWSxFQUFFLElBQUksQ0FBRSxtQ0FBbUM7S0FDMUQ7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ZixTQUFTLEVBQUUsb0ZBQW9GO1lBQy9GLFNBQVMsRUFBRSxvRkFBb0Y7WUFDL0YsT0FBTyxFQUFFLGtGQUFrRjtZQUMzRixRQUFRLEVBQUUsa0ZBQWtGO1lBQzVGLFlBQVksRUFBRSwrRkFBK0Y7U0FDaEg7UUFDRCxXQUFXLEVBQUU7WUFDVCxTQUFTLEVBQUUsMkVBQTJFO1lBQ3RGLFNBQVMsRUFBRSxvRUFBb0U7WUFDL0UsT0FBTyxFQUFFLDZFQUE2RTtZQUN0RixRQUFRLEVBQUUsaUVBQWlFO1lBQzNFLFlBQVksRUFBRSxtRkFBbUY7U0FDcEc7UUFDRCxPQUFPLEVBQUU7WUFDTCxTQUFTLEVBQUUsdUZBQXVGO1lBQ2xHLFNBQVMsRUFBRSwwRkFBMEY7WUFDckcsT0FBTyxFQUFFLG1GQUFtRjtZQUM1RixRQUFRLEVBQUUsNkVBQTZFO1lBQ3ZGLFlBQVksRUFBRSxpRkFBaUY7U0FDbEc7S0FDSixDQUFDO0lBRUYsT0FBTyxRQUFRLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSx3REFBd0QsQ0FBQztBQUMxRyxDQUFDO0FBRUQsU0FBUyxVQUFVLENBQUMsYUFBcUI7SUFDckMsTUFBTSxRQUFRLEdBQTJCO1FBQ3JDLFFBQVEsRUFBRSw4Q0FBOEM7UUFDeEQsT0FBTyxFQUFFLGdDQUFnQztRQUN6QyxPQUFPLEVBQUUsb0NBQW9DO1FBQzdDLE1BQU0sRUFBRSw4Q0FBOEM7S0FDekQsQ0FBQztJQUVGLE9BQU8sUUFBUSxDQUFDLGFBQWEsQ0FBQyxJQUFJLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUN6RCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSGFuZGxlciB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQsIFB1dE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgQmVkcm9ja1J1bnRpbWVDbGllbnQsIEludm9rZU1vZGVsQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1iZWRyb2NrLXJ1bnRpbWUnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQsIEdldEl0ZW1Db21tYW5kLCBQdXRJdGVtQ29tbWFuZCwgVXBkYXRlSXRlbUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgbWFyc2hhbGwsIHVubWFyc2hhbGwgfSBmcm9tICdAYXdzLXNkay91dGlsLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgUHJvZ3Jlc3NQdWJsaXNoZXIgfSBmcm9tICcuL3Byb2dyZXNzLXB1Ymxpc2hlcic7XG5cbmludGVyZmFjZSBEaW1lbnNpb25BbmFseXplckV2ZW50IHtcbiAgICB1cmw6IHN0cmluZztcbiAgICBzZWxlY3RlZE1vZGVsOiBzdHJpbmc7XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgYW5hbHlzaXNTdGFydFRpbWU6IG51bWJlcjtcbiAgICBjYWNoZUNvbnRyb2w/OiB7XG4gICAgICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgfTtcbn1cblxuaW50ZXJmYWNlIERpbWVuc2lvbkFuYWx5emVyUmVzcG9uc2Uge1xuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG50eXBlIERvY3VtZW50YXRpb25UeXBlID1cbiAgICB8ICdhcGktcmVmZXJlbmNlJyAgICAgIC8vIEZ1bmN0aW9uL2NsYXNzIGRvY3MsIG5lZWRzIGNvZGVcbiAgICB8ICd0dXRvcmlhbCcgICAgICAgICAgIC8vIFN0ZXAtYnktc3RlcCBndWlkZSwgbmVlZHMgY29kZVxuICAgIHwgJ2NvbmNlcHR1YWwnICAgICAgICAgLy8gRXhwbGFpbnMgY29uY2VwdHMsIG1heSBub3QgbmVlZCBjb2RlXG4gICAgfCAnaG93LXRvJyAgICAgICAgICAgICAvLyBUYXNrLWZvY3VzZWQsIHVzdWFsbHkgbmVlZHMgY29kZVxuICAgIHwgJ3JlZmVyZW5jZScgICAgICAgICAgLy8gVGFibGVzLCBsaXN0cywgc3BlY3NcbiAgICB8ICd0cm91Ymxlc2hvb3RpbmcnICAgIC8vIFByb2JsZW0vc29sdXRpb24gZm9ybWF0XG4gICAgfCAnb3ZlcnZpZXcnICAgICAgICAgICAvLyBIaWdoLWxldmVsIGludHJvLCByYXJlbHkgbmVlZHMgY29kZVxuICAgIHwgJ2NoYW5nZWxvZycgICAgICAgICAgLy8gVmVyc2lvbiBoaXN0b3J5XG4gICAgfCAnbWl4ZWQnOyAgICAgICAgICAgICAvLyBDb21iaW5hdGlvblxuXG50eXBlIERpbWVuc2lvblR5cGUgPSAncmVsZXZhbmNlJyB8ICdmcmVzaG5lc3MnIHwgJ2NsYXJpdHknIHwgJ2FjY3VyYWN5JyB8ICdjb21wbGV0ZW5lc3MnO1xuXG5pbnRlcmZhY2UgQ29udGVudFR5cGVXZWlnaHRzIHtcbiAgICByZWxldmFuY2U6IG51bWJlcjtcbiAgICBmcmVzaG5lc3M6IG51bWJlcjtcbiAgICBjbGFyaXR5OiBudW1iZXI7XG4gICAgYWNjdXJhY3k6IG51bWJlcjtcbiAgICBjb21wbGV0ZW5lc3M6IG51bWJlcjtcbn1cblxuLy8gQ29udGVudC10eXBlLXNwZWNpZmljIHNjb3Jpbmcgd2VpZ2h0cyAobXVzdCBzdW0gdG8gMS4wKVxuY29uc3QgQ09OVEVOVF9UWVBFX1dFSUdIVFM6IFJlY29yZDxEb2N1bWVudGF0aW9uVHlwZSwgQ29udGVudFR5cGVXZWlnaHRzPiA9IHtcbiAgICAnYXBpLXJlZmVyZW5jZSc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjE1LCAgICAvLyBMb3dlciAtIEFQSSBkb2NzIGFyZSBpbmhlcmVudGx5IHJlbGV2YW50XG4gICAgICAgIGZyZXNobmVzczogMC4yNSwgICAgLy8gSGlnaCAtIEFQSSBjaGFuZ2VzIGZyZXF1ZW50bHlcbiAgICAgICAgY2xhcml0eTogMC4yMCwgICAgICAvLyBIaWdoIC0gTXVzdCBiZSBjbGVhciBmb3IgZGV2ZWxvcGVyc1xuICAgICAgICBhY2N1cmFjeTogMC4zMCwgICAgIC8vIENyaXRpY2FsIC0gV3JvbmcgQVBJIGluZm8gYnJlYWtzIGNvZGVcbiAgICAgICAgY29tcGxldGVuZXNzOiAwLjEwICAvLyBMb3dlciAtIENhbiBsaW5rIHRvIGV4YW1wbGVzIGVsc2V3aGVyZVxuICAgIH0sXG4gICAgJ3R1dG9yaWFsJzoge1xuICAgICAgICByZWxldmFuY2U6IDAuMjAsICAgIC8vIEltcG9ydGFudCAtIE11c3Qgc29sdmUgcmVhbCBwcm9ibGVtc1xuICAgICAgICBmcmVzaG5lc3M6IDAuMjAsICAgIC8vIEltcG9ydGFudCAtIE91dGRhdGVkIHR1dG9yaWFscyBtaXNsZWFkXG4gICAgICAgIGNsYXJpdHk6IDAuMzAsICAgICAgLy8gQ3JpdGljYWwgLSBNdXN0IGJlIGVhc3kgdG8gZm9sbG93XG4gICAgICAgIGFjY3VyYWN5OiAwLjIwLCAgICAgLy8gSW1wb3J0YW50IC0gV3Jvbmcgc3RlcHMgYnJlYWsgbGVhcm5pbmdcbiAgICAgICAgY29tcGxldGVuZXNzOiAwLjEwICAvLyBMb3dlciAtIENhbiBiZSBmb2N1c2VkIG9uIHNwZWNpZmljIHRhc2tzXG4gICAgfSxcbiAgICAnY29uY2VwdHVhbCc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjI1LCAgICAvLyBIaWdoIC0gTXVzdCBhZGRyZXNzIHJlYWwgdW5kZXJzdGFuZGluZyBuZWVkc1xuICAgICAgICBmcmVzaG5lc3M6IDAuMTAsICAgIC8vIExvd2VyIC0gQ29uY2VwdHMgY2hhbmdlIHNsb3dseVxuICAgICAgICBjbGFyaXR5OiAwLjM1LCAgICAgIC8vIENyaXRpY2FsIC0gTXVzdCBleHBsYWluIGNvbXBsZXggaWRlYXMgY2xlYXJseVxuICAgICAgICBhY2N1cmFjeTogMC4yMCwgICAgIC8vIEltcG9ydGFudCAtIFdyb25nIGNvbmNlcHRzIG1pc2xlYWRcbiAgICAgICAgY29tcGxldGVuZXNzOiAwLjEwICAvLyBMb3dlciAtIENhbiBmb2N1cyBvbiBzcGVjaWZpYyBhc3BlY3RzXG4gICAgfSxcbiAgICAnaG93LXRvJzoge1xuICAgICAgICByZWxldmFuY2U6IDAuMjUsICAgIC8vIEhpZ2ggLSBNdXN0IHNvbHZlIHNwZWNpZmljIHByb2JsZW1zXG4gICAgICAgIGZyZXNobmVzczogMC4xNSwgICAgLy8gTWVkaXVtIC0gTWV0aG9kcyBtYXkgZXZvbHZlXG4gICAgICAgIGNsYXJpdHk6IDAuMjUsICAgICAgLy8gSGlnaCAtIFN0ZXBzIG11c3QgYmUgY2xlYXJcbiAgICAgICAgYWNjdXJhY3k6IDAuMjUsICAgICAvLyBIaWdoIC0gV3Jvbmcgc3RlcHMgYnJlYWsgd29ya2Zsb3dzXG4gICAgICAgIGNvbXBsZXRlbmVzczogMC4xMCAgLy8gTG93ZXIgLSBDYW4gYmUgdGFzay1mb2N1c2VkXG4gICAgfSxcbiAgICAnb3ZlcnZpZXcnOiB7XG4gICAgICAgIHJlbGV2YW5jZTogMC4zMCwgICAgLy8gQ3JpdGljYWwgLSBNdXN0IHByb3ZpZGUgdmFsdWFibGUgb3ZlcnZpZXdcbiAgICAgICAgZnJlc2huZXNzOiAwLjE1LCAgICAvLyBNZWRpdW0gLSBPdmVydmlld3MgY2hhbmdlIG1vZGVyYXRlbHlcbiAgICAgICAgY2xhcml0eTogMC4zMCwgICAgICAvLyBDcml0aWNhbCAtIE11c3QgYmUgYWNjZXNzaWJsZSB0byBuZXdjb21lcnNcbiAgICAgICAgYWNjdXJhY3k6IDAuMTUsICAgICAvLyBNZWRpdW0gLSBIaWdoLWxldmVsIGFjY3VyYWN5IGltcG9ydGFudFxuICAgICAgICBjb21wbGV0ZW5lc3M6IDAuMTAgIC8vIExvd2VyIC0gSW50ZW50aW9uYWxseSBoaWdoLWxldmVsXG4gICAgfSxcbiAgICAncmVmZXJlbmNlJzoge1xuICAgICAgICByZWxldmFuY2U6IDAuMTUsICAgIC8vIExvd2VyIC0gUmVmZXJlbmNlIGlzIGluaGVyZW50bHkgcmVsZXZhbnRcbiAgICAgICAgZnJlc2huZXNzOiAwLjIwLCAgICAvLyBJbXBvcnRhbnQgLSBSZWZlcmVuY2UgZGF0YSBjaGFuZ2VzXG4gICAgICAgIGNsYXJpdHk6IDAuMjAsICAgICAgLy8gSW1wb3J0YW50IC0gTXVzdCBiZSBzY2FubmFibGVcbiAgICAgICAgYWNjdXJhY3k6IDAuMzUsICAgICAvLyBDcml0aWNhbCAtIFJlZmVyZW5jZSBtdXN0IGJlIGNvcnJlY3RcbiAgICAgICAgY29tcGxldGVuZXNzOiAwLjEwICAvLyBMb3dlciAtIENhbiBiZSBjb21wcmVoZW5zaXZlIGVsc2V3aGVyZVxuICAgIH0sXG4gICAgJ3Ryb3VibGVzaG9vdGluZyc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjI1LCAgICAvLyBIaWdoIC0gTXVzdCBhZGRyZXNzIHJlYWwgcHJvYmxlbXNcbiAgICAgICAgZnJlc2huZXNzOiAwLjIwLCAgICAvLyBJbXBvcnRhbnQgLSBTb2x1dGlvbnMgZXZvbHZlXG4gICAgICAgIGNsYXJpdHk6IDAuMjUsICAgICAgLy8gSGlnaCAtIFNvbHV0aW9ucyBtdXN0IGJlIGNsZWFyXG4gICAgICAgIGFjY3VyYWN5OiAwLjI1LCAgICAgLy8gSGlnaCAtIFdyb25nIHNvbHV0aW9ucyB3YXN0ZSB0aW1lXG4gICAgICAgIGNvbXBsZXRlbmVzczogMC4wNSAgLy8gTG93ZXIgLSBDYW4gZm9jdXMgb24gc3BlY2lmaWMgaXNzdWVzXG4gICAgfSxcbiAgICAnY2hhbmdlbG9nJzoge1xuICAgICAgICByZWxldmFuY2U6IDAuMjAsICAgIC8vIEltcG9ydGFudCAtIE11c3QgYmUgcmVsZXZhbnQgdG8gdXNlcnNcbiAgICAgICAgZnJlc2huZXNzOiAwLjM1LCAgICAvLyBDcml0aWNhbCAtIE11c3QgYmUgY3VycmVudFxuICAgICAgICBjbGFyaXR5OiAwLjIwLCAgICAgIC8vIEltcG9ydGFudCAtIENoYW5nZXMgbXVzdCBiZSBjbGVhclxuICAgICAgICBhY2N1cmFjeTogMC4yMCwgICAgIC8vIEltcG9ydGFudCAtIE11c3QgYWNjdXJhdGVseSBkZXNjcmliZSBjaGFuZ2VzXG4gICAgICAgIGNvbXBsZXRlbmVzczogMC4wNSAgLy8gTG93ZXIgLSBDYW4gYmUgaW5jcmVtZW50YWxcbiAgICB9LFxuICAgICdtaXhlZCc6IHtcbiAgICAgICAgcmVsZXZhbmNlOiAwLjIwLCAgICAvLyBCYWxhbmNlZCBhcHByb2FjaCBmb3IgbWl4ZWQgY29udGVudFxuICAgICAgICBmcmVzaG5lc3M6IDAuMjAsXG4gICAgICAgIGNsYXJpdHk6IDAuMjUsXG4gICAgICAgIGFjY3VyYWN5OiAwLjI1LFxuICAgICAgICBjb21wbGV0ZW5lc3M6IDAuMTBcbiAgICB9XG59O1xuXG5pbnRlcmZhY2UgRGltZW5zaW9uUmVzdWx0IHtcbiAgICBkaW1lbnNpb246IERpbWVuc2lvblR5cGU7XG4gICAgc2NvcmU6IG51bWJlciB8IG51bGw7XG4gICAgb3JpZ2luYWxTY29yZT86IG51bWJlcjsgIC8vIFN0b3JlIG9yaWdpbmFsIHNjb3JlIGJlZm9yZSB3ZWlnaHRpbmdcbiAgICBjb250ZW50VHlwZVdlaWdodD86IG51bWJlcjsgIC8vIFdlaWdodCBhcHBsaWVkIGZvciB0aGlzIGNvbnRlbnQgdHlwZVxuICAgIGNvbnRlbnRUeXBlPzogRG9jdW1lbnRhdGlvblR5cGU7ICAvLyBDb250ZW50IHR5cGUgdXNlZCBmb3Igd2VpZ2h0aW5nXG4gICAgc3RhdHVzOiAnY29tcGxldGUnIHwgJ2ZhaWxlZCcgfCAndGltZW91dCcgfCAncmV0cnlpbmcnO1xuICAgIGZpbmRpbmdzOiBzdHJpbmdbXTtcbiAgICByZWNvbW1lbmRhdGlvbnM6IFJlY29tbWVuZGF0aW9uW107XG4gICAgZmFpbHVyZVJlYXNvbj86IHN0cmluZztcbiAgICByZXRyeUNvdW50OiBudW1iZXI7XG4gICAgcHJvY2Vzc2luZ1RpbWU6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFJlY29tbWVuZGF0aW9uIHtcbiAgICBwcmlvcml0eTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JztcbiAgICBhY3Rpb246IHN0cmluZztcbiAgICBsb2NhdGlvbj86IHN0cmluZztcbiAgICBpbXBhY3Q6IHN0cmluZztcbiAgICBjb2RlRXhhbXBsZT86IHN0cmluZztcbiAgICBtZWRpYVJlZmVyZW5jZT86IHN0cmluZztcbn1cblxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5jb25zdCBiZWRyb2NrQ2xpZW50ID0gbmV3IEJlZHJvY2tSdW50aW1lQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuXG5jb25zdCBESU1FTlNJT05TOiBEaW1lbnNpb25UeXBlW10gPSBbJ3JlbGV2YW5jZScsICdmcmVzaG5lc3MnLCAnY2xhcml0eScsICdhY2N1cmFjeScsICdjb21wbGV0ZW5lc3MnXTtcblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8YW55LCBEaW1lbnNpb25BbmFseXplclJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xuICAgIGNvbnNvbGUubG9nKCdEaW1lbnNpb24gYW5hbHl6ZXIgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICAgIC8vIEV4dHJhY3Qgb3JpZ2luYWwgcGFyYW1ldGVycyBmcm9tIFN0ZXAgRnVuY3Rpb25zIGlucHV0XG4gICAgY29uc3QgeyB1cmwsIHNlbGVjdGVkTW9kZWwsIHNlc3Npb25JZCwgYW5hbHlzaXNTdGFydFRpbWUgfSA9IGV2ZW50O1xuXG4gICAgY29uc29sZS5sb2coJ1N0YXJ0aW5nIGRpbWVuc2lvbiBhbmFseXNpcyB3aXRoIG1vZGVsOicsIHNlbGVjdGVkTW9kZWwpO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBwcm9ncmVzcyBwdWJsaXNoZXJcbiAgICBjb25zdCBwcm9ncmVzcyA9IG5ldyBQcm9ncmVzc1B1Ymxpc2hlcihzZXNzaW9uSWQpO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYnVja2V0TmFtZSA9IHByb2Nlc3MuZW52LkFOQUxZU0lTX0JVQ0tFVDtcbiAgICAgICAgaWYgKCFidWNrZXROYW1lKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FOQUxZU0lTX0JVQ0tFVCBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXRyaWV2ZSBwcm9jZXNzZWQgY29udGVudCBmcm9tIFMzXG4gICAgICAgIGNvbnN0IGNvbnRlbnRLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L3Byb2Nlc3NlZC1jb250ZW50Lmpzb25gO1xuICAgICAgICBjb25zdCBjb250ZW50UmVzcG9uc2UgPSBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogY29udGVudEtleVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc3QgY29udGVudFN0ciA9IGF3YWl0IGNvbnRlbnRSZXNwb25zZS5Cb2R5IS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgICAgICBjb25zdCBwcm9jZXNzZWRDb250ZW50ID0gSlNPTi5wYXJzZShjb250ZW50U3RyKTtcblxuICAgICAgICBjb25zb2xlLmxvZygnUmV0cmlldmVkIHByb2Nlc3NlZCBjb250ZW50IGZyb20gUzMnKTtcblxuICAgICAgICAvLyBDaGVjayBpZiBjYWNoaW5nIGlzIGVuYWJsZWQgKGRlZmF1bHQgdG8gdHJ1ZSBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eSlcbiAgICAgICAgY29uc3QgY2FjaGVFbmFibGVkID0gZXZlbnQuY2FjaGVDb250cm9sPy5lbmFibGVkICE9PSBmYWxzZTtcblxuICAgICAgICAvLyBDaGVjayBpZiBkaW1lbnNpb24gYW5hbHlzaXMgaXMgYWxyZWFkeSBjYWNoZWQgKG9ubHkgaWYgY2FjaGluZyBpcyBlbmFibGVkKVxuICAgICAgICBjb25zdCBjb250ZXh0dWFsU2V0dGluZyA9IHByb2Nlc3NlZENvbnRlbnQuY29udGV4dEFuYWx5c2lzPy5jb250ZXh0UGFnZXM/Lmxlbmd0aCA+IDAgPyAnd2l0aC1jb250ZXh0JyA6ICd3aXRob3V0LWNvbnRleHQnO1xuICAgICAgICBsZXQgY2FjaGVkUmVzdWx0cyA9IG51bGw7XG4gICAgICAgIGlmIChjYWNoZUVuYWJsZWQpIHtcbiAgICAgICAgICAgIGNhY2hlZFJlc3VsdHMgPSBhd2FpdCBjaGVja0RpbWVuc2lvbkNhY2hlKGJ1Y2tldE5hbWUsIHByb2Nlc3NlZENvbnRlbnQsIGNvbnRleHR1YWxTZXR0aW5nLCBzZWxlY3RlZE1vZGVsKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfimqDvuI8gQ2FjaGUgZGlzYWJsZWQgYnkgdXNlciAtIHNraXBwaW5nIGRpbWVuc2lvbiBjYWNoZSBjaGVjaycpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNhY2hlZFJlc3VsdHMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgRGltZW5zaW9uIGFuYWx5c2lzIGNhY2hlIGhpdCEgVXNpbmcgY2FjaGVkIHJlc3VsdHMnKTtcblxuICAgICAgICAgICAgLy8gU2VuZCBjYWNoZSBoaXQgbWVzc2FnZSBmb3IgZGltZW5zaW9uc1xuICAgICAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuY2FjaGVIaXQoJ1JldHJpZXZlZDogNS81IGRpbWVuc2lvbnMgZnJvbSBjYWNoZScpO1xuXG4gICAgICAgICAgICAvLyBTdG9yZSBjYWNoZWQgcmVzdWx0cyBpbiBzZXNzaW9uIGxvY2F0aW9uXG4gICAgICAgICAgICBjb25zdCByZXN1bHRzS2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9kaW1lbnNpb24tcmVzdWx0cy5qc29uYDtcbiAgICAgICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgICAgICBLZXk6IHJlc3VsdHNLZXksXG4gICAgICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkoY2FjaGVkUmVzdWx0cyksXG4gICAgICAgICAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgc2Vzc2lvbklkOiBzZXNzaW9uSWQsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYERpbWVuc2lvbiBhbmFseXNpcyBjb21wbGV0ZWQgdXNpbmcgY2FjaGVkIHJlc3VsdHMgKCR7c2VsZWN0ZWRNb2RlbH0pYFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKCfinYwgRGltZW5zaW9uIGFuYWx5c2lzIGNhY2hlIG1pc3MgLSBydW5uaW5nIGZyZXNoIGFuYWx5c2lzJyk7XG5cbiAgICAgICAgLy8gU2VuZCBzdHJ1Y3R1cmUgZGV0ZWN0aW9uIGNvbXBsZXRlIG1lc3NhZ2VcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2VzcygnU3RydWN0dXJlIGRldGVjdGVkOiBUb3BpY3MgaWRlbnRpZmllZCcsIHtcbiAgICAgICAgICAgIHBoYXNlOiAnc3RydWN0dXJlLWRldGVjdGlvbidcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQW5hbHl6ZSBhbGwgZGltZW5zaW9ucyBJTiBQQVJBTExFTCBmb3Igc3BlZWRcbiAgICAgICAgY29uc29sZS5sb2coJ1N0YXJ0aW5nIHBhcmFsbGVsIGRpbWVuc2lvbiBhbmFseXNpcy4uLicpO1xuXG4gICAgICAgIGNvbnN0IGRpbWVuc2lvblByb21pc2VzID0gRElNRU5TSU9OUy5tYXAoYXN5bmMgKGRpbWVuc2lvbiwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU3RhcnRpbmcgJHtkaW1lbnNpb259IGFuYWx5c2lzYCk7XG5cbiAgICAgICAgICAgIC8vIFNlbmQgcHJvZ3Jlc3MgbWVzc2FnZSBmb3IgdGhpcyBkaW1lbnNpb25cbiAgICAgICAgICAgIGF3YWl0IHByb2dyZXNzLnByb2dyZXNzKGBBbmFseXppbmcgJHtkaW1lbnNpb24uY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBkaW1lbnNpb24uc2xpY2UoMSl9ICgke2luZGV4ICsgMX0vNSkuLi5gLCAnZGltZW5zaW9uLWFuYWx5c2lzJywge1xuICAgICAgICAgICAgICAgIGRpbWVuc2lvblxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgYW5hbHl6ZURpbWVuc2lvbihcbiAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uLFxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzZWRDb250ZW50LFxuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZE1vZGVsXG4gICAgICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NpbmdUaW1lID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgJHtkaW1lbnNpb259IGNvbXBsZXRlOiBzY29yZSAke3Jlc3VsdC5zY29yZX1gKTtcblxuICAgICAgICAgICAgICAgIC8vIFNlbmQgc3VjY2VzcyBtZXNzYWdlIHdpdGggc2NvcmVcbiAgICAgICAgICAgICAgICBhd2FpdCBwcm9ncmVzcy5zdWNjZXNzKGAke2RpbWVuc2lvbi5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIGRpbWVuc2lvbi5zbGljZSgxKX06ICR7cmVzdWx0LnNjb3JlfS8xMDAgKCR7KHByb2Nlc3NpbmdUaW1lIC8gMTAwMCkudG9GaXhlZCgxKX1zKWAsIHtcbiAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uLFxuICAgICAgICAgICAgICAgICAgICBzY29yZTogcmVzdWx0LnNjb3JlIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1RpbWVcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbixcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5yZXN1bHQsXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzaW5nVGltZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgJHtkaW1lbnNpb259IGZhaWxlZDpgLCBlcnJvcik7XG5cbiAgICAgICAgICAgICAgICAvLyBTZW5kIGVycm9yIG1lc3NhZ2VcbiAgICAgICAgICAgICAgICBhd2FpdCBwcm9ncmVzcy5lcnJvcihgJHtkaW1lbnNpb24uY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBkaW1lbnNpb24uc2xpY2UoMSl9IGZhaWxlZDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gLCB7XG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvblxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uLFxuICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIHNjb3JlOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbmRpbmdzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY29tbWVuZGF0aW9uczogW10sXG4gICAgICAgICAgICAgICAgICAgICAgICBmYWlsdXJlUmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzaW5nVGltZTogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gV2FpdCBmb3IgYWxsIGRpbWVuc2lvbnMgdG8gY29tcGxldGVcbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKGRpbWVuc2lvblByb21pc2VzKTtcblxuICAgICAgICAvLyBDb252ZXJ0IGFycmF5IHRvIHJlY29yZFxuICAgICAgICBjb25zdCBkaW1lbnNpb25SZXN1bHRzOiBSZWNvcmQ8RGltZW5zaW9uVHlwZSwgRGltZW5zaW9uUmVzdWx0PiA9IHt9IGFzIGFueTtcbiAgICAgICAgcmVzdWx0cy5mb3JFYWNoKCh7IGRpbWVuc2lvbiwgcmVzdWx0IH0pID0+IHtcbiAgICAgICAgICAgIGRpbWVuc2lvblJlc3VsdHNbZGltZW5zaW9uXSA9IHJlc3VsdDtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQXBwbHkgY29udGVudC10eXBlLWF3YXJlIHNjb3JpbmdcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSBwcm9jZXNzZWRDb250ZW50LmNvbnRlbnRUeXBlIGFzIERvY3VtZW50YXRpb25UeXBlIHx8ICdtaXhlZCc7XG4gICAgICAgIGNvbnN0IHdlaWdodGVkUmVzdWx0cyA9IGFwcGx5Q29udGVudFR5cGVXZWlnaHRzKGRpbWVuc2lvblJlc3VsdHMsIGNvbnRlbnRUeXBlKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgQXBwbGllZCBjb250ZW50LXR5cGUtYXdhcmUgd2VpZ2h0cyBmb3I6ICR7Y29udGVudFR5cGV9YCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdBbGwgZGltZW5zaW9ucyBhbmFseXplZCBpbiBwYXJhbGxlbCcpO1xuXG4gICAgICAgIC8vIFN0b3JlIGRpbWVuc2lvbiByZXN1bHRzIGluIFMzIHNlc3Npb24gbG9jYXRpb25cbiAgICAgICAgY29uc3QgcmVzdWx0c0tleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vZGltZW5zaW9uLXJlc3VsdHMuanNvbmA7XG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiByZXN1bHRzS2V5LFxuICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkod2VpZ2h0ZWRSZXN1bHRzKSxcbiAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIC8vIENhY2hlIHRoZSByZXN1bHRzIGZvciBmdXR1cmUgdXNlIChvbmx5IGlmIGNhY2hpbmcgaXMgZW5hYmxlZClcbiAgICAgICAgaWYgKGNhY2hlRW5hYmxlZCkge1xuICAgICAgICAgICAgYXdhaXQgY2FjaGVEaW1lbnNpb25SZXN1bHRzKGJ1Y2tldE5hbWUsIHByb2Nlc3NlZENvbnRlbnQsIGNvbnRleHR1YWxTZXR0aW5nLCBzZWxlY3RlZE1vZGVsLCB3ZWlnaHRlZFJlc3VsdHMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ+KaoO+4jyBDYWNoZSBkaXNhYmxlZCAtIHNraXBwaW5nIGRpbWVuc2lvbiBjYWNoZSBzdG9yYWdlJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZygnRGltZW5zaW9uIGFuYWx5c2lzIGNvbXBsZXRlZCBhbmQgc3RvcmVkIGluIFMzJyk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IHNlc3Npb25JZCxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBEaW1lbnNpb24gYW5hbHlzaXMgY29tcGxldGVkIHVzaW5nICR7c2VsZWN0ZWRNb2RlbH1gXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdEaW1lbnNpb24gYW5hbHlzaXMgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBzZXNzaW9uSWQsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xuICAgICAgICB9O1xuICAgIH1cbn07XG5cbi8qKlxuICogQXBwbHkgY29udGVudC10eXBlLWF3YXJlIHNjb3Jpbmcgd2VpZ2h0cyB0byBkaW1lbnNpb24gcmVzdWx0c1xuICogVGhpcyBlbnN1cmVzIGZhaXIgY29tcGFyaXNvbiBhY3Jvc3MgZGlmZmVyZW50IGRvY3VtZW50IHR5cGVzXG4gKi9cbmZ1bmN0aW9uIGFwcGx5Q29udGVudFR5cGVXZWlnaHRzKFxuICAgIGRpbWVuc2lvblJlc3VsdHM6IFJlY29yZDxEaW1lbnNpb25UeXBlLCBEaW1lbnNpb25SZXN1bHQ+LFxuICAgIGNvbnRlbnRUeXBlOiBEb2N1bWVudGF0aW9uVHlwZVxuKTogUmVjb3JkPERpbWVuc2lvblR5cGUsIERpbWVuc2lvblJlc3VsdD4ge1xuICAgIGNvbnN0IHdlaWdodHMgPSBDT05URU5UX1RZUEVfV0VJR0hUU1tjb250ZW50VHlwZV07XG4gICAgY29uc3Qgd2VpZ2h0ZWRSZXN1bHRzID0geyAuLi5kaW1lbnNpb25SZXN1bHRzIH07XG5cbiAgICAvLyBBZGQgY29udGVudCB0eXBlIG1ldGFkYXRhIHRvIHJlc3VsdHNcbiAgICBPYmplY3Qua2V5cyh3ZWlnaHRlZFJlc3VsdHMpLmZvckVhY2goZGltZW5zaW9uID0+IHtcbiAgICAgICAgY29uc3QgZGltID0gZGltZW5zaW9uIGFzIERpbWVuc2lvblR5cGU7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHdlaWdodGVkUmVzdWx0c1tkaW1dO1xuXG4gICAgICAgIGlmIChyZXN1bHQuc2NvcmUgIT09IG51bGwpIHtcbiAgICAgICAgICAgIC8vIFN0b3JlIG9yaWdpbmFsIHNjb3JlIGFuZCBhZGQgd2VpZ2h0ZWQgbWV0YWRhdGFcbiAgICAgICAgICAgIHJlc3VsdC5vcmlnaW5hbFNjb3JlID0gcmVzdWx0LnNjb3JlO1xuICAgICAgICAgICAgcmVzdWx0LmNvbnRlbnRUeXBlV2VpZ2h0ID0gd2VpZ2h0c1tkaW1dO1xuICAgICAgICAgICAgcmVzdWx0LmNvbnRlbnRUeXBlID0gY29udGVudFR5cGU7XG5cbiAgICAgICAgICAgIC8vIEFkZCBjb250ZW50LXR5cGUtc3BlY2lmaWMgY29udGV4dCB0byBmaW5kaW5nc1xuICAgICAgICAgICAgcmVzdWx0LmZpbmRpbmdzLnVuc2hpZnQoYENvbnRlbnQgdHlwZTogJHtjb250ZW50VHlwZX0gKHdlaWdodDogJHtNYXRoLnJvdW5kKHdlaWdodHNbZGltXSAqIDEwMCl9JSlgKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc29sZS5sb2coYEFwcGxpZWQgd2VpZ2h0cyBmb3IgJHtjb250ZW50VHlwZX06YCwgd2VpZ2h0cyk7XG4gICAgcmV0dXJuIHdlaWdodGVkUmVzdWx0cztcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tEaW1lbnNpb25DYWNoZShcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJvY2Vzc2VkQ29udGVudDogYW55LFxuICAgIGNvbnRleHR1YWxTZXR0aW5nOiBzdHJpbmcsXG4gICAgc2VsZWN0ZWRNb2RlbDogc3RyaW5nXG4pOiBQcm9taXNlPFJlY29yZDxEaW1lbnNpb25UeXBlLCBEaW1lbnNpb25SZXN1bHQ+IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHByb2Nlc3MuZW52LlBST0NFU1NFRF9DT05URU5UX1RBQkxFO1xuICAgICAgICBpZiAoIXRhYmxlTmFtZSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGNhY2hlIHRhYmxlIGNvbmZpZ3VyZWQsIHNraXBwaW5nIGRpbWVuc2lvbiBjYWNoZSBjaGVjaycpO1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5cbiAgICAgICAgLy8gTm9ybWFsaXplIFVSTCBzYW1lIHdheSBhcyBVUkwgcHJvY2Vzc29yXG4gICAgICAgIGNvbnN0IGNsZWFuVXJsID0gbm9ybWFsaXplVXJsKHByb2Nlc3NlZENvbnRlbnQudXJsKTtcblxuICAgICAgICAvLyBMb29rIHVwIGNhY2hlIGVudHJ5IGluIER5bmFtb0RCXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdGFibGVOYW1lLFxuICAgICAgICAgICAgS2V5OiBtYXJzaGFsbCh7XG4gICAgICAgICAgICAgICAgdXJsOiBjbGVhblVybCxcbiAgICAgICAgICAgICAgICBjb250ZXh0dWFsU2V0dGluZzogY29udGV4dHVhbFNldHRpbmdcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pKTtcblxuICAgICAgICBpZiAoIXJlc3BvbnNlLkl0ZW0pIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBjYWNoZSBlbnRyeSBmb3VuZCBmb3IgZGltZW5zaW9uIGFuYWx5c2lzJyk7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNhY2hlRW50cnkgPSB1bm1hcnNoYWxsKHJlc3BvbnNlLkl0ZW0pO1xuICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgY2FjaGUgZW50cnksIGNoZWNraW5nIGZvciBkaW1lbnNpb24gcmVzdWx0cy4uLmApO1xuXG4gICAgICAgIC8vIFRoZSBzM0xvY2F0aW9uIG5vdyBwb2ludHMgdG8gc2Vzc2lvbnMve2NvbnNpc3RlbnRTZXNzaW9uSWR9L3Byb2Nlc3NlZC1jb250ZW50Lmpzb25cbiAgICAgICAgLy8gV2UgbmVlZCB0byBjaGVjayBmb3Igc2Vzc2lvbnMve2NvbnNpc3RlbnRTZXNzaW9uSWR9L2RpbWVuc2lvbi1yZXN1bHRzLmpzb25cbiAgICAgICAgY29uc3QgY29udGVudFMzUGF0aCA9IGNhY2hlRW50cnkuczNMb2NhdGlvbjsgLy8gZS5nLiwgc2Vzc2lvbnMvc2Vzc2lvbi1hYmMxMjMvcHJvY2Vzc2VkLWNvbnRlbnQuanNvblxuICAgICAgICBjb25zdCBzZXNzaW9uUGF0aCA9IGNvbnRlbnRTM1BhdGgucmVwbGFjZSgnL3Byb2Nlc3NlZC1jb250ZW50Lmpzb24nLCAnJyk7IC8vIHNlc3Npb25zL3Nlc3Npb24tYWJjMTIzXG4gICAgICAgIGNvbnN0IGRpbWVuc2lvblMzUGF0aCA9IGAke3Nlc3Npb25QYXRofS9kaW1lbnNpb24tcmVzdWx0cy5qc29uYDtcblxuICAgICAgICAvLyBUcnkgdG8gcmV0cmlldmUgZGltZW5zaW9uIHJlc3VsdHMgZnJvbSBTM1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZGltZW5zaW9uUmVzcG9uc2UgPSBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgICAgS2V5OiBkaW1lbnNpb25TM1BhdGhcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgY29uc3QgZGltZW5zaW9uQ29udGVudCA9IGF3YWl0IGRpbWVuc2lvblJlc3BvbnNlLkJvZHkhLnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgICAgICBjb25zdCBkaW1lbnNpb25SZXN1bHRzID0gSlNPTi5wYXJzZShkaW1lbnNpb25Db250ZW50KTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBGb3VuZCBjYWNoZWQgZGltZW5zaW9uIHJlc3VsdHMgYXQ6ICR7ZGltZW5zaW9uUzNQYXRofWApO1xuICAgICAgICAgICAgcmV0dXJuIGRpbWVuc2lvblJlc3VsdHM7XG5cbiAgICAgICAgfSBjYXRjaCAoczNFcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKdjCBObyBjYWNoZWQgZGltZW5zaW9uIHJlc3VsdHMgZm91bmQgYXQ6ICR7ZGltZW5zaW9uUzNQYXRofWApO1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGRpbWVuc2lvbiBjYWNoZTonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gY2FjaGVEaW1lbnNpb25SZXN1bHRzKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBwcm9jZXNzZWRDb250ZW50OiBhbnksXG4gICAgY29udGV4dHVhbFNldHRpbmc6IHN0cmluZyxcbiAgICBzZWxlY3RlZE1vZGVsOiBzdHJpbmcsXG4gICAgZGltZW5zaW9uUmVzdWx0czogUmVjb3JkPERpbWVuc2lvblR5cGUsIERpbWVuc2lvblJlc3VsdD5cbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAgIC8vIEdlbmVyYXRlIHRoZSBzYW1lIGNvbnNpc3RlbnQgc2Vzc2lvbiBJRCB0aGF0IFVSTCBwcm9jZXNzb3IgdXNlc1xuICAgICAgICBjb25zdCBjb25zaXN0ZW50U2Vzc2lvbklkID0gZ2VuZXJhdGVDb25zaXN0ZW50U2Vzc2lvbklkKHByb2Nlc3NlZENvbnRlbnQudXJsLCBjb250ZXh0dWFsU2V0dGluZyk7XG5cbiAgICAgICAgLy8gU3RvcmUgZGltZW5zaW9uIHJlc3VsdHMgaW4gdGhlIHNhbWUgc2Vzc2lvbiBmb2xkZXIgYXMgcHJvY2Vzc2VkIGNvbnRlbnRcbiAgICAgICAgY29uc3QgZGltZW5zaW9uUzNQYXRoID0gYHNlc3Npb25zLyR7Y29uc2lzdGVudFNlc3Npb25JZH0vZGltZW5zaW9uLXJlc3VsdHMuanNvbmA7XG5cbiAgICAgICAgYXdhaXQgczNDbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBLZXk6IGRpbWVuc2lvblMzUGF0aCxcbiAgICAgICAgICAgIEJvZHk6IEpTT04uc3RyaW5naWZ5KGRpbWVuc2lvblJlc3VsdHMpLFxuICAgICAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYOKchSBDYWNoZWQgZGltZW5zaW9uIHJlc3VsdHMgYXQ6ICR7ZGltZW5zaW9uUzNQYXRofWApO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGNhY2hlIGRpbWVuc2lvbiByZXN1bHRzOicsIGVycm9yKTtcbiAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBjYWNoaW5nIGZhaWx1cmUgc2hvdWxkbid0IGJyZWFrIHRoZSBtYWluIGZsb3dcbiAgICB9XG59XG5cbi8qKlxuICogR2VuZXJhdGUgY29uc2lzdGVudCBzZXNzaW9uIElEIGJhc2VkIG9uIFVSTCBhbmQgY29udGV4dCBzZXR0aW5nXG4gKiBNdXN0IG1hdGNoIHRoZSBmdW5jdGlvbiBpbiBVUkwgcHJvY2Vzc29yIGV4YWN0bHlcbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVDb25zaXN0ZW50U2Vzc2lvbklkKHVybDogc3RyaW5nLCBjb250ZXh0dWFsU2V0dGluZzogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkVXJsID0gbm9ybWFsaXplVXJsKHVybCk7XG4gICAgY29uc3QgaW5wdXQgPSBgJHtub3JtYWxpemVkVXJsfSMke2NvbnRleHR1YWxTZXR0aW5nfWA7XG4gICAgY29uc3QgaGFzaCA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoaW5wdXQpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgcmV0dXJuIGBzZXNzaW9uLSR7aGFzaC5zdWJzdHJpbmcoMCwgMTIpfWA7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVVybCh1cmw6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdXJsT2JqID0gbmV3IFVSTCh1cmwpO1xuICAgICAgICB1cmxPYmouaGFzaCA9ICcnO1xuICAgICAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHVybE9iai5zZWFyY2gpO1xuICAgICAgICBjb25zdCBzb3J0ZWRQYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKCk7XG4gICAgICAgIEFycmF5LmZyb20ocGFyYW1zLmtleXMoKSkuc29ydCgpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgIHNvcnRlZFBhcmFtcy5zZXQoa2V5LCBwYXJhbXMuZ2V0KGtleSkgfHwgJycpO1xuICAgICAgICB9KTtcbiAgICAgICAgdXJsT2JqLnNlYXJjaCA9IHNvcnRlZFBhcmFtcy50b1N0cmluZygpO1xuICAgICAgICBpZiAodXJsT2JqLnBhdGhuYW1lICE9PSAnLycgJiYgdXJsT2JqLnBhdGhuYW1lLmVuZHNXaXRoKCcvJykpIHtcbiAgICAgICAgICAgIHVybE9iai5wYXRobmFtZSA9IHVybE9iai5wYXRobmFtZS5zbGljZSgwLCAtMSk7XG4gICAgICAgIH1cbiAgICAgICAgdXJsT2JqLmhvc3RuYW1lID0gdXJsT2JqLmhvc3RuYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIHJldHVybiB1cmxPYmoudG9TdHJpbmcoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBub3JtYWxpemUgVVJMLCB1c2luZyBvcmlnaW5hbDonLCB1cmwpO1xuICAgICAgICByZXR1cm4gdXJsO1xuICAgIH1cbn1cbmFzeW5jIGZ1bmN0aW9uIGFuYWx5emVEaW1lbnNpb24oXG4gICAgZGltZW5zaW9uOiBEaW1lbnNpb25UeXBlLFxuICAgIHByb2Nlc3NlZENvbnRlbnQ6IGFueSxcbiAgICBzZWxlY3RlZE1vZGVsOiBzdHJpbmdcbik6IFByb21pc2U8RGltZW5zaW9uUmVzdWx0PiB7XG4gICAgY29uc3QgcHJvbXB0ID0gYnVpbGRQcm9tcHRGb3JEaW1lbnNpb24oZGltZW5zaW9uLCBwcm9jZXNzZWRDb250ZW50KTtcblxuICAgIGNvbnN0IG1vZGVsSWQgPSBnZXRNb2RlbElkKHNlbGVjdGVkTW9kZWwpO1xuXG4gICAgLy8gRGlmZmVyZW50IG1vZGVscyB1c2UgZGlmZmVyZW50IEFQSSBmb3JtYXRzXG4gICAgbGV0IHJlcXVlc3RCb2R5OiBhbnk7XG4gICAgbGV0IHJlc3BvbnNlUGFyc2VyOiAocmVzcG9uc2VCb2R5OiBhbnkpID0+IHN0cmluZztcblxuICAgIGlmIChzZWxlY3RlZE1vZGVsID09PSAnbGxhbWEnKSB7XG4gICAgICAgIC8vIExsYW1hIHVzZXMgdGhlIG9sZGVyIHByb21wdCBmb3JtYXRcbiAgICAgICAgcmVxdWVzdEJvZHkgPSB7XG4gICAgICAgICAgICBwcm9tcHQ6IHByb21wdCxcbiAgICAgICAgICAgIG1heF9nZW5fbGVuOiAyMDAwLFxuICAgICAgICAgICAgdGVtcGVyYXR1cmU6IDAuMSxcbiAgICAgICAgICAgIHRvcF9wOiAwLjlcbiAgICAgICAgfTtcbiAgICAgICAgcmVzcG9uc2VQYXJzZXIgPSAocmVzcG9uc2VCb2R5KSA9PiByZXNwb25zZUJvZHkuZ2VuZXJhdGlvbjtcbiAgICB9IGVsc2UgaWYgKHNlbGVjdGVkTW9kZWwgPT09ICd0aXRhbicpIHtcbiAgICAgICAgLy8gVGl0YW4gdXNlcyB0ZXh0R2VuZXJhdGlvbkNvbmZpZyBmb3JtYXRcbiAgICAgICAgcmVxdWVzdEJvZHkgPSB7XG4gICAgICAgICAgICBpbnB1dFRleHQ6IHByb21wdCxcbiAgICAgICAgICAgIHRleHRHZW5lcmF0aW9uQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgbWF4VG9rZW5Db3VudDogMjAwMCxcbiAgICAgICAgICAgICAgICB0ZW1wZXJhdHVyZTogMC4xLFxuICAgICAgICAgICAgICAgIHRvcFA6IDAuOVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICByZXNwb25zZVBhcnNlciA9IChyZXNwb25zZUJvZHkpID0+IHJlc3BvbnNlQm9keS5yZXN1bHRzWzBdLm91dHB1dFRleHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2xhdWRlIHVzZXMgTWVzc2FnZXMgQVBJIGZvcm1hdFxuICAgICAgICByZXF1ZXN0Qm9keSA9IHtcbiAgICAgICAgICAgIGFudGhyb3BpY192ZXJzaW9uOiBcImJlZHJvY2stMjAyMy0wNS0zMVwiLFxuICAgICAgICAgICAgbWF4X3Rva2VuczogMjAwMCxcbiAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjEsXG4gICAgICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHByb21wdFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcbiAgICAgICAgcmVzcG9uc2VQYXJzZXIgPSAocmVzcG9uc2VCb2R5KSA9PiByZXNwb25zZUJvZHkuY29udGVudFswXS50ZXh0O1xuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxDb21tYW5kKHtcbiAgICAgICAgbW9kZWxJZCxcbiAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgYWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlcXVlc3RCb2R5KVxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrQ2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuYm9keSkpO1xuXG4gICAgY29uc3QgdGV4dENvbnRlbnQgPSByZXNwb25zZVBhcnNlcihyZXNwb25zZUJvZHkpO1xuXG4gICAgLy8gUGFyc2UgSlNPTiBmcm9tIHRoZSByZXNwb25zZVxuICAgIGNvbnN0IGpzb25NYXRjaCA9IHRleHRDb250ZW50Lm1hdGNoKC9cXHtbXFxzXFxTXSpcXH0vKTtcbiAgICBpZiAoIWpzb25NYXRjaCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIEpTT04gZm91bmQgaW4gQUkgcmVzcG9uc2UnKTtcbiAgICB9XG5cbiAgICBjb25zdCBhbmFseXNpcyA9IEpTT04ucGFyc2UoanNvbk1hdGNoWzBdKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGRpbWVuc2lvbixcbiAgICAgICAgc2NvcmU6IGFuYWx5c2lzLnNjb3JlLFxuICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZScsXG4gICAgICAgIGZpbmRpbmdzOiBhbmFseXNpcy5maW5kaW5ncyB8fCBbXSxcbiAgICAgICAgcmVjb21tZW5kYXRpb25zOiBhbmFseXNpcy5yZWNvbW1lbmRhdGlvbnMgfHwgW10sXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lOiAwIC8vIFdpbGwgYmUgc2V0IGJ5IGNhbGxlclxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkUHJvbXB0Rm9yRGltZW5zaW9uKGRpbWVuc2lvbjogRGltZW5zaW9uVHlwZSwgcHJvY2Vzc2VkQ29udGVudDogYW55KTogc3RyaW5nIHtcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHByb2Nlc3NlZENvbnRlbnQuY29udGVudFR5cGUgYXMgRG9jdW1lbnRhdGlvblR5cGUgfHwgJ21peGVkJztcbiAgICBjb25zdCB3ZWlnaHRzID0gQ09OVEVOVF9UWVBFX1dFSUdIVFNbY29udGVudFR5cGVdO1xuXG4gICAgY29uc3QgYmFzZUNvbnRleHQgPSBgXG5VUkw6ICR7cHJvY2Vzc2VkQ29udGVudC51cmx9XG5Db250ZW50IFR5cGU6ICR7Y29udGVudFR5cGV9ICgke2RpbWVuc2lvbn0gd2VpZ2h0OiAke01hdGgucm91bmQod2VpZ2h0c1tkaW1lbnNpb25dICogMTAwKX0lKVxuQ29kZSBTbmlwcGV0czogJHtwcm9jZXNzZWRDb250ZW50LmNvZGVTbmlwcGV0cz8ubGVuZ3RoIHx8IDB9XG5NZWRpYSBFbGVtZW50czogJHtwcm9jZXNzZWRDb250ZW50Lm1lZGlhRWxlbWVudHM/Lmxlbmd0aCB8fCAwfVxuVG90YWwgTGlua3M6ICR7cHJvY2Vzc2VkQ29udGVudC5saW5rQW5hbHlzaXM/LnRvdGFsTGlua3MgfHwgMH1cblxuQ29udGVudCAoZmlyc3QgMzAwMCBjaGFycyk6XG4ke3Byb2Nlc3NlZENvbnRlbnQubWFya2Rvd25Db250ZW50Py5zbGljZSgwLCAzMDAwKSB8fCAnJ31cbmA7XG5cbiAgICAvLyBBZGQgY29udGV4dCBhbmFseXNpcyBpbmZvcm1hdGlvbiBpZiBhdmFpbGFibGVcbiAgICBsZXQgY29udGV4dEluZm8gPSAnJztcbiAgICBpZiAocHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMgJiYgcHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMuY29udGV4dFBhZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29udGV4dEluZm8gPSBgXG5DT05URVhUIEFOQUxZU0lTIEVOQUJMRUQ6XG5BbmFseXNpcyBTY29wZTogJHtwcm9jZXNzZWRDb250ZW50LmNvbnRleHRBbmFseXNpcy5hbmFseXNpc1Njb3BlfVxuVG90YWwgUGFnZXMgQW5hbHl6ZWQ6ICR7cHJvY2Vzc2VkQ29udGVudC5jb250ZXh0QW5hbHlzaXMudG90YWxQYWdlc0FuYWx5emVkfVxuUmVsYXRlZCBQYWdlcyBEaXNjb3ZlcmVkOlxuJHtwcm9jZXNzZWRDb250ZW50LmNvbnRleHRBbmFseXNpcy5jb250ZXh0UGFnZXMubWFwKChwYWdlOiBhbnkpID0+XG4gICAgICAgICAgICBgLSAke3BhZ2UucmVsYXRpb25zaGlwLnRvVXBwZXJDYXNlKCl9OiAke3BhZ2UudGl0bGV9IChjb25maWRlbmNlOiAke01hdGgucm91bmQocGFnZS5jb25maWRlbmNlICogMTAwKX0lKWBcbiAgICAgICAgKS5qb2luKCdcXG4nKX1cblxuSU1QT1JUQU5UOiBDb25zaWRlciB0aGlzIGJyb2FkZXIgZG9jdW1lbnRhdGlvbiBjb250ZXh0IHdoZW4gZXZhbHVhdGluZyB0aGUgdGFyZ2V0IHBhZ2UuIFxuVGhlIHRhcmdldCBwYWdlIGlzIHBhcnQgb2YgYSBsYXJnZXIgZG9jdW1lbnRhdGlvbiBzdHJ1Y3R1cmUsIHNvIGV2YWx1YXRlIGhvdyB3ZWxsIGl0IGZpdHMgXG53aXRoaW4gdGhpcyBjb250ZXh0IGFuZCB3aGV0aGVyIGl0IHByb3Blcmx5IHJlZmVyZW5jZXMgb3IgYnVpbGRzIHVwb24gcmVsYXRlZCBwYWdlcy5cbmA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29udGV4dEluZm8gPSBgXG5DT05URVhUIEFOQUxZU0lTOiBTaW5nbGUgcGFnZSBhbmFseXNpcyAobm8gcmVsYXRlZCBwYWdlcyBkaXNjb3ZlcmVkKVxuYDtcbiAgICB9XG5cbiAgICAvLyBDb250ZW50LXR5cGUtc3BlY2lmaWMgZXZhbHVhdGlvbiBjcml0ZXJpYVxuICAgIGNvbnN0IGNvbnRlbnRUeXBlR3VpZGFuY2UgPSBnZXRDb250ZW50VHlwZUd1aWRhbmNlKGNvbnRlbnRUeXBlLCBkaW1lbnNpb24pO1xuXG4gICAgY29uc3QgZGltZW5zaW9uUHJvbXB0czogUmVjb3JkPERpbWVuc2lvblR5cGUsIHN0cmluZz4gPSB7XG4gICAgICAgIHJlbGV2YW5jZTogYEFuYWx5emUgdGhlIFJFTEVWQU5DRSBvZiB0aGlzIFdvcmRQcmVzcyBkZXZlbG9wZXIgZG9jdW1lbnRhdGlvbi5cblxuJHtiYXNlQ29udGV4dH1cbiR7Y29udGV4dEluZm99XG5cbkNPTlRFTlQgVFlQRSBTUEVDSUZJQyBHVUlEQU5DRTpcbiR7Y29udGVudFR5cGVHdWlkYW5jZX1cblxuRXZhbHVhdGU6XG4xLiBJcyB0aGUgY29udGVudCByZWxldmFudCB0byBXb3JkUHJlc3MgZGV2ZWxvcGVycz9cbjIuIEFyZSBleGFtcGxlcyBwcmFjdGljYWwgYW5kIGFwcGxpY2FibGU/XG4zLiBEb2VzIGl0IGFkZHJlc3MgcmVhbCBkZXZlbG9wZXIgbmVlZHM/XG40LiBJcyB0aGUgc2NvcGUgYXBwcm9wcmlhdGUgZm9yIHRoZSB0b3BpYz9cbjUuIElmIGNvbnRleHQgcGFnZXMgYXJlIGF2YWlsYWJsZSwgZG9lcyB0aGlzIHBhZ2UgZml0IHdlbGwgd2l0aGluIHRoZSBicm9hZGVyIGRvY3VtZW50YXRpb24gc3RydWN0dXJlP1xuXG5SZXNwb25kIGluIEpTT04gZm9ybWF0Olxue1xuICBcInNjb3JlXCI6IDAtMTAwLFxuICBcImZpbmRpbmdzXCI6IFtcImZpbmRpbmcgMVwiLCBcImZpbmRpbmcgMlwiXSxcbiAgXCJyZWNvbW1lbmRhdGlvbnNcIjogW1xuICAgIHtcbiAgICAgIFwicHJpb3JpdHlcIjogXCJoaWdofG1lZGl1bXxsb3dcIixcbiAgICAgIFwiYWN0aW9uXCI6IFwic3BlY2lmaWMgYWN0aW9uXCIsXG4gICAgICBcImltcGFjdFwiOiBcImV4cGVjdGVkIGltcGFjdFwiXG4gICAgfVxuICBdXG59YCxcblxuICAgICAgICBmcmVzaG5lc3M6IGBBbmFseXplIHRoZSBGUkVTSE5FU1Mgb2YgdGhpcyBXb3JkUHJlc3MgZGV2ZWxvcGVyIGRvY3VtZW50YXRpb24uXG5cbiR7YmFzZUNvbnRleHR9XG4ke2NvbnRleHRJbmZvfVxuXG5DT05URU5UIFRZUEUgU1BFQ0lGSUMgR1VJREFOQ0U6XG4ke2NvbnRlbnRUeXBlR3VpZGFuY2V9XG5cbkNvZGUgU25pcHBldHMgd2l0aCBWZXJzaW9uIEluZm86XG4ke3Byb2Nlc3NlZENvbnRlbnQuY29kZVNuaXBwZXRzPy5maWx0ZXIoKHM6IGFueSkgPT4gcy5oYXNWZXJzaW9uSW5mbykubWFwKChzOiBhbnkpID0+IHMuY29kZS5zbGljZSgwLCAyMDApKS5qb2luKCdcXG4tLS1cXG4nKSB8fCAnTm9uZSd9XG5cbkV2YWx1YXRlOlxuMS4gQXJlIFdvcmRQcmVzcyB2ZXJzaW9uIHJlZmVyZW5jZXMgY3VycmVudCAoNi40Kyk/XG4yLiBBcmUgY29kZSBleGFtcGxlcyB1c2luZyBtb2Rlcm4gcHJhY3RpY2VzP1xuMy4gQXJlIGRlcHJlY2F0ZWQgZmVhdHVyZXMgZmxhZ2dlZD9cbjQuIElzIHRoZSBjb250ZW50IHVwLXRvLWRhdGU/XG41LiBJZiBjb250ZXh0IHBhZ2VzIGFyZSBhdmFpbGFibGUsIGNvbnNpZGVyIHdoZXRoZXIgdGhpcyBwYWdlJ3MgdmVyc2lvbiBpbmZvcm1hdGlvbiBpcyBjb25zaXN0ZW50IHdpdGggcmVsYXRlZCBwYWdlcy5cblxuUmVzcG9uZCBpbiBKU09OIGZvcm1hdDpcbntcbiAgXCJzY29yZVwiOiAwLTEwMCxcbiAgXCJmaW5kaW5nc1wiOiBbXCJmaW5kaW5nIDFcIiwgXCJmaW5kaW5nIDJcIl0sXG4gIFwicmVjb21tZW5kYXRpb25zXCI6IFtcbiAgICB7XG4gICAgICBcInByaW9yaXR5XCI6IFwiaGlnaHxtZWRpdW18bG93XCIsXG4gICAgICBcImFjdGlvblwiOiBcInNwZWNpZmljIGFjdGlvblwiLFxuICAgICAgXCJpbXBhY3RcIjogXCJleHBlY3RlZCBpbXBhY3RcIlxuICAgIH1cbiAgXVxufWAsXG5cbiAgICAgICAgY2xhcml0eTogYEFuYWx5emUgdGhlIENMQVJJVFkgb2YgdGhpcyBXb3JkUHJlc3MgZGV2ZWxvcGVyIGRvY3VtZW50YXRpb24uXG5cbiR7YmFzZUNvbnRleHR9XG4ke2NvbnRleHRJbmZvfVxuXG5DT05URU5UIFRZUEUgU1BFQ0lGSUMgR1VJREFOQ0U6XG4ke2NvbnRlbnRUeXBlR3VpZGFuY2V9XG5cbkV2YWx1YXRlOlxuMS4gSXMgdGhlIGNvbnRlbnQgd2VsbC1zdHJ1Y3R1cmVkIGFuZCBvcmdhbml6ZWQ/XG4yLiBBcmUgZXhwbGFuYXRpb25zIGNsZWFyIGFuZCB1bmRlcnN0YW5kYWJsZT9cbjMuIEFyZSBjb2RlIGV4YW1wbGVzIHdlbGwtY29tbWVudGVkP1xuNC4gSXMgdGVjaG5pY2FsIGphcmdvbiBleHBsYWluZWQ/XG41LiBJZiBjb250ZXh0IHBhZ2VzIGFyZSBhdmFpbGFibGUsIGRvZXMgdGhpcyBwYWdlIGNsZWFybHkgZXhwbGFpbiBpdHMgcmVsYXRpb25zaGlwIHRvIHBhcmVudC9jaGlsZC9zaWJsaW5nIHBhZ2VzP1xuXG5SZXNwb25kIGluIEpTT04gZm9ybWF0Olxue1xuICBcInNjb3JlXCI6IDAtMTAwLFxuICBcImZpbmRpbmdzXCI6IFtcImZpbmRpbmcgMVwiLCBcImZpbmRpbmcgMlwiXSxcbiAgXCJyZWNvbW1lbmRhdGlvbnNcIjogW1xuICAgIHtcbiAgICAgIFwicHJpb3JpdHlcIjogXCJoaWdofG1lZGl1bXxsb3dcIixcbiAgICAgIFwiYWN0aW9uXCI6IFwic3BlY2lmaWMgYWN0aW9uXCIsXG4gICAgICBcImltcGFjdFwiOiBcImV4cGVjdGVkIGltcGFjdFwiXG4gICAgfVxuICBdXG59YCxcblxuICAgICAgICBhY2N1cmFjeTogYEFuYWx5emUgdGhlIEFDQ1VSQUNZIG9mIHRoaXMgV29yZFByZXNzIGRldmVsb3BlciBkb2N1bWVudGF0aW9uLlxuXG4ke2Jhc2VDb250ZXh0fVxuJHtjb250ZXh0SW5mb31cblxuQ09OVEVOVCBUWVBFIFNQRUNJRklDIEdVSURBTkNFOlxuJHtjb250ZW50VHlwZUd1aWRhbmNlfVxuXG5Db2RlIFNuaXBwZXRzOlxuJHtwcm9jZXNzZWRDb250ZW50LmNvZGVTbmlwcGV0cz8ubWFwKChzOiBhbnkpID0+IGBMYW5ndWFnZTogJHtzLmxhbmd1YWdlfVxcbiR7cy5jb2RlLnNsaWNlKDAsIDMwMCl9YCkuam9pbignXFxuLS0tXFxuJykgfHwgJ05vbmUnfVxuXG5FdmFsdWF0ZTpcbjEuIEFyZSBjb2RlIGV4YW1wbGVzIHN5bnRhY3RpY2FsbHkgY29ycmVjdD9cbjIuIElzIEFQSSB1c2FnZSBhY2N1cmF0ZT9cbjMuIEFyZSB0ZWNobmljYWwgZGV0YWlscyBjb3JyZWN0P1xuNC4gQXJlIHRoZXJlIGFueSBtaXNsZWFkaW5nIHN0YXRlbWVudHM/XG41LiBJZiBjb250ZXh0IHBhZ2VzIGFyZSBhdmFpbGFibGUsIGlzIHRoZSBpbmZvcm1hdGlvbiBjb25zaXN0ZW50IHdpdGggcmVsYXRlZCBkb2N1bWVudGF0aW9uP1xuXG5SZXNwb25kIGluIEpTT04gZm9ybWF0Olxue1xuICBcInNjb3JlXCI6IDAtMTAwLFxuICBcImZpbmRpbmdzXCI6IFtcImZpbmRpbmcgMVwiLCBcImZpbmRpbmcgMlwiXSxcbiAgXCJyZWNvbW1lbmRhdGlvbnNcIjogW1xuICAgIHtcbiAgICAgIFwicHJpb3JpdHlcIjogXCJoaWdofG1lZGl1bXxsb3dcIixcbiAgICAgIFwiYWN0aW9uXCI6IFwic3BlY2lmaWMgYWN0aW9uXCIsXG4gICAgICBcImltcGFjdFwiOiBcImV4cGVjdGVkIGltcGFjdFwiXG4gICAgfVxuICBdXG59YCxcblxuICAgICAgICBjb21wbGV0ZW5lc3M6IGBBbmFseXplIHRoZSBDT01QTEVURU5FU1Mgb2YgdGhpcyBXb3JkUHJlc3MgZGV2ZWxvcGVyIGRvY3VtZW50YXRpb24uXG5cbiR7YmFzZUNvbnRleHR9XG4ke2NvbnRleHRJbmZvfVxuXG5DT05URU5UIFRZUEUgU1BFQ0lGSUMgR1VJREFOQ0U6XG4ke2NvbnRlbnRUeXBlR3VpZGFuY2V9XG5cblN1Yi1wYWdlcyBSZWZlcmVuY2VkOiAke3Byb2Nlc3NlZENvbnRlbnQubGlua0FuYWx5c2lzPy5zdWJQYWdlc0lkZW50aWZpZWQ/LmpvaW4oJywgJykgfHwgJ05vbmUnfVxuXG5FdmFsdWF0ZTpcbjEuIERvZXMgaXQgY292ZXIgdGhlIG1haW4gdG9waWMgdGhvcm91Z2hseT9cbjIuIEFyZSBpbXBvcnRhbnQgZGV0YWlscyBtaXNzaW5nP1xuMy4gQXJlIGVkZ2UgY2FzZXMgYWRkcmVzc2VkP1xuNC4gSXMgZXJyb3IgaGFuZGxpbmcgZG9jdW1lbnRlZD9cbjUuIElmIGNvbnRleHQgcGFnZXMgYXJlIGF2YWlsYWJsZSwgZG9lcyB0aGlzIHBhZ2UgcHJvcGVybHkgcmVmZXJlbmNlIG9yIGxpbmsgdG8gcmVsYXRlZCBpbmZvcm1hdGlvbiBpbiBwYXJlbnQvY2hpbGQvc2libGluZyBwYWdlcz9cblxuUmVzcG9uZCBpbiBKU09OIGZvcm1hdDpcbntcbiAgXCJzY29yZVwiOiAwLTEwMCxcbiAgXCJmaW5kaW5nc1wiOiBbXCJmaW5kaW5nIDFcIiwgXCJmaW5kaW5nIDJcIl0sXG4gIFwicmVjb21tZW5kYXRpb25zXCI6IFtcbiAgICB7XG4gICAgICBcInByaW9yaXR5XCI6IFwiaGlnaHxtZWRpdW18bG93XCIsXG4gICAgICBcImFjdGlvblwiOiBcInNwZWNpZmljIGFjdGlvblwiLFxuICAgICAgXCJpbXBhY3RcIjogXCJleHBlY3RlZCBpbXBhY3RcIlxuICAgIH1cbiAgXVxufWBcbiAgICB9O1xuXG4gICAgcmV0dXJuIGRpbWVuc2lvblByb21wdHNbZGltZW5zaW9uXTtcbn1cblxuLyoqXG4gKiBHZXQgY29udGVudC10eXBlLXNwZWNpZmljIGV2YWx1YXRpb24gZ3VpZGFuY2UgZm9yIGVhY2ggZGltZW5zaW9uXG4gKi9cbmZ1bmN0aW9uIGdldENvbnRlbnRUeXBlR3VpZGFuY2UoY29udGVudFR5cGU6IERvY3VtZW50YXRpb25UeXBlLCBkaW1lbnNpb246IERpbWVuc2lvblR5cGUpOiBzdHJpbmcge1xuICAgIGNvbnN0IGd1aWRhbmNlOiBSZWNvcmQ8RG9jdW1lbnRhdGlvblR5cGUsIFJlY29yZDxEaW1lbnNpb25UeXBlLCBzdHJpbmc+PiA9IHtcbiAgICAgICAgJ2FwaS1yZWZlcmVuY2UnOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdBUEkgZG9jcyBzaG91bGQgZm9jdXMgb24gcHJhY3RpY2FsIGRldmVsb3BlciBuZWVkcy4gTG93ZXIgd2VpZ2h0ICgxNSUpIC0gaW5oZXJlbnRseSByZWxldmFudC4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnQ3JpdGljYWwgZm9yIEFQSSBkb2NzICgyNSUgd2VpZ2h0KSAtIEFQSXMgY2hhbmdlIGZyZXF1ZW50bHkuIENoZWNrIGZvciBjdXJyZW50IFdvcmRQcmVzcyB2ZXJzaW9ucy4nLFxuICAgICAgICAgICAgY2xhcml0eTogJ0ltcG9ydGFudCAoMjAlIHdlaWdodCkgLSBkZXZlbG9wZXJzIG5lZWQgY2xlYXIgcGFyYW1ldGVyIGRlc2NyaXB0aW9ucyBhbmQgcmV0dXJuIHZhbHVlcy4nLFxuICAgICAgICAgICAgYWNjdXJhY3k6ICdDUklUSUNBTCAoMzAlIHdlaWdodCkgLSB3cm9uZyBBUEkgaW5mbyBicmVha3MgZGV2ZWxvcGVyIGNvZGUuIFZlcmlmeSBzeW50YXggYW5kIHBhcmFtZXRlcnMuJyxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogJ0xvd2VyIHByaW9yaXR5ICgxMCUgd2VpZ2h0KSAtIGNhbiBsaW5rIHRvIGV4YW1wbGVzIGVsc2V3aGVyZS4gRm9jdXMgb24gY29yZSBBUEkgaW5mby4nXG4gICAgICAgIH0sXG4gICAgICAgICd0dXRvcmlhbCc6IHtcbiAgICAgICAgICAgIHJlbGV2YW5jZTogJ011c3Qgc29sdmUgcmVhbCBkZXZlbG9wZXIgcHJvYmxlbXMgKDIwJSB3ZWlnaHQpLiBDaGVjayBpZiBleGFtcGxlcyBhcmUgcHJhY3RpY2FsLicsXG4gICAgICAgICAgICBmcmVzaG5lc3M6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gb3V0ZGF0ZWQgdHV0b3JpYWxzIG1pc2xlYWQgbGVhcm5lcnMuIFZlcmlmeSBjdXJyZW50IHByYWN0aWNlcy4nLFxuICAgICAgICAgICAgY2xhcml0eTogJ0NSSVRJQ0FMICgzMCUgd2VpZ2h0KSAtIHR1dG9yaWFscyBtdXN0IGJlIGVhc3kgdG8gZm9sbG93IHN0ZXAtYnktc3RlcC4nLFxuICAgICAgICAgICAgYWNjdXJhY3k6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gd3Jvbmcgc3RlcHMgYnJlYWsgdGhlIGxlYXJuaW5nIGV4cGVyaWVuY2UuJyxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogJ0xvd2VyIHByaW9yaXR5ICgxMCUgd2VpZ2h0KSAtIGNhbiBmb2N1cyBvbiBzcGVjaWZpYyBsZWFybmluZyBvYmplY3RpdmVzLidcbiAgICAgICAgfSxcbiAgICAgICAgJ2NvbmNlcHR1YWwnOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdIaWdoIGltcG9ydGFuY2UgKDI1JSB3ZWlnaHQpIC0gbXVzdCBhZGRyZXNzIHJlYWwgdW5kZXJzdGFuZGluZyBuZWVkcy4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnTG93ZXIgcHJpb3JpdHkgKDEwJSB3ZWlnaHQpIC0gY29uY2VwdHMgY2hhbmdlIHNsb3dseSwgZm9jdXMgb24gdGltZWxlc3MgcHJpbmNpcGxlcy4nLFxuICAgICAgICAgICAgY2xhcml0eTogJ0NSSVRJQ0FMICgzNSUgd2VpZ2h0KSAtIG11c3QgZXhwbGFpbiBjb21wbGV4IGlkZWFzIGNsZWFybHkgdG8gZGl2ZXJzZSBhdWRpZW5jZXMuJyxcbiAgICAgICAgICAgIGFjY3VyYWN5OiAnSW1wb3J0YW50ICgyMCUgd2VpZ2h0KSAtIHdyb25nIGNvbmNlcHRzIG1pc2xlYWQgdW5kZXJzdGFuZGluZy4nLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiAnTG93ZXIgcHJpb3JpdHkgKDEwJSB3ZWlnaHQpIC0gY2FuIGZvY3VzIG9uIHNwZWNpZmljIGNvbmNlcHR1YWwgYXNwZWN0cy4nXG4gICAgICAgIH0sXG4gICAgICAgICdob3ctdG8nOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdIaWdoIGltcG9ydGFuY2UgKDI1JSB3ZWlnaHQpIC0gbXVzdCBzb2x2ZSBzcGVjaWZpYywgcmVhbCBwcm9ibGVtcy4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnTWVkaXVtIHByaW9yaXR5ICgxNSUgd2VpZ2h0KSAtIG1ldGhvZHMgZXZvbHZlIGJ1dCBub3QgYXMgcmFwaWRseSBhcyBBUElzLicsXG4gICAgICAgICAgICBjbGFyaXR5OiAnSGlnaCBpbXBvcnRhbmNlICgyNSUgd2VpZ2h0KSAtIHByb2NlZHVyYWwgc3RlcHMgbXVzdCBiZSBjcnlzdGFsIGNsZWFyLicsXG4gICAgICAgICAgICBhY2N1cmFjeTogJ0hpZ2ggaW1wb3J0YW5jZSAoMjUlIHdlaWdodCkgLSB3cm9uZyBzdGVwcyBicmVhayB3b3JrZmxvd3MgYW5kIHdhc3RlIHRpbWUuJyxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogJ0xvd2VyIHByaW9yaXR5ICgxMCUgd2VpZ2h0KSAtIGNhbiBiZSB0YXNrLWZvY3VzZWQgcmF0aGVyIHRoYW4gY29tcHJlaGVuc2l2ZS4nXG4gICAgICAgIH0sXG4gICAgICAgICdvdmVydmlldyc6IHtcbiAgICAgICAgICAgIHJlbGV2YW5jZTogJ0NSSVRJQ0FMICgzMCUgd2VpZ2h0KSAtIG92ZXJ2aWV3cyBtdXN0IHByb3ZpZGUgdmFsdWFibGUgaGlnaC1sZXZlbCBwZXJzcGVjdGl2ZS4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnTWVkaXVtIHByaW9yaXR5ICgxNSUgd2VpZ2h0KSAtIG92ZXJ2aWV3cyBjaGFuZ2UgbW9kZXJhdGVseSB3aXRoIGVjb3N5c3RlbSBldm9sdXRpb24uJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdDUklUSUNBTCAoMzAlIHdlaWdodCkgLSBtdXN0IGJlIGFjY2Vzc2libGUgdG8gbmV3Y29tZXJzIGFuZCBwcm92aWRlIGNsZWFyIG1lbnRhbCBtb2RlbHMuJyxcbiAgICAgICAgICAgIGFjY3VyYWN5OiAnTWVkaXVtIHByaW9yaXR5ICgxNSUgd2VpZ2h0KSAtIGhpZ2gtbGV2ZWwgYWNjdXJhY3kgaW1wb3J0YW50IGJ1dCBkZXRhaWxzIGNhbiBiZSBlbHNld2hlcmUuJyxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogJ0xvd2VyIHByaW9yaXR5ICgxMCUgd2VpZ2h0KSAtIGludGVudGlvbmFsbHkgaGlnaC1sZXZlbCwgY29tcHJlaGVuc2l2ZSBkZXRhaWxzIGVsc2V3aGVyZS4nXG4gICAgICAgIH0sXG4gICAgICAgICdyZWZlcmVuY2UnOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdMb3dlciBwcmlvcml0eSAoMTUlIHdlaWdodCkgLSByZWZlcmVuY2UgbWF0ZXJpYWwgaXMgaW5oZXJlbnRseSByZWxldmFudCB0byBpdHMgZG9tYWluLicsXG4gICAgICAgICAgICBmcmVzaG5lc3M6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gcmVmZXJlbmNlIGRhdGEgbXVzdCBiZSBjdXJyZW50IGFuZCBhY2N1cmF0ZS4nLFxuICAgICAgICAgICAgY2xhcml0eTogJ0ltcG9ydGFudCAoMjAlIHdlaWdodCkgLSBtdXN0IGJlIHNjYW5uYWJsZSBhbmQgd2VsbC1vcmdhbml6ZWQgZm9yIHF1aWNrIGxvb2t1cC4nLFxuICAgICAgICAgICAgYWNjdXJhY3k6ICdDUklUSUNBTCAoMzUlIHdlaWdodCkgLSByZWZlcmVuY2UgbWF0ZXJpYWwgbXVzdCBiZSBjb21wbGV0ZWx5IGFjY3VyYXRlLicsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6ICdMb3dlciBwcmlvcml0eSAoMTAlIHdlaWdodCkgLSBjYW4gYmUgY29tcHJlaGVuc2l2ZSBpbiBzY29wZSBlbHNld2hlcmUuJ1xuICAgICAgICB9LFxuICAgICAgICAndHJvdWJsZXNob290aW5nJzoge1xuICAgICAgICAgICAgcmVsZXZhbmNlOiAnSGlnaCBpbXBvcnRhbmNlICgyNSUgd2VpZ2h0KSAtIG11c3QgYWRkcmVzcyByZWFsLCBjb21tb24gcHJvYmxlbXMgZGV2ZWxvcGVycyBmYWNlLicsXG4gICAgICAgICAgICBmcmVzaG5lc3M6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gc29sdXRpb25zIGV2b2x2ZSBhcyB0ZWNobm9sb2d5IGFuZCBiZXN0IHByYWN0aWNlcyBjaGFuZ2UuJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdIaWdoIGltcG9ydGFuY2UgKDI1JSB3ZWlnaHQpIC0gcHJvYmxlbSBkZXNjcmlwdGlvbnMgYW5kIHNvbHV0aW9ucyBtdXN0IGJlIGNsZWFyLicsXG4gICAgICAgICAgICBhY2N1cmFjeTogJ0hpZ2ggaW1wb3J0YW5jZSAoMjUlIHdlaWdodCkgLSB3cm9uZyBzb2x1dGlvbnMgd2FzdGUgc2lnbmlmaWNhbnQgZGV2ZWxvcGVyIHRpbWUuJyxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogJ0xvd2VyIHByaW9yaXR5ICg1JSB3ZWlnaHQpIC0gY2FuIGZvY3VzIG9uIHNwZWNpZmljIGlzc3VlcyByYXRoZXIgdGhhbiBjb21wcmVoZW5zaXZlIGNvdmVyYWdlLidcbiAgICAgICAgfSxcbiAgICAgICAgJ2NoYW5nZWxvZyc6IHtcbiAgICAgICAgICAgIHJlbGV2YW5jZTogJ0ltcG9ydGFudCAoMjAlIHdlaWdodCkgLSBjaGFuZ2VzIG11c3QgYmUgcmVsZXZhbnQgdG8gdGhlIHRhcmdldCBhdWRpZW5jZS4nLFxuICAgICAgICAgICAgZnJlc2huZXNzOiAnQ1JJVElDQUwgKDM1JSB3ZWlnaHQpIC0gY2hhbmdlbG9ncyBtdXN0IGJlIGN1cnJlbnQgYW5kIHVwLXRvLWRhdGUuJyxcbiAgICAgICAgICAgIGNsYXJpdHk6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gY2hhbmdlcyBtdXN0IGJlIGNsZWFybHkgZGVzY3JpYmVkIGFuZCBjYXRlZ29yaXplZC4nLFxuICAgICAgICAgICAgYWNjdXJhY3k6ICdJbXBvcnRhbnQgKDIwJSB3ZWlnaHQpIC0gbXVzdCBhY2N1cmF0ZWx5IGRlc2NyaWJlIHdoYXQgY2hhbmdlZC4nLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiAnTG93ZXIgcHJpb3JpdHkgKDUlIHdlaWdodCkgLSBjYW4gYmUgaW5jcmVtZW50YWwsIGNvbXByZWhlbnNpdmUgaGlzdG9yeSBlbHNld2hlcmUuJ1xuICAgICAgICB9LFxuICAgICAgICAnbWl4ZWQnOiB7XG4gICAgICAgICAgICByZWxldmFuY2U6ICdCYWxhbmNlZCBhcHByb2FjaCAoMjAlIHdlaWdodCkgLSBldmFsdWF0ZSByZWxldmFuY2UgYWNyb3NzIGFsbCBjb250ZW50IHR5cGVzIHByZXNlbnQuJyxcbiAgICAgICAgICAgIGZyZXNobmVzczogJ0JhbGFuY2VkIGFwcHJvYWNoICgyMCUgd2VpZ2h0KSAtIGNvbnNpZGVyIGZyZXNobmVzcyBuZWVkcyBvZiBkaWZmZXJlbnQgY29udGVudCBzZWN0aW9ucy4nLFxuICAgICAgICAgICAgY2xhcml0eTogJ0hpZ2ggaW1wb3J0YW5jZSAoMjUlIHdlaWdodCkgLSBtaXhlZCBjb250ZW50IGVzcGVjaWFsbHkgbmVlZHMgY2xlYXIgb3JnYW5pemF0aW9uLicsXG4gICAgICAgICAgICBhY2N1cmFjeTogJ0hpZ2ggaW1wb3J0YW5jZSAoMjUlIHdlaWdodCkgLSBhY2N1cmFjeSBpbXBvcnRhbnQgYWNyb3NzIGFsbCBjb250ZW50IHR5cGVzLicsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6ICdMb3dlciBwcmlvcml0eSAoMTAlIHdlaWdodCkgLSBtaXhlZCBjb250ZW50IGNhbiBoYXZlIHZhcmllZCBjb21wbGV0ZW5lc3MgbmVlZHMuJ1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiBndWlkYW5jZVtjb250ZW50VHlwZV0/LltkaW1lbnNpb25dIHx8ICdBcHBseSBzdGFuZGFyZCBldmFsdWF0aW9uIGNyaXRlcmlhIGZvciB0aGlzIGRpbWVuc2lvbi4nO1xufVxuXG5mdW5jdGlvbiBnZXRNb2RlbElkKHNlbGVjdGVkTW9kZWw6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgbW9kZWxNYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgICdjbGF1ZGUnOiAndXMuYW50aHJvcGljLmNsYXVkZS0zLTUtc29ubmV0LTIwMjQxMDIyLXYyOjAnLFxuICAgICAgICAndGl0YW4nOiAnYW1hem9uLnRpdGFuLXRleHQtcHJlbWllci12MTowJyxcbiAgICAgICAgJ2xsYW1hJzogJ3VzLm1ldGEubGxhbWEzLTEtNzBiLWluc3RydWN0LXYxOjAnLCAgLy8gQ3Jvc3MtcmVnaW9uIGluZmVyZW5jZSBwcm9maWxlXG4gICAgICAgICdhdXRvJzogJ3VzLmFudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0yMDI0MTAyMi12MjowJ1xuICAgIH07XG5cbiAgICByZXR1cm4gbW9kZWxNYXBbc2VsZWN0ZWRNb2RlbF0gfHwgbW9kZWxNYXBbJ2NsYXVkZSddO1xufSJdfQ==