# Lensy Enhancement: Sitemap + Developer Journey Mode

## Introduction

This document specifies a new **Sitemap + Developer Journey Mode** for Lensy. This mode enables bulk documentation audits by parsing a sitemap, checking all URLs for accessibility, and then analyzing selected developer journeys for quality and completion confidence.

**Important**: The existing **Doc Mode** (single URL analysis) remains unchanged. This enhancement adds a new entry point that reuses existing backend components.

---

## Glossary

| Term | Definition |
|------|------------|
| **Sitemap Mode** | New input mode that accepts sitemap.xml URLs |
| **Doc Mode** | Existing input mode that accepts single doc URLs (UNCHANGED) |
| **Journey** | A sequence of pages a developer follows to complete an action |
| **Persona** | The type of developer (e.g., "Node.js Developer") |
| **Action** | The goal the developer wants to achieve (e.g., "Send first email") |
| **Completion Confidence** | Likelihood (%) that a developer can complete the action following the docs |
| **Journey Aggregator** | New component that combines page scores into journey scores |

---

## Architecture Overview

### Input Detection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      URL INPUT FIELD                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  [user enters URL]                                        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                            │                                    │
│                            ▼                                    │
│              ┌─────────────────────────────┐                    │
│              │     INPUT TYPE DETECTOR     │                    │
│              │  ┌───────────────────────┐  │                    │
│              │  │ ends with .xml?       │  │                    │
│              │  │ contains /sitemap?    │  │                    │
│              │  └───────────────────────┘  │                    │
│              └──────────────┬──────────────┘                    │
│                             │                                   │
│              ┌──────────────┴──────────────┐                    │
│              │                             │                    │
│              ▼                             ▼                    │
│     ┌────────────────┐           ┌────────────────┐             │
│     │  SITEMAP MODE  │           │   DOC MODE     │             │
│     │     (NEW)      │           │  (UNCHANGED)   │             │
│     └────────────────┘           └────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### Sitemap Mode — Complete Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     SITEMAP MODE FLOW                           │
└─────────────────────────────────────────────────────────────────┘

     ┌──────────────────────────────────────────────────────┐
     │ INPUT: https://resend.com/docs/sitemap.xml           │
     └──────────────────────────┬───────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ STEP 1: PARSE SITEMAP (NEW)                                   │
│ ───────────────────────────────────────────────────────────── │
│ • Fetch sitemap.xml                                           │
│ • Parse XML, extract all <loc> URLs                           │
│ • Output: Array of 176 URLs                                   │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ STEP 2: CHECK ALL URLs (REUSE: Link Checker)                  │
│ ───────────────────────────────────────────────────────────── │
│ • HTTP HEAD requests on all URLs (max 10 concurrent)          │
│ • Categorize: healthy, 404, 403, timeout, error               │
│ • Output: Sitemap health report                               │
│                                                               │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ Sitemap Health:                                           │ │
│ │ ✓ Healthy: 170  ✗ Broken (404): 4  ⚠ Access Denied: 2    │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ STEP 3: DETECT JOURNEYS (NEW)                                 │
│ ───────────────────────────────────────────────────────────── │
│ • Group URLs by developer persona + action patterns           │
│ • Generate journey options for user selection                 │
│                                                               │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ Detected Journeys:                                        │ │
│ │                                                           │ │
│ │ ☐ Send Email with Node.js (4 pages)                      │ │
│ │   Persona: Node.js Developer                              │ │
│ │   Action: Send first transactional email                  │ │
│ │                                                           │ │
│ │ ☐ Send Email with Next.js (4 pages)                      │ │
│ │   Persona: Next.js Developer                              │ │
│ │   Action: Send email from API route                       │ │
│ │                                                           │ │
│ │ ☐ Handle Webhooks (5 pages)                              │ │
│ │   Persona: Backend Developer                              │ │
│ │   Action: Process email events                            │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ STEP 4: USER SELECTS JOURNEYS                                 │
│ ───────────────────────────────────────────────────────────── │
│ • User checks journeys to analyze                             │
│ • Click [ANALYZE SELECTED JOURNEYS]                           │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ STEP 5: ANALYZE JOURNEY PAGES                                 │
│ ───────────────────────────────────────────────────────────── │
│                                                               │
│   FOR EACH PAGE IN SELECTED JOURNEYS:                         │
│   ┌─────────────────────────────────────────────────────────┐ │
│   │                                                         │ │
│   │  ┌─────────────────────────────────────────────────┐    │ │
│   │  │ REUSE: URL Processor (existing Lambda)          │    │ │
│   │  │ • Fetch HTML                                    │    │ │
│   │  │ • Remove noise                                  │    │ │
│   │  │ • Extract code snippets                         │    │ │
│   │  │ • Convert to Markdown                           │    │ │
│   │  │ + NEW: Add journeyContext to output             │    │ │
│   │  └──────────────────────┬──────────────────────────┘    │ │
│   │                         │                               │ │
│   │                         ▼                               │ │
│   │  ┌─────────────────────────────────────────────────┐    │ │
│   │  │ REUSE + ENHANCE: Dimension Analyzer             │    │ │
│   │  │ • Score 5 dimensions                            │    │ │
│   │  │ • LLM-based analysis                            │    │ │
│   │  │ + NEW: Journey-aware prompts                    │    │ │
│   │  │ + NEW: "Can user complete action?" evaluation   │    │ │
│   │  └──────────────────────┬──────────────────────────┘    │ │
│   │                         │                               │ │
│   │                         ▼                               │ │
│   │              [Page Score + Findings]                    │ │
│   │                                                         │ │
│   └─────────────────────────────────────────────────────────┘ │
│                                                               │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ STEP 6: AGGREGATE JOURNEY SCORES (NEW)                        │
│ ───────────────────────────────────────────────────────────── │
│ • Combine page scores → journey score                         │
│ • Calculate completion confidence                             │
│ • Identify blocking issues                                    │
│                                                               │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ Journey: Send Email with Node.js                          │ │
│ │ Overall Score: 75/100                                     │ │
│ │ Completion Confidence: 85%                                │ │
│ │                                                           │ │
│ │ Blocking Issues:                                          │ │
│ │ • 1 syntax error in /send-with-nodejs                     │ │
│ │ • 1 deprecated method in /api-reference/send-email        │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ STEP 7: GENERATE JOURNEY REPORT (REUSE + ENHANCE)             │
│ ───────────────────────────────────────────────────────────── │
│ • Sitemap health section                                      │
│ • Per-journey scores and findings                             │
│ • Per-page breakdown tables                                   │
│ • Exportable Markdown report                                  │
└───────────────────────────────────────────────────────────────┘
```

### Component Reuse Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPONENT REUSE MAP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   NEW COMPONENTS                        │    │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐  │    │
│  │  │   Sitemap     │  │   Journey     │  │  Journey    │  │    │
│  │  │   Parser      │  │   Detector    │  │  Aggregator │  │    │
│  │  └───────┬───────┘  └───────┬───────┘  └──────┬──────┘  │    │
│  └──────────┼──────────────────┼─────────────────┼─────────┘    │
│             │                  │                 │              │
│             ▼                  ▼                 ▼              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 EXISTING COMPONENTS (REUSE)             │    │
│  │                                                         │    │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐  │    │
│  │  │    Link       │  │     URL       │  │  Dimension  │  │    │
│  │  │   Checker     │  │   Processor   │  │  Analyzer   │  │    │
│  │  │   (100%)      │  │    (100%)     │  │ (90%+10%)   │  │    │
│  │  └───────────────┘  └───────────────┘  └─────────────┘  │    │
│  │                                                         │    │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐  │    │
│  │  │   Progress    │  │    Report     │  │   Cache     │  │    │
│  │  │   Streamer    │  │   Generator   │  │   Layer     │  │    │
│  │  │   (100%)      │  │  (80%+20%)    │  │   (100%)    │  │    │
│  │  └───────────────┘  └───────────────┘  └─────────────┘  │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Legend:                                                        │
│  • (100%) = Fully reused, no changes                           │
│  • (90%+10%) = Reused with minor enhancement                   │
│  • (80%+20%) = Reused with moderate enhancement                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Doc Mode (UNCHANGED)

```
┌─────────────────────────────────────────────────────────────────┐
│                  DOC MODE — NO CHANGES                          │
│                                                                 │
│  This mode remains exactly as implemented today.                │
│  Single URL → URL Processor → Dimension Analyzer → Report       │
│                                                                 │
│  DO NOT modify, remove, or override any existing Doc Mode       │
│  functionality. Sitemap Mode is an ADDITION, not a replacement. │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Requirements

### Requirement 1: Intelligent Input Detection

**User Story:** As a user, I want the input field to automatically detect whether I'm entering a sitemap URL or a doc URL, so that the appropriate analysis mode is triggered.

#### Acceptance Criteria

1. WHEN a URL ends with `.xml` or `sitemap.xml`, THE System SHALL detect it as Sitemap Mode
2. WHEN a URL contains `/sitemap` in the path, THE System SHALL detect it as Sitemap Mode
3. WHEN a URL does not match sitemap patterns, THE System SHALL use existing Doc Mode (UNCHANGED)
4. THE System SHALL display a visual indicator showing which mode was detected
5. THE System SHALL allow user to override the detected mode if needed

#### Detection Logic

```typescript
function detectInputType(url: string): 'sitemap' | 'doc' {
  const urlLower = url.toLowerCase();
  if (urlLower.endsWith('.xml') || 
      urlLower.endsWith('sitemap.xml') ||
      urlLower.includes('/sitemap')) {
    return 'sitemap';
  }
  return 'doc';
}
```

---

### Requirement 2: Sitemap Parser

**User Story:** As a user, I want to provide a sitemap.xml URL so that Lensy can discover all documentation pages automatically.

#### Acceptance Criteria

1. WHEN a sitemap URL is provided, THE Sitemap_Parser SHALL fetch the XML content
2. THE Sitemap_Parser SHALL extract all `<loc>` URLs from the sitemap
3. THE Sitemap_Parser SHALL handle nested sitemaps (sitemap index files)
4. WHEN parsing fails, THE System SHALL display a clear error message
5. THE Sitemap_Parser SHALL report the total number of URLs found
6. THE Progress_Streamer SHALL display "Parsing sitemap... Found X URLs"

#### Output Format

```typescript
interface SitemapParseResult {
  success: boolean;
  totalUrls: number;
  urls: SitemapUrl[];
  errors: string[];
}

interface SitemapUrl {
  loc: string;           // URL
  lastmod?: string;      // Last modified date
  priority?: number;     // Priority hint
}
```

---

### Requirement 3: Sitemap Health Check

**User Story:** As a user, I want to see which URLs in the sitemap are broken or inaccessible, so that I can identify site-wide link issues.

#### Acceptance Criteria

1. WHEN sitemap is parsed, THE System SHALL check all URLs for accessibility using existing Link_Checker
2. THE Link_Checker SHALL perform HTTP HEAD requests (max 10 concurrent)
3. THE System SHALL categorize URLs as: healthy, broken (404), access-denied (403), timeout, error
4. THE Progress_Streamer SHALL display real-time progress: "Checking URLs: X/Y complete"
5. WHEN a broken link is found, THE Progress_Streamer SHALL immediately display: "⚠ Broken: [URL] (404)"
6. THE System SHALL display a sitemap health summary before journey selection

#### Sitemap Health Display

```
┌─────────────────────────────────────────────────────────────────┐
│ SITEMAP HEALTH                                                  │
│ ─────────────────────────────────────────────────────────────── │
│ Total URLs: 176                                                 │
│                                                                 │
│ ✓ Healthy:        170 (97%)                                     │
│ ✗ Broken (404):     4 (2%)                                      │
│ ⚠ Access Denied:    2 (1%)                                      │
│ ⏱ Timeout:          0 (0%)                                      │
│                                                                 │
│ [View Broken URLs ▼]                                            │
│   • /docs/old-page → 404                                        │
│   • /docs/deprecated-guide → 404                                │
│   • /docs/removed-feature → 404                                 │
│   • /docs/legacy-api → 404                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

### Requirement 4: Journey Detection

**User Story:** As a user, I want Lensy to automatically detect developer journeys from the sitemap URLs, so that I can analyze documentation by user workflow rather than information architecture.

#### Acceptance Criteria

1. WHEN sitemap URLs are available, THE Journey_Detector SHALL group URLs by developer persona + action patterns
2. THE Journey_Detector SHALL detect journeys based on URL patterns and naming conventions
3. EACH journey SHALL have: id, name, persona, action, pages array, estimated time
4. THE Journey_Detector SHALL prioritize common developer workflows (getting started, API usage, webhooks)
5. THE System SHALL display detected journeys with page counts for user selection
6. THE System SHALL allow users to select multiple journeys for analysis

#### Journey Detection Patterns

```typescript
interface Journey {
  id: string;                    // e.g., "nodejs-send-email"
  name: string;                  // e.g., "Send Email with Node.js"
  persona: string;               // e.g., "Node.js Developer"
  action: string;                // e.g., "Send first transactional email"
  pages: string[];               // URLs in sequence
  pageCount: number;             // Number of pages
  estimatedTime: string;         // e.g., "15 min"
}

// Pattern matching for journey detection
const JOURNEY_PATTERNS = [
  {
    id: 'nodejs-send-email',
    name: 'Send Email with Node.js',
    persona: 'Node.js Developer',
    action: 'Send first transactional email',
    urlPatterns: [
      /send-with-nodejs/,
      /api-reference\/emails\/send-email/,
      /domains\/introduction/,
      /api-reference\/errors/
    ]
  },
  {
    id: 'nextjs-send-email',
    name: 'Send Email with Next.js',
    persona: 'Next.js Developer',
    action: 'Send email from API route',
    urlPatterns: [
      /send-with-nextjs/,
      /api-reference\/emails\/send-email/,
      /domains\/introduction/
    ]
  },
  {
    id: 'webhooks-setup',
    name: 'Handle Webhooks',
    persona: 'Backend Developer',
    action: 'Process email events',
    urlPatterns: [
      /webhooks\/introduction/,
      /webhooks\/event-types/,
      /webhooks\/verify/,
      /webhooks\/body-parameters/
    ]
  }
  // ... more patterns
];
```

---

### Requirement 5: Journey Selection UI

**User Story:** As a user, I want to select which developer journeys to analyze, so that I can focus on the most important user workflows.

#### Acceptance Criteria

1. THE System SHALL display detected journeys as selectable cards/checkboxes
2. EACH journey card SHALL show: name, persona, action, page count
3. THE User SHALL be able to select multiple journeys
4. THE System SHALL display total pages to be analyzed based on selection
5. THE System SHALL provide a [ANALYZE SELECTED JOURNEYS] button
6. WHEN no journeys are selected, THE button SHALL be disabled

#### Journey Selection UI Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│ SELECT DEVELOPER JOURNEYS TO ANALYZE                            │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☑ Send Email with Node.js                        4 pages   │ │
│ │   Persona: Node.js Developer                                │ │
│ │   Action: Send first transactional email                    │ │
│ │   Pages: /send-with-nodejs, /api-reference/send-email, ...  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☑ Send Email with Next.js                        4 pages   │ │
│ │   Persona: Next.js Developer                                │ │
│ │   Action: Send email from API route                         │ │
│ │   Pages: /send-with-nextjs, /api-reference/send-email, ...  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☐ Handle Webhooks                                5 pages   │ │
│ │   Persona: Backend Developer                                │ │
│ │   Action: Process email events                              │ │
│ │   Pages: /webhooks/introduction, /webhooks/event-types, ... │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☐ Set Up Custom Domain                           3 pages   │ │
│ │   Persona: DevOps Engineer                                  │ │
│ │   Action: Configure sending domain                          │ │
│ │   Pages: /domains/introduction, /domains/dmarc, ...         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ─────────────────────────────────────────────────────────────── │
│ Selected: 2 journeys (8 pages)                                  │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │              [ANALYZE SELECTED JOURNEYS]                    │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

### Requirement 6: Journey Context for Page Analysis

**User Story:** As a system, I want to provide journey context to the Dimension Analyzer, so that each page is scored in the context of the developer workflow it belongs to.

#### Acceptance Criteria

1. WHEN analyzing a page within a journey, THE URL_Processor SHALL add journeyContext to the processed content
2. THE journeyContext SHALL include: journey name, persona, action, step number, total steps, previous/next pages
3. THE Dimension_Analyzer SHALL use journeyContext in prompts (similar to existing contextAnalysis)
4. THE Dimension_Analyzer SHALL evaluate: "Does this page help the persona complete the action?"

#### Journey Context Structure

```typescript
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
}
```

#### Enhanced Dimension Analyzer Prompt (Journey-Aware)

```typescript
// Add to buildPromptForDimension() in dimension-analyzer
let journeyInfo = '';
if (processedContent.journeyContext) {
  const jc = processedContent.journeyContext;
  journeyInfo = `
JOURNEY ANALYSIS ENABLED:
──────────────────────────
Journey: ${jc.journeyName}
Persona: ${jc.persona}
Action: ${jc.action}
This Page: Step ${jc.stepNumber} of ${jc.totalSteps}
Previous Steps: ${jc.previousSteps.join(' → ') || 'None (this is the first step)'}
Next Steps: ${jc.nextSteps.join(' → ') || 'None (this is the last step)'}

IMPORTANT EVALUATION CRITERIA:
1. Does this page help a ${jc.persona} complete the action "${jc.action}"?
2. Does this page connect well with the previous step(s)?
3. Does this page prepare the user for the next step(s)?
4. Are there any gaps that would block the developer from proceeding?
5. Is the information presented in the right sequence for this workflow?
`;
}
```

---

### Requirement 7: Journey Score Aggregation

**User Story:** As a user, I want to see an overall score for each developer journey, so that I can quickly assess if the documentation supports the complete workflow.

#### Acceptance Criteria

1. WHEN all pages in a journey are analyzed, THE Journey_Aggregator SHALL combine page scores into a journey score
2. THE Journey_Aggregator SHALL calculate a weighted average of dimension scores across pages
3. THE Journey_Aggregator SHALL calculate a Completion Confidence percentage
4. THE Completion Confidence SHALL be reduced by blocking issues (syntax errors, broken links, deprecated code)
5. THE Journey_Aggregator SHALL identify and list blocking issues that prevent workflow completion

#### Journey Aggregation Logic

```typescript
interface JourneyScore {
  journeyId: string;
  journeyName: string;
  persona: string;
  action: string;
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
}

interface BlockingIssue {
  type: 'syntax-error' | 'broken-link' | 'deprecated-code' | 'missing-content';
  severity: 'critical' | 'high' | 'medium';
  page: string;
  description: string;
}

function aggregateJourneyScores(pageResults: PageResult[]): JourneyScore {
  // 1. Calculate dimension averages
  const dimensionAverages = {
    relevance: average(pageResults.map(p => p.dimensions.relevance)),
    freshness: average(pageResults.map(p => p.dimensions.freshness)),
    clarity: average(pageResults.map(p => p.dimensions.clarity)),
    accuracy: average(pageResults.map(p => p.dimensions.accuracy)),
    completeness: average(pageResults.map(p => p.dimensions.completeness))
  };
  
  // 2. Calculate overall score
  const overallScore = average(Object.values(dimensionAverages));
  
  // 3. Calculate completion confidence
  const completionConfidence = calculateCompletionConfidence(pageResults);
  
  // 4. Identify blocking issues
  const blockingIssues = identifyBlockingIssues(pageResults);
  
  return { overallScore, completionConfidence, dimensionAverages, blockingIssues, ... };
}

function calculateCompletionConfidence(pageResults: PageResult[]): number {
  let confidence = 100;
  
  // Deduct for blocking issues
  for (const page of pageResults) {
    // Syntax errors are critical — code won't run
    confidence -= page.syntaxErrors * 15;
    
    // Broken links disrupt flow
    confidence -= page.brokenLinks * 5;
    
    // Deprecated code may still work but confuses users
    confidence -= page.deprecatedCode * 3;
    
    // Low clarity makes it hard to follow
    if (page.dimensions.clarity < 50) confidence -= 10;
    
    // Low accuracy means incorrect information
    if (page.dimensions.accuracy < 50) confidence -= 15;
  }
  
  return Math.max(0, Math.min(100, confidence));
}
```

---

### Requirement 8: Journey Report Format

**User Story:** As a user, I want a comprehensive report showing sitemap health and journey analysis results, so that I can share findings and prioritize improvements.

#### Acceptance Criteria

1. THE Report SHALL include a Sitemap Health section with URL statistics
2. THE Report SHALL include a Journey Analysis section for each selected journey
3. EACH Journey section SHALL show: overall score, completion confidence, page breakdown table
4. THE Report SHALL list all findings with specific locations (page, line number)
5. THE Report SHALL be exportable as Markdown
6. THE existing Export Report functionality SHALL be enhanced to support journey reports

#### Journey Report Format

```markdown
# DOCUMENTATION AUDIT REPORT
Generated: Dec 30, 2025
Sitemap: https://resend.com/docs/sitemap.xml

---

## SITEMAP HEALTH

| Metric | Count | Percentage |
|--------|-------|------------|
| Total URLs | 176 | 100% |
| ✓ Healthy | 170 | 97% |
| ✗ Broken (404) | 4 | 2% |
| ⚠ Access Denied | 2 | 1% |

### Broken URLs
1. `/docs/old-page` → 404
2. `/docs/deprecated-guide` → 404
3. `/docs/removed-feature` → 404
4. `/docs/legacy-api` → 404

---

## JOURNEY ANALYSIS

### Send Email with Node.js

| Metric | Value |
|--------|-------|
| Persona | Node.js Developer |
| Action | Send first transactional email |
| Overall Score | 75/100 |
| Completion Confidence | 85% ✓ |

#### Page Scores

| Page | Score | Relevance | Freshness | Clarity | Accuracy | Completeness |
|------|-------|-----------|-----------|---------|----------|--------------|
| /send-with-nodejs | 72 | 80 | 65 | 75 | 70 | 70 |
| /api-reference/emails/send-email | 85 | 90 | 80 | 85 | 85 | 85 |
| /domains/introduction | 68 | 75 | 70 | 60 | 70 | 65 |
| /api-reference/errors | 78 | 80 | 75 | 80 | 80 | 75 |

#### Findings

**Deprecated Code (1)**
- `/send-with-nodejs`, line 12: `resend.sendEmail()` → use `resend.emails.send()`
  - Deprecated in: v2.0
  - Confidence: high

**Syntax Errors (0)** ✓

**Broken Links (1)**
- `/domains/introduction` links to `/docs/old-dns-guide` → 404

---

### Send Email with Next.js

| Metric | Value |
|--------|-------|
| Persona | Next.js Developer |
| Action | Send email from API route |
| Overall Score | 82/100 |
| Completion Confidence | 95% ✓ |

[... etc ...]
```

---

## Component Summary

### NEW Components (Build)

| Component | Description | Effort |
|-----------|-------------|--------|
| Input Type Detector | Detect sitemap vs doc URL | 30 min |
| Sitemap Parser | Parse XML, extract URLs | 2 hrs |
| Journey Detector | Group URLs by persona + action | 2-3 hrs |
| Journey Selection UI | Checkboxes, selection state | 2 hrs |
| Journey Aggregator | Combine page scores, calculate confidence | 2-3 hrs |

### REUSE Components (No Changes)

| Component | Reuse | Notes |
|-----------|-------|-------|
| Link Checker | 100% | Feed sitemap URLs instead of page links |
| URL Processor | 100% | Runs per page, no changes needed |
| Progress Streamer | 100% | Works for both modes |
| Cache Layer | 100% | Caches per-page results |

### ENHANCE Components (Minor Changes)

| Component | Reuse | Enhancement | Effort |
|-----------|-------|-------------|--------|
| Dimension Analyzer | 90% | Add journey-aware prompts | 1-2 hrs |
| Report Generator | 80% | Add journey report format | 1-2 hrs |

---

## Priority Order

| Priority | Requirement | Effort |
|----------|-------------|--------|
| P0 | Req 1: Input Detection | 30 min |
| P0 | Req 2: Sitemap Parser | 2 hrs |
| P0 | Req 3: Sitemap Health Check | 1 hr (reuse Link Checker) |
| P0 | Req 4: Journey Detection | 2-3 hrs |
| P1 | Req 5: Journey Selection UI | 2 hrs |
| P1 | Req 6: Journey Context | 1-2 hrs |
| P1 | Req 7: Journey Aggregation | 2-3 hrs |
| P1 | Req 8: Journey Report | 1-2 hrs |

**Total Estimated Effort: 12-16 hours (1.5-2 days)**

---

## Success Criteria

This enhancement is successful when:

1. User can input a sitemap.xml URL and see all URLs checked for 404s
2. System automatically detects and presents developer journeys
3. User can select journeys and receive per-journey scores with completion confidence
4. Report clearly shows "Can a [persona] successfully [action] using these docs?"
5. Existing Doc Mode continues to work exactly as before (UNCHANGED)
6. Findings are specific and verifiable (page, line number, code snippet)

---

## Appendix: Example Output for Resend

**Input:** `https://resend.com/docs/sitemap.xml`

**Sitemap Health:**
- 176 URLs checked
- 170 healthy, 4 broken, 2 access denied

**Detected Journeys:**
1. Send Email with Node.js (4 pages)
2. Send Email with Next.js (4 pages)
3. Send Email with Python (3 pages)
4. Handle Webhooks (5 pages)
5. Set Up Custom Domain (3 pages)
6. Send Batch Emails (3 pages)

**Selected:** Send Email with Node.js, Send Email with Next.js

**Output:**
```
Journey: Send Email with Node.js
Overall Score: 75/100
Completion Confidence: 85%

Key Finding: Line 12 in /send-with-nodejs uses deprecated method
Recommendation: Replace resend.sendEmail() with resend.emails.send()
```
