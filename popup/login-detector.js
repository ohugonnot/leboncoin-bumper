/**
 * Logique de détection de connexion LBC extraite de popup.js pour être testable.
 *
 * Problème : après install, myListings est vide → CHECK_LOGIN retourne loggedIn:false
 * même si l'user est connecté. On déclenche un REFRESH_LISTINGS silencieux une seule
 * fois (cooldown 30s) pour peupler myListings et lever l'ambiguïté.
 */

// Cooldown entre deux auto-refreshs silencieux (ms) — évite le spam si l'user
// rouvre la popup rapidement.
const AUTO_REFRESH_COOLDOWN_MS = 30_000;

/**
 * Détermine si un auto-refresh silencieux est autorisé.
 * @param {number|null} lastAttemptAt  Timestamp du dernier essai (ms epoch) ou null.
 * @param {number} now                 Date.now() injecté pour la testabilité.
 */
export function canAutoRefresh(lastAttemptAt, now) {
  if (lastAttemptAt == null) return true;
  return now - lastAttemptAt >= AUTO_REFRESH_COOLDOWN_MS;
}

/**
 * Gère la détection de connexion avec auto-refresh silencieux.
 *
 * @param {object} deps
 * @param {Function} deps.sendMessage   chrome.runtime.sendMessage
 * @param {Function} deps.storageGet    chrome.storage.local.get
 * @param {Function} deps.storageSet    chrome.storage.local.set
 * @param {Function} deps.showDetecting Appelé quand on démarre l'auto-refresh (affiche spinner)
 * @param {Function} deps.showLoggedIn  Appelé si connexion confirmée (pseudo optionnel)
 * @param {Function} deps.showNotLogged Appelé si toujours déconnecté après tentative
 * @param {object}   deps.flags         Objet mutable partagé avec le module appelant
 *                                       { autoRefreshAttempted: boolean }
 * @param {Function} [deps.now]         Injection de Date.now() pour les tests
 */
export async function detectLogin(deps) {
  const {
    sendMessage,
    storageGet,
    storageSet,
    showDetecting,
    showLoggedIn,
    showNotLogged,
    flags,
    now = Date.now,
  } = deps;

  let r;
  try {
    r = await sendMessage({ type: 'CHECK_LOGIN' });
  } catch {
    showNotLogged();
    return;
  }

  const loggedIn = !!r?.result?.loggedIn;
  if (loggedIn) {
    showLoggedIn(r.result.pseudo || null);
    return;
  }

  // Not logged in — check if we should attempt a silent auto-refresh
  const { loginAutoRefreshAt } = await storageGet(['loginAutoRefreshAt']);
  const eligible = !flags.autoRefreshAttempted && canAutoRefresh(loginAutoRefreshAt ?? null, now());

  if (!eligible) {
    showNotLogged();
    return;
  }

  // Mark attempt before async work to prevent concurrent triggers
  flags.autoRefreshAttempted = true;
  await storageSet({ loginAutoRefreshAt: now() });

  showDetecting();

  try {
    await sendMessage({ type: 'REFRESH_LISTINGS' });
  } catch {
    // Refresh failed — fall through to re-check, will show not-logged
  }

  // Re-check after refresh
  let r2;
  try {
    r2 = await sendMessage({ type: 'CHECK_LOGIN' });
  } catch {
    showNotLogged();
    return;
  }

  const loggedIn2 = !!r2?.result?.loggedIn;
  if (loggedIn2) {
    showLoggedIn(r2.result.pseudo || null);
  } else {
    showNotLogged();
  }
}
