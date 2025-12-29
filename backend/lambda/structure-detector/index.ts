import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

interface StructureDetectorEvent {
    url: string;
    selectedModel: string;
    sessionId: string;
    analysisStartTime: number;
}

interface StructureDetectorResponse {
    success: boolean;
    sessionId: string;
    message: string;
}

interface Topic {
    name: string;
    pageCount: number;
    urls: string[];
}

interface DocumentStructure {
    type: 'single_topic' | 'multi_topic';
    topics: Topic[];
    confidence: number;
    contentType: 'api-docs' | 'tutorial' | 'reference' | 'mixed';
}

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

export const handler: Handler<any, StructureDetectorResponse> = async (event) => {
    console.log('Structure detector received event:', JSON.stringify(event, null, 2));

    // Extract original parameters from Step Functions input
    const { url, selectedModel, sessionId, analysisStartTime } = event;

    console.log('Detecting document structure for:', url);

    try {
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }

        // Retrieve processed content from S3
        const s3Key = `sessions/${sessionId}/processed-content.json`;
        const getResponse = await s3Client.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: s3Key
        }));

        const contentStr = await getResponse.Body!.transformToString();
        const processedContent = JSON.parse(contentStr);

        console.log('Retrieved processed content from S3');

        // Use AI to analyze document structure
        const structure = await analyzeStructure(
            processedContent.markdownContent,
            processedContent.contentType,
            processedContent.linkAnalysis,
            event.selectedModel
        );

        // Store structure analysis in S3
        const structureKey = `sessions/${sessionId}/structure.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: structureKey,
            Body: JSON.stringify(structure),
            ContentType: 'application/json'
        }));

        console.log('Structure detection completed:', structure.type);

        return {
            success: true,
            sessionId: sessionId,
            message: `Document structure analyzed: ${structure.type}`
        };

    } catch (error) {
        console.error('Structure detection failed:', error);
        return {
            success: false,
            sessionId: sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

async function analyzeStructure(
    markdownContent: string,
    contentType: string,
    linkAnalysis: any,
    selectedModel: string
): Promise<DocumentStructure> {
    const prompt = `Analyze this documentation content and identify its structure and topics.

Content Type: ${contentType}
Total Links: ${linkAnalysis.totalLinks}
Internal Links: ${linkAnalysis.internalLinks}
Sub-pages Referenced: ${linkAnalysis.subPagesIdentified.join(', ')}

Content Preview (first 2000 chars):
${markdownContent.slice(0, 2000)}

Please analyze:
1. Is this a single-topic or multi-topic document?
2. What are the main topics covered?
3. How confident are you in this analysis (0-100)?

Respond in JSON format:
{
  "type": "single_topic" or "multi_topic",
  "topics": [{"name": "topic name", "pageCount": 1, "urls": []}],
  "confidence": 85,
  "contentType": "api-docs" | "tutorial" | "reference" | "mixed"
}`;

    try {
        const modelId = getModelId(selectedModel);

        const requestBody = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            temperature: 0.1,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        };

        const command = new InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(requestBody)
        });

        console.log('Calling Bedrock API for structure analysis...');
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        console.log('Bedrock response:', JSON.stringify(responseBody, null, 2));

        // Extract the text content from Claude's response
        const textContent = responseBody.content[0].text;

        // Parse JSON from the response
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in AI response');
        }

        const structure = JSON.parse(jsonMatch[0]);

        return structure;

    } catch (error) {
        console.error('AI analysis failed, using fallback:', error);

        // Fallback to simple heuristic-based analysis
        return {
            type: linkAnalysis.subPagesIdentified.length > 3 ? 'multi_topic' : 'single_topic',
            topics: [{
                name: 'Main Topic',
                pageCount: 1,
                urls: []
            }],
            confidence: 50,
            contentType: contentType as any
        };
    }
}

function getModelId(selectedModel: string): string {
    const modelMap: Record<string, string> = {
        'claude': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',  // Cross-region inference profile
        'titan': 'amazon.titan-text-premier-v1:0',
        'llama': 'us.meta.llama3-1-70b-instruct-v1:0',  // Cross-region inference profile
        'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    };

    return modelMap[selectedModel] || modelMap['claude'];
}