// MV3 popup auto-closes on blur. Any in-flight sendMessage / chrome.storage
// call rejects right as the document unloads. The SW handler has already
// persisted its result, so the popup didn't actually need the response.
const POPUP_GONE_RE = /message channel closed|Frame with ID|Extension context invalidated|Receiving end does not exist|back\/forward cache/i;
window.addEventListener('unhandledrejection', (e) => {
  const text = String(e.reason?.message ?? e.reason ?? '');
  if (POPUP_GONE_RE.test(text)) e.preventDefault();
}, true);

import { initBumper, loadBumper, renderBumpStatus, renderBumpHistory, updateBumpProgress, renderLog } from './bumper.js';
import { initInbox, loadInbox, renderInbox } from './inbox.js';
import { initProspect, loadProspect, updateScanProgress } from './prospect-ui.js';

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

async function checkLogin() {
  const warn = document.getElementById('login-banner');
  const dot = document.getElementById('login-dot');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'CHECK_LOGIN' });
    const ok = !!r?.result?.loggedIn;
    warn.hidden = ok;
    dot.hidden = !ok;
    if (ok && r.result.pseudo) dot.title = `Connecté · ${r.result.pseudo}`;
  } catch {
    warn.hidden = false;
    dot.hidden = true;
  }
}

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
