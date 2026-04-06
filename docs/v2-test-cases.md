# Lensy v2 — Test Cases

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
- Backend deployed to gamma with v2 detection engine + scoring rebalance
- Frontend deployed to gamma with monochrome UI + WCAG a11y fixes
- Access gamma at https://gamma.console.perseveranceai.com

---

### TC-01: Site with llms.txt (verified)
**URL:** `https://docs.anthropic.com/en/docs/overview`
**Expected:**
- Discoverability card: llms.txt = monochrome "Verified" badge (check icon, `var(--text-secondary)` color)
- Validated URL shown (e.g., `https://docs.anthropic.com/llms.txt`)
- Page-Level: Page in llms.txt = "Mapped" badge if this page appears in the llms.txt index
**Verify:** No false negatives — llms.txt must be detected

---

### TC-02: Site that blocks AI crawlers (the Unkey bug)
**URL:** `https://unkey.com/docs`
**Expected:**
- Bot Access prerequisite banner shows "partially_blocked" or "fully_blocked" state
- Banner is monochrome (no amber/red colors) — uses `var(--border-default)` border, `var(--bg-secondary)` bg
- Blocked bots listed as monochrome chips
- Allowed bots also shown as monochrome chips
- The grouped User-Agent block is correctly parsed (not broken by multi-UA format)
**Verify:** All crawlers in the grouped block are correctly identified; banner is monochrome

---

### TC-03: Site with no AI readiness features
**URL:** `https://example.com`
**Expected:**
- All evidence badges show monochrome "Not verified" (X icon, `var(--text-muted)`)
- No experimental signals shown (AGENTS.md, MCP)
- Score should be low; grade reflects low readiness
**Verify:** Clean "not verified" state, no false positives, all monochrome

---

### TC-04: Docs site with markdown content
**URL:** `https://docs.github.com/en/get-started`
**Expected:**
- Check if content negotiation works (Page-Level: Content Negotiation)
- Markdown signal appears under Discoverability card (not Content Quality)
- Check for llms.txt at root
- Sitemap should be verified
**Verify:** Evidence badges render correctly, no crashes, markdown under Discoverability

---

### TC-05: Site with sitemap but no llms.txt
**URL:** `https://stripe.com/docs`
**Expected:**
- Discoverability: Sitemap = monochrome "Verified"
- Discoverability: llms.txt = status depends on if Stripe has added it
- Page-Level signals vary
**Verify:** Mixed signal states render correctly, all monochrome

---

### TC-06: v1 backward compatibility
**URL:** Any URL
**Expected:**
- 3 category cards render: Structured Data, Discoverability, Content Quality
- Bot Access renders as prerequisite banner above the grid (not a 4th card)
- Score breakdown still works — denominator labels: /40, /40, /20
- Recommendations still appear
- Overall score still calculates (out of 100)
**Verify:** No regressions in existing functionality

---

### TC-07: Evidence badge rendering — monochrome
**URL:** Any URL that produces results
**Expected:**
- All evidence badges are monochrome (no green, amber, red, or blue colors):
  - "Verified" = `var(--text-secondary)` with check icon
  - "Advertised" = `var(--text-muted)` with warning icon
  - "Mapped" = `var(--text-secondary)` with circle icon
  - "Not verified" = `var(--text-muted)` with X icon
  - "Experimental" = `var(--text-muted)` with diamond icon
- Audience tags use muted monochrome styling
- The ONLY accent color anywhere is `var(--accent-primary)` blue for `+pts` badges and links
**Verify:** No colored icons, badges, or banners. Monochrome throughout.

---

### TC-08: WebSocket data flow
**URL:** Any URL
**Expected:**
- Open browser DevTools → Network → WS tab
- Watch for `category-result` message with `category: "detection"`
- Data should include: `site` object, `page` object, `probeLog` array
- Watch for `category-result` with `category: "overallScore"` — should include `botAccessState` field
**Verify:** Detection data arrives via WebSocket and populates UI; botAccessState present

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
- Walk-up candidates should traverse parent paths
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

### TC-13: Bot access prerequisite — 3 states
**URL set:**
- Fully blocked: `https://unkey.com/docs` (or a site known to block all AI bots)
- Partially blocked: A site that blocks some but not all AI crawlers
- Accessible: `https://docs.anthropic.com/en/docs/overview`

**Expected — Fully Blocked:**
- Banner appears ABOVE the 3-card grid
- Title: "Bot Access — Blocked" (or similar)
- All blocked bots shown as monochrome chips
- Border: `1px solid var(--border-default)`, bg: `var(--bg-secondary)`
- No amber or red colors anywhere in the banner

**Expected — Partially Blocked:**
- Banner appears ABOVE the 3-card grid
- Shows both blocked and allowed bot chips
- Monochrome styling, same as fully blocked
- Left border accent distinguishes from accessible state

**Expected — Accessible:**
- Compact success bar with bot chips (all allowed)
- `borderLeft: '3px solid var(--text-muted)'`
- Monochrome — no green success colors

**Verify:** All 3 states render correctly; all monochrome; banner is above grid, not a card

---

### TC-14: Scoring weights rebalance
**URL:** `https://docs.anthropic.com/en/docs/overview`
**Expected:**
- Overall score = Discoverability + Content Quality + Structured Data (no bot access in score)
- Discoverability denominator: /40
- Content Quality denominator: /40
- Structured Data denominator: /20
- Total: /100
- Bot Access is NOT included in score calculation
- SVG chart (if visible) shows 3 categories only
**Verify:** Score math is correct; bot access has zero weight

---

### TC-15: Markdown moved to Discoverability
**URL:** `https://docs.github.com/en/get-started` (or a site with markdown support)
**Expected:**
- Markdown signal (llms.txt, sitemap, markdown) appears in the Discoverability card
- Markdown does NOT appear in Content Quality card
- Content Quality card shows: Heading structure, JS ratio, Word count, Internal links
- Discoverability card shows: llms.txt, Sitemap, Canonical, Markdown, Meta robots (if applicable)
**Verify:** Markdown is only under Discoverability, not Content Quality

---

### TC-16: Recommendations navigation (back button)
**URL:** Any URL that produces recommendations
**Expected:**
- Click "View all N recommendations →" button
- Recommendations panel opens showing Quick Wins and Deeper Improvements
- "← Back to Readiness" button visible at top of recommendations panel
- Click "← Back to Readiness" → returns to the 3-card readiness grid
- Clicking the left hero card (AI Readiness) also returns to readiness view
**Verify:** User can always navigate back from recommendations; no dead-end state

---

### TC-17: Citations chips — monochrome
**URL:** Any URL, then click AI Citations hero card and run citation check
**Expected:**
- Citation result chips ("Cited" / "Not Cited") are monochrome:
  - "Cited" = `var(--text-secondary)` text, `rgba(107,114,128,0.12)` bg
  - "Not Cited" = `var(--text-muted)` text, `var(--bg-tertiary)` bg
- No green (`#16a34a`) or green-tinted (`rgba(34,197,94,*)`) colors anywhere
- Each chip has an `aria-label` tying it back to the query text
**Verify:** Citation chips are fully monochrome; no green colors

---

### TC-18: WCAG accessibility — keyboard navigation
**URL:** Any URL that produces results
**Expected:**
- Tab key navigates through: hero cards → "View recommendations" button → check items → info icons
- Hero cards: `role="button"`, respond to Enter/Space, have `aria-label` and `aria-pressed`
- Info icons (tooltip triggers): focusable via Tab, show `focus-visible` outline (blue ring)
- `+N pts` badges have `aria-label` ("Fixing this adds N points to your AI Readiness score")
- Check row icons have `aria-label` ("Pass", "Needs improvement")
- Grade scale bar: inactive grades have sufficient contrast (not dimmed with opacity)
- Tab panel has `role="tabpanel"` and receives focus on tab switch
**Verify:** Full keyboard navigation works; screen reader announces meaningful labels

---

### TC-19: WCAG accessibility — progress messages
**URL:** Start analysis on any URL
**Expected:**
- Progress message container has `aria-live="polite"` and `role="log"`
- New messages are announced to screen readers as they appear
- No colored dots as the only signal (status text provides context)
**Verify:** Screen reader announces progress updates

---

### TC-20: 3-card grid layout
**URL:** Any URL that produces results
**Expected:**
- Grid shows exactly 3 cards: Content Quality, Structured Data, Discoverability
- Grid uses `repeat(3, 1fr)` layout (not 2x2)
- Bot Access is NOT a card — it's a prerequisite banner above the grid
- Each card header shows category name + score/denominator + status icon
- Check items within cards have `mb: 1.5` spacing (not cramped)
**Verify:** Layout is 3 columns; bot access is a banner, not a card

---

## Smoke Test Checklist (Quick 5-min check)

1. [ ] Open gamma URL
2. [ ] Enter `https://docs.anthropic.com/en/docs/overview` → Start analysis
3. [ ] Verify 3 category cards load (Structured Data, Discoverability, Content Quality) — NOT 4
4. [ ] Verify Bot Access appears as prerequisite banner ABOVE the grid
5. [ ] Verify Discoverability card shows Markdown signal (not in Content Quality)
6. [ ] Verify all evidence badges are monochrome (no green/amber/red colors)
7. [ ] Verify score denominators: /40, /40, /20 (totaling /100)
8. [ ] Verify overall score = sum of 3 categories (bot access NOT scored)
9. [ ] Click "View all N recommendations" → verify "← Back to Readiness" button works
10. [ ] Tab through interactive elements → verify keyboard focus indicators work
11. [ ] Enter `https://example.com` → Verify "Not verified" states render correctly
12. [ ] Check browser console for errors — should be clean (no red errors)
13. [ ] Verify recommendations still appear
14. [ ] Run citation check → verify citation chips are monochrome (no green)
