# Lensy v2 Detection Engine — Test Cases

## Unit Tests (Automated)

**Location:** `backend/lambda/agent-handler/tools/detection-engine.test.ts`
**Run:** `cd backend/lambda/agent-handler && node tools/detection-engine.test.js`
**Result:** 86/86 passed

Covers: robots.txt parsing (grouped UAs, wildcards, comments), URL helpers, walk-up candidates,
OpenAPI extraction, harvestSignals (Link headers, X-Llms-Txt, markdown alternate, Vary, canonical,
meta robots, docs subpath), crossReference (evidence classification, page mapping, probe log).

---

## Manual Test Cases (Gamma)

### Prerequisites
- Backend deployed to gamma with v2 detection engine
- Frontend deployed to gamma with evidence badge UI
- Access gamma at https://gamma.console.perseveranceai.com

---

### TC-01: Site with llms.txt (verified)
**URL:** `https://docs.anthropic.com/en/docs/overview`
**Expected:**
- Site-Level: llms.txt = green "Verified" badge
- Validated URL shown (e.g., `https://docs.anthropic.com/llms.txt`)
- Audience tag: "AI search" or "Both"
- Page-Level: Page in llms.txt = "Mapped" (amber) if this page appears in the llms.txt index
**Verify:** No false negatives — llms.txt must be detected

---

### TC-02: Site that blocks AI crawlers (the Unkey bug)
**URL:** `https://unkey.com/docs`
**Expected:**
- Bot Access section: GPTBot, ClaudeBot, etc. shown as blocked
- The grouped User-Agent block is correctly parsed (not broken by multi-UA format)
- Site-Level: llms.txt detected if present
**Verify:** All crawlers in the grouped block are correctly identified as blocked

---

### TC-03: Site with no AI readiness features
**URL:** `https://example.com`
**Expected:**
- Site-Level: llms.txt = red "Not verified" badge
- Site-Level: llms-full.txt = red "Not verified"
- Site-Level: Sitemap = could be either verified or not
- Page-Level: All signals = "Not verified"
- No experimental signals shown (AGENTS.md, MCP)
**Verify:** Clean "not verified" state, no false positives

---

### TC-04: Docs site with markdown content
**URL:** `https://docs.github.com/en/get-started`
**Expected:**
- Check if content negotiation works (Page-Level: Content Negotiation)
- Check for llms.txt at root
- Sitemap should be verified
**Verify:** Evidence badges render correctly, no crashes

---

### TC-05: Site with sitemap but no llms.txt
**URL:** `https://stripe.com/docs`
**Expected:**
- Site-Level: Sitemap = green "Verified"
- Site-Level: llms.txt = status depends on if Stripe has added it
- Page-Level signals vary
**Verify:** Mixed signal states render correctly

---

### TC-06: v1 backward compatibility
**URL:** Any URL
**Expected:**
- All v1 categories still render: Bot Access, Structured Data, Discoverability, Consumability
- Score breakdown still works
- Recommendations still appear
- Overall score still calculates
**Verify:** No regressions in existing functionality

---

### TC-07: Evidence badge rendering
**URL:** Any URL that produces results
**Expected:**
- Green badge with check icon for "Verified" status
- Amber badge with warning icon for "Advertised" status
- Blue/amber badge for "Mapped" status
- Red badge with X icon for "Not verified" status
- Gray badge with diamond icon for "Experimental" status
- Audience tags ("AI search", "Coding agents", "Both") shown where applicable
- Evidence notes (italic amber text) shown when available
- Section headers "Site-Level" and "Page-Level" appear in Discoverability card
**Verify:** Visual badges are readable and correctly colored

---

### TC-08: WebSocket data flow
**URL:** Any URL
**Expected:**
- Open browser DevTools → Network → WS tab
- Watch for `category-result` message with `category: "detection"`
- Data should include: `site` object (llmsTxt, llmsFullTxt, sitemap, agentsMd, mcpJson, blockedAiCrawlers, allowedAiCrawlers, openApiSpecs), `page` object (markdown, llmsTxtMapping, llmsTxtMarkdownMapping, contentNegotiation), `probeLog` array
**Verify:** Detection data arrives via WebSocket and populates UI

---

### TC-09: Probe log integrity
**URL:** Any URL
**Expected:**
- Check browser DevTools console for "Async card update: detection" log
- The detection data's `probeLog` should list all URLs probed with status codes and durations
- Typically 5-15 probe entries depending on the site
**Verify:** Probe log is complete and no entries have 0ms duration (except timeouts)

---

### TC-10: Walk-up detection for nested docs
**URL:** A deeply nested docs page, e.g., `https://docs.anthropic.com/en/docs/build-with-claude/tool-use`
**Expected:**
- llms.txt should still be found even though the target page is several levels deep
- Walk-up candidates should traverse: /en/docs/build-with-claude/llms.txt → /en/docs/llms.txt → /en/llms.txt
- Root /llms.txt should also be checked
**Verify:** Walk-up heuristic finds llms.txt regardless of page depth

---

### TC-11: Large site with many signals
**URL:** `https://platform.openai.com/docs`
**Expected:**
- Multiple signals detected (llms.txt, sitemap, etc.)
- Analysis completes within reasonable time (<30s)
- No Lambda timeout
**Verify:** Performance is acceptable, no timeouts

---

### TC-12: Error handling — invalid URL
**URL:** `not-a-valid-url` or `https://nonexistent-domain-12345.com`
**Expected:**
- Graceful error handling
- v2 detection should not crash the overall analysis
- v1 error handling still works
**Verify:** No unhandled exceptions, user sees appropriate error

---

## Smoke Test Checklist (Quick 5-min check)

1. [ ] Open gamma URL
2. [ ] Enter `https://docs.anthropic.com/en/docs/overview` → Start analysis
3. [ ] Verify all 4 category cards load (Bot Access, Structured Data, Discoverability, Consumability)
4. [ ] Verify Discoverability card shows "Site-Level" and "Page-Level" section headers
5. [ ] Verify at least one green "Verified" badge appears (llms.txt or sitemap)
6. [ ] Verify evidence notes appear where applicable
7. [ ] Verify overall score still calculates
8. [ ] Enter `https://example.com` → Verify "Not verified" states render correctly
9. [ ] Check browser console for errors — should be clean (no red errors related to v2)
10. [ ] Verify recommendations still appear at the bottom
