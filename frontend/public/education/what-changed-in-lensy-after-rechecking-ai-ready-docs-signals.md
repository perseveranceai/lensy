# What Changed in Lensy After Re-checking AI-Ready Docs Signals

> AI Readiness | 4 min read | Published 2026-09-19

When we shipped the first version of Lensy, the discoverability checks were straightforward: does the page render in a headless browser, is it accessible to known AI crawlers, does it have a robots.txt that permits indexing. Those checks are necessary, but they aren't enough.

A second pass at the signals that actually predict AI citation rates revealed a gap. The original checks treated Markdown support as binary: either the page serves a .md file or it does not. That framing is wrong.

## llms.txt and the explicit declaration pattern

The llms.txt proposal formalizes a pattern used by Anthropic, Cloudflare, Vercel, and Stripe. It's a plain text manifest at the root of a site that lists which pages exist, what they contain, and what order to read them in.

The file does two things. For retrieval-augmented systems, it provides a curated index that a model can read before deciding which pages to fetch. For citation systems, it establishes a canonical hierarchy that helps a model explain where it found something. Lensy now checks for /llms.txt and /llms-full.txt at the domain root and scores their completeness.

## Content negotiation and the Accept header

Some documentation platforms — notably those built on Mintlify, Nextra, and Docusaurus with the right plugins — will return Markdown when a request includes Accept: text/markdown in the header. This is simple content negotiation. It helps an AI agent ingest clean, structured content without parsing HTML.

Lensy now sends a content-negotiation request alongside its standard HTML fetch and reports whether the server honours it. Sites that do tend to score significantly higher on the context dimension of the audit.

## Link headers for structured navigation

HTTP Link headers can declare relationships between pages: rel="next", rel="prev", rel="up". These are standard mechanisms for communicating document structure at the protocol layer — before any HTML is parsed. Documentation sites that emit these headers make it straightforward for a crawler to discover a full guide by following links rather than parsing a sidebar.

We added a Link header check after noticing that documentation sites with clear structural navigation were consistently cited more accurately — even when their on-page HTML structure was ambiguous.

## Page-level topic mapping

The original audit scored metadata at the page level in a binary way: either there is a description meta tag or there is not. The updated check goes further. Lensy now extracts the declared topic from og:description, Schema.org TechArticle markup, and any explicit keywords meta field, and then compares those declared topics against the actual heading structure and first-paragraph content of the page.

Pages where the declared topic and the content diverge — a common symptom of boilerplate meta descriptions — score lower on the context dimension. This turned out to explain a meaningful fraction of the variance between sites that get cited and sites that do not.

## What stayed the same

Bot access comes first. It must pass before we evaluate anything else. If ClaudeBot, OAI-SearchBot, or Google-Extended are blocked by robots.txt or rate-limiting, the rest of the audit is moot. The access check is unchanged. The structure and citation dimensions retain their original logic; the new checks sit within the context dimension.

The scoring weights shifted to reflect the updated signals. Access remains necessary but not weighted heavily once it passes. Context — which now includes llms.txt, content negotiation, Link headers, and topic mapping — carries more weight than before. Citation readiness, which measures whether a page provides a clear, directly quotable answer to the question a page title implies, remains the highest-weighted dimension.

---

Check your documentation's AI readiness at [https://perseveranceai.com](https://perseveranceai.com)
