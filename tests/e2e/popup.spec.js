/**
 * Tests E2E Playwright pour la popup "Booster Leboncoin".
 *
 * PRÉREQUIS : Playwright Node.js (@playwright/test) doit être installé.
 * Si ce n'est pas encore fait :
 *
 *   npm init -y
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *
 * Ensuite lancer avec :
 *   npx playwright test tests/e2e/popup.spec.js
 *
 * NOTE : la popup est testée en mode "standalone" (file:// URL), sans
 * charger l'extension en tant qu'extension Chrome (ce qui nécessiterait
 * --load-extension et un profil dédié). Les mocks chrome.* sont injectés
 * via addInitScript avant le chargement des modules ES.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const POPUP_URL = `file://${resolve(__dirname, '../../popup/popup.html')}?fullpage=1`;

// Mock chrome.* injecté avant que les modules ES chargent.
// Les handlers sendMessage renvoient des fixtures vides mais valides.
const CHROME_MOCK_SCRIPT = `
  window.chrome = {
    storage: {
      local: {
        _data: {
          settings: { enabled: false, dryRun: true, dayOfWeek: 1, hour: 9, minute: 0, jitterMinutes: 60, onlyAdIds: [] },
          myListings: { fetchedAt: Date.now(), listings: [
            { id: 'ad-1', title: 'Annonce test 1', status: 'En ligne', catSlug: 'services' },
            { id: 'ad-2', title: 'Annonce test 2', status: 'En ligne', catSlug: 'services' },
          ]},
          inboxCache: { all: [
            { conversationId: 'c1', partnerName: 'Alice', subject: 'Question annonce', lastMessagePreview: 'Bonjour est-ce dispo ?', lastMessageDate: new Date().toISOString(), unseenCounter: 1, _classification: { category: 'question', signals: [], confidence: 0.8 } },
            { conversationId: 'c2', partnerName: 'Scammer', subject: 'Besoin urgent', lastMessagePreview: 'Envoyez mandat cash Western Union', lastMessageDate: new Date().toISOString(), unseenCounter: 0, _classification: { category: 'scam', signals: ['mandat-cash'], confidence: 0.95 } },
          ]},
          inboxDismissed: [],
          inboxLastRun: { at: new Date().toISOString() },
          prospectProfiles: [{ id: 'p1', name: 'Dev Web', keywords: ['wordpress', 'react'], minScore: 5, maxAgeDays: 30, adType: 'demand', priceMin: null, priceMax: null, departments: [], sortOrder: 'score', ownerType: 'all', shippableOnly: false, replyTemplate: 'Bonjour,\\n\\nJe suis intéressé.' }],
          activeProfileId: 'p1',
          prospectGlobalSettings: { enabled: false, frequency: 'week', dayOfWeek: 1, hour: 10, notifyOnNew: true, notifyMinScore: 7 },
          prospectResultsByProfile: { 'p1': [
            { list_id: 'r1', subject: 'Cherche dev wordpress', body: 'Projet urgent.', owner_name: 'Client A', owner_id: 'o1', url: 'https://www.leboncoin.fr/ad/services/r1', score: 8, kw_hit: 'wordpress', location: 'Paris', age_days: 3, price: null },
          ]},
          prospectLastRunByProfile: { 'p1': { ts: new Date().toISOString(), scanned: 2 } },
          prospectSeenIdsByProfile: { 'p1': [] },
          prospectIgnoredIdsByProfile: { 'p1': [] },
          prospectContactedLocal: [],
          log: [],
          bumpHistory: [],
        },
        get(keys) {
          if (typeof keys === 'string') return Promise.resolve({ [keys]: this._data[keys] });
          if (Array.isArray(keys)) return Promise.resolve(Object.fromEntries(keys.map(k => [k, this._data[k]])));
          return Promise.resolve({ ...this._data });
        },
        set(updates) {
          Object.assign(this._data, updates);
          return Promise.resolve();
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    },
    runtime: {
      sendMessage: (msg) => Promise.resolve({ ok: true, result: { loggedIn: true, pseudo: 'testuser' } }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
      getURL: (path) => 'chrome-extension://test/' + path,
    },
    tabs: { create: (opts) => Promise.resolve({ id: 1, ...opts }) },
    scripting: { executeScript: () => Promise.resolve([{ result: null }]) },
    alarms: {
      create: () => {}, clear: () => {}, get: () => Promise.resolve(null),
      onAlarm: { addListener: () => {} },
    },
    notifications: { create: () => {} },
  };
`;

test.describe('Popup standalone — smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    // Injecter le mock avant le chargement des modules
    await page.addInitScript(CHROME_MOCK_SCRIPT);
    await page.goto(POPUP_URL, { waitUntil: 'networkidle' });
  });

  test('la page se charge sans erreur console critique', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // Naviguer à nouveau pour capturer les erreurs post-init
    await page.reload({ waitUntil: 'networkidle' });
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_FILE_NOT_FOUND')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('les 3 tabs sont présents et cliquables', async ({ page }) => {
    const tabs = page.locator('.tab');
    await expect(tabs).toHaveCount(3);
    // Tab "Messages"
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveClass(/active/);
    // Tab "Prospects"
    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveClass(/active/);
    // Retour "Republier"
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveClass(/active/);
  });

  test('panel Bumper : section "Mes annonces" visible', async ({ page }) => {
    await expect(page.locator('#panel-bumper')).toBeVisible();
    await expect(page.locator('#b-refresh-listings')).toBeVisible();
  });

  test('panel Messages : bouton Rafraîchir visible après clic sur tab', async ({ page }) => {
    await page.locator('.tab').nth(1).click();
    await expect(page.locator('#m-refresh')).toBeVisible();
  });

  test('panel Prospects : bouton Scanner visible après clic sur tab', async ({ page }) => {
    await page.locator('.tab').nth(2).click();
    await expect(page.locator('#p-scan')).toBeVisible();
  });

  test('panel Bumper : clic "Tout sélectionner" ne lève pas d\'exception JS', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    // Attendre que les annonces soient chargées
    await page.waitForTimeout(500);
    await page.locator('#b-select-all').click();
    await page.waitForTimeout(300);
    expect(jsErrors).toEqual([]);
  });

  test('panel Messages : les stats scam/lead sont affichées', async ({ page }) => {
    await page.locator('.tab').nth(1).click();
    // Les compteurs doivent être peuplés (non "–")
    const scamStat = page.locator('#m-stat-scam');
    await expect(scamStat).not.toHaveText('–');
  });

  test('panel Prospects : les mots-clés du profil sont affichés dans le textarea', async ({ page }) => {
    await page.locator('.tab').nth(2).click();
    const kw = page.locator('#p-keywords');
    await expect(kw).not.toBeEmpty();
  });
});
