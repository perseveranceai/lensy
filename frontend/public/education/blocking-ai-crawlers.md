# Why Blocking AI Crawlers Costs You Developer Traffic

> Bot Access | 4 min read | Published 2026-03-18

Your robots.txt file tells bots what they can and can't crawl. Many sites added blanket blocks for AI crawlers when GPTBot and others first appeared, worried about content scraping. But blocking AI crawlers also means blocking AI search engines from citing your documentation.

## 10 AI Crawlers That Matter

Lensy checks your robots.txt against these 10 major AI user agents:

- GPTBot (OpenAI / ChatGPT Search)
- ClaudeBot (Anthropic / Claude)
- PerplexityBot (Perplexity AI)
- Google-Extended (Gemini)
- Bytespider (ByteDance / Doubao)
- CCBot (Common Crawl, used by many AI models)
- Amazonbot (Alexa / Amazon)
- YouBot (You.com)
- Cohere-ai (Cohere)
- Meta-ExternalAgent (Meta AI)

## The Trade-Off

There's a legitimate tension: you want AI engines to cite your docs, but you may not want them training on your content. Some crawlers (like GPTBot) are used for both search and training.

The reality is that blocking crawlers removes your documentation from AI-powered search results entirely. For most developer documentation, the visibility benefits far outweigh the training concerns.

## Quick Fix

Check your robots.txt. If you see "Disallow: /" for any of these user agents, you're blocking AI search. Consider allowing access with explicit "Allow: /" directives for the crawlers you want to reach.

Lensy checks all 10 crawlers instantly and tells you exactly which ones are blocked.

---

Check your documentation's AI readiness at [https://gamma.perseveranceai.com](https://gamma.perseveranceai.com)
