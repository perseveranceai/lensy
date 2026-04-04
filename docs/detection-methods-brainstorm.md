# AI Readiness Detection Methods — Inventory & Streamlining Proposal

## Context

Lensy checks whether a website is "AI-ready" by detecting llms.txt, llms-full.txt, and markdown availability. A customer (Unkey) exposed gaps in our detection logic — their llms.txt lived at `/docs/llms.txt` and they support content negotiation (`Accept: text/markdown`), both of which we missed.

This document inventories every known detection method, flags what we currently implement vs what we're missing, and proposes a streamlined two-phase architecture.

---

## 1. Complete Detection Method Inventory

### 1.1 llms.txt Detection

| # | Method | Implemented? | Notes |
|---|--------|:---:|-------|
| 1 | `{baseUrl}/llms.txt` (root) | Yes | First candidate always |
| 2 | `{baseUrl}{docsSubpath}/llms.txt` | Yes | e.g., `/docs/llms.txt` — caught Unkey's case |
| 3 | Explicit URL passed as parameter | Yes | `explicitLlmsTxtUrl` param from caller |
| 4 | `/.well-known/llms.txt` | **No** | Emerging convention, like `.well-known/security.txt` |
| 5 | HTTP `Link` header: `<url>; rel="llms-txt"` | **No** | Server advertises llms.txt location in response headers |
| 6 | `X-Llms-Txt` HTTP header | **No** | Convenience header some servers set |
| 7 | `robots.txt` — `Llms-txt:` directive | **No** | Some sites add `Llms-txt: /path/to/llms.txt` in robots.txt |
| 8 | HTML `<link rel="llms-txt" href="...">` | **No** | Rare but possible |

### 1.2 llms-full.txt Detection

| # | Method | Implemented? | Notes |
|---|--------|:---:|-------|
| 1 | `{baseUrl}/llms-full.txt` (root) | Yes | |
| 2 | `{baseUrl}{docsSubpath}/llms-full.txt` | Yes | |
| 3 | Sibling of found llms.txt URL | Yes | Replace `llms.txt` with `llms-full.txt` in discovered path |
| 4 | Referenced inside llms.txt content | **No** | llms.txt often links to llms-full.txt — we fetch content but don't parse for this |
| 5 | `/.well-known/llms-full.txt` | **No** | Same well-known convention |

### 1.3 Markdown Detection

| # | Method | Implemented? | Notes |
|---|--------|:---:|-------|
| 1 | `<link rel="alternate" type="text/markdown">` in HTML | Yes | Gold standard for discoverability |
| 2 | HTTP `Link` header with `type="text/markdown"` | Yes | |
| 3 | `.md` links found in page HTML | Yes | Scans `href="*.md"` |
| 4 | `{targetUrl}.md` probe | Yes | Common convention (Mintlify, GitBook) |
| 5 | Content negotiation: `Accept: text/markdown` | **No** | **High value** — Unkey supports this; Cloudflare makes it automatic |
| 6 | Cloudflare `cf-transform: markdown` header | **No** | Indicates Cloudflare "Markdown for Agents" is active |
| 7 | llms.txt content referencing page as markdown link | **No** | llms.txt entries often point to markdown URLs |

### 1.4 Deprioritized / Not Worth Implementing

| Method | Reason |
|--------|--------|
| `sitemap.md` | Very rare, near-zero adoption |
| MCP (Model Context Protocol) | Not something we can probe via HTTP |
| HTML `<link rel="llms-txt">` | Extremely rare, almost no adoption yet |

---

## 2. Proposed Architecture: Two-Phase Detection

### Phase 1: Signal Harvest (zero extra HTTP calls)

Extract all signals from data we already have — the initial page fetch gives us HTML body + HTTP response headers, and we already fetch robots.txt.

**From HTTP response headers:**
- `Link` header — look for `rel="llms-txt"` and `type="text/markdown"`
- `X-Llms-Txt` header — direct llms.txt URL
- `cf-transform` header — Cloudflare markdown support indicator

**From HTML body:**
- `<link rel="alternate" type="text/markdown" href="...">` — markdown URL
- `<link rel="llms-txt" href="...">` — llms.txt URL (low priority, rare)
- `href="*.md"` links — markdown file references

**From robots.txt (already fetched):**
- `Llms-txt:` directive — llms.txt URL

### Phase 2: URL Probing (HTTP calls, use early-exit)

Only probe what Phase 1 didn't resolve. Stop on first successful hit in each category.

**llms.txt probe order:**
1. If Phase 1 found an explicit location → probe that single URL only
2. Else probe sequentially with early exit:
   - `{root}/llms.txt`
   - `{docsSubpath}/llms.txt`
   - `/.well-known/llms.txt`

**llms-full.txt probe order:**
1. If llms.txt found and its content references llms-full.txt → use that URL
2. Else: sibling of found llms.txt → `{root}/llms-full.txt` → `{docsSubpath}/llms-full.txt`

**Markdown probe order:**
1. If Phase 1 found a discoverable URL → probe to confirm, done
2. Else:
   - Content negotiation: `GET {targetUrl}` with `Accept: text/markdown` header
   - `{targetUrl}.md` probe

---

## 3. Key Optimizations

### 3.1 Parallel Probing

Current code loops through candidates sequentially. Proposal: fire all candidate probes in parallel and take the first success.

```typescript
// Current (sequential — N round trips):
for (const candidateUrl of llmsTxtCandidates) {
    const result = await checkUrl(candidateUrl, true);
    if (result.found) { llmsTxt = result; break; }
}

// Proposed (parallel — 1 round trip):
const results = await Promise.allSettled(
    llmsTxtCandidates.map(url =>
        checkUrl(url, true).then(r => ({ url, ...r }))
    )
);
const found = results
    .filter(r => r.status === 'fulfilled' && r.value.found)
    .map(r => (r as PromiseFulfilledResult<any>).value)[0];
```

**Trade-off:** Parallel probing fires more requests even when early candidates succeed. For 2-3 candidates this is fine. For larger lists, consider batching.

### 3.2 Content Negotiation (highest-value addition)

Single highest-impact missing method. One extra HTTP call to the same URL with `Accept: text/markdown`:

```typescript
const mdResponse = await fetch(targetUrl, {
    headers: { 'Accept': 'text/markdown' },
    redirect: 'follow',
});
const contentType = mdResponse.headers.get('content-type') || '';
if (contentType.includes('text/markdown')) {
    // Server supports content negotiation for markdown
}
```

Real-world adoption:
- **Unkey** — already returns markdown via content negotiation
- **Cloudflare sites** — "Markdown for Agents" feature does this automatically
- Growing standard as more documentation platforms add AI support

### 3.3 Parse llms.txt Content for llms-full.txt Reference

We already fetch and store llms.txt content. Simple regex to extract llms-full.txt reference:

```typescript
if (llmsTxt.found && llmsTxt.content) {
    const fullRef = llmsTxt.content.match(
        /(?:^|\n)\s*-?\s*\[.*?\]\((.*?llms-full\.txt.*?)\)/m
    );
    if (fullRef) llmsFullCandidates.unshift(fullRef[1]);
}
```

---

## 4. Summary of Changes

| Change | Effort | Impact | Priority |
|--------|--------|--------|----------|
| Content negotiation (`Accept: text/markdown`) | Small | High — catches Cloudflare + custom server support | P0 |
| Parse `Link` header for `rel=llms-txt` | Small | Medium — zero-cost signal from existing response | P0 |
| Parse `X-Llms-Txt` header | Small | Medium — zero-cost signal | P1 |
| Parse robots.txt for `Llms-txt:` directive | Small | Medium — zero-cost, already have robots.txt | P1 |
| `/.well-known/llms.txt` probe | Small | Low-Medium — one extra probe URL | P1 |
| Parse llms.txt content for llms-full.txt ref | Small | Medium — avoids blind probing | P1 |
| Cloudflare `cf-transform` header check | Small | Low — niche but free to check | P2 |
| Parallel probing (`Promise.allSettled`) | Medium | Medium — reduces latency | P2 |
| Parse llms.txt for markdown page refs | Medium | Low — edge case | P3 |

---

## 5. Files to Modify

- `backend/lambda/agent-handler/tools/check-ai-readiness.ts` — primary analysis engine (Agent pipeline)
- `backend/lambda/ai-readiness-checker/index.ts` — legacy Step Functions pipeline (keep in sync)

---

## 6. Open Questions

1. **Should we report _how_ we discovered llms.txt/markdown in the UI?** (e.g., "Found via Link header" vs "Found at /docs/llms.txt") — useful for customer transparency
2. **Content negotiation timeout** — how long should we wait for the `Accept: text/markdown` probe before giving up? (Suggest 3s)
3. **Should parallel probing replace sequential?** Or keep sequential for llms.txt (2-3 candidates) and only parallelize when we have 4+ candidates?
4. **Legacy pipeline parity** — do we implement all methods in `ai-readiness-checker/index.ts` too, or only in the Agent pipeline going forward?
