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

- **Frontend**: React 18 + TypeScript + Material-UI, deployed to S3/CloudFront at `console.perseveranceai.com`
- **Console Shell**: Password-protected portal wrapping Lensy (and future services) with Perseverance AI branding
- **Backend**: AWS Lambda functions orchestrated by Step Functions (deployed to AWS)
- **AI Models**: AWS Bedrock integration with Claude, Titan, and Llama
- **Real-time**: WebSocket API for progress streaming
- **Auth**: CloudFront Function validates access codes server-side; cookie-based sessions with 48-hour expiry
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
- **Frontend (Console)**: Deployed to S3 + CloudFront via CDK
  - URL: https://console.perseveranceai.com
  - S3 bucket for static assets, CloudFront for CDN + auth
  - CloudFront Function handles password validation server-side
- **Local Development**: `cd frontend && npm start` for local dev server

## Console Access & Password Management

The console at `console.perseveranceai.com` is protected by access codes. Password validation happens entirely in a **CloudFront Function** — the frontend does not validate passwords. This means passwords are managed in **one place only**.

### How It Works

1. User enters an access code on the login page
2. Login page sets a cookie (`perseverance_console_token`) with the code and timestamp, then redirects to `/console`
3. CloudFront Function intercepts every request and validates the cookie server-side
4. If the code is invalid or expired (48 hours), CloudFront redirects back to `/login?error=auth`

### Adding, Changing, or Extending Access Codes

All access codes live in the `validPasswords` object inside the CloudFront Function defined in `backend/lib/lensy-stack.ts`. To manage access codes:

1. Open `backend/lib/lensy-stack.ts`
2. Find the `validPasswords` object in the CloudFront Function code
3. Add, remove, or change entries as needed (format: `'password': true`)
4. Deploy: `cd backend && cdk deploy`

**No frontend redeployment is needed.** The CloudFront Function updates independently. An IDE agent (e.g., Cursor, Claude Code) can perform this entire flow.

### Example: Adding a New Access Code

```javascript
// In backend/lib/lensy-stack.ts → CloudFront Function → validPasswords
var validPasswords = {
    'existing-code': true,
    'new-code-for-shawn': true,   // ← just add a new line
};
```

Then run:
```bash
cd backend && cdk deploy
```

### Extending Session Duration

The session expiry (default: 48 hours) is also controlled in the CloudFront Function. Find the `EXPIRY_MS` constant in the function code and adjust as needed. The frontend's `EXPIRY_HOURS` in `Login.tsx` should be kept in sync for consistent UX (cookie expiry on the browser side).

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
│   │   ├── App.tsx          # Router: login, console shell, protected routes
│   │   ├── Login.tsx        # Login page (sets cookie, no password validation)
│   │   ├── ConsoleLayout.tsx # Console shell (header, nav, breadcrumbs, sign out)
│   │   ├── ConsoleDashboard.tsx # Service card grid (Lensy + future services)
│   │   ├── LensyApp.tsx     # Lensy service UI (analysis, fixes, reports)
│   │   ├── components/      # Shared React components
│   │   └── types/           # TypeScript type definitions
├── backend/                 # AWS CDK backend infrastructure
│   ├── lib/
│   │   └── lensy-stack.ts   # CDK stack (Lambdas, API GW, CloudFront, auth)
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
- **Console Frontend**: ✅ S3 + CloudFront at `console.perseveranceai.com`
- **Auth**: ✅ CloudFront Function (server-side password validation, 48-hour sessions)
- **API Endpoints**: ✅ Active at https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com/
- **WebSocket**: ✅ Active at wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod
- **Lambda Functions**: ✅ All deployed (IssueDiscoverer, IssueValidator, FixGenerator, FixApplicator, AIReadinessChecker, SitemapParser, SitemapHealthChecker)
- **Cleanup**: ✅ Test files removed, source preserved, documentation updated

## License

MIT License - see LICENSE file for details.