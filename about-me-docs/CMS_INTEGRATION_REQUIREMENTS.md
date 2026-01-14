# CMS Integration Requirements: Identify Fixes + Apply Fixes

## Introduction

This document extends Lensy's Documentation Quality Auditor with CMS integration capabilities, enabling the system to not only identify documentation issues but also generate and apply fixes directly to content stored in S3 (simulating CMS backend storage). This feature transforms Lensy from an audit-only tool into an ambient AI assistant that can remediate documentation quality issues.

**Target Demo:** CMS Kickoff 2026 (January 13-14, St. Petersburg, Florida)
**Session:** "Enabling ambient AI for Enterprise Content Operations"
**Demo Duration:** ~10 minutes within 25-minute session

## Relationship to Existing Specs

This document extends the existing Lensy specifications:
- **requirements.md**: Requirements 1-19 (current audit functionality)
- **design.md**: Architecture, Lambda patterns, S3 storage conventions
- **tasks.md**: Implementation status and Phase 2 roadmap

New requirements in this document start at **Requirement 20** to avoid conflicts.

### Existing Infrastructure to Leverage
- **S3 Session Storage**: `sessions/{sessionId}/` pattern for all analysis data
- **DynamoDB Caching**: Content hash validation, 7-day TTL
- **WebSocket Streaming**: `wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod`
- **ProgressPublisher**: Utility for real-time progress updates
- **Step Functions**: Orchestration pattern for multi-step workflows
- **Claude 3.5 Sonnet**: Primary AI model via AWS Bedrock

## Glossary (Additions to Existing)

- **Fix_Generator**: The component that generates corrected content based on audit findings
- **Fix_Applicator**: The component that writes corrected content back to S3
- **Content_Source**: S3 bucket containing source documentation files (simulates CMS storage)
- **Fix_Preview**: A preview of proposed changes before application
- **Fix_Diff**: A visual representation of changes between original and fixed content
- **Managed_Docs_Bucket**: S3 bucket where Lensy has read/write access for managed documentation
- **Fix_Session**: A collection of proposed fixes from a single audit that can be applied together or individually

## Architecture Overview

### User Flow (Simple)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Enter URL        │  STEP 2: See Analysis    │  STEP 3: See Fixes   │
│  ────────────────────     │  ─────────────────────   │  ─────────────────   │
│  [docs.example.com/api]   │  Score: 6.2/10          │  ☑ init()→initialize │
│  [Analyze]                │  Freshness: 4/10 ⚠      │  ☑ v2.0 → v3.1       │
│                           │  Accuracy: 5/10 ⚠       │  ☑ Add error handler │
│         EXISTING ✅        │       EXISTING ✅        │       NEW 🆕         │
└─────────────────────────────────────────────────────────────────────────────┘
                                                                │
                                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: Apply Fixes                                                        │
│  ───────────────────                                                        │
│  [Apply Selected Fixes]  →  ✓ Updated S3  →  ✓ CDN Refreshed  →  [View Live]│
│                                        NEW 🆕                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technical Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXISTING LENSY PIPELINE (unchanged)                   │
│                                                                              │
│  URL Input → URLProcessor → StructureDetector → DimensionAnalyzer → Report  │
│                                                                              │
│  Output: Findings like "Uses deprecated auth.login()" (general, not exact)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ triggers
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     NEW: FIX GENERATOR (Separate AI Pass)                    │
│                                                                              │
│  Input:                                                                      │
│    - Full document content (from S3 session)                                │
│    - Findings from DimensionAnalyzer                                        │
│                                                                              │
│  AI Prompt: "For each finding, extract EXACT original text, line numbers,   │
│              and generate EXACT replacement code"                           │
│                                                                              │
│  Output:                                                                     │
│    - Precise fixes with exact text, line numbers, replacements              │
│    - Confidence scores per fix                                              │
│    - Stored in S3: sessions/{sessionId}/fixes.json                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ user approves
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     NEW: FIX APPLICATOR                                      │
│                                                                              │
│  Input: Selected fixes from fixes.json                                      │
│                                                                              │
│  Actions:                                                                    │
│    1. Read source doc from S3 (Managed_Docs_Bucket)                         │
│    2. Apply text replacements                                               │
│    3. Write updated doc back to S3                                          │
│    4. Invalidate CloudFront cache                                           │
│                                                                              │
│  Output: Updated live documentation                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Separate AI Pass for Fix Generation?

| Existing Analysis | Fix Generator (New) |
|-------------------|---------------------|
| Outputs: "Uses deprecated auth.login()" | Outputs: Exact text, line 15-18, replacement code |
| General findings for scoring | Precise data for text replacement |
| Optimized for quality assessment | Optimized for code generation |
| Already working ✅ | New component 🆕 |

This separation keeps existing analysis intact while adding fix capability.

## Demo Environment Setup

### S3 Demo Documentation Structure

```
s3://lensy-demo-docs/
├── getting-started.md          # Clean baseline (no issues)
├── api-reference.md            # Issues: deprecated code, wrong SDK version
├── webhooks.md                 # Issues: broken internal links, outdated endpoints
├── integration-guide.md        # Issues: missing error handling, incomplete code
└── changelog.md                # Clean (for reference)
```

### CloudFront Distribution

- **Domain**: docs-demo.lensy.dev (or CloudFront URL for demo)
- **Origin**: S3 bucket above
- **Cache**: Disabled for demo (immediate updates visible)

---

# MILESTONE 1: IDENTIFY FIXES

## Requirement 20: Fix Generator (Separate AI Pass)

**User Story:** As a documentation maintainer, after seeing analysis results, I want the system to generate precise, actionable fixes for each identified issue, so that I can review and apply them with confidence.

### Context: Why a Separate AI Pass?

The existing DimensionAnalyzer outputs **general findings** like:
- "Uses deprecated auth.login() method"
- "Missing error handling in code example"

But to apply fixes, we need **precise data**:
- Exact original text to replace
- Exact line numbers
- Exact replacement code
- Confidence score

The Fix Generator is a **separate AI call** that takes the findings + full document and extracts this precise information.

### Acceptance Criteria

1. WHEN analysis completes with findings, THE System SHALL enable a "Generate Fixes" action (automatic or user-triggered)
2. THE Fix_Generator SHALL make a separate AI call to Claude 3.5 Sonnet with the full document content and findings list
3. FOR EACH finding, THE Fix_Generator SHALL extract: exact original text, start line, end line, and generate exact replacement text
4. WHEN generating fixes for deprecated code, THE Fix_Generator SHALL provide the correct replacement syntax, not just identify the problem
5. WHEN generating fixes for missing content, THE Fix_Generator SHALL generate the actual missing code/text following document style
6. THE Fix_Generator SHALL assign a confidence score (0-100%) to each fix based on certainty of correctness
7. WHEN confidence is below 70%, THE Fix_Generator SHALL flag the fix for human review with explanation
8. THE Fix_Generator SHALL categorize fixes: CODE_UPDATE, LINK_FIX, CONTENT_ADDITION, VERSION_UPDATE, FORMATTING_FIX
9. THE Fix_Generator SHALL validate that proposed fixes don't break document structure (valid Markdown)
10. WHEN multiple issues overlap in the same code block, THE Fix_Generator SHALL generate a single combined fix
11. THE Fix_Generator SHALL store results in S3 at `sessions/{sessionId}/fixes.json`
12. THE Fix_Generator SHALL stream progress via WebSocket using ProgressPublisher

### Fix Generator Prompt Structure

```
You are a technical documentation editor. Given the document content and identified issues,
generate precise fixes.

DOCUMENT CONTENT:
{full_markdown_content}

IDENTIFIED ISSUES FROM ANALYSIS:
{findings_from_dimension_analyzer}

FOR EACH ISSUE, PROVIDE:
1. original_text: The EXACT text to be replaced (copy from document)
2. line_start: Starting line number
3. line_end: Ending line number  
4. replacement_text: The EXACT corrected text
5. confidence: 0-100 score
6. rationale: Brief explanation
7. category: CODE_UPDATE | LINK_FIX | CONTENT_ADDITION | VERSION_UPDATE | FORMATTING_FIX

Return as JSON array.
```

### Example Input/Output

**Input (from existing analysis):**
```
Finding: "Uses deprecated auth.login() method - should use auth.signIn()"
```

**Output (from Fix Generator):**
```json
{
  "id": "fix_001",
  "original_text": "const result = client.auth.login({\n  email: user.email,\n  password: user.password\n});",
  "line_start": 15,
  "line_end": 18,
  "replacement_text": "const result = client.auth.signIn({\n  email: user.email,\n  password: user.password\n});",
  "confidence": 95,
  "rationale": "auth.login() was renamed to auth.signIn() in v3.0",
  "category": "CODE_UPDATE"
}
```

### Fix Categories and Examples

| Category | Example Issue | Example Fix |
|----------|---------------|-------------|
| CODE_UPDATE | `auth.login()` deprecated | Replace with `auth.signIn()` |
| LINK_FIX | `/api/v2/users` returns 404 | Update to `/api/v3/users` |
| CONTENT_ADDITION | Missing error handling | Add try/catch example |
| VERSION_UPDATE | "SDK v2.0" outdated | Update to "SDK v3.1" |
| FORMATTING_FIX | Code block missing language | Add ```javascript tag |

---

## Requirement 21: Fix Preview and Diff Display

**User Story:** As a documentation maintainer, I want to see a visual diff of proposed changes before applying them, so that I can review and approve fixes with confidence.

### Acceptance Criteria

1. WHEN fixes are generated, THE System SHALL display a side-by-side diff view showing original content and proposed changes
2. WHEN displaying diffs, THE System SHALL highlight additions in green, deletions in red, and modifications in yellow
3. WHEN multiple fixes exist for a document, THE System SHALL allow users to expand/collapse individual fix previews
4. THE System SHALL display the fix category, confidence score, and AI rationale for each proposed fix
5. WHEN code changes are proposed, THE System SHALL use syntax highlighting appropriate to the detected language
6. THE System SHALL provide a "View Full Document" option showing all fixes applied in context
7. WHEN fixes have dependencies (e.g., updating a function name requires updating all call sites), THE System SHALL group related fixes together
8. THE System SHALL allow users to select/deselect individual fixes before applying
9. WHEN a fix is deselected, THE System SHALL recalculate any dependent fixes and warn of potential inconsistencies
10. THE System SHALL provide a summary showing: total fixes, fixes by category, average confidence, and estimated time saved

---

## Requirement 22: Fix Data Model and Storage

**User Story:** As a system component, I need a consistent data structure for fixes, so that fixes can be stored, retrieved, and applied reliably.

### Acceptance Criteria

1. THE System SHALL store fix proposals in S3 at `sessions/{sessionId}/fixes.json` following existing session storage conventions
2. EACH fix object SHALL contain: id, documentUrl, category, originalContent, proposedContent, lineStart, lineEnd, confidence, rationale, dependencies[], status
3. THE System SHALL support fix statuses: PROPOSED, APPROVED, REJECTED, APPLIED, FAILED
4. WHEN fixes are generated, THE System SHALL create a Fix_Session object linking all fixes from a single audit
5. THE System SHALL store the original document hash (using existing content hash logic from DynamoDB caching) to detect if the document changed between fix generation and application
6. WHEN the source document has changed since fix generation, THE System SHALL warn the user and offer to regenerate fixes
7. THE System SHALL support versioning of fix sessions to allow rollback
8. THE System SHALL log all fix generation events with timestamps for audit trail
9. WHEN storing fixes, THE System SHALL include the AI model used and prompt version for reproducibility
10. THE System SHALL enforce a maximum of 50 fixes per document to prevent runaway fix generation

### Fix Data Structure

```typescript
interface Fix {
  id: string;                    // Unique fix identifier
  sessionId: string;             // Parent fix session
  documentUrl: string;           // Source document URL
  documentS3Key: string;         // S3 key for managed docs
  category: FixCategory;         // CODE_UPDATE | LINK_FIX | etc.
  severity: 'critical' | 'major' | 'minor';
  
  // Content
  originalContent: string;       // Exact text being replaced
  proposedContent: string;       // Replacement text
  lineStart: number;             // Starting line in document
  lineEnd: number;               // Ending line in document
  
  // Metadata
  confidence: number;            // 0-100
  rationale: string;             // AI explanation
  dimension: DimensionType;      // Which audit dimension found this
  findingId: string;             // Link to original finding
  
  // Dependencies
  dependencies: string[];        // IDs of related fixes
  conflicts: string[];           // IDs of conflicting fixes
  
  // Status
  status: FixStatus;
  appliedAt?: string;
  appliedBy?: string;
  errorMessage?: string;
}

interface FixSession {
  sessionId: string;
  documentUrl: string;
  documentHash: string;          // Hash when fixes were generated
  createdAt: string;
  fixes: Fix[];
  summary: {
    totalFixes: number;
    byCategory: Record<FixCategory, number>;
    bySeverity: Record<string, number>;
    averageConfidence: number;
    estimatedTimeSaved: string;  // e.g., "2.5 hours"
  };
}
```

---

## Requirement 23: AI-Powered Fix Generation

**User Story:** As the system, I need to use AI effectively to generate accurate, contextual fixes that match the document's style and technical requirements.

### Acceptance Criteria

1. WHEN generating fixes, THE Fix_Generator SHALL use Claude 3.5 Sonnet via AWS Bedrock (consistent with existing dimension analysis)
2. THE Fix_Generator SHALL include the full document context (up to 8000 tokens) when generating fixes to ensure consistency
3. WHEN generating code fixes, THE Fix_Generator SHALL verify the fix compiles/parses correctly before proposing
4. THE Fix_Generator SHALL detect the document's style (formal/informal, technical level) and match generated content accordingly
5. WHEN fixing deprecated APIs, THE Fix_Generator SHALL reference the official deprecation notice and migration guide if available
6. THE Fix_Generator SHALL avoid over-fixing by only addressing issues identified in the audit (no scope creep)
7. WHEN multiple valid fixes exist, THE Fix_Generator SHALL choose the most conservative option that solves the issue
8. THE Fix_Generator SHALL include code comments explaining non-obvious changes when appropriate
9. WHEN generating content additions, THE Fix_Generator SHALL follow the existing heading hierarchy and formatting conventions
10. THE Fix_Generator SHALL track token usage and estimated cost for transparency (consistent with existing cost tracking)

### Fix Generation Prompt Structure

```
System: You are a technical documentation editor. Generate precise fixes for identified issues.

Rules:
1. Preserve original document structure and tone
2. Make minimal changes to fix the issue
3. Include rationale for each fix
4. Flag uncertainty with confidence scores
5. Never introduce new issues

Document Context:
{full_document_content}

Issues to Fix:
{findings_from_audit}

For each issue, provide:
- Original text (exact match)
- Fixed text
- Line numbers
- Confidence (0-100)
- Rationale
- Category
```

---

# MILESTONE 2: APPLY FIXES

## Requirement 24: S3 Write-Back Capability

**User Story:** As a documentation maintainer, I want to apply approved fixes directly to documentation stored in S3, so that I can update content without manual copying and pasting.

### Acceptance Criteria

1. WHEN the user clicks "Apply Fix", THE Fix_Applicator SHALL write the updated content to the S3 Managed_Docs_Bucket
2. BEFORE applying fixes, THE Fix_Applicator SHALL verify the document hash matches the original (using existing content hash logic) to prevent overwriting concurrent changes
3. WHEN hash mismatch is detected, THE System SHALL abort the apply operation and prompt user to regenerate fixes
4. THE Fix_Applicator SHALL create a backup of the original document at `backups/{documentKey}/{timestamp}.md` before applying changes
5. WHEN applying multiple fixes to the same document, THE Fix_Applicator SHALL apply them in reverse line-order to preserve line numbers
6. THE Fix_Applicator SHALL validate the resulting document is valid Markdown after applying fixes
7. WHEN fix application fails, THE Fix_Applicator SHALL rollback to the backup and report the error
8. THE System SHALL update the fix status to APPLIED or FAILED after each application attempt
9. WHEN all fixes for a document are applied, THE System SHALL update the document's last-modified metadata
10. THE Fix_Applicator SHALL support batch application of all approved fixes in a session with a single click
11. THE Fix_Applicator SHALL stream progress updates via WebSocket using existing ProgressPublisher utility
12. THE Fix_Applicator SHALL invalidate the DynamoDB cache entry for the modified document URL

---

## Requirement 25: CloudFront Cache Invalidation

**User Story:** As a documentation maintainer, I want applied fixes to be immediately visible on the documentation site, so that I can verify the changes without waiting for cache expiration.

### Acceptance Criteria

1. AFTER successful fix application, THE System SHALL create a CloudFront invalidation for the updated document path
2. THE System SHALL batch invalidations when multiple documents are updated in a single session
3. WHEN invalidation is created, THE System SHALL display the invalidation ID and estimated completion time
4. THE System SHALL poll invalidation status and notify the user when content is live
5. WHEN invalidation fails, THE System SHALL retry up to 3 times with exponential backoff
6. THE System SHALL track invalidation costs and display them in the session summary
7. FOR demo purposes, THE System SHALL support disabling CloudFront caching entirely for immediate visibility
8. THE System SHALL provide a "View Live" button that opens the CloudFront URL after invalidation completes
9. WHEN cache invalidation is not required (caching disabled), THE System SHALL skip this step and proceed directly to verification
10. THE System SHALL log all invalidation events for troubleshooting

---

## Requirement 26: Fix Application UI Flow

**User Story:** As a documentation maintainer, I want a clear, guided workflow for reviewing and applying fixes, so that I can efficiently process multiple fixes with confidence.

### Acceptance Criteria

1. AFTER audit completes, THE System SHALL display a "Review Fixes" button if fixes were generated
2. WHEN entering fix review mode, THE System SHALL display fixes grouped by document, then by category
3. THE System SHALL provide "Select All", "Deselect All", and "Select High Confidence Only (>80%)" bulk actions
4. WHEN a fix is selected, THE System SHALL show a detailed preview with diff view
5. THE System SHALL display a running count of selected fixes and estimated changes
6. WHEN user clicks "Apply Selected Fixes", THE System SHALL show a confirmation dialog with summary
7. DURING fix application, THE System SHALL display real-time progress via WebSocket (consistent with existing progress streaming)
8. AFTER all fixes are applied, THE System SHALL display a success summary with links to view updated documents
9. WHEN some fixes fail, THE System SHALL clearly indicate which succeeded and which failed with reasons
10. THE System SHALL provide an "Undo All" option within 5 minutes of application that restores backups

### UI Flow Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Audit Report  │────▶│   Review Fixes  │────▶│  Confirm Apply  │
│   (existing)    │     │   (diff view)   │     │   (summary)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  View Updated   │◀────│    Success      │◀────│   Applying...   │
│   Docs (live)   │     │    Summary      │     │   (progress)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## Requirement 27: Demo Mode and Sample Documentation

**User Story:** As a presenter at CMS Kickoff 2026, I need a reliable demo environment with pre-configured sample documentation containing known issues, so that I can demonstrate the full audit-to-fix workflow.

### Acceptance Criteria

1. THE System SHALL include a "Demo Mode" toggle that uses pre-configured S3 bucket and CloudFront distribution
2. WHEN Demo Mode is enabled, THE System SHALL use the `lensy-demo-docs` S3 bucket with known issues
3. THE Demo documentation SHALL include at least 4 documents: getting-started.md (clean), api-reference.md (deprecated code), webhooks.md (broken links), integration-guide.md (missing content)
4. WHEN Demo Mode is active, THE System SHALL display a "DEMO" badge in the UI
5. THE System SHALL provide a "Reset Demo" button that restores all demo documents to their original state with known issues
6. WHEN resetting demo, THE System SHALL copy original documents from `demo-originals/` to the main bucket
7. THE Demo documentation SHALL be themed around a fictional "Ambient AI SDK" to match the presentation topic
8. THE System SHALL include a demo script document with suggested flow and talking points
9. WHEN Demo Mode is active, THE System SHALL skip authentication and use demo credentials
10. THE System SHALL log demo usage separately for analytics

---

## Requirement 28: IAM and Security Configuration

**User Story:** As a system administrator, I need the CMS integration to have appropriate AWS permissions, so that the system can read/write documentation securely.

### Acceptance Criteria

1. THE System SHALL use a dedicated IAM role for S3 write operations separate from the read-only analysis role
2. THE Fix_Applicator Lambda SHALL have PutObject, GetObject, and DeleteObject permissions only on the Managed_Docs_Bucket
3. THE System SHALL use S3 bucket policies to restrict write access to the Fix_Applicator role only
4. THE System SHALL enable S3 versioning on the Managed_Docs_Bucket for recovery
5. THE System SHALL log all S3 write operations to CloudWatch for audit (consistent with existing CloudWatch logging)
6. WHEN applying fixes, THE System SHALL validate the user has appropriate permissions (for future multi-tenant support)
7. THE System SHALL encrypt all documents at rest using S3 SSE-S3
8. THE System SHALL enforce HTTPS for all S3 and CloudFront access
9. FOR demo purposes, THE System SHALL use simplified IAM policies but document production requirements
10. THE System SHALL include IAM policy templates in the deployment documentation

---

# Implementation Tasks

## Summary: What We're Building

```
EXISTING (no changes):     URL → Analyze → Findings (general)
                                              │
NEW (Milestone 1):                            ▼
                           Findings + Doc → Fix Generator (AI pass) → Precise Fixes
                                                                          │
NEW (Milestone 2):                                                        ▼
                           Selected Fixes → Fix Applicator → S3 → CDN → Live!
```

## Alignment with Existing Architecture

New Lambda functions should follow existing patterns:
- **Lambda Structure**: Same as `url-processor`, `dimension-analyzer`, etc.
- **S3 Storage**: Use `sessions/{sessionId}/` prefix
- **Progress Streaming**: Use existing `ProgressPublisher` from shared layer
- **Error Handling**: Follow existing graceful degradation patterns
- **CDK Deployment**: Add to existing `backend/lib/lensy-stack.ts`

---

## Phase 1: Milestone 1 - Identify Fixes

### Task 1.1: Fix Generator Lambda (Separate AI Pass)
**This is the core new component - a second AI call after analysis**

- [ ] Create `backend/lambda/fix-generator/index.ts`
- [ ] Read inputs from S3:
  - `sessions/{sessionId}/processed-content.json` (full document)
  - `sessions/{sessionId}/dimension-results.json` (findings)
- [ ] Build AI prompt that includes:
  - Full document content
  - List of findings from dimension analysis
  - Instructions to extract EXACT text, line numbers, replacements
- [ ] Parse AI response into structured Fix objects
- [ ] Validate fixes (check line numbers exist, text matches document)
- [ ] Store fixes in S3 at `sessions/{sessionId}/fixes.json`
- [ ] Integrate ProgressPublisher for real-time streaming
- **Requirements:** 20.1-20.12

### Task 1.2: Trigger Fix Generation from UI
- [ ] Add "Generate Fixes" button to results page (after analysis completes)
- [ ] Or: Auto-trigger fix generation after analysis (configurable)
- [ ] Call new API endpoint: `POST /generate-fixes/{sessionId}`
- [ ] Show loading state while Fix Generator runs
- **Requirements:** 20.1, 20.2

### Task 1.3: Fix Preview UI Component
- [ ] Create `frontend/src/components/FixReviewPanel.tsx`
- [ ] Display list of fixes with:
  - Category badge (CODE_UPDATE, LINK_FIX, etc.)
  - Confidence score (color-coded: green >80%, yellow 70-80%, red <70%)
  - Checkbox to select/deselect
- [ ] Implement diff view showing original vs replacement
- [ ] Add "Select All High Confidence" bulk action
- [ ] Show summary: total fixes, by category, average confidence
- **Requirements:** 21.1-21.10

### Task 1.4: Fix Data Model
- [ ] Define TypeScript interfaces in `backend/lambda-layers/shared/types.ts`:
  ```typescript
  interface Fix {
    id: string;
    category: 'CODE_UPDATE' | 'LINK_FIX' | 'CONTENT_ADDITION' | 'VERSION_UPDATE' | 'FORMATTING_FIX';
    original_text: string;
    replacement_text: string;
    line_start: number;
    line_end: number;
    confidence: number;
    rationale: string;
    status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'FAILED';
  }
  ```
- [ ] Add to CDK: API Gateway route for `/generate-fixes/{sessionId}`
- **Requirements:** 22.1-22.10

---

## Phase 2: Milestone 2 - Apply Fixes

### Task 2.1: Fix Applicator Lambda
- [ ] Create `backend/lambda/fix-applicator/index.ts`
- [ ] Read source document from Managed_Docs_Bucket (S3)
- [ ] Verify document hasn't changed (compare content hash)
- [ ] Create backup at `backups/{docPath}/{timestamp}.md`
- [ ] Apply fixes in reverse line order (preserve line numbers)
- [ ] Validate result is valid Markdown
- [ ] Write updated document back to S3
- [ ] Invalidate DynamoDB cache for this URL
- [ ] Stream progress via ProgressPublisher
- **Requirements:** 24.1-24.12

### Task 2.2: CloudFront Cache Invalidation
- [ ] Add CloudFront invalidation after S3 write
- [ ] Create "View Live" button with CloudFront URL
- [ ] For demo: disable caching for instant visibility
- **Requirements:** 25.1-25.10

### Task 2.3: Apply Fixes UI Flow
- [ ] Add "Apply Selected Fixes" button in FixReviewPanel
- [ ] Show confirmation dialog with summary
- [ ] Display real-time progress during application
- [ ] Show success/failure for each fix
- [ ] Add "Undo" option (restore from backup)
- **Requirements:** 26.1-26.10

---

## Phase 3: Demo Environment

### Task 3.1: S3 Demo Bucket
- [ ] Create `lensy-demo-docs` bucket via CDK
- [ ] Upload demo docs (api-reference.md, webhooks.md, etc.)
- [ ] Store originals in `demo-originals/` for reset
- [ ] Enable versioning
- **Requirements:** 27.1-27.10

### Task 3.2: CloudFront for Demo
- [ ] Create distribution pointing to demo bucket
- [ ] Disable caching for demo

### Task 3.3: Demo Mode UI
- [ ] Add "Demo Mode" toggle
- [ ] Add "Reset Demo" button
- [ ] Show "DEMO" badge when active
- **Requirements:** 27.1-27.10

### Task 3.4: IAM for Fix Applicator
- [ ] Create IAM role with S3 read/write on demo bucket
- [ ] Add CloudFront invalidation permissions
- **Requirements:** 28.1-28.10

---

# Correctness Properties (Continuing from Existing)

Properties 1-18 are defined in the main `design.md`. These extend the property set:

### Property 19: Fix Generation Accuracy
*For any* finding identified during audit, the Fix_Generator should produce a fix that directly addresses the finding without introducing new issues, and the proposed content should be valid syntax/markdown.
**Validates: Requirements 20.1-20.6, 23.3-23.4**

### Property 20: Fix Application Atomicity
*For any* fix application operation, either all changes are applied successfully and the document is updated, or the operation fails completely and the document remains unchanged (backed up and restored).
**Validates: Requirements 24.3-24.7**

### Property 21: Fix Independence
*For any* set of fixes on a single document without declared dependencies, applying them in any order should produce the same final document content.
**Validates: Requirements 20.7, 22.6**

### Property 22: Demo Environment Isolation
*For any* operation in Demo Mode, changes should only affect the demo S3 bucket and should be fully resettable to original state.
**Validates: Requirements 27.1-27.6**

### Property 23: Cache Invalidation After Fix
*For any* document modified by Fix_Applicator, the DynamoDB cache entry for that URL should be invalidated, forcing fresh analysis on next request.
**Validates: Requirements 24.12**

---

# Test Scenarios

## Scenario 1: Basic Fix Generation
1. Analyze `api-reference.md` with deprecated code
2. Verify fixes are generated for deprecated methods
3. Verify fix preview shows correct diff
4. Verify confidence scores are reasonable (>70% for clear cases)

## Scenario 2: Fix Application
1. Generate fixes for `api-reference.md`
2. Select all high-confidence fixes
3. Apply fixes
4. Verify document updated in S3
5. Verify CloudFront shows updated content
6. Verify backup was created

## Scenario 3: Conflict Detection
1. Modify `api-reference.md` directly in S3
2. Attempt to apply previously generated fixes
3. Verify hash mismatch detected
4. Verify user prompted to regenerate fixes

## Scenario 4: Demo Reset
1. Apply fixes to demo documents
2. Click "Reset Demo"
3. Verify all documents restored to original state with known issues

---

# Appendix: Demo Documentation Files

These are the sample documentation files to upload to the `lensy-demo-docs` S3 bucket. They contain intentional issues for demonstrating the fix generation and application workflow.

---

## File: getting-started.md (Clean Baseline - No Issues)

```markdown
# Getting Started with Ambient AI

> Set up documentation quality monitoring in under 5 minutes

## What is Ambient AI?

Ambient AI is an intelligent documentation quality auditor that continuously monitors your developer documentation for issues like:

- **Outdated code examples** - Deprecated APIs, wrong SDK versions
- **Broken links** - Internal and external link validation
- **Missing content** - Incomplete error handling, missing examples
- **Clarity issues** - Readability, code documentation, structure

Unlike traditional documentation tools, Ambient AI runs continuously in the background, providing real-time guidance without disrupting your workflow.

---

## Quick Start

### Step 1: Create an Account

Sign up at [ambient-ai.dev/signup](https://ambient-ai.dev/signup) and get your API key from the dashboard.

### Step 2: Install the SDK

Choose your preferred language:

**Node.js:**
\`\`\`bash
npm install ambient-ai-sdk
\`\`\`

**Python:**
\`\`\`bash
pip install ambient-ai-sdk
\`\`\`

### Step 3: Run Your First Analysis

**Node.js:**
\`\`\`javascript
const { AmbientClient } = require('ambient-ai-sdk');

const client = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});

async function analyzeDocumentation() {
  try {
    const result = await client.analyze('https://docs.example.com/api');
    
    console.log(\`Quality Score: \${result.score}/10\`);
    console.log(\`Issues Found: \${result.findings.length}\`);
    
    // Display findings
    result.findings.forEach(finding => {
      console.log(\`- [\${finding.severity}] \${finding.message}\`);
    });
  } catch (error) {
    console.error('Analysis failed:', error.message);
  }
}

analyzeDocumentation();
\`\`\`

**Python:**
\`\`\`python
import os
from ambient_ai import AmbientClient

client = AmbientClient(
    api_key=os.environ.get('AMBIENT_API_KEY')
)

def analyze_documentation():
    try:
        result = client.analyze('https://docs.example.com/api')
        
        print(f"Quality Score: {result.score}/10")
        print(f"Issues Found: {len(result.findings)}")
        
        # Display findings
        for finding in result.findings:
            print(f"- [{finding.severity}] {finding.message}")
    except Exception as error:
        print(f"Analysis failed: {error}")

analyze_documentation()
\`\`\`

---

## Understanding Your Results

After analysis, you'll receive a quality report with:

### Quality Score (0-10)

| Score | Rating | Action |
|-------|--------|--------|
| 8-10 | Excellent | Minor tweaks only |
| 6-7 | Good | Address high-priority issues |
| 4-5 | Fair | Review and fix critical issues |
| 0-3 | Needs Work | Significant updates required |

### Quality Dimensions

Your documentation is evaluated across five dimensions:

1. **Relevance** - Does it address real developer needs?
2. **Freshness** - Are code examples current?
3. **Clarity** - Is it easy to understand?
4. **Accuracy** - Are code examples correct?
5. **Completeness** - Is everything covered?

---

## Next Steps

Now that you've run your first analysis:

1. **[Set up CI/CD integration](./integration-guide.md)** - Automate quality checks
2. **[Configure webhooks](./webhooks.md)** - Get real-time notifications
3. **[Explore the API](./api-reference.md)** - Full SDK documentation

---

## Getting Help

- **Documentation**: [docs.ambient-ai.dev](https://docs.ambient-ai.dev)
- **Community**: [Discord](https://discord.gg/ambient-ai)
- **Support**: [support@ambient-ai.dev](mailto:support@ambient-ai.dev)
```

---

## File: api-reference.md (6 Issues: Deprecated Code, Outdated Versions)

```markdown
# Ambient AI SDK - API Reference

> Build intelligent documentation assistants with the Ambient AI SDK

## Installation

\`\`\`bash
npm install ambient-ai-sdk@2.0.0
\`\`\`

**Note:** This guide covers SDK version 2.0. See changelog for updates.

---

## Authentication

Initialize the SDK with your API key:

\`\`\`javascript
// Initialize the Ambient AI client
const client = ambientAI.init({
  apiKey: process.env.AMBIENT_API_KEY,
  version: '2.0',
  region: 'us-east-1'
});

// Verify connection
client.ping();
\`\`\`

### API Key Management

Store your API key securely. Never commit it to version control.

\`\`\`python
import os
from ambient_ai import AmbientClient

# RECOMMENDED: Use environment variables
client = AmbientClient(
    api_key=os.environ.get('AMBIENT_API_KEY'),
    timeout=30
)
\`\`\`

---

## Core Methods

### analyze(url)

Analyzes documentation at the specified URL.

\`\`\`javascript
// Analyze a documentation page
const result = client.analyze('https://docs.example.com/api');

// Access findings
console.log(result.findings);
console.log(result.score);
\`\`\`

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | string | Yes | Documentation URL to analyze |
| options | object | No | Analysis options |

**Returns:** \`AnalysisResult\` object

---

### generateFix(finding)

Generates a fix for an identified issue.

\`\`\`javascript
// Generate fix for a finding
const fix = client.generateFix(finding);

// Preview the fix
console.log(fix.original);
console.log(fix.proposed);
console.log(fix.confidence);
\`\`\`

---

### applyFixes(fixes)

Applies approved fixes to source documents.

\`\`\`python
# Apply all high-confidence fixes
approved = [f for f in fixes if f.confidence > 0.8]
result = client.applyFixes(approved)

print(f"Applied {result.success_count} fixes")
\`\`\`

---

## Error Handling

The SDK throws typed errors for different failure scenarios.

\`\`\`javascript
const { AmbientError, RateLimitError } = require('ambient-ai-sdk');

const result = client.analyze(url);
console.log(result);
\`\`\`

### Error Types

| Error | Code | Description |
|-------|------|-------------|
| \`AuthenticationError\` | 401 | Invalid API key |
| \`RateLimitError\` | 429 | Too many requests |
| \`ValidationError\` | 400 | Invalid parameters |

---

## Changelog

### v2.0.0 (2024-06-01)
- Initial release
- Added \`analyze()\` method
- Added \`generateFix()\` method

### v2.1.0 (2024-09-01)
- Added batch analysis
- Improved error messages

### v3.0.0 (2025-01-01)
- **BREAKING:** Renamed \`init()\` to \`initialize()\`
- **BREAKING:** Renamed \`ping()\` to \`healthCheck()\`
- Added streaming support
- Updated authentication flow

---

## Support

- Documentation: https://docs.ambient-ai.dev
- GitHub Issues: https://github.com/ambient-ai/sdk/issues
- Email: support@ambient-ai.dev
```

**Issues in api-reference.md:**
| Line | Issue | Category | Expected Fix |
|------|-------|----------|--------------|
| 8 | `ambient-ai-sdk@2.0.0` pinned to old version | VERSION_UPDATE | Remove version pin or update to @3.1.0 |
| 21 | `ambientAI.init()` deprecated | CODE_UPDATE | Change to `ambientAI.initialize()` |
| 23 | `version: '2.0'` outdated | VERSION_UPDATE | Change to `version: '3.1'` |
| 28 | `client.ping()` deprecated | CODE_UPDATE | Change to `client.healthCheck()` |
| 54-60 | Missing error handling | CONTENT_ADDITION | Add try/catch block |
| 93-96 | Missing error handling (Python) | CONTENT_ADDITION | Add try/except block |

---

## File: webhooks.md (5 Issues: Broken Links, Outdated Endpoint)

```markdown
# Webhooks Integration Guide

> Receive real-time notifications when documentation events occur

## Overview

Webhooks allow your application to receive automatic notifications when events happen in your Ambient AI workspace. Instead of polling for updates, your server receives HTTP POST requests with event data.

---

## Setting Up Webhooks

### Step 1: Create a Webhook Endpoint

Your server must accept POST requests at a publicly accessible URL.

\`\`\`javascript
// Express.js webhook handler
app.post('/webhooks/ambient', (req, res) => {
  const event = req.body;
  
  switch(event.type) {
    case 'analysis.complete':
      handleAnalysisComplete(event);
      break;
    case 'fix.applied':
      handleFixApplied(event);
      break;
  }
  
  res.status(200).send('OK');
});
\`\`\`

### Step 2: Register Your Webhook

Use the dashboard or API to register your endpoint.

\`\`\`bash
curl -X POST https://api.ambient-ai.dev/v2/webhooks \
  -H "Authorization: Bearer \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhooks/ambient",
    "events": ["analysis.complete", "fix.applied"]
  }'
\`\`\`

For API details, see the [API Reference](/docs/api-reference).

---

## Webhook Security

### Signature Verification

All webhook requests include a signature header for verification.

\`\`\`javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return signature === \`sha256=\${expected}\`;
}
\`\`\`

For more security best practices, see our [Security Guide](/docs/security-best-practices).

---

## Retry Policy

Failed webhook deliveries are retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts, the webhook is disabled. Re-enable it from the [Dashboard](/dashboard/webhooks).

---

## Related Documentation

- [API Reference](/docs/api-reference)
- [Authentication Guide](/docs/authentication)
- [Error Codes](/docs/error-codes)
- [Rate Limiting](/docs/rate-limits)
```

**Issues in webhooks.md:**
| Line | Issue | Category | Expected Fix |
|------|-------|----------|--------------|
| 40 | `/v2/webhooks` outdated endpoint | CODE_UPDATE | Change to `/v3/webhooks` |
| 49 | `/docs/api-reference` may not resolve | LINK_FIX | Verify/fix link |
| 73 | `/docs/security-best-practices` broken | LINK_FIX | Create page or update link |
| 88 | `/dashboard/webhooks` internal link | LINK_FIX | Use external URL |
| 93-96 | Internal doc links may not resolve | LINK_FIX | Verify all links |

---

## File: integration-guide.md (6 Issues: Missing Error Handling)

```markdown
# Integration Guide

> Integrate Ambient AI into your documentation workflow

## Quick Start

### 1. Install the SDK

\`\`\`bash
npm install ambient-ai-sdk
\`\`\`

### 2. Initialize the Client

\`\`\`javascript
const { AmbientClient } = require('ambient-ai-sdk');

const client = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});
\`\`\`

### 3. Analyze Your First Document

\`\`\`javascript
const result = client.analyze('https://docs.yoursite.com/api');
console.log(\`Quality Score: \${result.score}/10\`);
console.log(\`Issues Found: \${result.findings.length}\`);
\`\`\`

---

## CI/CD Integration

### GitHub Actions

\`\`\`yaml
name: Documentation Quality Check

on:
  push:
    paths:
      - 'docs/**'

jobs:
  quality-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run Quality Analysis
        run: node scripts/analyze-docs.js
        env:
          AMBIENT_API_KEY: \${{ secrets.AMBIENT_API_KEY }}
\`\`\`

Analysis script:

\`\`\`javascript
// scripts/analyze-docs.js
const { AmbientClient } = require('ambient-ai-sdk');

const client = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});

const docsUrl = 'https://docs.yoursite.com';
const result = client.analyze(docsUrl);

if (result.score < 7) {
  console.error('Documentation quality below threshold!');
  process.exit(1);
}
\`\`\`

---

## CMS Integration

### Contentful

\`\`\`javascript
// Contentful webhook handler
const { AmbientClient } = require('ambient-ai-sdk');

const client = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});

exports.handler = async (event) => {
  const payload = JSON.parse(event.body);
  const docUrl = \`https://docs.yoursite.com/\${payload.fields.slug}\`;
  const result = client.analyze(docUrl);
  console.log(result);
  return { statusCode: 200 };
};
\`\`\`

### Sanity

\`\`\`javascript
import { createClient } from '@sanity/client';
import { AmbientClient } from 'ambient-ai-sdk';

const sanityClient = createClient({
  projectId: 'your-project-id',
  dataset: 'production'
});

const ambientClient = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});

sanityClient.listen('*[_type == "documentation"]').subscribe((update) => {
  const docUrl = \`https://docs.yoursite.com/\${update.result.slug.current}\`;
  const result = ambientClient.analyze(docUrl);
  console.log(result);
});
\`\`\`

---

## Continuous Monitoring

\`\`\`javascript
const { AmbientClient } = require('ambient-ai-sdk');
const cron = require('node-cron');

const client = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});

const pages = [
  'https://docs.yoursite.com/api',
  'https://docs.yoursite.com/guides/getting-started'
];

cron.schedule('0 6 * * *', () => {
  pages.forEach(url => {
    const result = client.analyze(url);
    if (result.score < 7) {
      console.log(\`Alert: \${url} score dropped to \${result.score}\`);
    }
  });
});
\`\`\`

---

## Applying Fixes Automatically

\`\`\`javascript
const { AmbientClient } = require('ambient-ai-sdk');

const client = new AmbientClient({
  apiKey: process.env.AMBIENT_API_KEY
});

const result = client.analyze('https://docs.yoursite.com/api');

const autoFixes = result.fixes.filter(f => f.confidence > 0.9);
const applied = client.applyFixes(autoFixes);
console.log(\`Applied \${applied.length} fixes\`);
\`\`\`
```

**Issues in integration-guide.md:**
| Line | Issue | Category | Expected Fix |
|------|-------|----------|--------------|
| 24-27 | Missing error handling in Quick Start | CONTENT_ADDITION | Add try/catch |
| 55-62 | Missing error handling in CI script | CONTENT_ADDITION | Add try/catch |
| 73-79 | Missing error handling in Contentful | CONTENT_ADDITION | Add try/catch |
| 93-98 | Missing error handling in Sanity | CONTENT_ADDITION | Add try/catch |
| 114-122 | Missing error handling in cron job | CONTENT_ADDITION | Add try/catch |
| 132-138 | Missing error handling in auto-apply | CONTENT_ADDITION | Add try/catch |

---

## Demo Issues Summary

| Document | Issues | Categories |
|----------|--------|------------|
| getting-started.md | 0 | (Clean baseline) |
| api-reference.md | 6 | CODE_UPDATE, VERSION_UPDATE, CONTENT_ADDITION |
| webhooks.md | 5 | LINK_FIX, CODE_UPDATE |
| integration-guide.md | 6 | CONTENT_ADDITION |
| **Total** | **17** | |

---

## Demo Script

### Recommended Flow

1. **Show clean doc first**: Analyze `getting-started.md` → High score, no fixes needed
2. **Show problematic doc**: Analyze `api-reference.md` → Lower score, 6 fixes generated
3. **Preview fixes**: Show diff view with deprecated `init()` → `initialize()`
4. **Apply fixes**: Click apply, show S3 update, CloudFront invalidation
5. **Verify live**: Refresh CloudFront URL, show corrected code
6. **Reset for next demo**: Click "Reset Demo" to restore original files

### Key Talking Points

- "Lensy detected that `init()` was renamed to `initialize()` in version 3.0"
- "The fix has 92% confidence - high enough for auto-application"  
- "One click updates your CMS and refreshes the CDN"
- "This integrates with any headless CMS that stores content in S3"
