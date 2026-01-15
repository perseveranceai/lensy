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
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const baseContext = `
Analysis Date: ${today}
URL: ${processedContent.url}
Content Type: ${contentType} (${dimension} weight: ${Math.round(weights[dimension] * 100)}%)
Code Snippets: ${processedContent.codeSnippets?.length || 0}
Media Elements: ${processedContent.mediaElements?.length || 0}
Total Links: ${processedContent.linkAnalysis?.totalLinks || 0}

Content (first 3000 chars):
${processedContent.markdownContent?.slice(0, 50000) || ''}
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
        relevance: `Analyze the RELEVANCE of this technical developer documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Evaluate:
1. Is the content relevant to the target developer audience?
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
        freshness: `Analyze the FRESHNESS of this technical developer documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Code Snippets with Version Info:
${processedContent.codeSnippets?.filter((s) => s.hasVersionInfo).map((s) => s.code.slice(0, 200)).join('\n---\n') || 'None'}

Evaluate:
1. Are version references current and accurate?
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
        clarity: `Analyze the CLARITY of this technical developer documentation.

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
        accuracy: `Analyze the ACCURACY of this technical developer documentation.

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
        completeness: `Analyze the COMPLETENESS of this technical developer documentation.

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
            freshness: 'Critical for API docs (25% weight) - APIs change frequently. Check for current version references.',
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
