// SPDX-License-Identifier: MIT
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // commander is CommonJS and require()s Node built-ins, which an ESM bundle doesn't have.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __lensyCreateRequire } from 'node:module';\nconst require = __lensyCreateRequire(import.meta.url);" },
  define: { __LENSY_CLI_VERSION__: JSON.stringify(pkg.version) },
  // Written for package-files.mjs, which lists the bundled packages' licences.
  metafile: true,
  logLevel: 'warning',
}).then(async (result) => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('dist/meta.json', JSON.stringify(result.metafile));
});
