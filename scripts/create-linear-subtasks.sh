#!/bin/bash
# Creates 19 sub-tasks under GET-8 (Agent / Sub-Agents Development Phase 1)
# Parent ID: fedba250-87aa-4f14-a1d9-ede5f80332aa
# Team ID: c301390b-65eb-4749-b202-35fc02e5d835

# You need a Linear API key. Get one from: https://linear.app/getperseverance/settings/api
# Export it: export LINEAR_API_KEY="lin_api_xxxxx"

if [ -z "$LINEAR_API_KEY" ]; then
  echo "ERROR: Set LINEAR_API_KEY first"
  echo "  export LINEAR_API_KEY='lin_api_xxxxx'"
  echo "  Get one from: https://linear.app/getperseverance/settings/api"
  exit 1
fi

PARENT_ID="fedba250-87aa-4f14-a1d9-ede5f80332aa"
TEAM_ID="c301390b-65eb-4749-b202-35fc02e5d835"
API="https://api.linear.app/graphql"

create_subtask() {
  local title="$1"
  local description="$2"
  local priority="$3"  # 1=Urgent, 2=High, 3=Normal, 4=Low

  curl -s -X POST "$API" \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$(cat <<EOF
{
  "query": "mutation CreateIssue(\$input: IssueCreateInput!) { issueCreate(input: \$input) { success issue { identifier title url } } }",
  "variables": {
    "input": {
      "title": "$title",
      "description": "$description",
      "teamId": "$TEAM_ID",
      "parentId": "$PARENT_ID",
      "priority": $priority
    }
  }
}
EOF
)" | python3 -c "import sys,json; d=json.load(sys.stdin); i=d.get('data',{}).get('issueCreate',{}).get('issue',{}); print(f'  ✅ {i.get(\"identifier\",\"?\")} — {i.get(\"title\",\"?\")}')" 2>/dev/null || echo "  ❌ Failed: $title"
}

echo "🚀 Creating 19 sub-tasks under GET-8..."
echo ""

# Foundation (Tasks 1-2)
echo "📦 Foundation"
create_subtask \
  "Scaffold agent-handler directory, package.json, tsconfig.json" \
  "Create \`backend/lambda/agent-handler/\` with:\n- \`package.json\` — \`@langchain/langgraph\`, \`@langchain/aws\` (Bedrock), \`@langchain/core\`, \`zod\`, AWS SDK deps\n- \`tsconfig.json\` — ES2020, CommonJS\n- Directory structure: \`tools/\`, \`shared/\`" \
  2

create_subtask \
  "Create shared helpers: s3-helpers, bedrock-helpers, progress-publisher, types" \
  "Create \`agent-handler/shared/\`:\n- \`s3-helpers.ts\` — S3 read/write for session artifacts\n- \`bedrock-helpers.ts\` — Bedrock invocation wrapper\n- \`progress-publisher.ts\` — Copy from lambda-layers/shared (reuse as-is)\n- \`types.ts\` — Shared interfaces" \
  2

# Tools (Tasks 3-10)
echo ""
echo "🔧 Tools"
create_subtask \
  "Tool 1: detect-input-type — port from input-type-detector (123 lines)" \
  "Port URL pattern matching logic. Detect doc vs sitemap mode. Supports manual override.\n\nInput: \`{ url: string }\`\nOutput: \`{ inputType: 'doc' | 'sitemap', confidence: number }\`" \
  3

create_subtask \
  "Tool 2: process-url — port from url-processor (1791 lines)" \
  "**Highest complexity tool.** Port:\n- HTML fetch + noise stripping\n- HTML → Markdown (Turndown + GFM)\n- URL slug typo detection (Levenshtein)\n- Link validation (batches of 10)\n- Code snippet extraction + LLM analysis\n- Context analysis (parent/child/sibling)\n- DynamoDB + S3 caching (7-day TTL)" \
  2

create_subtask \
  "Tool 3: detect-structure — port from structure-detector (198 lines)" \
  "Single Bedrock call to classify doc structure:\n- Single-topic vs multi-topic\n- Content type: api-docs, tutorial, reference, product-guide, mixed\n- Store results in S3" \
  3

create_subtask \
  "Tool 4: check-ai-readiness — port from ai-readiness-checker (165 lines)" \
  "HTTP checks for AI-friendliness:\n- /llms.txt, /llms-full.txt detection\n- robots.txt AI bot directives\n- JSON-LD structured data\n- Markdown export links\n- AI-readiness score (0-100)" \
  3

create_subtask \
  "Tool 5: analyze-dimensions — port from dimension-analyzer (920 lines)" \
  "**High complexity.** 5 parallel Bedrock calls:\n1. Relevance (15-30% weight)\n2. Freshness (10-35% weight)\n3. Clarity (20-35% weight)\n4. Accuracy (15-35% weight)\n5. Completeness (5-10% weight)\n\nContent-type-aware scoring, spelling detection, terminology checks, URL slug penalties." \
  2

create_subtask \
  "Tool 6: check-sitemap-health — merge 3 Lambdas (1129 lines)" \
  "Merge sitemap-parser + sitemap-health-checker + sitemap-health-for-doc-mode:\n- Discover sitemap via robots.txt\n- Parse XML sitemaps (recursive, max depth 3)\n- Validate URL accessibility (batches of 10, 8s timeout)\n- Cache domain-level results (7-day TTL)" \
  3

create_subtask \
  "Tool 7: generate-report — port from report-generator (659 lines)" \
  "Aggregate all S3 artifacts into final report:\n- Overall score (dimension averages)\n- Code analysis summary\n- Media analysis\n- Link analysis\n- Context analysis\n- AI readiness results\n- Cache status metadata" \
  3

create_subtask \
  "Tool 8: publish-progress — WebSocket progress wrapper" \
  "Thin wrapper (~50 lines) around existing ProgressPublisher.\nPublish real-time progress messages to frontend via WebSocket after each tool execution." \
  4

# Agent Orchestration (Tasks 11-12)
echo ""
echo "🧠 Agent Orchestration"
create_subtask \
  "Create LangGraph agent graph (agent.ts)" \
  "LangGraph StateGraph with:\n- Typed state interface (AgentState)\n- Nodes for each tool\n- Conditional edges (doc vs sitemap routing)\n- System prompt with prescriptive tool sequence\n- Bedrock Claude model via @langchain/aws\n- temperature=0 for deterministic behavior" \
  2

create_subtask \
  "Create Lambda handler (index.ts)" \
  "Entry point for agent Lambda:\n- Receives \`{url, sessionId, selectedModel}\`\n- Invokes LangGraph agent\n- Writes final report to S3\n- Handles errors gracefully (partial report on tool failure)" \
  2

# Infrastructure (Tasks 13-15)
echo ""
echo "🏗️ Infrastructure"
create_subtask \
  "Update CDK stack — add agent Lambda + USE_AGENT flag" \
  "In \`lensy-stack.ts\`:\n- Add agent Lambda (Node.js 20, 15min timeout, 1024MB)\n- Grant: Bedrock InvokeModel, S3 read/write, DynamoDB read/write, WebSocket ManageConnections\n- Add USE_AGENT env var to api-handler\n- Grant api-handler → invoke agent Lambda" \
  2

create_subtask \
  "Update api-handler — route to agent when USE_AGENT=true" \
  "In \`handleAnalyzeRequest()\`:\n- When \`USE_AGENT=true\`: async-invoke agent Lambda (InvokeCommand, InvocationType: Event)\n- When \`USE_AGENT=false\` or unset: keep existing Step Functions flow\n- GET /status unchanged (reads S3 directly, works with both)" \
  2

create_subtask \
  "Update build:lambdas script for agent-handler" \
  "Add agent-handler TypeScript compilation + npm install to \`package.json\` build:lambdas script." \
  4

# Deploy & Verify (Tasks 16-19)
echo ""
echo "🚀 Deploy & Verify"
create_subtask \
  "Deploy agent to gamma with USE_AGENT=true" \
  "Deploy to gamma:\n\`LENSY_ENV=gamma npm run deploy\`\n\nVerify:\n- Agent Lambda created in AWS console\n- USE_AGENT=true set on api-handler\n- All permissions granted" \
  2

create_subtask \
  "Test agent on gamma — compare with Step Functions output" \
  "Run 5+ URLs through agent on gamma:\n- Compare reports with Step Functions output\n- Scores within ~5% tolerance\n- All S3 artifacts created correctly\n- Edge cases: large pages, broken URLs, unreachable domains" \
  2

create_subtask \
  "Verify WebSocket progress streaming from agent" \
  "On gamma.console.perseveranceai.com:\n- Click Analyze\n- Confirm progress messages stream in real-time\n- Verify progress panel shows tool-by-tool updates\n- Verify report renders correctly at end" \
  3

create_subtask \
  "Rollback test — verify Step Functions fallback" \
  "Set USE_AGENT=false on gamma api-handler.\nRun analysis — verify Step Functions executes correctly.\nConfirm zero regression." \
  3

echo ""
echo "✅ Done! Check Linear: https://linear.app/getperseverance/issue/GET-8"
