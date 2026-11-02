// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // CLI tests run against core's source, so they don't need a core build first.
    alias: { '@perseverance-ai/lensy-core': fileURLToPath(new URL('./core/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['core/test/**/*.test.ts', 'cli/test/**/*.test.ts'],
    // Tests never touch the network; they replay saved fixtures (lensy-cli.md).
    passWithNoTests: true,
  },
});
