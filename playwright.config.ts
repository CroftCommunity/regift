import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// croft-pwa chassis: the hermetic gate drives the BUILT bundle over a zero-dep
// static server, on Chromium, plus a second server under a subpath to prove the
// relative-path standard (tests/e2e/subpath.spec.ts).
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;

const PORT = 4183;
const SUBPATH_PORT = 4184;
const SUBPATH_BASE = '/pr-preview/pr-1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // The service worker makes its own fetches that bypass page.route mocks, so
    // block it for the hermetic specs.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /subpath\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'subpath',
      testMatch: /subpath\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${SUBPATH_PORT}${SUBPATH_BASE}/`,
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: `node tools/serve.mjs dist ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `BASE=${SUBPATH_BASE} node tools/serve.mjs dist ${SUBPATH_PORT}`,
      url: `http://localhost:${SUBPATH_PORT}${SUBPATH_BASE}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
