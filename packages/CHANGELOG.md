# Changelog

## 0.2.1 (2026-11-12)

Same scoring engine as perseveranceai.com again: the fixes the website got on 2026-11-12 (from PR #61).

- **Canonical links and meta robots written without quotes** (`<link rel=canonical href=...>`, as minified HTML such as Docusaurus writes them) are found. Before, the canonical link was missed and AI search lost 7 points (S3).
- **More sitemaps found:** when robots.txt names no sitemap, Lensy also tries the page's `<link rel="sitemap">`, `/sitemap-index.xml` (Astro) and sitemaps under the page's first folder, such as `/docs/sitemap.xml`. Before, pages on those sites read "not in sitemap" (-8 on S3).
- **Fixes that fit the page:** S2 (and C1) no longer tell a short static page to switch to server-side rendering; it gets advice to add content, with its word count. S3 and S4 fixes name only what is missing.
- The README links to the guide's new address, https://perseveranceai.com/docs/cli, and every check now has a page at https://perseveranceai.com/docs/checks.

## 0.2.0 (2026-11-08)

Check a docs build before you publish it: `lensy check --dir <build folder> --site-url <your docs address> --all`.

- **Check a local build:**
  - `lensy check --dir <build folder>` serves the folder on 127.0.0.1 for the run; `--site-url <published address>` matches the build's sitemap, llms.txt and canonical links to it; `--all` checks every page.
  - A localhost URL (your tool's preview server) is checked too, with `--all` reading its sitemap.
  - Checks that your web server or CDN decides are left out and named, and scores read "58 of 70 points checked".
  - Requests to any other host are refused, so a local check sends nothing off the machine.
- **Works the same on every tool tested:** `--dir --all` uses the build's own sitemap (including Astro's `sitemap-index.xml`), so pages keep the addresses the docs tool publishes, and falls back to the page files. A trailing-slash path also finds `<path>.html`. `--json` pages say their `mode`, and for local builds `scoresOutOf`; the Markdown front matter has `codingAgentsOutOf` and `aiSearchOutOf`.
- **Requirements, tested environments and how to report a problem** are in the README and on /cli; GitHub has a CLI issue form.
- **Clearer output:**
  - A folder given as a URL now suggests `--dir`.
  - "about 1 minute" instead of "about 1 to 1 minutes"; `--help` shows each default once.
  - `--json` fixes carry the check `id`.
  - The Markdown and HTML reports leave 0-point items out of the fix list, use one-page wording, and never mention other tools' options.
  - `lensy explain` marks C1-C6 as the fallback for when AFDocs can't run, says how local builds treat host-dependent checks, and no longer mentions checking source files.
  - When `.lensy/` exists but a run doesn't save, Lensy says so.

## 0.1.0 (2026-11-08)

First early-access release, published under the npm `next` tag.

- **Save and compare runs:**
  - The first `lensy check` in a terminal asks once whether to save results.
  - Each run is saved in `.lensy/` at the project root (run records, `latest.md`, `history.md`).
  - Each page is compared with its last saved run: score changes, Fixed, New, and Worse/Better in `--verbose`.
  - `--save`, `--save-dir <dir>` and `--no-save` control one run.
  - `.lensy/config.json` can list `pages`, so `lensy check` needs no URLs; `keep` sets how many runs are kept (52).
  - In CI and with `--json -`, it never asks.
- `--json` pages gain `change` (null without a previous run) and `pointsLost`.
- The Markdown and HTML reports show each fix's points on the 0-100 scale, the same as the terminal and `--json`, plus a "Since last run" section when saving.
- `lensy check` shows a short view by default:
  - both scores, then "Fix these first", ordered by points lost, with one line on what to do;
  - the points shown add up to each score, so AFDocs' raw points (about 112) are scaled to 100;
  - passed checks become a count, and 0-point findings are listed as not scored;
  - AFDocs wording is tidied for one page ("The page" instead of "All 1 pages"), and fixes never mention AFDocs-only options.
- `--verbose` shows every check with its id, points and full fix (the previous default), and says how the points scale.
- `--json <file>` writes scores, fixes ordered by points lost, and the full report for scripts and CI. `--json -` prints only the JSON.
- Workspace scaffold for `@perseverance-ai/lensy-core` and `@perseverance-ai/lensy`.
