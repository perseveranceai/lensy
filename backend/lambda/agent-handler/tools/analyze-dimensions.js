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
exports.analyzeDimensionsTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const crypto = __importStar(require("crypto"));
const s3_helpers_1 = require("../shared/s3-helpers");
const bedrock_helpers_1 = require("../shared/bedrock-helpers");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const publish_progress_1 = require("./publish-progress");
// ---------------------------------------------------------------------------
// Content-type-specific scoring weights (must sum to 1.0)
// ---------------------------------------------------------------------------
const CONTENT_TYPE_WEIGHTS = {
    'api-reference': {
        relevance: 0.15,
        freshness: 0.25,
        clarity: 0.20,
        accuracy: 0.30,
        completeness: 0.10
    },
    'tutorial': {
        relevance: 0.20,
        freshness: 0.20,
        clarity: 0.30,
        accuracy: 0.20,
        completeness: 0.10
    },
    'conceptual': {
        relevance: 0.25,
        freshness: 0.10,
        clarity: 0.35,
        accuracy: 0.20,
        completeness: 0.10
    },
    'how-to': {
        relevance: 0.25,
        freshness: 0.15,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.10
    },
    'overview': {
        relevance: 0.30,
        freshness: 0.15,
        clarity: 0.30,
        accuracy: 0.15,
        completeness: 0.10
    },
    'reference': {
        relevance: 0.15,
        freshness: 0.20,
        clarity: 0.20,
        accuracy: 0.35,
        completeness: 0.10
    },
    'troubleshooting': {
        relevance: 0.25,
        freshness: 0.20,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.05
    },
    'changelog': {
        relevance: 0.20,
        freshness: 0.35,
        clarity: 0.20,
        accuracy: 0.20,
        completeness: 0.05
    },
    'product-guide': {
        relevance: 0.20,
        freshness: 0.15,
        clarity: 0.35,
        accuracy: 0.20,
        completeness: 0.10
    },
    'mixed': {
        relevance: 0.20,
        freshness: 0.20,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.10
    }
};
const DIMENSIONS = ['relevance', 'freshness', 'clarity', 'accuracy', 'completeness'];
// ---------------------------------------------------------------------------
// Module-level DynamoDB client
// ---------------------------------------------------------------------------
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
// ---------------------------------------------------------------------------
// URL normalization & cache key helpers
// ---------------------------------------------------------------------------
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
/**
 * Generate consistent session ID based on URL and context setting.
 * Must match the function in URL processor exactly.
 */
function generateConsistentSessionId(url, contextualSetting) {
    const normalizedUrl = normalizeUrl(url);
    const input = `${normalizedUrl}#${contextualSetting}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `session-${hash.substring(0, 12)}`;
}
// ---------------------------------------------------------------------------
// DynamoDB dimension cache — check
// ---------------------------------------------------------------------------
async function checkDimensionCache(bucketName, processedContent, contextualSetting, _selectedModel) {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping dimension cache check');
            return null;
        }
        const cleanUrl = normalizeUrl(processedContent.url);
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
        console.log('Found cache entry, checking for dimension results...');
        const contentS3Path = cacheEntry.s3Location; // e.g. sessions/session-abc123/processed-content.json
        const sessionPath = contentS3Path.replace('/processed-content.json', '');
        const dimensionS3Path = `${sessionPath}/dimension-results.json`;
        try {
            const dimensionResults = await (0, s3_helpers_1.readFromS3)(bucketName, dimensionS3Path);
            if (dimensionResults) {
                console.log(`Found cached dimension results at: ${dimensionS3Path}`);
                return dimensionResults;
            }
            console.log(`No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        }
        catch (s3Error) {
            console.log(`No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        }
    }
    catch (error) {
        console.error('Error checking dimension cache:', error);
        return null;
    }
}
// ---------------------------------------------------------------------------
// DynamoDB dimension cache — store
// ---------------------------------------------------------------------------
async function cacheDimensionResults(bucketName, processedContent, contextualSetting, _selectedModel, dimensionResults) {
    try {
        const consistentSessionId = generateConsistentSessionId(processedContent.url, contextualSetting);
        const dimensionS3Path = `sessions/${consistentSessionId}/dimension-results.json`;
        await (0, s3_helpers_1.writeToS3)(bucketName, dimensionS3Path, dimensionResults);
        console.log(`Cached dimension results at: ${dimensionS3Path}`);
    }
    catch (error) {
        console.error('Failed to cache dimension results:', error);
        // Don't throw — caching failure shouldn't break the main flow
    }
}
// ---------------------------------------------------------------------------
// Content-type-aware scoring weights
// ---------------------------------------------------------------------------
function applyContentTypeWeights(dimensionResults, contentType) {
    const weights = CONTENT_TYPE_WEIGHTS[contentType];
    const weightedResults = { ...dimensionResults };
    Object.keys(weightedResults).forEach(dimension => {
        const dim = dimension;
        const result = weightedResults[dim];
        if (result.score !== null) {
            result.originalScore = result.score;
            result.contentTypeWeight = weights[dim];
            result.contentType = contentType;
            result.findings.unshift(`Content type: ${contentType} (weight: ${Math.round(weights[dim] * 100)}%)`);
        }
    });
    console.log(`Applied weights for ${contentType}:`, weights);
    return weightedResults;
}
// ---------------------------------------------------------------------------
// Single dimension analysis via Bedrock
// ---------------------------------------------------------------------------
async function analyzeDimension(dimension, processedContent, selectedModel) {
    const prompt = buildPromptForDimension(dimension, processedContent);
    const modelId = (0, bedrock_helpers_1.getModelId)(selectedModel);
    // Different models use different API formats
    let requestBody;
    let responseParser;
    if (selectedModel === 'llama') {
        requestBody = {
            prompt: prompt,
            max_gen_len: 2000,
            temperature: 0.1,
            top_p: 0.9
        };
        responseParser = (responseBody) => responseBody.generation;
    }
    else if (selectedModel === 'titan') {
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
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2000,
            temperature: 0.1,
            messages: [
                {
                    role: 'user',
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
    const response = await bedrock_helpers_1.bedrockClient.send(command);
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
        processingTime: 0, // Will be set by caller
        spellingIssues: analysis.spellingIssues,
        codeIssues: analysis.codeIssues,
        terminologyInconsistencies: analysis.terminologyInconsistencies
    };
}
// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
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
    // Context analysis information — with rich KB data when available
    let contextInfo = '';
    if (processedContent.contextAnalysis && processedContent.contextAnalysis.contextPages?.length > 0) {
        const hasKBData = processedContent.contextAnalysis.contextPages.some((page) => page.topic);
        if (hasKBData) {
            contextInfo = `
KNOWLEDGE BASE — RELATED PAGES:
The following pages are linked from or related to the target page. Each entry shows
what that page covers, based on prior analysis.

${processedContent.contextAnalysis.contextPages.map((page) => {
                if (page.topic) {
                    return `- ${page.relationship.toUpperCase()}: "${page.title}" [${page.url}]
  Type: ${page.documentationType || 'unknown'}
  Topic: ${page.topic}
  Covers: ${page.covers?.join(', ') || 'unknown'}
  Code Examples: ${page.codeExamples || 'None'}`;
                }
                else {
                    return `- ${page.relationship.toUpperCase()}: "${page.title}" [${page.url}]
  (No detailed analysis available for this page)`;
                }
            }).join('\n\n')}

GROUNDING RULES FOR RECOMMENDATIONS:
1. Before recommending "add X" to this page, CHECK the Knowledge Base above.
   If a related page already covers X, do NOT recommend adding it here.
2. Instead, evaluate whether the TARGET PAGE adequately LINKS TO or REFERENCES
   that related page.
3. Frame recommendations as structural, not additive:
   WRONG: "Add version compatibility information and system requirements"
   RIGHT: "Version and system requirement info is covered on the linked 'Current Releases' page.
          Consider adding a cross-reference link or brief summary with a 'see Current Releases
          for details' pointer."
4. If the target page is a TOC/overview, evaluate navigation completeness —
   not whether each topic is fully explained inline.
5. Always cite which related page covers the topic when deferring to it.
`;
        }
        else {
            contextInfo = `
CONTEXT ANALYSIS ENABLED:
Analysis Scope: ${processedContent.contextAnalysis.analysisScope}
Total Pages Analyzed: ${processedContent.contextAnalysis.totalPagesAnalyzed}
Related Pages Discovered:
${processedContent.contextAnalysis.contextPages.map((page) => `- ${page.relationship.toUpperCase()}: "${page.title}" [${page.url}]`).join('\n')}

Consider this broader documentation context when evaluating the target page.
The target page is part of a larger documentation structure, so evaluate how well it fits
within this context and whether it properly references or builds upon related pages.
`;
        }
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

CONSTRAINTS:
- Only reference issues observable in the provided content above.
- Do NOT suggest checking console errors, network requests, runtime behavior, or browser developer tools.
- Do NOT recommend actions that require running code, visiting the page, or testing interactively.
- This system analyzes static HTML content only. All recommendations must be actionable from the content alone.
- Every recommendation MUST include an "evidence" field with an exact quote or specific element from the content that triggered it.

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact",
      "evidence": "exact quote or element from content that triggered this recommendation",
      "location": "heading or section where the issue appears"
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

CONSTRAINTS:
- Only reference issues observable in the provided content above.
- Do NOT suggest checking console errors, network requests, runtime behavior, or browser developer tools.
- Do NOT recommend actions that require running code, visiting the page, or testing interactively.
- This system analyzes static HTML content only. All recommendations must be actionable from the content alone.
- Every recommendation MUST include an "evidence" field with an exact quote or specific element from the content that triggered it.

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact",
      "evidence": "exact quote or element from content that triggered this recommendation",
      "location": "heading or section where the issue appears"
    }
  ]
}`,
        clarity: `Analyze the CLARITY of this technical documentation.

${baseContext}
${contextInfo}

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

CRITICAL: CHECK FOR SPELLING AND TYPOS
Scan the ENTIRE content for spelling errors and typos. This is a high-priority check.

Evaluate:
1. Is the content well-structured and organized?
2. SPELLING & TYPOS: Identify any misspelled words or typos (e.g., "clech" vs "check", "teh" vs "the").
3. TERMINOLOGY: Is terminology consistent (e.g., "Agent" vs "Bot")?
4. Is technical jargon explained for the target audience?
5. Are instructions easy to follow?

CONSTRAINTS:
- Only reference issues observable in the provided content above.
- Do NOT suggest checking console errors, network requests, runtime behavior, or browser developer tools.
- Do NOT recommend actions that require running code, visiting the page, or testing interactively.
- This system analyzes static HTML content only. All recommendations must be actionable from the content alone.
- Every recommendation MUST include an "evidence" field with an exact quote or specific element from the content that triggered it.

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "spellingIssues": [
    {"incorrect": "word", "correct": "word", "context": "surrounding text snippet"}
  ],
  "terminologyInconsistencies": [
    {"variants": ["term1", "term2"], "recommendation": "Use 'term1' consistently"}
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact",
      "evidence": "exact quote or element from content that triggered this recommendation",
      "location": "heading or section where the issue appears"
    }
  ]
}`,
        accuracy: `Analyze the ACCURACY of this technical documentation.

${baseContext}
${contextInfo}

IMPORTANT: Today's date is ${today}. Do NOT flag dates as "future-dated" if they are on or before today's date.

CONTENT TYPE SPECIFIC GUIDANCE:
${contentTypeGuidance}

Code Snippets:
${processedContent.codeSnippets?.map((s) => `Language: ${s.language}\n${s.code.slice(0, 300)}`).join('\n---\n') || 'None'}

Evaluate:
1. Are code examples syntactically correct?
2. JSON VALIDATION: Are JSON configuration examples valid? Check for missing quotes, trailing commas, or unbalanced braces.
3. CONFIGURATION: Are placeholder values (e.g., <YOUR_KEY>) clearly marked?
4. Is API usage accurate?
5. Are there any misleading statements?
6. DATE ACCURACY: Only flag dates as "future-dated" if they are AFTER ${today}.

CONSTRAINTS:
- Only reference issues observable in the provided content above.
- Do NOT suggest checking console errors, network requests, runtime behavior, or browser developer tools.
- Do NOT recommend actions that require running code, visiting the page, or testing interactively.
- This system analyzes static HTML content only. All recommendations must be actionable from the content alone.
- Every recommendation MUST include an "evidence" field with an exact quote or specific element from the content that triggered it.

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "codeIssues": [
    {
      "type": "json-syntax" | "config-incomplete" | "other",
      "location": "description of location",
      "description": "what is wrong",
      "codeFragment": "snippet"
    }
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact",
      "evidence": "exact quote or element from content that triggered this recommendation",
      "location": "heading or section where the issue appears"
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

CONSTRAINTS:
- Only reference issues observable in the provided content above.
- Do NOT suggest checking console errors, network requests, runtime behavior, or browser developer tools.
- Do NOT recommend actions that require running code, visiting the page, or testing interactively.
- This system analyzes static HTML content only. All recommendations must be actionable from the content alone.
- Every recommendation MUST include an "evidence" field with an exact quote or specific element from the content that triggered it.

Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action",
      "impact": "expected impact",
      "evidence": "exact quote or element from content that triggered this recommendation",
      "location": "heading or section where the issue appears"
    }
  ]
}`
    };
    return dimensionPrompts[dimension];
}
// ---------------------------------------------------------------------------
// Content-type-specific evaluation guidance
// ---------------------------------------------------------------------------
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
        'product-guide': {
            relevance: 'Medium (20%) - must help non-technical users achieve goals.',
            freshness: 'Medium (15%) - check if screenshots match described UI.',
            clarity: 'CRITICAL (35%) - check for TYPOS, spelling errors, and jargon. Must be crystal clear.',
            accuracy: 'Important (20%) - validate all JSON payloads and curl commands.',
            completeness: 'Low (10%) - focus on happy-path task completion.'
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
// ---------------------------------------------------------------------------
// The LangGraph tool
// ---------------------------------------------------------------------------
exports.analyzeDimensionsTool = (0, tools_1.tool)(async (input) => {
    console.log('analyze_dimensions: Starting for session:', input.sessionId);
    const progress = (0, publish_progress_1.createProgressHelper)(input.sessionId);
    try {
        const bucketName = s3_helpers_1.ANALYSIS_BUCKET;
        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }
        // ---------------------------------------------------------------
        // 1. Retrieve processed content from S3
        // ---------------------------------------------------------------
        const processedContent = await (0, s3_helpers_1.readSessionArtifact)(input.sessionId, 'processed-content.json');
        if (!processedContent) {
            return JSON.stringify({
                success: false,
                error: 'No processed content found. Run process_url first.'
            });
        }
        console.log('Retrieved processed content from S3');
        // ---------------------------------------------------------------
        // 2. Check DynamoDB / S3 cache (if caching is enabled)
        // ---------------------------------------------------------------
        const cacheEnabled = input.cacheEnabled !== false;
        const contextualSetting = processedContent.contextAnalysis?.contextPages?.length > 0
            ? 'with-context'
            : 'without-context';
        let cachedResults = null;
        if (cacheEnabled) {
            cachedResults = await checkDimensionCache(bucketName, processedContent, contextualSetting, input.selectedModel);
        }
        else {
            console.log('Cache disabled by user - skipping dimension cache check');
        }
        if (cachedResults) {
            console.log('Dimension analysis cache hit! Using cached results');
            await progress.cacheHit('Retrieved: 5/5 dimensions from cache');
            // Store cached results in this session's location
            await (0, s3_helpers_1.writeSessionArtifact)(input.sessionId, 'dimension-results.json', cachedResults);
            // Compute summary from cached results
            return buildSummaryJson(cachedResults, input.selectedModel, true);
        }
        console.log('Dimension analysis cache miss - running fresh analysis');
        // ---------------------------------------------------------------
        // 3. Structure detection progress message
        // ---------------------------------------------------------------
        await progress.success('Structure detected: Topics identified', {
            phase: 'structure-detection'
        });
        // ---------------------------------------------------------------
        // 4. Run all 5 dimensions IN PARALLEL
        // ---------------------------------------------------------------
        console.log('Starting parallel dimension analysis...');
        const dimensionPromises = DIMENSIONS.map(async (dimension, index) => {
            const startTime = Date.now();
            console.log(`Starting ${dimension} analysis`);
            await progress.progress(`Analyzing ${dimension.charAt(0).toUpperCase() + dimension.slice(1)} (${index + 1}/5)...`, 'dimension-analysis', { dimension });
            try {
                const result = await analyzeDimension(dimension, processedContent, input.selectedModel);
                const processingTime = Date.now() - startTime;
                console.log(JSON.stringify({
                    sessionId: input.sessionId, tool: 'analyze_dimensions', event: 'dimension_scored',
                    dimension, score: result.score, findingCount: result.findings?.length || 0,
                    recommendationCount: result.recommendations?.length || 0, durationMs: processingTime,
                }));
                await progress.success(`${dimension.charAt(0).toUpperCase() + dimension.slice(1)}: ${result.score}/100 (${(processingTime / 1000).toFixed(1)}s)`, { dimension, score: result.score || undefined, processingTime });
                return {
                    dimension,
                    result: { ...result, processingTime }
                };
            }
            catch (error) {
                console.error(`${dimension} failed:`, error);
                await progress.error(`${dimension.charAt(0).toUpperCase() + dimension.slice(1)} failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { dimension });
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
        const results = await Promise.all(dimensionPromises);
        // ---------------------------------------------------------------
        // 5. Convert to record and apply content-type weights
        // ---------------------------------------------------------------
        const dimensionResults = {};
        results.forEach(({ dimension, result }) => {
            dimensionResults[dimension] = result;
        });
        const contentType = processedContent.contentType || 'mixed';
        let weightedResults = applyContentTypeWeights(dimensionResults, contentType);
        // ---------------------------------------------------------------
        // 6. URL slug penalty: -5 per HIGH confidence typo (max -25)
        // ---------------------------------------------------------------
        if (processedContent.urlSlugAnalysis?.issues?.length > 0 && weightedResults.clarity) {
            const issues = processedContent.urlSlugAnalysis.issues;
            let penalty = 0;
            issues.forEach((issue) => {
                if (issue.confidence === 'HIGH')
                    penalty += 5;
                else if (issue.confidence === 'MEDIUM')
                    penalty += 3;
            });
            const finalPenalty = Math.min(25, penalty);
            if (finalPenalty > 0 && weightedResults.clarity.score !== null) {
                const originalClarity = weightedResults.clarity.score;
                weightedResults.clarity.score = Math.max(0, originalClarity - finalPenalty);
                weightedResults.clarity.findings.push(`URL slug penalty: Clarity score reduced by ${finalPenalty} points due to ${issues.length} URL slug quality issues (typos detected).`);
                console.log(`Applied URL slug penalty: -${finalPenalty} points to Clarity (from ${originalClarity} to ${weightedResults.clarity.score})`);
            }
        }
        console.log(`Applied content-type-aware weights for: ${contentType}`);
        console.log('All dimensions analyzed in parallel');
        // ---------------------------------------------------------------
        // 7. Persist results to session S3 path
        // ---------------------------------------------------------------
        await (0, s3_helpers_1.writeSessionArtifact)(input.sessionId, 'dimension-results.json', weightedResults);
        // ---------------------------------------------------------------
        // 8. Cache results for future use
        // ---------------------------------------------------------------
        if (cacheEnabled) {
            await cacheDimensionResults(bucketName, processedContent, contextualSetting, input.selectedModel, weightedResults);
        }
        else {
            console.log('Cache disabled - skipping dimension cache storage');
        }
        console.log('Dimension analysis completed and stored in S3');
        // ---------------------------------------------------------------
        // 9. Return summary JSON
        // ---------------------------------------------------------------
        return buildSummaryJson(weightedResults, input.selectedModel, false);
    }
    catch (error) {
        console.error('Dimension analysis failed:', error);
        return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}, {
    name: 'analyze_dimensions',
    description: 'Performs a 5-dimension quality analysis (relevance, freshness, clarity, accuracy, completeness) on documentation content using parallel Bedrock calls. ' +
        'Reads processed content from S3, checks DynamoDB cache, scores each dimension 0-100 with content-type-aware weighting, and detects spelling issues, ' +
        'terminology inconsistencies, and code issues. Stores results at sessions/{sessionId}/dimension-results.json. Must be called AFTER process_url.',
    schema: zod_1.z.object({
        url: zod_1.z.string().describe('The documentation URL being analyzed'),
        sessionId: zod_1.z.string().describe('The analysis session ID'),
        selectedModel: zod_1.z.string().default('claude').describe('The AI model to use (claude, titan, llama, auto)'),
        cacheEnabled: zod_1.z.boolean().optional().default(true).describe('Whether to use DynamoDB caching (default: true)')
    })
});
// ---------------------------------------------------------------------------
// Build a JSON summary for the tool return value
// ---------------------------------------------------------------------------
function buildSummaryJson(dimensionResults, selectedModel, fromCache) {
    // Compute overall weighted score
    const completed = DIMENSIONS.filter(d => dimensionResults[d]?.score !== null);
    const overallScore = completed.length > 0
        ? Math.round(completed.reduce((sum, d) => {
            const r = dimensionResults[d];
            const weight = r.contentTypeWeight ?? 0.20;
            return sum + (r.score ?? 0) * weight;
        }, 0) / completed.reduce((sum, d) => sum + (dimensionResults[d].contentTypeWeight ?? 0.20), 0))
        : null;
    // Collect key findings across all dimensions
    const keyFindings = [];
    const allSpellingIssues = [];
    const allCodeIssues = [];
    const allTerminologyInconsistencies = [];
    DIMENSIONS.forEach(dim => {
        const r = dimensionResults[dim];
        if (!r)
            return;
        // Top findings (skip the weight metadata line)
        r.findings
            .filter(f => !f.startsWith('Content type:'))
            .slice(0, 2)
            .forEach(f => keyFindings.push(`[${dim}] ${f}`));
        if (r.spellingIssues?.length)
            allSpellingIssues.push(...r.spellingIssues);
        if (r.codeIssues?.length)
            allCodeIssues.push(...r.codeIssues);
        if (r.terminologyInconsistencies?.length)
            allTerminologyInconsistencies.push(...r.terminologyInconsistencies);
    });
    const dimensionScores = {};
    DIMENSIONS.forEach(d => {
        dimensionScores[d] = dimensionResults[d]?.score ?? null;
    });
    return JSON.stringify({
        success: true,
        fromCache,
        model: selectedModel,
        overallScore,
        dimensionScores,
        contentType: dimensionResults[DIMENSIONS[0]]?.contentType || 'mixed',
        keyFindings: keyFindings.slice(0, 10),
        spellingIssuesCount: allSpellingIssues.length,
        codeIssuesCount: allCodeIssues.length,
        terminologyInconsistenciesCount: allTerminologyInconsistencies.length,
        message: fromCache
            ? `Dimension analysis completed using cached results (${selectedModel})`
            : `Dimension analysis completed using ${selectedModel}`
    });
}
