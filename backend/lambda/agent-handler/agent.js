"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tools = exports.SYSTEM_PROMPT = void 0;
exports.runAgent = runAgent;
exports.buildGraph = buildGraph;
const aws_1 = require("@langchain/aws");
const langgraph_1 = require("@langchain/langgraph");
const prebuilt_1 = require("@langchain/langgraph/prebuilt");
const messages_1 = require("@langchain/core/messages");
// Import all tools
const detect_input_type_1 = require("./tools/detect-input-type");
const process_url_1 = require("./tools/process-url");
const detect_structure_1 = require("./tools/detect-structure");
const check_ai_readiness_1 = require("./tools/check-ai-readiness");
const analyze_dimensions_1 = require("./tools/analyze-dimensions");
const check_sitemap_health_1 = require("./tools/check-sitemap-health");
const generate_report_1 = require("./tools/generate-report");
const publish_progress_1 = require("./tools/publish-progress");
// ─── Agent State Definition ──────────────────────────────────
const AgentState = langgraph_1.Annotation.Root({
    messages: (0, langgraph_1.Annotation)({
        reducer: (prev, next) => [...prev, ...next],
        default: () => [],
    }),
});
// ─── Tools ───────────────────────────────────────────────────
// Tool order matters — models are biased toward tools listed earlier.
// Order matches the doc-mode execution sequence so the agent naturally
// follows: detect → ai-readiness → process → structure → dimensions → report.
const tools = [
    detect_input_type_1.detectInputTypeTool,
    check_ai_readiness_1.checkAIReadinessTool,
    publish_progress_1.publishProgressTool,
    process_url_1.processUrlTool,
    detect_structure_1.detectStructureTool,
    analyze_dimensions_1.analyzeDimensionsTool,
    check_sitemap_health_1.checkSitemapHealthTool,
    generate_report_1.generateReportTool,
];
exports.tools = tools;
// ─── Model Configuration ────────────────────────────────────
function createModel() {
    return new aws_1.ChatBedrockConverse({
        model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0,
        maxTokens: 4096,
    }).bindTools(tools);
}
// ─── System Prompt ───────────────────────────────────────────
const SYSTEM_PROMPT = `You are Lensy, a documentation quality analysis agent. Your job is to analyze documentation URLs and produce quality reports.

You have 8 tools available. Follow this EXACT sequence for doc-mode analysis:

## Doc Mode Analysis (when input type is "doc")

1. Call \`detect_input_type\` with the URL to determine if it's a doc page or sitemap
2. **MANDATORY when llmsTxtUrl is present**: Call \`check_ai_readiness\` with the llmsTxtUrl. This MUST happen BEFORE process_url because it crawls pages and builds the Knowledge Base. Do NOT skip this step when llmsTxtUrl is in the user message. If no llmsTxtUrl was provided, skip this step.
3. Call \`publish_progress\` with message "Starting URL processing..." and phase "url-processing"
4. Call \`process_url\` to fetch, parse, and analyze the URL content
5. Call \`publish_progress\` with message "Detecting document structure..." and phase "structure-detection"
6. Call \`detect_structure\` to classify the document type
7. Call \`publish_progress\` with message "Analyzing documentation quality across 5 dimensions..." and phase "dimension-analysis"
8. Call \`analyze_dimensions\` to score the document across 5 quality dimensions
9. If the user provided a sitemapUrl, call \`check_sitemap_health\` with that sitemapUrl. Otherwise SKIP this step.
10. Call \`publish_progress\` with message "Generating final report..." and phase "report-generation"
11. Call \`generate_report\` with sourceMode "doc" to create the final report
12. Call \`publish_progress\` with type "success" and message "Analysis complete!"

## Sitemap Mode Analysis (when input type is "sitemap")

1. Call \`detect_input_type\` with the URL
2. Call \`publish_progress\` with message "Parsing sitemap..." and phase "sitemap-health"
3. Call \`check_sitemap_health\` to parse and validate the sitemap
4. Call \`publish_progress\` with message "Generating sitemap health report..." and phase "report-generation"
5. Call \`generate_report\` with sourceMode "sitemap" to create the final report
6. Call \`publish_progress\` with type "success" and message "Sitemap analysis complete!"

## Important Rules

- ALWAYS pass the correct sessionId to every tool call
- ALWAYS call publish_progress between major steps to keep the user informed
- If \`process_url\` returns \`"contentGateFailed": true\`, STOP the pipeline immediately. Call \`publish_progress\` with type "error" and the failure message, then respond with the error explanation. Do NOT proceed to \`detect_structure\`, \`analyze_dimensions\`, or \`generate_report\`.
- If a tool fails for other reasons, log the error and continue with the next tool — produce a partial report rather than failing entirely
- After generate_report succeeds, respond with the final summary. Do NOT call any more tools after that.
- Keep your text responses minimal — the tools do the work, you orchestrate them.
- You MUST call tools in the order specified above. Do not skip tools unless a prerequisite failed.
- CRITICAL: When the user message contains "llms.txt URL", you MUST call \`check_ai_readiness\` BEFORE \`process_url\`. This populates the Knowledge Base that process_url depends on.
`;
exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
// ─── Graph Nodes ─────────────────────────────────────────────
const toolNode = new prebuilt_1.ToolNode(tools);
async function agentNode(state) {
    const model = createModel();
    const response = await model.invoke(state.messages);
    return { messages: [response] };
}
// ─── Conditional Edge: Should Continue? ──────────────────────
function shouldContinue(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    // If the last message is an AI message with tool calls, route to tools
    if (lastMessage instanceof messages_1.AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return 'tools';
    }
    // Otherwise, the agent is done
    return langgraph_1.END;
}
// ─── Build the Graph ─────────────────────────────────────────
function buildGraph() {
    const graph = new langgraph_1.StateGraph(AgentState)
        .addNode('agent', agentNode)
        .addNode('tools', toolNode)
        .addEdge(langgraph_1.START, 'agent')
        .addConditionalEdges('agent', shouldContinue)
        .addEdge('tools', 'agent');
    return graph.compile();
}
/**
 * Run the Lensy analysis agent.
 * This is the main entry point called by the Lambda handler.
 */
async function runAgent(input) {
    console.log(`[Agent] Starting analysis for URL: ${input.url}, session: ${input.sessionId}`);
    const app = buildGraph();
    // Build the initial message that tells the agent what to do
    const userMessage = buildUserMessage(input);
    const initialState = {
        messages: [
            new messages_1.SystemMessage(SYSTEM_PROMPT),
            new messages_1.HumanMessage(userMessage),
        ],
    };
    console.log('[Agent] Invoking graph...');
    // Run the agent with a recursion limit to prevent infinite loops
    const finalState = await app.invoke(initialState, {
        recursionLimit: 50, // Max 50 agent↔tool round-trips (typically needs ~15-20)
    });
    // Extract the final AI response
    const lastMessage = finalState.messages[finalState.messages.length - 1];
    const responseText = lastMessage instanceof messages_1.AIMessage
        ? lastMessage.content
        : String(lastMessage);
    console.log(`[Agent] Analysis complete. Final message length: ${String(responseText).length}`);
    return typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
}
function buildUserMessage(input) {
    const parts = [
        `Analyze this documentation URL: ${input.url}`,
        `Session ID: ${input.sessionId}`,
        `Model: ${input.selectedModel}`,
        `Analysis start time: ${input.analysisStartTime}`,
    ];
    if (input.contextAnalysis?.enabled) {
        parts.push(`Context analysis: enabled (max ${input.contextAnalysis.maxContextPages || 5} pages)`);
    }
    if (input.cacheControl?.enabled === false) {
        parts.push('Cache: disabled (force fresh analysis)');
    }
    if (input.sitemapUrl) {
        parts.push(`Sitemap URL (user-provided): ${input.sitemapUrl}`);
    }
    if (input.llmsTxtUrl) {
        parts.push(`\nIMPORTANT — llms.txt URL provided: ${input.llmsTxtUrl}`);
        parts.push(`You MUST call check_ai_readiness with this llmsTxtUrl IMMEDIATELY after detect_input_type and BEFORE process_url. This will crawl the llms.txt pages and build the Knowledge Base that process_url needs for context enrichment. Do NOT skip this step.`);
    }
    return parts.join('\n');
}
