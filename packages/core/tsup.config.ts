// SPDX-License-Identifier: MIT
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// The engine commit goes into every report, so a result can be traced to the code that scored it.
const commit = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
})();

// AFDocs reads its own package.json from disk at load time (dist/http.js) to
// build its user agent. Bundled, that path would point at our package instead,
// so the read is replaced with the version, inlined at build time. The user
// agent itself is never sent: Lensy routes AFDocs' requests through its own
// fetch (afdocs-page.ts). The build fails if the line changes on an upgrade.
const require = createRequire(import.meta.url);
// afdocs' "exports" hides package.json, so walk up from its main entry.
const afdocsVersion = (() => {
  let dir = dirname(require.resolve('afdocs'));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const p = JSON.parse(readFileSync(file, 'utf8'));
      if (p.name === 'afdocs') return p.version as string;
    }
    const up = dirname(dir);
    if (up === dir) throw new Error('afdocs package.json not found');
    dir = up;
  }
})();
const PKG_READ = "const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));";
const inlineAfdocsVersion: Plugin = {
  name: 'inline-afdocs-version',
  setup(build) {
    build.onLoad({ filter: /[\\/]afdocs[\\/]dist[\\/]http\.js$/ }, args => {
      const src = readFileSync(args.path, 'utf8');
      if (!src.includes(PKG_READ)) throw new Error('afdocs dist/http.js changed: update inline-afdocs-version in packages/core/tsup.config.ts');
      return { contents: src.replace(PKG_READ, `const pkg = { version: ${JSON.stringify(afdocsVersion)} };`), loader: 'js' };
    });
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  clean: true,
  // afdocs is a devDependency, so tsup bundles it: users install nothing extra.
  esbuildPlugins: [inlineAfdocsVersion],
  // Lists the bundled packages for THIRD_PARTY_LICENSES (scripts/package-files.mjs).
  metafile: true,
  define: {
    __LENSY_CORE_VERSION__: JSON.stringify(pkg.version),
    __ENGINE_COMMIT__: JSON.stringify(commit),
  },
});
