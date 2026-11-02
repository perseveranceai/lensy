// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts', 'cli/test/**/*.test.ts'],
    // Tests never touch the network; they replay saved fixtures (lensy-cli.md).
    passWithNoTests: true,
  },
});
