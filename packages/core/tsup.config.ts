// SPDX-License-Identifier: MIT
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// The engine commit goes into every report, so a result can be traced to the code that scored it.
const commit = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
})();

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  clean: true,
  define: {
    __LENSY_CORE_VERSION__: JSON.stringify(pkg.version),
    __ENGINE_COMMIT__: JSON.stringify(commit),
  },
});
