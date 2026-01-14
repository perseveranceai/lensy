
import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { ProgressPublisher } from './progress-publisher';

// --- Interfaces ---

interface FixGeneratorEvent {
    sessionId: string;
    // Optional overrides
    bucketName?: string;
    modelId?: string;
    selectedRecommendations?: string[]; // Specific recommendation actions to fix
}

interface FixGeneratorResponse {
    success: boolean;
    fixSessionId: string;
    fixCount: number;
    message: string;
}

type FixCategory = 'CODE_UPDATE' | 'LINK_FIX' | 'CONTENT_ADDITION' | 'VERSION_UPDATE' | 'FORMATTING_FIX';
type FixStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'FAILED';

interface Fix {
    id: string;
    sessionId: string;
    documentUrl: string;
    category: FixCategory;
    originalContent: string;
    proposedContent: string;
    lineStart: number;
    lineEnd: number;
    confidence: number;
    rationale: string;
    status: FixStatus;
    generatedAt: string;
}

interface FixSession {
    sessionId: string;
    documentUrl: string;
    documentHash: string; // To match processed-content hash if we had it, or just use timestamp for now
    createdAt: string;
    fixes: Fix[];
    summary: {
        totalFixes: number;
        byCategory: Record<FixCategory, number>;
        averageConfidence: number;
    };
}

// --- Clients ---

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

// --- Handler ---

export const handler: Handler<any, any> = async (event) => {
    // Handle API Gateway V2 proxy event
    let input = event;
    if (event.body) {
        try {
            input = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } catch (e) {
            console.warn('Could not parse event body, using event as is');
        }
    }

    const { sessionId, bucketName: eventBucket, modelId: eventModel, selectedRecommendations } = input;
    const bucketName = eventBucket || process.env.ANALYSIS_BUCKET;
    const modelId = eventModel || 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'; // Default to Sonnet 3.5 New (v2) via cross-region profile

    console.log(`Starting Fix Generation for session: ${sessionId} (Bucket: ${bucketName})`);
    if (!sessionId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, message: 'sessionId is required' })
        };
    }

    const progress = new ProgressPublisher(sessionId);

    try {
        if (!bucketName) throw new Error('Bucket name is required (ANALYSIS_BUCKET env or bucketName payload)');

        // 1. Load Data from S3
        await progress.progress('Loading analysis results...', 'fix-generation');

        // Load Processed Content
        const contentKey = `sessions/${sessionId}/processed-content.json`;
        const contentStr = await getS3Object(bucketName, contentKey);
        const processedContent = JSON.parse(contentStr);
        const documentUrl = processedContent.url || 'unknown-url';

        // Load Findings (Dimension Results)
        const resultsKey = `sessions/${sessionId}/dimension-results.json`;
        const resultsStr = await getS3Object(bucketName, resultsKey);
        const dimensionResults = JSON.parse(resultsStr);

        // Aggregate findings/recommendations
        let issuesToFix: string[] = [];

        if (event.selectedRecommendations && event.selectedRecommendations.length > 0) {
            console.log(`Using ${event.selectedRecommendations.length} user-selected recommendations`);
            issuesToFix = event.selectedRecommendations;
        } else {
            console.log('No user-selected recommendations, using all findings from analysis');
            Object.values(dimensionResults).forEach((result: any) => {
                if (result.findings && Array.isArray(result.findings)) {
                    issuesToFix.push(...result.findings);
                }
                // Also include recommendations as they are more actionable
                if (result.recommendations && Array.isArray(result.recommendations)) {
                    issuesToFix.push(...result.recommendations.map((r: any) => r.action));
                }
            });
        }

        // Remove duplicates
        issuesToFix = [...new Set(issuesToFix)];

        if (issuesToFix.length === 0) {
            await progress.success('No issues to fix.', { fixCount: 0 });
            return response(true, sessionId, 0, 'No issues found to fix');
        }

        // 2. Generate Fixes with Bedrock
        await progress.progress(`Generating fixes for ${issuesToFix.length} issues...`, 'fix-generation');

        const fixes = await generateFixesWithBedrock(modelId, processedContent.markdownContent, issuesToFix, documentUrl);

        // 3. Create Fix Session
        const fixSession: FixSession = {
            sessionId,
            documentUrl,
            documentHash: processedContent.hash || new Date().toISOString(), // Fallback
            createdAt: new Date().toISOString(),
            fixes: fixes.map(f => ({ ...f, sessionId, status: 'PROPOSED', generatedAt: new Date().toISOString() })),
            summary: calculateSummary(fixes)
        };

        // 4. Save to S3
        const fixesKey = `sessions/${sessionId}/fixes.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: fixesKey,
            Body: JSON.stringify(fixSession, null, 2),
            ContentType: 'application/json'
        }));

        await progress.success(`Generated ${fixes.length} fixes`, {
            fixCount: fixes.length,
            preview: fixes.slice(0, 3).map(f => f.category)
        });

        const successBody = {
            success: true,
            fixSessionId: sessionId,
            fixCount: fixes.length,
            message: `Successfully generated ${fixes.length} fixes`
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(successBody)
        };

    } catch (error: any) {
        const errorMsg = error.Code === 'NoSuchKey' ? `S3 Object Not Found: ${error.Key} in ${bucketName}` : error.message;
        console.error('Fix generation failed:', error);
        await progress.error(`Fix generation failed: ${errorMsg}`);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                fixSessionId: sessionId,
                fixCount: 0,
                message: errorMsg
            })
        };
    }
};

// --- Helpers ---

async function getS3Object(bucket: string, key: string): Promise<string> {
    const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return res.Body!.transformToString();
}

function response(success: boolean, id: string, count: number, msg: string): FixGeneratorResponse {
    return { success, fixSessionId: id, fixCount: count, message: msg };
}

function calculateSummary(fixes: Fix[]): FixSession['summary'] {
    const byCategory: Record<FixCategory, number> = {
        CODE_UPDATE: 0, LINK_FIX: 0, CONTENT_ADDITION: 0, VERSION_UPDATE: 0, FORMATTING_FIX: 0
    };
    let totalConfidence = 0;

    fixes.forEach(f => {
        if (byCategory[f.category] !== undefined) byCategory[f.category]++;
        totalConfidence += f.confidence;
    });

    return {
        totalFixes: fixes.length,
        byCategory,
        averageConfidence: fixes.length > 0 ? Math.round(totalConfidence / fixes.length) : 0
    };
}

// --- AI Logic ---

async function generateFixesWithBedrock(
    modelId: string,
    content: string,
    findings: string[],
    url: string
): Promise<Fix[]> {

    // Construct Prompt
    const prompt = `You are a technical documentation editor.
Your task is to generate precise, actionable fixes for the identified issues in the documentation.

DOCUMENT URL: ${url}

DOCUMENT CONTENT (Markdown):
\`\`\`markdown
${content.slice(0, 25000)}
\`\`\`
(Content truncated if too long)

IDENTIFIED ISSUES:
${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

INSTRUCTIONS:
For each issue that can be fixed by text/code modification, generate a "Fix Object".
- "originalContent": The EXACT text/code block from the document that needs changing (must match exactly to be findable).
- "proposedContent": The replacement text/code.
- "lineStart" / "lineEnd": Approximate line numbers (context).
- "category": One of [CODE_UPDATE, LINK_FIX, CONTENT_ADDITION, VERSION_UPDATE, FORMATTING_FIX].
- "confidence": 0-100 (how sure are you this is the correct fix).
- "rationale": Brief explanation.

If an issue is vague or cannot be fixed automatically, SKIP IT.
Output specific JSON only.

OUTPUT FORMAT:
Return a valid JSON array of objects. Do not wrap in markdown code blocks.
[
  {
    "id": "fix_1",
    "category": "CODE_UPDATE",
    "originalContent": "var x = 1;",
    "proposedContent": "const x = 1;",
    "lineStart": 10,
    "lineEnd": 10,
    "confidence": 95,
    "rationale": "Use const for immutability"
  }
]
`;

    // Call Bedrock (Claude 3.5 Sonnet payload)
    const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
    };

    const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload)
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.content[0].text;

    // Parse JSON
    try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return [];
        const fixes = JSON.parse(jsonMatch[0]);

        // Basic validation/sanitization
        return fixes.map((f: any, index: number) => ({
            id: `fix_${Date.now()}_${index}`,
            sessionId: '', // Filled by caller
            documentUrl: url,
            category: (f.category || 'FORMATTING_FIX') as FixCategory,
            originalContent: f.originalContent || '',
            proposedContent: f.proposedContent || '',
            lineStart: f.lineStart || 0,
            lineEnd: f.lineEnd || 0,
            confidence: f.confidence || 0,
            rationale: f.rationale || 'AI generated',
            status: 'PROPOSED' as FixStatus,
            generatedAt: new Date().toISOString()
        }));
    } catch (e) {
        console.error("Failed to parse AI fix response", e);
        console.log("Raw response:", text);
        throw new Error("AI response was not valid JSON");
    }
}
