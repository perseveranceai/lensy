# Lensy - Documentation Quality Auditor

AI-powered documentation quality auditor with real-time analysis, transparency, and multi-model validation.

## Features

- **Multi-Model AI Analysis**: Uses Claude, Titan, and Llama models for comprehensive evaluation
- **Real-time Progress Streaming**: Live updates during analysis with WebSocket connections
- **Quality Validation**: LLM-as-Judge approach with dual model validation for reliability
- **Complete Transparency**: Full audit trail of all AI decisions and reasoning
- **5-Dimension Analysis**: Relevance, Freshness, Clarity, Accuracy, and Completeness
- **Code Validation**: Syntax checking, deprecated method detection, and version compatibility
- **Graceful Degradation**: Partial results when some analysis components fail
- **Link Analysis**: Identifies sub-pages and provides analysis scope context
- **Fix Generation**: AI-powered fix generation for documentation issues
- **Fix Application**: Automated fix application with CDN invalidation
- **HTML Generation**: Static HTML generation from Markdown with CDN hosting
- **AI Readiness Assessment**: Evaluates documentation for AI/LLM consumption

## Architecture

- **Frontend**: React with Material-UI running locally (never deployed to AWS)
- **Backend**: AWS Lambda functions orchestrated by Step Functions (deployed to AWS)
- **AI Models**: AWS Bedrock integration with Claude, Titan, and Llama
- **Real-time**: WebSocket API for progress streaming
- **Infrastructure**: AWS CDK for reproducible deployments

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
   npm run deploy
   ```
   Note: Backend is deployed to AWS Lambda. Current API endpoint: https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com/

3. **Start frontend development server locally**:
   ```bash
   cd frontend
   npm start
   ```
   Note: Frontend runs locally only and connects to the deployed AWS backend.

### Development

- **Frontend development**: `npm run dev:frontend` (runs locally, connects to AWS backend)
- **Backend development**: `npm run dev:backend` (for local testing before AWS deployment)
- **Run tests**: `npm test`
- **Build frontend**: `cd frontend && npm run build` (for local optimization only)

### Deployment Architecture

- **Backend**: Deployed to AWS Lambda via CDK
  - API Gateway: https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com/
  - WebSocket: wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod
- **Frontend**: Runs locally via `npm start` in the frontend/ directory
  - Never deployed to AWS
  - Connects to deployed AWS backend APIs

## Testing URLs

The system is optimized for WordPress developer documentation:

- Block Editor: https://developer.wordpress.org/block-editor/
- Dashboard Widgets: https://developer.wordpress.org/apis/dashboard-widgets/
- Internationalization: https://developer.wordpress.org/apis/internationalization/
- Plugin Handbook: https://developer.wordpress.org/plugins/

## Configuration

### AWS Region

The system is configured for `us-east-1` by default. To use a different region:

1. Update `backend/bin/app.ts`
2. Ensure Bedrock models are available in your chosen region
3. Redeploy: `cd backend && npm run deploy`

### Model Access

Bedrock models are automatically enabled on first use. If you encounter access issues:

1. Go to AWS Console → Bedrock → Model Access
2. Request access for Claude, Titan, and Llama models
3. For Anthropic models, you may need to submit use case details

## Project Structure

```
lensy/
├── frontend/                 # React frontend application
│   ├── src/
│   │   ├── components/      # React components
│   │   └── types/           # TypeScript type definitions
├── backend/                 # AWS CDK backend infrastructure
│   ├── lib/                 # CDK stack definitions
│   ├── lambda/              # Lambda function source code
│   ├── lambda-layers/       # Shared Lambda layers
│   └── bin/                 # CDK app entry point
└── .kiro/                   # Documentation and specs
```

## Implementation Status

This is a comprehensive MVP implementation with all phases complete:
- ✅ Core infrastructure setup (AWS backend deployed)
- ✅ URL processing and content extraction
- ✅ Multi-model AI analysis with Claude 3.5 Sonnet
- ✅ Real-time progress streaming via WebSocket
- ✅ Quality validation and transparency
- ✅ React frontend with Material-UI (runs locally)
- ✅ Critical findings: broken links, deprecated code, syntax errors
- ✅ Enhanced dashboard with findings display
- ✅ Markdown report export functionality
- ✅ Issue discovery and validation system
- ✅ Fix generation with AI-powered suggestions
- ✅ Fix application with CDN invalidation
- ✅ HTML generation from Markdown
- ✅ AI readiness assessment

### Current Deployment Status
- **Backend**: ✅ Deployed to AWS Lambda
- **Frontend**: ✅ Runs locally, connects to AWS backend
- **API Endpoints**: ✅ Active at https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com/
- **WebSocket**: ✅ Active at wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod
- **Lambda Functions**: ✅ All deployed (IssueDiscoverer, IssueValidator, FixGenerator, FixApplicator, AIReadinessChecker, SitemapParser, SitemapHealthChecker)
- **Cleanup**: ✅ Test files removed, source preserved, documentation updated

## License

MIT License - see LICENSE file for details.