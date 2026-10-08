#!/usr/bin/env node
/**
 * REG-01 guard: fail if the production CSS minifier merged a Tailwind opacity
 * class into its plain sibling.
 *
 * Tailwind emits opacity modifiers on arbitrary colours (bg-[var(--bg)]/15)
 * with a nested @supports block. CRA's CSS minifier doesn't understand nested
 * CSS and merges such a rule with the plain class next to it, so the plain
 * class (bg-[var(--bg)]) silently picks up the opacity. In October 2026 that
 * painted every light-theme page dark grey on gamma and prod while dev builds
 * looked fine.
 *
 * Run after a production build:  npm run check:css [-- <build dir>]
 * The build dir defaults to ./build; deploy.yml also checks ./build-prod.
 */
const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', process.argv[2] || 'build', 'static', 'css');
if (!fs.existsSync(cssDir)) {
  console.error(`verify-built-css: ${cssDir} not found — run a production build first.`);
  process.exit(2);
}

const problems = [];
for (const file of fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
  const css = fs.readFileSync(path.join(cssDir, file), 'utf8');
  // A rule whose body contains a nested @supports block.
  const ruleRe = /([^{}]+)\{([^{}]*@supports[^{}]*\{[^{}]*\})/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim());
    const withOpacity = selectors.filter((s) => /\\\/\d+/.test(s));
    const plain = selectors.filter((s) => !/\\\/\d+/.test(s));
    if (withOpacity.length && plain.length) problems.push(`${file}: ${selectors.join(', ')}`);
  }
}

if (problems.length) {
  console.error('verify-built-css: the minifier merged opacity-modifier rules into plain classes:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('Fix: replace the opacity modifier (e.g. bg-[var(--bg)]/15) with an explicit');
  console.error('     colour, e.g. bg-[color-mix(in_srgb,var(--bg)_15%,transparent)]. See REG-01 in docs/test-cases.md.');
  process.exit(1);
}
console.log('verify-built-css: OK — no merged opacity rules.');
