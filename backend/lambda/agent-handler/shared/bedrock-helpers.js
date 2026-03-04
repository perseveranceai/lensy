"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MODEL_ID = exports.bedrockClient = exports.invokeBedrockModel = void 0;
exports.invokeBedrockForJson = invokeBedrockForJson;
exports.getModelId = getModelId;
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const traceable_1 = require("langsmith/traceable");
const bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
exports.bedrockClient = bedrockClient;
const DEFAULT_MODEL_ID = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';
exports.DEFAULT_MODEL_ID = DEFAULT_MODEL_ID;
/**
 * Invoke Bedrock Claude model with a user prompt.
 * Returns the text response.
 * Wrapped with LangSmith traceable for observability.
 */
exports.invokeBedrockModel = (0, traceable_1.traceable)(async (prompt, options = {}) => {
    const { modelId = DEFAULT_MODEL_ID, maxTokens = 4096, temperature = 0, systemPrompt } = options;
    const messages = [
        { role: 'user', content: prompt }
    ];
    const body = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        temperature,
        messages
    };
    if (systemPrompt) {
        body.system = systemPrompt;
    }
    const startTime = Date.now();
    const response = await bedrockClient.send(new client_bedrock_runtime_1.InvokeModelCommand({
        modelId,
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: 'application/json'
    }));
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const responseText = responseBody.content?.[0]?.text || '';
    console.log(JSON.stringify({
        event: 'bedrock_invoke_complete',
        modelId,
        promptLength: prompt.length,
        responseLength: responseText.length,
        durationMs: Date.now() - startTime,
        inputTokens: responseBody.usage?.input_tokens,
        outputTokens: responseBody.usage?.output_tokens,
    }));
    return responseText;
}, { name: 'bedrock_invoke', run_type: 'llm' });
/**
 * Invoke Bedrock and parse the response as JSON.
 * Extracts JSON from markdown code blocks if present.
 */
async function invokeBedrockForJson(prompt, options = {}) {
    const text = await (0, exports.invokeBedrockModel)(prompt, options);
    // Try to extract JSON from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonString = jsonMatch ? jsonMatch[1].trim() : text.trim();
    try {
        return JSON.parse(jsonString);
    }
    catch (error) {
        console.error('Failed to parse Bedrock response as JSON:', text.substring(0, 500));
        throw new Error(`Bedrock response is not valid JSON: ${text.substring(0, 200)}`);
    }
}
/**
 * Map frontend model selection to Bedrock model ID.
 */
function getModelId(selectedModel) {
    switch (selectedModel) {
        case 'claude':
        case 'auto':
        default:
            return DEFAULT_MODEL_ID;
    }
}
