// ─── Fullpage mode (when opened in a regular tab) ──────────────────────────
const fullpage = new URLSearchParams(location.search).get('fullpage') === '1';
if (fullpage) document.body.classList.add('fullpage');

document.getElementById('open-in-tab').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?fullpage=1') });
  window.close();
});

// ─── Tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === target));
  });
});

// ─── Login state ───────────────────────────────────────────────────────────
async function checkLogin() {
  const warn = document.getElementById('login-banner');
  const ok = document.getElementById('login-ok-banner');
  const pseudoEl = document.getElementById('login-pseudo');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'CHECK_LOGIN' });
    if (r?.result?.loggedIn) {
      warn.hidden = true;
      ok.hidden = false;
      pseudoEl.textContent = r.result.pseudo ? `· ${r.result.pseudo}` : '';
    } else {
      warn.hidden = false;
      ok.hidden = true;
    }
  } catch {
    warn.hidden = false;
    ok.hidden = true;
  }
}

// ─── Bumper panel ──────────────────────────────────────────────────────────
const b = {
  enabled: document.getElementById('b-enabled'),
  dryRun: document.getElementById('b-dryRun'),
  dayOfWeek: document.getElementById('b-dayOfWeek'),
  hour: document.getElementById('b-hour'),
  minute: document.getElementById('b-minute'),
  jitterMinutes: document.getElementById('b-jitterMinutes'),
  runNow: document.getElementById('b-runNow'),
  clearLog: document.getElementById('b-clearLog'),
  log: document.getElementById('b-log'),
  listings: document.getElementById('b-listings'),
  refreshListings: document.getElementById('b-refresh-listings'),
  listingsHint: document.getElementById('b-listings-hint')
};

async function loadBumper() {
  const { settings = {}, log = [], myListings } = await chrome.storage.local.get(['settings', 'log', 'myListings']);
  b.enabled.checked = !!settings.enabled;
  b.dryRun.checked = settings.dryRun !== false;
  b.dayOfWeek.value = settings.dayOfWeek ?? 1;
  b.hour.value = settings.hour ?? 9;
  b.minute.value = settings.minute ?? 0;
  b.jitterMinutes.value = settings.jitterMinutes ?? 60;
  renderLog(log);
  renderListings(myListings, new Set(settings.onlyAdIds || []));
  updateActionHint();
}

function updateActionHint() {
  const hint = document.getElementById('b-action-hint');
  const runBtn = document.getElementById('b-runNow');
  if (b.dryRun.checked) {
    hint.innerHTML = '✓ <strong>Mode test actif</strong> : on simule, rien n\'est supprimé ni reposté.';
    hint.style.color = 'var(--green)';
    runBtn.textContent = '↻ Tester (mode simulation)';
  } else {
    hint.innerHTML = '⚠️ <strong>Mode réel</strong> : tes annonces seront supprimées puis republiées.';
    hint.style.color = 'var(--red)';
    runBtn.textContent = '↻ Republier maintenant';
  }
}

function renderLog(entries) {
  b.log.innerHTML = '';
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `<span class="ts">${e.ts.slice(11, 19)}</span>${escapeHtml(e.message)}`;
    b.log.appendChild(div);
  }
  b.log.scrollTop = b.log.scrollHeight;
}

function renderListings(stored, selectedIds) {
  b.listings.innerHTML = '';
  if (!stored?.listings?.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = stored?.fetchedAt
      ? 'Aucune annonce trouvée. Es-tu connecté à leboncoin ?'
      : 'Clique ⟳ Charger pour récupérer tes annonces.';
    b.listings.appendChild(empty);
    b.listingsHint.textContent = '';
    return;
  }
  const total = stored.listings.length;
  const selected = stored.listings.filter(l => selectedIds.has(l.id)).length;
  const when = stored.fetchedAt ? new Date(stored.fetchedAt) : null;
  const ago = when ? timeAgo(when) : '';
  b.listingsHint.innerHTML = selected === 0
    ? `${total} annonces · <em>aucune cochée = toutes seront bumpées</em>${ago ? ` · MAJ ${ago}` : ''}`
    : `<strong>${selected} / ${total}</strong> annonces sélectionnées${ago ? ` · MAJ ${ago}` : ''}`;

  const pausedCount = stored.listings.filter(l => /pause/i.test(l.status || '')).length;
  if (pausedCount === total) {
    const warn = document.createElement('div');
    warn.className = 'paused-banner';
    warn.innerHTML = `<strong>⏸ Toutes tes annonces sont en pause sur leboncoin.</strong><br>`
      + `Aucune ne peut être republiée tant qu'elles ne sont pas réactivées. `
      + `<a href="https://www.leboncoin.fr/compte/part/mes-annonces" target="_blank" rel="noopener">Réactiver sur leboncoin →</a>`;
    b.listings.appendChild(warn);
  }

  for (const it of stored.listings) {
    const isPaused = /pause/i.test(it.status || '');
    const row = document.createElement('label');
    row.className = 'listing'
      + (selectedIds.has(it.id) ? ' checked' : '')
      + (isPaused ? ' paused' : '');
    if (isPaused) row.title = "Cette annonce est en pause sur leboncoin — réactive-la avant qu'elle puisse être bumpée.";
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.has(it.id);
    cb.disabled = isPaused;
    cb.addEventListener('change', async () => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      const ids = new Set(settings.onlyAdIds || []);
      if (cb.checked) ids.add(it.id); else ids.delete(it.id);
      const next = { ...settings, onlyAdIds: [...ids] };
      await chrome.storage.local.set({ settings: next });
      await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
      row.classList.toggle('checked', cb.checked);
      renderListings(stored, ids);
    });
    row.appendChild(cb);
    if (it.thumbnail) {
      const img = document.createElement('img');
      img.src = it.thumbnail; img.alt = '';
      row.appendChild(img);
    }
    const body = document.createElement('div');
    body.className = 'listing-body';
    body.innerHTML = `
      <div class="listing-title" title="${escapeAttr(it.title)}">${escapeHtml(it.title || '(sans titre)')}</div>
      <div class="listing-meta">
        ${it.status ? `<span class="status-badge ${classifyStatus(it.status)}">${escapeHtml(it.status)}</span>` : ''}
        <span class="listing-id">${escapeHtml(it.id)}</span>
        ${it.catSlug ? `<span>· ${escapeHtml(it.catSlug)}</span>` : ''}
      </div>
    `;
    row.appendChild(body);
    b.listings.appendChild(row);
  }
}

function classifyStatus(s) {
  if (/en ligne/i.test(s)) return 'online';
  if (/v[ée]rification/i.test(s)) return 'pending';
  return '';
}

function timeAgo(date) {
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'à l\'instant';
  if (sec < 3600) return `il y a ${Math.round(sec/60)} min`;
  if (sec < 86400) return `il y a ${Math.round(sec/3600)} h`;
  return `il y a ${Math.round(sec/86400)} j`;
}

async function saveBumper() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const next = {
    ...settings,
    enabled: b.enabled.checked,
    dryRun: b.dryRun.checked,
    dayOfWeek: +b.dayOfWeek.value,
    hour: +b.hour.value,
    minute: +b.minute.value,
    jitterMinutes: +b.jitterMinutes.value
  };
  await chrome.storage.local.set({ settings: next });
  await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
}

[b.enabled, b.dryRun, b.dayOfWeek, b.hour, b.minute, b.jitterMinutes].forEach(el => {
  el.addEventListener('change', () => { saveBumper(); updateActionHint(); });
  el.addEventListener('blur', saveBumper);
});

b.runNow.addEventListener('click', async () => {
  if (!b.dryRun.checked) {
    const ok = confirm(
      "⚠️ Mode réel\n\n" +
      "Tes annonces vont être supprimées puis republiées sur leboncoin.\n" +
      "Cette action est irréversible (nouvel ID, perte de l'historique).\n\n" +
      "Continuer ?"
    );
    if (!ok) return;
  }
  b.runNow.disabled = true;
  b.runNow.innerHTML = '<span class="spinner-inline"></span>En cours…';
  try { await chrome.runtime.sendMessage({ type: 'RUN_NOW' }); }
  finally {
    b.runNow.disabled = false;
    updateActionHint();
    const { log = [] } = await chrome.storage.local.get('log');
    renderLog(log);
  }
});

b.clearLog.addEventListener('click', async () => {
  await chrome.storage.local.set({ log: [] });
  renderLog([]);
});

b.refreshListings.addEventListener('click', async () => {
  b.refreshListings.disabled = true;
  b.refreshListings.innerHTML = '<span class="spinner-inline"></span>';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'REFRESH_LISTINGS' });
    if (!r?.ok) {
      b.listingsHint.textContent = `Erreur : ${r?.error || 'inconnue'}`;
      return;
    }
    const { settings = {} } = await chrome.storage.local.get('settings');
    renderListings(r.result, new Set(settings.onlyAdIds || []));
  } finally {
    b.refreshListings.disabled = false;
    b.refreshListings.innerHTML = '⟳ Charger';
  }
});

// ─── Prospect panel ────────────────────────────────────────────────────────
import { DEFAULT_REPLY_TEMPLATE, formatReplyTemplate } from '../prospect.js';

const p = {
  enabled: document.getElementById('p-enabled'),
  dayOfWeek: document.getElementById('p-dayOfWeek'),
  hour: document.getElementById('p-hour'),
  minScore: document.getElementById('p-minScore'),
  maxAgeDays: document.getElementById('p-maxAgeDays'),
  keywords: document.getElementById('p-keywords'),
  notifyOnNew: document.getElementById('p-notifyOnNew'),
  notifyMinScore: document.getElementById('p-notifyMinScore'),
  replyTemplate: document.getElementById('p-replyTemplate'),
  scan: document.getElementById('p-scan'),
  markSeen: document.getElementById('p-mark-seen'),
  list: document.getElementById('p-list'),
  statNew: document.getElementById('p-stat-new'),
  statTotal: document.getElementById('p-stat-total'),
  lastRun: document.getElementById('p-last-run')
};

async function loadProspect() {
  const { prospectSettings = {}, prospectResults = [], prospectLastRun, prospectSeenIds = [] } =
    await chrome.storage.local.get(['prospectSettings', 'prospectResults', 'prospectLastRun', 'prospectSeenIds']);
  p.enabled.checked = !!prospectSettings.enabled;
  p.dayOfWeek.value = prospectSettings.dayOfWeek ?? 1;
  p.hour.value = prospectSettings.hour ?? 10;
  p.minScore.value = prospectSettings.minScore ?? 5;
  p.maxAgeDays.value = prospectSettings.maxAgeDays ?? 30;
  p.keywords.value = (prospectSettings.keywords || []).join('\n');
  p.notifyOnNew.checked = prospectSettings.notifyOnNew !== false;
  p.notifyMinScore.value = prospectSettings.notifyMinScore ?? 7;
  p.replyTemplate.value = prospectSettings.replyTemplate ?? DEFAULT_REPLY_TEMPLATE;
  renderProspects(prospectResults, prospectLastRun, new Set(prospectSeenIds));
}

function renderProspects(results, lastRun, seenSet) {
  const newCount = results.filter(r => !seenSet.has(r.list_id)).length;
  p.statNew.textContent = newCount;
  p.statTotal.textContent = results.length;
  if (lastRun?.ts) {
    const d = new Date(lastRun.ts);
    p.lastRun.textContent = `Dernier scan : ${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})} · ${lastRun.scanned || 0} mots-clés`;
  } else {
    p.lastRun.textContent = 'Jamais scanné';
  }

  p.list.innerHTML = '';
  for (const r of results) {
    const isNew = !seenSet.has(r.list_id);
    const card = document.createElement('div');
    card.className = 'card' + (isNew ? ' new' : ' seen');
    card.innerHTML = `
      <div class="card-top">
        <a class="card-title" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.subject)}</a>
        ${isNew ? '<span class="badge new">NOUV.</span>' : ''}
        <span class="badge score" title="Score de pertinence">★ ${r.score}</span>
      </div>
      <div class="card-meta">
        <span class="loc">${escapeHtml(r.location)}</span>
        <span class="age">${r.age_days}j</span>
        <span class="kw">${escapeHtml(r.kw_hit)}</span>
      </div>
      <div class="card-body">${escapeHtml((r.body || '').slice(0, 200))}</div>
      <div class="card-actions">
        <button class="btn ghost small contact-btn" data-id="${escapeAttr(r.list_id)}">✉ Contacter</button>
      </div>
    `;
    card.querySelector('.contact-btn').addEventListener('click', () => onContact(r));
    p.list.appendChild(card);
  }
}

async function onContact(prospect) {
  const { prospectSettings = {} } = await chrome.storage.local.get('prospectSettings');
  const template = prospectSettings.replyTemplate || DEFAULT_REPLY_TEMPLATE;
  const filled = formatReplyTemplate(template, prospect);
  try {
    await navigator.clipboard.writeText(filled);
    showToast('Template copié dans le presse-papier');
  } catch {
    showToast('Impossible de copier — vérifie les permissions du presse-papier');
  }
  if (prospect.url) chrome.tabs.create({ url: prospect.url });
}

let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

async function saveProspect() {
  const prospectSettings = {
    enabled: p.enabled.checked,
    dayOfWeek: +p.dayOfWeek.value,
    hour: +p.hour.value,
    minute: 0,
    minScore: +p.minScore.value,
    maxAgeDays: +p.maxAgeDays.value,
    keywords: p.keywords.value.split('\n').map(s => s.trim()).filter(Boolean),
    notifyOnNew: p.notifyOnNew.checked,
    notifyMinScore: +p.notifyMinScore.value,
    replyTemplate: p.replyTemplate.value
  };
  await chrome.storage.local.set({ prospectSettings });
  await chrome.runtime.sendMessage({ type: 'RESCHEDULE_PROSPECT' });
}
[p.enabled, p.dayOfWeek, p.hour, p.minScore, p.maxAgeDays, p.keywords, p.notifyOnNew, p.notifyMinScore, p.replyTemplate].forEach(el => {
  el.addEventListener('change', saveProspect);
  el.addEventListener('blur', saveProspect);
});

p.scan.addEventListener('click', async () => {
  p.scan.disabled = true;
  p.scan.innerHTML = '<span class="spinner-inline"></span>Scan…';
  try {
    await chrome.runtime.sendMessage({ type: 'RUN_PROSPECT_NOW' });
  } finally {
    p.scan.disabled = false;
    p.scan.textContent = 'Scanner maintenant';
    await loadProspect();
  }
});

p.markSeen.addEventListener('click', async () => {
  const { prospectResults = [] } = await chrome.storage.local.get('prospectResults');
  await chrome.runtime.sendMessage({ type: 'MARK_PROSPECTS_SEEN', results: prospectResults });
  await loadProspect();
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Live refresh
chrome.storage.onChanged.addListener((changes) => {
  if (changes.log) renderLog(changes.log.newValue || []);
  if (changes.prospectResults || changes.prospectLastRun || changes.prospectSeenIds) {
    loadProspect();
  }
  if (changes.myListings || changes.settings) {
    loadBumper();
  }
});

checkLogin();
loadBumper();
loadProspect();
