# Lensy Documentation Quality Auditor - Requirements

## Product Requirements

**What it does:** Analyzes developer documentation URLs and produces quality reports with specific, actionable recommendations.

**Success criteria:**
- Analyzes single documentation page/section
- Scores 5 quality dimensions (or shows partial results gracefully)
- Provides 3-5 specific recommendations per dimension
- Detects syntax errors and deprecated code
- Output suitable for demo/sales conversations

**Tech stack:**
- Frontend: React
- Backend: AWS Lambda + Bedrock (Claude)
- No database needed

---

## User Flow

| Step | What Happens | User Sees |
|------|--------------|-----------|
| **1. URL Input** | User pastes documentation URL | Input field + "Analyze" button |
| **2. Structure Analysis** | System fetches content, identifies topics | Loading state |
| **3. Confirmation** | System shows detected structure | Confirmation dialog (see below) |
| **4. Analysis** | Dimensions analyzed sequentially | Live progress notes |
| **5. Results** | Quality dashboard displayed | Scores + recommendations |

### Step 3 Confirmation - Two Scenarios

**Scenario A: Multiple topics detected**
```
Found 3 topics in this documentation:
• Authentication (3 pages)
• API Reference (12 pages)  
• Getting Started (2 pages)

Does this breakdown make sense?
[Confirm] [Edit Structure]
```

**Scenario B: Single topic**
```
This appears to be a single topic:
"REST API Pagination"

Is this categorization accurate?
[Confirm] [Change Category]
```

**Rule:** Don't proceed to analysis until user confirms.

### Step 4 Progress Notes Format

```
✓ Fetching documentation...
✓ Content extracted

⏳ Analyzing Relevance dimension...
  → Checking target audience alignment
  → Evaluating search intent match
✓ Relevance complete (Score: 7/10)

⏳ Analyzing Freshness dimension...
  → Checking API version references
  → Scanning 7 code snippets for deprecated methods
  ⚠ Snippet 1: Uses deprecated auth.login() (removed in v3.0)
  ⚠ Snippet 4: Calls getUsers() (deprecated since v2.5)
✓ Freshness complete (Score: 4/10)

⏳ Analyzing Clarity dimension...
  → Assessing readability metrics
  → Checking code example documentation
  ⚠ 5 code snippets missing version specifications
✓ Clarity complete (Score: 8/10)

⏳ Analyzing Accuracy dimension...
  → Validating 7 code snippets for syntax
  ✗ Snippet 3: Syntax error on line 3 (missing closing quote)
  ✓ Remaining snippets validated
✓ Accuracy complete (Score: 6/10)

⏳ Analyzing Completeness dimension...
  → Checking for coverage gaps
  ✗ Failed: 404 errors on 5 linked pages
  → Skipping this dimension

✓ Analysis complete! Results available for 4 of 5 dimensions
```

**Rules for progress notes:**
- Real-time streaming (append, don't replace)
- Auto-scroll to latest update
- Keep completed steps visible
- Show specific findings inline (deprecated methods, syntax errors)
- Use icons: ✓ (success), ⏳ (in progress), ⚠ (warning), ✗ (error)

---

## Quality Dimensions

| Dimension | What to Check | Example Output |
|-----------|---------------|----------------|
| **Relevance** | • Target audience alignment<br>• Search intent match<br>• Content-to-need fit | "Content targets beginners but uses advanced terminology without explanation" |
| **Freshness** | • API version currency<br>• **Deprecated code in examples**<br>• **Version compatibility (backward/forward)**<br>• Date stamps | "Uses `auth.login()` - removed in v3.0"<br>"4 code examples incompatible with latest version" |
| **Clarity** | • Readability metrics<br>• Technical explanation depth<br>• Code example quality<br>• **Missing version specs in code** | "5 code snippets missing version badges"<br>"No compatibility notes for breaking changes" |
| **Accuracy** | • **Code syntax validation**<br>• **Function signatures correctness**<br>• Factual claims verification<br>• API endpoint accuracy | "Syntax error line 45: missing closing quote"<br>"Function signature for createUser() is incorrect" |
| **Completeness** | • Coverage gaps (missing parameters, edge cases)<br>• Broken links<br>• Missing code examples | "404 errors on 5 linked pages"<br>"Missing error handling examples" |

### Code Verification (Distributed Across Dimensions)

**Code checks by dimension:**

| What to Check | Which Dimension | Example Finding |
|---------------|-----------------|-----------------|
| Syntax errors | Accuracy | "Line 45: missing closing quote" |
| Can code be copy-pasted and run? | Accuracy | "Function createUser() expects 3 params, example shows 2" |
| Deprecated methods | Freshness | "`getUsers()` deprecated since v2.5" |
| Version compatibility | Freshness | "Code breaks in v3.0+" |
| Missing version specifications | Clarity | "No version badge on authentication example" |
| Missing compatibility notes | Clarity | "Breaking change in v3.0 not mentioned" |

**For each code snippet found:**
1. Extract language identifier
2. Validate syntax
3. Check for deprecated methods/functions
4. Verify version compatibility
5. Check if version is specified in docs

---

## Graceful Degradation Rules

**Core principle:** Show what works, acknowledge what doesn't.

### Display Logic

```
IF at least 1 dimension completes:
  → Show report with available dimensions
  → Mark failed dimensions clearly
  → Explain why they failed
  
IF all dimensions fail:
  → Show error report
  → Explain what went wrong
  → Don't show empty dashboard
```

### Results Dashboard with Partial Success

**Example: 4 of 5 dimensions completed**

```
Documentation Quality Report
Overall Score: 6.8/10 (based on 4 of 5 dimensions)

✓ Relevance: 7/10
✓ Freshness: 4/10
✓ Clarity: 8/10
✓ Accuracy: 6/10
⚠ Completeness: Unable to analyze
   → Reason: 404 errors on 5 linked pages
   → Impact: Cannot assess coverage gaps
   
Analysis Coverage: 80%
Confidence Level: High

[View Detailed Recommendations] [Export Report] [Re-run Analysis]
```

**UI treatment for failed dimensions:**
- Don't show score (no "N/A" or "0/10")
- Show warning icon ⚠
- Explain reason for failure
- Suggest fix if possible

### Progress Notes for Failures

```
⏳ Analyzing Completeness dimension...
  → Checking for coverage gaps
  → Following 12 linked pages
  ✗ Failed: 404 errors on 5 linked pages
  ✗ Timeout on 2 pages
  → Skipping this dimension

✓ Analysis complete! Results available for 4 of 5 dimensions
```

---

## Data Models

### Input

```json
{
  "url": "https://developer.wordpress.org/rest-api/reference/",
  "confirmed_structure": {
    "type": "multi_topic",
    "topics": [
      {
        "name": "Authentication",
        "page_count": 3
      },
      {
        "name": "API Reference", 
        "page_count": 12
      }
    ]
  }
}
```

### Output - Progress Event

```json
{
  "type": "progress",
  "dimension": "freshness",
  "status": "in_progress",
  "message": "Scanning 7 code snippets for deprecated methods",
  "details": {
    "finding": "Uses deprecated auth.login() (removed in v3.0)",
    "severity": "warning"
  }
}
```

### Output - Final Report

```json
{
  "overall_score": 6.8,
  "dimensions_analyzed": 4,
  "dimensions_total": 5,
  "confidence": "high",
  
  "dimensions": {
    "relevance": {
      "score": 7,
      "status": "complete",
      "findings": [
        "Content targets beginners but uses advanced terminology"
      ],
      "recommendations": [
        {
          "priority": "medium",
          "action": "Add glossary for technical terms",
          "impact": "Improves accessibility for target audience"
        }
      ]
    },
    "freshness": {
      "score": 4,
      "status": "complete",
      "findings": [
        "Uses deprecated auth.login() (removed in v3.0)",
        "4 code examples incompatible with latest version"
      ],
      "recommendations": [
        {
          "priority": "high",
          "action": "Replace auth.login() with auth.authenticate()",
          "impact": "Prevents code breaks in v3.0+"
        }
      ]
    },
    "completeness": {
      "score": null,
      "status": "failed",
      "reason": "404 errors on 5 linked pages",
      "impact": "Cannot assess coverage gaps"
    }
  },
  
  "code_analysis": {
    "snippets_found": 7,
    "syntax_errors": 1,
    "deprecated_methods": 4,
    "missing_version_specs": 5
  }
}
```

### Recommendation Format

```json
{
  "priority": "high",
  "action": "Specific action to take",
  "location": "Line 45 in authentication example",
  "impact": "What this fixes",
  "code_example": "auth.authenticate()"
}
```

---

## Key Implementation Notes

### Bedrock Prompts
- Use structured output (JSON)
- One prompt per dimension
- Include code snippet extraction and validation
- Request specific recommendations, not generic advice

### Error Handling
- Timeout per dimension: 30 seconds max
- Catch errors without crashing entire analysis
- Track success/partial/failed states
- Minimum 1 dimension must complete to show report

### UI States
1. Input (URL field + button)
2. Structure confirmation (dialog with detected topics)
3. Processing (streaming progress notes)
4. Results (dashboard with scores + recommendations)

### What Makes a Good Recommendation
❌ Bad: "Update your documentation"
✓ Good: "Replace `auth.login()` with `auth.authenticate()` on line 45 - current code breaks in v3.0+"

---

## 24-Hour Implementation Checklist

| Hours | Task | Deliverable |
|-------|------|-------------|
| 0-2 | AWS Bedrock setup + test | Successful API call to Claude |
| 2-6 | Build dimension analysis prompts | JSON responses for each dimension |
| 6-9 | React UI with progress streaming | Live progress notes displayed |
| 9-12 | Structure confirmation workflow | Working confirmation dialog |
| 12-16 | Report generation + graceful degradation | Partial results handled correctly |
| 16-20 | Test on real docs | 3 test URLs analyzed successfully |
| 20-24 | Refinement + documentation | Production-ready demo |

### Test URLs
1. WordPress.org developer docs
2. Stripe API reference
3. AWS SDK documentation

**Expected to find:**
- Deprecated code examples
- Syntax errors in copy-paste snippets
- Missing version specifications
- Broken links
- Outdated API references

---

**Ready to implement in Cursor/VSCode. This doc contains all product requirements - let the IDE AI handle implementation details.**
