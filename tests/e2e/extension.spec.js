/**
 * Tests E2E qui chargent l'extension MV3 dans un vrai Chromium.
 *
 * Diff avec popup.spec.js : ici on tourne sous l'origine `chrome-extension://<id>/`
 * avec le manifest, le service worker et le CSP réels. Cela attrape les bugs que
 * le static-server + chrome.* mocké ne voient pas : violations CSP, erreurs SW,
 * permissions manquantes, type=module bloqué, etc.
 *
 * Note : les extensions MV3 ne tournent pas en headless classique. On passe par
 * `launchPersistentContext` avec `--headless=new` (Chrome 109+).
 */

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXT_PATH = resolve(__dirname, '../..');

test.describe.configure({ mode: 'serial' });

test('extension popup s\'ouvre sans violation CSP ni erreur console critique', async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox'
    ]
  });

  try {
    // MV3 : le service worker doit être démarré pour que l'extensionId soit dispo.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 8000 });
    const extensionId = sw.url().split('/')[2];

    const page = await context.newPage();
    const cspErrors = [];
    const consoleErrors = [];
    page.on('console', msg => {
      const txt = msg.text();
      if (/Content Security Policy/i.test(txt)) cspErrors.push(txt);
      else if (msg.type() === 'error') consoleErrors.push(txt);
    });

    await page.goto(`chrome-extension://${extensionId}/popup/popup.html?fullpage=1`);
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    // Laisse les handlers async (DOMContentLoaded, init storage) émettre leurs erreurs.
    await page.waitForTimeout(800);

    // Tabs présents = init du popup.js a tourné jusqu'au bout.
    const tabs = await page.locator('.tab-trigger, [role="tab"], .tabbar button').count();
    expect(tabs, 'aucun tab rendu — popup.js a probablement crash').toBeGreaterThan(0);

    expect(cspErrors, `violations CSP détectées:\n${cspErrors.join('\n')}`).toEqual([]);
    // On tolère erreurs réseau attendues (chrome.* sans tab LBC) mais pas les TypeError JS.
    const fatal = consoleErrors.filter(e => /TypeError|ReferenceError|SyntaxError/.test(e));
    expect(fatal, `erreurs JS fatales:\n${fatal.join('\n')}`).toEqual([]);
  } finally {
    await context.close();
  }
});
