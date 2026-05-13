import { escapeHtml, escapeAttr, timeAgo } from './util.js';
import { nextPeakSlotForBatch, planningPeakCoverage } from '../smart-bump.js';
import { serializeBackup, deserializeBackup, diffBackup, fetchAndEncodePhotos } from '../backup.js';

const b = {
  enabled: document.getElementById('b-enabled'),
  dryRun: document.getElementById('b-dryRun'),
  dayOfWeek: document.getElementById('b-dayOfWeek'),
  hour: document.getElementById('b-hour'),
  minute: document.getElementById('b-minute'),
  jitterMinutes: document.getElementById('b-jitterMinutes'),
  runNow: document.getElementById('b-runNow'),
  smartBump: document.getElementById('b-smartBump'),
  smartBumpConfirm: document.getElementById('b-smart-bump-confirm'),
  clearLog: document.getElementById('b-clearLog'),
  log: document.getElementById('b-log'),
  listings: document.getElementById('b-listings'),
  refreshListings: document.getElementById('b-refresh-listings'),
  selectionHint: document.getElementById('b-selection-hint'),
  selectAll: document.getElementById('b-select-all'),
  selectNone: document.getElementById('b-select-none'),
  bumpProgress: document.getElementById('b-bump-progress'),
  metaLast: document.getElementById('b-meta-last'),
  metaNext: document.getElementById('b-meta-next'),
  metaPeak: document.getElementById('b-meta-peak'),
  peakCoverage: document.getElementById('b-peak-coverage'),
  historyList: document.getElementById('b-history-list'),
  backupExport: document.getElementById('b-backup-export'),
  backupImport: document.getElementById('b-backup-import'),
  backupImportFile: document.getElementById('b-backup-import-file'),
  backupIncludePhotos: document.getElementById('b-backup-include-photos'),
  backupStatus: document.getElementById('b-backup-status')
};

// Cached reference to stored listings — needed for select-all / select-none
let _currentStoredListings = null;
let _currentListingEdits = {};

export async function loadBumper() {
  const { settings = {}, log = [], myListings, lastBumpRun, bumpHistory = [], listingEdits = {} } =
    await chrome.storage.local.get(['settings', 'log', 'myListings', 'lastBumpRun', 'bumpHistory', 'listingEdits']);
  b.enabled.checked = !!settings.enabled;
  b.dryRun.checked = settings.dryRun !== false;
  b.dayOfWeek.value = settings.dayOfWeek ?? 1;
  b.hour.value = settings.hour ?? 9;
  b.minute.value = settings.minute ?? 0;
  b.jitterMinutes.value = settings.jitterMinutes ?? 60;
  renderLog(log);
  renderListings(myListings, new Set(settings.onlyAdIds || []), listingEdits);
  updateActionHint();
  renderBumpHistory(bumpHistory);
  renderPeakMeta(myListings, settings);
  renderPeakCoverage(bumpHistory, myListings, settings);

  // Prefer SW status (has alarm info); fall back to local storage if SW not ready.
  let statusRendered = false;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'GET_BUMP_STATUS' });
    if (r?.ok) { renderBumpStatus(r.result); statusRendered = true; }
  } catch { /* SW not ready */ }
  if (!statusRendered) renderBumpStatus({ lastRun: lastBumpRun || null, nextRunAt: null, scheduled: false });
}

function updateActionHint() {
  const hint = document.getElementById('b-action-hint');
  const runBtn = b.runNow;
  if (b.dryRun.checked) {
    hint.innerHTML = '✓ <strong>Mode test actif</strong> : on simule, rien n\'est supprimé ni reposté.';
    hint.style.color = 'var(--green)';
    runBtn.textContent = '↻ Tester (rien ne sera touché)';
    runBtn.classList.remove('danger');
  } else {
    hint.innerHTML = '⚠️ <strong>Mode réel</strong> : les annonces cochées seront supprimées puis recréées sur Leboncoin.';
    hint.style.color = 'var(--red)';
    runBtn.textContent = '🚨 Republier en RÉEL';
    runBtn.classList.add('danger');
  }
}

function updateSelectionHint(stored, selectedIds) {
  if (!stored?.listings?.length) {
    b.selectionHint.textContent = '';
    return;
  }
  const total = stored.listings.length;
  const pausedCount = stored.listings.filter(l => /pause/i.test(l.status || '')).length;
  const pausedSuffix = pausedCount ? ` (${pausedCount} en pause, ignorée${pausedCount > 1 ? 's' : ''})` : '';
  const checked = stored.listings.filter(l => selectedIds.has(l.id)).length;
  if (checked === 0) {
    b.selectionHint.textContent = `0 cochée → Toutes les annonces seront republiées (${total} au total${pausedSuffix})`;
  } else {
    b.selectionHint.textContent = `${checked} / ${total} annonces sélectionnées${pausedSuffix}`;
  }
}

export function renderBumpStatus({ lastRun, nextRunAt, scheduled }) {
  if (lastRun?.ts) {
    const ago = timeAgo(new Date(lastRun.ts));
    const parts = [];
    if (lastRun.success != null) parts.push(`${lastRun.success} réussi${lastRun.success > 1 ? 's' : ''}`);
    if (lastRun.failed != null && lastRun.failed > 0) parts.push(`${lastRun.failed} échec${lastRun.failed > 1 ? 's' : ''}`);
    const detail = parts.length ? ` (${parts.join(', ')})` : '';
    b.metaLast.textContent = `🕒 Dernier : ${ago}${detail}`;
  } else {
    b.metaLast.innerHTML = '🕒 Jamais lancé';
  }

  if (nextRunAt) {
    const d = new Date(nextRunAt);
    const label = d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    b.metaNext.textContent = `⏰ Prochain : ${label}`;
  } else if (scheduled) {
    b.metaNext.textContent = '⏰ Planning actif — prochain calcul au démarrage';
  } else {
    b.metaNext.textContent = '⏰ Aucun planning';
  }
}

function categoriesFromListings(stored, selectedIds) {
  if (!stored?.listings?.length) return [];
  const active = selectedIds?.size
    ? stored.listings.filter(l => selectedIds.has(l.id))
    : stored.listings;
  return active.map(l => l.catSlug).filter(Boolean);
}

function renderPeakMeta(stored, settings) {
  if (!b.metaPeak) return;
  const cats = categoriesFromListings(stored, new Set(settings?.onlyAdIds || []));
  if (!cats.length) { b.metaPeak.hidden = true; return; }
  const slot = nextPeakSlotForBatch(cats, new Date());
  const label = slot.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  b.metaPeak.textContent = `🤖 Prochain pic optimal : ${label}`;
  b.metaPeak.hidden = false;
}

function renderPeakCoverage(history, stored, settings) {
  if (!b.peakCoverage) return;
  if (!history?.length) { b.peakCoverage.hidden = true; return; }
  const cats = categoriesFromListings(stored, new Set(settings?.onlyAdIds || []));
  const plannedAt = history.map(e => new Date(e.ts));
  const coverage = planningPeakCoverage(plannedAt, cats);
  const pct = Math.round(coverage * 100);
  const tip = pct < 50
    ? ` — 💡 Active Smart Bump pour viser 100%`
    : '';
  b.peakCoverage.textContent = `Ton planning actuel couvre ${pct}% des pics${tip}`;
  b.peakCoverage.hidden = false;
}

export function renderBumpHistory(history) {
  if (!b.historyList) return;
  if (!history?.length) {
    b.historyList.innerHTML = '<div class="bump-history-empty">Aucun cycle enregistré.</div>';
    return;
  }
  const rows = history.slice(0, 5).map(entry => {
    const d = new Date(entry.ts);
    const label = d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const ok = (entry.failed || 0) === 0;
    const icon = ok ? '✅' : '❌';
    const parts = [];
    if (entry.success != null) parts.push(`${entry.success} réussi${entry.success > 1 ? 's' : ''}`);
    if (entry.failed) parts.push(`${entry.failed} échec${entry.failed > 1 ? 's' : ''}`);
    const detail = parts.join(' · ');
    return `<div class="bump-history-entry">${icon} ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
  });
  b.historyList.innerHTML = `<div class="bump-history-list">${rows.join('')}</div>`;
}

export function updateBumpProgress(progress) {
  if (!b.bumpProgress) return;
  if (!progress) {
    b.bumpProgress.hidden = true;
    return;
  }
  const { adIndex, adTotal, adTitle, phase } = progress;
  const pct = adTotal > 0 ? Math.round(adIndex / adTotal * 100) : 0;
  const phaseLabel = { scrape: 'scrape', delete: 'suppression', repost: 'republication', done: 'terminé' }[phase] || '…';
  b.bumpProgress.hidden = false;
  b.bumpProgress.innerHTML = `
    <div class="scan-progress-label">Republication en cours… annonce ${adIndex}/${adTotal} (${escapeHtml(adTitle || '')}) — ${phaseLabel}</div>
    <div class="scan-progress-track"><div class="scan-progress-fill" style="width:${pct}%"></div></div>
  `;
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

export { renderLog };

function formatStat(n) {
  return n > 999 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n);
}

function renderStatsHtml(stats) {
  if (stats === undefined) return '';
  const { views = 0, favorites = 0, messages = 0, leads = 0, phones = 0, replies = 0 } = stats;
  const contacts = messages + leads + phones + replies;
  if (views === 0 && favorites === 0 && contacts === 0) {
    return `<div class="listing-stats"><span class="stat-empty">📊 Pas encore de stats</span></div>`;
  }
  return `<div class="listing-stats" title="Stats Leboncoin sur cette annonce">`
    + `<span class="stat-views">👁 ${formatStat(views)} vues</span>`
    + `<span class="stat-favs">⭐ ${formatStat(favorites)} favoris</span>`
    + `<span class="stat-msgs">✉ ${formatStat(contacts)} contacts</span>`
    + `</div>`;
}

function classifyStatus(s) {
  if (/en ligne/i.test(s)) return 'online';
  if (/v[ée]rification/i.test(s)) return 'pending';
  return '';
}

function renderListings(stored, selectedIds, listingEdits = {}) {
  _currentStoredListings = stored;
  _currentListingEdits = listingEdits;
  b.listings.innerHTML = '';
  if (!stored?.listings?.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = stored?.fetchedAt
      ? 'Aucune annonce trouvée. Es-tu connecté à leboncoin ?'
      : 'Clique ⟳ Charger mes annonces pour récupérer tes annonces.';
    b.listings.appendChild(empty);
    updateSelectionHint(stored, selectedIds);
    return;
  }

  updateSelectionHint(stored, selectedIds);

  const pausedCount = stored.listings.filter(l => /pause/i.test(l.status || '')).length;
  if (pausedCount === stored.listings.length) {
    const warn = document.createElement('div');
    warn.className = 'paused-banner';
    warn.innerHTML = `<strong>⏸ Toutes tes annonces sont en pause sur leboncoin.</strong><br>`
      + `Aucune ne peut être republiée tant qu'elles ne sont pas réactivées. `
      + `<a href="https://www.leboncoin.fr/compte/part/mes-annonces" target="_blank" rel="noopener">Réactiver sur leboncoin →</a>`;
    b.listings.appendChild(warn);
  }

  for (const it of stored.listings) {
    const isPaused = /pause/i.test(it.status || '');
    const hasEdit = !!(listingEdits[it.id] && Object.values(listingEdits[it.id]).some(Boolean));
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
      updateSelectionHint(stored, ids);
    });
    row.appendChild(cb);
    if (it.thumbnail) {
      const img = document.createElement('img');
      img.src = it.thumbnail; img.alt = '';
      row.appendChild(img);
    }
    const body = document.createElement('div');
    body.className = 'listing-body';
    const ageHtml = it.publishedAt
      ? `<span class="listing-age">${timeAgo(new Date(it.publishedAt))}</span>`
      : '';
    const editBadgeHtml = hasEdit
      ? `<span class="listing-edit-badge">✏️ Modifié</span>`
      : '';
    body.innerHTML = `
      <div class="listing-title" title="${escapeAttr(it.title)}">${escapeHtml(it.title || '(sans titre)')}</div>
      ${ageHtml}
      <div class="listing-meta">
        ${it.status ? `<span class="status-badge ${classifyStatus(it.status)}">${escapeHtml(it.status)}</span>` : ''}
        <span class="listing-id">${escapeHtml(it.id)}</span>
        ${it.catSlug ? `<span>· ${escapeHtml(it.catSlug)}</span>` : ''}
        ${editBadgeHtml}
      </div>
      ${renderStatsHtml(it.stats)}
    `;
    row.appendChild(body);

    const dupBtn = document.createElement('button');
    dupBtn.className = 'listing-duplicate';
    dupBtn.textContent = '📋 Dupliquer';
    dupBtn.title = 'Copie titre + prix + description dans le presse-papier et ouvre le formulaire de dépôt leboncoin.';
    dupBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleDuplicate(it);
    });
    row.appendChild(dupBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'listing-edit-btn';
    editBtn.textContent = '✏️ Éditer';
    editBtn.title = 'Modifier titre, description ou prix avant le prochain repost (sans payer leboncoin).';
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleEditForm(it, row, listingEdits);
    });
    row.appendChild(editBtn);

    b.listings.appendChild(row);
  }
}

// Toggle the inline edit form on a listing row.
// Each row can have at most one open form — clicking the button again collapses it.
function toggleEditForm(listing, row, listingEdits) {
  const existing = row.querySelector('.listing-edit-form');
  if (existing) {
    existing.remove();
    return;
  }

  const edit = listingEdits[listing.id] || {};
  const form = document.createElement('div');
  form.className = 'listing-edit-form';
  form.innerHTML = `
    <div class="field">
      <label>Titre</label>
      <input type="text" class="edit-subject" value="${escapeAttr(edit.subject || '')}" placeholder="${escapeAttr(listing.title || '')}">
      <span class="listing-edit-hint">Laisser vide pour conserver la valeur actuelle de l'annonce</span>
    </div>
    <div class="field">
      <label>Description</label>
      <textarea class="edit-body" rows="3">${escapeHtml(edit.body || '')}</textarea>
      <span class="listing-edit-hint">Laisser vide pour conserver la valeur actuelle de l'annonce</span>
    </div>
    <div class="field">
      <label>Prix (€)</label>
      <input type="number" class="edit-price" value="${escapeAttr(edit.price || '')}" min="0" placeholder="—">
      <span class="listing-edit-hint">Laisser vide pour conserver la valeur actuelle de l'annonce</span>
    </div>
    <div class="listing-edit-actions">
      <button class="btn primary small edit-save-btn">Enregistrer</button>
      <button class="btn ghost small edit-reset-btn">Réinitialiser</button>
    </div>
  `;

  // Prevent checkbox toggle when interacting with the form
  form.addEventListener('click', (e) => e.preventDefault());

  form.querySelector('.edit-save-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    const subject = form.querySelector('.edit-subject').value.trim();
    const body = form.querySelector('.edit-body').value.trim();
    const price = form.querySelector('.edit-price').value.trim();

    const { listingEdits: stored = {} } = await chrome.storage.local.get('listingEdits');
    const next = { ...stored };
    const patch = {};
    if (subject) patch.subject = subject;
    if (body) patch.body = body;
    if (price) patch.price = price;

    if (Object.keys(patch).length) {
      next[listing.id] = patch;
    } else {
      delete next[listing.id];
    }
    await chrome.storage.local.set({ listingEdits: next });
    _currentListingEdits = next;

    // Re-render to show/hide badge
    const { settings = {} } = await chrome.storage.local.get('settings');
    renderListings(_currentStoredListings, new Set(settings.onlyAdIds || []), next);
  });

  form.querySelector('.edit-reset-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    const { listingEdits: stored = {} } = await chrome.storage.local.get('listingEdits');
    const next = { ...stored };
    delete next[listing.id];
    await chrome.storage.local.set({ listingEdits: next });
    _currentListingEdits = next;

    const { settings = {} } = await chrome.storage.local.get('settings');
    renderListings(_currentStoredListings, new Set(settings.onlyAdIds || []), next);
  });

  row.appendChild(form);
}

function showBackupStatus(msg, isError = false) {
  b.backupStatus.textContent = msg;
  b.backupStatus.style.color = isError ? 'var(--red)' : 'var(--green)';
  if (msg) setTimeout(() => { b.backupStatus.textContent = ''; }, 6000);
}

async function handleBackupExport() {
  const { myListings } = await chrome.storage.local.get('myListings');
  const listings = myListings?.listings || [];
  if (!listings.length) {
    showBackupStatus('Aucune annonce chargée — clique ⟳ d\'abord.', true);
    return;
  }

  const includePhotos = b.backupIncludePhotos?.checked || false;
  let finalListings = listings;
  let photoSummary = '(URLs)';

  if (includePhotos) {
    const total = listings.reduce((n, l) => n + (l.photos?.length || 0) + (l.thumbnail ? 1 : 0), 0);
    showBackupStatus(`⏳ Téléchargement des photos…`);
    b.backupStatus.style.color = 'var(--ink-soft)';

    let lastStatusAt = 0;
    const result = await fetchAndEncodePhotos(listings, fetch, ({ done, total: t }) => {
      const now = Date.now();
      // Throttle DOM updates to ~4/s to avoid jank on large sets.
      if (now - lastStatusAt > 250) {
        showBackupStatus(`Photo ${done} / ${t}…`);
        b.backupStatus.style.color = 'var(--ink-soft)';
        lastStatusAt = now;
      }
    });

    finalListings = result.listings;
    photoSummary = `${result.encoded} photo${result.encoded !== 1 ? 's' : ''} incluse${result.encoded !== 1 ? 's' : ''}`;
  }

  const { filename, json, count } = serializeBackup(finalListings, myListings?.pseudo || undefined);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  if (includePhotos) {
    showBackupStatus(`✓ Sauvegardé : ${count} annonce${count > 1 ? 's' : ''}, ${photoSummary}`);
  } else {
    showBackupStatus(`✓ Sauvegardé : ${count} annonce${count > 1 ? 's' : ''} (URLs)`);
  }
}

async function handleBackupImportFile(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    showBackupStatus('Impossible de lire le fichier.', true);
    return;
  }
  const result = deserializeBackup(text);
  if (!result.ok) {
    showBackupStatus(`Erreur : ${result.error}`, true);
    return;
  }
  const { myListings } = await chrome.storage.local.get('myListings');
  const current = myListings?.listings || [];
  const { missing } = diffBackup(current, result.listings);

  if (missing.length === 0) {
    showBackupStatus(`Toutes les ${result.listings.length} annonces sont déjà présentes.`);
    return;
  }

  const ok = confirm(
    `📥 Restauration\n\n` +
    `${result.listings.length} annonce(s) dans le backup.\n` +
    `${missing.length} manquante(s) dans tes annonces actuelles.\n\n` +
    `Republier les ${missing.length} annonce(s) manquante(s) maintenant ?\n` +
    `(Elles seront créées comme nouvelles annonces sur leboncoin.)`
  );
  if (!ok) return;

  // Déclenche un cycle de repost uniquement sur les IDs manquants.
  // On écrit temporairement onlyAdIds avec les IDs manquants, lance le cycle,
  // puis restaure les settings précédents.
  const { settings = {} } = await chrome.storage.local.get('settings');
  const prevOnlyAdIds = settings.onlyAdIds || [];
  const missingIds = missing.map(l => l.id).filter(Boolean);

  await chrome.storage.local.set({
    settings: { ...settings, onlyAdIds: missingIds, dryRun: false }
  });

  showBackupStatus(`⏳ Republication de ${missingIds.length} annonce(s)…`);
  b.backupStatus.style.color = 'var(--ink-soft)';

  try {
    const r = await chrome.runtime.sendMessage({ type: 'RUN_NOW' });
    if (r?.ok) {
      showBackupStatus(`✓ Cycle lancé pour ${missingIds.length} annonce(s).`);
    } else {
      showBackupStatus(`Erreur cycle : ${r?.error || 'inconnue'}`, true);
    }
  } catch {
    showBackupStatus('Erreur lors du lancement du cycle.', true);
  } finally {
    // Restaure les settings initiaux quelle que soit l'issue.
    await chrome.storage.local.set({
      settings: { ...settings, onlyAdIds: prevOnlyAdIds }
    });
  }
}

// Duplicate : option (a) — copie titre + prix + description dans le presse-papier
// et ouvre /deposer-une-annonce dans un nouvel onglet.
// Choix retenu car repostListing() dans orchestrator.js exige une phase scrape live
// (scrapeEditPage) pour obtenir les photos — données absentes de myListings qui ne
// stocke que titre/thumbnail/statut. Brancher repostListing directement demanderait
// soit un nouveau cycle de scrape, soit une refonte du stockage. L'option (a) est
// sans risque et utilisable immédiatement.
async function handleDuplicate(listing) {
  const lines = [
    listing.title || '',
    listing.price ? `Prix : ${listing.price}` : '',
    listing.body || listing.description || ''
  ].filter(Boolean);
  const text = lines.join('\n\n');

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Presse-papier refusé (ex: focus perdu) — on ouvre quand même l'onglet.
  }

  await chrome.tabs.create({ url: 'https://www.leboncoin.fr/deposer-une-annonce', active: true });
  showBackupStatus('📋 Données copiées — colle dans le formulaire leboncoin.');
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

export function initBumper() {
  [b.enabled, b.dryRun, b.dayOfWeek, b.hour, b.minute, b.jitterMinutes].forEach(el => {
    el.addEventListener('change', () => { saveBumper(); updateActionHint(); });
    el.addEventListener('blur', saveBumper);
  });

  b.smartBump.addEventListener('click', async () => {
    const { settings = {}, myListings } = await chrome.storage.local.get(['settings', 'myListings']);
    const cats = categoriesFromListings(myListings, new Set(settings.onlyAdIds || []));
    const slot = nextPeakSlotForBatch(cats, new Date());
    const label = slot.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const mainCat = cats.length ? cats[0] : 'défaut';

    // Reuse the existing scheduling mechanism: write the slot into settings and
    // reschedule. This keeps a single code path for alarm management.
    const next = {
      ...settings,
      enabled: true,
      dayOfWeek: slot.getDay(),
      hour: slot.getHours(),
      minute: 0,
    };
    await chrome.storage.local.set({ settings: next });
    b.enabled.checked = true;
    b.dayOfWeek.value = slot.getDay();
    b.hour.value = slot.getHours();
    b.minute.value = 0;
    await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });

    b.smartBumpConfirm.textContent = `✓ Planning activé — prochain bump : ${label} (pic ${mainCat})`;
    b.smartBumpConfirm.hidden = false;
    setTimeout(() => { b.smartBumpConfirm.hidden = true; }, 5000);
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

  b.selectAll.addEventListener('click', async () => {
    if (!_currentStoredListings?.listings?.length) return;
    const { settings = {} } = await chrome.storage.local.get('settings');
    const active = _currentStoredListings.listings.filter(l => !/pause/i.test(l.status || ''));
    const ids = new Set(active.map(l => l.id));
    const next = { ...settings, onlyAdIds: [...ids] };
    await chrome.storage.local.set({ settings: next });
    await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
    renderListings(_currentStoredListings, ids, _currentListingEdits);
  });

  b.selectNone.addEventListener('click', async () => {
    if (!_currentStoredListings?.listings?.length) return;
    const { settings = {} } = await chrome.storage.local.get('settings');
    const next = { ...settings, onlyAdIds: [] };
    await chrome.storage.local.set({ settings: next });
    await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
    renderListings(_currentStoredListings, new Set(), _currentListingEdits);
  });

  b.backupExport.addEventListener('click', () => handleBackupExport());

  b.backupImport.addEventListener('click', () => b.backupImportFile.click());

  b.backupImportFile.addEventListener('change', () => {
    const file = b.backupImportFile.files?.[0];
    if (!file) return;
    handleBackupImportFile(file);
    // Reset pour permettre re-sélection du même fichier
    b.backupImportFile.value = '';
  });

  b.refreshListings.addEventListener('click', async () => {
    b.refreshListings.disabled = true;
    b.refreshListings.innerHTML = '<span class="spinner-inline"></span>';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'REFRESH_LISTINGS' });
      if (!r?.ok) {
        b.selectionHint.textContent = `Erreur : ${r?.error || 'inconnue'}`;
        return;
      }
      const { settings = {}, listingEdits = {} } = await chrome.storage.local.get(['settings', 'listingEdits']);
      renderListings(r.result, new Set(settings.onlyAdIds || []), listingEdits);
    } finally {
      b.refreshListings.disabled = false;
      b.refreshListings.innerHTML = '⟳ Charger mes annonces';
    }
  });
}
