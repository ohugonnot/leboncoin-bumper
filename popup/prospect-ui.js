import { DEFAULT_REPLY_TEMPLATE, formatReplyTemplate, groupByOwner } from '../prospect.js';
import { escapeHtml, escapeAttr } from './util.js';

const p = {
  enabled: document.getElementById('p-enabled'),
  frequency: document.getElementById('p-frequency'),
  dayOfWeek: document.getElementById('p-dayOfWeek'),
  hour: document.getElementById('p-hour'),
  notifyOnNew: document.getElementById('p-notifyOnNew'),
  notifyMinScore: document.getElementById('p-notifyMinScore'),
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
  notificationWebhookUrl: document.getElementById('p-notificationWebhookUrl'),
  webhookStatus: document.getElementById('p-webhook-status'),
  profileSelect: document.getElementById('p-profile-select'),
  profileAdd: document.getElementById('p-profile-add'),
  profileRename: document.getElementById('p-profile-rename'),
  profileDelete: document.getElementById('p-profile-delete'),
  scan: document.getElementById('p-scan'),
  markSeen: document.getElementById('p-mark-seen'),
  list: document.getElementById('p-list'),
  statNew: document.getElementById('p-stat-new'),
  statTotal: document.getElementById('p-stat-total'),
  lastRun: document.getElementById('p-last-run')
};

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
  const departments = p.departments.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  const priceMin = p.priceMin.value === '' ? null : Math.max(0, +p.priceMin.value);
  const priceMax = p.priceMax.value === '' ? null : Math.max(0, +p.priceMax.value);

  const nextProfiles = prospectProfiles.map(pr => pr.id === activeProfileId ? {
    ...pr,
    keywords: p.keywords.value.split('\n').map(s => s.trim()).filter(Boolean),
    minScore: +p.minScore.value,
    maxAgeDays: +p.maxAgeDays.value,
    adType: p.adType.value,
    priceMin, priceMax, departments,
    sortOrder: p.sortBy.value,
    ownerType: p.ownerType.value,
    shippableOnly: p.shippableOnly.checked,
    replyTemplate: p.replyTemplate.value,
    notificationWebhookUrl: p.notificationWebhookUrl.value.trim() || null
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

export async function loadProspect() {
  const s = await chrome.storage.local.get([
    'prospectProfiles', 'activeProfileId', 'prospectGlobalSettings',
    'prospectResultsByProfile', 'prospectLastRunByProfile',
    'prospectSeenIdsByProfile', 'prospectIgnoredIdsByProfile',
    'prospectContactedLocal', 'lastWebhookErrorByProfile'
  ]);
  const profiles = s.prospectProfiles || [];
  if (!profiles.length) return;  // migration not run yet
  const activeId = s.activeProfileId || profiles[0].id;
  const profile = profiles.find(x => x.id === activeId) || profiles[0];
  const global = s.prospectGlobalSettings || {};

  p.profileSelect.innerHTML = profiles.map(pr =>
    `<option value="${escapeAttr(pr.id)}" ${pr.id === profile.id ? 'selected' : ''}>${escapeHtml(pr.name)}</option>`
  ).join('');
  p.profileDelete.disabled = profiles.length <= 1;

  p.enabled.checked = !!global.enabled;
  p.frequency.value = global.frequency || 'week';
  p.dayOfWeek.value = global.dayOfWeek ?? 1;
  p.hour.value = global.hour ?? 10;
  p.notifyOnNew.checked = global.notifyOnNew !== false;
  p.notifyMinScore.value = global.notifyMinScore ?? 7;
  updateFrequencyVisibility();

  p.minScore.value = profile.minScore ?? 5;
  p.maxAgeDays.value = profile.maxAgeDays ?? 30;
  p.adType.value = profile.adType || 'demand';
  p.priceMin.value = profile.priceMin ?? '';
  p.priceMax.value = profile.priceMax ?? '';
  p.departments.value = (profile.departments || []).join(', ');
  // Whitelist : legacy values like 'desc' / 'asc' don't exist in the new
  // dropdown, so we fall back to the default.
  const validSorts = ['score', 'time', 'price-asc', 'price-desc'];
  p.sortBy.value = validSorts.includes(profile.sortOrder) ? profile.sortOrder : 'score';
  p.ownerType.value = profile.ownerType || 'all';
  p.shippableOnly.checked = !!profile.shippableOnly;
  p.keywords.value = (profile.keywords || []).join('\n');
  p.replyTemplate.value = profile.replyTemplate || DEFAULT_REPLY_TEMPLATE;
  p.notificationWebhookUrl.value = profile.notificationWebhookUrl || '';
  const webhookErr = (s.lastWebhookErrorByProfile || {})[profile.id];
  if (webhookErr?.at && (Date.now() - new Date(webhookErr.at).getTime() < 24 * 3600 * 1000)) {
    p.webhookStatus.textContent = `⚠ ${webhookErr.error}`;
  } else {
    p.webhookStatus.textContent = '';
  }

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
  const hint = document.getElementById('p-empty-hint');
  if (hint) {
    if (lastRun?.error) {
      hint.hidden = false;
      hint.innerHTML = `<strong>⚠ Le scan a échoué :</strong> ${escapeHtml(lastRun.error)}<br>`
        + `Vérifie que tu es bien connecté à leboncoin.fr puis relance.`;
    } else if (results.length > 0) {
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
  const groups = groupByOwner(visible);
  for (const group of groups) {
    const r = group.primary;
    const isNew = !seenSet.has(r.list_id);
    const card = document.createElement('div');
    card.className = 'card' + (isNew ? ' new' : ' seen');

    const ownerHtml = r.owner_name
      ? `<div class="card-owner">par ${escapeHtml(r.owner_name)}</div>`
      : '';

    const ignoreAllBtn = group.others.length > 0
      ? `<button class="btn ghost small ignore-all-btn">🚫 Tout ignorer du vendeur</button>`
      : '';

    card.innerHTML = `
      <div class="card-top">
        <a class="card-title" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.subject)}</a>
        ${isNew ? '<span class="badge new">NOUV.</span>' : ''}
        ${r.already_contacted ? '<span class="badge contacted" title="Tu as déjà une conversation avec cette annonce">✉ DÉJÀ</span>' : ''}
        <span class="badge score" title="${escapeAttr(r.score_breakdown ? r.score_breakdown.join('\n') : 'Score de pertinence')}">★ ${r.score}</span>
      </div>
      ${ownerHtml}
      <div class="card-meta">
        <span class="loc">${escapeHtml(r.location)}</span>
        <span class="age">${r.age_days}j</span>
        ${r.price ? `<span class="price">${r.price} €</span>` : ''}
        <span class="kw">${escapeHtml(r.kw_hit)}</span>
      </div>
      <div class="card-body">${escapeHtml((r.body || '').slice(0, 400))}</div>
      <div class="card-actions">
        <button class="btn ghost small ignore-btn" data-id="${escapeAttr(r.list_id)}" title="Masquer définitivement (ne reviendra pas dans les prochains scans)">✗ Ignorer</button>
        ${ignoreAllBtn}
        <button class="btn ghost small contact-btn" data-id="${escapeAttr(r.list_id)}" ${r.already_contacted ? 'title="Tu as déjà contacté — ouvre /reply pour relancer"' : ''}>✉ ${r.already_contacted ? 'Relancer' : 'Contacter'}</button>
      </div>
    `;
    card.querySelector('.contact-btn').addEventListener('click', () => onContact(r));
    card.querySelector('.ignore-btn').addEventListener('click', () => onIgnore(r));
    if (group.others.length > 0) {
      card.querySelector('.ignore-all-btn').addEventListener('click', () => onIgnoreAll(group));
    }

    if (group.others.length > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'subads-toggle';
      toggle.textContent = `▸ ${group.others.length} autre${group.others.length > 1 ? 's' : ''} annonce${group.others.length > 1 ? 's' : ''} du même vendeur (${group.ownerName || '?'})`;

      const subadsDiv = document.createElement('div');
      subadsDiv.className = 'subads';
      subadsDiv.hidden = true;

      for (const sub of group.others) {
        const row = document.createElement('div');
        row.className = 'subad';
        const subIsNew = !seenSet.has(sub.list_id);
        row.innerHTML = `
          <a href="${escapeAttr(sub.url)}" target="_blank" rel="noopener">${escapeHtml(sub.subject)}</a>
          ${subIsNew ? '<span class="badge new" style="font-size:9px">NOUV.</span>' : ''}
          <span class="age">${sub.age_days}j</span>
          ${sub.price ? `<span class="price">${sub.price} €</span>` : ''}
          <button class="btn ghost small ignore-btn">✗</button>
        `;
        row.querySelector('.ignore-btn').addEventListener('click', () => onIgnore(sub));
        subadsDiv.appendChild(row);
      }

      toggle.addEventListener('click', () => {
        const open = !subadsDiv.hidden;
        subadsDiv.hidden = open;
        toggle.textContent = (open ? '▸' : '▾') + toggle.textContent.slice(1);
      });

      card.appendChild(toggle);
      card.appendChild(subadsDiv);
    }

    p.list.appendChild(card);
  }

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

async function onIgnoreAll(group) {
  const { prospectIgnoredIdsByProfile = {}, activeProfileId } = await chrome.storage.local.get(['prospectIgnoredIdsByProfile', 'activeProfileId']);
  const next = new Set(prospectIgnoredIdsByProfile[activeProfileId] || []);
  next.add(group.primary.list_id);
  for (const sub of group.others) next.add(sub.list_id);
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
  // Shared across profiles : a contact is a contact regardless of which veille surfaced it.
  const nextSet = new Set(prospectContactedLocal);
  nextSet.add(prospect.list_id);
  await chrome.storage.local.set({ prospectContactedLocal: [...nextSet].slice(-5000) });
  showToast('Form ouvert + marqué comme contacté');
  await loadProspect();
}

export function updateScanProgress(progress) {
  const el = document.getElementById('p-scan-progress');
  const statRow = document.querySelector('.prospect-meta');
  if (!el) return;
  if (!progress) {
    el.hidden = true;
    if (statRow) statRow.hidden = false;
    return;
  }
  const { kwIndex, kwTotal, kw, page, pageMax, found } = progress;
  const pct = Math.round(((kwIndex - 1) + page / pageMax) / kwTotal * 100);
  el.hidden = false;
  el.innerHTML = `
    <div class="scan-progress-label">Scan en cours… mot-clé ${kwIndex}/${kwTotal} (${escapeHtml(kw)}) · page ${page}/${pageMax} · ${found} annonces trouvées</div>
    <div class="scan-progress-track"><div class="scan-progress-fill" style="width:${pct}%"></div></div>
  `;
  if (statRow) statRow.hidden = true;
}

export function initProspect() {
  [p.enabled, p.frequency, p.dayOfWeek, p.hour, p.minScore, p.maxAgeDays, p.adType, p.priceMin, p.priceMax, p.departments, p.sortBy, p.ownerType, p.shippableOnly, p.keywords, p.notifyOnNew, p.notifyMinScore, p.replyTemplate, p.notificationWebhookUrl].forEach(el => {
    el.addEventListener('change', saveProspect);
    el.addEventListener('blur', saveProspect);
  });

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
      p.scan.textContent = '🔍 Scanner maintenant';
      await loadProspect();
    }
  });

  p.markSeen.addEventListener('click', async () => {
    const { prospectResultsByProfile = {}, activeProfileId } = await chrome.storage.local.get(['prospectResultsByProfile', 'activeProfileId']);
    const results = prospectResultsByProfile[activeProfileId] || [];
    await chrome.runtime.sendMessage({ type: 'MARK_PROSPECTS_SEEN', results });
    await loadProspect();
  });
}
