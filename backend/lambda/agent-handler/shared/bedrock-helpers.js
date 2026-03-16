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
 * Extract the first valid JSON object or array from a string.
 * Handles cases where Bedrock returns JSON with trailing text.
 */
function extractJson(text) {
    // Strategy 1: Try markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1].trim());
    }
    // Strategy 2: Try the full text as-is
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Strategy 3: Find the outermost { } or [ ] and parse just that
        const startIdx = trimmed.search(/[{\[]/);
        if (startIdx === -1)
            throw new Error('No JSON object or array found');
        const openChar = trimmed[startIdx];
        const closeChar = openChar === '{' ? '}' : ']';
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = startIdx; i < trimmed.length; i++) {
            const ch = trimmed[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\' && inString) {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (inString)
                continue;
            if (ch === openChar)
                depth++;
            if (ch === closeChar)
                depth--;
            if (depth === 0) {
                return JSON.parse(trimmed.substring(startIdx, i + 1));
            }
        }
        throw new Error('Unbalanced JSON brackets');
    }
}
/**
 * Invoke Bedrock and parse the response as JSON.
 * Extracts JSON from markdown code blocks if present.
 * Handles trailing text after JSON gracefully.
 */
async function invokeBedrockForJson(prompt, options = {}) {
    const text = await (0, exports.invokeBedrockModel)(prompt, options);
    try {
        return extractJson(text);
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
