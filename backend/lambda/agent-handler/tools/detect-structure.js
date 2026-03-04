"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectStructureTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const s3_helpers_1 = require("../shared/s3-helpers");
const bedrock_helpers_1 = require("../shared/bedrock-helpers");
/**
 * Tool 3: Detect Structure
 * Ported from: structure-detector/index.ts (198 lines)
 *
 * Analyzes document structure using Bedrock AI.
 * Reads processed content from S3, classifies doc type.
 */
exports.detectStructureTool = (0, tools_1.tool)(async (input) => {
    console.log('detect_structure: Analyzing structure for session:', input.sessionId);
    try {
        // Read processed content from S3
        const processedContent = await (0, s3_helpers_1.readSessionArtifact)(input.sessionId, 'processed-content.json');
        if (!processedContent) {
            return JSON.stringify({
                success: false,
                error: 'No processed content found. Run process_url first.'
            });
        }
        const markdownContent = processedContent.markdownContent || '';
        const linkAnalysis = processedContent.linkAnalysis || { totalLinks: 0, internalLinks: 0, subPagesIdentified: [] };
        const contentType = processedContent.contentType || 'unknown';
        // Use AI to analyze document structure
        const structure = await analyzeStructure(markdownContent, contentType, linkAnalysis, input.selectedModel);
        // Store structure analysis in S3
        await (0, s3_helpers_1.writeSessionArtifact)(input.sessionId, 'structure.json', structure);
        console.log('Structure detection completed:', structure.type, structure.contentType);
        return JSON.stringify({
            success: true,
            type: structure.type,
            contentType: structure.contentType,
            topicCount: structure.topics?.length || 1,
            confidence: structure.confidence,
            message: `Document structure analyzed: ${structure.type}, content type: ${structure.contentType}`
        });
    }
    catch (error) {
        console.error('Structure detection failed:', error);
        return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}, {
    name: 'detect_structure',
    description: 'Analyzes the document structure to classify its type (api-docs, tutorial, reference, product-guide, mixed) and whether it covers single or multiple topics. Must be called AFTER process_url.',
    schema: zod_1.z.object({
        sessionId: zod_1.z.string().describe('The analysis session ID'),
        selectedModel: zod_1.z.string().default('claude').describe('The AI model to use')
    })
});
async function analyzeStructure(markdownContent, contentType, linkAnalysis, selectedModel) {
    const subPages = linkAnalysis.subPagesIdentified || [];
    const prompt = `Analyze this documentation content and identify its structure and topics.

Content Type: ${contentType}
Total Links: ${linkAnalysis.totalLinks || 0}
Internal Links: ${linkAnalysis.internalLinks || 0}
Sub-pages Referenced: ${subPages.join(', ')}

Content Preview (first 2000 chars):
${markdownContent.slice(0, 2000)}

Please analyze:
1. Is this a single-topic or multi-topic document?
2. What are the main topics covered?
3. How confident are you in this analysis (0-100)?

RESPOND IN JSON FORMAT:
{
  "type": "single_topic" or "multi_topic",
  "topics": [{"name": "topic name", "pageCount": 1, "urls": []}],
  "confidence": 85,
  "contentType": "api-docs" | "tutorial" | "reference" | "product-guide" | "mixed"
}

GUIDANCE FOR CONTENT TYPE:
- "api-docs": heavy code use, parameter lists, method signatures
- "tutorial": step-by-step coding instructions, prerequisites
- "product-guide": UI-focused instructions (Click X, Select Y), screenshots, JSON configs, non-technical language
- "reference": tables, configurations, specs
- "mixed": combination of above`;
    try {
        return await (0, bedrock_helpers_1.invokeBedrockForJson)(prompt, {
            modelId: (0, bedrock_helpers_1.getModelId)(selectedModel),
            maxTokens: 1000,
            temperature: 0.1
        });
    }
    catch (error) {
        console.error('AI analysis failed, using fallback:', error);
        // Fallback to heuristic-based analysis
        return {
            type: subPages.length > 3 ? 'multi_topic' : 'single_topic',
            topics: [{ name: 'Main Topic', pageCount: 1, urls: [] }],
            confidence: 50,
            contentType: (contentType === 'product-guide' ? 'product-guide' : 'mixed')
        };
    }
}
