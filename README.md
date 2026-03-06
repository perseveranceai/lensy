# Lensy - Documentation Quality Auditor

AI-powered documentation quality auditor with real-time analysis, transparency, and multi-model validation.

## Features

### Doc Audit Mode
- **LangGraph Agent Pipeline**: Autonomous agent (Claude 3.5 Sonnet) orchestrates analysis via tool calling
- **5-Dimension Analysis**: Relevance, Freshness, Clarity, Accuracy, and Completeness
- **Deep Context Knowledge Base**: DynamoDB-backed KB populated from llms.txt for cross-page context enrichment
- **AI Readiness Assessment**: Evaluates documentation for AI/LLM consumption (llms.txt, robots.txt, structured data)
- **Content Gate**: Blocks non-documentation pages (blogs, marketing) from analysis
- **Code Validation**: Syntax checking, deprecated method detection, and version compatibility
- **Link Validation**: Detects broken links, redirects, and URL quality issues
- **Real-time Progress Streaming**: Live updates during analysis via WebSocket
- **Quality Validation**: LLM-as-Judge approach with dual model validation for reliability
- **Complete Transparency**: Full audit trail of all AI decisions and reasoning

### GitHub Issues Mode
- **Repository Analysis**: Analyzes GitHub issues for documentation quality patterns
- **llms.txt Crawling**: Parses llms.txt to build domain Knowledge Base for context-aware analysis
- **Batch Processing**: Analyzes multiple issues with progress tracking

### Sitemap Mode
- **Sitemap Health Check**: Validates sitemap structure, URL accessibility, and coverage
- **Bulk URL Analysis**: Discovers all documentation pages from sitemaps

## Architecture

- **Frontend**: React 18 + TypeScript + Material-UI, deployed to S3/CloudFront
- **Console Shell**: Password-protected portal at `console.perseveranceai.com` (gamma: `gamma.console.perseveranceai.com`)
- **Backend**: AWS CDK stack (`LensyStack`) parameterized by `LENSY_ENV` (gamma/prod)
- **Two Analysis Pipelines**:
  - **LangGraph Agent** (`USE_AGENT=true`, default): Autonomous agent with tool calling — `backend/lambda/agent-handler/`
  - **Step Functions** (`USE_AGENT=false`): Legacy orchestration via State Machine
- **AI Models**: AWS Bedrock — Claude 3.5 Sonnet (analysis), Claude 3 Haiku (summarization)
- **Knowledge Base**: DynamoDB `PageKnowledgeBase` table — stores page summaries keyed by domain, 7-day TTL
- **Real-time**: WebSocket API for progress streaming
- **Auth**: CloudFront Function validates access codes server-side; cookie-based sessions with 48-hour expiry
- **Infrastructure**: AWS CDK for reproducible deployments

### Agent Pipeline Architecture

The LangGraph agent (`agent.ts`) orchestrates analysis through tool calling:

```
detect_input_type → check_ai_readiness (if llms.txt) → process_url → detect_structure → analyze_dimensions → generate_report
```

Tools (in execution order):
1. `detect_input_type` — Classifies URL as doc page or sitemap
2. `check_ai_readiness` — Checks AI readiness signals; crawls llms.txt to populate DynamoDB KB
3. `publish_progress` — Sends real-time status updates via WebSocket
4. `process_url` — Fetches, parses, and enriches content with KB context
5. `detect_structure` — Classifies document type (tutorial, reference, guide, etc.)
6. `analyze_dimensions` — Scores across 5 quality dimensions with evidence
7. `check_sitemap_health` — Validates sitemap structure and URLs
8. `generate_report` — Produces final quality report

### Knowledge Base Flow

When a user provides an llms.txt URL:
1. Agent calls `check_ai_readiness` which parses llms.txt entries
2. Pages are crawled in batches of 10, summarized with Haiku, and written to DynamoDB
3. Subsequent runs skip crawling if KB already has ≥10 entries for the domain (7-day TTL)
4. `process_url` queries the KB by domain to enrich discovered context pages

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- AWS CLI configured with your credentials
- AWS CDK installed globally: `npm install -g aws-cdk`
- AWS account with Bedrock model access

### Setup

1. **Install dependencies**:
   ```bash
   npm run setup
   ```

2. **Deploy backend infrastructure to AWS**:
   ```bash
   cd backend
   LENSY_ENV=gamma npx cdk deploy   # gamma environment
   LENSY_ENV=prod npx cdk deploy    # production environment
   ```

3. **Build and deploy frontend**:
   ```bash
   cd frontend
   npm run build:gamma
   aws s3 sync build/ s3://lensy-console-951411676525-us-east-1-gamma --delete
   aws cloudfront create-invalidation --distribution-id E1J3M0RUB5VA7F --paths "/*"
   ```

4. **Start frontend development server locally**:
   ```bash
   cd frontend
   npm start
   ```

### Direct Lambda Deployment

For faster iteration (bypasses CDK asset hashing):
```bash
cd backend/lambda/agent-handler
zip -r /tmp/agent-handler.zip . -x "*.ts" "tsconfig.json" "*.d.ts"
aws lambda update-function-code --function-name <function-name> --zip-file fileb:///tmp/agent-handler.zip
```

## Project Structure

```
lensy/
├── frontend/                     # React frontend application
│   ├── src/
│   │   ├── App.tsx              # Router: login, console shell, protected routes
│   │   ├── Login.tsx            # Login page (sets cookie, no password validation)
│   │   ├── ConsoleLayout.tsx    # Console shell (header, nav, breadcrumbs, sign out)
│   │   ├── LensyApp.tsx         # Lensy service UI (tabs: Doc Audit, GitHub Issues, Sitemap)
│   │   └── components/          # Shared React components
├── backend/                     # AWS CDK backend infrastructure
│   ├── lib/
│   │   └── lensy-stack.ts       # CDK stack (Lambdas, API GW, CloudFront, DynamoDB, auth)
│   ├── lambda/
│   │   ├── agent-handler/       # LangGraph agent pipeline
│   │   │   ├── agent.ts         # Agent graph, system prompt, tool orchestration
│   │   │   ├── index.ts         # Lambda handler entry point
│   │   │   ├── tools/           # Agent tools (8 tools)
│   │   │   └── shared/          # Shared modules (page-summarizer, crawl-helpers, s3-helpers)
│   │   ├── api-handler/         # REST API handler (POST /analyze, GET /status)
│   │   ├── github-issues-analyzer/ # GitHub Issues analysis Lambda
│   │   └── lambda-layers/       # Shared Lambda layers
│   └── bin/                     # CDK app entry point
```

## Implementation Status

### Completed
- ✅ LangGraph agent pipeline with tool calling (replaced Step Functions as default)
- ✅ 5-dimension analysis with evidence-based scoring
- ✅ Deep context Knowledge Base via DynamoDB (llms.txt crawling + page summarization)
- ✅ AI readiness assessment (llms.txt, llms-full.txt, robots.txt, JSON-LD)
- ✅ Content gate — blocks non-doc pages (blogs, marketing content)
- ✅ Real-time progress streaming via WebSocket
- ✅ Link validation (broken links, redirects, URL slug quality)
- ✅ Code validation (syntax checking, deprecated methods)
- ✅ GitHub Issues analysis mode
- ✅ Sitemap health check mode
- ✅ Console shell with password auth (CloudFront Function)
- ✅ S3/CloudFront frontend deployment (gamma + prod)
- ✅ Subdomain normalization for KB domain keys (e.g., `dev.dotcms.com` → `dotcms-com`)

### Pending / In Progress
- 🔲 Increase KB crawl coverage (currently caps at 50 pages from llms.txt)
- 🔲 Fix generation and application (Apply Selected Fixes hidden until CMS integration)
- 🔲 CMS write-back integration (Phase 4 — dotCMS, WordPress, etc.)
- 🔲 Multi-page batch analysis from sitemap
- 🔲 Historical trend tracking across audits
- 🔲 Competitive benchmarking against similar documentation

### Design Partner Feedback (dotCMS) — Round 1 (Completed)
- ✅ Advanced Options collapsed by default
- ✅ Link validation integrated into process_url
- ✅ Auto-fix UI hidden (no CMS integration yet)
- ✅ Deep context KB via DynamoDB for cross-page enrichment
- ✅ Subdomain normalization fix for `deriveSafeDomain`

### Design Partner Feedback — Round 2 (In Progress)
- ✅ llms.txt KB population via agent tool calling (agentic, not hardcoded)
- ✅ KB skip logic — avoids re-crawling if domain already has ≥10 KB entries
- ✅ Tool ordering fix — reordered tools array to match execution sequence
- ✅ Handler passthrough fix — `llmsTxtUrl` and `sitemapUrl` now passed from index.ts to agent
- 🔲 KB enrichment count showing in report ("X enriched from KB")
- 🔲 Performance optimization for first-run KB population (currently ~3 min for 50 pages)

## Console Access & Password Management

The console at `console.perseveranceai.com` is protected by access codes. Password validation happens entirely in a **CloudFront Function** — the frontend does not validate passwords.

### Adding Access Codes

1. Open `backend/lib/lensy-stack.ts`
2. Find the `validPasswords` object in the CloudFront Function code
3. Add entries (format: `'password': true`)
4. Deploy: `cd backend && cdk deploy`

No frontend redeployment needed.

## Configuration

### AWS Region

The system is configured for `us-east-1` by default. To use a different region:
1. Update `backend/bin/app.ts`
2. Ensure Bedrock models are available in your chosen region
3. Redeploy: `cd backend && npx cdk deploy`

### Model Access

Bedrock models required:
- `us.anthropic.claude-3-5-sonnet-20241022-v2:0` (main analysis)
- `us.anthropic.claude-3-haiku-20240307-v1:0` (page summarization for KB)

Go to AWS Console → Bedrock → Model Access to enable.

## License

MIT License - see LICENSE file for details.
