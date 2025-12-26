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

## Architecture

- **Frontend**: React with Material-UI for rapid, professional interface
- **Backend**: AWS Lambda functions orchestrated by Step Functions
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

2. **Deploy backend infrastructure**:
   ```bash
   cd backend
   npm run deploy
   ```

3. **Start frontend development server**:
   ```bash
   cd frontend
   npm start
   ```

### Development

- **Frontend development**: `npm run dev:frontend`
- **Backend development**: `npm run dev:backend`
- **Run tests**: `npm test`
- **Build for production**: `npm run build`

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
└── docs/                    # Documentation and specs
```

## Implementation Status

This is a 24-hour MVP implementation focusing on:
- ✅ Core infrastructure setup
- 🔄 URL processing and content extraction
- 🔄 Multi-model AI analysis
- 🔄 Real-time progress streaming
- 🔄 Quality validation and transparency
- 🔄 React frontend with Material-UI

## License

MIT License - see LICENSE file for details.