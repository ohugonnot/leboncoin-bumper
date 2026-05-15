import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postNotificationWebhook } from '../notify-webhook.js';

function installChromeStub() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => key ? { [key]: store[key] } : { ...store },
        set: async (obj) => Object.assign(store, obj)
      }
    }
  };
  return store;
}

test('postNotificationWebhook: URL invalide log erreur sans appeler fetch', async () => {
  const store = installChromeStub();
  // Sentinelle : fetch ne doit pas être appelé
  globalThis.fetch = async () => { throw new Error('fetch should not be called'); };
  try {
    await postNotificationWebhook('not-a-url', {}, 'p1');
    assert.equal(store.lastWebhookErrorByProfile?.p1?.error, 'invalid URL');
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});

test('postNotificationWebhook: protocole non supporté log erreur', async () => {
  const store = installChromeStub();
  globalThis.fetch = async () => { throw new Error('fetch should not be called'); };
  try {
    await postNotificationWebhook('ftp://example.com/hook', {}, 'p1');
    assert.ok(
      store.lastWebhookErrorByProfile?.p1?.error?.includes('unsupported protocol'),
      `attendu 'unsupported protocol', reçu: ${store.lastWebhookErrorByProfile?.p1?.error}`
    );
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});

test('postNotificationWebhook: HTTP non-ok log erreur HTTP {status}', async () => {
  const store = installChromeStub();
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    await postNotificationWebhook('https://example.com/hook', { foo: 1 }, 'p1');
    assert.equal(store.lastWebhookErrorByProfile?.p1?.error, 'HTTP 500');
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});

test('postNotificationWebhook: succès efface l\'entrée d\'erreur précédente', async () => {
  const store = installChromeStub();
  // Pré-remplir une erreur existante
  store.lastWebhookErrorByProfile = { p1: { at: '2026-01-01T00:00:00.000Z', error: 'old error' } };
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    await postNotificationWebhook('https://example.com/hook', { foo: 1 }, 'p1');
    assert.equal(
      store.lastWebhookErrorByProfile?.p1,
      undefined,
      'l\'entrée d\'erreur doit être supprimée après succès'
    );
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});

test('postNotificationWebhook: AbortError log le message sans attendre 5s', async () => {
  const store = installChromeStub();
  // Rejette immédiatement avec une AbortError-like — pas de vrai setTimeout
  globalThis.fetch = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  try {
    await postNotificationWebhook('https://example.com/hook', {}, 'p1');
    assert.ok(
      store.lastWebhookErrorByProfile?.p1?.error?.toLowerCase().includes('abort'),
      `attendu message contenant 'abort', reçu: ${store.lastWebhookErrorByProfile?.p1?.error}`
    );
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});
