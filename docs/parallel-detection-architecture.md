# Parallel Detection Architecture — Restructuring check-ai-readiness.ts

> **Status:** Revised per developer redline review. This is the implementation spec.

## Problem

The current `check-ai-readiness.ts` makes 5-8 sequential HTTP calls at 5s timeout each, totaling 25-40s wall clock. Adding all the new detection methods (content negotiation, `.well-known`, hierarchical subpath traversal, header validation probes) would push this to 15-20 sequential HTTP calls — 75-100s worst case, which would hit the Lambda timeout.

---

## Decision Summary

Proceed with the refactor. The architecture moves to:

- Signal harvest (Phase 1)
- Parallel probes (Phase 2)
- Cross-reference / merge (Phase 3)
- Pure analysis core + adapter layer (MCP-ready)

---

## Current Architecture

```
API Handler → Agent Lambda (15min timeout, 1GB RAM)
                  ↓
            Prefetch HTML + Content Gate
                  ↓
            ┌─────────────────────────────┐
            │      Promise.allSettled      │
            ├──────────────┬──────────────┤
            │  Readiness   │Discoverability│
            │  (25-40s)    │   (17s)      │
            │  SEQUENTIAL  │  PARALLEL    │
            │  internally  │  (5 Perplexity│
            │              │   queries)   │
            └──────┬───────┴──────────────┘
                   ↓
            Generate Report
```

**Inside check-ai-readiness today (sequential):**

```
fetch(target_url)           10s timeout
  ↓
fetch(robots.txt)            5s timeout
  ↓
fetch(llms.txt candidate 1)  5s timeout
  ↓
fetch(llms.txt candidate 2)  5s timeout  (if candidate 1 failed)
  ↓
fetch(llms-full.txt)         5s timeout
  ↓
fetch(sitemap.xml)           5s timeout
  ↓
fetch(markdown probe)        5s timeout
  ↓
[optional] Bedrock Haiku     2s
  ↓
Return result

Total: 25-40s (sequential sum of timeouts)
```

---

## Proposed Architecture

### High-Level Flow

```
API Handler → Agent Lambda
                  ↓
            Prefetch HTML + Content Gate
            (use final resolved URL as probe base — follow redirects first)
                  ↓
        ┌─────────────────────────────────────────┐
        │           Promise.allSettled             │
        ├────────────┬────────────┬───────────────┤
        │ Readiness  │ Discovery  │ Discoverability│
        │ (NEW: ~5s) │ (NEW: ~5s) │  (Perplexity) │
        └─────┬──────┴─────┬──────┴───────────────┘
              ↓            ↓
        Cross-reference + Merge
                  ↓
           Generate Report
```

### Inside Readiness — Three Phases

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  PHASE 1: Signal Harvest (0 HTTP calls, ~0ms)        │
│  Parse headers + HTML + robots.txt for all hints     │
│                                                      │
│  PHASE 2: Parallel Probe Groups (~5s wall clock)     │
│  ┌──────────────┬──────────────┬──────────────┐      │
│  │   Group A    │   Group B    │   Group C    │      │
│  │   llms.txt   │   Markdown   │   Extras     │      │
│  │   probes     │   probes     │  (experimental│     │
│  │              │              │   signals)   │      │
│  │ •header hint │ •content     │ •AGENTS.md   │      │
│  │  (validate!) │  negot.      │ •.well-known/│      │
│  │ •root        │ •{url}.md    │  mcp.json    │      │
│  │ •subpath     │ •llms.txt    │ •sitemap     │      │
│  │ •walk-up     │  page map    │              │      │
│  │ •.well-known │              │              │      │
│  └──────────────┴──────────────┴──────────────┘      │
│  All groups run via Promise.allSettled                │
│                                                      │
│  PHASE 3: Cross-Reference (0 HTTP calls, ~0ms)       │
│  Validate hints, merge results, classify evidence    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Evidence Model

All detection signals use evidence-aware states instead of simple found/not-found booleans.

```typescript
type EvidenceStatus = 'verified' | 'advertised' | 'mapped' | 'not_verified' | 'experimental'

type DetectionSignal = {
    status: EvidenceStatus;
    method?: string;               // e.g., 'link-header', 'content-negotiation', 'subpath-probe'
    validatedUrl?: string | null;  // the actual URL that returned HTTP 200
    audience?: 'ai_search' | 'coding_agents' | 'both';
    confidence?: 'high' | 'medium' | 'low';  // optional — omit when status is sufficient
    note?: string | null;          // e.g., 'Link header pointed to /llms.txt (404), found at /docs/llms.txt'
}
```

**Status definitions:**

| Status | Meaning | Example |
|--------|---------|---------|
| `verified` | Live HTTP 200 with valid content | llms.txt fetched successfully at /docs/llms.txt |
| `advertised` | Header or HTML signals exist but URL not validated or returned 404 | Link header says /llms.txt but root 404s |
| `mapped` | Page found in llms.txt index (site has llms.txt, this page is listed) | /docs/quickstart/apis/nextjs.md listed in llms.txt |
| `not_verified` | All probes failed across all tested paths | No llms.txt found at any candidate URL |
| `experimental` | Emerging standard detected, not yet widely adopted | AGENTS.md found at root |

---

## Critical Design Rule: Headers Are Hints, Not Proof

> Never mark `llms.txt` or `llms-full.txt` as found based only on the presence of headers.

**Required behavior:**

1. Resolve header target URL against the **final** URL (post-redirect)
2. Probe it with an actual HTTP request
3. Mark as `verified` only on real HTTP 200 with plausible body content
4. If the hinted path fails but another path succeeds, report both — the hint and where it was actually found

**Why:** Unkey's `Link` header points to `/llms.txt` (root) which 404s. The real file lives at `/docs/llms.txt`. Trusting the header would create a false positive.

```typescript
// WRONG: Trust header blindly
if (linkHeader.has('rel=llms-txt')) return { status: 'verified', url: linkHeader.url };

// RIGHT: Use header as first probe candidate, verify with HTTP 200
const candidates = [
    ...hintUrls,           // Header hints go first (most likely correct)
    `${baseUrl}/llms.txt`, // Root fallback
    // ... other candidates
];
const results = await Promise.allSettled(candidates.map(url => checkUrl(url, true)));
const firstSuccess = results.find(r => r.status === 'fulfilled' && r.value.found);

// If header URL failed but another succeeded:
if (!headerUrlSucceeded && firstSuccess) {
    return {
        status: 'verified',
        method: 'subpath-probe',
        validatedUrl: firstSuccess.url,
        note: `Link header pointed to ${hintUrl} (404), found at ${firstSuccess.url}`
    };
}
```

---

## URL Normalization: Redirect-First

> Always use the final resolved URL (post-redirect) as the probe base. Never build probe URLs from raw user input.

Unkey redirects `unkey.com` → `www.unkey.com`. If we build probe URLs before following redirects, we probe the wrong host.

```typescript
// In the prefetch step, capture the final URL:
const response = await fetch(targetUrl, { redirect: 'follow' });
const finalUrl = response.url;  // e.g., https://www.unkey.com/docs/quickstart/apis/nextjs
const baseUrl = new URL(finalUrl).origin;  // https://www.unkey.com

// All subsequent probes use baseUrl derived from finalUrl
```

---

## Phase 1: Signal Harvest

Extracts all signals from data we already have — the prefetched HTML body, HTTP response headers, and robots.txt content. Zero extra HTTP calls.

### Input

- `html`: Prefetched page HTML body
- `headers`: HTTP response headers from page fetch
- `robotsContent`: Already-fetched robots.txt content

### Output

```typescript
interface HarvestedSignals {
    // llms.txt hints (URLs to validate — NOT proof of existence)
    llmsTxtHintUrls: string[];       // from Link header rel="llms-txt", X-Llms-Txt
    llmsFullTxtHintUrls: string[];   // from Link header rel="llms-full-txt"

    // Markdown hints
    markdownAlternateUrl: string | null;  // from <link rel="alternate" type="text/markdown">
    markdownLinkHeaderUrl: string | null; // from HTTP Link header type="text/markdown"
    mdLinksInHtml: string[];              // href="*.md" found in HTML body

    // Supporting evidence signals (not scored, not required)
    varyAccept: boolean;             // Vary: Accept header — supports markdown implementation evidence
    xRobotsTag: string | null;       // X-Robots-Tag on initial response

    // AI crawler blocking (parsed from robots.txt)
    blockedCrawlers: string[];       // e.g., ['GPTBot', 'ClaudeBot'] if Disallow: / found
    allowedCrawlers: string[];       // Crawlers explicitly allowed

    // Existing signals (already implemented, moved here)
    canonicalUrl: string | null;
    metaRobots: string | null;
    openGraphTags: Record<string, string>;
}
```

### Implementation Notes

All of this is pure string parsing on data we already have:

```typescript
function harvestSignals(html: string, headers: Headers | null, robotsContent: string | null): HarvestedSignals {
    // Parse Link header: <url>; rel="llms-txt", <url>; rel="llms-full-txt"
    // Parse X-Llms-Txt header
    // Parse robots.txt for AI crawler Disallow rules (GPTBot, ClaudeBot, PerplexityBot, etc.)
    // Parse <link rel="alternate" type="text/markdown"> from HTML
    // Parse Vary header for "Accept" (supporting evidence only)
    // Extract .md hrefs from HTML
    // ... all synchronous, ~0ms
}
```

> **Note:** `robots.txt Llms-txt:` directive and HTML `<link rel="llms-txt">` are NOT in the primary spec or Mintlify docs. Do not parse for these in P0. They may be added as P2 experimental signals later if adoption evidence emerges.

---

## Phase 2: Parallel Probe Groups

All HTTP probes fire simultaneously via `Promise.allSettled`. Wall clock time = slowest single probe (~5s), not sum of all probes.

### Group A: llms.txt + llms-full.txt Probes

```typescript
async function probeLlmsTxt(input: {
    hintUrls: string[];
    baseUrl: string;
    docsSubpath: string | null;
    targetPath: string;
    prefetchedHeaders?: Headers;  // Optional — for MCP standalone use
}): Promise<LlmsTxtResult>
```

**Probe order (all fired in parallel, first success wins):**

| # | Candidate URL | Source |
|---|---------------|--------|
| 1 | Header hint URL(s) — resolved against final base URL | Link header, X-Llms-Txt |
| 2 | `{baseUrl}/llms.txt` | Root convention |
| 3 | `{baseUrl}{docsSubpath}/llms.txt` | Detected docs subpath |
| 4 | Walk-up from target path (capped at 3 levels) | Spec-mandated hierarchy |
| 5 | `{baseUrl}/.well-known/llms.txt` | Well-known convention (Mintlify) |

**Same pattern for llms-full.txt** with additional candidates:
- `rel="llms-full-txt"` header hint URL (Mintlify emits both in same Link header)
- Sibling of found llms.txt (replace `llms.txt` → `llms-full.txt`)
- Reference inside llms.txt content (parsed in Phase 3 after llms.txt resolves)
- `{baseUrl}/.well-known/llms-full.txt`

**MIME handling — be permissive for llms.txt files:**

Accept both `text/plain` and `text/markdown` for `llms.txt` and `llms-full.txt`. Do not warn on Content-Type. A 200 response with markdown-like body content and the expected naming is enough to count as found.

```typescript
// CORRECT: Accept either MIME type for llms.txt
const isValidLlmsTxt = response.ok && body.length > 0;  // 200 + non-empty body

// WRONG: Reject or warn based on Content-Type
if (contentType.includes('text/markdown')) {
    qualityWarning = '...';  // DO NOT DO THIS
}
```

**For page-level Markdown**, `text/markdown` remains the strongest positive signal from content negotiation.

### Group B: Markdown Probes

```typescript
async function probeMarkdown(input: {
    hints: HarvestedSignals;
    targetUrl: string;
    baseUrl: string;
    prefetchedHeaders?: Headers;  // Optional — for MCP standalone use
}): Promise<MarkdownResult>
```

**Probe order (all fired in parallel):**

| # | Method | Details |
|---|--------|---------|
| 1 | Link-alternate / Link header URL | If Phase 1 found a URL, validate it |
| 2 | Content negotiation | `GET {targetUrl}` with `Accept: text/markdown` header |
| 3 | `{targetUrl}.md` | Direct `.md` probe |

**Content negotiation implementation:**

```typescript
async function probeContentNegotiation(targetUrl: string): Promise<{
    found: boolean;
    contentType: string | null;
    llmsTxtPointer: string | null;  // Parsed from blockquote
    xRobotsTag: string | null;      // Supporting evidence (not scored)
    varyAccept: boolean;            // Supporting evidence (not scored)
}> {
    const response = await fetch(targetUrl, {
        headers: { 'Accept': 'text/markdown' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/markdown')) return { found: false, ... };

    const body = await response.text();

    // Parse Mintlify-style blockquote for llms.txt pointer
    const blockquoteMatch = body.match(/^>\s*##\s*Documentation Index[\s\S]*?(https?:\/\/[^\s)]+llms\.txt)/m);
    const llmsTxtPointer = blockquoteMatch?.[1] || null;

    // Supporting evidence signals (report if present, don't penalize if absent)
    const xRobotsTag = response.headers.get('x-robots-tag');
    const varyAccept = (response.headers.get('vary') || '').toLowerCase().includes('accept');

    return { found: true, contentType, llmsTxtPointer, xRobotsTag, varyAccept };
}
```

**Correct signal hierarchy for Markdown detection:**

| Signal | Role | Scored? |
|--------|------|---------|
| `Accept: text/markdown` → `content-type: text/markdown` response | Primary proof | Yes |
| `{url}.md` returns HTTP 200 | Primary proof | Yes |
| `<link rel="alternate" type="text/markdown">` | Discovery mechanism | Yes (discoverability) |
| `Vary: Accept` header | Supporting evidence only | No |
| `X-Robots-Tag: noindex, nofollow` on markdown response | Supporting evidence only | No |

> **Why not score `Vary: Accept` and `X-Robots-Tag`?** These are Mintlify-specific implementation details. Requiring or scoring them would favor Mintlify-hosted docs over other platforms. Keep Lensy cross-platform.

### `index.html.md` — Deferred to P2

> **Decision:** Skip `index.html.md` probing in the first refactor. Add it later only after collecting real customer sites where it is needed.

**Rationale:**
- The llms.txt proposal mentions it for directory-style URLs, but real-world tested slug routes (like Unkey) work with `{url}.md`, not `index.html.md`
- Content negotiation (`Accept: text/markdown`) covers the same use case more reliably
- Adding it now risks false positives from invented patterns like `foo.html.md`

**If added later (P2):**
- Treat as low-confidence experimental fallback only
- Only try for clearly slash-ended directory pages (e.g., `/docs/foo/`)
- Only try after content negotiation AND `{url}.md` both fail
- Never invent `foo.html.md` — only `foo/index.html.md`
- Label as `experimental` evidence status

### Group C: Extras (Experimental Signals Only)

```typescript
async function probeExtras(input: {
    baseUrl: string;
}): Promise<ExtrasResult>
```

**Probes (all parallel):**

| # | URL | Purpose | Scoring |
|---|-----|---------|---------|
| 1 | `{baseUrl}/AGENTS.md` | Vercel agent-readiness convention | Not scored — experimental |
| 2 | `{baseUrl}/.well-known/mcp.json` | MCP server discovery | Not scored — experimental |
| 3 | `{baseUrl}/sitemap.xml` | Already implemented, moved here | Scored (existing) |

> **These are experimental signals.** They can be checked and reported, but should NOT materially drive the readiness score. Report as positive bonus indicators if found, with `status: 'experimental'`.

---

## Phase 3: Cross-Reference

Runs after all probes complete. Mostly pure logic with minimal HTTP calls (only targeted follow-up probes from llms.txt content parsing).

### 3a. Validate Header Hints Against Probe Results

```typescript
// If Link header said /llms.txt but root 404'd and /docs/llms.txt succeeded:
if (hintUrl404 && subpathFound) {
    return {
        status: 'verified',
        method: 'subpath-probe',
        validatedUrl: subpathUrl,
        note: `Link header pointed to ${hintUrl} (404), verified at ${subpathUrl}`
    };
}

// If header hint succeeded directly:
if (hintUrlSucceeded) {
    return {
        status: 'verified',
        method: 'link-header',
        validatedUrl: hintUrl,
    };
}

// If header exists but all probes failed:
if (hintExists && noProbeSucceeded) {
    return {
        status: 'advertised',
        method: 'link-header',
        validatedUrl: null,
        note: `Advertised via Link header at ${hintUrl}, but URL returned 404. Checked ${checkedUrls.length} candidate paths.`
    };
}
```

### 3b. Page-Level Matching in llms.txt (First-Class Result)

This is a core detection rule, not a nice-to-have. Normalize the analyzed page URL, derive candidate markdown equivalents, and search `llms.txt` for an exact or canonicalized match.

```typescript
function checkPageInLlmsIndex(
    llmsTxtContent: string,
    targetUrl: string
): { listed: boolean; asMarkdown: boolean; matchedUrl: string | null } {
    const normalizedTarget = normalizeUrl(targetUrl);

    // Extract all URLs from llms.txt (markdown link format: [Title](url))
    const urlRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = urlRegex.exec(llmsTxtContent)) !== null) {
        const listedUrl = normalizeUrl(match[2]);
        if (listedUrl === normalizedTarget ||
            listedUrl === normalizedTarget + '.md' ||
            listedUrl.replace(/\.md$/, '') === normalizedTarget) {
            return {
                listed: true,
                asMarkdown: listedUrl.endsWith('.md'),
                matchedUrl: match[2]
            };
        }
    }
    return { listed: false, asMarkdown: false, matchedUrl: null };
}
```

> **Why first-class?** On Unkey, the analyzed page `/docs/quickstart/apis/nextjs` is explicitly listed in llms.txt as `/docs/quickstart/apis/nextjs.md`. This would have confirmed page-level markdown discoverability even if all other probes failed.

### 3c. Parse llms.txt Content for llms-full.txt Reference

```typescript
if (!llmsFullTxtFound && llmsTxtContent) {
    const fullRef = llmsTxtContent.match(/\[.*?\]\(([^)]*llms-full\.txt[^)]*)\)/);
    if (fullRef) {
        const result = await checkUrl(resolveUrl(baseUrl, fullRef[1]));
        if (result.found) {
            llmsFullTxt = { status: 'verified', method: 'llms-txt-reference', validatedUrl: fullRef[1] };
        }
    }
}
```

### 3d. Use Content Negotiation Blockquote as llms.txt Fallback

```typescript
// If content negotiation found a llms.txt pointer in the blockquote
// and we haven't found llms.txt yet, probe it
if (llmsTxt.status !== 'verified' && markdownResult.llmsTxtPointer) {
    const result = await checkUrl(markdownResult.llmsTxtPointer, true);
    if (result.found) {
        llmsTxt = {
            status: 'verified',
            method: 'content-negotiation-blockquote',
            validatedUrl: markdownResult.llmsTxtPointer
        };
    }
}
```

### 3e. OpenAPI Spec Detection in llms.txt Content

```typescript
// If llms.txt has an ## OpenAPI Specs section, extract spec URLs
if (llmsTxtContent) {
    const openapiSection = llmsTxtContent.match(/##\s*OpenAPI\s*Specs?[\s\S]*?(?=\n##|\n$|$)/i);
    if (openapiSection) {
        const specUrls = [...openapiSection[0].matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)]
            .map(m => m[2]);
        // Report as bonus signal — not scored
    }
}
```

### 3f. Build Site-Level vs Page-Level Report

```typescript
interface DetectionReport {
    // Site-level signals
    site: {
        llmsTxt: DetectionSignal;
        llmsFullTxt: DetectionSignal;
        sitemap: DetectionSignal;
        agentsMd: DetectionSignal;      // experimental
        mcpJson: DetectionSignal;       // experimental
        blockedAiCrawlers: string[];
        openApiSpecs: string[];         // URLs found in llms.txt OpenAPI section
    };

    // Page-level signals
    page: {
        markdown: DetectionSignal;
        llmsTxtMapping: DetectionSignal;          // is this page listed in llms.txt?
        llmsTxtMarkdownMapping: DetectionSignal;  // is it listed as a .md URL?
        contentNegotiation: DetectionSignal;
    };
}
```

**Five explicit outputs the report must provide:**

1. Site has `llms.txt` — with evidence status and validated URL
2. Site has `llms-full.txt` — with evidence status and validated URL
3. Page has markdown representation — with method (content negotiation, direct .md, etc.)
4. Page is listed in `llms.txt` — boolean + matched URL
5. Page is listed as markdown in `llms.txt` — boolean (URL ends in .md)

---

## Latency Comparison

| Scenario | Current (sequential) | Proposed (parallel) | Savings |
|----------|---------------------|---------------------|---------|
| Today's 5-8 probes | 25-40s | ~5s | 80-87% |
| With new methods (~12 probes) | 60-75s (risky) | ~5-7s | 90-93% |
| Future additions (~15 probes) | 75-100s (would timeout) | ~5-7s | 93-95% |

Wall clock time stays ~5s regardless of probe count because all probes fire in parallel. The time is bounded by the slowest single probe (5s `checkUrl` timeout), not the sum.

---

## Why Not Sub-Agents or Separate Lambdas?

| Approach | Pros | Cons |
|----------|------|------|
| **Sub-agents (separate Lambdas)** | True isolation, independent scaling | Cold starts (+1-3s each), orchestration overhead, data sharing complexity (need S3/SQS), higher cost, more infrastructure |
| **Parallel probe groups (Promise.allSettled in same Lambda)** | Zero overhead, shared data (HTML, headers, robots.txt), simple error handling, easy to add new probes | All probes share Lambda memory/timeout (not an issue — I/O bound, not CPU) |
| **LangGraph agent loop** | Can reason dynamically about what to probe | 20s overhead per LLM round-trip, unpredictable execution, expensive |

**Decision: Parallel probe groups within the existing Lambda.** The bottleneck is I/O wait (HTTP calls to external servers), not compute. We have 1GB RAM and 15 minutes — plenty of headroom.

---

## Frontend Reporting Language

### Use evidence-aware language

**Prefer:**
- "Verified at /docs/llms.txt"
- "Advertised via Link header"
- "Mapped to this page via llms.txt"
- "Not verified from tested paths"

**Avoid:**
- "No llms.txt" (unless truly proven across all tested strategies)
- "No Markdown support" (unless all probes exhausted)

### Show what was found, how, and whether verified

Each detection row should display:
- **What:** The signal (llms.txt, markdown, etc.)
- **Status badge:** Verified / Advertised / Not verified / Experimental
- **Detail (expandable):** Validated URL, discovery method, tested paths

---

## Implementation Plan

### Step 1: Refactor check-ai-readiness.ts into 3 phases

**Files to modify:**
- `backend/lambda/agent-handler/tools/check-ai-readiness.ts`

**Changes:**
- Extract `harvestSignals()` as a pure function (Phase 1)
- Extract `probeLlmsTxt()`, `probeMarkdown()`, `probeExtras()` as pure async functions (Phase 2)
- Extract `crossReference()` as a pure function with minimal follow-up probes (Phase 3)
- Replace sequential `checkUrl()` loop with `Promise.allSettled()` batches
- Ensure all core functions are side-effect-free (no WebSocket, no S3 — see MCP section)

### Step 2: Add new detection methods (P0)

**Phase 1 — Signal Harvest (zero-cost):**
- Parse `Link` header for `rel="llms-txt"` AND `rel="llms-full-txt"`
- Parse `X-Llms-Txt` header
- Parse robots.txt for AI crawler Disallow rules (GPTBot, ClaudeBot, PerplexityBot, anthropic-ai, OAI-SearchBot, Google-Extended)
- Parse `Vary: Accept` header (supporting evidence only, not scored)
- Parse `<link rel="alternate" type="text/markdown">` from HTML

**Phase 2 — Parallel Probes:**
- Content negotiation: `Accept: text/markdown` (Group B)
- `{url}.md` direct probe (Group B)
- `/.well-known/llms.txt` and `/.well-known/llms-full.txt` candidates (Group A)
- Hierarchical subpath traversal — walk up from target URL, cap at 3 levels (Group A)
- Validate all header hint URLs with actual probes (Group A)
- AGENTS.md detection — experimental signal (Group C)
- `/.well-known/mcp.json` detection — experimental signal (Group C)

**Phase 3 — Cross-Reference:**
- Validate header hints against probe results, classify evidence status
- Page-level matching in llms.txt content (first-class result)
- Parse llms.txt content for llms-full.txt reference
- Parse markdown response blockquote for llms.txt pointer
- OpenAPI spec detection in llms.txt content
- Build site-level vs page-level report with evidence statuses

### Step 3: Implement evidence-aware return schema

**Changes to `AIReadinessResult` type:**
- Replace boolean `found` fields with `DetectionSignal` objects (status, method, validatedUrl, audience, confidence, note)
- Add `site` and `page` sub-objects
- Ensure five explicit outputs: site llms.txt, site llms-full.txt, page markdown, page in llms.txt, page as markdown in llms.txt

### Step 4: Update frontend to display evidence states

**Files to modify:**
- `frontend/src/LensyApp.tsx`

**Changes:**
- Display evidence status badges (Verified / Advertised / Not verified / Experimental)
- Show discovery method and validated URL
- Use evidence-aware language (see Frontend Reporting Language section)
- Display page-level vs site-level status separately
- Show AI crawler blocking warnings
- Add AGENTS.md and MCP as experimental bonus indicators (no score impact)

### Step 5: Sync legacy pipeline

**Files to modify:**
- `backend/lambda/ai-readiness-checker/index.ts`

**Changes:**
- Apply same parallel probe pattern
- Keep feature parity with agent pipeline

---

## Behaviors Explicitly Dropped

These were in earlier drafts but are removed from the implementation spec:

| Dropped Behavior | Reason |
|-----------------|--------|
| Warning on llms.txt being served as `text/markdown` | Accept both `text/plain` and `text/markdown` permissively |
| Treating `Vary: Accept` as required or scored | Supporting evidence only — avoids favoring Mintlify |
| Treating `X-Robots-Tag` as required or scored | Supporting evidence only |
| Treating header hints as proof of existence | Headers are hints — always validate with HTTP probe |
| `index.html.md` as a general probe candidate | Deferred to P2 — add only with real-world evidence |
| `robots.txt Llms-txt:` directive parsing | Not in primary spec or Mintlify docs — P2 experimental at best |
| HTML `<link rel="llms-txt">` parsing | Near-zero adoption — P2 experimental at best |
| `cf-transform` header check | Does not exist in Cloudflare docs — removed entirely |
| AGENTS.md / MCP affecting main readiness score | Experimental signals only — report but don't score |

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Too many parallel HTTP calls overwhelm target server | Low — max ~12 calls spread across different paths | Add 50ms stagger between probe batches if needed |
| Content negotiation probe returns unexpected format | Medium | Validate `Content-Type: text/markdown` before parsing body |
| Hierarchical walk-up adds too many candidates for deep URLs | Low | Cap walk-up depth at 3 levels |
| Header hints cause false positives | Already happened (Unkey) | Evidence model — headers marked as `advertised` until probe confirms |
| Lambda memory spike from parallel responses | Very low — text responses are small | Already have 1GB, responses are <100KB each |

---

## Priority Order

### P0 — This Refactor

- Extract pure analysis core (harvestSignals, probes, crossReference)
- Parallelize probes via `Promise.allSettled`
- Add evidence-aware statuses to return schema
- Treat headers as hints only — always validate
- Support `llms-full.txt` as first-class (including `rel="llms-full-txt"`)
- Elevate page mapping in llms.txt to first-class result
- Add content negotiation (`Accept: text/markdown`)
- Add `/.well-known/llms.txt` and `/.well-known/llms-full.txt`
- Add hierarchical subpath traversal
- Accept both `text/plain` and `text/markdown` for llms.txt files
- Check `Vary: Accept` and `X-Robots-Tag` as supporting evidence (not scored, not penalized)
- Redirect-first URL normalization

### P1 — Reporting Improvements

- Parse markdown blockquote for llms.txt pointer
- Improve frontend wording and evidence display
- Add experimental probes with low-confidence labeling (AGENTS.md, mcp.json)
- OpenAPI spec detection in llms.txt content
- Display discovery method for each finding

### P2 — Future Exploration

- Revisit `index.html.md` after collecting real-world examples
- Add broader MCP-facing adapters and narrow tools
- Decide whether AGENTS.md / MCP support should become a scored bonus later
- `robots.txt Llms-txt:` directive (if adoption evidence emerges)
- HTML `<link rel="llms-txt">` (if adoption evidence emerges)

---

## Future Goal: MCP Server Compatibility

> **Important context for reviewers:** We plan to build a Lensy MCP server in the future, allowing AI agents (Cursor, Claude Code, etc.) to call Lensy's analysis capabilities directly as MCP tools. Keep this goal in mind when reviewing the architecture — design decisions made now should not create rework later.
>
> **Guiding principle:** MCP should shape the code boundaries now, not the scoring philosophy yet.

### Design Principle: Core Functions + Adapters

The refactored probe functions should be **pure analysis with no side effects** — no WebSocket publishing, no S3 writes, no progress tracking baked in. Side effects belong in an adapter layer that wraps the core functions.

```
Core analysis functions (pure logic, return data)
    ├── harvestSignals(html, headers, robotsContent) → HarvestedSignals
    ├── probeLlmsTxt(baseUrl, targetUrl, ...) → LlmsTxtResult
    ├── probeMarkdown(targetUrl, baseUrl, ...) → MarkdownResult
    ├── probeExtras(baseUrl) → ExtrasResult
    └── crossReference(allResults) → DetectionReport
         ↕
Adapter layer (adds side effects per context)
    ├── Lambda adapter (current)
    │   └── Adds: WebSocket progress, S3 writes, orchestration, watchdog timer
    └── MCP adapter (future)
        └── Adds: MCP tool schema, request/response wrapping, auth
```

### Concrete Guidelines for This Refactor

1. **Functions should accept optional prefetched data.** In the Lambda flow, HTML and headers are prefetched once and shared. In an MCP tool call, they may not exist yet. Design functions to fetch their own data if not provided:

    ```typescript
    // GOOD: Works standalone (MCP) or with shared data (Lambda)
    async function probeLlmsTxt(input: {
        baseUrl: string;
        targetUrl: string;
        docsSubpath?: string;
        prefetchedHeaders?: Headers;  // Optional — fetches page headers if not provided
    }): Promise<LlmsTxtResult>

    // BAD: Requires caller to always provide prefetched data
    async function probeLlmsTxt(
        baseUrl: string,
        headers: Headers,  // Required — breaks standalone use
    ): Promise<LlmsTxtResult>
    ```

2. **No progress publishing inside core functions.** Progress updates should happen in the Lambda adapter, not in the probe functions:

    ```typescript
    // GOOD: Core function is pure
    const llmsResult = await probeLlmsTxt(input);
    await progress.categoryUpdate('llms.txt', llmsResult);  // Adapter concern

    // BAD: Progress baked into core function
    async function probeLlmsTxt(input) {
        await progress.info('Checking llms.txt...');  // Side effect — breaks MCP use
    }
    ```

3. **No S3 writes inside core functions.** Return the data; let the caller decide storage:

    ```typescript
    // GOOD: Return data, caller stores it
    const report = await crossReference(allResults);
    await writeSessionArtifact(sessionId, 'report.json', report);  // Adapter concern

    // BAD: Writes to S3 inside the function
    async function crossReference(results) {
        const report = buildReport(results);
        await writeSessionArtifact(sessionId, 'report.json', report);  // Side effect
    }
    ```

4. **Return types should be self-contained.** Each function's return type should include everything needed to render a result — no implicit dependencies on other functions' outputs that only exist in shared Lambda state.

### Future MCP Tool Mapping

When we build the MCP server, the core functions map to individual tools:

| Core Function | MCP Tool | Use Case |
|---------------|----------|----------|
| `probeLlmsTxt()` | `check_llms_txt` | "Does this site have llms.txt?" |
| `probeMarkdown()` | `check_markdown` | "Can I get this page as markdown?" |
| `probeExtras()` | `check_agent_support` | "Does this site support AGENTS.md / MCP?" |
| `harvestSignals()` + all probes + `crossReference()` | `full_audit` | "Run the complete AI readiness analysis" |
| `crossReference().page` | `check_page_readiness` | "Is this specific page AI-ready?" |

This mapping only works cleanly if the core functions are side-effect-free and self-contained.

---

## Open Questions for Review

1. **Probe staggering:** Should we add a small delay (50ms) between probe batches to avoid overwhelming target servers, or fire everything at once?
2. **Walk-up depth cap:** Suggested cap at 3 levels (e.g., `/docs/quickstart/apis/` → `/docs/quickstart/llms.txt` → `/docs/llms.txt` → `/llms.txt`). Is 3 right or should it be 2?
3. **Legacy pipeline:** Should we invest in keeping `ai-readiness-checker/index.ts` in sync, or deprecate it and go all-in on the agent pipeline?
4. **Frontend card layout:** Site-level and page-level results could be two separate cards or one card with sub-sections. Which approach?
5. **MCP readiness:** Does the core function / adapter separation feel right for eventual MCP tool exposure, or do we need further decoupling?
