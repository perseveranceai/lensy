# Lensy checks

Generated from the engine's check registry (`backend/lambda/agent-handler/tools/check-registry.ts`) by `npm run docs:checks`. Don't edit by hand.

Lensy gives two scores out of 100. The Coding agents score comes from AFDocs, the Agent-Friendly Documentation checks, plus Lensy's own heading check; if AFDocs can't run, it falls back to Lensy's C1-C6. AI search is Lensy's S1-S6. `lensy explain <id>` prints the same text.

## Coding agents (AFDocs)

Each check earns a share of its weight (critical 10, high 7, medium 4, low 2; a warning earns part of it). The score is the weight earned over the weight of the checks that ran, out of 100. Some critical failures cap the score: with no llms.txt it is at most 59.

| ID | Check | Source | Weight |
|---|---|---|---|
| llms-txt-exists | llms.txt exists | AFDocs | 10 |
| llms-txt-valid | llms.txt format | AFDocs | 4 |
| llms-txt-size | llms.txt size | AFDocs | 7 |
| llms-txt-links-resolve | llms.txt links resolve | AFDocs | 7 |
| llms-txt-links-markdown | llms.txt links point to Markdown | AFDocs | 7 |
| llms-txt-directive-html | Page points agents to llms.txt (HTML) | AFDocs | 7 |
| llms-txt-directive-md | Page points agents to llms.txt (Markdown) | AFDocs | 4 |
| markdown-url-support | .md version of the page | AFDocs | 7 |
| content-negotiation | Markdown on request | AFDocs | 4 |
| rendering-strategy | Content without JavaScript | AFDocs | 10 |
| page-size-markdown | Markdown size | AFDocs | 7 |
| page-size-html | HTML size | AFDocs | 7 |
| page-size-transfer | Download size | AFDocs | 4 |
| content-start-position | Content starts near the top | AFDocs | 4 |
| single-fetch-completeness | Complete in one fetch | AFDocs | 4 |
| tabbed-content-serialization | Tabbed content readable | AFDocs | 4 |
| section-header-quality | Headers inside tabs | AFDocs | 2 |
| markdown-code-fence-validity | Code fences closed | AFDocs | 4 |
| markdown-link-portability | Links work outside the site | AFDocs | 4 |
| embedded-data-serialization | Embedded data size | AFDocs | 4 |
| http-status-codes | Real 404s for missing pages | AFDocs | 7 |
| redirect-behavior | Redirects | AFDocs | 4 |
| llms-txt-coverage | llms.txt covers the sitemap | AFDocs | 4 |
| markdown-content-parity | Markdown matches HTML | AFDocs | 4 |
| cache-header-hygiene | Cache headers | AFDocs | 2 |
| auth-gate-detection | Public without login | AFDocs | 10 |
| auth-alternative-access | Alternative access to gated docs | AFDocs | 4 |
| bot-protection-interference | Bot protection lets agents in | AFDocs | 7 |
| lensy-headings | Headings an agent can navigate | Lensy | 4 |

### llms-txt-exists llms.txt exists (10 weight)

**What it measures:** Whether llms.txt is discoverable at any of the candidate locations.

**Why it matters:** Coding agents look for llms.txt to find the right page. Without it they guess URLs. AFDocs caps the score at 59 when it is missing.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-exists](https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-exists)

### llms-txt-valid llms.txt format (4 weight)

**What it measures:** Whether llms.txt follows the proposed structure from llmstxt.org.

**Why it matters:** A predictable structure (an H1, then Markdown links) is what agents and tools parse.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-valid](https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-valid)

### llms-txt-size llms.txt size (7 weight)

**What it measures:** Whether llms.txt fits within agent truncation limits.

**Why it matters:** Agents read about 100,000 characters per fetch; a larger index is cut off.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-size](https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-size)

### llms-txt-links-resolve llms.txt links resolve (7 weight)

**What it measures:** Whether the URLs listed in llms.txt actually resolve.

**Why it matters:** A broken link in the index sends an agent to a dead end.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-links-resolve](https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-links-resolve)

### llms-txt-links-markdown llms.txt links point to Markdown (7 weight)

**What it measures:** Whether the URLs in llms.txt point to markdown content.

**Why it matters:** Markdown is far smaller than HTML, so more of the page fits in what the agent reads.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-links-markdown](https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-links-markdown)

### llms-txt-directive-html Page points agents to llms.txt (HTML) (7 weight)

**What it measures:** Whether HTML pages include a directive pointing to llms.txt.

**Why it matters:** An agent that lands on one page learns where the index of the whole site is.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-directive-html](https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-directive-html)

### llms-txt-directive-md Page points agents to llms.txt (Markdown) (4 weight)

**What it measures:** Whether markdown pages include a directive pointing to llms.txt.

**Why it matters:** Agents that read the Markdown copy see the pointer too.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-directive-md](https://agentdocsspec.com/spec/web/content-discoverability/#llms-txt-directive-md)

### markdown-url-support .md version of the page (7 weight)

**What it measures:** Whether appending .md to page URLs returns valid markdown.

**Why it matters:** Agents guess <page>.md; a Markdown copy is much smaller than the HTML.

**Depends on your hosting:** A rewrite from <page> to <page>.md can be set by your host rather than your build. A local build (`--dir` or a localhost URL) counts this check, but your host can change the result.

**Evidence:**

- [Agent-Friendly Documentation Spec: markdown-url-support](https://agentdocsspec.com/spec/web/markdown-availability/#markdown-url-support)

### content-negotiation Markdown on request (4 weight)

**What it measures:** Whether the server responds to Accept: text/markdown.

**Why it matters:** Claude Code, Cursor and OpenCode ask for Markdown first.

**Depends on your hosting:** Your web server or CDN decides what to return for Accept: text/markdown. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Agent-Friendly Documentation Spec: content-negotiation](https://agentdocsspec.com/spec/web/markdown-availability/#content-negotiation)

### rendering-strategy Content without JavaScript (10 weight)

**What it measures:** Whether pages contain server-rendered content or are client-side rendered SPA shells.

**Why it matters:** AI crawlers and most coding agents do not run JavaScript, so content rendered in the browser is invisible to them.

**Evidence:**

- [Agent-Friendly Documentation Spec: rendering-strategy](https://agentdocsspec.com/spec/web/page-size/#rendering-strategy)

### page-size-markdown Markdown size (7 weight)

**What it measures:** Character count of page when served as markdown.

**Why it matters:** Agents read about 100,000 characters per fetch and have to page or give up beyond it.

**Evidence:**

- [Agent-Friendly Documentation Spec: page-size-markdown](https://agentdocsspec.com/spec/web/page-size/#page-size-markdown)

### page-size-html HTML size (7 weight)

**What it measures:** Character count of HTML response and post-conversion size.

**Why it matters:** Agents that read HTML convert it to text; past about 100,000 characters the rest is cut off.

**Evidence:**

- [Agent-Friendly Documentation Spec: page-size-html](https://agentdocsspec.com/spec/web/page-size/#page-size-html)

### page-size-transfer Download size (4 weight)

**What it measures:** Served byte size of the HTML document after transfer decoding.

**Why it matters:** Very large documents can exceed an agent's fetch buffer before any text is read.

**Evidence:**

- [Agent-Friendly Documentation Spec: page-size-transfer](https://agentdocsspec.com/spec/web/page-size/#page-size-transfer)

### content-start-position Content starts near the top (4 weight)

**What it measures:** How far into content the actual documentation begins.

**Why it matters:** Navigation before the content uses up the part of the page an agent reads first.

**Evidence:**

- [Agent-Friendly Documentation Spec: content-start-position](https://agentdocsspec.com/spec/web/page-size/#content-start-position)

### single-fetch-completeness Complete in one fetch (4 weight)

**What it measures:** Whether markdown responses are complete in one fetch or declare a working continuation.

**Why it matters:** An agent that gets half a page and no way to the rest works from half the facts.

**Evidence:**

- [Agent-Friendly Documentation Spec: single-fetch-completeness](https://agentdocsspec.com/spec/web/page-size/#single-fetch-completeness)

### tabbed-content-serialization Tabbed content readable (4 weight)

**What it measures:** Whether tabbed/accordion content serializes into oversized output.

**Why it matters:** Tabs flatten into one long text for an agent; every variant counts toward the size limit.

**Evidence:**

- [Agent-Friendly Documentation Spec: tabbed-content-serialization](https://agentdocsspec.com/spec/web/content-structure/#tabbed-content-serialization)

### section-header-quality Headers inside tabs (2 weight)

**What it measures:** Whether headers in tabbed sections include variant context.

**Why it matters:** Flattened tabs repeat the same headings; without the variant name an agent can't tell them apart.

**Evidence:**

- [Agent-Friendly Documentation Spec: section-header-quality](https://agentdocsspec.com/spec/web/content-structure/#section-header-quality)

### markdown-code-fence-validity Code fences closed (4 weight)

**What it measures:** Whether markdown contains unclosed code fences.

**Why it matters:** An unclosed fence turns the rest of the page into code for the agent.

**Evidence:**

- [Agent-Friendly Documentation Spec: markdown-code-fence-validity](https://agentdocsspec.com/spec/web/content-structure/#markdown-code-fence-validity)

### markdown-link-portability Links work outside the site (4 weight)

**What it measures:** Whether links in served markdown are absolute and resolve to what they promise.

**Why it matters:** Relative links break once the Markdown is read outside the site, as agents do.

**Evidence:**

- [Agent-Friendly Documentation Spec: markdown-link-portability](https://agentdocsspec.com/spec/web/content-structure/#markdown-link-portability)

### embedded-data-serialization Embedded data size (4 weight)

**What it measures:** Whether machine-generated bulk data (large tables, data blobs) dominates oversized pages.

**Why it matters:** Bulk data can push the actual explanation past what an agent reads.

**Evidence:**

- [Agent-Friendly Documentation Spec: embedded-data-serialization](https://agentdocsspec.com/spec/web/content-structure/#embedded-data-serialization)

### http-status-codes Real 404s for missing pages (7 weight)

**What it measures:** Whether error pages return correct HTTP status codes.

**Why it matters:** A "not found" page served with 200 looks like real content to an agent.

**Depends on your hosting:** Status codes for missing pages are set by your web server or host. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Agent-Friendly Documentation Spec: http-status-codes](https://agentdocsspec.com/spec/web/url-stability/#http-status-codes)

### redirect-behavior Redirects (4 weight)

**What it measures:** Whether redirects are same-host HTTP redirects.

**Why it matters:** Cross-host or JavaScript redirects lose agents that follow links.

**Depends on your hosting:** Redirects are configured on your host or CDN. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Agent-Friendly Documentation Spec: redirect-behavior](https://agentdocsspec.com/spec/web/url-stability/#redirect-behavior)

### llms-txt-coverage llms.txt covers the sitemap (4 weight)

**What it measures:** How much of the site is represented in llms.txt.

**Why it matters:** Pages missing from the index are found less often. Lensy skips it: it is about the whole site, not the page.

**Evidence:**

- [Agent-Friendly Documentation Spec: llms-txt-coverage](https://agentdocsspec.com/spec/web/observability/#llms-txt-coverage)

### markdown-content-parity Markdown matches HTML (4 weight)

**What it measures:** Whether markdown and HTML versions contain equivalent content.

**Why it matters:** A Markdown copy that drops content gives agents a different page than people see.

**Evidence:**

- [Agent-Friendly Documentation Spec: markdown-content-parity](https://agentdocsspec.com/spec/web/observability/#markdown-content-parity)

### cache-header-hygiene Cache headers (2 weight)

**What it measures:** Whether cache headers allow timely updates.

**Why it matters:** Long caching keeps agents reading old versions after you fix a page.

**Depends on your hosting:** Cache headers are set by your web server or CDN. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Agent-Friendly Documentation Spec: cache-header-hygiene](https://agentdocsspec.com/spec/web/observability/#cache-header-hygiene)

### auth-gate-detection Public without login (10 weight)

**What it measures:** Whether documentation pages require authentication to access content.

**Why it matters:** Agents can't log in, so gated docs are invisible to them.

**Depends on your hosting:** Login walls are enforced by your host. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Agent-Friendly Documentation Spec: auth-gate-detection](https://agentdocsspec.com/spec/web/authentication/#auth-gate-detection)

### auth-alternative-access Alternative access to gated docs (4 weight)

**What it measures:** Whether an auth-gated documentation site provides alternative access paths for agents.

**Why it matters:** When docs need a login, an alternative path lets agents read them anyway.

**Depends on your hosting:** Access rules are enforced by your host. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Agent-Friendly Documentation Spec: auth-alternative-access](https://agentdocsspec.com/spec/web/authentication/#auth-alternative-access)

### bot-protection-interference Bot protection lets agents in (7 weight)

**What it measures:** Whether bot-protection systems interfere with automated fetching of documentation content.

**Why it matters:** Bot protection that refuses honest agents keeps the docs out of their answers.

**Depends on your hosting:** Bot protection runs on your host or CDN, not in your build. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Agent-Friendly Documentation Spec: bot-protection-interference](https://agentdocsspec.com/spec/web/authentication/#bot-protection-interference)

### lensy-headings Headings an agent can navigate (4 weight)

**What it measures:** On what an agent receives: exactly one H1 (half the points; more than one, a fifth) and an outline with no skipped heading levels (half; one skip, a quarter), counted only with at least 2 headings.

**Why it matters:** A URL #fragment never reaches the server, so agents find sections by heading text. AFDocs' section-header-quality only looks inside tabs.

**Evidence:**

- [How Claude Code eats the web](https://giuseppegurgone.com/claude-webfetch)

## Coding agents without AFDocs (C1-C6)

| ID | Check | Points |
|---|---|---|
| C1 | Content without JavaScript | 20 |
| C2 | Markdown on request | 15 |
| C3 | .md version discoverable | 15 |
| C4 | llms.txt usable | 20 |
| C5 | Page fits one fetch | 15 |
| C6 | Sections findable | 15 |

### C1 Content without JavaScript (20 points)

**What it measures:** Words in the raw HTML after removing scripts, styles, navigation, asides and site-chrome headers. 150 or more words with no empty app root: full points. 40 to 149 words: half. Fewer: none.

**Why it matters:** AI crawlers and most coding agents fetch the HTML and do not run JavaScript, so content rendered in the browser is invisible to them.

**Evidence:**

- [Do AI crawlers render JavaScript (Vercel and MERJ data, via SearchOptimo)](https://searchoptimo.com/blog/do-ai-crawlers-render-javascript)

### C2 Markdown on request (15 points)

**What it measures:** A GET of the page with Accept: text/markdown returns Markdown (a Markdown or plain-text content type, Markdown structure, not HTML).

**Why it matters:** Claude Code, Cursor and OpenCode ask for Markdown first. Markdown is far smaller than the HTML of the same page, so more of it fits in what the agent reads.

**Depends on your hosting:** Your web server or CDN decides what to return for Accept: text/markdown. A local build (`--dir` or a localhost URL) doesn't count this check.

**Evidence:**

- [Do AI agents read Markdown (Checkly data, via GoodBarber)](https://www.goodbarber.com/blog/do-ai-agents-read-markdown-what-two-weeks-of-our-own-server-logs-say-a1622/)
- [Cloudflare: Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)
- [Vercel: Markdown and agent discovery](https://vercel.com/docs/agent-resources/markdown-access)

### C3 .md version discoverable (15 points)

**What it measures:** A Markdown copy exists (rel=alternate, a Link header, or <url>.md) and is advertised (rel=alternate, a Link header, or listed in llms.txt): full points. Exists but not advertised: 8.

**Why it matters:** Agents guess .md URLs and follow llms.txt. A copy nothing points to is found less often.

**Depends on your hosting:** A Link header advertising the Markdown copy, or a rewrite to <page>.md, is set by your host. A local build (`--dir` or a localhost URL) counts this check, but your host can change the result.

**Evidence:**

- [Inside Mintlify's agent stack](https://theairuntime.com/p/inside-mintlifys-agent-stack)
- [Vercel: Markdown and agent discovery](https://vercel.com/docs/agent-resources/markdown-access)

### C4 llms.txt usable (20 points)

**What it measures:** llms.txt found at the root or docs path and not HTML: 8. Valid format (an H1 and Markdown links): 4. Sampled links resolve, up to 8 checked: 4 times the share. Size up to 50K characters: 4; up to 100K: 2.

**Why it matters:** Coding agents use llms.txt to find the right page. AI crawlers do not request it, so it counts for coding agents only.

**Evidence:**

- [Inside Mintlify's agent stack](https://theairuntime.com/p/inside-mintlifys-agent-stack)
- [llms.txt server-log study (Saaslinks)](https://saaslinks.net/blog/llms-txt-server-log-study)

### C5 Page fits one fetch (15 points)

**What it measures:** Size of what an agent receives (Markdown when offered, otherwise the HTML text): up to 50K characters 15, up to 100K 10, more 0. Under 40 words received: 0.

**Why it matters:** Agents read a limited window per fetch, about 100,000 characters, and have to page or give up beyond it.

**Evidence:**

- [How Claude Code eats the web](https://giuseppegurgone.com/claude-webfetch)

### C6 Sections findable (15 points)

**What it measures:** On what the agent receives: exactly one H1 5 (more than one 2). No heading-level skips 6 (one skip 3), counted only with at least 2 headings. Share of H2/H3 with id attributes times 4.

**Why it matters:** A URL #fragment never reaches the server, so agents fetch the whole page and find sections by heading text.

**Evidence:**

- [How Claude Code eats the web](https://giuseppegurgone.com/claude-webfetch)

## AI search

| ID | Check | Points |
|---|---|---|
| S1 | AI search bots allowed | 20 |
| S2 | Content without JavaScript | 20 |
| S3 | Indexable | 25 |
| S4 | Freshness declared | 15 |
| S5 | Answer-ready sections | 15 |
| S6 | JSON-LD | 5 |

### S1 AI search bots allowed (20 points)

**What it measures:** 20 times the share of six AI search and retrieval bots (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User) that robots.txt allows for this path. Most specific group, longest matching rule wins.

**Why it matters:** These bots fetch pages for ChatGPT search, Perplexity and Claude answers. A page they may not fetch cannot be cited.

**Evidence:**

- [48 days of AI bot logs (Wislr)](https://www.wislr.com/articles/ai-bot-behavior-log-analysis/)

### S2 Content without JavaScript (20 points)

**What it measures:** Words in the raw HTML after removing scripts, styles, navigation, asides and site-chrome headers. 150 or more words with no empty app root: full points. 40 to 149 words: half. Fewer: none.

**Why it matters:** AI crawlers and most coding agents fetch the HTML and do not run JavaScript, so content rendered in the browser is invisible to them.

**Evidence:**

- [Do AI crawlers render JavaScript (Vercel and MERJ data, via SearchOptimo)](https://searchoptimo.com/blog/do-ai-crawlers-render-javascript)

### S3 Indexable (25 points)

**What it measures:** Not noindex (meta robots or X-Robots-Tag): 10, and noindex makes the whole check 0. Canonical present: 7. Page listed in the sitemap: 8. Sitemaps named in robots.txt are used; without one, Lensy tries <link rel="sitemap">, /sitemap.xml and /sitemap-index.xml, then the same under the page's first path segment (for example /docs/sitemap.xml). Sitemap indexes are followed, at most 12 files.

**Why it matters:** A page that asks not to be indexed, or that search engines cannot find in the sitemap, is less likely to be retrieved for an answer.

**Depends on your hosting:** An X-Robots-Tag noindex header is set by your host. A local build (`--dir` or a localhost URL) counts this check, but your host can change the result.

**Evidence:**

- [arXiv 2609.35077: what drives citations in production LLMs](https://arxiv.org/html/2609.35077v1)

### S4 Freshness declared (15 points)

**What it measures:** A date in the raw HTML (dateModified, article:modified_time, <time datetime> or visible "Last updated" text): 6. This URL's sitemap entry has lastmod: 4. Sitemap lastmod values are not all identical: 3. Page date and lastmod agree within 7 days: 2. Age is shown, not scored.

**Why it matters:** Recency is a consistent secondary signal for AI citations, and search engines use sitemap lastmod only when it is believable.

**Evidence:**

- [arXiv 2605.25517: what gets cited (competitive GEO)](https://arxiv.org/html/2605.25517v1)
- [Freshness signals for answer engines (Stackmatix)](https://www.stackmatix.com/blog/content-freshness-signals-answer-engines)

### S5 Answer-ready sections (15 points)

**What it measures:** On the HTML: one H1 4 (more than one 2). No heading skips 4 (one skip 2), counted only with at least 2 headings. Median words per H2/H3 section: 40 to 500 7; under 40 or 501 to 900 4; over 900 1; no sections 0.

**Why it matters:** AI search retrieves passages of about a heading plus its paragraphs, so each section should answer one question on its own.

**Evidence:**

- [Passage-level retrieval (Paz.ai)](https://www.paz.ai/glossary/passage-level-retrieval)

### S6 JSON-LD (5 points)

**What it measures:** Parseable JSON-LD with an @type: 3. Has dateModified: 2.

**Why it matters:** Controlled studies found structured data barely moves AI citations, so it carries few points. dateModified also declares freshness.

**Evidence:**

- [Ahrefs: we tracked 1,885 pages adding schema](https://ahrefs.com/blog/schema-ai-citations/)
- [Otterly: schema markup's real impact on AI search](https://otterly.ai/blog/schema-markup-real-impact-ai-search/)
- [arXiv 2609.35077: what drives citations in production LLMs](https://arxiv.org/html/2609.35077v1)
