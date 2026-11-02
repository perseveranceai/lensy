// SPDX-License-Identifier: MIT
// Puts LICENSE and THIRD_PARTY_LICENSES into a package folder after its build.
// THIRD_PARTY_LICENSES lists every npm package bundled into dist/ (from
// esbuild's dist/meta.json when present), with its licence text.
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pkgDir = resolve(process.argv[2] || '.');
const root = resolve(pkgDir, '..');
copyFileSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'));

const bundled = new Set();
const metaPath = join(pkgDir, 'dist', 'meta.json');
if (existsSync(metaPath)) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  for (const input of Object.keys(meta.inputs)) {
    const m = input.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) bundled.add(m[1]);
  }
  // Build metadata, not part of the package.
  rmSync(metaPath);
}

const findNodeModule = (name) => {
  for (let dir = pkgDir; ; dir = resolve(dir, '..')) {
    const p = join(dir, 'node_modules', name);
    if (existsSync(p)) return p;
    if (dir === resolve(dir, '..')) return null;
  }
};

const sections = [...bundled].sort().map((name) => {
  const dir = findNodeModule(name);
  if (!dir) throw new Error(`package-files: ${name} is bundled but not installed`);
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  if (!file) throw new Error(`package-files: no licence file in ${name}`);
  return `${name}@${pj.version} (${pj.license})\n\n${readFileSync(join(dir, file), 'utf8').trim()}\n`;
});

writeFileSync(
  join(pkgDir, 'THIRD_PARTY_LICENSES'),
  sections.length
    ? `This package bundles the following third-party code.\n\n${sections.join('\n---\n\n')}`
    : 'This package bundles no third-party code.\n',
);
console.log(`package-files: ${pkgDir.split(/[\\/]/).pop()}: LICENSE, THIRD_PARTY_LICENSES (${bundled.size} bundled)`);
