# @perseverance-ai/lensy

`lensy` checks whether coding agents (Claude Code, Cursor and others) and AI search engines (ChatGPT, Perplexity, Claude) can find and read your docs pages. It gives the same two scores out of 100 as [perseveranceai.com](https://perseveranceai.com), and tells you what to fix first.

- **Coding agents** is built on [AFDocs](https://afdocs.dev), the open Agent-Friendly Documentation checks, plus one Lensy check for headings.
- **AI search** covers whether AI search bots may read the page, whether it renders without JavaScript, indexing, freshness, answer-ready sections and JSON-LD.

It runs on your machine. Nothing about your pages is sent to Perseverance AI.

Full guide: https://perseveranceai.com/cli

## Install

You need Node 22 or newer.

```bash
npm install -g @perseverance-ai/lensy@next
lensy --version
```

Or run it once without installing:

```bash
npx @perseverance-ai/lensy@next check https://docs.example.com/guide
```

It's an early release, published under the `next` tag (for now it's also the default version).

## Check a page

```bash
lensy check https://vitepress.dev/guide/getting-started
```

```
https://vitepress.dev/guide/getting-started
  Coding agents 87/100    AI search 95/100
  Reachability: an honest AI agent can read this page (HTTP 200). robots.txt allows all 6 AI search bots.
  What an agent receives: Markdown, 6,235 characters (about 1,559 tokens), fits in one fetch

  Fix these first
   1. Page points agents to llms.txt (HTML)       −6  Coding agents
      Add a visually-hidden element near the top of each page (e.g., a div with
      CSS clip-rect) containing a link to your llms.txt.
   2. JSON-LD                                     −5  AI search
      Add a JSON-LD block (for example TechArticle) with dateModified.
   3. Page points agents to llms.txt (Markdown)   −4  Coding agents
   4. Markdown on request                         −3  Coding agents

  Passed: 20 of 25 Coding agents checks, 5 of 6 AI search checks.
```

The points lost add up to each score: fix everything listed and both scores reach 100. Add `--verbose` to see every check with its id, points and full fix. `lensy explain <check>` explains any check, for example `lensy explain llms-txt-exists`.

## Several pages

```bash
lensy check https://docs.example.com/start https://docs.example.com/api
lensy check --urls-file urls.txt
```

You get one row per page, then the three biggest fixes for each. Lensy checks exactly the pages you give it, each once, and never crawls.

## Check a local build

Check your docs before you publish them: build the site, then point Lensy at the build folder. Lensy serves it on your machine for the length of the run and checks it like a published site. Nothing is sent anywhere else.

```bash
npx vitepress build docs
lensy check --dir docs/.vitepress/dist --site-url https://docs.example.com --all
```

- `--site-url` is your published docs address. The build's sitemap, `llms.txt` and canonical links name it, and Lensy matches them to the local files. With a base path, include it: `https://example.com/docs`.
- `--all` checks every page in the build. Without it, name pages by path (`/guide/getting-started`), or leave them out to check the home page.
- Build folders: `docs/.vitepress/dist` (VitePress), `build` (Docusaurus), `site` (MkDocs), `dist` (Astro Starlight).
- Already running your tool's preview of the production build? `lensy check http://localhost:4173 --site-url https://docs.example.com --all` checks it instead, reading its sitemap for `--all`. Use the preview command, not the dev server.

Some checks depend on your web server or CDN, not your build (Markdown on request, real 404s, redirects, cache headers, login walls, bot protection). A local check leaves them out, names them, and shows each score as points earned out of the points it could check:

```
  Coding agents 58 of 70 points checked    AI search 77 of 100 points checked
```

Fix something, rebuild and check again with saving on (below) to see the change: `AI search 77 → 89 (+12)`.

## Reports

```bash
lensy check https://docs.example.com/guide --md report.md --html report.html --json report.json
```

- `--md`: Markdown for coding agents. The fixes are a checklist ordered by points.
- `--html`: one offline file to share. It has no scripts and no external links.
- `--json`: for scripts and CI. `--json -` prints only the JSON.

## Save and compare runs

The first time you run `lensy check` in a project, it asks whether to save results. Say yes, and every run is saved in `.lensy/` at your project root (the folder with `.git`), and each page is compared with its last run:

```
  Coding agents 87/100    AI search 95/100
  Since Nov 2 (6 days ago): Coding agents 80 → 87 (+7)    AI search 95 → 95
  Fixed: llms.txt exists
```

```
.lensy/
├── config.json      project settings
├── latest.md        the last run, every page: hand it to a coding agent
├── history.md       one row per page per run, newest first
└── pages/<site>/<path>/
    ├── latest.json  latest.md  page.json
    └── runs/<time>.json        one file per run (the newest 52 are kept)
```

List your pages in `.lensy/config.json`, and `lensy check` with no URLs checks them all:

```json
{ "configVersion": 1, "save": true, "keep": 52, "pages": ["https://docs.example.com/guide/start"] }
```

- **Where it asks:** only in a terminal. In CI, in scripts or with `--json -`, it never asks, and saves only if `.lensy/config.json` says `"save": true` or you pass `--save`. If `.lensy/` exists but a run doesn't save, Lensy says so.
- **Where it saves:** `.lensy/` at the git root, or in the current folder outside a git project.
- **For one run:** `--save` saves, `--no-save` doesn't (and doesn't ask), and `--save-dir <dir>` saves somewhere else.
- **A "no" answer** is remembered in `~/.lensy/config.json`.

Saved results stay on your machine. Commit `.lensy/` to share the history with your team.

## Exit codes

- `0`: every page was checked.
- `2`: the command was wrong (no URL, a bad option, a `--dir` folder with no built pages, a problem in `.lensy/config.json`, or results can't be saved where asked). Nothing was fetched.
- `3`: at least one page couldn't be checked: unreachable, not HTML, or refused by bot protection.
- `1`: something unexpected failed, or a run told to save couldn't write its results.

Scores never change the exit code.

## What it sends

Every request carries `lensy-cli/<version> (+https://perseveranceai.com/bot)`, AFDocs' requests included. For each page, Lensy fetches the page, robots.txt, the sitemap, llms.txt and a sample of its links, the page's Markdown version, and the other URLs the checks need. That's usually 15 to 60 requests, from your machine to the sites you named, and nowhere else. If a site's bot protection refuses the tool, it doesn't retry as a browser.

Not yet: checking source files before you build, or pages behind a login.

## Requirements

- Node 22 or newer, and npm. No account, no API key, nothing to configure.
- For live pages: network access to the sites you check, and nothing else.
- For a local build: your built site (a folder of HTML from any static docs tool). A local check sends nothing off your machine.

## Tested on

- **Every pull request** runs the full test suite (about 700 tests) on Linux, macOS and Windows with Node 22 and 24. A few tests of Unix file permissions and symlinks run on Linux and macOS only.
- **By hand on macOS 26 (Apple silicon)** with Node 22.23, 24.22 and 26.12, on 2026-11-08:
  - live pages on VitePress, Docusaurus, Mintlify, GitBook, Read the Docs, MkDocs Material, Nextra, Starlight, Stripe, GitHub Docs and MDN;
  - local builds from VitePress 1.6.4 (with and without a `base` path), Docusaurus 3.10.2 (`--dir` and `docusaurus serve` gave the same scores), Astro Starlight 0.42 and MkDocs Material 9.8;
  - folder paths with spaces, running from a subfolder, and a network sandbox that blocked every host except this machine.
- Not yet tried by hand: Windows and Linux desktops (they're covered by the automated tests above).

Known issues being fixed: Astro's `sitemap-index.xml` and sitemaps under a base path aren't read yet, and a canonical link written without quotes (as Docusaurus minifies it) isn't detected. Each costs some AI search points it shouldn't.

## Report a problem

- **Bugs and questions:** [open an issue on GitHub](https://github.com/perseveranceai/lensy/issues/new?template=cli-bug.yml). The form asks for `lensy --version`, `node -v`, your operating system, the command and its output (add `LENSY_DEBUG=1` if it failed with an error).
- **No GitHub account?** Email hello@perseveranceai.com with the same details.
- **Security problems:** email hello@perseveranceai.com, not a public issue.

Don't paste anything private: no tokens, internal hostnames or unpublished content.

## License

MIT. Questions or problems: hello@perseveranceai.com
