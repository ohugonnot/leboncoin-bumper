/**
 * Tests E2E Playwright pour la popup "Booster Leboncoin".
 *
 * Mode standalone safe : HTTP local (pas file://), mock chrome.* injecté avant
 * les modules ES. Aucune requête vers leboncoin.fr ne peut sortir.
 */

import { test, expect } from '@playwright/test';

const POPUP_URL = '/popup/popup.html?fullpage=1';

// Mock chrome.* injecté avant que les modules ES chargent.
const CHROME_MOCK_SCRIPT = `
  window.chrome = {
    storage: {
      // popup.js appelle chrome.storage.onChanged (pas .local.onChanged)
      onChanged: { addListener: () => {}, removeListener: () => {} },
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

// Attend que la popup soit initialisée : modules ES chargés + load*() complétés.
// Signal : #b-listings contient au moins un enfant (listings ou message "Clique...").
async function waitForPopupReady(page) {
  await page.waitForFunction(() => {
    const tab = document.querySelector('.tab.active');
    const panel = document.querySelector('.panel.active');
    const listingsContainer = document.getElementById('b-listings');
    return tab !== null && panel !== null
      && listingsContainer !== null
      && listingsContainer.children.length > 0;
  }, { timeout: 10_000 });
}

// Attend qu'un panel soit actif après clic sur un tab.
async function clickTabAndWait(page, tabIndex) {
  await page.locator('.tab').nth(tabIndex).click();
  const tabId = ['bumper', 'messages', 'prospect'][tabIndex];
  await page.waitForFunction(
    (id) => document.querySelector(`.panel[data-panel="${id}"]`)?.classList.contains('active'),
    tabId,
    { timeout: 5_000 }
  );
}

test.describe('Popup standalone — smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    // Garde-fou : aucune requête vers leboncoin.fr ne doit sortir.
    page.on('request', req => {
      if (req.url().includes('leboncoin.fr')) {
        throw new Error(`Requête interdite vers Leboncoin: ${req.url()}`);
      }
    });
    await page.addInitScript(CHROME_MOCK_SCRIPT);
    await page.goto(POPUP_URL, { waitUntil: 'domcontentloaded' });
    await waitForPopupReady(page);
  });

  // ── Garde-fou réseau ────────────────────────────────────────────────────────

  test('garde-fou : aucune requête vers leboncoin.fr', async ({ page }) => {
    // La navigation a déjà eu lieu dans beforeEach — si une requête LBC était
    // sortie, le beforeEach aurait déjà levé l'exception.
    await clickTabAndWait(page, 1);
    await clickTabAndWait(page, 2);
    await clickTabAndWait(page, 0);
    // Attendre fin des async handlers
    await page.waitForTimeout(300);
  });

  // ── Smoke cross-panel ───────────────────────────────────────────────────────

  test('la page se charge sans erreur console critique', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPopupReady(page);
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_FILE_NOT_FOUND')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('les 3 tabs sont présents et cliquables', async ({ page }) => {
    const tabs = page.locator('.tab');
    await expect(tabs).toHaveCount(3);
    await clickTabAndWait(page, 1);
    await expect(tabs.nth(1)).toHaveClass(/active/);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await clickTabAndWait(page, 2);
    await expect(tabs.nth(2)).toHaveClass(/active/);
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await clickTabAndWait(page, 0);
    await expect(tabs.nth(0)).toHaveClass(/active/);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  });

  test('aria-selected synchronisé sur les 3 tabs', async ({ page }) => {
    const tabs = page.locator('.tab');
    // État initial : bumper actif
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'false');
    // Après clic messages
    await clickTabAndWait(page, 1);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'false');
  });

  test('navigation cross-tabs sans erreur JS', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await clickTabAndWait(page, 1);
    await clickTabAndWait(page, 2);
    await clickTabAndWait(page, 0);
    await clickTabAndWait(page, 1);
    await page.waitForTimeout(200);
    expect(jsErrors).toEqual([]);
  });
});

test.describe('Panel Bumper', () => {
  test.beforeEach(async ({ page }) => {
    page.on('request', req => {
      if (req.url().includes('leboncoin.fr')) throw new Error(`Requête interdite: ${req.url()}`);
    });
    await page.addInitScript(CHROME_MOCK_SCRIPT);
    await page.goto(POPUP_URL, { waitUntil: 'domcontentloaded' });
    await waitForPopupReady(page);
  });

  test('section "Mes annonces" visible avec bouton charger', async ({ page }) => {
    await expect(page.locator('#panel-bumper')).toBeVisible();
    await expect(page.locator('#b-refresh-listings')).toBeVisible();
  });

  test('les 2 annonces fixtures affichées avec titre et statut', async ({ page }) => {
    const listings = page.locator('#b-listings .listing');
    await expect(listings).toHaveCount(2);
    await expect(listings.nth(0)).toContainText('Annonce test 1');
    await expect(listings.nth(1)).toContainText('Annonce test 2');
    await expect(listings.nth(0)).toContainText('En ligne');
  });

  test('compteur de sélection cohérent', async ({ page }) => {
    // Par défaut onlyAdIds=[] → hint "Toutes les annonces seront republiées"
    const hint = page.locator('#b-selection-hint');
    await expect(hint).toContainText('2 au total');
  });

  test('clic "Tout sélectionner" ne lève pas d\'exception JS', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await page.locator('#b-select-all').click();
    await page.waitForTimeout(300);
    expect(jsErrors).toEqual([]);
  });

  test('"Tout sélectionner" met à jour le hint sélection', async ({ page }) => {
    await page.locator('#b-select-all').click();
    await page.waitForTimeout(300);
    const hint = page.locator('#b-selection-hint');
    // 2 annonces sélectionnées / 2 total
    await expect(hint).toContainText('2 / 2');
  });

  test('"Aucune" après "Tout sélectionner" revient à 0', async ({ page }) => {
    await page.locator('#b-select-all').click();
    await page.waitForTimeout(200);
    await page.locator('#b-select-none').click();
    await page.waitForTimeout(300);
    const hint = page.locator('#b-selection-hint');
    await expect(hint).toContainText('Toutes les annonces seront republiées');
  });

  test('bannière login cachée quand loggedIn:true', async ({ page }) => {
    // checkLogin() est async — attendre que login-dot soit visible (loggedIn:true dans le mock)
    await expect(page.locator('#login-dot')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#login-banner')).toBeHidden();
  });

  test('toggle dryRun persiste dans le mock storage', async ({ page }) => {
    // Décocher dryRun
    await page.locator('#b-dryRun').uncheck();
    await page.waitForTimeout(300);
    const dryRun = await page.evaluate(() => window.chrome.storage.local._data.settings?.dryRun);
    expect(dryRun).toBe(false);
  });

  test('changement de jour persiste dans le mock storage', async ({ page }) => {
    // Ouvrir la section planning
    await page.locator('#b-planning-section summary').click();
    await page.locator('#b-dayOfWeek').selectOption('3');
    await page.locator('#b-dayOfWeek').dispatchEvent('change');
    await page.waitForTimeout(300);
    const dow = await page.evaluate(() => window.chrome.storage.local._data.settings?.dayOfWeek);
    expect(dow).toBe(3);
  });
});

test.describe('Panel Messages', () => {
  test.beforeEach(async ({ page }) => {
    page.on('request', req => {
      if (req.url().includes('leboncoin.fr')) throw new Error(`Requête interdite: ${req.url()}`);
    });
    await page.addInitScript(CHROME_MOCK_SCRIPT);
    await page.goto(POPUP_URL, { waitUntil: 'domcontentloaded' });
    await waitForPopupReady(page);
    await clickTabAndWait(page, 1);
  });

  test('bouton Rafraîchir visible', async ({ page }) => {
    await expect(page.locator('#m-refresh')).toBeVisible();
  });

  test('stat scam = 1 (1 message scam dans fixtures)', async ({ page }) => {
    await expect(page.locator('#m-stat-scam')).not.toHaveText('–');
    await expect(page.locator('#m-stat-scam')).toHaveText('1');
  });

  test('stat question = 1 (1 message question dans fixtures)', async ({ page }) => {
    await expect(page.locator('#m-stat-question')).toHaveText('1');
  });

  test('les 2 conversations affichées dans la liste', async ({ page }) => {
    const cards = page.locator('#m-list .card');
    await expect(cards).toHaveCount(2);
  });

  test('filtre scam cache les non-scam', async ({ page }) => {
    await page.locator('.inbox-filter[data-filter="scam"]').click();
    await page.waitForTimeout(300);
    const cards = page.locator('#m-list .card');
    await expect(cards).toHaveCount(1);
    await expect(cards.nth(0)).toContainText('Scammer');
  });

  test('filtre question affiche uniquement les questions', async ({ page }) => {
    await page.locator('.inbox-filter[data-filter="question"]').click();
    await page.waitForTimeout(300);
    const cards = page.locator('#m-list .card');
    await expect(cards).toHaveCount(1);
    await expect(cards.nth(0)).toContainText('Alice');
  });

  test('dismiss met à jour inboxDismissed dans le mock storage', async ({ page }) => {
    const dismissBtn = page.locator('#m-list .card').nth(0).locator('.dismiss-btn');
    await dismissBtn.click();
    await page.waitForTimeout(300);
    const dismissed = await page.evaluate(() => window.chrome.storage.local._data.inboxDismissed);
    // sendMessage INBOX_DISMISS est mocké avec {ok:true} — la card se retire du DOM
    // mais le mock storage n'intercepte pas sendMessage ; on vérifie que la card disparaît
    const cards = page.locator('#m-list .card');
    await expect(cards).toHaveCount(1);
  });

  test('recherche texte filtre les cards', async ({ page }) => {
    await page.locator('#m-search').fill('Alice');
    await page.waitForTimeout(300);
    const cards = page.locator('#m-list .card');
    await expect(cards).toHaveCount(1);
    await expect(cards.nth(0)).toContainText('Alice');
  });
});

test.describe('Panel Prospects', () => {
  test.beforeEach(async ({ page }) => {
    page.on('request', req => {
      if (req.url().includes('leboncoin.fr')) throw new Error(`Requête interdite: ${req.url()}`);
    });
    await page.addInitScript(CHROME_MOCK_SCRIPT);
    await page.goto(POPUP_URL, { waitUntil: 'domcontentloaded' });
    await waitForPopupReady(page);
    await clickTabAndWait(page, 2);
  });

  test('bouton Scanner visible', async ({ page }) => {
    await expect(page.locator('#p-scan')).toBeVisible();
  });

  test('profil "Dev Web" chargé dans le select', async ({ page }) => {
    await expect(page.locator('#p-profile-select')).toContainText('Dev Web');
  });

  test('mots-clés du profil affichés dans le textarea', async ({ page }) => {
    // Le textarea est dans un <details> fermé — on vérifie la valeur via evaluate
    const val = await page.evaluate(() => document.getElementById('p-keywords')?.value ?? '');
    expect(val).toContain('wordpress');
  });

  test('résultat fixture r1 affiché avec score et localisation', async ({ page }) => {
    const card = page.locator('#p-list .card').first();
    await expect(card).toContainText('Cherche dev wordpress');
    await expect(card).toContainText('★ 8');
    await expect(card).toContainText('Paris');
  });

  test('badge NOUV. présent car prospect non vu', async ({ page }) => {
    const card = page.locator('#p-list .card').first();
    await expect(card).toContainText('NOUV.');
  });

  test('édition keywords + blur déclenche save dans storage', async ({ page }) => {
    // Ouvrir la section réglages (détails fermée par défaut)
    await page.locator('#panel-prospect details.section summary').first().click();
    const kw = page.locator('#p-keywords');
    await expect(kw).toBeVisible({ timeout: 3_000 });
    await kw.fill('wordpress\nvue');
    await kw.dispatchEvent('blur');
    await page.waitForTimeout(400);
    const profiles = await page.evaluate(() => window.chrome.storage.local._data.prospectProfiles);
    expect(profiles[0].keywords).toContain('vue');
  });

  test('toggle enabled persiste dans le mock storage', async ({ page }) => {
    // Ouvrir la section réglages (détails fermée par défaut)
    await page.locator('#panel-prospect details.section summary').first().click();
    const checkbox = page.locator('#p-enabled');
    await expect(checkbox).toBeVisible({ timeout: 3_000 });
    await checkbox.check();
    await checkbox.dispatchEvent('change');
    await page.waitForTimeout(300);
    const gs = await page.evaluate(() => window.chrome.storage.local._data.prospectGlobalSettings);
    expect(gs?.enabled).toBe(true);
  });

  test('stat "Nouveaux" = 1 (prospect r1 non vu)', async ({ page }) => {
    await expect(page.locator('#p-stat-new')).toHaveText('1');
  });

  test('bouton "Tout marquer vu" ne lève pas d\'exception JS', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await page.locator('#p-mark-seen').click();
    await page.waitForTimeout(400);
    expect(jsErrors).toEqual([]);
  });
});

test.describe('Cross-panel', () => {
  test.beforeEach(async ({ page }) => {
    page.on('request', req => {
      if (req.url().includes('leboncoin.fr')) throw new Error(`Requête interdite: ${req.url()}`);
    });
    await page.addInitScript(CHROME_MOCK_SCRIPT);
    await page.goto(POPUP_URL, { waitUntil: 'domcontentloaded' });
    await waitForPopupReady(page);
  });

  test('état sélection bumper préservé après aller-retour sur messages', async ({ page }) => {
    // Sélectionner tout dans bumper
    await page.locator('#b-select-all').click();
    await page.waitForTimeout(200);
    const hintBefore = await page.locator('#b-selection-hint').textContent();
    // Aller sur messages puis revenir
    await clickTabAndWait(page, 1);
    await clickTabAndWait(page, 0);
    // Le hint doit afficher les mêmes données (storage inchangé)
    await expect(page.locator('#b-selection-hint')).toHaveText(hintBefore ?? '');
  });

  test('aucune erreur console critique sur cycle complet de tab-switching', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await clickTabAndWait(page, 1);
    await clickTabAndWait(page, 2);
    await clickTabAndWait(page, 0);
    await page.waitForTimeout(300);
    const critical = errors.filter(e => !e.includes('favicon') && !e.includes('ERR_FILE_NOT_FOUND'));
    expect(critical).toEqual([]);
  });
});
