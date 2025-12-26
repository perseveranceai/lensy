import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

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

type DimensionType = 'relevance' | 'freshness' | 'clarity' | 'accuracy' | 'completeness';

interface DimensionResult {
    dimension: DimensionType;
    score: number | null;
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

export const handler: Handler<DimensionAnalyzerEvent, DimensionAnalyzerResponse> = async (event) => {
    console.log('Starting dimension analysis with model:', event.selectedModel);

    try {
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }

        // Retrieve processed content from S3
        const contentKey = `sessions/${event.sessionId}/processed-content.json`;
        const contentResponse = await s3Client.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: contentKey
        }));

        const contentStr = await contentResponse.Body!.transformToString();
        const processedContent = JSON.parse(contentStr);

        console.log('Retrieved processed content from S3');

        // Analyze all dimensions IN PARALLEL for speed
        console.log('Starting parallel dimension analysis...');
        const dimensionPromises = DIMENSIONS.map(async (dimension) => {
            const startTime = Date.now();
            console.log(`Starting ${dimension} analysis`);

            try {
                const result = await analyzeDimension(
                    dimension,
                    processedContent,
                    event.selectedModel
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

        console.log('All dimensions analyzed in parallel');

        // Store dimension results in S3
        const resultsKey = `sessions/${event.sessionId}/dimension-results.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: resultsKey,
            Body: JSON.stringify(dimensionResults),
            ContentType: 'application/json'
        }));

        console.log('Dimension analysis completed and stored in S3');

        return {
            success: true,
            sessionId: event.sessionId,
            message: `Dimension analysis completed using ${event.selectedModel}`
        };

    } catch (error) {
        console.error('Dimension analysis failed:', error);
        return {
            success: false,
            sessionId: event.sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

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
    const baseContext = `
URL: ${processedContent.url}
Content Type: ${processedContent.contentType}
Code Snippets: ${processedContent.codeSnippets?.length || 0}
Media Elements: ${processedContent.mediaElements?.length || 0}
Total Links: ${processedContent.linkAnalysis?.totalLinks || 0}

Content (first 3000 chars):
${processedContent.markdownContent?.slice(0, 3000) || ''}
`;

    const dimensionPrompts: Record<DimensionType, string> = {
        relevance: `Analyze the RELEVANCE of this WordPress developer documentation.

${baseContext}

Evaluate:
1. Is the content relevant to WordPress developers?
2. Are examples practical and applicable?
3. Does it address real developer needs?
4. Is the scope appropriate for the topic?

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

Code Snippets with Version Info:
${processedContent.codeSnippets?.filter((s: any) => s.hasVersionInfo).map((s: any) => s.code.slice(0, 200)).join('\n---\n') || 'None'}

Evaluate:
1. Are WordPress version references current (6.4+)?
2. Are code examples using modern practices?
3. Are deprecated features flagged?
4. Is the content up-to-date?

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

Evaluate:
1. Is the content well-structured and organized?
2. Are explanations clear and understandable?
3. Are code examples well-commented?
4. Is technical jargon explained?

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

Code Snippets:
${processedContent.codeSnippets?.map((s: any) => `Language: ${s.language}\n${s.code.slice(0, 300)}`).join('\n---\n') || 'None'}

Evaluate:
1. Are code examples syntactically correct?
2. Is API usage accurate?
3. Are technical details correct?
4. Are there any misleading statements?

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

Sub-pages Referenced: ${processedContent.linkAnalysis?.subPagesIdentified?.join(', ') || 'None'}

Evaluate:
1. Does it cover the main topic thoroughly?
2. Are important details missing?
3. Are edge cases addressed?
4. Is error handling documented?

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

function getModelId(selectedModel: string): string {
    const modelMap: Record<string, string> = {
        'claude': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        'titan': 'amazon.titan-text-premier-v1:0',
        'llama': 'us.meta.llama3-1-70b-instruct-v1:0',  // Cross-region inference profile
        'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    };

    return modelMap[selectedModel] || modelMap['claude'];
}