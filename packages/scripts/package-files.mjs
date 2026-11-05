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
// esbuild writes dist/meta.json (cli); tsup writes dist/metafile-esm.json (core).
const metaPath = [join(pkgDir, 'dist', 'meta.json'), join(pkgDir, 'dist', 'metafile-esm.json')].find(existsSync);
if (metaPath) {
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

// Packages published without a licence file. Their licence text is the
// standard SPDX text with the author from package.json. Anything else missing
// a file still fails the build, so it gets checked by hand.
const ISC = (holder) => `ISC License\n\nCopyright (c) ${holder}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;
const NO_LICENCE_FILE = { boolbase: { license: 'ISC', text: ISC } };

const sections = [...bundled].sort().map((name) => {
  const dir = findNodeModule(name);
  if (!dir) throw new Error(`package-files: ${name} is bundled but not installed`);
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)([.-]|$)/i.test(f));
  if (file) return `${name}@${pj.version} (${pj.license})\n\n${readFileSync(join(dir, file), 'utf8').trim()}\n`;
  const known = NO_LICENCE_FILE[name];
  if (!known || known.license !== pj.license) throw new Error(`package-files: no licence file in ${name}`);
  const author = typeof pj.author === 'string' ? pj.author : pj.author?.name;
  if (!author) throw new Error(`package-files: no author for ${name}`);
  return `${name}@${pj.version} (${pj.license}, no licence file in the package; standard text)\n\n${known.text(author)}\n`;
});

writeFileSync(
  join(pkgDir, 'THIRD_PARTY_LICENSES'),
  sections.length
    ? `This package bundles the following third-party code.\n\n${sections.join('\n---\n\n')}`
    : 'This package bundles no third-party code.\n',
);
console.log(`package-files: ${pkgDir.split(/[\\/]/).pop()}: LICENSE, THIRD_PARTY_LICENSES (${bundled.size} bundled)`);
