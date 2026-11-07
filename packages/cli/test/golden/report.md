---
reportVersion: 1
tool: "lensy"
toolVersion: "0.0.0-test"
engineCommit: "test"
checkedAt: "2026-10-22T12:00:00.000Z"
mode: "url"
pages:
  - url: "https://docs.stripe.com/payments"
    status: "ok"
    codingAgents: 91
    aiSearch: 80
  - url: "https://vitest.dev/guide/"
    status: "ok"
    codingAgents: 87
    aiSearch: 68
  - url: "https://blocked.example.com/docs"
    status: "blocked"
    codingAgents: null
    aiSearch: null
---

# Lensy report: 3 pages

## https://docs.stripe.com/payments

### Summary

- Coding agents: 91/100
- AI search: 80/100
- Reachability: an honest AI agent can read this page (HTTP 200). robots.txt allows all 6 AI search bots.
- What an agent receives: Markdown, 5,155 characters (about 1,289 tokens), fits in one fetch

### Both audiences

| ID | Check | Status | Points | Max | Finding | Source |
|---|---|---|---|---|---|---|
| rendering-strategy, S2 | Content without JavaScript | PASS | 10 / 20 | 10 / 20 | All 1 pages contain server-rendered content. 418 words in raw HTML |  |
| lensy-headings | Headings an agent can navigate | WARN | 3 | 4 | 1 H1, 12 headings, 1 level skip(s) in what an agent receives |  |
| S5 | Answer-ready sections | PASS | 15 | 15 | 1 H1, 0 skip(s), median section 53 words (HTML) |  |

### Coding agents

| ID | Check | Status | Points | Max | Finding | Source |
|---|---|---|---|---|---|---|
| llms-txt-directive-md | Page points agents to llms.txt (Markdown) | FAIL | 0 | 4 | No llms.txt directive found in markdown of any of 1 pages | AFDocs |
| cache-header-hygiene | Cache headers | FAIL | 0 | 2 | 3 of 3 endpoints have aggressive caching or missing cache headers | AFDocs |
| llms-txt-valid | llms.txt format | WARN | 2.4 | 3.2 | llms.txt contains parseable links but doesn't fully follow the proposed structure: https://docs.stripe.com/llms.txt: No blockquote summary found | AFDocs |
| llms-txt-size | llms.txt size | WARN | 3.5 | 7 | llms.txt is 97,407 characters (between 50,000 and 1,00,000; consider splitting) | AFDocs |
| llms-txt-directive-html | Page points agents to llms.txt (HTML) | WARN | 7 | 7 | llms.txt directive found in HTML of 1 of 1 pages, but buried deep in the page (past 50%) | AFDocs |
| content-start-position | Content starts near the top | WARN | 2 | 4 | 1 of 1 pages have content starting at 10–50% (worst 40%) | AFDocs |
| llms-txt-exists | llms.txt exists | PASS | 10 | 10 | llms.txt found at 2 locations; using https://docs.stripe.com/llms.txt as canonical | AFDocs |
| llms-txt-links-resolve | llms.txt links resolve | PASS | 5.6 | 5.6 | All 20 same-origin sampled links resolve (493 total links) | AFDocs |
| llms-txt-links-markdown | llms.txt links point to Markdown | PASS | 5.6 | 5.6 | 20/20 same-origin sampled links point to markdown content (100%) (1 external link excluded) | AFDocs |
| markdown-url-support | .md version of the page | PASS | 7 | 7 | 1/1 pages support .md URLs (100%) | AFDocs |
| content-negotiation | Markdown on request | PASS | 4 | 4 | 1/1 pages support content negotiation (100%) | AFDocs |
| page-size-markdown | Markdown size | PASS | 7 | 7 | All 1 pages under 50K chars (median 5K, max 5K) | AFDocs |
| page-size-html | HTML size | PASS | 7 | 7 | All 1 pages under 50K chars (median 801K HTML → 6K markdown (99% boilerplate)) | AFDocs |
| page-size-transfer | Download size | PASS | 4 | 4 | All 1 pages serve under 1MB (median 813KB served → 6KB content (~135:1)) | AFDocs |
| single-fetch-completeness | Complete in one fetch | PASS | 4 | 4 | All 1 markdown pages deliver complete content in one fetch (no pagination detected) | AFDocs |
| tabbed-content-serialization | Tabbed content readable | PASS | 4 | 4 | No tabbed content detected across 1 pages | AFDocs |
| section-header-quality | Headers inside tabs | PASS | 2 | 2 | No tabbed content found; header quality check not applicable | AFDocs |
| markdown-code-fence-validity | Code fences closed | PASS | 4 | 4 | All 0 code fences properly closed across 3 pages | AFDocs |
| markdown-link-portability | Links work outside the site | PASS | 4 | 4 | All 40 links across 1 markdown pages are absolute; 20 sampled links resolve to the expected representation | AFDocs |
| embedded-data-serialization | Embedded data size | PASS | 4 | 4 | No bulk data elements detected across 1 pages | AFDocs |
| http-status-codes | Real 404s for missing pages | PASS | 7 | 7 | All 1 pages return proper error codes for bad URLs | AFDocs |
| redirect-behavior | Redirects | PASS | 4 | 4 | No redirects detected across 1 pages | AFDocs |
| markdown-content-parity | Markdown matches HTML | PASS | 4 | 4 | All 1 pages have equivalent markdown and HTML content (avg 0% missing) | AFDocs |
| auth-gate-detection | Public without login | PASS | 10 | 10 | All 1 pages are publicly accessible | AFDocs |
| bot-protection-interference | Bot protection lets agents in | PASS | 7 | 7 | No bot-protection interference observed across 55 requests | AFDocs |

### AI search

| ID | Check | Status | Points | Max | Finding | Source |
|---|---|---|---|---|---|---|
| S1 | AI search bots allowed | PASS | 20 | 20 | all 6 allowed |  |
| S3 | Indexable | PASS | 25 | 25 | indexable, canonical yes, in sitemap: yes (4968 URLs read) |  |
| S4 | Freshness declared | FAIL | 0 | 15 | page date: none; sitemap lastmod: 0/4968 URLs, 0 distinct dates; this URL no lastmod |  |
| S6 | JSON-LD | FAIL | 0 | 5 | none |  |

### Fixes

- [ ] **S4** (+15 points) Freshness declared: page date: none; sitemap lastmod: 0/4968 URLs, 0 distinct dates; this URL no lastmod
  Fix: Declare when the page changed: a visible "Last updated" date or dateModified in JSON-LD, plus accurate \<lastmod\> values in the sitemap.
- [ ] **S6** (+5 points) JSON-LD: none
  Fix: Add a JSON-LD block (for example TechArticle) with dateModified. It carries little weight for AI citations, so do this last.
- [ ] **llms-txt-directive-md** (+3 points) Page points agents to llms.txt (Markdown): No llms.txt directive found in markdown of any of 1 pages
  Fix: No llms.txt directive was detected in the markdown of any tested page. Add a blockquote near the top of each markdown page (e.g., "\> For the complete documentation index, see \[llms.txt\](/llms.txt)").
- [ ] **llms-txt-size** (+2 points) llms.txt size: llms.txt is 97,407 characters (between 50,000 and 1,00,000; consider splitting)
  Fix: Your llms.txt is 97,407 characters, which may be truncated on some agent platforms. If it grows further, split into nested llms.txt files with a root index under 50,000 characters.
- [ ] **content-start-position** (+1 points) Content starts near the top: 1 of 1 pages have content starting at 10–50% (worst 40%)
  Fix: 1 of 1 pages have documentation content starting 10-50% into the converted output. Reduce navigation, breadcrumb, and sidebar markup that precedes the content area.
- [ ] **cache-header-hygiene** (+1 points) Cache headers: 3 of 3 endpoints have aggressive caching or missing cache headers
  Fix: 3 endpoints have aggressive caching (\>24h) or missing cache headers. Set max-age under 3600 or add must-revalidate with ETag/Last-Modified so content updates reach agents promptly.
- [ ] **lensy-headings** (+1 points) Headings an agent can navigate: 1 H1, 12 headings, 1 level skip(s) in what an agent receives
  Fix: Use exactly one H1 and nest headings without skipping levels (H2 then H3). Agents find sections by heading text.
- [ ] **llms-txt-valid** (+1 points) llms.txt format: llms.txt contains parseable links but doesn't fully follow the proposed structure: https://docs.stripe.com/llms.txt: No blockquote summary found
  Fix: Your llms.txt contains parseable links but doesn't follow the standard structure. Add an H1 title as the first line and a blockquote summary (lines starting with \>) to improve agent parsing.
- [ ] **llms-txt-directive-html** (+0 points) Page points agents to llms.txt (HTML): llms.txt directive found in HTML of 1 of 1 pages, but buried deep in the page (past 50%)
  Fix: An llms.txt directive was found in the HTML of some pages but is missing from others, or is buried deep in the page. Ensure the directive appears near the top of every documentation page.

## https://vitest.dev/guide/

### Summary

- Coding agents: 87/100
- AI search: 68/100
- Reachability: an honest AI agent can read this page (HTTP 200). robots.txt allows all 6 AI search bots.
- What an agent receives: Markdown, 7,693 characters (about 1,923 tokens), fits in one fetch

### Both audiences

| ID | Check | Status | Points | Max | Finding | Source |
|---|---|---|---|---|---|---|
| rendering-strategy, S2 | Content without JavaScript | PASS | 10 / 20 | 10 / 20 | All 1 pages contain server-rendered content. 688 words in raw HTML |  |
| lensy-headings | Headings an agent can navigate | PASS | 4 | 4 | 1 H1, 9 headings, 0 level skip(s) in what an agent receives |  |
| S5 | Answer-ready sections | WARN | 12 | 15 | 1 H1, 0 skip(s), median section 38 words (HTML) |  |

### Coding agents

| ID | Check | Status | Points | Max | Finding | Source |
|---|---|---|---|---|---|---|
| llms-txt-directive-html | Page points agents to llms.txt (HTML) | FAIL | 0 | 7 | No llms.txt directive found in HTML of any of 1 pages | AFDocs |
| llms-txt-directive-md | Page points agents to llms.txt (Markdown) | FAIL | 0 | 4 | No llms.txt directive found in markdown of any of 1 pages | AFDocs |
| content-negotiation | Markdown on request | FAIL | 0 | 4 | Server ignores Accept: text/markdown header (0/1 pages return markdown) | AFDocs |
| markdown-link-portability | Links work outside the site | WARN | 0 | 0 | 1 of 1 markdown pages carry links that lose their target once the base URL is gone (root-relative links (1)) | AFDocs |
| llms-txt-exists | llms.txt exists | PASS | 10 | 10 | llms.txt found at https://vitest.dev/llms.txt | AFDocs |
| llms-txt-valid | llms.txt format | PASS | 4 | 4 | llms.txt follows the proposed structure (H1, blockquote, heading-delimited link sections) | AFDocs |
| llms-txt-size | llms.txt size | PASS | 7 | 7 | llms.txt is 11,919 characters (under 50,000 threshold) | AFDocs |
| markdown-url-support | .md version of the page | PASS | 7 | 7 | 1/1 pages support .md URLs (100%) | AFDocs |
| page-size-markdown | Markdown size | PASS | 0 | 0 | All 1 pages under 50K chars (median 8K, max 8K) | AFDocs |
| page-size-html | HTML size | PASS | 7 | 7 | All 1 pages under 50K chars (median 76K HTML → 13K markdown (83% boilerplate)) | AFDocs |
| page-size-transfer | Download size | PASS | 4 | 4 | All 1 pages serve under 1MB (median 76KB served → 13KB content (~6:1)) | AFDocs |
| content-start-position | Content starts near the top | PASS | 4 | 4 | Content starts within first 10% on all 1 pages (median 6%) | AFDocs |
| single-fetch-completeness | Complete in one fetch | PASS | 0 | 0 | All 1 markdown pages deliver complete content in one fetch (no pagination detected) | AFDocs |
| tabbed-content-serialization | Tabbed content readable | PASS | 4 | 4 | No tabbed content detected across 1 pages | AFDocs |
| section-header-quality | Headers inside tabs | PASS | 2 | 2 | No tabbed content found; header quality check not applicable | AFDocs |
| markdown-code-fence-validity | Code fences closed | PASS | 0 | 0 | All 10 code fences properly closed across 2 pages | AFDocs |
| embedded-data-serialization | Embedded data size | PASS | 4 | 4 | No bulk data elements detected across 1 pages | AFDocs |
| http-status-codes | Real 404s for missing pages | PASS | 7 | 7 | All 1 pages return proper error codes for bad URLs | AFDocs |
| redirect-behavior | Redirects | PASS | 4 | 4 | No redirects detected across 1 pages | AFDocs |
| markdown-content-parity | Markdown matches HTML | PASS | 0 | 0 | All 1 pages have equivalent markdown and HTML content (avg 0% missing) | AFDocs |
| cache-header-hygiene | Cache headers | PASS | 2 | 2 | All 2 endpoints have appropriate cache headers | AFDocs |
| auth-gate-detection | Public without login | PASS | 10 | 10 | All 1 pages are publicly accessible | AFDocs |
| bot-protection-interference | Bot protection lets agents in | PASS | 7 | 7 | No bot-protection interference observed across 18 requests; limited evidence: only 18 requests observed | AFDocs |

### AI search

| ID | Check | Status | Points | Max | Finding | Source |
|---|---|---|---|---|---|---|
| S1 | AI search bots allowed | PASS | 20 | 20 | all 6 allowed |  |
| S3 | Indexable | WARN | 10 | 25 | indexable, canonical no, no sitemap found |  |
| S4 | Freshness declared | WARN | 6 | 15 | page date: \<time\>; sitemap lastmod: 0/0 URLs, 0 distinct dates; this URL no lastmod |  |
| S6 | JSON-LD | FAIL | 0 | 5 | none |  |

### Fixes

- [ ] **S3** (+15 points) Indexable: indexable, canonical no, no sitemap found
  Fix: Add \<link rel="canonical"\> to the page head and list the page in your sitemap (referenced from robots.txt).
- [ ] **S4** (+9 points) Freshness declared: page date: \<time\>; sitemap lastmod: 0/0 URLs, 0 distinct dates; this URL no lastmod
  Fix: Set lastUpdated: true in the VitePress config. It shows a visible date and gives the sitemap git-based \<lastmod\> values.
- [ ] **llms-txt-directive-html** (+6 points) Page points agents to llms.txt (HTML): No llms.txt directive found in HTML of any of 1 pages
  Fix: No agent-facing directive pointing to llms.txt was detected in the HTML of any tested page. Add a visually-hidden element near the top of each page (e.g., a div with CSS clip-rect) containing a link to your llms.txt. If your site serves markdown versions of pages, mention that in the directive too so agents know to request it.
- [ ] **S6** (+5 points) JSON-LD: none
  Fix: Add a JSON-LD block (for example TechArticle) with dateModified. It carries little weight for AI citations, so do this last.
- [ ] **llms-txt-directive-md** (+4 points) Page points agents to llms.txt (Markdown): No llms.txt directive found in markdown of any of 1 pages
  Fix: No llms.txt directive was detected in the markdown of any tested page. Add a blockquote near the top of each markdown page (e.g., "\> For the complete documentation index, see \[llms.txt\](/llms.txt)").
- [ ] **content-negotiation** (+3 points) Markdown on request: Server ignores Accept: text/markdown header (0/1 pages return markdown)
  Fix: Your server ignores Accept: text/markdown and returns HTML. Some agents (Claude Code, Cursor, OpenCode) request markdown this way. Configure your server to honor content negotiation.
- [ ] **S5** (+3 points) Answer-ready sections: 1 H1, 0 skip(s), median section 38 words (HTML)
  Fix: Use one H1 and split the page into H2/H3 sections of about 40 to 500 words, so each section can stand alone as an answer.
- [ ] **markdown-link-portability** (+0 points) Links work outside the site: 1 of 1 markdown pages carry links that lose their target once the base URL is gone (root-relative links (1))
  Fix: 1 of 1 markdown pages link in a way that depends on the base URL (root-relative links on 1). Emit absolute URLs when generating markdown: the canonical host is known at build time, so absolute links cost nothing to produce. Root-relative links resolve only while the fetch URL is still around, and agent pipelines lose it routinely, to summarization, to RAG chunking, or to content being pasted somewhere else.

### Tips

- Last updated about 1 month ago (from the page date).
- 10 code block(s) have no language class. Language hints may help coding agents (plausible, not yet measured).

## https://blocked.example.com/docs

This site's bot protection refused lensy-cli (HTTP 403), so this page wasn't checked. Run the audit at https://perseveranceai.com instead.

