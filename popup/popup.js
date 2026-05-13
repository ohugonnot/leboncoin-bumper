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
  // Global settings (apply to all profiles)
  enabled: document.getElementById('p-enabled'),
  frequency: document.getElementById('p-frequency'),
  dayOfWeek: document.getElementById('p-dayOfWeek'),
  hour: document.getElementById('p-hour'),
  notifyOnNew: document.getElementById('p-notifyOnNew'),
  notifyMinScore: document.getElementById('p-notifyMinScore'),
  // Per-profile settings
  minScore: document.getElementById('p-minScore'),
  maxAgeDays: document.getElementById('p-maxAgeDays'),
  adType: document.getElementById('p-adType'),
  priceMin: document.getElementById('p-priceMin'),
  priceMax: document.getElementById('p-priceMax'),
  departments: document.getElementById('p-departments'),
  sortBy: document.getElementById('p-sortBy'),
  ownerType: document.getElementById('p-ownerType'),
  shippableOnly: document.getElementById('p-shippableOnly'),
  keywords: document.getElementById('p-keywords'),
  replyTemplate: document.getElementById('p-replyTemplate'),
  // Profile picker
  profileSelect: document.getElementById('p-profile-select'),
  profileAdd: document.getElementById('p-profile-add'),
  profileRename: document.getElementById('p-profile-rename'),
  profileDelete: document.getElementById('p-profile-delete'),
  // Actions + render targets
  scan: document.getElementById('p-scan'),
  markSeen: document.getElementById('p-mark-seen'),
  list: document.getElementById('p-list'),
  statNew: document.getElementById('p-stat-new'),
  statTotal: document.getElementById('p-stat-total'),
  lastRun: document.getElementById('p-last-run')
};

async function loadProspect() {
  const s = await chrome.storage.local.get([
    'prospectProfiles', 'activeProfileId', 'prospectGlobalSettings',
    'prospectResultsByProfile', 'prospectLastRunByProfile',
    'prospectSeenIdsByProfile', 'prospectIgnoredIdsByProfile',
    'prospectContactedLocal'
  ]);
  const profiles = s.prospectProfiles || [];
  if (!profiles.length) return;  // migration not run yet
  const activeId = s.activeProfileId || profiles[0].id;
  const profile = profiles.find(x => x.id === activeId) || profiles[0];
  const global = s.prospectGlobalSettings || {};

  // Profile dropdown
  p.profileSelect.innerHTML = profiles.map(pr =>
    `<option value="${escapeAttr(pr.id)}" ${pr.id === profile.id ? 'selected' : ''}>${escapeHtml(pr.name)}</option>`
  ).join('');
  p.profileDelete.disabled = profiles.length <= 1;

  // Global settings
  p.enabled.checked = !!global.enabled;
  p.frequency.value = global.frequency || 'week';
  p.dayOfWeek.value = global.dayOfWeek ?? 1;
  p.hour.value = global.hour ?? 10;
  p.notifyOnNew.checked = global.notifyOnNew !== false;
  p.notifyMinScore.value = global.notifyMinScore ?? 7;
  updateFrequencyVisibility();

  // Per-profile settings
  p.minScore.value = profile.minScore ?? 5;
  p.maxAgeDays.value = profile.maxAgeDays ?? 30;
  p.adType.value = profile.adType || 'demand';
  p.priceMin.value = profile.priceMin ?? '';
  p.priceMax.value = profile.priceMax ?? '';
  p.departments.value = (profile.departments || []).join(', ');
  p.sortBy.value = `${profile.sortBy || 'time'}-${profile.sortOrder || 'desc'}`;
  p.ownerType.value = profile.ownerType || 'all';
  p.shippableOnly.checked = !!profile.shippableOnly;
  p.keywords.value = (profile.keywords || []).join('\n');
  p.replyTemplate.value = profile.replyTemplate || DEFAULT_REPLY_TEMPLATE;

  // Render results for active profile, applying local "contacted" overlay
  const rawResults = s.prospectResultsByProfile?.[profile.id] || [];
  const localContacted = new Set(s.prospectContactedLocal || []);
  const results = localContacted.size
    ? rawResults.map(r => localContacted.has(r.list_id) ? { ...r, already_contacted: true } : r)
    : rawResults;
  const lastRun = s.prospectLastRunByProfile?.[profile.id] || null;
  const seen = new Set(s.prospectSeenIdsByProfile?.[profile.id] || []);
  const ignored = new Set(s.prospectIgnoredIdsByProfile?.[profile.id] || []);
  renderProspects(results, lastRun, seen, ignored);
}

function renderProspects(results, lastRun, seenSet, ignoredSet = new Set()) {
  const visible = results.filter(r => !ignoredSet.has(r.list_id));
  const newCount = visible.filter(r => !seenSet.has(r.list_id)).length;
  p.statNew.textContent = newCount;
  p.statTotal.textContent = visible.length;
  // Hint visibility : show different messages depending on state
  const hint = document.getElementById('p-empty-hint');
  if (hint) {
    if (results.length > 0) {
      hint.hidden = true;
    } else if (lastRun?.ts) {
      // We scanned but got 0 results — give actionable advice
      hint.hidden = false;
      hint.innerHTML = `<strong>0 prospect trouvé sur ${lastRun.scanned} mot-clé${lastRun.scanned > 1 ? 's' : ''}.</strong><br>`
        + `Probable : les mots-clés sont ultra-niches (peu de "demandes" sur leboncoin), trop spécifiques, ou tes annonces sont trop vieilles. `
        + `Élargis les mots-clés, augmente <em>Âge max</em>, ou baisse <em>Score min</em>.`;
    } else {
      hint.hidden = false;
      hint.innerHTML = `Le scan interroge l'API leboncoin sur tes mots-clés (par défaut&nbsp;: profils dev/web/IA/automatisation). Premier scan : ~30 à 60 secondes.`;
    }
  }
  if (lastRun?.ts) {
    const d = new Date(lastRun.ts);
    p.lastRun.textContent = `Dernier scan : ${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})} · ${lastRun.scanned || 0} mots-clés`;
  } else {
    p.lastRun.textContent = 'Jamais scanné';
  }

  p.list.innerHTML = '';
  for (const r of visible) {
    const isNew = !seenSet.has(r.list_id);
    const card = document.createElement('div');
    card.className = 'card' + (isNew ? ' new' : ' seen');
    card.innerHTML = `
      <div class="card-top">
        <a class="card-title" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.subject)}</a>
        ${isNew ? '<span class="badge new">NOUV.</span>' : ''}
        ${r.already_contacted ? '<span class="badge contacted" title="Tu as déjà une conversation avec cette annonce">✉ DÉJÀ</span>' : ''}
        <span class="badge score" title="${escapeAttr(r.score_breakdown ? r.score_breakdown.join('\n') : 'Score de pertinence')}">★ ${r.score}</span>
      </div>
      <div class="card-meta">
        <span class="loc">${escapeHtml(r.location)}</span>
        <span class="age">${r.age_days}j</span>
        ${r.price ? `<span class="price">${r.price} €</span>` : ''}
        <span class="kw">${escapeHtml(r.kw_hit)}</span>
      </div>
      <div class="card-body">${escapeHtml((r.body || '').slice(0, 400))}</div>
      <div class="card-actions">
        <button class="btn ghost small ignore-btn" data-id="${escapeAttr(r.list_id)}" title="Masquer définitivement (ne reviendra pas dans les prochains scans)">✗ Ignorer</button>
        <button class="btn ghost small contact-btn" data-id="${escapeAttr(r.list_id)}" ${r.already_contacted ? 'title="Tu as déjà contacté — ouvre /reply pour relancer"' : ''}>✉ ${r.already_contacted ? 'Relancer' : 'Contacter'}</button>
      </div>
    `;
    card.querySelector('.contact-btn').addEventListener('click', () => onContact(r));
    card.querySelector('.ignore-btn').addEventListener('click', () => onIgnore(r));
    p.list.appendChild(card);
  }

  // Footer : count of ignored, with restore action
  const ignoredCount = results.length - visible.length;
  if (ignoredCount > 0) {
    const footer = document.createElement('div');
    footer.className = 'ignored-footer';
    footer.innerHTML = `<span class="muted">${ignoredCount} masqué${ignoredCount > 1 ? 's' : ''}</span> <button class="btn ghost small" id="p-restore-ignored">Restaurer tout</button>`;
    p.list.appendChild(footer);
    footer.querySelector('#p-restore-ignored').addEventListener('click', onRestoreIgnored);
  }
}

async function onIgnore(prospect) {
  const { prospectIgnoredIdsByProfile = {}, activeProfileId } = await chrome.storage.local.get(['prospectIgnoredIdsByProfile', 'activeProfileId']);
  const next = new Set(prospectIgnoredIdsByProfile[activeProfileId] || []);
  next.add(prospect.list_id);
  await chrome.storage.local.set({
    prospectIgnoredIdsByProfile: {
      ...prospectIgnoredIdsByProfile,
      [activeProfileId]: [...next].slice(-5000)
    }
  });
  await loadProspect();
}

async function onRestoreIgnored() {
  const { prospectIgnoredIdsByProfile = {}, activeProfileId } = await chrome.storage.local.get(['prospectIgnoredIdsByProfile', 'activeProfileId']);
  await chrome.storage.local.set({
    prospectIgnoredIdsByProfile: { ...prospectIgnoredIdsByProfile, [activeProfileId]: [] }
  });
  await loadProspect();
}

async function onContact(prospect) {
  const { prospectProfiles = [], activeProfileId, prospectContactedLocal = [] } =
    await chrome.storage.local.get(['prospectProfiles', 'activeProfileId', 'prospectContactedLocal']);
  const profile = prospectProfiles.find(x => x.id === activeProfileId) || prospectProfiles[0];
  const template = profile?.replyTemplate || DEFAULT_REPLY_TEMPLATE;
  const filled = formatReplyTemplate(template, prospect);
  await chrome.runtime.sendMessage({
    type: 'OPEN_REPLY_FORM',
    listId: prospect.list_id,
    message: filled
  });
  // Memorize locally so the prospect stays tagged "déjà contacté" even if
  // the leboncoin conversation gets deleted on their side. Shared across
  // profiles : a contact is a contact regardless of which veille surfaced it.
  const nextSet = new Set(prospectContactedLocal);
  nextSet.add(prospect.list_id);
  await chrome.storage.local.set({ prospectContactedLocal: [...nextSet].slice(-5000) });
  showToast('Form ouvert + marqué comme contacté');
  await loadProspect();
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

function updateFrequencyVisibility() {
  const freq = p.frequency.value;
  document.querySelectorAll('[data-show-when]').forEach(el => {
    const allowed = el.dataset.showWhen.split(',');
    el.hidden = !allowed.includes(freq);
  });
}

async function saveProspect() {
  const { prospectProfiles = [], activeProfileId } = await chrome.storage.local.get(['prospectProfiles', 'activeProfileId']);
  // Parse "time-desc" → sortBy=time, sortOrder=desc
  const [sortBy, sortOrder] = (p.sortBy.value || 'time-desc').split('-');
  const departments = p.departments.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  const priceMin = p.priceMin.value === '' ? null : Math.max(0, +p.priceMin.value);
  const priceMax = p.priceMax.value === '' ? null : Math.max(0, +p.priceMax.value);

  const nextProfiles = prospectProfiles.map(pr => pr.id === activeProfileId ? {
    ...pr,
    keywords: p.keywords.value.split('\n').map(s => s.trim()).filter(Boolean),
    minScore: +p.minScore.value,
    maxAgeDays: +p.maxAgeDays.value,
    adType: p.adType.value,
    priceMin, priceMax, departments, sortBy, sortOrder,
    ownerType: p.ownerType.value,
    shippableOnly: p.shippableOnly.checked,
    replyTemplate: p.replyTemplate.value
  } : pr);
  const prospectGlobalSettings = {
    enabled: p.enabled.checked,
    frequency: p.frequency.value,
    dayOfWeek: +p.dayOfWeek.value,
    hour: +p.hour.value,
    minute: 0,
    notifyOnNew: p.notifyOnNew.checked,
    notifyMinScore: +p.notifyMinScore.value
  };
  await chrome.storage.local.set({
    prospectProfiles: nextProfiles,
    prospectGlobalSettings
  });
  updateFrequencyVisibility();
  await chrome.runtime.sendMessage({ type: 'RESCHEDULE_PROSPECT' });
}
[p.enabled, p.frequency, p.dayOfWeek, p.hour, p.minScore, p.maxAgeDays, p.adType, p.priceMin, p.priceMax, p.departments, p.sortBy, p.ownerType, p.shippableOnly, p.keywords, p.notifyOnNew, p.notifyMinScore, p.replyTemplate].forEach(el => {
  el.addEventListener('change', saveProspect);
  el.addEventListener('blur', saveProspect);
});

// Profile picker actions
p.profileSelect.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'PROFILE_SET_ACTIVE', id: p.profileSelect.value });
  await loadProspect();
});
p.profileAdd.addEventListener('click', async () => {
  const name = prompt('Nom de la nouvelle veille :', 'Nouvelle veille');
  if (!name) return;
  await chrome.runtime.sendMessage({ type: 'PROFILE_CREATE', name });
  await loadProspect();
});
p.profileRename.addEventListener('click', async () => {
  const { prospectProfiles = [], activeProfileId } = await chrome.storage.local.get(['prospectProfiles', 'activeProfileId']);
  const cur = prospectProfiles.find(pr => pr.id === activeProfileId);
  if (!cur) return;
  const name = prompt('Nouveau nom :', cur.name);
  if (!name || name === cur.name) return;
  await chrome.runtime.sendMessage({ type: 'PROFILE_RENAME', id: activeProfileId, name });
  await loadProspect();
});
p.profileDelete.addEventListener('click', async () => {
  const { prospectProfiles = [], activeProfileId } = await chrome.storage.local.get(['prospectProfiles', 'activeProfileId']);
  if (prospectProfiles.length <= 1) return showToast('Impossible : il faut au moins une veille');
  const cur = prospectProfiles.find(pr => pr.id === activeProfileId);
  if (!confirm(`Supprimer la veille "${cur?.name}" et tous ses résultats ?`)) return;
  await chrome.runtime.sendMessage({ type: 'PROFILE_DELETE', id: activeProfileId });
  await loadProspect();
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
  const { prospectResultsByProfile = {}, activeProfileId } = await chrome.storage.local.get(['prospectResultsByProfile', 'activeProfileId']);
  const results = prospectResultsByProfile[activeProfileId] || [];
  await chrome.runtime.sendMessage({ type: 'MARK_PROSPECTS_SEEN', results });
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
