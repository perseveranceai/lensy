# How AI Search Engines Cite Documentation

> Discoverability | 6 min read | Published 2026-03-18

Lensy doesn't just check if your docs are crawlable. It sends real developer-intent queries to AI search engines and checks whether your documentation gets cited in the responses.

## The 3-Tier Query Strategy

Based on research into how developers search (Prompt Evolution in Software Repos, 2024), Lensy generates queries at three intent levels:

- High intent: Includes the specific framework or technology mentioned on your page. Example: "how to configure NextAuth.js session callbacks"
- Mid intent: Includes the technology category but not specific framework names. Example: "authentication session management in React"
- Low intent: Pure generic problem statement with no technology names. Example: "how to handle user session expiry"

## Why Three Tiers?

Developers don't always know the exact technology they need. They often start with a generic problem and refine toward specific solutions. Your documentation should be discoverable at every level.

If your page only shows up for high-intent queries (exact technology name), you're missing developers who haven't yet decided on a solution. If it only shows up for low-intent queries, developers looking for your specific tool won't find you.

## What Gets Cited

AI search engines tend to cite documentation that is well-structured, authoritative, and directly answers the query. Pages with clear headings, code examples, and explicit step-by-step instructions get cited more often than pages with dense prose.

Lensy reports which of your queries returned citations to your URL and which didn't, so you know exactly where your discoverability gaps are.

---

Check your documentation's AI readiness at [https://perseveranceai.com](https://perseveranceai.com)
