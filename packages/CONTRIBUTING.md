# Contributing

`packages/` is a self-contained npm workspace inside the `perseveranceai/lensy` repo.

```
cd packages
npm ci
npm run build
npm test
```

Needs Node 22 or later.

## Rules

- **Scoring lives in the engine,** not here. The CLI runs the website's engine files in place (`backend/lambda/agent-handler/`), so a page gets the same points on perseveranceai.com and in the CLI. Don't add, drop or reweight checks in `packages/`.
- **Tests never touch the network.** They replay saved fixtures through an injected `fetchImpl`.
- **Runtime dependencies:** none in `core`; `commander` and `picocolors` in `cli`. A new one needs a reason in the PR.
- **Each source file starts with** `// SPDX-License-Identifier: MIT`.
- **No secrets,** internal hostnames, account ids or customer names. gitleaks runs on every PR.
