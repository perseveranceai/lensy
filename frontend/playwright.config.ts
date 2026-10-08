import { defineConfig } from '@playwright/test';

// End-to-end tests for the cases in docs/test-cases.md.
//
// Where they run:
//   - Locally, against a PRODUCTION build served from ./build:
//       npm run test:e2e:local      (builds with build:gamma, then serves + tests)
//   - Post-deploy, against gamma, as the gate before prod (deploy.yml):
//       E2E_BASE_URL=https://gamma.perseveranceai.com npm run test:e2e
//
// Never point this at `npm start`: the dev server doesn't minify CSS, and the
// light-theme bug (REG-01) only existed in minified production CSS.
//
// The build calls the gamma API, so local runs perform real gamma scans.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const useLocalBuild = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  // Scans and citation checks hit a real backend; give them room.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // One retry absorbs a transient network blip; a real regression fails twice.
  retries: 1,
  // Scans share one IP's quota and one backend; run them one at a time.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    // Use the installed Chrome (present on GitHub's ubuntu runners and dev
    // machines) instead of downloading Playwright's bundled browser.
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: useLocalBuild
    ? {
        command: 'npx serve -s build -l 3000',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 30_000,
      }
    : undefined,
});
