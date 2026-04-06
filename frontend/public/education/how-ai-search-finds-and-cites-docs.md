# How AI Search Finds, Processes, and Cites Your Docs

> AI Discoverability | 3 min read | Published 2026-03-22

## How Chunking Works

AI search engines crawl your page, convert HTML to text or Markdown, split it into chunks, embed those chunks in vector space, and retrieve relevant pieces to generate an answer. Each stage is sensitive to document quality.

Jimeno-Yepes et al. [1] demonstrated that element-based chunking that respects document structure (headings, paragraphs, code blocks) rather than splitting at arbitrary character boundaries achieved 84.4% accuracy at page level and improved ROUGE and BLEU scores over naive splitting. Stäbler and Turnbull [2] benchmarked 90 chunker-model configurations across 7 domains and found sentence-based splitting with 512-token windows and 200-token overlap achieved the highest retrieval accuracy. Vectara's study [3] tested 25 chunking configurations across 48 embedding models and confirmed that fixed-size chunking at 256\u2013512 tokens consistently outperformed more computationally expensive semantic chunking.

## llms.txt and Markdown Alternate Links

Proposed by Jeremy Howard of Answer.AI in September 2024, llms.txt [4] is a Markdown file that helps LLMs navigate websites by providing structured links to content instead of requiring models to parse HTML boilerplate. Adoption has been rapid:

- Twilio [5] exposes Markdown versions of all docs (append .md to any URL) plus a curated llms.txt sitemap.
- Fern [6] serves two variants: lightweight /llms.txt with summaries and comprehensive /llms-full.txt. Markdown serving reduces token consumption by over 90%.
- Stripe's llms.txt includes an "instructions" section that guides AI to the right integration path.
- Cloudflare organized theirs by service category for selective retrieval.
- Beyond llms.txt, individual pages can signal Markdown availability using <link rel="alternate" type="text/markdown" href="/path/to/page.md"> in the HTML head. This per-page approach complements llms.txt by letting AI agents discover the Markdown version of any specific page they land on, without needing to consult a central index first.

## How Platforms Decide What to Cite

Citation behavior varies significantly across platforms. Perplexity is retrieval-first and cites sources on nearly every response, with Reddit as its most-cited source at 6.6% of all citations [7]. ChatGPT cites when browsing is enabled, with Wikipedia leading at 7.8% [7]. Google AI Overviews distributes citations more evenly across sources.

Several patterns emerge. Pages with clear headings, code examples, and step-by-step instructions get cited more than dense prose. Technical reference queries trigger citations more reliably than generic how-tos. Brands mentioned positively across 4+ non-affiliated platforms are 2.8x more likely to appear in ChatGPT responses [8].

---

Check your documentation's AI readiness at [https://perseveranceai.com](https://perseveranceai.com)
