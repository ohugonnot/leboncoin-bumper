/**
 * E2E live : valide les 4 scénarios "validation live obligatoire" de la feature
 * notif-dedup-webhook.
 *
 *  1. Le champ "Webhook URL" est rendu dans la popup réelle (extension chargée
 *     dans Chromium MV3 via launchPersistentContext).
 *  2. POST réel reçu par un mini-serveur HTTP local quand on appelle
 *     postNotificationWebhook avec payload de scan.
 *  3. filterFreshForNotification dédoublonne correctement quand un list_id est
 *     déjà dans notifiedIds.
 *  4. markResultsNotified purge les entries > 7j et conserve les fraîches.
 *
 * On NE déclenche PAS un vrai scan LBC : DataDome bloque tout fetch leboncoin
 * en headless sans tab connectée. Les wiring storage + fetch + dédup sont
 * validés ici de bout en bout (Node + HTTP + module pur), suffisant pour la
 * convergence du feature-loop.
 */
import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXT_PATH = resolve(__dirname, '../..');

test.describe.configure({ mode: 'serial' });

test('UI : champ p-notificationWebhookUrl rendu et éditable dans popup réelle', async ({}, testInfo) => {
  testInfo.setTimeout(30_000);
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
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 8000 });
    const extensionId = sw.url().split('/')[2];

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html?fullpage=1#prospect`);
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    await page.waitForTimeout(800);

    // Activer le tab Prospects + ouvrir les <details> qui contiennent le champ.
    await page.evaluate(() => {
      const tab = document.querySelector('[data-tab="prospect"], [data-target="prospect"]')
                || [...document.querySelectorAll('button')].find(b => /prospect/i.test(b.textContent));
      if (tab) tab.click();
      document.querySelectorAll('details').forEach(d => d.open = true);
    });
    await page.waitForTimeout(200);

    const input = page.locator('#p-notificationWebhookUrl');
    await expect(input).toBeAttached({ timeout: 5000 });
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('https://example.com/hook');
    await expect(input).toHaveValue('https://example.com/hook');
  } finally {
    await context.close();
  }
});

test('POST réel : postNotificationWebhook envoie le bon payload au serveur local', async () => {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      received.push({
        method: req.method,
        contentType: req.headers['content-type'],
        body: JSON.parse(body)
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise(r => server.listen(9991, '127.0.0.1', r));

  try {
    // Mock chrome.storage minimal pour le module pur
    const store = {};
    globalThis.chrome = {
      storage: { local: {
        get: async (key) => key ? { [key]: store[key] } : { ...store },
        set: async (obj) => Object.assign(store, obj)
      }}
    };
    const { postNotificationWebhook } = await import('../../notify-webhook.js');
    const { buildWebhookPayload } = await import('../../prospect.js');

    const fresh = [{
      list_id: '123', subject: 'Test', url: 'https://www.leboncoin.fr/v/123',
      score: 9, location: 'Paris', kw_hit: 'wordpress', age_days: 2,
      price: 500, owner_name: 'Alice',
      score_breakdown: ['SHOULD_NOT_LEAK'],   // doit être strippé
    }];
    const payload = buildWebhookPayload(
      { id: 'p-test', name: 'Dev Web' }, 'manual', fresh
    );
    await postNotificationWebhook('http://127.0.0.1:9991/notif', payload, 'p-test');

    expect(received.length).toBe(1);
    expect(received[0].method).toBe('POST');
    expect(received[0].contentType).toMatch(/json/);
    expect(received[0].body.profile).toEqual({ id: 'p-test', name: 'Dev Web' });
    expect(received[0].body.trigger).toBe('manual');
    expect(received[0].body.fresh[0].list_id).toBe('123');
    expect(received[0].body.fresh[0].owner_name).toBe('Alice');
    // Pas de leak des champs sensibles
    expect(received[0].body.fresh[0].score_breakdown).toBeUndefined();
    expect(received[0].body.fresh[0].api_key).toBeUndefined();
    // Succès doit avoir effacé l'éventuelle erreur précédente
    expect(store.lastWebhookErrorByProfile?.['p-test']).toBeUndefined();
  } finally {
    delete globalThis.chrome;
    await new Promise(r => server.close(r));
  }
});

test('Dédup : filterFreshForNotification ignore les list_id déjà dans notifiedIds', async () => {
  const { filterFreshForNotification } = await import('../../prospect.js');

  const results = [
    { list_id: 'a1', score: 8 },
    { list_id: 'a2', score: 9 },
    { list_id: 'a3', score: 7 },
  ];
  // a1 et a2 déjà notifiés : seul a3 doit ressortir
  const fresh = filterFreshForNotification(
    results,
    new Set(),
    new Set(['a1', 'a2']),
    new Set(),
    5
  );
  expect(fresh.map(r => r.list_id)).toEqual(['a3']);

  // Et si tout est déjà notifié → 0
  const empty = filterFreshForNotification(
    results,
    new Set(),
    new Set(['a1', 'a2', 'a3']),
    new Set(),
    5
  );
  expect(empty).toEqual([]);
});

test('Purge 7j : markResultsNotified supprime les entries > 7j et garde les fraîches', async () => {
  const NOW = Date.now();
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000;

  const store = {
    prospectNotifiedIdsByProfile: {
      'p1': {
        'old-1': NOW - SEVEN_DAYS - 60_000,    // 7j + 1min → purge
        'old-2': NOW - SEVEN_DAYS - 10_000,    // purge
        'fresh-1': NOW - 60_000,                // 1min → garde
      }
    }
  };
  globalThis.chrome = {
    storage: { local: {
      get: async (key) => key ? { [key]: store[key] } : { ...store },
      set: async (obj) => Object.assign(store, obj)
    }}
  };
  try {
    const { markResultsNotified } = await import('../../prospect.js');
    await markResultsNotified(['new-1'], 'p1');
    const ids = store.prospectNotifiedIdsByProfile.p1;
    expect(ids['old-1']).toBeUndefined();
    expect(ids['old-2']).toBeUndefined();
    expect(ids['fresh-1']).toBeDefined();
    expect(ids['new-1']).toBeDefined();
  } finally {
    delete globalThis.chrome;
  }
});
