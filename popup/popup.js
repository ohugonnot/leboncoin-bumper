// Popup unloads on blur ; in-flight chrome.* rejections from peer-gone are
// already accounted for SW-side (storage written). Mute only those.
const POPUP_GONE_RE = /message channel closed|Frame with ID|Extension context invalidated|Receiving end does not exist|back\/forward cache/i;
window.addEventListener('unhandledrejection', (e) => {
  const text = String(e.reason?.message ?? e.reason ?? '');
  if (POPUP_GONE_RE.test(text)) e.preventDefault();
}, true);

import { initBumper, loadBumper, renderBumpStatus, renderBumpHistory, updateBumpProgress, renderLog } from './bumper.js';
import { initInbox, loadInbox, renderInbox } from './inbox.js';
import { initProspect, loadProspect, updateScanProgress } from './prospect-ui.js';
import { detectLogin } from './login-detector.js';

const fullpage = new URLSearchParams(location.search).get('fullpage') === '1';
if (fullpage) document.body.classList.add('fullpage');

document.getElementById('open-in-tab').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?fullpage=1') });
  window.close();
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => {
      const active = t === btn;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === target));
  });
});

// Persiste entre les ouvertures de popup dans la même session SW (pas de rechargement JS).
const loginFlags = { autoRefreshAttempted: false };

function showLoginDetecting() {
  const banner = document.getElementById('login-banner');
  const icon = document.getElementById('login-banner-icon');
  const title = document.getElementById('login-banner-title');
  const msg = document.getElementById('login-banner-msg');
  const actions = document.getElementById('login-banner-actions');
  banner.hidden = false;
  if (icon) icon.textContent = '⏳';
  if (title) title.textContent = 'Détection de ta connexion leboncoin…';
  if (msg) msg.textContent = '';
  if (actions) actions.hidden = true;
}

function showLoginOk(pseudo) {
  const banner = document.getElementById('login-banner');
  const dot = document.getElementById('login-dot');
  banner.hidden = true;
  dot.hidden = false;
  if (pseudo) dot.title = `Connecté · ${pseudo}`;
}

function showLoginKo() {
  const banner = document.getElementById('login-banner');
  const dot = document.getElementById('login-dot');
  const icon = document.getElementById('login-banner-icon');
  const title = document.getElementById('login-banner-title');
  const msg = document.getElementById('login-banner-msg');
  const actions = document.getElementById('login-banner-actions');
  const btn = document.getElementById('login-check-btn');
  banner.hidden = false;
  dot.hidden = true;
  if (icon) icon.textContent = '⚠️';
  if (title) title.textContent = 'Connexion leboncoin requise';
  if (msg) msg.textContent =
    'L\'extension a besoin d\'une session active sur leboncoin.fr. ' +
    'Si tu es déjà connecté, clique "Vérifier ma connexion" pour qu\'elle te détecte. ' +
    'Sinon, va sur leboncoin et connecte-toi, puis reviens ici.';
  if (actions) actions.hidden = false;
  if (btn) btn.disabled = false;
}

async function checkLogin() {
  await detectLogin({
    sendMessage: (msg) => chrome.runtime.sendMessage(msg),
    storageGet: (keys) => chrome.storage.local.get(keys),
    storageSet: (data) => chrome.storage.local.set(data),
    showDetecting: showLoginDetecting,
    showLoggedIn: showLoginOk,
    showNotLogged: showLoginKo,
    flags: loginFlags,
  });
}

// Bouton "Vérifier ma connexion" : force un refresh quel que soit le cooldown.
document.getElementById('login-check-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('login-check-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Vérification…';
  }
  // Bypass cooldown : reset le flag pour forcer la détection
  loginFlags.autoRefreshAttempted = false;
  await chrome.storage.local.set({ loginAutoRefreshAt: 0 });
  await checkLogin();
  // Re-arm le bouton si on est toujours KO (showLoginKo le remet à false)
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.log) renderLog(changes.log.newValue || []);
  if (changes.prospectScanProgress) {
    updateScanProgress(changes.prospectScanProgress.newValue || null);
  }
  if (changes.bumpProgress) {
    updateBumpProgress(changes.bumpProgress.newValue || null);
  }
  if (changes.lastBumpRun || changes.bumpHistory) {
    const lastRun = changes.lastBumpRun?.newValue || null;
    const bumpHistory = changes.bumpHistory?.newValue || [];
    if (lastRun) renderBumpStatus({ lastRun, nextRunAt: null, scheduled: false });
    renderBumpHistory(bumpHistory);
  }
  if (changes.prospectResultsByProfile
    || changes.prospectLastRunByProfile
    || changes.prospectSeenIdsByProfile
    || changes.prospectIgnoredIdsByProfile
    || changes.prospectContactedLocal
    || changes.prospectProfiles
    || changes.activeProfileId) {
    loadProspect();
  }
  if (changes.myListings || changes.settings) {
    loadBumper();
  }
  if (changes.inboxCache || changes.inboxLastRun || changes.inboxDismissed) {
    loadInbox();
  }
});

initBumper();
initInbox();
initProspect();

checkLogin();
loadBumper();
loadProspect();
loadInbox();

// Restore in-progress states if popup is opened mid-operation
chrome.storage.local.get(['prospectScanProgress', 'bumpProgress']).then(({ prospectScanProgress, bumpProgress }) => {
  if (prospectScanProgress) updateScanProgress(prospectScanProgress);
  if (bumpProgress) updateBumpProgress(bumpProgress);
});
