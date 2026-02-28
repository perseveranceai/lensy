import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const DEFAULT_MODEL_ID = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';

export interface BedrockInvokeOptions {
    modelId?: string;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
}

/**
 * Invoke Bedrock Claude model with a user prompt.
 * Returns the text response.
 */
export async function invokeBedrockModel(
    prompt: string,
    options: BedrockInvokeOptions = {}
): Promise<string> {
    const {
        modelId = DEFAULT_MODEL_ID,
        maxTokens = 4096,
        temperature = 0,
        systemPrompt
    } = options;

    const messages: any[] = [
        { role: 'user', content: prompt }
    ];

    const body: any = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        temperature,
        messages
    };

    if (systemPrompt) {
        body.system = systemPrompt;
    }

    const response = await bedrockClient.send(new InvokeModelCommand({
        modelId,
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: 'application/json'
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.content?.[0]?.text || '';
}

/**
 * Invoke Bedrock and parse the response as JSON.
 * Extracts JSON from markdown code blocks if present.
 */
export async function invokeBedrockForJson<T = any>(
    prompt: string,
    options: BedrockInvokeOptions = {}
): Promise<T> {
    const text = await invokeBedrockModel(prompt, options);

    // Try to extract JSON from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonString = jsonMatch ? jsonMatch[1].trim() : text.trim();

    try {
        return JSON.parse(jsonString) as T;
    } catch (error) {
        console.error('Failed to parse Bedrock response as JSON:', text.substring(0, 500));
        throw new Error(`Bedrock response is not valid JSON: ${text.substring(0, 200)}`);
    }
}

/**
 * Map frontend model selection to Bedrock model ID.
 */
export function getModelId(selectedModel: string): string {
    switch (selectedModel) {
        case 'claude':
        case 'auto':
        default:
            return DEFAULT_MODEL_ID;
    }
}

export { bedrockClient, DEFAULT_MODEL_ID };
