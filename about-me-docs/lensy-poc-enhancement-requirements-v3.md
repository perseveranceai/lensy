# Lensy POC Enhancement Requirements — High-Impact Findings

## Introduction

This document specifies enhancements to make Lensy's findings **specific, verifiable, and credible**. Three core capabilities need strengthening: broken link detection, deprecated code detection, and syntax error detection. Additionally, the existing UI dashboard needs updates to display these findings, and a report export feature is needed.

---

## Glossary (Additions)

- **Link_Checker**: Component that validates link accessibility via HTTP requests
- **Code_Analyzer**: Component that detects deprecated methods and syntax errors in code snippets
- **Finding**: A specific, verifiable issue with exact location (URL, line number, method name)

---

## Requirements

### Requirement 18: Broken Link Detection

**User Story:** As a documentation analyst, I want to identify broken links with exact URLs and status codes, so that I can report specific, verifiable issues.

#### Acceptance Criteria

1. WHEN analyzing a page, THE Link_Checker SHALL extract all internal and external links
2. THE Link_Checker SHALL perform HTTP HEAD requests to verify each link's accessibility
3. WHEN a link returns 404, THE Link_Checker SHALL report it as broken with: URL, status code, anchor text, source page path
4. WHEN a link returns other 4xx/5xx status, THE Link_Checker SHALL report it as an error with specific status
5. WHEN a link times out (>5 seconds), THE Link_Checker SHALL report it as unreachable
6. THE Link_Checker SHALL process links concurrently (max 10 simultaneous) to avoid rate limiting
7. THE Link_Checker SHALL skip mailto:, tel:, javascript:, and anchor-only (#) links
8. WHEN link checking completes, THE existing Progress_Streamer SHALL display: "✓ Link check: X broken, Y healthy"

---

### Requirement 19: Language-Agnostic Deprecated Code Detection

**User Story:** As a documentation analyst, I want to detect deprecated code in any programming language, so that findings are relevant regardless of the tech stack being documented.

#### Acceptance Criteria

1. WHEN code snippets are extracted, THE Code_Analyzer SHALL detect the programming language from code block annotations or content heuristics
2. THE Code_Analyzer SHALL support deprecation detection for all common languages including but not limited to: JavaScript, TypeScript, Python, PHP, Ruby, Go, Java, C#, Rust, Swift
3. WHEN analyzing code, THE Code_Analyzer SHALL use the LLM to identify deprecated methods, functions, or patterns based on its training knowledge of language/framework evolution
4. THE Code_Analyzer SHALL prompt the LLM with: language detected, code snippet, and request to identify deprecated/removed APIs with version information
5. WHEN deprecated code is found, THE Code_Analyzer SHALL report: method/function name, line number within snippet, deprecation version, recommended replacement
6. THE Code_Analyzer SHALL detect framework-specific deprecations (e.g., React lifecycle methods, jQuery patterns, Express.js old APIs)
7. WHEN deprecation is detected, THE Code_Analyzer SHALL provide confidence level (high/medium/low) based on LLM certainty
8. THE Code_Analyzer SHALL NOT report false positives — when uncertain, mark as "potential deprecation" rather than definitive

#### Example Output

```json
{
  "deprecated": [
    {
      "language": "javascript",
      "method": "componentWillMount",
      "location": "/quickstart code block 2, line 5",
      "deprecatedIn": "React 16.3",
      "removedIn": "React 17",
      "replacement": "useEffect() or componentDidMount()",
      "confidence": "high"
    }
  ]
}
```

---

### Requirement 20: Language-Agnostic Syntax Error Detection

**User Story:** As a documentation analyst, I want to detect syntax errors in code examples for any programming language, so that I can identify copy-paste examples that will fail.

#### Acceptance Criteria

1. WHEN code snippets are extracted, THE Code_Analyzer SHALL validate syntax for the detected language
2. THE Code_Analyzer SHALL use the LLM to identify syntax errors by prompting it to parse the code and report any syntax violations
3. WHEN syntax errors are found, THE Code_Analyzer SHALL report: error type, line number within snippet, description, the problematic code fragment
4. THE Code_Analyzer SHALL detect common syntax errors including: unclosed brackets/quotes/parentheses, missing semicolons (where required), invalid syntax constructs, malformed JSON/YAML in config examples
5. THE Code_Analyzer SHALL distinguish between: definite syntax errors vs. style issues vs. potential runtime errors
6. WHEN reporting errors, THE Code_Analyzer SHALL only report definite syntax errors that would prevent code execution
7. THE Code_Analyzer SHALL handle incomplete code snippets gracefully — snippets showing partial code (e.g., "// ... rest of code") should not trigger false positives

#### Example Output

```json
{
  "syntaxErrors": [
    {
      "language": "python",
      "location": "/api-reference code block 1, line 8",
      "errorType": "SyntaxError",
      "description": "Unclosed string literal",
      "codeFragment": "message = \"Hello world",
      "confidence": "high"
    }
  ]
}
```

---

### Requirement 21: Findings Integration with Dimension Scores

**User Story:** As a documentation analyst, I want broken links, deprecated code, and syntax errors to be reflected in quality dimension scores, so that the overall score accurately reflects these issues.

#### Acceptance Criteria

1. THE existing scoring module SHALL incorporate broken link findings into the Completeness dimension score
2. THE existing scoring module SHALL verify that deprecated code findings are reflected in the Freshness dimension score; IF NOT already implemented, it SHALL be added
3. THE existing scoring module SHALL verify that syntax error findings are reflected in the Accuracy dimension score; IF NOT already implemented, it SHALL be added
4. WHEN broken links are found, THE Analyzer SHALL apply score reduction to Completeness: 1-2 broken = -0.5, 3-5 = -1.0, >5 = -2.0
5. WHEN deprecated code is found, THE Analyzer SHALL ensure Freshness score reflects the severity proportionally
6. WHEN syntax errors are found, THE Analyzer SHALL ensure Accuracy score reflects the severity proportionally
7. THE Report_Generator SHALL display the specific findings that contributed to each dimension's score reduction

---

### Requirement 22: Findings Display in Existing Dashboard

**User Story:** As a user, I want to see a clear summary of critical findings (broken links, deprecated code, syntax errors) in the existing dashboard, so that I can quickly assess documentation health.

#### Acceptance Criteria

1. THE existing dashboard SHALL be updated to include a "Critical Findings" section
2. THE Critical Findings section SHALL display above or alongside the existing dimension scores
3. THE Critical Findings section SHALL show counts for: Broken Links, Deprecated Code, Syntax Errors
4. WHEN a finding category has zero issues, THE dashboard SHALL display a green checkmark (✓) with "None found"
5. WHEN findings exist, THE dashboard SHALL display count with warning icon (⚠) and the count SHALL be clickable to expand details
6. WHEN expanded, THE dashboard SHALL show specific findings with: location, description, and recommended fix
7. THE dashboard SHALL NOT create a new/separate UI — all updates integrate into the existing results view

#### UI Addition to Existing Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ CRITICAL FINDINGS                                       │
├─────────────────────────────────────────────────────────┤
│ ⚠ Broken Links: 2          [Expand]                    │
│ ⚠ Deprecated Code: 3       [Expand]                    │
│ ✓ Syntax Errors: None found                            │
└─────────────────────────────────────────────────────────┘

[Existing dimension scores and recommendations below]
```

---

### Requirement 23: Report Export

**User Story:** As a user, I want to export a complete report of the analysis including dimension scores and all findings, so that I can share or reference the results outside of Lensy.

#### Acceptance Criteria

1. WHEN analysis completes, THE existing dashboard SHALL display an "Export Report" button
2. THE exported report SHALL include: analyzed URL, analysis date, overall score, all dimension scores with breakdowns
3. THE exported report SHALL include all findings: broken links (with URLs and status), deprecated code (with method names and replacements), syntax errors (with line numbers and descriptions)
4. THE exported report SHALL be available in at least one format: PDF, Markdown, or plain text
5. WHEN export button is clicked, THE System SHALL generate and download the report file
6. THE exported report SHALL be structured for readability with clear sections for each dimension and finding type

#### Report Format

```
DOCUMENTATION QUALITY REPORT
============================
URL: docs.example.com
Analyzed: Dec 30, 2025
Overall Score: 6.2/10

DIMENSION SCORES
----------------
Relevance:    7/10
Freshness:    5/10
Clarity:      7/10
Accuracy:     6/10
Completeness: 6/10

CRITICAL FINDINGS
-----------------

Broken Links (2):
  1. /getting-started → /old-auth-guide (404)
     Anchor text: "See authentication guide"
  2. /api-reference → /v1/deprecated-endpoint (404)
     Anchor text: "Legacy endpoint docs"

Deprecated Code (3):
  1. /quickstart, code block 2, line 5
     componentWillMount() — deprecated in React 16.3, removed in React 17
     Replacement: useEffect() or componentDidMount()
  2. /database, code block 1, line 12
     mysql_query() — removed in PHP 7.0
     Replacement: mysqli_query() or PDO

Syntax Errors (0): None found ✓

RECOMMENDATIONS
---------------
[Existing dimension-specific recommendations]
```

---

### Requirement 24: Progress Streaming for Enhanced Analysis

**User Story:** As a user, I want to see real-time progress during link checking and code analysis, so that I understand what the system is checking.

#### Acceptance Criteria

1. THE existing Progress_Streamer infrastructure SHALL be extended to support link checking and code analysis updates
2. WHEN link checking begins, THE Progress_Streamer SHALL display "Checking X links for accessibility..."
3. WHEN a broken link is found, THE Progress_Streamer SHALL immediately display: "⚠ Broken link: [URL] (404)"
4. WHEN link checking completes, THE Progress_Streamer SHALL display: "✓ Link check complete: X broken, Y healthy"
5. WHEN code analysis begins, THE Progress_Streamer SHALL display "Analyzing X code snippets..."
6. WHEN a deprecated method is found, THE Progress_Streamer SHALL immediately display: "⚠ Deprecated: [method] in [location]"
7. WHEN a syntax error is found, THE Progress_Streamer SHALL immediately display: "✗ Syntax error: [description] in [location]"
8. WHEN code analysis completes, THE Progress_Streamer SHALL display: "✓ Code analysis complete: X deprecated, Y syntax errors"
9. ALL progress updates SHALL use the existing Progress_Streamer format and WebSocket infrastructure

---

## Success Criteria

This enhancement is successful when:

1. All three finding types (broken links, deprecated code, syntax errors) report **specific, verifiable details**
2. Users can verify any finding in under 30 seconds by checking the reported URL/line
3. The existing dashboard clearly displays critical findings without requiring navigation to a separate view
4. Reports can be exported with complete analysis results
5. Zero false positives in high-confidence findings — if uncertain, system downgrades confidence rather than misreporting

---

