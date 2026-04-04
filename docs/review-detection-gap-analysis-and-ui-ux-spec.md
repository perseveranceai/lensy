# Review: Detection Gap Analysis & UI/UX Cleanup Spec

## Document 1: Detection Gap Analysis (v2)

**Verdict: Accurate and validated. All findings incorporated into our consolidated implementation plan.**

### Key Findings — All Confirmed

| Finding | Validation |
|---------|-----------|
| Headers as hints, not truth | Confirmed — Unkey's `Link` header points to `/llms.txt` (root, 404s), real file is at `/docs/llms.txt`. Naively trusting headers would create a new false positive. |
| Exact page mapping in llms.txt | Confirmed — Unkey's llms.txt lists `/docs/quickstart/apis/nextjs.md` explicitly. We should report "this page is listed in the site's llms.txt index." |
| `rel="llms-full-txt"` in Link header | Confirmed — Mintlify emits both `rel="llms-txt"` and `rel="llms-full-txt"` in the same Link header. |
| Parse markdown response blockquote | Confirmed — Mintlify prepends `> ## Documentation Index` blockquote with llms.txt URL to all markdown responses. |
| Site-level vs page-level separation | Confirmed — aligns with architecture doc's `DetectionReport.site` and `DetectionReport.page` schema. |
| Redirect/canonical normalization | Confirmed — Unkey redirects `unkey.com` → `www.unkey.com`. Must use final resolved URL as probe base. |
| MIME permissiveness for llms.txt | Confirmed — `text/plain` is valid for llms.txt; don't require `text/markdown`. |
| `index.html.md` for trailing-slash URLs | Confirmed — spec-mandated convention. Current `.md` probe produces nonsense for trailing-slash URLs. |
| Demote `robots.txt Llms-txt:` to P2 | Agreed — not documented in primary spec sources, experimental at best. |
| Remove `cf-transform` header | Agreed — doesn't exist. Real signal is `Vary: Accept`. |
| Demote HTML `<link rel="llms-txt">` to P2 | Agreed — near-zero adoption. |

### No Corrections Needed

The analysis is factually accurate. All findings have been incorporated into the parallel detection architecture doc.

---

## Document 2: UI/UX Cleanup Spec

**Verdict: Strong. The evidence states concept is the single most valuable design change. Some scope and complexity concerns flagged below.**

### What's Accurate and Well-Reasoned

**1. Evidence States (Verified / Advertised / Mapped / Not verified / Experimental)**

This is the best idea in the spec. It directly solves the Unkey problem. If we had this, the report would have said "llms.txt advertised via Link header but not verified" instead of "No llms.txt found." That is the difference between a customer complaint and a customer saying "I see the issue."

The five states map cleanly to our backend detection results:
- **Verified** = probe returned HTTP 200 with valid content
- **Advertised** = header/signal exists but URL not yet validated or 404'd
- **Mapped** = page found in llms.txt index (site has llms.txt, this page is listed)
- **Not verified** = all probes failed
- **Experimental** = emerging standard detected (AGENTS.md, MCP)

**2. Audience Tagging (AI Search vs Coding Agents)**

We've already been building this in the backend — markdown-aware messaging for text-to-HTML ratio, code blocks. Surfacing it in the UI makes recommendations actionable. A customer who only cares about Perplexity doesn't need to worry about markdown.

**3. Site-Level vs Page-Level Separation**

Aligns perfectly with the architecture doc's `DetectionReport.site` and `DetectionReport.page` schema. "Site has llms.txt" and "this page is listed in llms.txt" are two different claims with different value to the customer.

**4. Suppress Recommendations When Verified**

Correct. We already got burned showing "Add llms.txt" when the customer has it but we probed the wrong URL.

**5. Copy Guidance**

"llms.txt was not verified from the tested paths" instead of "No llms.txt found" is much more defensible and empathetic. Aligns with the principle of not making conclusions when we haven't exhausted all detection methods.

**6. Bot Categorization (AI Search / Training / Classic)**

Grouping bots by purpose makes the robots.txt section scannable. Currently it's a flat list of 10 bots most users don't recognize.

**7. Data Model Additions**

The `status`, `method`, `validatedUrl`, `audience` fields map cleanly to what the backend will produce after the parallel detection refactor.

### Concerns and Suggestions

**1. Scope — This is a full UI redesign.**

The spec touches every section, the header, recommendation cards, citations, layout, and interaction patterns. That's a multi-sprint effort. The P0/P1/P2 prioritization at the end helps, but I'd be more aggressive about phasing.

**Suggestion:** P0 should be evidence states on Discoverability section only (highest customer pain point, source of Unkey complaint). Everything else follows in subsequent sprints.

**2. Some copy suggestions are too verbose for card rows.**

"llms.txt verified at /docs/llms.txt via live fetch" is 8 words for a single card row. In a compact card layout, this needs tighter formatting.

**Suggestion:** Row shows `llms.txt — Verified` (concise). Expandable detail shows `Found at /docs/llms.txt via live fetch` (full evidence). The spec mentions an "evidence drawer" but the example rows mix summary and evidence together.

**3. Evidence chips in the header may add visual noise.**

Adding 4 chips (`AI search ready: partial`, `Coding agents ready: strong`, `Page mapping: verified`, `Evidence quality: high`) alongside the score + grade + verdict may overwhelm first-time users who just want "am I good or not?"

**Suggestion:** Keep score + grade + one-line verdict as the primary header. Move audience readiness chips to a secondary row — visible but not competing with the score.

**4. Drop `confidence` from the data model.**

Calibrating "high/medium/low" consistently across all signals is harder than it sounds. What's "medium" confidence for llms.txt detection? Is a Link header that 404s "low" or "advertised"? The `status` field (verified/advertised/not_verified) already captures confidence implicitly.

**Suggestion:** Remove `confidence` field. Let `status` carry that meaning. Fewer fields = less ambiguity = easier to maintain.

**5. Content Quality split into two sub-panels adds visual weight.**

We currently have 4 sections (Bot Access, Structured Data, Discoverability, Content Quality). Splitting Content Quality into "Structure" vs "AI Consumability" makes 5 visual blocks. Worth testing whether users find this clearer or more overwhelming.

**6. Citation grouping by "context-aware vs context-free" is an internal concept.**

Customers don't know or care about our query generation strategy. They want to know "does Perplexity cite me?"

**Suggestion:** Group by outcome (cited / not cited / competitor cited) rather than by query strategy.

### What's Missing from the Spec

**1. Loading / Progressive Disclosure UX**

Current WebSocket streaming means sections fill in over 5-30 seconds. With parallel probes, results arrive in a different order. The spec doesn't address how evidence states update as probes complete — do we show "Checking..." → "Advertised" → "Verified" as probes resolve? That's a meaningful UX decision.

**2. Mobile Layout**

The spec assumes desktop card layout. Evidence badges + audience chips + method labels could get crowded on small screens.

**3. "All Good" State**

When everything passes, the current UI shows a wall of green checks which isn't very informative. The spec doesn't address what a perfect score looks like with evidence states.

---

## Cross-Document Alignment

All three documents (detection gap analysis, UI/UX spec, parallel detection architecture) align well:

| Need | Backend (Architecture Doc) | Frontend (UI/UX Spec) | Detection (Gap Analysis) |
|------|---------------------------|----------------------|--------------------------|
| Evidence states | Phase 3 cross-reference validates hints vs probes, returns `status` field | Renders as Verified/Advertised/Not verified badges | Identifies that headers can lie (Unkey Link header → 404) |
| Site vs page level | `DetectionReport.site` and `.page` schema | Separate site-level and page-level card sections | Identifies page mapping in llms.txt as distinct signal |
| Discovery method | `discoveryMethod` field on all results | Shows "Found via Link header" / "Found at /docs/llms.txt" | Maps all discovery methods across llms.txt + markdown |
| Audience tags | Markdown-aware messaging already in backend | Audience chips on recommendations | Content negotiation enables "coding agents covered" signal |
| Suppress false recs | Phase 1 harvest + Phase 2 parallel probes reduce false negatives | `suppressIfVerified` flag on recommendations | Headers-as-hints pattern prevents premature "not found" |
| Quality validation | Content-Type check, structural lint (P2) | Quality warnings displayed alongside evidence state | Content-Type false positives identified as gap |

---

## Recommended Phasing (Combined)

### Sprint 1 (P0)
- **Backend:** Parallel probe refactor (Phase 1/2/3), content negotiation, Link/X-Llms-Txt header parsing, trailing-slash fix, redirect normalization
- **Frontend:** Evidence states on Discoverability section only, site vs page level, copy improvements ("not verified from tested paths")

### Sprint 2 (P1)
- **Backend:** `/.well-known` probes, hierarchical subpath traversal, robots.txt AI crawler blocking, Content-Type validation, AGENTS.md detection, OpenAPI detection in llms.txt
- **Frontend:** Audience tags on recommendations, bot categorization, suppress-when-verified logic, evidence states on remaining sections

### Sprint 3 (P2)
- **Backend:** llms.txt structural validation, markdown frontmatter validation, `/.well-known/mcp.json` detection
- **Frontend:** Evidence drawer (expandable detail), progressive loading UX, citation grouping by outcome, mobile layout
