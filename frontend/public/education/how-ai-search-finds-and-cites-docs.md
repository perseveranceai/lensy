# How AI Search Finds, Processes, and Cites Your Docs

> AI Discoverability | 3 min read | Published 2026-03-22

## TL;DR

- Chunking strategy matters. Element-based chunking that respects document structure achieved 84.4% page-level accuracy, while 512-token windows with 200-token overlap scored highest across 90 configurations.
- llms.txt lets you serve Markdown directly to AI agents. Fern reports over 90% reduction in token consumption. Twilio, Stripe, and Cloudflare have also adopted it.
- Perplexity cites sources on nearly every response. Brands mentioned positively across 4+ platforms are 2.8× more likely to appear in ChatGPT responses.

## How Chunking Works

AI search engines crawl your page, convert HTML to text or Markdown, split it into chunks, embed those chunks in vector space, and retrieve relevant pieces to generate an answer. Each stage is sensitive to document quality.

Jimeno-Yepes et al. [1] demonstrated that element-based chunking that respects document structure — headings, paragraphs, code blocks — rather than splitting at arbitrary character boundaries achieved 84.4% accuracy at page level and improved ROUGE and BLEU scores over naive splitting. Stäbler and Turnbull [2] benchmarked 90 chunker-model configurations across 7 domains and found sentence-based splitting with 512-token windows and 200-token overlap achieved the highest retrieval accuracy. Vectara's study [3] tested 25 chunking configurations across 48 embedding models and confirmed that fixed-size chunking at 256–512 tokens consistently outperformed more computationally expensive semantic chunking.

## llms.txt and Markdown Alternate Links

Proposed by Jeremy Howard of Answer.AI in September 2024, llms.txt [4] is a Markdown file that helps LLMs navigate websites by providing structured links to content instead of requiring models to parse HTML boilerplate. Adoption has been rapid:

Beyond llms.txt, individual pages can signal Markdown availability using {""} in the HTML head. This per-page approach complements llms.txt by letting AI agents discover the Markdown version of any specific page they land on, without needing to consult a central index first.

- Twilio [5] exposes Markdown versions of all docs (append .md to any URL) plus a curated llms.txt sitemap.
- Fern [6] serves two variants: lightweight /llms.txt with summaries and comprehensive /llms-full.txt. Markdown serving reduces token consumption by over 90%.
- Stripe's llms.txt includes an "instructions" section that guides AI to the right integration path.
- Cloudflare organised theirs by service category for selective retrieval.

## How Platforms Decide What to Cite

Citation behaviour varies significantly across platforms. Perplexity is retrieval-first and cites sources on nearly every response, with Reddit as its most-cited source at 6.6% of all citations [7]. ChatGPT cites when browsing is enabled, with Wikipedia leading at 7.8% [7]. Google AI Overviews distributes citations more evenly across sources.

Several patterns emerge. Pages with clear headings, code examples, and step-by-step instructions get cited more than dense prose. Technical reference queries trigger citations more reliably than generic how-tos. Brands mentioned positively across 4+ non-affiliated platforms are 2.8× more likely to appear in ChatGPT responses [8].

## References

1. [Jimeno-Yepes et al. "Financial Report Chunking for Effective RAG." arXiv:2402.05131, 2024.](https://arxiv.org/abs/2402.05131)
2. [Stäbler, Turnbull et al. "Chunking Strategies for Domain-Specific IR in RAG." IEEE, 2024.](https://ieeexplore.ieee.org/document/11125724)
3. [Qu et al. "Is Semantic Chunking Worth the Computational Cost?" NAACL 2025.](https://arxiv.org/abs/2410.13070)
4. [Howard, J. "llms.txt: A Proposal to Help LLMs Use Websites." Answer.AI, 2024.](https://www.answer.ai/posts/2024-09-03-llmstxt.html)
5. [Twilio. "Docs Support for llms.txt and Markdown." 2024.](https://www.twilio.com/en-us/blog/developers/docs-llms-txt-markdown-support)
6. [Fern. "Markdown for LLMs." 2025.](https://buildwithfern.com/learn/docs/ai-features/llms-txt)
7. [Yext. "How AI Engines Decide What to Cite." 2026.](https://www.yext.com/blog/2026/03/how-chatgpt-perplexity-gemini-claude-decide-what-to-cite)
8. [XFunnel. "What Sources Do AI Search Engines Cite?" 2026.](https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose)

---

Check your documentation's AI readiness at [https://gamma.perseveranceai.com](https://gamma.perseveranceai.com)
