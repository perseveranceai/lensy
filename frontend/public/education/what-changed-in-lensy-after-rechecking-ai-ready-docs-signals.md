# What Changed in Lensy After Re-checking AI-Ready Docs Signals

> AI Readiness | 4 min read | Published 2026-04-05

## Why We Revisited This

Lensy's detection model was re-checked after new feedback exposed an important pattern: some documentation sites already expose machine-readable content in ways a simpler audit can miss.

That matters because an AI-readiness audit is not just asking whether a page exists. It is asking whether AI systems can find it, fetch it in a machine-friendly format, and map it back to the broader docs structure.

The original llms.txt proposal focused on a plain Markdown index and linked Markdown pages [3]. Since then, the implementation surface has expanded. Docs platforms now expose full-site context files, same-URL Markdown negotiation, and per-page headers that point agents to the right index or representation [1, 2].

## Markdown Is Broader Than .md

The original proposal recommends serving Markdown pages with .md appended to the original URL [3]. That remains a useful convention. But it is no longer the only one that matters.

Cloudflare's Markdown for Agents serves Markdown from the same URL when a client sends an Accept request for Markdown [2]. That can materially change how much useful context an agent can consume: Cloudflare shows one page dropping from 16,180 tokens in HTML to 3,150 tokens in Markdown, roughly an 80% reduction [2].

That means a docs audit cannot stop at probing page.md. It also needs to test whether the page itself returns Markdown through content negotiation.

## llms.txt Discovery Is Broader Than One Path

The proposal explicitly allows llms.txt in the root or in a subpath [3]. That matters because many docs live under /docs/, /developer/, or another scoped path.

Current implementations also go beyond llms.txt alone. Mintlify documents llms-full.txt, Link and X-Llms-Txt headers, and .md page links inside llms.txt itself [1]. Those change what a high-quality docs audit should verify.

In practice, that means checking more than whether /llms.txt exists. It also means checking whether the site exposes llms-full.txt [1], the page advertises docs indexes through headers [1], the page returns Markdown directly through an Accept request [1, 2], and the exact page is mapped inside llms.txt as a Markdown URL [1].

## What Changed in Lensy

Lensy's current audit model now reflects that broader pattern. The AI Readiness view reports discrete signals rather than collapsing everything into a single grade, and it separates site-level and page-level checks such as llms.txt, llms-full.txt, page Markdown, content negotiation, and page-level mapping in llms.txt.

It also treats some signals more carefully than before. A Link header is treated as a hint that still needs validation, not proof. A best-practice signal like rel="alternate" for a Markdown version is still worth surfacing, but it is no longer treated as the strongest evidence of machine-readable support when llms.txt, direct Markdown URLs, or content negotiation already exist [1, 2, 3].

## What This Means

The broader lesson is simple. AI-ready documentation is no longer just about whether a page is crawlable or well written. It is also about whether the site exposes machine-readable paths in the ways modern agents actually use them.

Research still supports the underlying principle. WebSRC found that answering questions about web pages requires understanding page structure, not just the text on the page [4]. The more documentation platforms expose agent-friendly structure directly, the more accurate an AI-readiness audit also has to become.

---

Check your documentation's AI readiness at [https://perseveranceai.com](https://perseveranceai.com)
