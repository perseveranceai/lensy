# Requirements Document

## Implementation Status (Updated January 3, 2026)

### ✅ Completed Requirements (All Phases)

**Phase 1: Core Documentation Analysis (Requirements 1-27)**
- ✅ Doc Mode: Individual page analysis with 5 quality dimensions
- ✅ Real-time WebSocket progress streaming
- ✅ Content-type-aware scoring framework
- ✅ Enhanced code analysis with deprecation detection
- ✅ Internal link validation with categorization
- ✅ Intelligent caching with session-based S3 storage
- ✅ Context-aware analysis with related pages
- ✅ Multi-model AI support (Claude 3.5 Sonnet)
- ✅ Markdown report export with critical findings

**Phase 2: Sitemap Journey Mode (Requirements 28-35)**
- ✅ Intelligent input detection (doc vs sitemap)
- ✅ Sitemap parser with nested sitemap support
- ✅ Bulk URL health checking with categorization
- ✅ Developer journey detection and grouping
- ✅ Journey-aware content analysis
- ✅ Journey score aggregation with completion confidence
- ✅ Comprehensive journey reports with blocking issues

**Phase 3: Issue Discovery Mode (Requirements 36-38)** ✅ **COMPLETED**
- ✅ **Requirement 36**: Online Issue Discovery
  - 36.1-36.2: Multi-source search (Stack Overflow) with categorization ✅
  - 36.3-36.4: Frequency analysis and source credibility ✅
  - 36.5-36.6: Mode selection UI with real-time search ✅
  - 36.7-36.10: Session storage and caching ✅
  
- ✅ **Requirement 37**: Real-Time Issue Validation ✅ **COMPLETED TODAY**
  - 37.1-37.3: Semantic search with pre-curated pages and sitemap fallback ✅
  - 37.4-37.6: Gap detection (critical, potential, resolved) ✅
  - 37.7-37.9: Code example validation and completeness checking ✅
  - 37.10-37.14: Real-time validation status with evidence ✅
  - **NEW**: AI-powered recommendations with BEFORE/AFTER code examples ✅
  - **NEW**: Semantic similarity scoring using Amazon Titan embeddings ✅
  - **NEW**: Rich content analysis (code snippets, error messages, tags) ✅
  
- ✅ **Requirement 38**: Enhanced Report Generation ✅ **COMPLETED TODAY**
  - 38.1-38.5: Comprehensive issue sections (confirmed, potential, critical, resolved) ✅
  - 38.6-38.7: Specific recommendations with sitemap health integration ✅
  - 38.8-38.9: Source references and impact prioritization ✅
  - 38.10-38.13: Code examples, potential gap highlighting, Markdown export ✅
  - **NEW**: Sitemap health analysis integrated with issue validation ✅
  - **NEW**: Executive summary with accurate source attribution ✅

### 🎯 Key Features Delivered

**Issue Discovery & Validation System:**
- Real developer issues from Stack Overflow (5 issues for Resend.com POC)
- Semantic search using Amazon Titan embeddings for accurate page matching
- AI-powered gap analysis with confidence scoring (70-95%)
- Detailed recommendations with BEFORE/AFTER code improvements
- Sitemap health check (217 URLs) integrated with validation results

**Technical Implementation:**
- IssueDiscoverer Lambda: Searches Stack Overflow for real issues
- IssueValidator Lambda: Validates issues against current documentation
- SitemapParser Lambda: Extracts documentation URLs from sitemap.xml
- SitemapHealthChecker Lambda: Bulk URL validation with categorization
- Frontend: Three-mode UI (Doc, Sitemap, Issue Discovery) with real-time updates

**Report Quality:**
- Executive summary with accurate source attribution (Stack Overflow only)
- Sitemap health analysis (100% healthy for Resend.com)
- Detailed evidence with semantic match scores (39-68%)
- AI-generated recommendations with code examples
- Markdown export for CEO/team sharing

### 📊 Production Metrics (Resend.com POC)
- **Issues Analyzed**: 1 issue (Email not being sent with NextJS server actions)
- **Documentation Pages Checked**: 5 pages via semantic search
- **Sitemap Health**: 217/217 URLs healthy (100%)
- **Processing Time**: ~23 seconds end-to-end
- **Semantic Match Quality**: 68% best match (Send emails with Next.js page)
- **Validation Status**: Potential Gap (page exists but incomplete)
- **Confidence Score**: 75%

### 🔧 Bug Fixes (January 3, 2026)
- ✅ Fixed NaN display in sitemap health "Other Issues" count
- ✅ Fixed undefined values in exported markdown reports
- ✅ Updated executive summary to accurately reflect Stack Overflow-only source
- ✅ Updated methodology section to remove references to GitHub/Reddit
- ✅ Added null coalescing operators for all sitemap health counts

### 📝 Implementation Notes
- **Pragmatic POC Approach**: Manual Stack Overflow research + real-issues-data.json
- **Real Data**: 5 authentic Q4 2025 issues from Stack Overflow
- **Extensible Design**: Can be upgraded to Google Custom Search API or MCP servers
- **CEO-Ready**: Clean codebase, accurate reporting, professional export format

## Introduction

Lensy is a Documentation Quality Auditor that analyzes developer documentation and produces comprehensive quality reports with specific, actionable recommendations. The system operates in three modes:

1. **Doc Mode** (existing): Analyzes individual documentation URLs across five quality dimensions
2. **Sitemap Journey Mode** (existing): Analyzes entire documentation portals via sitemap.xml to detect developer journeys and assess workflow completion confidence
3. **Issue Discovery Mode** (new): Discovers real developer problems online, validates them against current documentation, and provides targeted analysis

All modes provide real-time progress feedback and generate detailed reports with actionable recommendations.

## Glossary

- **System**: The Lensy Documentation Quality Auditor application
- **Doc_Mode**: Existing analysis mode for individual documentation URLs (UNCHANGED)
- **Sitemap_Mode**: Analysis mode that processes sitemap.xml files for bulk documentation analysis
- **Issue_Discovery_Mode**: New analysis mode that discovers real developer problems online and validates them against current documentation
- **Issue_Discoverer**: Component that searches online for common developer problems with documentation portals
- **Issue_Validator**: Component that validates whether discovered issues still exist in current documentation
- **Sitemap_Parser**: Component that fetches and parses sitemap.xml files to extract documentation URLs
- **Journey_Detector**: Component that groups sitemap URLs into developer persona + action workflows
- **Journey_Aggregator**: Component that combines page scores into overall journey completion confidence
- **Journey**: A sequence of documentation pages a developer follows to complete a specific action
- **Persona**: The type of developer (e.g., "Node.js Developer", "DevOps Engineer")
- **Action**: The goal the developer wants to achieve (e.g., "Send first email", "Set up webhooks")
- **Completion_Confidence**: Percentage likelihood that a developer can successfully complete an action using the documentation
- **Analyzer**: The component responsible for evaluating documentation quality
- **Progress_Streamer**: The component that provides real-time analysis updates
- **Report_Generator**: The component that creates the final quality dashboard
- **Structure_Detector**: The component that identifies documentation topics and organization
- **Code_Validator**: The component that checks code snippets for syntax and deprecation issues
- **Link_Checker**: Component that validates internal link accessibility via HTTP requests
- **Code_Analyzer**: Component that detects deprecated methods and syntax errors in code snippets using LLM analysis
- **Dimension**: A specific quality aspect being evaluated (Relevance, Freshness, Clarity, Accuracy, Completeness)
- **Model_Selector**: The component that manages AI model selection and configuration
- **Context_Pages**: Related documentation pages (parent, child, sibling) that provide additional context for analysis
- **Cache_Index**: The existing DynamoDB table that tracks processed content locations and metadata using session-based S3 paths
- **Session_ID**: Unique identifier for each analysis session, used in S3 path structure (e.g., "session-d3dc80920ce1")
- **Journey_Cache**: New DynamoDB table for storing journey-level analysis results and company associations
- **TTL**: Time To Live - the expiration time for cached content entries
- **Finding**: A specific, verifiable issue with exact location (URL, line number, method name)
- **Critical_Findings**: High-impact issues (broken links, deprecated code, syntax errors) displayed prominently in UI

## Requirements

### Requirement 1: URL Analysis and Content Processing

**User Story:** As a developer, I want to submit a documentation URL for analysis, so that I can get quality insights about the documentation.

#### Acceptance Criteria

1. WHEN a user submits a valid documentation URL, THE System SHALL fetch and extract the content for analysis
2. WHEN the URL is invalid or inaccessible, THE System SHALL return a descriptive error message
3. WHEN content extraction completes, THE System SHALL identify the documentation structure and topics
4. THE System SHALL handle various documentation formats including HTML, Markdown-based sites, and API references
5. WHEN processing HTML content, THE System SHALL remove noise elements including scripts, styles, navigation, headers, footers, forms, and media embeds before conversion
6. WHEN extracting content, THE System SHALL use WordPress-specific selectors including .entry-content and .post-content to identify main documentation content
7. WHEN converting to Markdown, THE System SHALL use Turndown library with GitHub Flavored Markdown plugin for tables, code blocks, and formatting
8. THE System SHALL use Turndown's built-in remove method to eliminate remaining noise elements during conversion
9. THE System SHALL achieve at least 90% noise reduction from raw HTML to clean Markdown
10. THE System SHALL log detailed noise reduction metrics including original size, cleaned size, and reduction percentage for monitoring

### Requirement 2: Structure Detection and Confirmation

**User Story:** As a user, I want to confirm the detected documentation structure, so that the analysis focuses on the correct content organization.

#### Acceptance Criteria

1. WHEN multiple topics are detected, THE System SHALL display a breakdown with topic names and page counts
2. WHEN a single topic is detected, THE System SHALL show the categorization for user confirmation
3. WHEN structure detection completes, THE System SHALL require explicit user confirmation before proceeding
4. WHERE structure confirmation is provided, THE System SHALL proceed with dimension analysis
5. IF the user rejects the structure, THE System SHALL allow manual editing of the topic breakdown

### Requirement 3: Real-Time Progress Streaming

**User Story:** As a user, I want to see live progress updates during analysis, so that I understand what the system is doing and can track completion.

#### Acceptance Criteria

1. WHEN dimension analysis begins, THE Progress_Streamer SHALL display real-time status updates via WebSocket connection
2. WHEN analyzing each dimension, THE Progress_Streamer SHALL show specific findings as they are discovered
3. WHEN code snippets are found, THE Progress_Streamer SHALL report syntax errors and deprecated methods immediately
4. WHEN a dimension completes, THE Progress_Streamer SHALL display the final score and mark completion
5. WHEN a dimension fails, THE Progress_Streamer SHALL explain the failure reason and continue with remaining dimensions
6. WHEN analysis completes, THE Progress_Streamer SHALL automatically collapse to show results while preserving access to logs
7. WHEN cache status is determined, THE Progress_Streamer SHALL clearly indicate cache HIT or MISS with appropriate icons
8. THE Progress_Streamer SHALL provide collapsible progress logs that remain accessible after analysis completion

### Requirement 4: Quality Dimension Analysis

**User Story:** As a documentation maintainer, I want comprehensive quality evaluation across multiple dimensions with content-type-aware scoring, so that I can identify specific areas for improvement based on the type of documentation being analyzed.

#### Acceptance Criteria

1. THE Analyzer SHALL evaluate Relevance by checking target audience alignment and search intent match
2. THE Analyzer SHALL evaluate Freshness by detecting deprecated code examples and API version currency
3. THE Analyzer SHALL evaluate Clarity by assessing readability metrics and code example quality
4. THE Analyzer SHALL evaluate Accuracy by validating code syntax and function signatures
5. THE Analyzer SHALL evaluate Completeness by checking for coverage gaps and broken links
6. WHEN analyzing code snippets, THE Code_Validator SHALL check syntax, deprecated methods, and version compatibility
7. WHEN dimension analysis encounters errors, THE System SHALL continue with remaining dimensions
8. WHEN scoring documentation, THE System SHALL detect the content type (api-reference, tutorial, conceptual, overview, etc.) and apply appropriate scoring criteria
9. WHEN code examples are not applicable to the content type, THE System SHALL mark code-related criteria as not-applicable and redistribute scoring weights
10. THE System SHALL provide transparent scoring breakdowns showing which criteria were evaluated and which were marked as not-applicable

### Requirement 5: Code Snippet Validation

**User Story:** As a developer, I want code examples in documentation to be validated for correctness, so that I can trust the examples will work when copied.

#### Acceptance Criteria

1. WHEN code snippets are detected, THE Code_Validator SHALL extract the programming language identifier
2. WHEN validating syntax, THE Code_Validator SHALL report specific line numbers and error descriptions
3. WHEN checking for deprecated methods, THE Code_Validator SHALL identify the deprecated function and replacement version
4. WHEN version compatibility issues are found, THE Code_Validator SHALL specify which versions are affected
5. WHEN code snippets lack version specifications, THE Code_Validator SHALL flag this as a clarity issue

### Requirement 6: Graceful Degradation and Error Handling

**User Story:** As a user, I want to receive useful results even when some analysis components fail, so that partial failures don't prevent me from getting valuable insights.

#### Acceptance Criteria

1. WHEN at least one dimension completes successfully, THE Report_Generator SHALL display results for available dimensions
2. WHEN all dimensions fail, THE System SHALL show an error report explaining what went wrong
3. WHEN individual dimensions fail, THE System SHALL mark them clearly and explain the failure reason
4. WHEN timeout occurs during analysis, THE System SHALL show partial results and indicate which dimensions were incomplete
5. THE System SHALL never show empty dashboards or undefined scores for failed dimensions

### Requirement 7: Quality Report Generation

**User Story:** As a documentation team lead, I want detailed quality reports with specific recommendations, so that I can prioritize documentation improvements effectively.

#### Acceptance Criteria

1. WHEN analysis completes, THE Report_Generator SHALL calculate an overall quality score based on completed dimensions
2. WHEN displaying dimension scores, THE Report_Generator SHALL show scores only for successfully analyzed dimensions
3. WHEN generating recommendations, THE Report_Generator SHALL provide specific, actionable advice with code examples where applicable
4. WHEN code issues are found, THE Report_Generator SHALL include exact line numbers and replacement suggestions
5. THE System SHALL prioritize recommendations by impact level including high, medium, and low priority

### Requirement 8: User Interface and Experience

**User Story:** As a user, I want an intuitive interface that guides me through the analysis process, so that I can easily understand and act on the results.

#### Acceptance Criteria

1. WHEN the application loads, THE System SHALL display a clear URL input field with an analyze button
2. WHEN analysis is in progress, THE System SHALL show streaming progress notes with appropriate status icons
3. WHEN displaying results, THE System SHALL present a dashboard with clear scores and expandable recommendations
4. WHEN partial results are available, THE System SHALL clearly indicate analysis coverage and confidence level
5. THE System SHALL auto-scroll progress updates to keep the latest information visible

### Requirement 9: Model Selection and Configuration

**User Story:** As a user, I want to choose which AI model performs the analysis, so that I can experiment with different models and compare their analysis quality.

#### Acceptance Criteria

1. WHEN starting analysis, THE System SHALL display a model selection dropdown with available options
2. THE System SHALL support multiple AWS Bedrock models including Claude, Titan, and Llama
3. WHERE an "Auto" option is selected, THE System SHALL automatically choose the most appropriate model for each dimension
4. WHEN a specific model is selected, THE System SHALL use that model consistently across all dimensions
5. THE System SHALL display the selected model name in the progress updates and final report

### Requirement 10: Context-Aware Analysis

**User Story:** As a documentation analyst, I want the system to analyze related pages (parent, child) when they provide essential context, so that the quality assessment considers the broader documentation structure and dependencies.

#### Acceptance Criteria

1. WHEN analyzing a target page, THE System SHALL identify potential Context_Pages including immediate parent and direct children based on URL structure and internal links
2. WHEN Context_Pages are identified, THE System SHALL display them to the user with clear indication of their relationship to the target page
3. WHERE the user enables context analysis, THE System SHALL fetch and analyze up to 5 additional pages to provide comprehensive context
4. WHEN including Context_Pages, THE System SHALL clearly indicate in the analysis report which pages were analyzed beyond the target URL
5. THE System SHALL limit context expansion to prevent infinite crawling with maximum 1 level up for parent and 1 level down for children
6. WHEN context analysis is enabled, THE AI analysis SHALL consider the broader context when evaluating completeness, accuracy, and clarity
7. THE System SHALL provide a toggle option allowing users to choose between single-page analysis and context-aware analysis
8. WHEN Context_Pages fail to load, THE System SHALL continue with available content and note which Context_Pages were unavailable
9. THE System SHALL display the analysis scope prominently in the UI showing "Analyzing: [target] + [N] context pages"
10. THE System SHALL track and report context analysis metrics including pages analyzed, context relevance, and analysis improvement

### Requirement 11: Intelligent Content Caching

**User Story:** As a system administrator, I want processed content to be cached intelligently using the existing session-based S3 structure, so that repeated analysis of the same documentation pages is faster and more cost-effective.

#### Acceptance Criteria

1. WHEN processing a documentation URL, THE System SHALL check the existing Cache_Index before fetching and processing content
2. WHEN cached content exists and is not expired, THE System SHALL retrieve processed content from the existing session-based S3 storage (e.g., "sessions/session-d3dc80920ce1/processed-content.json")
3. WHEN cached content is expired or content has changed, THE System SHALL re-process the content and update the cache using the existing session structure
4. THE System SHALL continue using the existing S3 path format: "sessions/{sessionId}/processed-content.json"
5. THE System SHALL set cache TTL to 7 days by default for processed content to balance freshness and performance
6. WHEN context analysis is enabled, THE System SHALL cache Context_Pages individually using the existing session-based structure
7. THE System SHALL calculate content hash to detect when documentation content has changed since last processing
8. THE System SHALL track cache performance metrics including hit rate, processing time savings, and storage usage
9. THE System SHALL automatically clean up expired cache entries using TTL functionality
10. THE System SHALL provide cache statistics in CloudWatch metrics for monitoring and optimization

### Requirement 12: Modern Developer-Friendly Interface

**User Story:** As a developer, I want a modern, intuitive interface with clean design and smooth interactions, so that I can efficiently analyze documentation and easily understand the results.

#### Acceptance Criteria

1. THE System SHALL provide a clean, modern interface with professional typography and consistent spacing
2. WHEN displaying analysis results, THE System SHALL use interactive cards with expandable sections for detailed findings
3. THE System SHALL implement smooth animations and transitions for better user experience
4. WHEN showing progress updates, THE System SHALL use modern progress indicators with clear status visualization
5. THE System SHALL organize information with proper visual hierarchy using appropriate font weights, sizes, and colors
6. THE System SHALL provide responsive design that works well on desktop, tablet, and mobile devices
7. WHEN displaying code snippets and technical content, THE System SHALL use syntax highlighting and proper monospace fonts
8. THE System SHALL implement dark/light theme support for developer preference
9. THE System SHALL use consistent color schemes and design tokens throughout the interface
10. THE System SHALL provide keyboard shortcuts and accessibility features for power users

### Requirement 13: AWS Integration and Scalability

**User Story:** As a system administrator, I want the application to leverage AWS services for reliable and scalable analysis, so that it can handle varying loads efficiently.

#### Acceptance Criteria

1. THE System SHALL use AWS Lambda for serverless analysis processing
2. THE System SHALL integrate with AWS Bedrock for multi-model AI-powered quality evaluation
3. WHEN processing requests, THE System SHALL handle timeouts gracefully with a 30-second maximum per dimension
4. THE System SHALL structure prompts for optimal model API performance and accuracy across different model types
5. THE System SHALL return structured JSON responses for consistent data handling


### Requirement 16: Content-Type-Aware Scoring Framework

**User Story:** As a documentation analyst, I want the system to apply different scoring criteria based on the type of documentation being analyzed, so that API references are not penalized for lacking conceptual explanations and overview pages are not penalized for lacking code examples.

#### Acceptance Criteria

1. WHEN processing documentation, THE System SHALL detect the content type using a two-layer approach: keyword matching first, then AI fallback for unclear cases
2. THE System SHALL support content types including api-reference, tutorial, conceptual, how-to, reference, troubleshooting, overview, changelog, and mixed
3. WHEN keyword matching succeeds, THE System SHALL use the detected type without additional AI calls for cost efficiency
4. WHEN keyword matching fails, THE System SHALL use AI classification based on URL, title, and meta description with minimal token usage
5. WHEN applying scoring criteria, THE System SHALL use content-type-specific rubrics with appropriate weights for each criterion
6. WHEN a scoring criterion is not applicable to the content type, THE System SHALL mark it as not-applicable and redistribute the weight to applicable criteria
7. THE System SHALL provide scoring transparency showing which criteria were evaluated, skipped, or redistributed for each content type
8. WHEN displaying results, THE System SHALL explain why certain criteria were not applicable based on the detected content type
9. THE System SHALL store the detected content type in the cache for consistent scoring across repeated analyses
10. WHEN content type detection is uncertain, THE System SHALL default to 'mixed' type and apply balanced scoring criteria that doesn't heavily penalize any document characteristic

## Phase 2 Requirements (Future Enhancements)

**User Story:** As a system administrator, I want periodic quality validation of analysis results using LLM-as-Judge methodology, so that I can monitor and improve the accuracy of the documentation auditor over time.

#### Acceptance Criteria

1. THE System SHALL implement an async background process that runs LLM-as-Judge validation on a sample of completed analyses
2. WHEN validation runs, THE System SHALL use a different AI model than the primary analysis to provide independent evaluation
3. THE System SHALL store validation results separately from user-facing reports for administrative review
4. THE System SHALL calculate consensus scores and identify disagreement areas between primary and validation models
5. THE System SHALL run validation on approximately 10% of analyses or on a configurable schedule such as every 3 hours
6. THE System SHALL provide a dashboard for administrators to review validation results and identify systematic issues
7. THE System SHALL NOT show conflicting scores or validation results to end users
8. WHERE significant disagreements are detected, THE System SHALL flag analyses for manual review by administrators
9. THE System SHALL use validation insights to improve prompts, model selection, and analysis quality over time

**Note:** This requirement is for system quality assurance and monitoring, not for real-time user-facing validation. Results are intended for the application builder/administrator to improve the system.

### Requirement 17: Async LLM-as-Judge Quality Validation

**User Story:** As a user, I want to choose between multiple AI models for analysis, so that I can compare results and select the model that works best for my documentation type.

#### Acceptance Criteria

1. THE System SHALL support Amazon Titan Text Premier for documentation analysis
2. THE System SHALL support Meta Llama 3.1 70B for documentation analysis
3. WHEN a user selects Titan, THE System SHALL use the correct API format including inputText and textGenerationConfig parameters
4. WHEN a user selects Llama, THE System SHALL use the correct API format including prompt and max_gen_len parameters
5. THE System SHALL parse responses correctly for each model's output format, including handling non-JSON responses
6. WHERE Auto-select is chosen, THE System SHALL intelligently select between Claude, Titan, and Llama based on content type
7. THE System SHALL handle model-specific response formats and extract JSON from various response structures

### Requirement 18: Multi-Model Support (Phase 2)
- ✅ Claude 3.5 Sonnet: Fully working with real AI analysis across all 5 dimensions
- ⚠️ Llama 3.1 70B: API format implemented but response parsing needs debugging (returns non-JSON format)
- ⚠️ Titan Text Premier: API format implemented but not yet tested
- 🔧 Auto-select: Disabled until Titan and Llama are working

**Phase 2 Work Required:**
- Debug Llama response format - model may need different prompt structure or response extraction logic
- Test and debug Titan response format and JSON extraction
- Re-enable Auto-select feature once all models are validated
- Add model-specific prompt optimization for better JSON compliance

### Requirement 20: Internal Link Validation

**User Story:** As a documentation analyst, I want to identify broken internal links with exact URLs and status codes, so that I can report specific, verifiable issues for documentation maintenance.

#### Acceptance Criteria

1. WHEN analyzing a page, THE Link_Checker SHALL extract all internal links within the same domain
2. THE Link_Checker SHALL perform HTTP HEAD requests to verify each internal link's accessibility
3. WHEN a link returns 404, THE Link_Checker SHALL report it as broken with: URL, status code, anchor text, source page path
4. WHEN a link returns other 4xx/5xx status, THE Link_Checker SHALL report it as an error with specific status
5. WHEN a link times out (>5 seconds), THE Link_Checker SHALL report it as unreachable
6. THE Link_Checker SHALL process links asynchronously (max 10 simultaneous) to avoid rate limiting
7. THE Link_Checker SHALL skip mailto:, tel:, javascript:, and anchor-only (#) links
8. WHEN link checking completes, THE existing Progress_Streamer SHALL display: "✓ Link check: X broken, Y healthy"
9. THE Link_Checker SHALL integrate with existing linkAnalysis data structure and enhance Completeness dimension scoring

### Requirement 21: Enhanced Language-Agnostic Code Analysis

**User Story:** As a documentation analyst, I want to detect deprecated code and syntax errors in any programming language, so that findings are relevant regardless of the tech stack being documented.

#### Acceptance Criteria

1. WHEN code snippets are extracted, THE Code_Analyzer SHALL enhance existing language detection with LLM-based analysis
2. THE Code_Analyzer SHALL support deprecation detection for all common languages including but not limited to: JavaScript, TypeScript, Python, PHP, Ruby, Go, Java, C#, Rust, Swift
3. WHEN analyzing code, THE Code_Analyzer SHALL use the LLM to identify deprecated methods, functions, or patterns based on its training knowledge of language/framework evolution
4. THE Code_Analyzer SHALL prompt the LLM with: language detected, code snippet, and request to identify deprecated/removed APIs with version information
5. WHEN deprecated code is found, THE Code_Analyzer SHALL report: method/function name, line number within snippet, deprecation version, recommended replacement
6. THE Code_Analyzer SHALL detect framework-specific deprecations (e.g., React lifecycle methods, jQuery patterns, Express.js old APIs)
7. WHEN deprecation is detected, THE Code_Analyzer SHALL provide confidence level (high/medium/low) based on LLM certainty
8. THE Code_Analyzer SHALL use LLM to identify syntax errors by prompting it to parse the code and report any syntax violations
9. WHEN syntax errors are found, THE Code_Analyzer SHALL report: error type, line number within snippet, description, the problematic code fragment
10. THE Code_Analyzer SHALL distinguish between definite syntax errors vs. style issues vs. potential runtime errors
11. THE Code_Analyzer SHALL handle incomplete code snippets gracefully — snippets showing partial code should not trigger false positives
12. THE Code_Analyzer SHALL enhance existing Freshness and Accuracy dimension scoring with detailed findings

### Requirement 22: Critical Findings Integration and Display

**User Story:** As a user, I want to see a clear summary of critical findings (broken links, deprecated code, syntax errors) in the existing dashboard, so that I can quickly assess documentation health without extensive navigation.

#### Acceptance Criteria

1. THE existing dashboard SHALL be enhanced to include a "Critical Findings" section below dimension scores
2. THE Critical Findings section SHALL display high-level counts for: Broken Links, Deprecated Code, Syntax Errors
3. WHEN a finding category has zero issues, THE dashboard SHALL display a green checkmark (✓) with "None found"
4. WHEN findings exist, THE dashboard SHALL display count with warning icon (⚠) and show 1-2 example issues
5. THE dashboard SHALL include "See full report for details" message to encourage report export
6. THE existing dimension scoring SHALL be enhanced to reflect broken links in Completeness, deprecated code in Freshness, and syntax errors in Accuracy
7. THE dashboard SHALL NOT create a new/separate UI — all updates integrate into the existing results view

### Requirement 23: Markdown Report Export

**User Story:** As a user, I want to export a complete Markdown report of the analysis including dimension scores and all findings, so that I can share or reference the results outside of Lensy for outreach and documentation improvement planning.

#### Acceptance Criteria

1. WHEN analysis completes, THE existing dashboard SHALL display an "Export Report" button
2. THE exported report SHALL include: analyzed URL, analysis date, overall score, all dimension scores with breakdowns
3. THE exported report SHALL include all findings: broken links (with URLs and status), deprecated code (with method names and replacements), syntax errors (with line numbers and descriptions)
4. THE exported report SHALL be available in Markdown format with clear sections for each dimension and finding type
5. WHEN export button is clicked, THE System SHALL generate and download the report file as .md
6. THE exported report SHALL be structured for readability with proper Markdown formatting, tables, and code blocks
7. THE exported report SHALL include executive summary suitable for sharing with documentation portal owners

### Requirement 24: Enhanced Progress Streaming for Code and Link Analysis

**User Story:** As a user, I want to see real-time progress during link checking and enhanced code analysis, so that I understand what the system is checking and can track the comprehensive analysis progress.

#### Acceptance Criteria

1. THE existing Progress_Streamer infrastructure SHALL be extended to support link checking and enhanced code analysis updates
2. WHEN link checking begins, THE Progress_Streamer SHALL display "Checking X internal links for accessibility..."
3. WHEN a broken link is found, THE Progress_Streamer SHALL immediately display: "⚠ Broken link: [URL] (404)"
4. WHEN link checking completes, THE Progress_Streamer SHALL display: "✓ Link check complete: X broken, Y healthy"
5. WHEN enhanced code analysis begins, THE Progress_Streamer SHALL display "Analyzing X code snippets for deprecation and syntax..."
6. WHEN a deprecated method is found, THE Progress_Streamer SHALL immediately display: "⚠ Deprecated: [method] in [location]"
7. WHEN a syntax error is found, THE Progress_Streamer SHALL immediately display: "✗ Syntax error: [description] in [location]"
8. WHEN code analysis completes, THE Progress_Streamer SHALL display: "✓ Code analysis complete: X deprecated, Y syntax errors"
9. ALL progress updates SHALL use the existing Progress_Streamer format and WebSocket infrastructure

### Requirement 19: Real-Time WebSocket Progress Streaming

**User Story:** As a user, I want to see live progress updates via WebSocket during analysis, so that I can track real-time progress without polling delays.

#### Acceptance Criteria

1. WHEN analysis starts, THE System SHALL establish a WebSocket connection for real-time progress updates
2. WHEN WebSocket connection fails, THE System SHALL gracefully fallback to polling-based status updates
3. WHEN progress events occur, THE System SHALL stream them immediately via WebSocket with appropriate message types
4. WHEN analysis completes, THE Progress_Streamer SHALL automatically collapse logs while preserving expandable access
5. WHEN cache status is determined, THE System SHALL stream cache HIT/MISS indicators with lightning bolt icons
6. THE System SHALL support WebSocket message types including info, success, error, progress, cache-hit, and cache-miss
7. THE System SHALL provide auto-scroll functionality during active analysis with manual expand/collapse control
8. THE System SHALL maintain WebSocket connections with auto-reconnect capability for reliability
9. THE System SHALL display progress message counts and timestamps for user reference
10. THE System SHALL ensure progress logs don't interfere with results display through smart UI management

**User Story:** As a user, I want to see live progress updates via WebSocket during analysis, so that I can track real-time progress without polling delays.

#### Acceptance Criteria

1. WHEN analysis starts, THE System SHALL establish a WebSocket connection for real-time progress updates
2. WHEN WebSocket connection fails, THE System SHALL gracefully fallback to polling-based status updates
3. WHEN progress events occur, THE System SHALL stream them immediately via WebSocket with appropriate message types
4. WHEN analysis completes, THE Progress_Streamer SHALL automatically collapse logs while preserving expandable access
5. WHEN cache status is determined, THE System SHALL stream cache HIT/MISS indicators with lightning bolt icons
6. THE System SHALL support WebSocket message types including info, success, error, progress, cache-hit, and cache-miss
7. THE System SHALL provide auto-scroll functionality during active analysis with manual expand/collapse control
8. THE System SHALL maintain WebSocket connections with auto-reconnect capability for reliability
9. THE System SHALL display progress message counts and timestamps for user reference
10. THE System SHALL ensure progress logs don't interfere with results display through smart UI management


### Requirement 25: Link Issue Categorization and Reporting

**User Story:** As a documentation analyst, I want to distinguish between truly broken links (404) and other link issues (403, timeouts, errors), so that I can prioritize fixing actual broken pages versus investigating access or network issues.

#### Acceptance Criteria

1. WHEN validating internal links, THE System SHALL categorize issues by type: 404 (broken), 403 (access-denied), timeout, and error
2. WHEN a link returns 404, THE System SHALL report it as a broken link with high priority
3. WHEN a link returns 403, THE System SHALL report it as an access issue with medium priority
4. WHEN a link times out, THE System SHALL report it as a timeout issue with low priority
5. WHEN displaying link issues, THE System SHALL show separate counts for broken links (404) versus other issues
6. THE System SHALL display link issues in the format "Link Issues: X (Y broken)" where X is total issues and Y is 404 count
7. WHEN generating reports, THE System SHALL create separate sections for "Broken Links (404)" and "Other Link Issues"
8. THE System SHALL include issue type information (404, access-denied, timeout, error) in all link findings
9. THE System SHALL deduplicate link issues by URL to ensure each unique link is reported only once
10. THE System SHALL provide clear progress messages distinguishing between broken links and other link issues

### Requirement 26: Cache Control for Testing

**User Story:** As a developer testing the system, I want to disable caching temporarily, so that I can test changes without cache interference and verify fresh analysis behavior.

#### Acceptance Criteria

1. THE System SHALL provide a user-facing toggle to enable or disable caching
2. WHEN caching is disabled, THE System SHALL skip all cache checks for processed content
3. WHEN caching is disabled, THE System SHALL skip all cache checks for dimension analysis results
4. WHEN caching is disabled, THE System SHALL NOT store new results in cache
5. WHEN caching is disabled, THE System SHALL display a warning message indicating testing mode
6. THE System SHALL default caching to enabled for normal operation
7. WHEN caching is enabled, THE System SHALL function normally with full cache read/write operations
8. THE System SHALL send cache control preferences from frontend to backend via API
9. THE System SHALL log cache control status for debugging and monitoring
10. THE System SHALL maintain backward compatibility by defaulting to cache enabled when preference is not specified

### Requirement 27: Compact UI Layout for Configuration Options

**User Story:** As a user, I want configuration options (Context Analysis, Cache Control) displayed side-by-side, so that the interface is more compact and I can see all options without excessive scrolling.

#### Acceptance Criteria

1. THE System SHALL display Context Analysis and Cache Control cards in a side-by-side layout on desktop screens
2. WHEN viewed on mobile devices, THE System SHALL stack configuration cards vertically for readability
3. THE System SHALL ensure both configuration cards have equal heights when displayed side-by-side
4. THE System SHALL maintain consistent spacing and visual hierarchy in the compact layout
5. THE System SHALL preserve all functionality of configuration toggles in the compact layout
6. THE System SHALL use responsive grid layout (50% width each on desktop, 100% on mobile)
7. THE System SHALL ensure configuration cards remain easily accessible and readable in compact layout
8. THE System SHALL maintain visual consistency with the rest of the application design

## Sitemap Journey Mode Requirements

### Requirement 28: Intelligent Input Detection

**User Story:** As a user, I want the input field to automatically detect whether I'm entering a sitemap URL or a doc URL, so that the appropriate analysis mode is triggered without manual selection.

#### Acceptance Criteria

1. WHEN a URL ends with `.xml` or `sitemap.xml`, THE System SHALL detect it as Sitemap_Mode
2. WHEN a URL contains `/sitemap` in the path, THE System SHALL detect it as Sitemap_Mode
3. WHEN a URL does not match sitemap patterns, THE System SHALL use existing Doc_Mode (UNCHANGED)
4. THE System SHALL display a visual indicator showing which mode was detected
5. THE System SHALL allow user to override the detected mode if needed
6. THE System SHALL preserve all existing Doc_Mode functionality without modification
7. THE System SHALL provide clear mode selection UI when input type is ambiguous
8. THE System SHALL default to Doc_Mode for backward compatibility

### Requirement 29: Sitemap Parser and URL Extraction

**User Story:** As a user, I want to provide a sitemap.xml URL so that Lensy can discover all documentation pages automatically for bulk analysis.

#### Acceptance Criteria

1. WHEN a sitemap URL is provided, THE Sitemap_Parser SHALL fetch the XML content
2. THE Sitemap_Parser SHALL extract all `<loc>` URLs from the sitemap
3. THE Sitemap_Parser SHALL handle nested sitemaps (sitemap index files) by following `<sitemap>` references
4. WHEN parsing fails, THE System SHALL display a clear error message with specific failure reason
5. THE Sitemap_Parser SHALL report the total number of URLs found
6. THE Progress_Streamer SHALL display "Parsing sitemap... Found X URLs"
7. THE Sitemap_Parser SHALL validate XML format and handle malformed sitemaps gracefully
8. THE Sitemap_Parser SHALL support both compressed (.xml.gz) and uncompressed sitemap formats
9. THE Sitemap_Parser SHALL extract optional metadata (lastmod, priority) when available
10. THE Sitemap_Parser SHALL limit processing to prevent infinite recursion in nested sitemaps

### Requirement 30: Sitemap Health Check and Link Validation

**User Story:** As a user, I want to see which URLs in the sitemap are broken or inaccessible, so that I can identify site-wide link issues before analyzing content quality.

#### Acceptance Criteria

1. WHEN sitemap is parsed, THE System SHALL check all URLs for accessibility using existing Link_Checker
2. THE Link_Checker SHALL perform HTTP HEAD requests with maximum 10 concurrent connections
3. THE System SHALL categorize URLs as: healthy (2xx), broken (404), access-denied (403), timeout, error (other 4xx/5xx)
4. THE Progress_Streamer SHALL display real-time progress: "Checking URLs: X/Y complete"
5. WHEN a broken link is found, THE Progress_Streamer SHALL immediately display: "⚠ Broken: [URL] (404)"
6. THE System SHALL display a sitemap health summary before journey selection
7. THE System SHALL provide expandable details showing all broken URLs with status codes
8. THE System SHALL skip inaccessible URLs from further analysis to avoid wasted processing
9. THE System SHALL track and report health check performance metrics
10. THE System SHALL handle rate limiting and implement exponential backoff for failed requests

### Requirement 31: Developer Journey Detection and Grouping

**User Story:** As a user, I want Lensy to automatically detect developer journeys from the sitemap URLs, so that I can analyze documentation by user workflow rather than individual pages.

#### Acceptance Criteria

1. WHEN sitemap URLs are available, THE Journey_Detector SHALL group URLs by developer persona + action patterns
2. THE Journey_Detector SHALL detect journeys based on URL patterns, naming conventions, and content analysis
3. EACH journey SHALL have: id, name, persona, action, pages array, estimated completion time
4. THE Journey_Detector SHALL prioritize common developer workflows (getting started, API usage, webhooks, authentication)
5. THE System SHALL display detected journeys with page counts for user selection
6. THE System SHALL allow users to select multiple journeys for analysis
7. THE Journey_Detector SHALL use AI analysis to improve journey detection accuracy when URL patterns are insufficient
8. THE System SHALL provide journey preview showing the sequence of pages in each workflow
9. THE Journey_Detector SHALL handle overlapping pages across multiple journeys appropriately
10. THE System SHALL allow manual journey editing for cases where automatic detection is incomplete

### Requirement 32: Journey Selection and Configuration UI

**User Story:** As a user, I want to select which developer journeys to analyze, so that I can focus on the most important user workflows for my documentation assessment.

#### Acceptance Criteria

1. THE System SHALL display detected journeys as selectable cards with checkboxes
2. EACH journey card SHALL show: name, persona, action, page count, estimated time
3. THE User SHALL be able to select multiple journeys simultaneously
4. THE System SHALL display total pages to be analyzed based on current selection
5. THE System SHALL provide a [ANALYZE SELECTED JOURNEYS] button that is disabled when no journeys are selected
6. THE System SHALL show journey page sequences in expandable preview sections
7. THE System SHALL persist journey selections during the session
8. THE System SHALL provide "Select All" and "Clear All" options for bulk selection
9. THE System SHALL display journey complexity indicators (beginner, intermediate, advanced)
10. THE System SHALL allow filtering journeys by persona type or complexity level

### Requirement 33: Journey-Aware Content Analysis

**User Story:** As a system, I want to provide journey context to the Dimension Analyzer, so that each page is scored considering its role in the complete developer workflow.

#### Acceptance Criteria

1. WHEN analyzing a page within a journey, THE System SHALL add journeyContext to the processed content
2. THE journeyContext SHALL include: journey name, persona, action, step number, total steps, previous/next pages
3. THE Dimension_Analyzer SHALL use journeyContext in analysis prompts (enhancing existing contextAnalysis)
4. THE Dimension_Analyzer SHALL evaluate: "Does this page help the persona complete the action effectively?"
5. THE System SHALL assess workflow continuity between sequential pages in the journey
6. THE System SHALL identify gaps or missing steps that could block workflow completion
7. THE System SHALL evaluate if page complexity matches the target persona's skill level
8. THE System SHALL consider journey context when scoring Relevance and Completeness dimensions
9. THE System SHALL track journey-specific findings separately from general page issues
10. THE System SHALL provide journey-aware recommendations that consider the complete workflow

### Requirement 34: Journey Score Aggregation and Completion Confidence

**User Story:** As a user, I want to see an overall score for each developer journey with completion confidence, so that I can quickly assess if the documentation supports complete workflows effectively.

#### Acceptance Criteria

1. WHEN all pages in a journey are analyzed, THE Journey_Aggregator SHALL combine page scores into a journey score
2. THE Journey_Aggregator SHALL calculate a weighted average of dimension scores across all journey pages
3. THE Journey_Aggregator SHALL calculate a Completion_Confidence percentage (0-100%)
4. THE Completion_Confidence SHALL be reduced by blocking issues (syntax errors, broken links, deprecated code, missing steps)
5. THE Journey_Aggregator SHALL identify and list blocking issues that prevent workflow completion
6. THE System SHALL weight critical pages (getting started, core API calls) more heavily in journey scoring
7. THE Journey_Aggregator SHALL detect workflow gaps where essential steps are missing or unclear
8. THE System SHALL provide confidence breakdown showing factors that increase or decrease completion likelihood
9. THE Journey_Aggregator SHALL generate journey-specific recommendations for improving workflow success
10. THE System SHALL compare journey scores to identify which workflows need the most attention
11. THE System SHALL store journey results in the new Journey_Cache table with session-based S3 paths following the existing pattern: "sessions/{sessionId}/journey-{journeyId}.json"
12. THE System SHALL associate journeys with company names for organizational grouping and analytics

### Requirement 35: Comprehensive Journey Report Generation

**User Story:** As a user, I want a comprehensive report showing sitemap health and journey analysis results, so that I can share findings with stakeholders and prioritize documentation improvements.

#### Acceptance Criteria

1. THE Report SHALL include a Sitemap Health section with URL statistics and broken link details
2. THE Report SHALL include a Journey Analysis section for each selected journey
3. EACH Journey section SHALL show: overall score, completion confidence, page breakdown table, blocking issues
4. THE Report SHALL list all findings with specific locations (page, line number, code snippet)
5. THE Report SHALL be exportable as Markdown with proper formatting and tables
6. THE existing Export Report functionality SHALL be enhanced to support journey reports
7. THE Report SHALL include executive summary suitable for sharing with documentation portal owners
8. THE Report SHALL provide actionable recommendations prioritized by impact on journey completion
9. THE Report SHALL include journey comparison section highlighting best and worst performing workflows
10. THE Report SHALL maintain backward compatibility with existing single-page report format

## Issue Discovery Mode Requirements

### Requirement 36: Online Issue Discovery and Validation

**User Story:** As a user, I want Lensy to discover common developer problems with a documentation portal by searching online discussions, so that I can focus analysis on real-world issues that developers are experiencing.

#### Acceptance Criteria

1. WHEN Issue Discovery Mode is triggered, THE System SHALL search online for common developer problems related to the documentation portal
2. THE System SHALL search multiple sources including Stack Overflow, GitHub issues, developer blogs, and community forums
3. THE System SHALL extract and categorize common issues including: rate limiting, authentication, production deployment, code examples, API usage
4. THE System SHALL present discovered issues to the user with frequency counts and source references
5. THE System SHALL allow users to select which issues to investigate and validate
6. THE System SHALL provide issue descriptions with links to original sources for user reference
7. THE System SHALL filter out resolved or outdated issues by checking publication dates and resolution status
8. THE System SHALL rank issues by frequency and recency to prioritize the most current problems
9. THE System SHALL support manual issue entry for cases where users want to investigate specific problems
10. THE System SHALL maintain a database of common documentation issues for faster discovery

### Requirement 37: Real-Time Issue Validation and Documentation Analysis

**User Story:** As a user, I want Lensy to validate whether discovered issues still exist in the current documentation, so that I only receive reports about current, actionable problems with specific evidence of documentation gaps.

#### Acceptance Criteria

1. WHEN an issue is selected for analysis, THE System SHALL identify relevant documentation pages using pre-curated relatedPages first, then fallback to sitemap search if needed
2. WHEN using sitemap fallback, THE System SHALL search for pages matching issue keywords (e.g., "gmail", "spam", "deliverability" for Gmail spam issue)
3. THE System SHALL analyze each identified page for code examples, implementation guidance, and completeness
4. WHEN a page is found but lacks relevant content, THE System SHALL report this as "Potential Gap - Page exists but missing context"
5. WHEN no relevant pages are found in sitemap, THE System SHALL report this as "Critical Gap - Missing documentation page"
6. WHEN code examples exist, THE System SHALL validate their accuracy, completeness, and production-readiness
7. WHEN code examples are missing, THE System SHALL flag the issue as "Missing implementation examples"
8. THE System SHALL check for cross-references between conceptual documentation and practical implementation guides
9. THE System SHALL validate that error handling, rate limiting, and production considerations are adequately covered
10. THE System SHALL provide real-time validation status: "Issue Confirmed", "Issue Resolved", "Partially Addressed", or "Potential Gap"
11. THE System SHALL generate specific recommendations for addressing confirmed issues and potential gaps
12. THE System SHALL include validation results in the final report with evidence showing which pages were checked and what content is missing
13. THE System SHALL highlight "potential gaps" where developers would search (via AI/web) but find incomplete content
14. THE System SHALL skip issues that appear to have been fully resolved to avoid reporting outdated problems

### Requirement 38: Enhanced Report Generation for Issue Discovery Mode

**User Story:** As a user, I want a comprehensive report showing discovered issues, validation results, and specific recommendations, so that I can prioritize documentation improvements based on real developer pain points and identify potential gaps where developers search but find incomplete content.

#### Acceptance Criteria

1. THE Report SHALL include an Issue Discovery Summary showing all investigated issues and their validation status
2. THE Report SHALL include a Confirmed Issues section with specific documentation gaps and missing examples
3. THE Report SHALL include a Potential Gaps section showing pages that exist but lack relevant content (where developers would search but find incomplete information)
4. THE Report SHALL include a Critical Gaps section showing missing documentation pages that should exist based on developer issues
5. THE Report SHALL include a Resolved Issues section showing problems that have been addressed since online complaints
6. THE Report SHALL provide specific recommendations for each confirmed issue and potential gap with implementation examples
7. THE Report SHALL include sitemap health results as supporting evidence for link-related issues
8. THE Report SHALL reference original sources where issues were discovered for credibility (Stack Overflow, GitHub, Reddit)
9. THE Report SHALL prioritize recommendations by impact on developer success and frequency of complaints
10. THE Report SHALL include code examples and implementation guidance for addressing confirmed issues
11. THE Report SHALL highlight "potential gaps" with evidence showing page title/URL suggests relevance but content is missing
12. THE Report SHALL be exportable in Markdown format suitable for sharing with development teams and executives
13. THE Report SHALL maintain backward compatibility with existing Doc Mode and Sitemap Journey Mode reports
