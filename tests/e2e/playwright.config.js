/**
 * Configuration Playwright pour les tests E2E de la popup.
 *
 * Usage (après npm i -D @playwright/test && npx playwright install chromium) :
 *   npx playwright test tests/e2e/popup.spec.js
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 15_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    // Pas de baseURL — les specs utilisent des file:// URLs directement.
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
