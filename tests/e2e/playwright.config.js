/**
 * Configuration Playwright pour les tests E2E de la popup.
 *
 * Usage (après npm i -D @playwright/test && npx playwright install chromium) :
 *   npx playwright test tests/e2e/popup.spec.js --config tests/e2e/playwright.config.js
 *
 * Les modules ES (<script type="module">) sont bloqués par la politique CORS de
 * Chromium sur file://. On sert donc la popup via un serveur HTTP local.
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

export default defineConfig({
  testDir: '.',
  timeout: 15_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  webServer: {
    // Serveur statique minimal — sert le répertoire racine du projet.
    command: `node ${resolve(__dirname, 'static-server.js')}`,
    port: 7331,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    headless: true,
    baseURL: 'http://localhost:7331',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
