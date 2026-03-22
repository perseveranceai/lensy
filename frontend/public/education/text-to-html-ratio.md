# Text-to-HTML Ratio: What AI Engines Actually See

> Content Health | 4 min read | Published 2026-03-18

When an AI crawler visits your documentation page, it doesn't see what your users see. It strips the HTML, discards the navigation chrome, sidebars, and footers, and converts what's left to plain text or markdown.

The text-to-HTML ratio measures how much of your page is actual content versus markup and boilerplate. Pages heavy on navigation elements and light on content give AI crawlers a poor signal-to-noise ratio.

## Why It Matters Less Than You Think

Here's the nuance: AI crawlers are pretty good at extracting content from HTML. They convert to markdown before processing, so the raw ratio is less important than the quality of what's left after conversion.

What matters more is heading structure (H1, H2, H3), code blocks (properly tagged), and whether your content flows logically. AI engines use these structural signals to understand your documentation's organization.

## What Lensy Checks

Beyond raw text-to-HTML ratio, Lensy evaluates content health through:

- Heading hierarchy: proper H1 > H2 > H3 nesting
- Code block presence: tagged code examples that AI can extract
- Internal linking: connections between related documentation pages
- Content length: enough substance to be a useful reference
- Markdown availability: whether an .md version of the page exists

---

Check your documentation's AI readiness at [https://gamma.perseveranceai.com](https://gamma.perseveranceai.com)
