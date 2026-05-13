/**
 * Tests d'intégration pour popup/bumper.js.
 *
 * bumper.js capture ses références DOM (objet `b`) au top-level à l'import.
 * Il faut donc un seul installDOMStub() + un seul import dynamique pour tout
 * le fichier. Les suites partagent le même DOM stub.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDOMStub, makeChromeMock, flushPromises } from './_setup.js';

const BASE_SETTINGS = {
  enabled: false,
  dryRun: true,
  dayOfWeek: 1,
  hour: 9,
  minute: 0,
  jitterMinutes: 60,
  onlyAdIds: [],
};

const makeListings = (n = 2) => ({
  fetchedAt: Date.now(),
  listings: Array.from({ length: n }, (_, i) => ({
    id: `ad-${i + 1}`,
    title: `Annonce ${i + 1}`,
    status: 'En ligne',
    catSlug: 'services',
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
  })),
});

// Shared across all describe blocks — single DOM install + single import
let bumperModule;
let chromeMock;
let dom;

before(async () => {
  dom = installDOMStub();
  chromeMock = makeChromeMock({
    settings: BASE_SETTINGS,
    log: [],
    myListings: makeListings(2),
    lastBumpRun: null,
    bumpHistory: [],
  });
  global.chrome = chromeMock;
  bumperModule = await import('../../popup/bumper.js');
});

describe('bumper - loadBumper', () => {
  test('loadBumper peuple les champs depuis le storage', async () => {
    chromeMock._storage.settings = { ...BASE_SETTINGS, hour: 14, dayOfWeek: 3 };
    await bumperModule.loadBumper();
    assert.equal(global.document.getElementById('b-hour').value, 14);
    assert.equal(global.document.getElementById('b-dayOfWeek').value, 3);
  });

  test('dryRun=true → checkbox cochée', async () => {
    chromeMock._storage.settings = { ...BASE_SETTINGS, dryRun: true };
    await bumperModule.loadBumper();
    assert.equal(global.document.getElementById('b-dryRun').checked, true);
  });

  test('dryRun=false → checkbox décochée', async () => {
    chromeMock._storage.settings = { ...BASE_SETTINGS, dryRun: false };
    await bumperModule.loadBumper();
    assert.equal(global.document.getElementById('b-dryRun').checked, false);
  });

  test('avec annonces → zone listings peuplée (appendChild)', async () => {
    chromeMock._storage.settings = BASE_SETTINGS;
    chromeMock._storage.myListings = makeListings(3);
    await bumperModule.loadBumper();
    const el = global.document.getElementById('b-listings');
    assert.ok(el._children.length > 0, 'should have listing rows');
  });

  test('sans annonces → renderListings vide ne lève pas d\'exception', async () => {
    chromeMock._storage.myListings = null;
    // Doit s'exécuter sans erreur, même sans DOM complet
    await assert.doesNotReject(() => bumperModule.loadBumper());
  });
});

describe('bumper - renderBumpStatus', () => {
  test('lastRun null → métaLast contient "Jamais"', () => {
    bumperModule.renderBumpStatus({ lastRun: null, nextRunAt: null, scheduled: false });
    const el = global.document.getElementById('b-meta-last');
    const content = el.innerHTML || el.textContent || '';
    assert.ok(content.includes('Jamais'), `got: "${content}"`);
  });

  test('lastRun avec succès → métaLast contient "Dernier"', () => {
    bumperModule.renderBumpStatus({
      lastRun: { ts: new Date(Date.now() - 5 * 60000).toISOString(), success: 2, failed: 0 },
      nextRunAt: null,
      scheduled: false,
    });
    const text = global.document.getElementById('b-meta-last').textContent;
    assert.ok(text.includes('Dernier'), `got: "${text}"`);
    assert.ok(text.includes('2'), `got: "${text}"`);
  });

  test('nextRunAt défini → métaNext contient "Prochain"', () => {
    const next = new Date(Date.now() + 24 * 3600_000);
    bumperModule.renderBumpStatus({ lastRun: null, nextRunAt: next.toISOString(), scheduled: true });
    const text = global.document.getElementById('b-meta-next').textContent;
    assert.ok(text.includes('Prochain'), `got: "${text}"`);
  });

  test('scheduled=true sans nextRunAt → métaNext contient "Planning actif"', () => {
    bumperModule.renderBumpStatus({ lastRun: null, nextRunAt: null, scheduled: true });
    const text = global.document.getElementById('b-meta-next').textContent;
    assert.ok(text.includes('Planning actif'), `got: "${text}"`);
  });
});

describe('bumper - renderBumpHistory', () => {
  test('historique vide → historyList contient "Aucun"', () => {
    bumperModule.renderBumpHistory([]);
    const html = global.document.getElementById('b-history-list').innerHTML;
    assert.ok(html.includes('Aucun'), `got: "${html}"`);
  });

  test('historique réussi → contient ✅', () => {
    bumperModule.renderBumpHistory([{ ts: new Date().toISOString(), success: 2, failed: 0 }]);
    const html = global.document.getElementById('b-history-list').innerHTML;
    assert.ok(html.includes('✅'), `got: "${html}"`);
  });

  test('historique avec échecs → contient ❌', () => {
    bumperModule.renderBumpHistory([{ ts: new Date().toISOString(), success: 1, failed: 1 }]);
    const html = global.document.getElementById('b-history-list').innerHTML;
    assert.ok(html.includes('❌'), `got: "${html}"`);
  });
});

describe('bumper - renderLog', () => {
  test('renderLog vide → log.innerHTML vide', () => {
    bumperModule.renderLog([]);
    assert.equal(global.document.getElementById('b-log').innerHTML, '');
  });
});

describe('bumper - renderListings stats', () => {
  // Collect all innerHTML recursively from DOM stub children
  function collectHtml(el) {
    let out = el._innerHTML || '';
    for (const c of el._children || []) out += collectHtml(c);
    return out;
  }

  test('annonce avec stats peuplé → contient icônes vues, favoris, contacts', async () => {
    const stored = {
      fetchedAt: Date.now(),
      listings: [{
        id: 'ad-stats-1',
        title: 'Test stats',
        status: 'En ligne',
        catSlug: 'services',
        publishedAt: new Date().toISOString(),
        stats: { views: 7, favorites: 2, messages: 1, leads: 0, phones: 0, replies: 0 },
      }],
    };
    chromeMock._storage.myListings = stored;
    chromeMock._storage.settings = BASE_SETTINGS;
    await bumperModule.loadBumper();
    const listingsEl = global.document.getElementById('b-listings');
    const html = collectHtml(listingsEl);
    assert.ok(html.includes('👁'), `devrait contenir 👁, got: "${html}"`);
    assert.ok(html.includes('⭐'), `devrait contenir ⭐, got: "${html}"`);
    assert.ok(html.includes('✉'), `devrait contenir ✉, got: "${html}"`);
  });

  test('annonce avec stats tout à 0 → contient "Pas encore de stats"', async () => {
    const stored = {
      fetchedAt: Date.now(),
      listings: [{
        id: 'ad-stats-2',
        title: 'Test stats zéro',
        status: 'En ligne',
        catSlug: 'services',
        publishedAt: new Date().toISOString(),
        stats: { views: 0, favorites: 0, messages: 0, leads: 0, phones: 0, replies: 0 },
      }],
    };
    chromeMock._storage.myListings = stored;
    chromeMock._storage.settings = BASE_SETTINGS;
    await bumperModule.loadBumper();
    const listingsEl = global.document.getElementById('b-listings');
    const html = collectHtml(listingsEl);
    assert.ok(html.includes('Pas encore de stats'), `devrait contenir "Pas encore de stats", got: "${html}"`);
  });

  test('annonce sans stats (fallback DOM scrape) → pas de .listing-stats', async () => {
    const stored = {
      fetchedAt: Date.now(),
      listings: [{
        id: 'ad-stats-3',
        title: 'Test sans stats',
        status: 'En ligne',
        catSlug: 'services',
        publishedAt: new Date().toISOString(),
        // stats intentionnellement absent — cas fallback scrapeListings
      }],
    };
    chromeMock._storage.myListings = stored;
    chromeMock._storage.settings = BASE_SETTINGS;
    await bumperModule.loadBumper();
    const listingsEl = global.document.getElementById('b-listings');
    const html = collectHtml(listingsEl);
    assert.ok(!html.includes('listing-stats'), `ne devrait pas contenir listing-stats, got: "${html}"`);
  });
});

describe('bumper - initBumper + handlers', () => {
  test('initBumper ne lève pas d\'exception', () => {
    assert.doesNotThrow(() => bumperModule.initBumper());
  });

  test('click "Tout sélectionner" → envoie RESCHEDULE', async () => {
    chromeMock._storage.myListings = makeListings(2);
    chromeMock._storage.settings = BASE_SETTINGS;
    await bumperModule.loadBumper(); // charge _currentStoredListings

    const messages = [];
    chromeMock.runtime.sendMessage = async (msg) => { messages.push(msg); return { ok: true }; };

    global.document.getElementById('b-select-all').dispatchEvent({ type: 'click', preventDefault: () => {} });
    await flushPromises();
    assert.ok(messages.some(m => m.type === 'RESCHEDULE'), `messages: ${JSON.stringify(messages)}`);
  });

  test('click "Tester" avec dryRun=true → envoie RUN_NOW', async () => {
    global.document.getElementById('b-dryRun').checked = true;
    chromeMock._storage.log = [];

    const messages = [];
    chromeMock.runtime.sendMessage = async (msg) => { messages.push(msg); return { ok: true }; };

    global.document.getElementById('b-runNow').dispatchEvent({ type: 'click', preventDefault: () => {} });
    await flushPromises();
    assert.ok(messages.some(m => m.type === 'RUN_NOW'), `messages: ${JSON.stringify(messages)}`);
  });

  test('click "Planifier au pic" → envoie RESCHEDULE avec un créneau calculé', async () => {
    chromeMock._storage.settings = { ...BASE_SETTINGS };
    chromeMock._storage.myListings = makeListings(2);

    const messages = [];
    chromeMock.runtime.sendMessage = async (msg) => { messages.push(msg); return { ok: true }; };

    global.document.getElementById('b-smartBump').dispatchEvent({ type: 'click', preventDefault: () => {} });
    await flushPromises();
    assert.ok(messages.some(m => m.type === 'RESCHEDULE'), `messages: ${JSON.stringify(messages)}`);
    // settings.enabled doit avoir été mis à true
    assert.equal(global.document.getElementById('b-enabled').checked, true);
  });
});
