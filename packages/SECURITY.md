# Security

Report a vulnerability in the Lensy CLI (`@perseverance-ai/lensy`) or its engine (`@perseverance-ai/lensy-core`) by email to hello@perseveranceai.com. Please don't open a public issue for it.

Include the version (`lensy --version`), what you ran, and what happened.

## What the CLI does on your machine

- It fetches only the pages you ask it to check, and the files the checks need (robots.txt, sitemap, llms.txt, the page's Markdown version). Every request names itself `lensy-cli/<version> (+https://perseveranceai.com/bot)`.
- `--serve` binds to `127.0.0.1` only and serves files inside the folder you give it.
- `--source` reads files from disk and makes no network requests.
- Nothing is sent to Perseverance AI unless you opt in to usage records or run `lensy report-issue`. The README lists every field a usage record contains.
