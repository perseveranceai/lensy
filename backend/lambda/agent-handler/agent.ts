import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

// Import all tools
import { detectInputTypeTool } from './tools/detect-input-type';
import { processUrlTool } from './tools/process-url';
import { detectStructureTool } from './tools/detect-structure';
import { checkAIReadinessTool } from './tools/check-ai-readiness';
import { analyzeDimensionsTool } from './tools/analyze-dimensions';
import { checkSitemapHealthTool } from './tools/check-sitemap-health';
import { generateReportTool } from './tools/generate-report';
import { publishProgressTool } from './tools/publish-progress';

// ─── Agent State Definition ──────────────────────────────────

const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (prev, next) => [...prev, ...next],
        default: () => [],
    }),
});

// ─── Tools ───────────────────────────────────────────────────

const tools = [
    detectInputTypeTool,
    processUrlTool,
    detectStructureTool,
    checkAIReadinessTool,
    analyzeDimensionsTool,
    checkSitemapHealthTool,
    generateReportTool,
    publishProgressTool,
];

// ─── Model Configuration ────────────────────────────────────

function createModel() {
    return new ChatBedrockConverse({
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
2. Call \`publish_progress\` with message "Starting URL processing..." and phase "url-processing"
3. Call \`process_url\` to fetch, parse, and analyze the URL content
4. Call \`publish_progress\` with message "Detecting document structure..." and phase "structure-detection"
5. Call \`detect_structure\` to classify the document type
6. Call \`check_ai_readiness\` to check AI-friendliness of the domain
7. Call \`publish_progress\` with message "Analyzing documentation quality across 5 dimensions..." and phase "dimension-analysis"
8. Call \`analyze_dimensions\` to score the document across 5 quality dimensions
9. Call \`check_sitemap_health\` to check the domain's sitemap health (runs alongside other analysis)
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
- If a tool fails, log the error and continue with the next tool — produce a partial report rather than failing entirely
- After generate_report succeeds, respond with the final summary. Do NOT call any more tools after that.
- Keep your text responses minimal — the tools do the work, you orchestrate them.
- You MUST call tools in the order specified above. Do not skip tools unless a prerequisite failed.
`;

// ─── Graph Nodes ─────────────────────────────────────────────

const toolNode = new ToolNode(tools);

async function agentNode(state: typeof AgentState.State) {
    const model = createModel();
    const response = await model.invoke(state.messages);
    return { messages: [response] };
}

// ─── Conditional Edge: Should Continue? ──────────────────────

function shouldContinue(state: typeof AgentState.State): 'tools' | typeof END {
    const lastMessage = state.messages[state.messages.length - 1];

    // If the last message is an AI message with tool calls, route to tools
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return 'tools';
    }

    // Otherwise, the agent is done
    return END;
}

// ─── Build the Graph ─────────────────────────────────────────

function buildGraph() {
    const graph = new StateGraph(AgentState)
        .addNode('agent', agentNode)
        .addNode('tools', toolNode)
        .addEdge(START, 'agent')
        .addConditionalEdges('agent', shouldContinue)
        .addEdge('tools', 'agent');

    return graph.compile();
}

// ─── Public API ──────────────────────────────────────────────

export interface AgentRunInput {
    url: string;
    sessionId: string;
    selectedModel: string;
    analysisStartTime: number;
    contextAnalysis?: {
        enabled: boolean;
        maxContextPages?: number;
    };
    cacheControl?: {
        enabled: boolean;
    };
}

/**
 * Run the Lensy analysis agent.
 * This is the main entry point called by the Lambda handler.
 */
export async function runAgent(input: AgentRunInput): Promise<string> {
    console.log(`[Agent] Starting analysis for URL: ${input.url}, session: ${input.sessionId}`);

    const app = buildGraph();

    // Build the initial message that tells the agent what to do
    const userMessage = buildUserMessage(input);

    const initialState = {
        messages: [
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(userMessage),
        ],
    };

    console.log('[Agent] Invoking graph...');

    // Run the agent with a recursion limit to prevent infinite loops
    const finalState = await app.invoke(initialState, {
        recursionLimit: 50,  // Max 50 agent↔tool round-trips (typically needs ~15-20)
    });

    // Extract the final AI response
    const lastMessage = finalState.messages[finalState.messages.length - 1];
    const responseText = lastMessage instanceof AIMessage
        ? lastMessage.content
        : String(lastMessage);

    console.log(`[Agent] Analysis complete. Final message length: ${String(responseText).length}`);

    return typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
}

function buildUserMessage(input: AgentRunInput): string {
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

    return parts.join('\n');
}

export { buildGraph, SYSTEM_PROMPT, tools };
