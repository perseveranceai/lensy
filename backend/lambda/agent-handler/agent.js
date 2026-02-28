"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOC_MODE_TOOLS = exports.GITHUB_ISSUES_SYSTEM_PROMPT = exports.DOC_MODE_SYSTEM_PROMPT = void 0;
exports.runAgent = runAgent;
exports.getToolsForMode = getToolsForMode;
exports.getSystemPromptForMode = getSystemPromptForMode;
exports.buildGraph = buildGraph;
const aws_1 = require("@langchain/aws");
const langgraph_1 = require("@langchain/langgraph");
const prebuilt_1 = require("@langchain/langgraph/prebuilt");
const messages_1 = require("@langchain/core/messages");

// ─── Doc-Mode Tools (unchanged) ──────────────────────────────
const detect_input_type_1 = require("./tools/detect-input-type");
const process_url_1 = require("./tools/process-url");
const detect_structure_1 = require("./tools/detect-structure");
const check_ai_readiness_1 = require("./tools/check-ai-readiness");
const analyze_dimensions_1 = require("./tools/analyze-dimensions");
const check_sitemap_health_1 = require("./tools/check-sitemap-health");
const generate_report_1 = require("./tools/generate-report");
const publish_progress_1 = require("./tools/publish-progress");

// ─── GitHub-Issues Mode Tools ────────────────────────────────
const fetch_github_issues_1 = require("./tools/fetch-github-issues");
const classify_docs_issues_1 = require("./tools/classify-docs-issues");
const fetch_docs_context_1 = require("./tools/fetch-docs-context");
const build_knowledge_base_1 = require("./tools/build-knowledge-base");
const analyze_issues_against_docs_1 = require("./tools/analyze-issues-against-docs");
const create_pull_request_1 = require("./tools/create-pull-request");
const save_github_issues_results_1 = require("./tools/save-github-issues-results");

// ─── Agent State Definition ──────────────────────────────────
const AgentState = langgraph_1.Annotation.Root({
    messages: (0, langgraph_1.Annotation)({
        reducer: (prev, next) => [...prev, ...next],
        default: () => [],
    }),
});

// ─── Tool Sets ───────────────────────────────────────────────
const DOC_MODE_TOOLS = [
    detect_input_type_1.detectInputTypeTool,
    process_url_1.processUrlTool,
    detect_structure_1.detectStructureTool,
    check_ai_readiness_1.checkAIReadinessTool,
    analyze_dimensions_1.analyzeDimensionsTool,
    check_sitemap_health_1.checkSitemapHealthTool,
    generate_report_1.generateReportTool,
    publish_progress_1.publishProgressTool,
];
exports.DOC_MODE_TOOLS = DOC_MODE_TOOLS;

const GITHUB_ISSUES_TOOLS = [
    fetch_github_issues_1.fetchGithubIssuesTool,
    classify_docs_issues_1.classifyDocsIssuesTool,
    fetch_docs_context_1.fetchDocsContextTool,
    build_knowledge_base_1.buildKnowledgeBaseTool,
    analyze_issues_against_docs_1.analyzeIssuesAgainstDocsTool,
    create_pull_request_1.createPullRequestTool,
    save_github_issues_results_1.saveGithubIssuesResultsTool,
    publish_progress_1.publishProgressTool,
];

/**
 * Get the appropriate tools for the given mode.
 */
function getToolsForMode(mode) {
    switch (mode) {
        case 'github-issues':
            return GITHUB_ISSUES_TOOLS;
        case 'doc-analysis':
        default:
            return DOC_MODE_TOOLS;
    }
}

// ─── Model Configuration ────────────────────────────────────
function createModel(tools) {
    return new aws_1.ChatBedrockConverse({
        model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0,
        maxTokens: 4096,
    }).bindTools(tools);
}

// ─── System Prompts ─────────────────────────────────────────

const DOC_MODE_SYSTEM_PROMPT = `You are Lensy, a documentation quality analysis agent. Your job is to analyze documentation URLs and produce quality reports.

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
exports.DOC_MODE_SYSTEM_PROMPT = DOC_MODE_SYSTEM_PROMPT;

const GITHUB_ISSUES_SYSTEM_PROMPT = `You are Lensy, an AI agent that analyzes GitHub issues to identify documentation gaps and create fixes.

You have 8 tools available. Use the appropriate sequence based on the operation requested.

## Operation: fetch
Fetch and classify open issues from a GitHub repo.
1. Call \`publish_progress\` with message "Fetching GitHub issues..." and phase "url-processing"
2. Call \`fetch_github_issues\` with the owner and repo
3. Call \`publish_progress\` with message "Classifying issues..." and phase "structure-detection"
4. Call \`classify_docs_issues\` with the fetched issues
5. Call \`fetch_docs_context\` to check if the repo has documentation
6. Call \`publish_progress\` with type "success" and message "Issues fetched and classified!"
7. Return the classified issues, docs context, and suggested docs repos as your final response.

## Operation: analyze
Analyze selected issues against documentation to find gaps.
1. Call \`publish_progress\` with message "Starting deep analysis..." and phase "dimension-analysis"
2. If crawlUrl is provided, call \`build_knowledge_base\` first to crawl the docs website
3. Call \`fetch_docs_context\` to get documentation from the repo (and optional docsUrl)
4. Call \`analyze_issues_against_docs\` with the issues and docs
5. Call \`save_github_issues_results\` to save results to S3
6. Call \`publish_progress\` with type "success" and message "Analysis complete!"
7. Return the analysis results as your final response.

## Operation: build-kb
Build a knowledge base from a documentation website.
1. Call \`publish_progress\` with message "Building knowledge base..." and phase "url-processing"
2. Call \`build_knowledge_base\` with the crawlUrl
3. Call \`save_github_issues_results\` to save the KB status to S3
4. Call \`publish_progress\` with type "success" and message "Knowledge base ready!"
5. Return the KB status as your final response.

## Operation: create-pr
Create a GitHub Pull Request with a documentation fix.
1. Call \`publish_progress\` with message "Creating pull request..." and phase "report-generation"
2. Call \`create_pull_request\` with all the PR details
3. Call \`publish_progress\` with type "success" and message "Pull request created!"
4. Return the PR URL and details as your final response.

## Important Rules

- ALWAYS pass the correct sessionId to every tool call
- ALWAYS call publish_progress between major steps
- If a tool fails, report the error clearly — do not silently skip errors
- Keep your text responses minimal — return structured data (JSON) from the tools
- After the final tool call succeeds, respond with a brief summary. Do NOT call any more tools.
`;
exports.GITHUB_ISSUES_SYSTEM_PROMPT = GITHUB_ISSUES_SYSTEM_PROMPT;

/**
 * Get the system prompt for the given mode.
 */
function getSystemPromptForMode(mode) {
    switch (mode) {
        case 'github-issues':
            return GITHUB_ISSUES_SYSTEM_PROMPT;
        case 'doc-analysis':
        default:
            return DOC_MODE_SYSTEM_PROMPT;
    }
}

// ─── Graph Builder ──────────────────────────────────────────

/**
 * Build the LangGraph for the given mode.
 */
function buildGraph(mode = 'doc-analysis') {
    const modeTools = getToolsForMode(mode);
    const toolNode = new prebuilt_1.ToolNode(modeTools);

    async function agentNode(state) {
        const model = createModel(modeTools);
        const response = await model.invoke(state.messages);
        return { messages: [response] };
    }

    function shouldContinue(state) {
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage instanceof messages_1.AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
            return 'tools';
        }
        return langgraph_1.END;
    }

    const graph = new langgraph_1.StateGraph(AgentState)
        .addNode('agent', agentNode)
        .addNode('tools', toolNode)
        .addEdge(langgraph_1.START, 'agent')
        .addConditionalEdges('agent', shouldContinue)
        .addEdge('tools', 'agent');

    return graph.compile();
}

/**
 * Run the Lensy agent in the specified mode.
 * This is the main entry point called by the Lambda handler.
 */
async function runAgent(input) {
    const mode = input.mode || 'doc-analysis';
    console.log(`[Agent] Starting ${mode} analysis, session: ${input.sessionId}`);

    const app = buildGraph(mode);
    const systemPrompt = getSystemPromptForMode(mode);

    // Build the initial message based on mode
    const userMessage = mode === 'github-issues'
        ? buildGithubIssuesUserMessage(input)
        : buildDocModeUserMessage(input);

    const initialState = {
        messages: [
            new messages_1.SystemMessage(systemPrompt),
            new messages_1.HumanMessage(userMessage),
        ],
    };

    console.log(`[Agent] Invoking ${mode} graph...`);
    const finalState = await app.invoke(initialState, {
        recursionLimit: 50,
    });

    const lastMessage = finalState.messages[finalState.messages.length - 1];
    const responseText = lastMessage instanceof messages_1.AIMessage
        ? lastMessage.content
        : String(lastMessage);

    console.log(`[Agent] ${mode} complete. Final message length: ${String(responseText).length}`);
    return typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
}

// ─── User Message Builders ──────────────────────────────────

function buildDocModeUserMessage(input) {
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

function buildGithubIssuesUserMessage(input) {
    const parts = [
        `Operation: ${input.operation}`,
        `Session ID: ${input.sessionId}`,
    ];

    if (input.owner) parts.push(`Owner: ${input.owner}`);
    if (input.repo) parts.push(`Repo: ${input.repo}`);

    if (input.operation === 'fetch') {
        parts.push('Fetch recent open issues, classify them as docs-related or not, and check for existing documentation in the repo.');
    }

    if (input.operation === 'analyze') {
        parts.push(`Issues to analyze: ${input.issues?.length || 0}`);
        if (input.issues) {
            const issueList = input.issues.slice(0, 20).map(i =>
                `- #${i.number}: ${i.title}`
            ).join('\n');
            parts.push(`Issues:\n${issueList}`);
        }
        if (input.docsUrl) parts.push(`Docs repo URL: ${input.docsUrl}`);
        if (input.crawlUrl) parts.push(`Docs website to crawl: ${input.crawlUrl}`);
    }

    if (input.operation === 'build-kb') {
        parts.push(`Crawl URL: ${input.crawlUrl}`);
        parts.push('Build a knowledge base from this documentation website.');
    }

    if (input.operation === 'create-pr') {
        parts.push(`File path: ${input.filePath}`);
        parts.push(`Issue number: ${input.issueNumber}`);
        if (input.issueTitle) parts.push(`Issue title: ${input.issueTitle}`);
        if (input.originalText) parts.push(`Original text: ${input.originalText.substring(0, 500)}`);
        parts.push(`Corrected text: ${input.correctedText?.substring(0, 500)}`);
        if (input.gapType) parts.push(`Gap type: ${input.gapType}`);
        if (input.confidence) parts.push(`Confidence: ${input.confidence}%`);
    }

    return parts.join('\n');
}
