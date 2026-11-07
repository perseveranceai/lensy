# Changelog

## Unreleased

- `lensy check` shows a short view by default:
  - both scores, then "Fix these first", ordered by points lost, with one line on what to do;
  - the points shown add up to each score, so AFDocs' raw points (about 112) are scaled to 100;
  - passed checks become a count, and 0-point findings are listed as not scored;
  - AFDocs wording is tidied for one page ("The page" instead of "All 1 pages"), and fixes never mention AFDocs-only options.
- `--verbose` shows every check with its id, points and full fix (the previous default), and says how the points scale.
- `--json <file>` writes scores, fixes ordered by points lost, and the full report for scripts and CI. `--json -` prints only the JSON.
- Workspace scaffold for `@perseverance-ai/lensy-core` and `@perseverance-ai/lensy`.
