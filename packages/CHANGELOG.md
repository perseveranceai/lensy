# Changelog

## Unreleased

- **Check a local build:**
  - `lensy check --dir <build folder>` serves the folder on 127.0.0.1 for the run; `--site-url <published address>` matches the build's sitemap, llms.txt and canonical links to it; `--all` checks every page.
  - A localhost URL (your tool's preview server) is checked too, with `--all` reading its sitemap.
  - Checks that your web server or CDN decides are left out and named, and scores read "58 of 70 points checked".
  - Requests to any other host are refused, so a local check sends nothing off the machine.
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
