# How AI Search Finds, Processes, and Cites Your Docs

> AI Discoverability | 3 min read | Published 2026-09-19

- Chunking strategy matters. Element-based chunking that respects document structure achieved 84.4% page-level accuracy, while 512-token windows with 200-token overlap scored highest across 90 configurations.
- llms.txt lets you serve Markdown directly to AI agents. Fern reports over 90% reduction in token consumption. Twilio, Stripe, and Cloudflare have also adopted it.
- Perplexity cites sources on nearly every response. Brands mentioned positively across 4+ platforms are 2.8× more likely to appear in ChatGPT responses.

## How Chunking Works

AI search engines crawl your page, convert HTML to text or Markdown, split it into chunks, embed those chunks in vector space, and retrieve relevant pieces to generate an answer. Each stage is sensitive to document quality.

Jimeno-Yepes et al. [1] demonstrated that element-based chunking that respects document structure — headings, paragraphs, code blocks — rather than splitting at arbitrary character boundaries achieved 84.4% accuracy at page level and improved ROUGE and BLEU scores over naive splitting. Stäbler and Turnbull [2] benchmarked 90 chunker-model configurations across 7 domains and found sentence-based splitting with 512-token windows and 200-token overlap achieved the highest retrieval accuracy. Vectara's study [3] tested 25 chunking configurations across 48 embedding models and confirmed that fixed-size chunking at 256–512 tokens consistently outperformed more computationally expensive semantic chunking.

## llms.txt and Markdown Alternate Links

Proposed by Jeremy Howard of Answer.AI in September 2024, llms.txt [4] is a Markdown file that helps LLMs navigate websites by providing structured links to content instead of requiring models to parse HTML boilerplate. Adoption has been rapid:

Beyond llms.txt, individual pages can signal Markdown availability using {""} in the HTML head. This per-page approach complements llms.txt by letting AI agents discover the Markdown version of any specific page they land on, without needing to consult a central index first.

## How Platforms Decide What to Cite

Citation behaviour varies significantly across platforms. Perplexity is retrieval-first and cites sources on nearly every response, with Reddit as its most-cited source at 6.6% of all citations [7]. ChatGPT cites when browsing is enabled, with Wikipedia leading at 7.8% [7]. Google AI Overviews distributes citations more evenly across sources.

Several patterns emerge. Pages with clear headings, code examples, and step-by-step instructions get cited more than dense prose. Technical reference queries trigger citations more reliably than generic how-tos. Brands mentioned positively across 4+ non-affiliated platforms are 2.8× more likely to appear in ChatGPT responses [8].

---

Check your documentation's AI readiness at [https://perseveranceai.com](https://perseveranceai.com)
