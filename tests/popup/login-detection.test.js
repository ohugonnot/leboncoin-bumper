/**
 * Tests pour popup/login-detector.js.
 *
 * On importe directement login-detector.js — pas besoin de DOM stub complet
 * car le module est pur (toutes les dépendances DOM passées via `deps`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canAutoRefresh, detectLogin } from '../../popup/login-detector.js';

// ── canAutoRefresh ────────────────────────────────────────────────────────────

describe('canAutoRefresh', () => {
  test('retourne true si lastAttemptAt est null', () => {
    assert.equal(canAutoRefresh(null, Date.now()), true);
  });

  test('retourne false si le dernier essai est il y a 10s (< 30s)', () => {
    const now = Date.now();
    assert.equal(canAutoRefresh(now - 10_000, now), false);
  });

  test('retourne true si le dernier essai est il y a 31s (> 30s)', () => {
    const now = Date.now();
    assert.equal(canAutoRefresh(now - 31_000, now), true);
  });

  test('retourne true si loginAutoRefreshAt=0 (valeur sentinelle reset bouton)', () => {
    // now - 0 >> 30s → toujours true
    assert.equal(canAutoRefresh(0, Date.now()), true);
  });
});

// ── detectLogin ───────────────────────────────────────────────────────────────

// Builders de deps minimaux pour réduire la répétition dans les tests.
function makeDeps(overrides = {}) {
  const calls = { detecting: 0, loggedIn: [], notLogged: 0, refreshSent: 0 };
  const storage = {};

  const deps = {
    sendMessage: async (msg) => {
      if (msg.type === 'CHECK_LOGIN') return { result: { loggedIn: false } };
      if (msg.type === 'REFRESH_LISTINGS') { calls.refreshSent++; return {}; }
    },
    storageGet: async (keys) => Object.fromEntries(keys.map(k => [k, storage[k]])),
    storageSet: async (data) => { Object.assign(storage, data); },
    showDetecting: () => { calls.detecting++; },
    showLoggedIn: (pseudo) => { calls.loggedIn.push(pseudo); },
    showNotLogged: () => { calls.notLogged++; },
    flags: { autoRefreshAttempted: false },
    now: () => Date.now(),
    ...overrides,
  };

  return { deps, calls, storage };
}

describe('detectLogin — flux nominal', () => {
  test('CHECK_LOGIN ok → showLoggedIn, pas de REFRESH_LISTINGS', async () => {
    const { deps, calls } = makeDeps({
      sendMessage: async (msg) => {
        if (msg.type === 'CHECK_LOGIN') return { result: { loggedIn: true, pseudo: 'alice' } };
        if (msg.type === 'REFRESH_LISTINGS') calls.refreshSent++;
      },
    });
    await detectLogin(deps);
    assert.equal(calls.loggedIn.length, 1);
    assert.equal(calls.loggedIn[0], 'alice');
    assert.equal(calls.refreshSent, 0);
    assert.equal(calls.notLogged, 0);
  });

  test('loggedIn:false + pas de cooldown → REFRESH_LISTINGS déclenché une fois', async () => {
    const { deps, calls } = makeDeps();
    await detectLogin(deps);
    assert.equal(calls.refreshSent, 1);
    assert.equal(calls.detecting, 1);
  });

  test('loggedIn:false + pas de cooldown + re-check ok → showLoggedIn final', async () => {
    let checkCount = 0;
    const { deps, calls } = makeDeps({
      sendMessage: async (msg) => {
        if (msg.type === 'CHECK_LOGIN') {
          checkCount++;
          // Premier check : pas connecté. Deuxième (après refresh) : connecté.
          return { result: { loggedIn: checkCount > 1, pseudo: 'bob' } };
        }
        if (msg.type === 'REFRESH_LISTINGS') { calls.refreshSent++; return {}; }
      },
    });
    await detectLogin(deps);
    assert.equal(calls.loggedIn.length, 1);
    assert.equal(calls.loggedIn[0], 'bob');
    assert.equal(calls.notLogged, 0);
  });

  test('loggedIn:false + pas de cooldown + re-check ko → showNotLogged', async () => {
    const { deps, calls } = makeDeps();
    // sendMessage par défaut retourne loggedIn:false toujours
    await detectLogin(deps);
    assert.equal(calls.notLogged, 1);
    assert.equal(calls.loggedIn.length, 0);
  });
});

describe('detectLogin — cooldown', () => {
  test('loginAutoRefreshAt récent (10s) → pas de REFRESH_LISTINGS, showNotLogged', async () => {
    const now = Date.now();
    const { deps, calls, storage } = makeDeps({ now: () => now });
    storage.loginAutoRefreshAt = now - 10_000; // 10s ago < 30s

    await detectLogin(deps);
    assert.equal(calls.refreshSent, 0);
    assert.equal(calls.notLogged, 1);
    assert.equal(calls.detecting, 0);
  });

  test('flags.autoRefreshAttempted=true → pas de REFRESH_LISTINGS même sans cooldown', async () => {
    const { deps, calls } = makeDeps();
    deps.flags.autoRefreshAttempted = true;

    await detectLogin(deps);
    assert.equal(calls.refreshSent, 0);
    assert.equal(calls.notLogged, 1);
  });

  test('loginAutoRefreshAt=0 (reset bouton) → REFRESH_LISTINGS déclenché', async () => {
    const now = Date.now();
    const { deps, calls, storage } = makeDeps({ now: () => now });
    storage.loginAutoRefreshAt = 0; // valeur sentinelle du bouton "Vérifier"

    await detectLogin(deps);
    assert.equal(calls.refreshSent, 1);
  });

  test('loginAutoRefreshAt vieux (31s) → REFRESH_LISTINGS autorisé', async () => {
    const now = Date.now();
    const { deps, calls, storage } = makeDeps({ now: () => now });
    storage.loginAutoRefreshAt = now - 31_000;

    await detectLogin(deps);
    assert.equal(calls.refreshSent, 1);
  });
});

describe('detectLogin — robustesse', () => {
  test('sendMessage lance une exception → showNotLogged, pas de crash', async () => {
    const { deps, calls } = makeDeps({
      sendMessage: async () => { throw new Error('Extension context invalidated'); },
    });
    await detectLogin(deps);
    assert.equal(calls.notLogged, 1);
  });

  test('REFRESH_LISTINGS lance une exception → re-check quand même', async () => {
    let checkCount = 0;
    const { deps, calls } = makeDeps({
      sendMessage: async (msg) => {
        if (msg.type === 'CHECK_LOGIN') {
          checkCount++;
          return { result: { loggedIn: false } };
        }
        if (msg.type === 'REFRESH_LISTINGS') {
          calls.refreshSent++;
          throw new Error('tab closed');
        }
      },
    });
    await detectLogin(deps);
    // Un refresh tenté, deux checks (avant + après), finalement KO
    assert.equal(calls.refreshSent, 1);
    assert.equal(checkCount, 2);
    assert.equal(calls.notLogged, 1);
  });

  test('loginAutoRefreshAt stocké après déclenchement', async () => {
    const fixedNow = 1_700_000_000_000;
    const { deps, storage } = makeDeps({ now: () => fixedNow });

    await detectLogin(deps);
    assert.equal(storage.loginAutoRefreshAt, fixedNow);
  });
});
