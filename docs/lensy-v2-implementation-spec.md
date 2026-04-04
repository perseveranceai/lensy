# Lensy v2 Implementation Spec — Detection + UI/UX

> **Status:** Final consolidated spec. Incorporates the parallel detection architecture, UI/UX cleanup spec, developer redline decisions, and all review feedback. Ready for implementation.

---

## Table of Contents

1. [Context and Problem](#1-context-and-problem)
2. [Decision Summary](#2-decision-summary)
3. [Evidence Model](#3-evidence-model)
4. [Backend: Detection Architecture](#4-backend-detection-architecture)
5. [Backend: Detection Methods](#5-backend-detection-methods)
6. [Backend: Result Schema](#6-backend-result-schema)
7. [Frontend: UI/UX Spec](#7-frontend-uiux-spec)
8. [Frontend: Section-by-Section Spec](#8-frontend-section-by-section-spec)
9. [Frontend: Recommendations](#9-frontend-recommendations)
10. [Frontend: Language and Copy Guidance](#10-frontend-language-and-copy-guidance)
11. [Behaviors Explicitly Dropped](#11-behaviors-explicitly-dropped)
12. [Implementation Plan](#12-implementation-plan)
13. [Risk Assessment](#13-risk-assessment)
14. [Future Goal: MCP Server Compatibility](#14-future-goal-mcp-server-compatibility)
15. [Open Questions](#15-open-questions)

---

## 1. Context and Problem

### The Unkey Incident

A customer (Unkey CEO) reported that Lensy incorrectly said their site had no llms.txt, no markdown support, and was missing features they clearly had. Investigation revealed:

- Unkey's llms.txt lives at `/docs/llms.txt`, not the root — Lensy only checked root
- Unkey supports content negotiation (`Accept: text/markdown`) — Lensy didn't check
- Unkey's `Link` header advertises `/llms.txt` at root, which 404s — the real file is under `/docs/`
- The analyzed page is explicitly listed in llms.txt as a `.md` URL — Lensy didn't check

### Root Cause

Two problems:

1. **Detection gaps:** Single-path probing, no content negotiation, no header parsing, no page-level llms.txt matching
2. **Evidence compression:** The UI collapses multiple detection states into simple "found/not found," making false negatives look like definitive claims

### Performance Bottleneck

The current `check-ai-readiness.ts` makes 5-8 sequential HTTP calls at 5s timeout each (25-40s wall clock). Adding new detection methods would push to 15-20 calls — 75-100s, hitting the Lambda timeout.

---

## 2. Decision Summary

**Backend:**
- Refactor into 3-phase architecture: signal harvest → parallel probes → cross-reference
- All probes fire via `Promise.allSettled` within the same Lambda (~5s wall clock regardless of probe count)
- Pure analysis core + adapter layer (MCP-ready)
- Evidence-aware return schema (not boolean found/not-found)

**Frontend:**
- Evidence-aware statuses throughout the report (Verified / Advertised / Mapped / Not verified / Experimental)
- Site-level vs page-level separation
- Audience tagging (AI search vs coding agents)
- Suppress recommendations when support is already verified
- Evidence-aware copy ("not verified from tested paths" instead of "No llms.txt")

**Phasing:**
- P0: Discoverability section (highest customer pain — source of Unkey complaint)
- P1: Remaining sections, recommendation improvements, evidence drawers
- P2: Advanced features, experimental signals, trend/history

---

## 3. Evidence Model

All detection signals use evidence-aware states instead of simple found/not-found booleans. This is the shared contract between backend and frontend.

```typescript
type EvidenceStatus = 'verified' | 'advertised' | 'mapped' | 'not_verified' | 'experimental'

type DetectionSignal = {
    status: EvidenceStatus;
    method?: string;               // e.g., 'link-header', 'content-negotiation', 'subpath-probe'
    validatedUrl?: string | null;  // the actual URL that returned HTTP 200
    audience?: 'ai_search' | 'coding_agents' | 'both';
    note?: string | null;          // e.g., 'Link header pointed to /llms.txt (404), found at /docs/llms.txt'
}
```

| Status | Meaning | Example | UI Color |
|--------|---------|---------|----------|
| `verified` | Live HTTP 200 with valid content | llms.txt fetched at /docs/llms.txt | Green |
| `advertised` | Signal exists but URL not validated or 404'd | Link header says /llms.txt but root 404s | Amber |
| `mapped` | Page found in llms.txt index | /docs/quickstart/apis/nextjs.md listed in llms.txt | Green (stronger — page-specific) |
| `not_verified` | All probes failed across all tested paths | No llms.txt at any candidate URL | Red |
| `experimental` | Emerging standard, not widely adopted | AGENTS.md found at root | Gray |

---

## 4. Backend: Detection Architecture

### Current Architecture (Bottleneck)

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

### Proposed Architecture

```
API Handler → Agent Lambda
                  ↓
            Prefetch HTML + Content Gate
            (use final resolved URL post-redirect as probe base)
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
│  │   probes     │   probes     │ (experimental)│     │
│  │              │              │              │      │
│  │ •header hint │ •content     │ •AGENTS.md   │      │
│  │  (validate!) │  negot.      │ •.well-known/│      │
│  │ •root        │ •{url}.md    │  mcp.json    │      │
│  │ •subpath     │              │ •sitemap     │      │
│  │ •walk-up     │              │              │      │
│  │ •.well-known │              │              │      │
│  └──────────────┴──────────────┴──────────────┘      │
│  All groups run via Promise.allSettled                │
│                                                      │
│  PHASE 3: Cross-Reference (0 HTTP calls, ~0ms)       │
│  Validate hints, merge results, classify evidence    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Latency Comparison

| Scenario | Current (sequential) | Proposed (parallel) | Savings |
|----------|---------------------|---------------------|---------|
| Today's 5-8 probes | 25-40s | ~5s | 80-87% |
| With new methods (~12 probes) | 60-75s (risky) | ~5-7s | 90-93% |
| Future additions (~15 probes) | 75-100s (would timeout) | ~5-7s | 93-95% |

### Why Not Sub-Agents or Separate Lambdas?

| Approach | Pros | Cons |
|----------|------|------|
| **Sub-agents (separate Lambdas)** | True isolation, independent scaling | Cold starts (+1-3s), orchestration overhead, data sharing complexity, higher cost |
| **Parallel probe groups (Promise.allSettled)** | Zero overhead, shared data, simple error handling | All probes share Lambda memory/timeout (not an issue — I/O bound) |
| **LangGraph agent loop** | Dynamic reasoning | 20s overhead per LLM round-trip, unpredictable, expensive |

**Decision: Parallel probe groups within the existing Lambda.**

---

## 5. Backend: Detection Methods

### Critical Design Rules

**Rule 1: Headers are hints, not proof.**

Never mark `llms.txt` or `llms-full.txt` as found based only on headers. Always probe the hinted URL. If it 404s, fall back to other candidates.

```typescript
// WRONG: Trust header blindly
if (linkHeader.has('rel=llms-txt')) return { status: 'verified' };

// RIGHT: Use header as first probe candidate, verify with HTTP 200
const candidates = [...hintUrls, `${baseUrl}/llms.txt`, ...otherCandidates];
const results = await Promise.allSettled(candidates.map(url => checkUrl(url, true)));
```

**Rule 2: Redirect-first URL normalization.**

Always use the final resolved URL (post-redirect) as probe base. Unkey redirects `unkey.com` → `www.unkey.com`.

**Rule 3: MIME permissiveness for llms.txt files.**

Accept both `text/plain` and `text/markdown`. Do not warn on Content-Type. For page-level markdown, `text/markdown` remains the strongest signal.

### Phase 1: Signal Harvest (Zero HTTP Calls)

Parse from prefetched HTML body, HTTP response headers, and robots.txt:

```typescript
interface HarvestedSignals {
    llmsTxtHintUrls: string[];       // Link header rel="llms-txt", X-Llms-Txt
    llmsFullTxtHintUrls: string[];   // Link header rel="llms-full-txt"
    markdownAlternateUrl: string | null;  // <link rel="alternate" type="text/markdown">
    markdownLinkHeaderUrl: string | null; // HTTP Link header type="text/markdown"
    mdLinksInHtml: string[];              // href="*.md" in HTML
    varyAccept: boolean;             // Supporting evidence only, not scored
    xRobotsTag: string | null;       // Supporting evidence only, not scored
    blockedCrawlers: string[];       // GPTBot, ClaudeBot, etc. with Disallow rules
    allowedCrawlers: string[];
    canonicalUrl: string | null;
    metaRobots: string | null;
    openGraphTags: Record<string, string>;
}
```

> **Not parsed in P0:** `robots.txt Llms-txt:` directive, HTML `<link rel="llms-txt">` — not in primary spec or Mintlify docs. P2 experimental at best.

### Phase 2: Parallel Probe Groups

#### Group A — llms.txt + llms-full.txt

All fired in parallel, first success wins:

| # | Candidate | Source |
|---|-----------|--------|
| 1 | Header hint URL(s) resolved against final base URL | Link header, X-Llms-Txt |
| 2 | `{baseUrl}/llms.txt` | Root convention |
| 3 | `{baseUrl}{docsSubpath}/llms.txt` | Detected docs subpath |
| 4 | Walk-up from target path (cap at 3 levels) | Lensy heuristic — improves coverage for nested doc sites |
| 5 | `{baseUrl}/.well-known/llms.txt` | Well-known convention (Mintlify) |

Same pattern for llms-full.txt, plus:
- `rel="llms-full-txt"` header hint URL
- Sibling of found llms.txt path
- `{baseUrl}/.well-known/llms-full.txt`
- Reference inside llms.txt content (Phase 3 follow-up)

#### Group B — Markdown

| # | Method | Details |
|---|--------|---------|
| 1 | Link-alternate / Link header URL | Validate if Phase 1 found one |
| 2 | Content negotiation | `GET {targetUrl}` with `Accept: text/markdown` |
| 3 | `{targetUrl}.md` | Direct `.md` probe |

**Content negotiation:** If response is `text/markdown`, also parse the top blockquote for a `llms.txt` pointer (Mintlify prepends `> ## Documentation Index` with llms.txt URL).

**Signal hierarchy:**

| Signal | Role | Scored? |
|--------|------|---------|
| Content negotiation → `text/markdown` | Primary proof | Yes |
| `{url}.md` returns HTTP 200 | Primary proof | Yes |
| `<link rel="alternate" type="text/markdown">` | Discovery mechanism | Yes |
| `Vary: Accept` header | Supporting evidence only | **No** |
| `X-Robots-Tag: noindex` on markdown response | Supporting evidence only | **No** |

> **Why not score `Vary: Accept` and `X-Robots-Tag`?** Mintlify-specific implementation details. Scoring them would favor one platform. Keep Lensy cross-platform.

**`index.html.md` — Deferred to P2.** Skip in first refactor. Real-world slug routes use `{url}.md`. Content negotiation covers directory URLs. Add later only with real customer evidence.

#### Group C — Extras (Experimental Only)

| # | URL | Purpose | Scored? |
|---|-----|---------|---------|
| 1 | `{baseUrl}/AGENTS.md` | Vercel agent-readiness convention | **No** — experimental |
| 2 | `{baseUrl}/.well-known/mcp.json` | MCP server discovery | **No** — experimental |
| 3 | `{baseUrl}/sitemap.xml` | Standard | Yes (existing) |

### Phase 3: Cross-Reference

After all probes complete:

1. **Validate header hints against probe results** — If hinted URL 404'd but subpath succeeded, report both with a note
2. **Page-level matching in llms.txt** (first-class result) — Normalize analyzed page URL, search llms.txt for exact or `.md` variant match
3. **Parse llms.txt for llms-full.txt reference** — Follow-up probe if not found by direct probing
4. **Parse content negotiation blockquote for llms.txt pointer** — Fallback discovery if llms.txt not yet found
5. **OpenAPI spec detection in llms.txt** — Extract URLs from `## OpenAPI Specs` section (bonus signal, not scored)
6. **Build site-level vs page-level report** with evidence statuses

---

## 6. Backend: Result Schema

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
        openApiSpecs: string[];
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
3. Page has markdown representation — with discovery method
4. Page is listed in `llms.txt` — mapped status + matched URL
5. Page is listed as markdown in `llms.txt` — mapped status (URL ends in .md)

**Recommendation object additions:**

```typescript
interface Recommendation {
    title: string;
    evidence: string;              // "Why Lensy believes this"
    audience: 'ai_search' | 'coding_agents' | 'both';
    impact: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    category: string;
    fix: string;
    codeSnippet?: string;
    suppressIfVerified?: boolean;  // Don't show if related signal is verified
}
```

---

## 7. Frontend: UI/UX Spec

### Product Goals

The audit should help users answer five questions quickly:

1. Can AI systems access this page at all?
2. Can AI systems discover the docs structure around this page?
3. Can coding agents consume this page efficiently?
4. Is this exact page mapped into the site's machine-friendly surfaces?
5. What should the docs owner do next, and why?

### Core UX Principles

- **Trust over compression** — expose evidence quality, not just verdicts
- **Actionability over novelty** — recommendations must be specific and achievable
- **Evidence before recommendations** — show what was found before suggesting fixes
- **Distinguish page-level from site-level** — "site has llms.txt" ≠ "this page is in llms.txt"
- **Distinguish AI search from coding agents** — different audiences care about different signals

### Strengths to Preserve

- Overall score + letter grade shown prominently
- Four major sections: Bot Access, Structured Data, Discoverability, Content Quality
- Recommendation cards with effort/impact framing
- Separate AI Citations action
- Document-confidence signal ("Likely a doc page")

### Information Architecture

```
1. Header summary (score + grade + verdict + evidence chips)
2. Section cards (Bot Access, Structured Data, Discoverability, Content Quality)
3. Recommendations (sorted by priority, with audience tags)
4. AI Citations (separate action, user-triggered)
```

### Header Summary

**Keep:** Score + grade + doc-confidence signal

**Add:**
- One-line verdict: `Strong overall. 9 findings verified, 2 hinted, 0 blockers.`
- Audience readiness (secondary row, not competing with score): `AI search: partial` · `Coding agents: strong`

### Visual Design

- Summaries first, expand details on demand
- Collapse perfect sections by default
- One surface style for all cards, semantic colors only for status
- Evidence badges must use both color AND text/icon (never color alone)

| State | Color | Badge |
|-------|-------|-------|
| Verified | Green | `✓ Verified` |
| Advertised | Amber | `⚠ Advertised` |
| Mapped | Green (strong) | `◉ Mapped to this page` |
| Not verified | Red | `✗ Not verified` |
| Experimental | Gray | `◇ Experimental` |

### Interaction Pattern (Per Section Card)

- **Top row:** Section score + 1-line summary
- **Middle:** 3-6 signal rows (compact — status badge + label)
- **Bottom:** "Show evidence" expandable drawer with validated URLs, methods, tested paths

---

## 8. Frontend: Section-by-Section Spec

### Bot Access

**Keep:** Bot-level allow/block from robots.txt, section score.

**Change:**
- Lead with summary sentence: `All major AI crawlers are allowed by robots.txt.`
- Show source URL inline
- Group bots into categories: AI search bots · AI training bots · Classic search bots
- If all allowed, collapse row list by default
- If some blocked, pin those to top with emphasis

**Row format:** `GPTBot — Allowed` · `ClaudeBot — Allowed` · `PerplexityBot — Blocked`

### Structured Data

**Keep:** JSON-LD, schema completeness, OpenGraph, breadcrumbs.

**Change:**
- Show detected schema types before listing issues
- Replace "incomplete" with field-level messages: `Missing field: url`
- Separate machine-parseable structure from social-preview metadata

**Suggested rows:**
- `JSON-LD detected — Verified`
- `Schema completeness — Missing: url`
- `OpenGraph tags — Complete`
- `Breadcrumb markup — Present`

### Discoverability (Most Important Section to Improve)

**Problem today:** Compresses into "llms.txt found / sitemap found / canonical set" — too coarse for modern AI-doc surfaces, too brittle when detection is imperfect.

**Break into these rows:**

| Signal | Status | Method | URL | Audience |
|--------|--------|--------|-----|----------|
| llms.txt | Verified | Direct fetch | `/docs/llms.txt` | Both |
| llms-full.txt | Verified | Link header + fetch | `/docs/llms-full.txt` | Coding agents |
| Page Markdown | Verified | `Accept: text/markdown` | Same URL | Coding agents |
| Page in llms.txt | Mapped | Exact `.md` match | `/docs/.../nextjs.md` | Both |
| Sitemap | Verified | Standard fetch | `/sitemap.xml` | AI search |
| Canonical URL | Verified | HTML tag | Page head | AI search |

Each row displays: status badge, method label, validated URL, audience badge.

### Content Quality

**Keep:** Headings, word count, internal links, code blocks.

**Change:** Split internally into two subgroups:

**Content Structure:**
- Heading hierarchy
- Chunk count estimate
- Word count depth
- Internal cross-linking

**AI Consumability:**
- Markdown representation available
- Text-to-HTML ratio risk
- Code block language hints

**Important nuance:** If markdown is verified, downgrade text-to-HTML ratio for coding-agent use cases. Still flag for HTML-first AI search crawlers, but don't present as universal blocker.

**Suggested copy:**
- `8 code blocks found; 0 include language hints`
- `Low text-to-HTML ratio may reduce extraction quality for HTML-first crawlers`
- `Heading structure supports clean chunking: 1 H1, 9 H2, 6 H3`

---

## 9. Frontend: Recommendations

### Card Format (5 elements)

Every recommendation card should have:

| Element | Example |
|---------|---------|
| **Title** | `Very low text-to-HTML ratio` |
| **Why Lensy believes this** | `Main content is only 0.8% of the delivered HTML` |
| **Who benefits** | `Primarily AI search crawlers` |
| **Tags** | `High impact` · `Low effort` · `Consumability` |
| **Fix** | `Reduce non-content HTML weight or ensure markdown variant is exposed` |

### Ordering

1. Incorrect-claim / false-negative prevention
2. High-impact discovery and access issues
3. Page-mapping and markdown-consumption issues
4. Structured data cleanup
5. Low-impact polish

### Suppression Rules

Do NOT recommend actions that the audit has already verified as present:

| If verified... | Suppress recommendation... |
|----------------|--------------------------|
| llms.txt validated successfully | "Add llms.txt" |
| Content negotiation or .md verified | "Serve Markdown" |
| Markdown available | Downgrade text-to-HTML and code hints to "AI search only" |

### Rendering Rules

- If status is `advertised` → render amber, do not phrase as confirmed
- If status is `mapped` → show stronger positive badge (page-specific)
- If recommendation conflicts with verified signal → suppress
- If markdown is verified → downgrade HTML-noise warnings for coding-agent messaging

---

## 10. Frontend: Language and Copy Guidance

### Avoid Absolute Claims Unless Directly Proven

**Avoid:**
- `No llms.txt`
- `No Markdown support`
- `AI tools cannot consume your docs`

**Prefer:**
- `llms.txt was not verified from the tested paths`
- `Markdown was advertised but not validated`
- `Site-level support was found, but page mapping was not confirmed`
- `This issue appears to affect AI search more than coding agents`

### Recommendation Copy Pattern

Use: Observation → Consequence → Action

Example: `This page serves Markdown when requested, but was not confirmed as listed in llms.txt. Coding agents can still consume it directly, but some systems may not discover it from the docs index. Add or verify the page's Markdown URL inside llms.txt.`

---

## 11. Behaviors Explicitly Dropped

| Dropped Behavior | Reason |
|-----------------|--------|
| Warning on llms.txt served as `text/markdown` | Accept both `text/plain` and `text/markdown` permissively |
| `Vary: Accept` as required or scored | Supporting evidence only — avoids favoring Mintlify |
| `X-Robots-Tag` as required or scored | Supporting evidence only |
| Header hints treated as proof | Always validate with HTTP probe |
| `index.html.md` as P0 probe candidate | Deferred to P2 — add only with real-world evidence |
| `robots.txt Llms-txt:` directive | Not in primary spec — P2 experimental at best |
| HTML `<link rel="llms-txt">` | Near-zero adoption — P2 experimental |
| `cf-transform` header check | Does not exist in Cloudflare docs — removed entirely |
| AGENTS.md / MCP affecting readiness score | Experimental signals only — report but don't score |

---

## 12. Implementation Plan

### P0 — Sprint 1

**Backend:**
- Extract pure analysis core functions (harvestSignals, probes, crossReference) — side-effect-free
- Parallelize probes via `Promise.allSettled`
- Implement evidence-aware return schema (`DetectionSignal` with status/method/validatedUrl)
- Add content negotiation (`Accept: text/markdown`)
- Add `Link` header parsing (`rel="llms-txt"` and `rel="llms-full-txt"`)
- Add `X-Llms-Txt` header parsing
- Add `/.well-known/llms.txt` and `/.well-known/llms-full.txt` probes
- Add hierarchical subpath traversal (walk-up, cap at 3 levels)
- Add page-level matching in llms.txt content (first-class result)
- Redirect-first URL normalization
- Treat headers as hints only — always validate
- Accept both `text/plain` and `text/markdown` for llms.txt
- Check `Vary: Accept` and `X-Robots-Tag` as supporting evidence (not scored, not penalized)
- robots.txt AI crawler block detection (GPTBot, ClaudeBot, PerplexityBot, etc.)

**Frontend:**
- Add evidence-state badges to Discoverability rows (Verified / Advertised / Mapped / Not verified)
- Separate site-level and page-level discoverability findings
- Show exact validated URLs for llms.txt, llms-full.txt, and page Markdown
- Suppress false recommendations when support is verified
- Add audience tags to recommendations
- Update copy: "not verified from tested paths" instead of "No llms.txt"

**Files to modify:**
- `backend/lambda/agent-handler/tools/check-ai-readiness.ts` — primary refactor
- `backend/lambda/ai-readiness-checker/index.ts` — legacy pipeline sync
- `frontend/src/LensyApp.tsx` — evidence states + site/page separation

### P1 — Sprint 2

**Backend:**
- Parse markdown blockquote for llms.txt pointer
- OpenAPI spec detection in llms.txt content
- Add experimental probes with low-confidence labeling (AGENTS.md, `/.well-known/mcp.json`)

**Frontend:**
- Add evidence summary row under overall score
- Split Content Quality into structure vs AI consumability
- Improve recommendation copy: "Why Lensy believes this" + "Who benefits"
- Add expandable evidence drawers to section cards
- Bot categorization (AI search / training / classic)
- Group citation results by outcome (cited / not cited / competitor cited)

### P2 — Sprint 3

**Backend:**
- Revisit `index.html.md` after collecting real-world examples
- `robots.txt Llms-txt:` directive (if adoption evidence emerges)
- Add broader MCP-facing adapters and narrow tools
- llms.txt structural validation (if customer demand)
- Markdown frontmatter validation (if customer demand)

**Frontend:**
- Technical evidence tab for advanced users
- Copy links for validated URLs
- "Manual review recommended" state when signals conflict
- Mobile layout optimization
- Trend/history support once repeat audits exist
- Progressive loading UX (evidence states update as probes resolve)

---

## 13. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Parallel HTTP calls overwhelm target server | Low — max ~12 calls across different paths | Add 50ms stagger between batches if needed |
| Content negotiation returns unexpected format | Medium | Validate `Content-Type: text/markdown` before parsing body |
| Walk-up adds too many candidates for deep URLs | Low | Cap at 3 levels |
| Header hints cause false positives | Already happened (Unkey) | Evidence model — `advertised` until probe confirms `verified` |
| Lambda memory spike from parallel responses | Very low — text responses <100KB each | Already have 1GB |
| Evidence states confuse non-technical users | Medium | Default to simple summary; evidence details in expandable drawer |

---

## 14. Future Goal: MCP Server Compatibility

> **Guiding principle:** MCP should shape the code boundaries now, not the scoring philosophy yet.

### Design Principle: Core Functions + Adapters

Core functions are pure analysis with no side effects. Side effects belong in adapters.

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
    │   └── WebSocket progress, S3 writes, orchestration, watchdog timer
    └── MCP adapter (future)
        └── MCP tool schema, request/response wrapping, auth
```

### Guidelines for This Refactor

1. **Functions accept optional prefetched data.** Fetch own data if not provided (standalone MCP use).

    ```typescript
    // GOOD: Works standalone (MCP) or with shared data (Lambda)
    async function probeLlmsTxt(input: {
        baseUrl: string;
        targetUrl: string;
        docsSubpath?: string;
        prefetchedHeaders?: Headers;  // Optional
    }): Promise<LlmsTxtResult>
    ```

2. **No progress publishing inside core functions.** Progress updates happen in the Lambda adapter.

3. **No S3 writes inside core functions.** Return data; caller decides storage.

4. **Return types are self-contained.** No implicit dependencies on shared Lambda state.

### Future MCP Tool Mapping

| Core Function | MCP Tool | Use Case |
|---------------|----------|----------|
| `probeLlmsTxt()` | `check_llms_txt` | "Does this site have llms.txt?" |
| `probeMarkdown()` | `check_markdown` | "Can I get this page as markdown?" |
| `probeExtras()` | `check_agent_support` | "AGENTS.md / MCP support?" |
| All combined | `full_audit` | "Complete AI readiness analysis" |
| `crossReference().page` | `check_page_readiness` | "Is this page AI-ready?" |

---

## 15. Open Questions

1. **Probe staggering:** Add 50ms delay between probe batches to protect target servers, or fire everything at once?
2. **Walk-up depth:** Cap at 3 levels or 2?
3. **Legacy pipeline:** Keep `ai-readiness-checker/index.ts` in sync or deprecate?
4. **Frontend card layout:** Site-level and page-level as two separate cards or one card with sub-sections?
5. **MCP readiness:** Does the core/adapter separation feel right, or need further decoupling?
6. **Loading UX:** How should evidence states update as probes resolve? (`Checking...` → `Advertised` → `Verified`)
