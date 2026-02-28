import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';
import { readSessionArtifact, writeSessionArtifact, readFromS3, writeToS3, ANALYSIS_BUCKET } from '../shared/s3-helpers';
import { invokeBedrockModel, getModelId, bedrockClient } from '../shared/bedrock-helpers';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createProgressHelper } from './publish-progress';

/**
 * Tool 5: Analyze Dimensions
 * Ported from: dimension-analyzer/index.ts (920 lines)
 *
 * Performs 5-dimension documentation quality analysis (relevance, freshness, clarity, accuracy, completeness)
 * using PARALLEL Bedrock calls. Supports content-type-aware weighting, spelling issue detection,
 * terminology inconsistency detection, code issue detection, URL slug penalty, and DynamoDB caching.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocumentationType =
    | 'api-reference'
    | 'tutorial'
    | 'conceptual'
    | 'how-to'
    | 'reference'
    | 'troubleshooting'
    | 'overview'
    | 'changelog'
    | 'product-guide'
    | 'mixed';

type DimensionType = 'relevance' | 'freshness' | 'clarity' | 'accuracy' | 'completeness';

interface ContentTypeWeights {
    relevance: number;
    freshness: number;
    clarity: number;
    accuracy: number;
    completeness: number;
}

interface Recommendation {
    priority: 'high' | 'medium' | 'low';
    action: string;
    location?: string;
    impact: string;
    codeExample?: string;
    mediaReference?: string;
}

interface SpellingIssue {
    incorrect: string;
    correct: string;
    context: string;
}

interface TerminologyInconsistency {
    variants: string[];
    recommendation: string;
}

interface CodeIssue {
    type: string;
    location: string;
    description: string;
    codeFragment: string;
}

interface DimensionResult {
    dimension: DimensionType;
    score: number | null;
    originalScore?: number;
    contentTypeWeight?: number;
    contentType?: DocumentationType;
    status: 'complete' | 'failed' | 'timeout' | 'retrying';
    findings: string[];
    recommendations: Recommendation[];
    failureReason?: string;
    retryCount: number;
    processingTime: number;
    spellingIssues?: SpellingIssue[];
    codeIssues?: CodeIssue[];
    terminologyInconsistencies?: TerminologyInconsistency[];
}

// ---------------------------------------------------------------------------
// Content-type-specific scoring weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const CONTENT_TYPE_WEIGHTS: Record<DocumentationType, ContentTypeWeights> = {
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

const DIMENSIONS: DimensionType[] = ['relevance', 'freshness', 'clarity', 'accuracy', 'completeness'];

// ---------------------------------------------------------------------------
// Module-level DynamoDB client
// ---------------------------------------------------------------------------

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

// ---------------------------------------------------------------------------
// URL normalization & cache key helpers
// ---------------------------------------------------------------------------

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

/**
 * Generate consistent session ID based on URL and context setting.
 * Must match the function in URL processor exactly.
 */
function generateConsistentSessionId(url: string, contextualSetting: string): string {
    const normalizedUrl = normalizeUrl(url);
    const input = `${normalizedUrl}#${contextualSetting}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `session-${hash.substring(0, 12)}`;
}

// ---------------------------------------------------------------------------
// DynamoDB dimension cache — check
// ---------------------------------------------------------------------------

async function checkDimensionCache(
    bucketName: string,
    processedContent: any,
    contextualSetting: string,
    _selectedModel: string
): Promise<Record<DimensionType, DimensionResult> | null> {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping dimension cache check');
            return null;
        }

        const cleanUrl = normalizeUrl(processedContent.url);

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
        console.log('Found cache entry, checking for dimension results...');

        const contentS3Path = cacheEntry.s3Location; // e.g. sessions/session-abc123/processed-content.json
        const sessionPath = contentS3Path.replace('/processed-content.json', '');
        const dimensionS3Path = `${sessionPath}/dimension-results.json`;

        try {
            const dimensionResults = await readFromS3<Record<DimensionType, DimensionResult>>(
                bucketName,
                dimensionS3Path
            );

            if (dimensionResults) {
                console.log(`Found cached dimension results at: ${dimensionS3Path}`);
                return dimensionResults;
            }
            console.log(`No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        } catch (s3Error) {
            console.log(`No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        }
    } catch (error) {
        console.error('Error checking dimension cache:', error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// DynamoDB dimension cache — store
// ---------------------------------------------------------------------------

async function cacheDimensionResults(
    bucketName: string,
    processedContent: any,
    contextualSetting: string,
    _selectedModel: string,
    dimensionResults: Record<DimensionType, DimensionResult>
): Promise<void> {
    try {
        const consistentSessionId = generateConsistentSessionId(processedContent.url, contextualSetting);
        const dimensionS3Path = `sessions/${consistentSessionId}/dimension-results.json`;

        await writeToS3(bucketName, dimensionS3Path, dimensionResults);

        console.log(`Cached dimension results at: ${dimensionS3Path}`);
    } catch (error) {
        console.error('Failed to cache dimension results:', error);
        // Don't throw — caching failure shouldn't break the main flow
    }
}

// ---------------------------------------------------------------------------
// Content-type-aware scoring weights
// ---------------------------------------------------------------------------

function applyContentTypeWeights(
    dimensionResults: Record<DimensionType, DimensionResult>,
    contentType: DocumentationType
): Record<DimensionType, DimensionResult> {
    const weights = CONTENT_TYPE_WEIGHTS[contentType];
    const weightedResults = { ...dimensionResults };

    Object.keys(weightedResults).forEach(dimension => {
        const dim = dimension as DimensionType;
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
        requestBody = {
            prompt: prompt,
            max_gen_len: 2000,
            temperature: 0.1,
            top_p: 0.9
        };
        responseParser = (responseBody) => responseBody.generation;
    } else if (selectedModel === 'titan') {
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
        processingTime: 0, // Will be set by caller
        spellingIssues: analysis.spellingIssues,
        codeIssues: analysis.codeIssues,
        terminologyInconsistencies: analysis.terminologyInconsistencies
    };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPromptForDimension(dimension: DimensionType, processedContent: any): string {
    const contentType = (processedContent.contentType as DocumentationType) || 'mixed';
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

    // Context analysis information
    let contextInfo = '';
    if (processedContent.contextAnalysis && processedContent.contextAnalysis.contextPages?.length > 0) {
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
${processedContent.codeSnippets?.filter((s: any) => s.hasVersionInfo).map((s: any) => s.code.slice(0, 200)).join('\n---\n') || 'None'}

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
      "impact": "expected impact"
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
${processedContent.codeSnippets?.map((s: any) => `Language: ${s.language}\n${s.code.slice(0, 300)}`).join('\n---\n') || 'None'}

Evaluate:
1. Are code examples syntactically correct?
2. JSON VALIDATION: Are JSON configuration examples valid? Check for missing quotes, trailing commas, or unbalanced braces.
3. CONFIGURATION: Are placeholder values (e.g., <YOUR_KEY>) clearly marked?
4. Is API usage accurate?
5. Are there any misleading statements?
6. DATE ACCURACY: Only flag dates as "future-dated" if they are AFTER ${today}.

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

// ---------------------------------------------------------------------------
// Content-type-specific evaluation guidance
// ---------------------------------------------------------------------------

function getContentTypeGuidance(contentType: DocumentationType, dimension: DimensionType): string {
    const guidance: Record<DocumentationType, Record<DimensionType, string>> = {
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

export const analyzeDimensionsTool = tool(
    async (input): Promise<string> => {
        console.log('analyze_dimensions: Starting for session:', input.sessionId);

        const progress = createProgressHelper(input.sessionId);

        try {
            const bucketName = ANALYSIS_BUCKET;
            if (!bucketName) {
                throw new Error('ANALYSIS_BUCKET environment variable not set');
            }

            // ---------------------------------------------------------------
            // 1. Retrieve processed content from S3
            // ---------------------------------------------------------------
            const processedContent = await readSessionArtifact(input.sessionId, 'processed-content.json');
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

            let cachedResults: Record<DimensionType, DimensionResult> | null = null;
            if (cacheEnabled) {
                cachedResults = await checkDimensionCache(bucketName, processedContent, contextualSetting, input.selectedModel);
            } else {
                console.log('Cache disabled by user - skipping dimension cache check');
            }

            if (cachedResults) {
                console.log('Dimension analysis cache hit! Using cached results');

                await progress.cacheHit('Retrieved: 5/5 dimensions from cache');

                // Store cached results in this session's location
                await writeSessionArtifact(input.sessionId, 'dimension-results.json', cachedResults);

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

                await progress.progress(
                    `Analyzing ${dimension.charAt(0).toUpperCase() + dimension.slice(1)} (${index + 1}/5)...`,
                    'dimension-analysis',
                    { dimension }
                );

                try {
                    const result = await analyzeDimension(dimension, processedContent, input.selectedModel);
                    const processingTime = Date.now() - startTime;
                    console.log(`${dimension} complete: score ${result.score}`);

                    await progress.success(
                        `${dimension.charAt(0).toUpperCase() + dimension.slice(1)}: ${result.score}/100 (${(processingTime / 1000).toFixed(1)}s)`,
                        { dimension, score: result.score || undefined, processingTime }
                    );

                    return {
                        dimension,
                        result: { ...result, processingTime }
                    };
                } catch (error) {
                    console.error(`${dimension} failed:`, error);

                    await progress.error(
                        `${dimension.charAt(0).toUpperCase() + dimension.slice(1)} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        { dimension }
                    );

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
                        } as DimensionResult
                    };
                }
            });

            const results = await Promise.all(dimensionPromises);

            // ---------------------------------------------------------------
            // 5. Convert to record and apply content-type weights
            // ---------------------------------------------------------------
            const dimensionResults: Record<DimensionType, DimensionResult> = {} as any;
            results.forEach(({ dimension, result }) => {
                dimensionResults[dimension] = result;
            });

            const contentType = (processedContent.contentType as DocumentationType) || 'mixed';
            let weightedResults = applyContentTypeWeights(dimensionResults, contentType);

            // ---------------------------------------------------------------
            // 6. URL slug penalty: -5 per HIGH confidence typo (max -25)
            // ---------------------------------------------------------------
            if (processedContent.urlSlugAnalysis?.issues?.length > 0 && weightedResults.clarity) {
                const issues = processedContent.urlSlugAnalysis.issues;
                let penalty = 0;

                issues.forEach((issue: any) => {
                    if (issue.confidence === 'HIGH') penalty += 5;
                    else if (issue.confidence === 'MEDIUM') penalty += 3;
                });

                const finalPenalty = Math.min(25, penalty);

                if (finalPenalty > 0 && weightedResults.clarity.score !== null) {
                    const originalClarity = weightedResults.clarity.score;
                    weightedResults.clarity.score = Math.max(0, originalClarity - finalPenalty);

                    weightedResults.clarity.findings.push(
                        `URL slug penalty: Clarity score reduced by ${finalPenalty} points due to ${issues.length} URL slug quality issues (typos detected).`
                    );

                    console.log(`Applied URL slug penalty: -${finalPenalty} points to Clarity (from ${originalClarity} to ${weightedResults.clarity.score})`);
                }
            }

            console.log(`Applied content-type-aware weights for: ${contentType}`);
            console.log('All dimensions analyzed in parallel');

            // ---------------------------------------------------------------
            // 7. Persist results to session S3 path
            // ---------------------------------------------------------------
            await writeSessionArtifact(input.sessionId, 'dimension-results.json', weightedResults);

            // ---------------------------------------------------------------
            // 8. Cache results for future use
            // ---------------------------------------------------------------
            if (cacheEnabled) {
                await cacheDimensionResults(bucketName, processedContent, contextualSetting, input.selectedModel, weightedResults);
            } else {
                console.log('Cache disabled - skipping dimension cache storage');
            }

            console.log('Dimension analysis completed and stored in S3');

            // ---------------------------------------------------------------
            // 9. Return summary JSON
            // ---------------------------------------------------------------
            return buildSummaryJson(weightedResults, input.selectedModel, false);

        } catch (error) {
            console.error('Dimension analysis failed:', error);
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    },
    {
        name: 'analyze_dimensions',
        description:
            'Performs a 5-dimension quality analysis (relevance, freshness, clarity, accuracy, completeness) on documentation content using parallel Bedrock calls. ' +
            'Reads processed content from S3, checks DynamoDB cache, scores each dimension 0-100 with content-type-aware weighting, and detects spelling issues, ' +
            'terminology inconsistencies, and code issues. Stores results at sessions/{sessionId}/dimension-results.json. Must be called AFTER process_url.',
        schema: z.object({
            url: z.string().describe('The documentation URL being analyzed'),
            sessionId: z.string().describe('The analysis session ID'),
            selectedModel: z.string().default('claude').describe('The AI model to use (claude, titan, llama, auto)'),
            cacheEnabled: z.boolean().optional().default(true).describe('Whether to use DynamoDB caching (default: true)')
        })
    }
);

// ---------------------------------------------------------------------------
// Build a JSON summary for the tool return value
// ---------------------------------------------------------------------------

function buildSummaryJson(
    dimensionResults: Record<DimensionType, DimensionResult>,
    selectedModel: string,
    fromCache: boolean
): string {
    // Compute overall weighted score
    const completed = DIMENSIONS.filter(d => dimensionResults[d]?.score !== null);
    const overallScore = completed.length > 0
        ? Math.round(
            completed.reduce((sum, d) => {
                const r = dimensionResults[d];
                const weight = r.contentTypeWeight ?? 0.20;
                return sum + (r.score ?? 0) * weight;
            }, 0) / completed.reduce((sum, d) => sum + (dimensionResults[d].contentTypeWeight ?? 0.20), 0)
        )
        : null;

    // Collect key findings across all dimensions
    const keyFindings: string[] = [];
    const allSpellingIssues: SpellingIssue[] = [];
    const allCodeIssues: CodeIssue[] = [];
    const allTerminologyInconsistencies: TerminologyInconsistency[] = [];

    DIMENSIONS.forEach(dim => {
        const r = dimensionResults[dim];
        if (!r) return;

        // Top findings (skip the weight metadata line)
        r.findings
            .filter(f => !f.startsWith('Content type:'))
            .slice(0, 2)
            .forEach(f => keyFindings.push(`[${dim}] ${f}`));

        if (r.spellingIssues?.length) allSpellingIssues.push(...r.spellingIssues);
        if (r.codeIssues?.length) allCodeIssues.push(...r.codeIssues);
        if (r.terminologyInconsistencies?.length) allTerminologyInconsistencies.push(...r.terminologyInconsistencies);
    });

    const dimensionScores: Record<string, number | null> = {};
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
