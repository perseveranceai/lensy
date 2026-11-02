// SPDX-License-Identifier: MIT
// npm run docs:checks: rewrites docs/checks.md from the engine's check registry.
// The generator lives in cli/src/explain.ts (TypeScript), so this runs it through
// the same Vitest test that checks the file is up to date.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', 'cli/test/docs.test.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, LENSY_UPDATE_DOCS: '1' },
});
process.exit(r.status ?? 1);
