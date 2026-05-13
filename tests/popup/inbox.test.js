/**
 * Tests d'intégration pour popup/inbox.js.
 *
 * inbox.js ne réfère pas document au top-level (uniquement dans les fonctions),
 * donc on peut installer le stub AVANT l'import dynamique.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOMStub, makeChromeMock, flushPromises } from './_setup.js';

// Fixtures inbox
const makeConv = (id, cat, opts = {}) => ({
  conversationId: String(id),
  partnerName: opts.partnerName || `User${id}`,
  subject: opts.subject || `Sujet ${id}`,
  lastMessagePreview: opts.preview || `Message ${id}`,
  lastMessageDate: new Date().toISOString(),
  unseenCounter: opts.unseen || 0,
  _classification: { category: cat, signals: opts.signals || [], confidence: 0.9 },
});

describe('inbox - computeVisibleCounts', () => {
  let computeVisibleCounts;

  before(async () => {
    installDOMStub();
    ({ computeVisibleCounts } = await import('../../popup/inbox.js'));
  });

  test('compte correctement chaque catégorie sans archivés', () => {
    const all = [
      makeConv(1, 'scam'),
      makeConv(2, 'lead'),
      makeConv(3, 'lead'),
      makeConv(4, 'question'),
      makeConv(5, 'spam'),
    ];
    const dismissed = new Set();
    const counts = computeVisibleCounts(all, dismissed);
    assert.equal(counts.scam, 1);
    assert.equal(counts.lead, 2);
    assert.equal(counts.question, 1);
    assert.equal(counts.spam, 1);
    assert.equal(counts.archived, 0);
  });

  test('les conversations dismissées comptent dans archived et non dans leur catégorie', () => {
    const all = [makeConv(1, 'scam'), makeConv(2, 'lead')];
    const dismissed = new Set(['1']);
    const counts = computeVisibleCounts(all, dismissed);
    assert.equal(counts.scam, 0);
    assert.equal(counts.lead, 1);
    assert.equal(counts.archived, 1);
  });

  test('tableau vide → tous les compteurs à 0', () => {
    const counts = computeVisibleCounts([], new Set());
    assert.equal(counts.scam + counts.lead + counts.question + counts.spam + counts.archived, 0);
  });
});

describe('inbox - renderInbox', () => {
  let renderInbox;
  let dom;

  before(async () => {
    dom = installDOMStub();
    ({ renderInbox } = await import('../../popup/inbox.js'));
  });

  beforeEach(() => {
    // Reset innerHTML on list and hint between tests
    if (global.document.getElementById('m-list')) {
      global.document.getElementById('m-list').innerHTML = '';
      global.document.getElementById('m-list')._children = [];
    }
    if (global.document.getElementById('m-empty-hint')) {
      global.document.getElementById('m-empty-hint').hidden = true;
    }
  });

  test('cache cache le hint quand il y a des conversations', () => {
    const cache = { all: [makeConv(1, 'lead'), makeConv(2, 'scam')] };
    renderInbox(cache, new Set());
    assert.equal(global.document.getElementById('m-empty-hint').hidden, true);
  });

  test('affiche le hint quand le cache est null', () => {
    renderInbox(null, new Set());
    assert.equal(global.document.getElementById('m-empty-hint').hidden, false);
  });

  test('met à jour les stats scam/lead', () => {
    const cache = { all: [makeConv(10, 'scam'), makeConv(11, 'lead'), makeConv(12, 'lead')] };
    renderInbox(cache, new Set());
    assert.equal(Number(global.document.getElementById('m-stat-scam').textContent), 1);
    assert.equal(Number(global.document.getElementById('m-stat-lead').textContent), 2);
  });

  test('cache vide mais existant → hint "Aucune conversation"', () => {
    renderInbox({ all: [] }, new Set());
    const hint = global.document.getElementById('m-empty-hint');
    assert.equal(hint.hidden, false);
    assert.ok(hint.textContent.includes('Aucune'));
  });

  test('les archivés décrèmentent les counts visibles et incrémentent archived', () => {
    const cache = { all: [makeConv(1, 'scam'), makeConv(2, 'scam')] };
    const dismissed = new Set(['1']); // conv 1 archivée
    renderInbox(cache, dismissed);
    assert.equal(Number(global.document.getElementById('m-stat-scam').textContent), 1);
    assert.equal(Number(global.document.getElementById('m-stat-archived').textContent), 1);
  });
});

describe('inbox - loadInbox', () => {
  let loadInbox;

  before(async () => {
    installDOMStub();
    ({ loadInbox } = await import('../../popup/inbox.js'));
  });

  test('loadInbox avec une erreur de dernière exécution → affiche la bannière d\'erreur', async () => {
    global.chrome = makeChromeMock({
      inboxCache: null,
      inboxLastRun: { error: 'Timeout API' },
      inboxDismissed: [],
    });
    await loadInbox();
    assert.equal(global.document.getElementById('m-error-banner').hidden, false);
    assert.ok(global.document.getElementById('m-error-text').textContent.includes('Timeout API'));
  });

  test('loadInbox sans erreur → cache la bannière', async () => {
    global.chrome = makeChromeMock({
      inboxCache: { all: [] },
      inboxLastRun: { at: new Date().toISOString() },
      inboxDismissed: [],
    });
    await loadInbox();
    assert.equal(global.document.getElementById('m-error-banner').hidden, true);
  });
});
