# Design Document: Documentation Quality Auditor

## Implementation Status (Updated January 10, 2026)

### ✅ Completed Features (All Phases)

**Phase 1: Doc Mode** ✅ Fully Deployed
- Individual page analysis with 5 quality dimensions
- Real-time WebSocket progress streaming
- Content-type-aware scoring
- Enhanced code analysis with deprecation detection
- Internal link validation
- Intelligent caching with session-based S3
- Multi-model AI support (Claude 3.5 Sonnet)

**Phase 2: Sitemap Journey Mode** ✅ Fully Deployed
- Sitemap parsing with nested sitemap support
- Bulk URL health checking (217 URLs for Resend.com)
- Developer journey detection and grouping
- Journey-aware content analysis
- Journey score aggregation with completion confidence
- Comprehensive journey reports

**Phase 3: Issue Discovery Mode** ✅ **COMPLETED**
- **IssueDiscoverer Lambda**: Searches for real developer issues across 3 domains ✅
- **IssueValidator Lambda**: Validates issues against current documentation ✅
  - Semantic search using Amazon Titan embeddings
  - Pre-curated pages + sitemap fallback
  - Gap detection (critical, potential, resolved)
  - AI-powered recommendations with BEFORE/AFTER code
- **SitemapHealthChecker Integration**: Parallel sitemap health analysis ✅
- **Frontend UI**: Three-mode selection with real-time updates ✅
- **Report Export**: Markdown reports with sitemap health section ✅

### 🎯 Multi-Domain Support (3 Domains)

**Supported Domains:**
- ✅ **resend.com**: Email delivery platform (5 issues)
- ✅ **liveblocks.io**: Real-time collaboration (1 issue)
- ✅ **docs.knock.app**: Notification infrastructure (2 issues)

**Domain Configuration:**
```typescript
const DOMAIN_SITEMAP_CONFIG = {
    'resend.com': {
        sitemapUrl: 'https://resend.com/docs/sitemap.xml',
        docFilter: '/docs/'
    },
    'liveblocks.io': {
        sitemapUrl: 'https://liveblocks.io/sitemap.xml',
        docFilter: '/docs'
    },
    'docs.knock.app': {
        sitemapUrl: 'https://docs.knock.app/sitemap.xml',
        docFilter: '/'
    }
};
```

### 🎯 Production Deployment Status

**Deployed Lambdas:**
- ✅ IssueDiscoverer: Discovers issues from Stack Overflow and community forums
- ✅ IssueValidator: Validates issues with semantic search + AI recommendations
- ✅ SitemapParser: Parses sitemap.xml for all 3 domains
- ✅ SitemapHealthChecker: Bulk URL validation with categorization
- ✅ API Handler: Routes requests to appropriate Lambda

**IAM Permissions:**
- ✅ IssueValidator can invoke SitemapParser and SitemapHealthChecker
- ✅ Bedrock access for Claude Sonnet 4.5 and Titan embeddings
- ✅ S3 access for session storage and embeddings cache

**Frontend:**
- ✅ Three-mode UI (Doc, Sitemap, Issue Discovery)
- ✅ Real-time progress streaming via WebSocket
- ✅ Sitemap health display with expandable details
- ✅ Markdown export with comprehensive sections
- ✅ Fixed NaN display bug in sitemap health counts
- ✅ Accurate executive summary

### 📊 Production Metrics
- **Processing Time**: ~23-25 seconds end-to-end
- **Semantic Search**: 5 pages analyzed per issue
- **AI Recommendations**: 2 detailed code improvements per issue
- **Validation Confidence**: 70-95% depending on match quality

### 🔧 Technical Implementation

**Semantic Search Pipeline:**
1. Pre-generate embeddings for all documentation pages (Amazon Titan)
2. Store embeddings in S3 with domain-specific keys
3. Generate embedding for developer issue (title + description + code + errors)
4. Calculate cosine similarity between issue and all pages
5. Return top 5 matches with similarity scores

**AI Recommendation Generation:**
1. Fetch actual page content from best matching documentation page
2. Extract existing code snippets from the page
3. Compare with developer's issue code snippets
4. Generate BEFORE/AFTER code improvements using Claude Sonnet 4.5
5. Provide 2 detailed recommendations with explanations

**Sitemap Health Integration:**
1. Run issue validation and sitemap health check in parallel
2. Complete both in ~5 seconds using Promise.all()
3. Combine results in single API response
4. Display both sections in UI and export report

### 📝 Implementation Notes
- **Real Data**: 8 authentic issues from Stack Overflow and community forums
- **Pragmatic POC**: Manual research + real-issues-data.json
- **Extensible**: Can upgrade to Google Custom Search API or MCP servers
- **CEO-Ready**: Clean code, accurate reporting, professional export

## Overview

Lensy is a web-based documentation quality auditor that operates in three distinct modes:

1. **Doc Mode** (existing): Analyzes individual documentation URLs across five quality dimensions with real-time progress streaming and comprehensive quality reports
2. **Sitemap Journey Mode** (existing): Analyzes entire documentation portals via sitemap.xml to detect developer journeys, assess workflow completion confidence, and provide journey-specific quality insights
3. **Issue Discovery Mode** (new): Discovers real developer problems online, validates them against current documentation, and provides targeted analysis focusing on actual developer pain points

All modes use a React frontend with AWS Lambda backend, leveraging AWS Bedrock's AI capabilities for analysis. The system supports real-time progress streaming, graceful degradation, intelligent caching, and configurable model selection.

## Architecture

### High-Level Architecture

```mermaid
graph TB
    A[React Frontend] --> B[API Gateway]
    B --> C[Lambda: URL Processor]
    B --> D[Lambda: Structure Detector]
    B --> E[Lambda: Dimension Analyzer]
    
    C --> F[Content Extractor]
    C --> CA[Context Analyzer]
    C --> CC[Content Cache]
    D --> G[Topic Identifier]
    E --> H[AWS Bedrock Models]
    
    H --> I[Claude]
    H --> J[Titan]
    H --> K[Llama]
    H --> L[Auto Selection]
    
    E --> M[Progress Streamer]
    E --> N[Report Generator]
    
    CC --> DDB[DynamoDB Index]
    CC --> S3C[S3 Cache Storage]
    
    subgraph "Quality Dimensions"
        O[Relevance Analyzer]
        P[Freshness Analyzer]
        Q[Clarity Analyzer]
        R[Accuracy Analyzer]
        S[Completeness Analyzer]
    end
    
    E --> O
    E --> P
    E --> Q
    E --> R
    E --> S
    
    subgraph "Context Analysis"
        CT[Context Discovery]
        CF[Context Fetching]
        CR[Context Relevance]
    end
    
    CA --> CT
    CA --> CF
    CA --> CR
```

### Sitemap Journey Mode Architecture

```mermaid
graph TB
    A[React Frontend] --> B[API Gateway]
    B --> ITD[Input Type Detector]
    
    ITD --> DOC[Doc Mode - Existing]
    ITD --> SIT[Sitemap Mode - New]
    
    subgraph "Doc Mode (Unchanged)"
        DOC --> UP[URL Processor]
        UP --> SD[Structure Detector]
        SD --> DA[Dimension Analyzer]
        DA --> RG[Report Generator]
    end
    
    subgraph "Sitemap Journey Mode (New)"
        SIT --> SP[Sitemap Parser]
        SP --> SHC[Sitemap Health Check]
        SHC --> JD[Journey Detector]
        JD --> JSU[Journey Selection UI]
        JSU --> JA[Journey Analyzer]
        JA --> JAG[Journey Aggregator]
        JAG --> JRG[Journey Report Generator]
        
        SP --> LC[Link Checker - Reused]
        JA --> UP2[URL Processor - Reused]
        JA --> DA2[Dimension Analyzer - Enhanced]
        
        JAG --> JC[Journey Cache - New]
        JC --> S3J[S3 Journey Storage]
    end
    
    subgraph "Shared Infrastructure"
        UP --> CC[Content Cache]
        UP2 --> CC
        CC --> DDB[DynamoDB Index]
        CC --> S3C[S3 Cache Storage]
        
        DA --> H[AWS Bedrock Models]
        DA2 --> H
        
        PS[Progress Streamer] --> WS[WebSocket Handler]
        DA --> PS
        DA2 --> PS
        JA --> PS
    end
```

### Issue Discovery Mode Architecture

```mermaid
graph TB
    A[React Frontend] --> B[API Gateway]
    B --> ITD[Input Type Detector]
    
    ITD --> DOC[Doc Mode]
    ITD --> SIT[Sitemap Mode]
    ITD --> IDS[Issue Discovery Mode - New]
    
    subgraph "Issue Discovery Mode (New)"
        IDS --> ID[Issue Discoverer]
        ID --> WS[Web Search APIs]
        ID --> ISU[Issue Selection UI]
        ISU --> IV[Issue Validator]
        IV --> UP3[URL Processor - Reused]
        IV --> DA3[Dimension Analyzer - Enhanced]
        IV --> SHC2[Sitemap Health Check - Reused]
        DA3 --> IRG[Issue Report Generator]
        
        ID --> IC[Issue Cache - New]
        IC --> S3I[S3 Issue Storage]
    end
    
    subgraph "Shared Infrastructure"
        UP3 --> CC[Content Cache]
        DA3 --> H[AWS Bedrock Models]
        PS[Progress Streamer] --> WS2[WebSocket Handler]
        IV --> PS
        DA3 --> PS
    end
```

### Component Architecture

The system follows a microservices pattern with distinct Lambda functions for each major operation:

1. **Frontend Layer**: React SPA with context analysis UI and real-time WebSocket connections
2. **API Layer**: AWS API Gateway with WebSocket support for streaming
3. **Processing Layer**: Multiple Lambda functions for parallel processing with intelligent caching
4. **AI Layer**: AWS Bedrock integration with model selection logic
5. **Streaming Layer**: WebSocket connections for real-time progress updates (IMPLEMENTED)
6. **Caching Layer**: DynamoDB index with S3 storage for processed content optimization

### Step Functions Workflow (Current Implementation)

```mermaid
stateDiagram-v2
    [*] --> URLProcessor
    URLProcessor --> StructureDetector
    StructureDetector --> DimensionAnalyzer
    DimensionAnalyzer --> ReportGenerator
    ReportGenerator --> [*]
    
    note right of URLProcessor
        Fetches content, converts to Markdown,
        extracts code/media, stores in S3
    end note
    
    note right of StructureDetector
        Uses Claude AI to identify topics
        and documentation structure
    end note
    
    note right of DimensionAnalyzer
        Analyzes all 5 dimensions using
        selected AI model (Claude/Titan/Llama)
    end note
    
    note right of ReportGenerator
        Retrieves results from S3 and
        compiles final report
    end note
```

**Key Architecture Decisions:**
- **S3 Storage**: All content and results stored in S3 to avoid Step Functions 256KB data limit
- **Minimal Responses**: Lambda functions return only success/failure status, not full content
- **Sequential Processing**: URL → Structure → Dimensions → Report (4 steps)
- **Quality Validator Removed**: LLM-as-Judge moved to Phase 2 as async background process

**Timeout Handling Strategy:**
- Each dimension analysis = separate Step Function state
- Individual timeouts: 5 minutes per dimension
- Retry logic: 2 attempts per dimension with exponential backoff
- Partial success: Generate report with available dimensions
- State persistence: Resume from last successful checkpoint

```typescript
interface StepFunctionState {
  analysisId: string;
  completedDimensions: string[];
  failedDimensions: string[];
  partialResults: Record<string, DimensionResult>;
  retryCount: Record<string, number>;
}
```

## Components and Interfaces

#### URLInputComponent
- **Purpose**: Handles URL submission and model selection
- **Props**: `onSubmit(url, model)`, `availableModels[]`
- **State**: `url`, `selectedModel`, `isAnalyzing`
- **Interface**: Renders input field, model dropdown, and analyze button

#### StructureConfirmationComponent
- **Purpose**: Displays detected structure for user confirmation
- **Props**: `detectedStructure`, `onConfirm()`, `onEdit()`
- **State**: `isEditing`, `editedStructure`
- **Interface**: Shows topic breakdown with edit capabilities

#### ProgressStreamComponent
- **Purpose**: Real-time progress display with WebSocket streaming updates (IMPLEMENTED)
- **Props**: `progressEvents[]`, `isComplete`, `progressExpanded`
- **State**: `events`, `autoScroll`, `progressExpanded`
- **Interface**: Collapsible progress log with status icons, auto-scroll, and expand/collapse functionality
- **WebSocket Integration**: Real-time message streaming with fallback to polling
- **Cache Indicators**: Visual cache HIT/MISS status with lightning bolt icons
- **Auto-Collapse**: Automatically collapses after analysis completion while preserving access

#### QualityDashboardComponent
- **Purpose**: Final results display with scores and recommendations
- **Props**: `analysisResults`, `modelUsed`, `confidence`
- **State**: `expandedDimensions[]`, `filterSettings`, `viewMode`
- **Interface**: Score cards with expandable recommendation details
- **Future Enhancement**: Configurable/filterable report views for substantial content
- **Static Report**: Initial version shows fixed layout, expandable for future customization

### Backend Components

#### URLProcessor (Lambda)
- **Purpose**: Fetches content and creates clean Markdown representation using aggressive noise reduction pipeline
- **Input**: `{ url: string, selectedModel: string, sessionId: string, analysisStartTime: number }`
- **Output**: `{ success: boolean, sessionId: string, message: string }` (content stored in S3)
- **Dependencies**: 
  - `jsdom@^23.0.0` - HTML parsing and DOM manipulation
  - `turndown@^7.1.2` - HTML to Markdown conversion
  - `turndown-plugin-gfm@^1.0.2` - GitHub Flavored Markdown support
- **Processing Strategy**:
  1. **Fetch**: Retrieve raw HTML from URL with User-Agent header
  2. **Parse**: Use JSDOM to create traversable document
  3. **Remove Noise (DOM Level)**: Call `removeNoiseElements()` to remove 40+ types of noise elements
  4. **Extract Main Content**: Use `extractMainContent()` with WordPress-specific selectors
  5. **Convert**: Use Turndown with aggressive `remove()` configuration
  6. **Store**: Save to S3 with noise reduction metrics
- **Noise Reduction Implementation**:
  ```typescript
  // DOM-level removal (before Turndown)
  function removeNoiseElements(document: Document): number {
    const noiseSelectors = [
      // Scripts and styles (CRITICAL!)
      'script', 'style', 'noscript', 'link[rel="stylesheet"]',
      // Navigation and UI chrome
      'nav', 'header', 'footer', 'aside',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      // WordPress.org specific
      '.site-header', '.site-footer', '#wporg-header', '#wporg-footer',
      '.wp-block-wporg-sidebar-container', '.wp-block-social-links',
      // Forms, media, hidden elements
      'form', 'input', 'button', 'textarea', 'iframe', 'embed', 'video', 'audio',
      '[style*="display:none"]', '.hidden', '.sr-only',
      // 30+ more selectors...
    ];
    // Returns count of removed elements for logging
  }
  
  // Content extraction with fallback strategies
  function extractMainContent(document: Document): Element {
    // Strategy 1: WordPress.org specific (.entry-content, .post-content)
    // Strategy 2: Generic containers (main, article, [role="main"])
    // Strategy 3: Fallback to document.body
  }
  ```
- **Turndown Configuration**:
  ```typescript
  function configureTurndownService(): TurndownService {
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });
    
    // Add GFM plugin
    turndown.use(gfm);
    
    // Aggressive removal using built-in remove() method
    turndown.remove([
      'script', 'style', 'noscript', 'link',
      'nav', 'footer', 'header', 'aside',
      'form', 'input', 'button', 'textarea',
      'iframe', 'embed', 'object', 'video', 'audio',
      'meta', 'title', 'base'
    ]);
    
    // Custom rules for WordPress callouts and code blocks
    // ...
  }
  ```
- **Noise Reduction Metrics**:
  ```typescript
  interface NoiseReductionMetrics {
    originalSize: number;      // Raw HTML size (e.g., 176KB)
    cleanedSize: number;        // After noise removal (e.g., 15KB)
    reductionPercent: number;   // Percentage reduced (e.g., 91%)
  }
  ```
- **Logging**: Detailed logs for debugging noise reduction effectiveness
- **Result**: Typically 90-95% size reduction (176KB → 15KB → 5KB markdown)
- **Storage**: Clean content stored in S3 at `sessions/{sessionId}/processed-content.json`
- **Format Support**: Handles various documentation formats including HTML, Markdown-based sites, and API references as specified in Requirements 1.4

#### StructureDetector (Lambda)
- **Purpose**: Analyzes content structure and identifies topics
- **Input**: `{ content: string, metadata: object }`
- **Output**: `{ topics: Topic[], confidence: number }`
- **Logic**: Uses content analysis to detect documentation organization

#### DimensionAnalyzer (Lambda)
- **Purpose**: Orchestrates quality analysis using AWS Step Functions for timeout resilience
- **Input**: `{ content: ProcessedContent, structure: object, model: string }`
- **Output**: Streaming progress events + final report
- **Timeout Handling**: 
  - **Step Functions**: Manages state and retries for long-running analysis
  - **Checkpointing**: Each dimension analysis is a separate state with retry capability
  - **Resume Logic**: Failed dimensions can be retried without reprocessing successful ones
  - **Graceful Degradation**: Partial results available even if some dimensions timeout
- **Architecture Change**: Use Step Functions Express Workflows for sub-15-minute executions with retry
- **Storage**: Temporary state in Step Functions, results streamed via WebSocket

#### WebSocketHandler (Lambda) - IMPLEMENTED
- **Purpose**: Manages WebSocket connections for real-time progress streaming
- **Input**: `{ action: 'subscribe' | 'unsubscribe', sessionId: string }`
- **Output**: WebSocket connection management and message routing
- **Features**:
  - Connection lifecycle management (connect, disconnect, subscribe)
  - Session-based message routing to specific clients
  - DynamoDB connection tracking with TTL cleanup
  - Error handling and connection validation
- **Integration**: Works with ProgressPublisher utility for message broadcasting

#### ProgressPublisher (Utility) - IMPLEMENTED
- **Purpose**: Utility for publishing progress messages via WebSocket
- **Input**: `{ sessionId: string, message: ProgressMessage }`
- **Output**: Real-time message delivery to connected clients
- **Features**:
  - Message type support (info, success, error, progress, cache-hit, cache-miss)
  - Automatic timestamp and metadata handling
  - Graceful error handling for disconnected clients
  - Integration with all Lambda functions for progress streaming

#### LinkChecker (Component) - NEW
- **Purpose**: Validates internal link accessibility via HTTP requests
- **Input**: `{ links: ExtractedLink[], baseUrl: string }`
- **Output**: `{ brokenLinks: BrokenLink[], healthyLinks: number }`
- **Features**:
  - Asynchronous HTTP HEAD requests (max 10 concurrent)
  - Internal link filtering (same domain only)
  - Status code categorization (404, 4xx, 5xx, timeout)
  - Integration with existing linkAnalysis data structure
  - Progress streaming for real-time updates
- **Implementation**:
  ```typescript
  interface BrokenLink {
    url: string;
    status: number | 'timeout';
    anchorText: string;
    sourceLocation: string;
    errorMessage: string;
  }
  
  async function checkLinksAsync(links: ExtractedLink[]): Promise<LinkCheckResult> {
    // Process links in batches of 10 with timeout handling
    // Filter internal links only
    // Report progress via WebSocket
  }
  ```

#### EnhancedCodeAnalyzer (Component) - NEW
- **Purpose**: LLM-based detection of deprecated code and syntax errors across all languages
- **Input**: `{ codeSnippets: CodeSnippet[], model: string }`
- **Output**: `{ deprecatedCode: DeprecatedCodeFinding[], syntaxErrors: SyntaxErrorFinding[] }`
- **Features**:
  - Language-agnostic analysis using LLM knowledge
  - Framework-specific deprecation detection
  - Confidence scoring for findings
  - Integration with existing Freshness and Accuracy dimensions
  - Progress streaming for real-time updates
- **Implementation**:
  ```typescript
  interface DeprecatedCodeFinding {
    language: string;
    method: string;
    location: string;
    deprecatedIn: string;
    removedIn?: string;
    replacement: string;
    confidence: 'high' | 'medium' | 'low';
  }
  
  interface SyntaxErrorFinding {
    language: string;
    location: string;
    errorType: string;
    description: string;
    codeFragment: string;
    confidence: 'high' | 'medium' | 'low';
  }
  ```

#### ReportExporter (Component) - NEW
- **Purpose**: Generates downloadable Markdown reports with complete analysis results
- **Input**: `{ analysisResults: FinalReport, criticalFindings: CriticalFindings }`
- **Output**: `{ markdownContent: string, filename: string }`
- **Features**:
  - Executive summary for outreach
  - Detailed findings with code examples
  - Proper Markdown formatting with tables
  - Structured sections for readability
  - Integration with existing dashboard export button

### Sitemap Journey Mode Components (New)

#### InputTypeDetector (Lambda) - NEW
- **Purpose**: Automatically detects whether input is a sitemap.xml URL or regular documentation URL
- **Input**: `{ url: string }`
- **Output**: `{ inputType: 'sitemap' | 'doc', confidence: number }`
- **Logic**: 
  - Check if URL ends with `.xml` or `sitemap.xml`
  - Check if URL path contains `/sitemap`
  - Default to 'doc' mode for backward compatibility
- **Integration**: Routes to appropriate analysis workflow

#### SitemapParser (Lambda) - NEW
- **Purpose**: Fetches and parses sitemap.xml files to extract all documentation URLs
- **Input**: `{ sitemapUrl: string, sessionId: string }`
- **Output**: `{ success: boolean, totalUrls: number, urls: SitemapUrl[], errors: string[] }`
- **Features**:
  - XML parsing with error handling
  - Nested sitemap support (sitemap index files)
  - URL extraction from `<loc>` elements
  - Optional metadata extraction (lastmod, priority)
  - Progress streaming: "Parsing sitemap... Found X URLs"
- **Storage**: Results stored in session-based S3 structure
- **Error Handling**: Graceful handling of malformed XML and network issues

#### JourneyDetector (Lambda) - NEW
- **Purpose**: Groups sitemap URLs into developer persona + action workflows using AI analysis
- **Input**: `{ urls: string[], companyName: string, sessionId: string }`
- **Output**: `{ journeys: Journey[], confidence: number }`
- **Features**:
  - URL pattern matching for common journey types
  - AI-powered journey detection for complex cases
  - Persona identification (Node.js Developer, DevOps Engineer, etc.)
  - Action identification (Send Email, Set up Webhooks, etc.)
  - Journey sequence ordering based on logical workflow
- **Journey Patterns**:
  ```typescript
  interface Journey {
    id: string;                    // "nodejs-send-email"
    name: string;                  // "Send Email with Node.js"
    persona: string;               // "Node.js Developer"
    action: string;                // "Send first transactional email"
    pages: string[];               // URLs in sequence
    pageCount: number;             // Number of pages
    estimatedTime: string;         // "15 min"
    companyName: string;           // "Resend"
  }
  ```

#### JourneyAggregator (Lambda) - NEW
- **Purpose**: Combines individual page analysis results into journey-level scores and completion confidence
- **Input**: `{ journeyId: string, pageResults: PageResult[], sessionId: string }`
- **Output**: `{ journeyScore: JourneyScore, completionConfidence: number }`
- **Features**:
  - Weighted average calculation across journey pages
  - Completion confidence based on blocking issues
  - Critical page identification (getting started, core APIs)
  - Workflow gap detection
  - Journey-specific recommendations
- **Confidence Calculation**:
  ```typescript
  function calculateCompletionConfidence(pageResults: PageResult[]): number {
    let confidence = 100;
    
    // Deduct for blocking issues
    for (const page of pageResults) {
      confidence -= page.syntaxErrors * 15;      // Critical - code won't run
      confidence -= page.brokenLinks * 5;       // Disrupts flow
      confidence -= page.deprecatedCode * 3;    // Confuses users
      
      if (page.dimensions.clarity < 50) confidence -= 10;
      if (page.dimensions.accuracy < 50) confidence -= 15;
    }
    
    return Math.max(0, Math.min(100, confidence));
  }
  ```

#### JourneyCache (DynamoDB Table) - NEW
- **Purpose**: Stores journey-level analysis results with company association and session-based S3 references
- **Schema**:
  ```typescript
  interface JourneyCacheEntry {
    sitemapUrl: string;           // Partition key
    journeyId: string;            // Sort key
    companyName: string;          // "Resend", "Stripe", etc.
    journeyName: string;          // "Send Email with Node.js"
    persona: string;              // "Node.js Developer"
    action: string;               // "Send first transactional email"
    pages: string[];              // Array of URLs in journey
    overallScore: number;         // Aggregated journey score
    completionConfidence: number; // Percentage likelihood of success
    s3ReportLocation: string;     // "sessions/{sessionId}/journey-{journeyId}.json"
    lastAnalyzed: string;         // ISO timestamp
    ttl: number;                  // 7-day expiration
  }
  ```
- **Indexes**: 
  - GSI on `companyName` for company-based queries
  - GSI on `lastAnalyzed` for cleanup operations
- **Integration**: Works with existing session-based S3 storage pattern

#### ModelSelector
- **Purpose**: Manages AI model selection at the analysis level (not per-dimension)
- **Input**: `{ modelPreference: string, analysisType: 'full' | 'quick' }`
- **Output**: `{ selectedModel: string, modelConfig: object }`
- **Clarification**: 
  - **Single Model Per Analysis**: One model processes ALL dimensions for consistency
  - **Auto Selection**: Chooses best overall model based on content type and analysis requirements
  - **User Override**: Allows manual model selection for experimentation
  - **Model Consistency**: Same model used throughout entire analysis session

```typescript
// Clarified model selection logic
interface ModelSelectionStrategy {
  userPreference: 'claude' | 'titan' | 'llama' | 'auto';
  contentType: 'api-docs' | 'tutorial' | 'reference' | 'mixed';
  analysisDepth: 'quick' | 'comprehensive';
}

function selectModel(strategy: ModelSelectionStrategy): string {
  if (strategy.userPreference !== 'auto') {
    return strategy.userPreference; // User choice overrides everything
  }
  
  // Auto selection based on content type
  switch (strategy.contentType) {
    case 'api-docs': return 'claude';    // Best for technical accuracy
    case 'tutorial': return 'llama';     // Best for readability assessment  
    case 'reference': return 'titan';    // Best for completeness checking
    default: return 'claude';            // Default fallback
  }
}
```

### AI Integration Components

#### PromptBuilder
- **Purpose**: Constructs optimized prompts for different models and dimensions
- **Input**: `{ dimension: string, content: string, model: string }`
- **Output**: `{ prompt: string, parameters: object }`
- **Optimization**: Model-specific prompt formatting and parameter tuning

#### ResponseParser
- **Purpose**: Parses and validates AI model responses
- **Input**: `{ rawResponse: string, expectedFormat: object }`
- **Output**: `{ parsedData: object, confidence: number }`
- **Validation**: JSON structure validation and error recovery

#### IssueDiscoverer (Lambda) - NEW ✅ IMPLEMENTED WITH MULTI-DOMAIN SUPPORT
- **Purpose**: Searches online for common developer problems with documentation portals across multiple domains
- **Input**: `{ companyName: string, domain: string, sessionId: string }`
- **Output**: `{ issues: DiscoveredIssue[], totalFound: number }`
- **Multi-Domain Support**: ✅ Supports resend.com and liveblocks.io with domain-specific issue datasets
- **Implementation Status**: ✅ Phase 1 Complete (Updated January 6, 2026)
  - ✅ Lambda function deployed and working
  - ✅ Real curated data from 2025-2026 web search
  - ✅ Manual research from Stack Overflow, GitHub, Liveblocks Changelog
  - ✅ 5 authentic Resend issues + 5 authentic Liveblocks issues
  - ✅ Domain detection from URL input (liveblocks.io/docs → liveblocks domain)
  - 📝 **Approach**: Manual web search + JSON file with multi-domain structure
  - 🔄 **Future**: Can be replaced with live API calls (Google Custom Search, MCP servers)
- **Supported Domains**:
  - **resend.com**: Email delivery, Next.js integration, production deployment issues
  - **liveblocks.io**: Collaborative editing, React integration, Yjs synchronization issues
- **Features**:
  - ✅ Multi-source credibility scoring (Stack Overflow, GitHub, Liveblocks Changelog)
  - ✅ Issue categorization (deployment, email-delivery, api-usage, authentication, performance, integration)
  - ✅ Frequency analysis and ranking by recency (2025-2026 focus)
  - ✅ Source credibility scoring (Stack Overflow: 0.95, GitHub: 0.90, Changelog: 0.85)
  - ✅ Domain-specific issue filtering based on input URL
  - ✅ Session-based S3 storage
- **Real Data Sources**:
  - **Resend**: Stack Overflow questions (78276988, 78448480, Gmail spam), GitHub issues
  - **Liveblocks**: Stack Overflow questions (77992883, 78487128, 79267827), GitHub issues, Changelog
- **Domain Detection Logic**:
  ```typescript
  function detectDomain(url: string): string {
    if (url.includes('liveblocks.io')) return 'liveblocks';
    if (url.includes('resend.com')) return 'resend';
    return 'resend'; // default fallback
  }
  ```
- **Issue Patterns**:
  ```typescript
  interface DiscoveredIssue {
    id: string;                    // "stackoverflow-78487128"
    title: string;                 // "BlockNote editor re-renders on every keystroke..."
    category: string;              // "performance", "authentication", "integration", etc.
    description: string;           // Summary of the problem
    frequency: number;             // Severity score (12-24 for current issues)
    sources: string[];             // Real URLs from Stack Overflow, GitHub, Changelog
    lastSeen: string;              // "2025-11-15" (2025-2026 timeframe)
    severity: 'high' | 'medium' | 'low';
    relatedPages: string[];        // "/docs/get-started/nextjs-blocknote", "/docs/authentication"
  }
  ```

#### IssueValidator (Lambda) - NEW 🔄 IMPLEMENTING TODAY
- **Purpose**: Validates whether discovered issues still exist in current documentation and identifies potential gaps where developers would search but find incomplete content
- **Input**: `{ issue: DiscoveredIssue, domain: string, sessionId: string }`
- **Output**: `{ validationResult: ValidationResult, recommendations: Recommendation[] }`
- **Implementation Status**: 🔄 Starting implementation (Task 41)
- **Page Discovery Strategy**:
  1. **Pre-Curated Pages First** (instant):
     - Use `issue.relatedPages` if available
     - Example: `["/docs/deliverability", "/docs/dns-records"]`
  2. **Sitemap Fallback** (2-5 seconds):
     - Fetch sitemap.xml if no pre-curated pages
     - Search for pages matching issue keywords
     - Example: Search for "gmail", "spam", "deliverability"
  3. **Keyword Extraction**:
     - Extract from issue title + description
     - Use category mapping for additional keywords
- **Content Validation**:
  - ✅ **Page exists with relevant content** → Analyze for completeness
  - ⚠️ **Page exists but missing context** → Report as "Potential Gap"
  - ❌ **No relevant page found** → Report as "Critical Gap"
- **Gap Detection Logic**:
  ```typescript
  interface GapAnalysis {
    gapType: 'potential-gap' | 'critical-gap' | 'resolved';
    pageUrl?: string;              // URL of page with gap (if exists)
    pageTitle?: string;            // Title suggests relevance
    missingContent: string[];      // What content is missing
    reasoning: string;             // Why this is a gap
    developerImpact: string;       // How this affects developers
  }
  ```
- **Validation Logic**:
  ```typescript
  interface ValidationResult {
    status: 'confirmed' | 'resolved' | 'potential-gap' | 'critical-gap';
    evidence: Evidence[];          // Pages checked and findings
    missingElements: string[];     // What's missing to address the issue
    potentialGaps: GapAnalysis[];  // Pages that exist but lack content
    criticalGaps: string[];        // Missing pages that should exist
    relatedFindings: Finding[];    // From existing dimension analysis
    confidence: number;            // Validation confidence (0-100)
    recommendations: Recommendation[]; // Specific fixes with code examples
  }
  
  interface Evidence {
    pageUrl: string;               // Page that was checked
    pageTitle: string;             // Title of the page
    hasRelevantContent: boolean;   // Does it address the issue?
    contentGaps: string[];         // What's missing from this page
    codeExamples: number;          // Number of code examples found
    productionGuidance: boolean;   // Has production considerations?
  }
  ```
- **Features**:
  - Smart page discovery (pre-curated → sitemap fallback)
  - Potential gap detection (page exists but incomplete)
  - Critical gap detection (missing pages)
  - Code example completeness checking
  - Cross-reference validation between theory and practice
  - Real-time validation status reporting
  - Specific recommendation generation with evidence
  - Root cause analysis (missing examples, unclear guidance)
  - Developer impact assessment (how many affected)
- **Domain Normalization** (Added January 11, 2026):
  - `normalizeDomain()` function converts user-friendly domains to canonical documentation domains
  - Ensures consistent configuration lookup across all operations
  - Example: `knock.app` → `docs.knock.app`
  - Applied in `performSitemapHealthCheck()` and `loadOrGenerateEmbeddings()`
  - Logs both original and normalized domains for transparency
  - Implementation:
    ```typescript
    function normalizeDomain(domain: string): string {
      // Remove protocol and trailing slashes
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      
      // Handle knock.app -> docs.knock.app conversion
      if (cleanDomain === 'knock.app') {
        return 'docs.knock.app';
      }
      
      // Return as-is for other domains
      return cleanDomain;
    }
    ```

#### IssueCache (DynamoDB Table) - NEW 🔄 DEFERRED TO NEXT SESSION
- **Purpose**: Stores discovered issues and validation results with company association
- **Implementation Status**: 🔄 Planned for next session (Task 41.3)
- **Schema**:
  ```typescript
  interface IssueCacheEntry {
    companyDomain: string;         // Partition key - "resend.com"
    issueId: string;               // Sort key - "rate-limiting-nodejs"
    issueTitle: string;            // "Rate limiting issues with Node.js"
    category: string;              // "rate-limiting"
    frequency: number;             // Number of online mentions
    lastDiscovered: string;        // ISO timestamp
    validationStatus: string;      // "confirmed", "resolved", "partial"
    validationDate: string;        // Last validation timestamp
    s3ResultLocation: string;      // "sessions/{sessionId}/issue-{issueId}.json"
    ttl: number;                   // 30-day expiration (longer than other caches)
  }
  ```
- **Indexes**:
  - GSI on `category` for issue type queries
  - GSI on `validationStatus` for filtering confirmed issues
- **Integration**: Works with existing session-based S3 storage pattern

## Data Models

### Core Data Structures

```typescript
interface AnalysisRequest {
  url: string;
  selectedModel: 'claude' | 'titan' | 'llama' | 'auto';
  sessionId: string;
  inputType?: 'sitemap' | 'doc';  // NEW: Auto-detected or user-specified
  contextAnalysis?: {
    enabled: boolean;
    maxContextPages?: number;
  };
  cacheControl?: {
    enabled: boolean;  // Frontend sends cache preference to backend
  };
  // NEW: Sitemap-specific options
  sitemapOptions?: {
    selectedJourneys?: string[];  // Journey IDs to analyze
    companyName?: string;         // Auto-detected or user-provided
  };
}

// NEW: Sitemap Journey Mode Data Structures
interface SitemapUrl {
  loc: string;           // URL from sitemap
  lastmod?: string;      // Last modified date
  priority?: number;     // Priority hint (0.0-1.0)
  changefreq?: string;   // Change frequency
}

interface SitemapParseResult {
  success: boolean;
  totalUrls: number;
  urls: SitemapUrl[];
  errors: string[];
  companyName?: string;  // Auto-detected from sitemap domain
}

interface SitemapHealthResult {
  totalUrls: number;
  healthyUrls: number;
  brokenUrls: number;        // 404s only
  accessDeniedUrls: number;  // 403s
  timeoutUrls: number;       // Timeouts
  otherErrorUrls: number;    // Other HTTP errors
  healthCheckDetails: LinkIssue[];
}

interface Journey {
  id: string;                    // "nodejs-send-email"
  name: string;                  // "Send Email with Node.js"
  persona: string;               // "Node.js Developer"
  action: string;                // "Send first transactional email"
  pages: string[];               // URLs in sequence
  pageCount: number;             // Number of pages
  estimatedTime: string;         // "15 min"
  companyName: string;           // "Resend"
  complexity: 'beginner' | 'intermediate' | 'advanced';
  detectionConfidence: number;   // 0.0-1.0
}

interface JourneyContext {
  journeyId: string;              // "nodejs-send-email"
  journeyName: string;            // "Send Email with Node.js"
  persona: string;                // "Node.js Developer"
  action: string;                 // "Send first transactional email"
  stepNumber: number;             // 2 (this is step 2)
  totalSteps: number;             // 4 (of 4 total)
  previousSteps: string[];        // ["/send-with-nodejs"]
  nextSteps: string[];            // ["/domains/introduction", "/api-reference/errors"]
  currentPageUrl: string;         // "/api-reference/emails/send-email"
  companyName: string;            // "Resend"
}

interface JourneyScore {
  journeyId: string;
  journeyName: string;
  persona: string;
  action: string;
  companyName: string;
  overallScore: number;              // 0-100
  completionConfidence: number;      // 0-100%
  pageScores: PageScore[];
  dimensionAverages: {
    relevance: number;
    freshness: number;
    clarity: number;
    accuracy: number;
    completeness: number;
  };
  blockingIssues: BlockingIssue[];
  findings: Finding[];
  analysisTime: number;
  sessionId: string;
}

interface BlockingIssue {
  type: 'syntax-error' | 'broken-link' | 'deprecated-code' | 'missing-content' | 'workflow-gap';
  severity: 'critical' | 'high' | 'medium';
  page: string;
  description: string;
  impact: string;  // How this blocks journey completion
  recommendation: string;
}

interface SitemapAnalysisResult {
  sitemapUrl: string;
  companyName: string;
  sessionId: string;
  sitemapHealth: SitemapHealthResult;
  detectedJourneys: Journey[];
  selectedJourneys: string[];
  journeyResults: JourneyScore[];
  overallInsights: {
    bestPerformingJourney: string;
    worstPerformingJourney: string;
    commonIssues: string[];
    recommendedImprovements: string[];
  };
  analysisTime: number;
  totalPagesAnalyzed: number;
}

// Enhanced ProcessedContent for Journey Context
interface ProcessedContent {
  url: string;
  markdownContent: string;
  htmlContent: string; // Cleaned HTML, not raw
  mediaElements: MediaElement[];
  codeSnippets: CodeSnippet[];
  contentType: 'api-docs' | 'tutorial' | 'reference' | 'mixed';
  linkAnalysis: LinkAnalysisSummary;
  contextAnalysis?: ContextAnalysisResult;
  journeyContext?: JourneyContext;  // NEW: Journey-aware analysis
  processedAt: string;
  noiseReduction: NoiseReductionMetrics;
}

// NEW: Journey Cache Table Schema
interface JourneyCacheEntry {
  sitemapUrl: string;           // Partition key
  journeyId: string;            // Sort key
  companyName: string;          // "Resend", "Stripe", etc.
  journeyName: string;          // "Send Email with Node.js"
  persona: string;              // "Node.js Developer"
  action: string;               // "Send first transactional email"
  pages: string[];              // Array of URLs in journey
  overallScore: number;         // Aggregated journey score
  completionConfidence: number; // Percentage likelihood of success
  findings: Finding[];          // Journey-specific findings
  s3ReportLocation: string;     // "sessions/{sessionId}/journey-{journeyId}.json"
  lastAnalyzed: string;         // ISO timestamp
  ttl: number;                  // 7-day expiration
  sessionId: string;            // Reference to analysis session
}

// Existing structures remain unchanged...
interface ProcessedContentIndex {
  url: string;                    // Partition key
  processedAt: string;            // Sort key
  contentHash: string;            // Content hash for validation
  s3Location: string;             // S3 path: "sessions/{sessionId}/processed-content.json"
  ttl: number;                    // TTL for automatic cleanup
  contentType: string;            // 'api-docs' | 'tutorial' | 'reference'
  noiseReductionMetrics: NoiseReductionMetrics;
  contextAnalysis?: {
    contextPages: ContextPage[];
    analysisScope: string;
  };
  // NEW: Page-level dimension analysis caching for journey mode optimization
  dimensionResults?: {            // Cache dimension analysis per page to avoid re-analysis
    relevance: DimensionResult;
    freshness: DimensionResult;
    clarity: DimensionResult;
    accuracy: DimensionResult;
    completeness: DimensionResult;
    analyzedAt: string;
    modelUsed: string;
  };
}

interface ContextPage {
  url: string;
  title: string;
  relationship: 'parent' | 'child' | 'sibling';
  confidence: number;
  contentHash?: string;
}

interface ContextAnalysisResult {
  contextPages: ContextPage[];
  analysisScope: 'single-page' | 'with-context';
  totalPagesAnalyzed: number;
}

interface NoiseReductionMetrics {
  originalSize: number;
  cleanedSize: number;
  reductionPercent: number;
}

interface MediaElement {
  type: 'video' | 'audio' | 'image' | 'interactive';
  src: string;
  alt?: string;
  caption?: string;
  context: string; // surrounding text for relevance analysis
  analysisNote: string; // how this affects documentation quality
}

interface CodeSnippet {
  language: string;
  code: string;
  lineNumber: number;
  context: string;
  hasVersionInfo: boolean;
}

interface DocumentStructure {
  type: 'single_topic' | 'multi_topic';
  topics: Topic[];
  confidence: number;
  contentType: 'api-docs' | 'tutorial' | 'reference' | 'mixed';
}

interface Topic {
  name: string;
  pageCount: number;
  urls: string[];
}

interface DimensionResult {
  dimension: DimensionType;
  score: number | null;
  status: 'complete' | 'failed' | 'timeout' | 'retrying';
  findings: string[];
  recommendations: Recommendation[];
  failureReason?: string;
  retryCount: number;
  processingTime: number;
}

interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  action: string;
  location?: string;
  impact: string;
  codeExample?: string;
  mediaReference?: string; // Reference to media element if applicable
}

interface ProgressEvent {
  type: 'progress' | 'completion' | 'error' | 'retry';
  dimension?: DimensionType;
  status: 'starting' | 'in_progress' | 'complete' | 'failed' | 'retrying';
  message: string;
  details?: {
    finding?: string;
    severity?: 'info' | 'warning' | 'error';
    lineNumber?: number;
    retryAttempt?: number;
  };
  timestamp: string;
}

interface FinalReport {
  overallScore: number;
  dimensionsAnalyzed: number;
  dimensionsTotal: number;
  confidence: 'high' | 'medium' | 'low';
  modelUsed: string;
  dimensions: Record<DimensionType, DimensionResult>;
  codeAnalysis: CodeAnalysisSummary;
  mediaAnalysis: MediaAnalysisSummary;
  linkAnalysis: LinkAnalysisSummary;
  criticalFindings: CriticalFindings; // NEW: Enhanced findings for outreach
  analysisTime: number;
  retryCount: number;
}

interface CriticalFindings {
  brokenLinks: BrokenLinkFinding[];
  deprecatedCode: DeprecatedCodeFinding[];
  syntaxErrors: SyntaxErrorFinding[];
  summary: {
    brokenLinksCount: number;
    deprecatedCodeCount: number;
    syntaxErrorsCount: number;
  };
}

interface BrokenLinkFinding {
  url: string;
  status: number | 'timeout';
  anchorText: string;
  sourceLocation: string;
  errorMessage: string;
}

interface DeprecatedCodeFinding {
  language: string;
  method: string;
  location: string; // e.g., "/quickstart code block 2, line 5"
  deprecatedIn: string;
  removedIn?: string;
  replacement: string;
  confidence: 'high' | 'medium' | 'low';
  codeFragment: string;
}

interface SyntaxErrorFinding {
  language: string;
  location: string; // e.g., "/api-reference code block 1, line 8"
  errorType: string;
  description: string;
  codeFragment: string;
  confidence: 'high' | 'medium' | 'low';
}

interface CodeAnalysisSummary {
  snippetsFound: number;
  syntaxErrors: number;
  deprecatedMethods: number;
  missingVersionSpecs: number;
  languagesDetected: string[];
  enhancedAnalysis: {
    llmAnalyzedSnippets: number;
    deprecatedFindings: DeprecatedCodeFinding[];
    syntaxErrorFindings: SyntaxErrorFinding[];
    confidenceDistribution: {
      high: number;
      medium: number;
      low: number;
    };
  };
}

interface MediaAnalysisSummary {
  videosFound: number;
  audiosFound: number;
  imagesFound: number;
  interactiveElements: number;
  accessibilityIssues: number;
  missingAltText: number;
}

interface LinkAnalysisSummary {
  totalLinks: number;
  internalLinks: number;
  externalLinks: number;
  brokenLinks: number;  // Count of 404s only
  totalLinkIssues?: number;  // Count of all issues (404 + 403 + timeout + error)
  subPagesIdentified: string[];
  linkContext: 'single-page' | 'multi-page-referenced';
  analysisScope: 'current-page-only' | 'with-context';
  linkValidation: {
    checkedLinks: number;
    linkIssueFindings: LinkIssue[];  // All link issues with categorization
    healthyLinks: number;
    brokenLinks: number;  // 404s only
    accessDeniedLinks: number;  // 403s
    timeoutLinks: number;  // Timeouts
    otherErrors: number;  // Other HTTP errors
  };
}

interface CacheMetrics {
  hitRate: number;              // Cache hit percentage
  avgProcessingTime: number;    // Average processing time
  cacheSize: number;            // Current cache entries
  s3StorageUsed: number;        // S3 storage in bytes
  costSavings: number;          // Estimated cost savings from cache hits
}

interface ContextAnalysisStrategy {
  enabled: boolean;
  maxContextPages: number;      // Default: 5
  includeParent: boolean;       // Default: true (immediate parent only)
  includeChildren: boolean;     // Default: true (direct children only)
  includeSiblings: boolean;     // Default: false (too broad by default)
  relevanceThreshold: number;   // Default: 0.6
}
```

### Model Configuration

```typescript
interface ModelConfig {
  name: string;
  provider: 'bedrock';
  modelId: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  strengths: DimensionType[];
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  claude: {
    name: 'Claude 3.5 Sonnet',
    provider: 'bedrock',
    modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', // Cross-region inference profile
    maxTokens: 2000,
    temperature: 0.1,
    timeoutMs: 30000,
    strengths: ['accuracy', 'clarity', 'relevance', 'freshness', 'completeness'],
    reasoning: 'Excellent at code analysis, technical writing evaluation, and structured reasoning',
    status: '✅ FULLY WORKING'
  }
};

// Phase 2 Model Configurations (Future Enhancement)
const PHASE_2_MODEL_CONFIGS: Record<string, ModelConfig> = {
  titan: {
    name: 'Amazon Titan Text Premier',
    provider: 'bedrock',
    modelId: 'amazon.titan-text-premier-v1:0',
    maxTokens: 2000,
    temperature: 0.1,
    timeoutMs: 30000,
    strengths: ['completeness', 'freshness'],
    reasoning: 'Optimized for information extraction and comprehensive analysis',
    status: '⚠️ PHASE 2 - API format implemented, needs testing'
  },
  llama: {
    name: 'Meta Llama 3.1 70B',
    provider: 'bedrock',
    modelId: 'us.meta.llama3-1-70b-instruct-v1:0', // Cross-region inference profile
    maxTokens: 2000,
    temperature: 0.1,
    timeoutMs: 30000,
    strengths: ['relevance', 'clarity'],
    reasoning: 'Strong context understanding and balanced assessments',
    status: '⚠️ PHASE 2 - API format implemented, response parsing needs debugging'
  }
};
```

Now I need to use the prework tool to analyze the acceptance criteria before writing the correctness properties section.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: URL Processing Reliability
*For any* valid documentation URL, the system should successfully fetch and extract content, and for any invalid URL, the system should return a descriptive error message without crashing.
**Validates: Requirements 1.1, 1.2**

### Property 2: Noise Reduction Effectiveness
*For any* HTML content processed, the system should achieve at least 90% noise reduction by removing scripts, styles, navigation, headers, footers, forms, and media embeds while preserving main documentation content.
**Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9, 1.10**

### Property 3: Content Structure Detection
*For any* extracted documentation content, the system should identify the structure and topics, and require explicit user confirmation before proceeding to analysis.
**Validates: Requirements 1.3, 2.1, 2.2, 2.3**

### Property 4: Progress Streaming Completeness
*For any* dimension analysis session, the progress streamer should emit status updates for each phase, report specific findings as they occur, and mark completion or failure with appropriate details.
**Validates: Requirements 3.1, 3.2, 3.4, 3.5**

### Property 5: Code Validation Thoroughness
*For any* code snippet found in documentation, the code validator should detect the programming language, check syntax errors with line numbers, identify deprecated methods, and flag missing version specifications.
**Validates: Requirements 3.3, 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 6: Dimension Analysis Isolation
*For any* set of quality dimensions being analyzed, if one dimension fails, the remaining dimensions should continue processing and complete successfully.
**Validates: Requirements 4.7, 6.3**

### Property 7: Graceful Degradation Behavior
*For any* analysis session where some dimensions fail, the system should display results for successful dimensions, clearly mark failed ones with reasons, and never show empty dashboards or undefined scores.
**Validates: Requirements 6.1, 6.3, 6.4, 6.5**

### Property 8: Report Generation Accuracy
*For any* completed analysis, the report generator should calculate overall scores only from successful dimensions, provide specific actionable recommendations, and prioritize them by impact level.
**Validates: Requirements 7.1, 7.2, 7.3, 7.5**

### Property 9: Model Selection Consistency
*For any* selected AI model, the system should use that model consistently across all dimensions, and when "Auto" is selected, should choose appropriate models for each dimension type.
**Validates: Requirements 9.3, 9.4, 9.5**

### Property 10: Timeout Handling
*For any* dimension analysis that exceeds the 30-second timeout, the system should gracefully terminate that dimension and continue with others, showing partial results.
**Validates: Requirements 6.4, 13.3**

### Property 11: API Response Structure
*For any* API response from the system, the response should follow the defined JSON structure and include all required fields for the response type.
**Validates: Requirements 13.5**

### Property 12: Context Analysis Completeness
*For any* context-aware analysis session, the system should correctly identify immediate parent and direct children pages, process them individually with caching, and improve analysis quality compared to single-page analysis.
**Validates: Requirements 10.1, 10.6, 10.10**

### Property 13: Cache Consistency and Performance
*For any* documentation URL, when processed content is cached, subsequent requests should return identical results from cache, and when content changes, the cache should be invalidated and updated with fresh processing.
**Validates: Requirements 11.2, 11.3, 11.7**

### Property 14: Modern UI Responsiveness
*For any* user interface interaction, the system should provide smooth animations, proper visual hierarchy, and responsive design that works across desktop, tablet, and mobile devices.
**Validates: Requirements 12.1, 12.2, 12.3, 12.6**

### Property 16: Content Type Detection Accuracy
*For any* documentation URL processed, the system should correctly identify the content type based on URL patterns, content structure, and textual indicators, and when uncertain, should default to 'mixed' type.
**Validates: Requirements 16.1, 16.2, 16.8**

### Property 17: Adaptive Scoring Fairness
*For any* documentation content, when scoring criteria are not applicable to the detected content type, the system should mark them as not-applicable and redistribute weights to applicable criteria, ensuring no document type is unfairly penalized.
**Validates: Requirements 16.3, 16.4, 16.5**

### Property 15: AWS Integration Scalability
*For any* analysis request load, the system should handle varying loads efficiently using AWS Lambda scaling, maintain 30-second timeouts per dimension, and return structured JSON responses consistently.
**Validates: Requirements 13.1, 13.2, 13.3, 13.5**

### Property 16: Smart Content Type Detection Efficiency
*For any* documentation URL processed, the system should first attempt keyword-based detection, and only use AI fallback when keywords are insufficient, achieving 90% keyword detection rate and minimal AI costs.
**Validates: Requirements 16.1, 16.3, 16.4**

### Property 17: Adaptive Scoring Fairness
*For any* documentation content, when scoring criteria are not applicable to the detected content type, the system should mark them as not-applicable and redistribute weights to applicable criteria, ensuring no document type is unfairly penalized.
**Validates: Requirements 16.5, 16.6, 16.7**

### Property 18: Scoring Transparency and Cost Efficiency
*For any* completed analysis, the system should provide clear explanations of which scoring criteria were applied and which were skipped, while minimizing AI costs through smart detection caching.
**Validates: Requirements 16.7, 16.8, 16.9**

## Sitemap Journey Mode Correctness Properties

### Property 19: Input Type Detection Accuracy
*For any* URL input, if the URL ends with `.xml`, `sitemap.xml`, or contains `/sitemap` in the path, the system should detect it as Sitemap Mode, otherwise it should default to Doc Mode.
**Validates: Requirements 28.1, 28.2, 28.3**

### Property 20: Sitemap XML Parsing Completeness
*For any* valid sitemap XML content, the parser should extract all `<loc>` URLs and handle nested sitemaps without infinite recursion.
**Validates: Requirements 29.1, 29.2, 29.10**

### Property 21: Bulk Link Validation Categorization
*For any* set of URLs from a sitemap, the system should check all URLs for accessibility and correctly categorize each response as healthy (2xx), broken (404), access-denied (403), timeout, or error based on HTTP status codes.
**Validates: Requirements 30.1, 30.3**

### Property 22: Journey Detection and Grouping
*For any* collection of sitemap URLs, the Journey Detector should group them into logical developer workflows by persona and action, and handle overlapping pages across multiple journeys appropriately.
**Validates: Requirements 31.1, 31.9**

### Property 23: Journey Context Enrichment
*For any* page analyzed within a journey, the system should add journey context information including journey name, persona, action, step number, and related pages to the processed content.
**Validates: Requirements 33.1**

### Property 24: Journey Score Aggregation Consistency
*For any* set of page analysis results within a journey, the Journey Aggregator should combine them into a single journey score and calculate a completion confidence percentage between 0-100%.
**Validates: Requirements 34.1, 34.3**

### Property 25: Comprehensive Journey Report Structure
*For any* sitemap journey analysis, the generated report should include a sitemap health section with URL statistics and be exportable as properly formatted Markdown with tables and sections.
**Validates: Requirements 35.1, 35.5**

## Phase 1 vs Phase 2 Feature Separation

### Phase 1 Features (Current Implementation)
The core documentation quality auditor with the following capabilities:
- **Single Model Support**: Claude 3.5 Sonnet only
- **Core Analysis**: All 5 quality dimensions (Relevance, Freshness, Clarity, Accuracy, Completeness)
- **Context-Aware Analysis**: Parent/child page discovery and analysis
- **Intelligent Caching**: DynamoDB index with S3 storage and TTL management
- **Modern UI**: React frontend with Material-UI components
- **AWS Integration**: Lambda functions, Step Functions, API Gateway, Bedrock
- **Graceful Degradation**: Partial results when some dimensions fail
- **Real-time Progress**: WebSocket streaming with collapsible progress logs (IMPLEMENTED)
- **Content-Type-Aware Scoring**: Smart detection and adaptive scoring rubrics

### Phase 2 Features (Future Enhancements)
Extended capabilities planned for future releases:
- **Multi-Model Support**: Amazon Titan Text Premier and Meta Llama 3.1 70B
- **LLM-as-Judge Validation**: Async background quality validation using different models
- **Enhanced Observability**: Comprehensive transparency dashboard and model comparison views
- **Admin Quality Dashboard**: System-wide quality metrics and validation results monitoring

This separation allows for incremental development while maintaining a stable core system in Phase 1.

## Error Handling

### Error Categories and Responses

1. **URL Processing Errors**
   - Invalid URL format: Return structured error with suggestion
   - Network timeout: Retry with exponential backoff, then graceful failure
   - Access denied: Clear error message about permissions
   - Content too large: Truncate with warning about partial analysis

2. **AI Model Errors**
   - Model unavailable: Fallback to alternative model with notification
   - Rate limiting: Queue request with estimated wait time
   - Response parsing failure: Retry with simplified prompt
   - Timeout: Mark dimension as failed, continue with others

3. **Analysis Errors**
   - Code parsing failure: Skip problematic snippets, continue analysis
   - Structure detection failure: Provide manual structure input option
   - Partial dimension failure: Show available results with confidence indicators

### Error Recovery Strategies

```typescript
interface ErrorRecoveryConfig {
  maxRetries: number;
  backoffMultiplier: number;
  fallbackModels: string[];
  gracefulDegradation: boolean;
}

const ERROR_RECOVERY: Record<string, ErrorRecoveryConfig> = {
  urlFetch: {
    maxRetries: 3,
    backoffMultiplier: 2,
    fallbackModels: [],
    gracefulDegradation: true
  },
  modelInvocation: {
    maxRetries: 2,
    backoffMultiplier: 1.5,
    fallbackModels: ['claude', 'titan'],
    gracefulDegradation: true
  }
};
```

## Phase 2: Transparency, Observability, and Quality Evaluation

**Note: This entire section represents Phase 2 functionality and is not part of the initial implementation.**

### LLM-as-Judge Quality Validation (Phase 2 Only)

The system will implement a multi-layered quality assurance approach in Phase 2 to ensure audit reliability through async background validation:

#### 1. **Async Dual Model Validation (LLM-as-Judge)**
```typescript
interface QualityValidation {
  primaryAnalysis: DimensionResult;
  validationAnalysis: DimensionResult;
  consensusScore: number;
  disagreementAreas: string[];
  confidenceLevel: 'high' | 'medium' | 'low';
  validationModel: string;
}

// Phase 2: Async validation workflow (not real-time)
async function validateAnalysisQualityAsync(
  primaryResult: DimensionResult,
  content: ProcessedContent,
  primaryModel: string
): Promise<QualityValidation> {
  // Use different model for validation
  const validationModel = getValidationModel(primaryModel);
  
  const validationResult = await analyzeWithModel(content, validationModel);
  
  return {
    primaryAnalysis: primaryResult,
    validationAnalysis: validationResult,
    consensusScore: calculateConsensus(primaryResult, validationResult),
    disagreementAreas: identifyDisagreements(primaryResult, validationResult),
    confidenceLevel: determineConfidence(primaryResult, validationResult),
    validationModel
  };
}
```

#### 2. **Admin-Only Transparency Dashboard (Phase 2)**
```typescript
interface TransparencyReport {
  modelDecisions: ModelDecisionLog[];
  promptsUsed: PromptLog[];
  processingSteps: ProcessingStep[];
  confidenceMetrics: ConfidenceMetrics;
  validationResults: QualityValidation[];
}

interface ModelDecisionLog {
  timestamp: string;
  decision: string;
  reasoning: string;
  confidence: number;
  inputTokens: number;
  outputTokens: number;
  processingTime: number;
}

interface PromptLog {
  dimension: DimensionType;
  promptTemplate: string;
  actualPrompt: string; // With content substituted
  modelResponse: string;
  parseSuccess: boolean;
}
```

#### 3. **Background Quality Monitoring (Phase 2)**
```typescript
interface ObservabilityMetrics {
  analysisId: string;
  startTime: string;
  currentStep: string;
  dimensionProgress: Record<DimensionType, DimensionProgress>;
  modelPerformance: ModelPerformanceMetrics;
  errorRate: number;
  retryCount: number;
  resourceUsage: ResourceUsage;
}

interface DimensionProgress {
  status: 'pending' | 'processing' | 'validating' | 'complete' | 'failed';
  startTime: string;
  endTime?: string;
  tokensUsed: number;
  confidence: number;
  validationStatus: 'pending' | 'passed' | 'failed' | 'disputed';
}

interface ModelPerformanceMetrics {
  responseTime: number;
  tokenEfficiency: number;
  parseSuccessRate: number;
  consistencyScore: number; // Compared to validation model
}
```

### Phase 2 Quality Assurance Components

#### QualityValidator (Lambda) - Phase 2 Background Process

**Implementation Strategy**: 
- **Async Background Job**: Runs every 3 hours to validate ~10% of completed analyses
- **Admin Dashboard Only**: Results visible to system administrators, not end users
- **System Quality Monitoring**: Used to improve prompts, model selection, and analysis quality
- **No User-Facing Conflicts**: Never shows conflicting scores to end users

**Purpose**: Validates primary analysis using different model for cross-verification
**Scope**: System quality assurance and monitoring, not real-time user-facing validation

#### TransparencyLogger (Phase 2)
- **Purpose**: Logs all model decisions, prompts, and reasoning for audit trail
- **Storage**: CloudWatch Logs with structured JSON for queryability
- **Admin Access**: Transparency data available to administrators for system improvement
- **Retention**: 30-day retention for analysis and debugging

#### ObservabilityDashboard (Phase 2 Admin Component)
- **Purpose**: Admin monitoring of analysis quality and system performance
- **Features**:
  - Live model performance metrics
  - Confidence score tracking across analyses
  - Disagreement alerts between models
  - Token usage and cost tracking
  - Error rate monitoring
- **Access**: Administrator-only interface

### Phase 2 Quality Evaluation Workflow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant P as Primary Analysis
    participant BG as Background Validator
    participant A as Admin Dashboard
    
    U->>F: Submit URL for analysis
    F->>P: Start primary analysis
    P->>P: Analyze with Claude (Phase 1)
    P->>F: Return results to user
    F->>U: Display results (Phase 1 complete)
    
    Note over BG: Phase 2: Async validation (every 3 hours)
    BG->>BG: Sample ~10% of analyses
    BG->>BG: Validate with different model
    BG->>A: Store validation results
    
    Note over A: Admin reviews validation results
    A->>A: Identify systematic issues
    A->>A: Improve prompts/models
```

### Phase 2 Confidence Scoring Algorithm

```typescript
function calculateConfidenceScore(
  primaryResult: DimensionResult,
  validationResult: DimensionResult
): number {
  const scoreDifference = Math.abs(primaryResult.score - validationResult.score);
  const recommendationSimilarity = calculateRecommendationSimilarity(
    primaryResult.recommendations,
    validationResult.recommendations
  );
  
  // Confidence decreases with score disagreement and recommendation differences
  const scoreConfidence = Math.max(0, 1 - (scoreDifference / 10));
  const recommendationConfidence = recommendationSimilarity;
  
  return (scoreConfidence + recommendationConfidence) / 2;
}

function determineValidationAction(confidence: number): 'accept' | 'retry' | 'flag' {
  if (confidence >= 0.8) return 'accept';
  if (confidence >= 0.6) return 'retry';
  return 'flag'; // Human review required
}
```

### Phase 2 User-Facing Transparency Features

#### 1. **Confidence Indicators (Phase 2)**dicators**
- Visual confidence meters for each dimension
- Explanation of why confidence is high/medium/low
- Model agreement/disagreement indicators

#### 2. **"Show Your Work" Feature**
```typescript
interface ExplainabilityData {
  dimension: DimensionType;
  keyFactors: string[];
  evidenceUsed: string[];
  modelReasoning: string;
  alternativeInterpretation?: string; // From validation model
  confidenceFactors: string[];
}
```

#### 3. **Model Comparison View**
- Side-by-side comparison of primary vs validation analysis
- Highlight areas of agreement and disagreement
- Allow users to see which model they trust more for specific dimensions

### Quality Metrics Dashboard

```typescript
interface QualityMetrics {
  overallSystemConfidence: number;
  modelAgreementRate: number;
  averageAnalysisTime: number;
  errorRate: number;
  userSatisfactionScore?: number; // Future: user feedback
  costPerAnalysis: number;
  
  // Dimension-specific metrics
  dimensionReliability: Record<DimensionType, {
    averageConfidence: number;
    modelAgreementRate: number;
    userAcceptanceRate: number;
  }>;
}
```

This comprehensive quality assurance system ensures that:
1. **Every analysis is validated** by a second model
2. **All decisions are transparent** and auditable
3. **Confidence levels are quantified** and communicated
4. **System performance is monitored** in real-time
5. **Users can inspect the reasoning** behind every recommendation

## Context-Aware Analysis Architecture

### Context Discovery and Caching Strategy

The system implements intelligent context analysis with selective page inclusion and comprehensive caching to avoid re-processing content.

#### Context Discovery Logic

```typescript
interface ContextPage {
  url: string;
  title: string;
  relationship: 'parent' | 'child' | 'sibling';
  confidence: number;
  contentHash?: string; // For cache validation
}

interface ContextAnalysisStrategy {
  enabled: boolean;
  maxContextPages: number; // Default: 5
  includeParent: boolean;   // Default: true (immediate parent only)
  includeChildren: boolean; // Default: true (direct children only)
  includeSiblings: boolean; // Default: false (too broad by default)
  relevanceThreshold: number; // Default: 0.6
}

// Selective context inclusion - avoid rabbit holes
function discoverContextPages(
  document: Document, 
  baseUrl: string, 
  strategy: ContextAnalysisStrategy
): ContextPage[] {
  const contextPages: ContextPage[] = [];
  
  // Strategy 1: Immediate parent (1 level up)
  if (strategy.includeParent) {
    const parentPage = findImmediateParent(baseUrl);
    if (parentPage) contextPages.push(parentPage);
  }
  
  // Strategy 2: Direct children (linked from current page)
  if (strategy.includeChildren) {
    const childPages = findDirectChildren(document, baseUrl);
    contextPages.push(...childPages.slice(0, 3)); // Max 3 children
  }
  
  // Strategy 3: Siblings (same parent, different endpoint) - SELECTIVE
  if (strategy.includeSiblings) {
    const siblingPages = findSiblingPages(document, baseUrl);
    contextPages.push(...siblingPages.slice(0, 2)); // Max 2 siblings
  }
  
  return contextPages
    .filter(page => page.confidence >= strategy.relevanceThreshold)
    .slice(0, strategy.maxContextPages);
}
```

#### DynamoDB Caching Layer

```typescript
interface ProcessedContentIndex {
  url: string;                    // Partition key
  contentHash: string;            // Content hash for validation
  s3Location: string;             // S3 path to processed content
  processedAt: string;            // ISO timestamp
  ttl: number;                    // TTL for automatic cleanup
  contentType: string;            // 'api-docs' | 'tutorial' | 'reference'
  noiseReductionMetrics: {
    originalSize: number;
    cleanedSize: number;
    reductionPercent: number;
  };
  contextAnalysis?: {
    contextPages: ContextPage[];
    analysisScope: string;
  };
}

// Cache check workflow
async function processUrlWithCache(
  url: string, 
  contextAnalysis: ContextAnalysisStrategy
): Promise<ProcessedContent> {
  
  // 1. Check DynamoDB index for existing processed content
  const cacheEntry = await checkProcessedContentCache(url);
  
  if (cacheEntry && !isCacheExpired(cacheEntry)) {
    console.log(`Cache hit for ${url}, retrieving from S3`);
    
    // 2. Retrieve processed content from S3
    const cachedContent = await retrieveFromS3(cacheEntry.s3Location);
    
    // 3. Validate content hash (optional integrity check)
    const currentHash = await calculateContentHash(url);
    if (currentHash === cacheEntry.contentHash) {
      return cachedContent;
    } else {
      console.log(`Content changed for ${url}, re-processing`);
    }
  }
  
  // 4. Process content fresh (cache miss or expired/invalid)
  const processedContent = await processContentFresh(url, contextAnalysis);
  
  // 5. Store in cache (DynamoDB + S3)
  await storeInCache(url, processedContent);
  
  return processedContent;
}
```

#### Cache Management

```typescript
interface CacheConfig {
  ttlDays: number;              // Default: 7 days
  maxCacheSize: number;         // Max entries in DynamoDB
  s3BucketName: string;         // S3 bucket for processed content
  compressionEnabled: boolean;   // Gzip compression for S3 storage
}

// DynamoDB Table Schema
const ProcessedContentTable = {
  TableName: 'LensyProcessedContent',
  KeySchema: [
    { AttributeName: 'url', KeyType: 'HASH' }  // Partition key
  ],
  AttributeDefinitions: [
    { AttributeName: 'url', AttributeType: 'S' },
    { AttributeName: 'processedAt', AttributeType: 'S' }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'ProcessedAtIndex',
      KeySchema: [
        { AttributeName: 'processedAt', KeyType: 'HASH' }
      ],
      Projection: { ProjectionType: 'ALL' }
    }
  ],
  TimeToLiveSpecification: {
    AttributeName: 'ttl',
    Enabled: true
  }
};
```

### Context Analysis Integration

#### Enhanced URLProcessor with Caching

```typescript
// Updated URLProcessor workflow
export const handler: Handler<URLProcessorEvent, URLProcessorResponse> = async (event) => {
  try {
    // 1. Check cache first
    const cachedContent = await checkProcessedContentCache(event.url);
    
    if (cachedContent && !isCacheExpired(cachedContent)) {
      console.log('Using cached content');
      return {
        success: true,
        sessionId: event.sessionId,
        message: 'Retrieved from cache',
        fromCache: true
      };
    }
    
    // 2. Process content fresh
    const processedContent = await processContentWithContext(event);
    
    // 3. Store in cache
    await storeProcessedContent(event.url, processedContent);
    
    return {
      success: true,
      sessionId: event.sessionId,
      message: 'Content processed and cached'
    };
    
  } catch (error) {
    console.error('URL processing failed:', error);
    return {
      success: false,
      sessionId: event.sessionId,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

async function processContentWithContext(event: URLProcessorEvent): Promise<ProcessedContent> {
  // Process main content
  const mainContent = await processMainContent(event.url);
  
  // Process context pages if enabled
  let contextContent: ProcessedContent[] = [];
  
  if (event.contextAnalysis?.enabled) {
    const contextPages = discoverContextPages(
      mainContent.document, 
      event.url,
      {
        enabled: true,
        maxContextPages: event.contextAnalysis.maxContextPages || 5,
        includeParent: true,
        includeChildren: true,
        includeSiblings: false, // Selective by default
        relevanceThreshold: 0.6
      }
    );
    
    // Process context pages (with their own cache checks)
    for (const contextPage of contextPages) {
      try {
        const contextProcessed = await processUrlWithCache(
          contextPage.url,
          { enabled: false } // Don't recurse context analysis
        );
        contextContent.push(contextProcessed);
      } catch (error) {
        console.log(`Failed to process context page ${contextPage.url}:`, error);
        // Continue with other context pages
      }
    }
  }
  
  return {
    ...mainContent,
    contextAnalysis: {
      contextPages: contextContent.map(c => ({
        url: c.url,
        title: c.title || 'Context Page',
        relationship: determineRelationship(c.url, event.url),
        confidence: 0.8
      })),
      analysisScope: contextContent.length > 0 ? 'with-context' : 'single-page',
      totalPagesAnalyzed: 1 + contextContent.length
    }
  };
}
```

### Performance and Cost Optimization

#### Smart Detection Strategy
- **Layer 1 (90% of cases)**: Keyword matching on URL and title (free, <5ms)
- **Layer 2 (10% of cases)**: AI classification using metadata (~50 tokens, $0.0001)
- **Caching**: AI results stored in DynamoDB, never re-computed
- **Cost**: ~$0.01 per 1000 URLs analyzed

#### Detection Accuracy
- **High confidence**: URL patterns and function signatures
- **Medium confidence**: AI classification of unclear cases
- **Fallback**: 'mixed' type uses balanced scoring criteria

#### Parallel Context Processing

```typescript
// Process context pages in parallel for better performance
async function processContextPagesParallel(
  contextPages: ContextPage[]
): Promise<ProcessedContent[]> {
  const contextPromises = contextPages.map(async (page) => {
    try {
      return await processUrlWithCache(page.url, { enabled: false });
    } catch (error) {
      console.log(`Context page failed: ${page.url}`, error);
      return null;
    }
  });
  
  const results = await Promise.allSettled(contextPromises);
  
  return results
    .filter((result): result is PromiseFulfilledResult<ProcessedContent> => 
      result.status === 'fulfilled' && result.value !== null
    )
    .map(result => result.value);
}
```

#### Cache Warming Strategy

```typescript
// Optional: Pre-warm cache for popular documentation sites
interface CacheWarmingConfig {
  enabled: boolean;
  popularUrls: string[];
  warmingSchedule: string; // Cron expression
}

async function warmCache(config: CacheWarmingConfig): Promise<void> {
  if (!config.enabled) return;
  
  for (const url of config.popularUrls) {
    try {
      await processUrlWithCache(url, { enabled: true });
      console.log(`Cache warmed for ${url}`);
    } catch (error) {
      console.log(`Cache warming failed for ${url}:`, error);
    }
  }
}
```

### Monitoring and Observability

#### Cache Performance Metrics

```typescript
interface CacheMetrics {
  hitRate: number;              // Cache hit percentage
  avgProcessingTime: number;    // Average processing time
  cacheSize: number;            // Current cache entries
  s3StorageUsed: number;        // S3 storage in bytes
  costSavings: number;          // Estimated cost savings from cache hits
}

// CloudWatch metrics for cache performance
async function publishCacheMetrics(metrics: CacheMetrics): Promise<void> {
  await cloudWatch.putMetricData({
    Namespace: 'Lensy/Cache',
    MetricData: [
      {
        MetricName: 'CacheHitRate',
        Value: metrics.hitRate,
        Unit: 'Percent'
      },
      {
        MetricName: 'ProcessingTime',
        Value: metrics.avgProcessingTime,
        Unit: 'Milliseconds'
      }
    ]
  }).promise();
}
```

## Future AI Agent Architecture

The current design is architected to support future expansion into an AI agent system that handles:

1. **Content Creation**: Generate documentation based on analysis findings
2. **Content Review**: Current audit functionality with context awareness
3. **Content Publishing**: Automated publishing workflows
4. **Content Maintenance**: Automated updates based on cache invalidation

### Agent-Ready Design Patterns

```typescript
interface AgentAction {
  type: 'analyze' | 'generate' | 'publish' | 'review' | 'maintain';
  input: any;
  context: AgentContext;
}

interface AgentContext {
  previousActions: AgentAction[];
  userPreferences: UserPreferences;
  projectContext: ProjectContext;
  cacheContext: CacheContext;
}

// Future agent orchestrator with caching awareness
class DocumentationAgent {
  async executeAction(action: AgentAction): Promise<AgentResult> {
    switch (action.type) {
      case 'analyze': return this.contextAwareAnalysisFlow(action);
      case 'generate': return this.futureGenerationFlow(action);
      case 'publish': return this.futurePublishingFlow(action);
      case 'maintain': return this.cacheMaintenanceFlow(action);
    }
  }
}
```

### Migration Strategy

The current architecture can be extended without breaking changes:
- **Phase 1**: Context-aware audit system with DynamoDB caching (current implementation)
- **Phase 2**: Add content generation capabilities with cache-aware workflows
- **Phase 3**: Add publishing workflows with cache invalidation
- **Phase 4**: Full AI agent with proactive cache management agent orchestration

This modular approach allows incremental development while maintaining the core audit functionality.

## Model Selection Rationale

### Phase 1: Claude-Only Implementation

For the initial implementation, the system uses only Claude 3.5 Sonnet based on:

**Claude 3.5 Sonnet Advantages:**
- **Superior Code Analysis**: Excellent at detecting syntax errors, deprecated methods, and version compatibility issues
- **Technical Writing Evaluation**: Strong performance on documentation clarity and accuracy assessment
- **Structured Reasoning**: Reliable JSON response formatting and consistent scoring methodology
- **Proven Performance**: [Anthropic documentation](https://docs.anthropic.com) demonstrates excellent technical content analysis capabilities

**Single Model Strategy Benefits:**
- **Consistency**: All dimensions analyzed with the same model for coherent scoring
- **Reliability**: Proven working implementation with stable JSON parsing
- **Simplicity**: Reduced complexity for initial deployment and testing
- **Cost Efficiency**: Single model reduces token usage and API costs

### Phase 2: Multi-Model Support

Future expansion will include additional models based on AWS Bedrock capabilities:

**Amazon Titan Text Premier** (Phase 2):
- **Strengths**: Information extraction, summarization, comprehensive analysis
- **Use Cases**: Completeness and Freshness dimensions
- **Evidence**: [AWS documentation](https://aws.amazon.com/bedrock/titan/) highlights optimization for text analysis tasks

**Meta Llama 3.1 70B** (Phase 2):
- **Strengths**: Context understanding, balanced assessments
- **Use Cases**: Relevance dimension, general content evaluation
- **Evidence**: Strong performance on reasoning tasks per [AWS Bedrock model comparison](https://aws.amazon.com/bedrock/llama/)

### Phase 1 Model Selection Logic
```typescript
// Simplified: Claude-only for Phase 1 reliability
function selectModelForAnalysis(contentType: string, userPreference: string): string {
  // Phase 1: Always use Claude regardless of preference
  return 'claude';
}

// Phase 2: Full auto-selection logic (future)
const PHASE_2_AUTO_MODEL_SELECTION = {
  'api-docs': 'claude',              // Technical documentation - best code analysis
  'tutorial': 'llama',               // Educational content - balanced assessment
  'reference': 'titan',              // Reference material - comprehensive analysis
  'mixed': 'claude'                  // Default for mixed content types
};
```

**Migration Strategy:**
- Phase 1: Establish reliable Claude-based analysis pipeline
- Phase 2: Add Titan and Llama with proper response parsing and validation
- Phase 3: Enable intelligent auto-selection based on content type and user preferences

## Content-Type-Aware Scoring Framework

### Problem: One-Size-Fits-All Scoring Doesn't Work

Different documentation types have different quality expectations:

| Doc Type | Code Expected? | What Matters Most |
|----------|---------------|-------------------|
| API Reference | ✅ Yes, lots | Syntax accuracy, complete examples |
| Tutorial | ✅ Yes | Step-by-step flow, runnable code |
| Conceptual Guide | ❌ No | Clear explanations, diagrams |
| Overview | ❌ No | Navigation, scope definition |
| Troubleshooting | ❌ Maybe | Problem coverage, solutions |

### Solution: Adaptive Scoring Based on Document Type

#### Smart Content Type Detection: Keyword-First + AI-Fallback

```typescript
type DocumentationType = 
  | 'api-reference'      // Function/class docs, needs code
  | 'tutorial'           // Step-by-step guide, needs code
  | 'conceptual'         // Explains concepts, may not need code
  | 'how-to'             // Task-focused, usually needs code
  | 'reference'          // Tables, lists, specs
  | 'troubleshooting'    // Problem/solution format
  | 'overview'           // High-level intro, rarely needs code
  | 'changelog'          // Version history
  | 'mixed';             // Combination

// Layer 1: Fast keyword matching (90% of cases, free)
function detectByKeywords(url: string, title: string): DocumentationType | null {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    const searchText = `${urlLower} ${titleLower}`;
    
    // High-confidence keyword matches
    if (searchText.includes('/reference/functions/') || 
        searchText.includes('/reference/classes/') ||
        titleLower.includes('()') || 
        titleLower.includes('function')) {
        return 'api-reference';
    }
    
    if (searchText.includes('getting-started') || 
        searchText.includes('tutorial') ||
        titleLower.includes('tutorial')) {
        return 'tutorial';
    }
    
    if (searchText.includes('/explanations/') || 
        searchText.includes('architecture') ||
        titleLower.includes('architecture') ||
        titleLower.includes('understanding')) {
        return 'conceptual';
    }
    
    if (searchText.includes('how-to') || 
        titleLower.includes('how to') ||
        titleLower.includes('create') ||
        titleLower.includes('build')) {
        return 'how-to';
    }
    
    if (searchText.includes('/intro') || 
        searchText.includes('introduction') ||
        titleLower.includes('introduction')) {
        return 'overview';
    }
    
    if (searchText.includes('/reference-guides/') ||
        titleLower.includes('reference')) {
        return 'reference';
    }
    
    return null; // No clear match - need AI fallback
}

// Layer 2: AI fallback for unclear cases (10% of cases, small cost)
async function detectByAI(url: string, title: string, description?: string): Promise<DocumentationType> {
    const prompt = `Classify this documentation page type:

URL: ${url}
Title: ${title}
Description: ${description || 'N/A'}

Classify as ONE of: api-reference, tutorial, conceptual, how-to, overview, reference, troubleshooting, mixed

Respond with just the type name.`;

    const response = await callBedrockModel(prompt);
    return response.trim() as DocumentationType;
}

// Complete detection with caching
async function detectContentTypeEnhanced(
    document: Document, 
    markdownContent: string, 
    url: string
): Promise<DocumentationType> {
    
    // Layer 1: Fast keyword detection (90% of cases)
    const keywordType = detectByKeywords(url, document.title);
    if (keywordType) {
        console.log(`✅ Detected by keywords: ${keywordType}`);
        return keywordType;
    }
    
    // Layer 2: AI fallback for unclear cases (10% of cases)
    console.log(`🤖 Using AI fallback for: ${url}`);
    
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content');
    const aiType = await detectByAI(url, document.title, metaDescription);
    
    console.log(`🎯 AI detected: ${aiType}`);
    return aiType;
}
```

#### Type-Specific Scoring Rubrics

```typescript
interface AdaptiveCriteria {
  criterion: string;
  applicability: Record<DocumentationType, 'required' | 'optional' | 'not-applicable'>;
  weight: Record<DocumentationType, number>;
}

const codeExamplesCriteria: AdaptiveCriteria = {
  criterion: 'Code Examples Quality',
  applicability: {
    'api-reference': 'required',
    'tutorial': 'required',
    'how-to': 'required',
    'conceptual': 'optional',      // Nice to have, not required
    'overview': 'not-applicable',  // Don't penalize for no code
    'changelog': 'not-applicable',
    'troubleshooting': 'optional',
    'reference': 'optional',
    'mixed': 'optional'
  },
  weight: {
    'api-reference': 30,  // Heavy weight - code is critical
    'tutorial': 25,
    'how-to': 25,
    'conceptual': 10,     // Light weight - code is bonus
    'overview': 0,        // Zero weight - don't count
    'changelog': 0,
    'troubleshooting': 15,
    'reference': 10,
    'mixed': 15
  }
};
```

#### Graceful Handling of Non-Applicable Criteria

```typescript
function calculateDimensionScore(results: CriterionResult[]): number {
  // Filter out not-applicable criteria
  const applicableResults = results.filter(r => r.status === 'evaluated');
  
  // Redistribute weights among applicable criteria
  const totalOriginalWeight = applicableResults.reduce((sum, r) => sum + r.weight, 0);
  
  applicableResults.forEach(r => {
    r.adjustedWeight = (r.weight / totalOriginalWeight) * 100;
  });
  
  // Calculate weighted score
  const weightedScore = applicableResults.reduce(
    (sum, r) => sum + (r.score! * r.adjustedWeight / 100), 
    0
  );
  
  return Math.round(weightedScore);
}
```

### Example: Fair Scoring Across Document Types

**Conceptual Guide**: "Understanding WordPress Block Architecture"
- **Without Adaptive Scoring**: 64/100 (penalized for no code examples)
- **With Adaptive Scoring**: 86/100 (code examples marked N/A, weights redistributed)

**API Reference**: "wp_insert_post() Function"
- **Code Examples Weight**: 30% (critical for API docs)
- **Explanation Weight**: 20% (less critical than examples)

**Overview Page**: "WordPress Developer Resources"
- **Code Examples Weight**: 0% (not applicable)
- **Navigation Weight**: 40% (critical for overview pages)

## Testing Strategy

### Dual Testing Approach

The system requires both unit testing and property-based testing for comprehensive coverage:
- Specific examples of URL processing with known inputs/outputs
- Edge cases like malformed URLs, empty content, timeout scenarios
- Integration points between frontend and backend components
- Error conditions and recovery mechanisms

**Property-Based Tests** focus on:
- Universal properties that hold across all valid inputs
- Comprehensive input coverage through randomization
- System behavior under various load and failure conditions
- Cross-model consistency and performance characteristics

### Property-Based Testing Configuration

- **Testing Framework**: Use fast-check for JavaScript/TypeScript property testing
- **Test Iterations**: Minimum 100 iterations per property test
- **Test Tagging**: Each property test references its design document property
- **Tag Format**: `Feature: documentation-quality-auditor, Property {number}: {property_text}`

### Test Data Generation

```typescript
// Example generators for property testing
const urlGenerator = fc.webUrl();
const documentContentGenerator = fc.record({
  html: fc.string(),
  codeSnippets: fc.array(fc.record({
    language: fc.constantFrom('javascript', 'python', 'java'),
    code: fc.string(),
    hasErrors: fc.boolean()
  })),
  links: fc.array(fc.webUrl())
});

const modelSelectionGenerator = fc.constantFrom('claude', 'titan', 'llama', 'auto');
```

### Integration Testing

- **End-to-End Flows**: Test complete analysis workflows with real documentation URLs
- **Model Comparison**: Verify consistent behavior across different AI models
- **Performance Testing**: Ensure analysis completes within acceptable timeframes
- **Failure Simulation**: Test graceful degradation under various failure conditions

### Test Environment Setup

- **Mock AWS Services**: Use LocalStack for local AWS service simulation
- **Test Documentation**: Maintain test documentation URLs with known characteristics
- **Automated Testing**: CI/CD pipeline with automated test execution
- **Performance Monitoring**: Track analysis times and success rates across test runs


## Recent Enhancements (December 2024)

### Link Issue Categorization and Reporting

The system now distinguishes between different types of link issues rather than treating all non-200 responses as "broken links".

#### LinkIssue Interface

```typescript
interface LinkIssue {
  url: string;
  status: number | string;
  anchorText: string;
  sourceLocation: string;
  errorMessage: string;
  issueType: '404' | 'error' | 'timeout' | 'access-denied';
}
```

#### Issue Type Categorization

- **404 (broken)**: True broken links - page not found
- **403 (access-denied)**: Access permission issues
- **timeout**: Network timeout or slow response
- **error**: Other HTTP errors (5xx, etc.)

#### Deduplication Strategy

The system deduplicates link issues by URL to ensure each unique link is reported only once:

1. **Before Validation**: Deduplicate extracted links to avoid redundant HTTP requests
2. **After Validation**: Deduplicate results to ensure each URL appears once in findings

#### Enhanced Reporting

```typescript
interface LinkValidationResult {
  checkedLinks: number;
  linkIssueFindings: LinkIssue[];
  healthyLinks: number;
  brokenLinks: number;        // 404s only
  accessDeniedLinks: number;  // 403s
  timeoutLinks: number;       // Timeouts
  otherErrors: number;        // Other HTTP errors
}
```

**Frontend Display**: "Link Issues: X (Y broken)" where X is total issues and Y is 404 count

**Markdown Report Sections**:
- "Broken Links (404)" - separate section for true broken links
- "Other Link Issues" - separate section for 403s, timeouts, and errors

### Cache Control for Testing

The system provides a user-facing toggle to disable caching temporarily for testing purposes.

#### Cache Control Flow

```typescript
interface CacheControlPreference {
  enabled: boolean;  // Default: true
}

// Frontend → Backend flow
interface AnalysisRequest {
  url: string;
  selectedModel: string;
  sessionId: string;
  cacheControl?: {
    enabled: boolean;
  };
}
```

#### Cache Control Behavior

**When Cache Enabled (default)**:
- Check DynamoDB cache before processing
- Retrieve cached content from S3 if available
- Store new results in cache after processing
- Normal operation with full cache benefits

**When Cache Disabled (testing mode)**:
- Skip all cache checks (DynamoDB and S3)
- Always run fresh analysis
- Do NOT store results in cache
- Display warning: "⚠️ Testing mode: Cache disabled - fresh analysis every time"

#### Implementation in URLProcessor

```typescript
export const handler: Handler<URLProcessorEvent, URLProcessorResponse> = async (event) => {
  // Check if caching is enabled (default to true for backward compatibility)
  const cacheEnabled = event.cacheControl?.enabled !== false;
  
  if (cacheEnabled) {
    // Normal cache flow
    const cachedContent = await checkProcessedContentCache(event.url);
    if (cachedContent && !isCacheExpired(cachedContent)) {
      return { success: true, message: 'Retrieved from cache' };
    }
  } else {
    console.log('⚠️ Cache disabled by user - skipping cache check');
  }
  
  // Process content fresh
  const processedContent = await processContent(event.url);
  
  // Store in cache only if caching is enabled
  if (cacheEnabled) {
    await storeInCache(event.url, processedContent);
  } else {
    console.log('⚠️ Cache disabled - skipping cache storage');
  }
  
  return { success: true, message: 'Content processed' };
};
```

### Compact UI Layout for Configuration Options

The frontend now displays configuration cards (Context Analysis and Cache Control) side-by-side on desktop screens to save vertical space.

#### Responsive Grid Layout

```typescript
// Material-UI Grid implementation
<Grid container spacing={2} sx={{ mb: 3 }}>
  <Grid item xs={12} md={6}>
    <Card sx={{ bgcolor: 'grey.50', height: '100%' }}>
      <CardContent>
        {/* Context Analysis toggle and description */}
      </CardContent>
    </Card>
  </Grid>
  
  <Grid item xs={12} md={6}>
    <Card sx={{ bgcolor: 'grey.50', height: '100%' }}>
      <CardContent>
        {/* Cache Control toggle and description */}
      </CardContent>
    </Card>
  </Grid>
</Grid>
```

#### Layout Behavior

**Desktop (md and above)**:
- Both cards displayed side-by-side
- Each card takes 50% width
- Equal heights with `height: '100%'`
- Consistent spacing with `spacing={2}`

**Mobile (xs)**:
- Cards stack vertically
- Each card takes full width (100%)
- Maintains readability on small screens

#### Benefits

- **Space Efficiency**: Reduces vertical scrolling on desktop
- **Visual Balance**: Equal-height cards create clean layout
- **Responsive**: Adapts to mobile screens automatically
- **Consistency**: Maintains Material-UI design system
