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
    codingAgents: 87
    aiSearch: 80
  - url: "https://vitest.dev/guide/"
    status: "ok"
    codingAgents: 85
    aiSearch: 68
  - url: "https://blocked.example.com/docs"
    status: "blocked"
    codingAgents: null
    aiSearch: null
---

# Lensy report: 3 pages

## https://docs.stripe.com/payments

### Summary

- Coding agents: 87/100
- AI search: 80/100
- Reachability: an honest AI agent can read this page (HTTP 200). robots.txt allows all 6 AI search bots.
- What an agent receives: Markdown, 5,155 characters (about 1,289 tokens), fits in one fetch

### Both audiences

| ID | Check | Status | Points | Max | Finding |
|---|---|---|---|---|---|
| C1, S2 | Content without JavaScript | PASS | 20 / 20 | 20 / 20 | 418 words in raw HTML |
| C6 | Sections findable | WARN | 11.3 | 15 | 1 H1, 1 level skip(s), 83% of H2/H3 have ids, 0 generic heading(s) |
| S5 | Answer-ready sections | PASS | 15 | 15 | 1 H1, 0 skip(s), median section 53 words (HTML) |

### Coding agents

| ID | Check | Status | Points | Max | Finding |
|---|---|---|---|---|---|
| C2 | Markdown on request | PASS | 15 | 15 | served text/markdown |
| C3 | .md version discoverable | WARN | 8 | 15 | https://docs.stripe.com/payments.md (not advertised) |
| C4 | llms.txt usable | WARN | 18 | 20 | https://docs.stripe.com/llms.txt, 527 links, 100% of 8 sampled resolve, 97K chars |
| C5 | Page fits one fetch | PASS | 15 | 15 | 5K chars received as Markdown |

### AI search

| ID | Check | Status | Points | Max | Finding |
|---|---|---|---|---|---|
| S1 | AI search bots allowed | PASS | 20 | 20 | all 6 allowed |
| S3 | Indexable | PASS | 25 | 25 | indexable, canonical yes, in sitemap: yes (4968 URLs read) |
| S4 | Freshness declared | FAIL | 0 | 15 | page date: none; sitemap lastmod: 0/4968 URLs, 0 distinct dates; this URL no lastmod |
| S6 | JSON-LD | FAIL | 0 | 5 | none |

### Fixes

- [ ] **S4** (+15 points) Freshness declared: page date: none; sitemap lastmod: 0/4968 URLs, 0 distinct dates; this URL no lastmod
  Fix: Declare when the page changed: a visible "Last updated" date or dateModified in JSON-LD, plus accurate \<lastmod\> values in the sitemap.
- [ ] **C3** (+7 points) .md version discoverable: https://docs.stripe.com/payments.md (not advertised)
  Fix: A Markdown copy exists at https://docs.stripe.com/payments.md, but nothing points to it. Add \<link rel="alternate" type="text/markdown" href="https://docs.stripe.com/payments.md"\> to the page head, or list it in llms.txt.
- [ ] **S6** (+5 points) JSON-LD: none
  Fix: Add a JSON-LD block (for example TechArticle) with dateModified. It carries little weight for AI citations, so do this last.
- [ ] **C6** (+3.7 points) Sections findable: 1 H1, 1 level skip(s), 83% of H2/H3 have ids, 0 generic heading(s)
  Fix: Use one H1, nest headings without skipping levels (H2 then H3), and give H2/H3 headings id attributes so sections can be linked and found.
- [ ] **C4** (+2 points) llms.txt usable: https://docs.stripe.com/llms.txt, 527 links, 100% of 8 sampled resolve, 97K chars
  Fix: It is 97K characters; keep it under 50K by moving full page text into llms-full.txt.

## https://vitest.dev/guide/

### Summary

- Coding agents: 85/100
- AI search: 68/100
- Reachability: an honest AI agent can read this page (HTTP 200). robots.txt allows all 6 AI search bots.
- What an agent receives: Markdown, 7,693 characters (about 1,923 tokens), fits in one fetch

### Both audiences

| ID | Check | Status | Points | Max | Finding |
|---|---|---|---|---|---|
| C1, S2 | Content without JavaScript | PASS | 20 / 20 | 20 / 20 | 688 words in raw HTML |
| C6 | Sections findable | PASS | 15 | 15 | 1 H1, 0 level skip(s), 100% of H2/H3 have ids, 1 generic heading(s) |
| S5 | Answer-ready sections | WARN | 12 | 15 | 1 H1, 0 skip(s), median section 38 words (HTML) |

### Coding agents

| ID | Check | Status | Points | Max | Finding |
|---|---|---|---|---|---|
| C2 | Markdown on request | FAIL | 0 | 15 | got text/html |
| C3 | .md version discoverable | PASS | 15 | 15 | https://vitest.dev/guide.md (listed in llms.txt) |
| C4 | llms.txt usable | PASS | 20 | 20 | https://vitest.dev/llms.txt, 215 links, 100% of 8 sampled resolve, 12K chars |
| C5 | Page fits one fetch | PASS | 15 | 15 | 8K chars received as Markdown |

### AI search

| ID | Check | Status | Points | Max | Finding |
|---|---|---|---|---|---|
| S1 | AI search bots allowed | PASS | 20 | 20 | all 6 allowed |
| S3 | Indexable | WARN | 10 | 25 | indexable, canonical no, no sitemap found |
| S4 | Freshness declared | WARN | 6 | 15 | page date: \<time\>; sitemap lastmod: 0/0 URLs, 0 distinct dates; this URL no lastmod |
| S6 | JSON-LD | FAIL | 0 | 5 | none |

### Fixes

- [ ] **C2** (+15 points) Markdown on request: got text/html
  Fix: VitePress has no content negotiation built in. Generate .md copies of each page (for example with vitepress-plugin-llms) and have your host return them for Accept: text/markdown.
- [ ] **S3** (+15 points) Indexable: indexable, canonical no, no sitemap found
  Fix: Add \<link rel="canonical"\> to the page head and list the page in your sitemap (referenced from robots.txt).
- [ ] **S4** (+9 points) Freshness declared: page date: \<time\>; sitemap lastmod: 0/0 URLs, 0 distinct dates; this URL no lastmod
  Fix: Set lastUpdated: true in the VitePress config. It shows a visible date and gives the sitemap git-based \<lastmod\> values.
- [ ] **S6** (+5 points) JSON-LD: none
  Fix: Add a JSON-LD block (for example TechArticle) with dateModified. It carries little weight for AI citations, so do this last.
- [ ] **S5** (+3 points) Answer-ready sections: 1 H1, 0 skip(s), median section 38 words (HTML)
  Fix: Use one H1 and split the page into H2/H3 sections of about 40 to 500 words, so each section can stand alone as an answer.

### Tips

- Last updated about 1 month ago (from the page date).
- 10 code block(s) have no language class. Language hints may help coding agents (plausible, not yet measured).

## https://blocked.example.com/docs

This site's bot protection refused Lensy-CLI (HTTP 403), so this page wasn't checked. Run the audit at https://perseveranceai.com instead.

