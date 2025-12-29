# Requirements Document

## Introduction

Lensy is a Documentation Quality Auditor that analyzes developer documentation URLs and produces comprehensive quality reports with specific, actionable recommendations. The system evaluates documentation across five quality dimensions and provides real-time progress feedback during analysis.

## Glossary

- **System**: The Lensy Documentation Quality Auditor application
- **Analyzer**: The component responsible for evaluating documentation quality
- **Progress_Streamer**: The component that provides real-time analysis updates
- **Report_Generator**: The component that creates the final quality dashboard
- **Structure_Detector**: The component that identifies documentation topics and organization
- **Code_Validator**: The component that checks code snippets for syntax and deprecation issues
- **Dimension**: A specific quality aspect being evaluated (Relevance, Freshness, Clarity, Accuracy, Completeness)
- **Model_Selector**: The component that manages AI model selection and configuration
- **Context_Pages**: Related documentation pages (parent, child, sibling) that provide additional context for analysis
- **Cache_Index**: The DynamoDB table that tracks processed content locations and metadata
- **TTL**: Time To Live - the expiration time for cached content entries

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

**User Story:** As a system administrator, I want processed content to be cached intelligently, so that repeated analysis of the same documentation pages is faster and more cost-effective.

#### Acceptance Criteria

1. WHEN processing a documentation URL, THE System SHALL check the Cache_Index before fetching and processing content
2. WHEN cached content exists and is not expired, THE System SHALL retrieve processed content from S3 cache storage
3. WHEN cached content is expired or content has changed, THE System SHALL re-process the content and update the cache
4. THE System SHALL store processed content in S3 with Cache_Index containing URL, content hash, S3 location, and TTL
5. THE System SHALL set cache TTL to 7 days by default for processed content to balance freshness and performance
6. WHEN context analysis is enabled, THE System SHALL cache Context_Pages individually to avoid re-processing shared pages
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
