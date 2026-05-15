import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postNotificationWebhook, postNotificationEmail, _logEmailError } from '../notify-webhook.js';

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

// ─── postNotificationEmail ───────────────────────────────────────────────────

const EMAIL_PAYLOAD = {
  profile: { id: 'p1', name: 'Test' },
  trigger: 'manual',
  ts: '2026-05-15T10:00:00.000Z',
  fresh: [{ list_id: 'x1', subject: 'PHP cherché', url: 'https://lbc.fr/x1', score: 7, location: 'Lyon', kw_hit: 'php', age_days: 1, price: null, owner_name: null }]
};

test('postNotificationEmail: email invalide → erreur loguée, fetch jamais appelé', async () => {
  const store = installChromeStub();
  globalThis.fetch = async () => { throw new Error('fetch should not be called'); };
  try {
    await postNotificationEmail('not-an-email', EMAIL_PAYLOAD, 'p1');
    assert.equal(store.lastEmailErrorByProfile?.p1?.error, 'invalid email');
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});

test('postNotificationEmail: HTTP non-ok → erreur HTTP {status}', async () => {
  const store = installChromeStub();
  let capturedUrl = null;
  globalThis.fetch = async (url) => { capturedUrl = url; return { ok: false, status: 500 }; };
  try {
    await postNotificationEmail('user@example.com', EMAIL_PAYLOAD, 'p1');
    assert.equal(store.lastEmailErrorByProfile?.p1?.error, 'HTTP 500');
    assert.ok(capturedUrl?.includes('formsubmit.co/ajax'), `URL attendue formsubmit: ${capturedUrl}`);
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});

test('postNotificationEmail: succès {success:"true"} → lastEmailErrorByProfile effacé', async () => {
  const store = installChromeStub();
  store.lastEmailErrorByProfile = { p1: { at: '2026-01-01T00:00:00.000Z', error: 'old' } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: 'true' }) });
  try {
    await postNotificationEmail('user@example.com', EMAIL_PAYLOAD, 'p1');
    assert.equal(store.lastEmailErrorByProfile?.p1, undefined);
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});

test('postNotificationEmail: succès HTTP mais {success:"false"} → erreur loguée', async () => {
  const store = installChromeStub();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: 'false', message: 'quota exceeded' }) });
  try {
    await postNotificationEmail('user@example.com', EMAIL_PAYLOAD, 'p1');
    assert.ok(store.lastEmailErrorByProfile?.p1?.error, 'une erreur doit être loguée');
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});
