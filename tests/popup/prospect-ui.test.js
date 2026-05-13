/**
 * Tests d'intégration pour popup/prospect-ui.js.
 *
 * prospect-ui.js capture ses refs DOM au top-level (objet `p`).
 * Même contrainte que bumper.js : un seul installDOMStub() + un seul import.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDOMStub, makeChromeMock, flushPromises } from './_setup.js';

const PROFILE_ID = 'prof-1';
const makeProfile = (overrides = {}) => ({
  id: PROFILE_ID,
  name: 'Dev & Web',
  keywords: ['wordpress', 'react'],
  minScore: 5,
  maxAgeDays: 30,
  adType: 'demand',
  priceMin: null, priceMax: null, departments: [],
  sortOrder: 'score',
  ownerType: 'all',
  shippableOnly: false,
  replyTemplate: 'Bonjour,\n\nVotre annonce m\'intéresse.',
  ...overrides,
});

const makeResult = (id, ownerName = 'Vendeur A', score = 5) => ({
  list_id: `ad-${id}`,
  subject: `Annonce ${id}`,
  body: `Cherche développeur wordpress pour projet ${id}.`,
  owner_name: ownerName,
  owner_id: `owner-${ownerName}`,
  url: `https://www.leboncoin.fr/ad/services/${id}`,
  score,
  kw_hit: 'wordpress',
  location: 'Paris',
  age_days: 5,
  price: null,
});

let prospectModule;
let chromeMock;

before(async () => {
  installDOMStub();
  chromeMock = makeChromeMock({
    prospectProfiles: [makeProfile()],
    activeProfileId: PROFILE_ID,
    prospectGlobalSettings: { enabled: false, frequency: 'week', dayOfWeek: 1, hour: 10, notifyOnNew: true, notifyMinScore: 7 },
    prospectResultsByProfile: { [PROFILE_ID]: [makeResult(1), makeResult(2)] },
    prospectLastRunByProfile: { [PROFILE_ID]: { ts: new Date().toISOString(), scanned: 2 } },
    prospectSeenIdsByProfile: { [PROFILE_ID]: [] },
    prospectIgnoredIdsByProfile: { [PROFILE_ID]: [] },
    prospectContactedLocal: [],
  });
  global.chrome = chromeMock;
  prospectModule = await import('../../popup/prospect-ui.js');
});

describe('prospect-ui - loadProspect', () => {
  test('loadProspect ne lève pas d\'exception', async () => {
    await assert.doesNotReject(() => prospectModule.loadProspect());
  });

  test('peuple p-stat-total avec le nombre de résultats visibles', async () => {
    await prospectModule.loadProspect();
    const total = global.document.getElementById('p-stat-total').textContent;
    assert.equal(Number(total), 2);
  });

  test('aucun nouveau vu → p-stat-new = 2 (tous nouveaux)', async () => {
    chromeMock._storage.prospectSeenIdsByProfile = { [PROFILE_ID]: [] };
    await prospectModule.loadProspect();
    assert.equal(Number(global.document.getElementById('p-stat-new').textContent), 2);
  });

  test('tous vus → p-stat-new = 0', async () => {
    chromeMock._storage.prospectSeenIdsByProfile = { [PROFILE_ID]: ['ad-1', 'ad-2'] };
    await prospectModule.loadProspect();
    assert.equal(Number(global.document.getElementById('p-stat-new').textContent), 0);
  });

  test('profils chargés → p-profile-select.innerHTML contient le nom', async () => {
    chromeMock._storage.prospectSeenIdsByProfile = { [PROFILE_ID]: [] };
    await prospectModule.loadProspect();
    const html = global.document.getElementById('p-profile-select').innerHTML;
    assert.ok(html.includes('Dev'), `html: ${html}`);
  });

  test('résultat ignoré → p-stat-total décrémenté', async () => {
    chromeMock._storage.prospectIgnoredIdsByProfile = { [PROFILE_ID]: ['ad-1'] };
    chromeMock._storage.prospectSeenIdsByProfile = { [PROFILE_ID]: [] };
    await prospectModule.loadProspect();
    assert.equal(Number(global.document.getElementById('p-stat-total').textContent), 1);
    // Reset
    chromeMock._storage.prospectIgnoredIdsByProfile = { [PROFILE_ID]: [] };
  });
});

describe('prospect-ui - initProspect + handlers', () => {
  test('initProspect ne lève pas d\'exception', () => {
    assert.doesNotThrow(() => prospectModule.initProspect());
  });

  test('click Scanner → envoie RUN_PROSPECT_NOW', async () => {
    const messages = [];
    chromeMock.runtime.sendMessage = async (msg) => { messages.push(msg); return { ok: true }; };
    chromeMock._storage.prospectSeenIdsByProfile = { [PROFILE_ID]: [] };

    global.document.getElementById('p-scan').dispatchEvent({ type: 'click', preventDefault: () => {} });
    await flushPromises();
    assert.ok(messages.some(m => m.type === 'RUN_PROSPECT_NOW'), `messages: ${JSON.stringify(messages)}`);
  });

  test('click "Tout marquer vu" → envoie MARK_PROSPECTS_SEEN', async () => {
    const messages = [];
    chromeMock.runtime.sendMessage = async (msg) => { messages.push(msg); return { ok: true }; };

    global.document.getElementById('p-mark-seen').dispatchEvent({ type: 'click', preventDefault: () => {} });
    await flushPromises();
    assert.ok(messages.some(m => m.type === 'MARK_PROSPECTS_SEEN'), `messages: ${JSON.stringify(messages)}`);
  });
});

describe('prospect-ui - updateScanProgress', () => {
  test('null → cache le progress bar', () => {
    prospectModule.updateScanProgress(null);
    assert.equal(global.document.getElementById('p-scan-progress').hidden, true);
  });

  test('progress défini → affiche le progress bar', () => {
    prospectModule.updateScanProgress({ kwIndex: 1, kwTotal: 3, kw: 'wordpress', page: 1, pageMax: 5, found: 4 });
    assert.equal(global.document.getElementById('p-scan-progress').hidden, false);
    assert.ok(global.document.getElementById('p-scan-progress').innerHTML.includes('wordpress'));
  });
});
