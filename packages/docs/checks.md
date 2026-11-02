# Lensy checks

Generated from the engine's check registry (`backend/lambda/agent-handler/tools/check-registry.ts`) by `npm run docs:checks`. Don't edit by hand.

Lensy gives two scores out of 100. Each check below is worth the points shown in one of them. `lensy explain <id>` prints the same text.

## Coding agents

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

**Checking source files:** Needs the built site: the rendered HTML, the files your build generates and the headers your host sends.

**Evidence:**

- [Do AI crawlers render JavaScript (Vercel and MERJ data, via SearchOptimo)](https://searchoptimo.com/blog/do-ai-crawlers-render-javascript)

### C2 Markdown on request (15 points)

**What it measures:** A GET of the page with Accept: text/markdown returns Markdown (a Markdown or plain-text content type, Markdown structure, not HTML).

**Why it matters:** Claude Code, Cursor and OpenCode ask for Markdown first. Markdown is far smaller than the HTML of the same page, so more of it fits in what the agent reads.

**Depends on your hosting:** Your web server or CDN decides what to return for Accept: text/markdown.

**Checking source files:** Needs the built site: the rendered HTML, the files your build generates and the headers your host sends.

**Evidence:**

- [Do AI agents read Markdown (Checkly data, via GoodBarber)](https://www.goodbarber.com/blog/do-ai-agents-read-markdown-what-two-weeks-of-our-own-server-logs-say-a1622/)
- [Cloudflare: Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)
- [Vercel: Markdown and agent discovery](https://vercel.com/docs/agent-resources/markdown-access)

### C3 .md version discoverable (15 points)

**What it measures:** A Markdown copy exists (rel=alternate, a Link header, or <url>.md) and is advertised (rel=alternate, a Link header, or listed in llms.txt): full points. Exists but not advertised: 8.

**Why it matters:** Agents guess .md URLs and follow llms.txt. A copy nothing points to is found less often.

**Depends on your hosting:** A Link header advertising the Markdown copy, or a rewrite to <page>.md, is set by your host.

**Checking source files:** Needs the built site: the rendered HTML, the files your build generates and the headers your host sends.

**Evidence:**

- [Inside Mintlify's agent stack](https://theairuntime.com/p/inside-mintlifys-agent-stack)
- [Vercel: Markdown and agent discovery](https://vercel.com/docs/agent-resources/markdown-access)

### C4 llms.txt usable (20 points)

**What it measures:** llms.txt found at the root or docs path and not HTML: 8. Valid format (an H1 and Markdown links): 4. Sampled links resolve, up to 8 checked: 4 times the share. Size up to 50K characters: 4; up to 100K: 2.

**Why it matters:** Coding agents use llms.txt to find the right page. AI crawlers do not request it, so it counts for coding agents only.

**Checking source files:** Scored only when a static llms.txt is in the folder (for example public/ or static/); links are checked against files in the folder.

**Evidence:**

- [Inside Mintlify's agent stack](https://theairuntime.com/p/inside-mintlifys-agent-stack)
- [llms.txt server-log study (Saaslinks)](https://saaslinks.net/blog/llms-txt-server-log-study)

### C5 Page fits one fetch (15 points)

**What it measures:** Size of what an agent receives (Markdown when offered, otherwise the HTML text): up to 50K characters 15, up to 100K 10, more 0. Under 40 words received: 0.

**Why it matters:** Agents read a limited window per fetch, about 100,000 characters, and have to page or give up beyond it.

**Checking source files:** Estimated from the Markdown length.

**Evidence:**

- [How Claude Code eats the web](https://giuseppegurgone.com/claude-webfetch)

### C6 Sections findable (15 points)

**What it measures:** On what the agent receives: exactly one H1 5 (more than one 2). No heading-level skips 6 (one skip 3), counted only with at least 2 headings. Share of H2/H3 with id attributes times 4.

**Why it matters:** A URL #fragment never reaches the server, so agents fetch the whole page and find sections by heading text.

**Checking source files:** Partly measured: one H1 and heading levels (11 of 15 points). Heading ids are added by your build.

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

**Checking source files:** Scored only when a static robots.txt is in the folder.

**Evidence:**

- [48 days of AI bot logs (Wislr)](https://www.wislr.com/articles/ai-bot-behavior-log-analysis/)

### S2 Content without JavaScript (20 points)

**What it measures:** Words in the raw HTML after removing scripts, styles, navigation, asides and site-chrome headers. 150 or more words with no empty app root: full points. 40 to 149 words: half. Fewer: none.

**Why it matters:** AI crawlers and most coding agents fetch the HTML and do not run JavaScript, so content rendered in the browser is invisible to them.

**Checking source files:** Needs the built site: the rendered HTML, the files your build generates and the headers your host sends.

**Evidence:**

- [Do AI crawlers render JavaScript (Vercel and MERJ data, via SearchOptimo)](https://searchoptimo.com/blog/do-ai-crawlers-render-javascript)

### S3 Indexable (25 points)

**What it measures:** Not noindex (meta robots or X-Robots-Tag): 10, and noindex makes the whole check 0. Canonical present: 7. Page listed in the sitemap: 8 (robots.txt Sitemap: lines and sitemap indexes are followed, at most 12 files).

**Why it matters:** A page that asks not to be indexed, or that search engines cannot find in the sitemap, is less likely to be retrieved for an answer.

**Depends on your hosting:** An X-Robots-Tag noindex header is set by your host.

**Checking source files:** Needs the built site: the rendered HTML, the files your build generates and the headers your host sends.

**Evidence:**

- [arXiv 2609.35077: what drives citations in production LLMs](https://arxiv.org/html/2609.35077v1)

### S4 Freshness declared (15 points)

**What it measures:** A date in the raw HTML (dateModified, article:modified_time, <time datetime> or visible "Last updated" text): 6. This URL's sitemap entry has lastmod: 4. Sitemap lastmod values are not all identical: 3. Page date and lastmod agree within 7 days: 2. Age is shown, not scored.

**Why it matters:** Recency is a consistent secondary signal for AI citations, and search engines use sitemap lastmod only when it is believable.

**Checking source files:** Partly measured: a page date from front matter (6 of 15 points). Sitemap dates are added by your build.

**Evidence:**

- [arXiv 2605.25517: what gets cited (competitive GEO)](https://arxiv.org/html/2605.25517v1)
- [Freshness signals for answer engines (Stackmatix)](https://www.stackmatix.com/blog/content-freshness-signals-answer-engines)

### S5 Answer-ready sections (15 points)

**What it measures:** On the HTML: one H1 4 (more than one 2). No heading skips 4 (one skip 2), counted only with at least 2 headings. Median words per H2/H3 section: 40 to 500 7; under 40 or 501 to 900 4; over 900 1; no sections 0.

**Why it matters:** AI search retrieves passages of about a heading plus its paragraphs, so each section should answer one question on its own.

**Checking source files:** Measured from the Markdown. Your build may add an H1 from the front-matter title.

**Evidence:**

- [Passage-level retrieval (Paz.ai)](https://www.paz.ai/glossary/passage-level-retrieval)

### S6 JSON-LD (5 points)

**What it measures:** Parseable JSON-LD with an @type: 3. Has dateModified: 2.

**Why it matters:** Controlled studies found structured data barely moves AI citations, so it carries few points. dateModified also declares freshness.

**Checking source files:** Needs the built site: the rendered HTML, the files your build generates and the headers your host sends.

**Evidence:**

- [Ahrefs: we tracked 1,885 pages adding schema](https://ahrefs.com/blog/schema-ai-citations/)
- [Otterly: schema markup's real impact on AI search](https://otterly.ai/blog/schema-markup-real-impact-ai-search/)
- [arXiv 2609.35077: what drives citations in production LLMs](https://arxiv.org/html/2609.35077v1)
