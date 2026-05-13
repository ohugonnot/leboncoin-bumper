import { escapeHtml, timeAgo } from './util.js';

let activeInboxFilter = 'all';
let inboxSearchQuery = '';

// Returns counts of visible (non-archived) conversations per category, plus archived total.
export function computeVisibleCounts(all, dismissedSet) {
  const counts = { scam: 0, lead: 0, question: 0, spam: 0, archived: 0 };
  for (const conv of all) {
    if (dismissedSet.has(conv.conversationId)) {
      counts.archived++;
    } else {
      const cat = conv._classification?.category;
      if (cat in counts) counts[cat]++;
    }
  }
  return counts;
}

export async function loadInbox() {
  const { inboxCache, inboxLastRun, inboxDismissed = [] } = await chrome.storage.local.get([
    'inboxCache', 'inboxLastRun', 'inboxDismissed'
  ]);

  const errorBanner = document.getElementById('m-error-banner');
  const errorText = document.getElementById('m-error-text');
  const lastRunEl = document.getElementById('m-last-run');
  if (inboxLastRun?.error) {
    errorBanner.hidden = false;
    errorText.textContent = `Le chargement a échoué : ${inboxLastRun.error}`;
    if (lastRunEl) lastRunEl.textContent = '';
  } else {
    errorBanner.hidden = true;
    if (lastRunEl) {
      lastRunEl.textContent = inboxLastRun?.at
        ? 'Boîte chargée ' + timeAgo(new Date(inboxLastRun.at))
        : 'Jamais chargée';
    }
  }

  renderInbox(inboxCache, new Set(inboxDismissed));
}

function renderInboxCard(conv, dismissed, { isArchived = false } = {}) {
  const cls = conv._classification || { category: 'lead', signals: [], confidence: 0 };
  const cat = cls.category;

  // Strip the "Nouveau message pour " prefix from subject for cleaner display
  const subject = (conv.subject || '').replace(/^nouveau message pour ["«]?/i, '').replace(/["»]? sur leboncoin$/i, '');
  const preview = (conv.lastMessagePreview || '').slice(0, 200);
  const date = conv.lastMessageDate ? timeAgo(new Date(conv.lastMessageDate)) : '';
  const badgeLabel = { scam: '🚨 Scam', lead: '💬 Lead', question: '❓ Question', spam: '🗑 Spam' }[cat] || cat;

  const card = document.createElement('div');
  card.className = `card cat-${cat}`;
  card.innerHTML = `
    <div class="card-top">
      <span class="card-title">${escapeHtml(conv.partnerName || '(inconnu)')}</span>
      <span class="badge cat-${cat}">${badgeLabel}</span>
      ${conv.unseenCounter > 0 ? `<span class="badge new">${conv.unseenCounter} non lu</span>` : ''}
    </div>
    <div class="card-subject">${escapeHtml(subject)}</div>
    ${date ? `<div class="card-meta"><span class="age">${escapeHtml(date)}</span></div>` : ''}
    <div class="card-body">${escapeHtml(preview)}</div>
    ${cls.signals.length ? `<div class="card-signals">Détecté : ${escapeHtml(cls.signals.map(s => s.replace(/-/g, ' ')).join(', '))}</div>` : ''}
    <div class="card-actions">
      <button class="btn ghost small open-conv-btn">Ouvrir conversation</button>
      ${isArchived
        ? `<button class="btn ghost small restore-btn">↩ Restaurer</button>`
        : `<button class="btn ghost small dismiss-btn" title="Cache localement, ne supprime rien côté Leboncoin">✓ Archiver</button>`
      }
    </div>
  `;

  card.querySelector('.open-conv-btn').addEventListener('click', () => {
    const cid = String(conv.conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cid) return;
    chrome.tabs.create({ url: `https://www.leboncoin.fr/messages/id/${cid}` });
  });

  if (isArchived) {
    card.querySelector('.restore-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'INBOX_RESTORE', convId: conv.conversationId });
      card.remove();
      dismissed.delete(conv.conversationId);
    });
  } else {
    card.querySelector('.dismiss-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'INBOX_DISMISS', convId: conv.conversationId });
      card.remove();
      dismissed.add(conv.conversationId);
    });
  }

  return card;
}

export function renderInbox(cache, dismissed) {
  const all = cache?.all || [];
  const counts = computeVisibleCounts(all, dismissed);

  const total = counts.scam + counts.lead + counts.question + counts.spam;

  document.getElementById('m-stat-scam').textContent     = all.length ? counts.scam     : '–';
  document.getElementById('m-stat-lead').textContent     = all.length ? counts.lead     : '–';
  document.getElementById('m-stat-question').textContent = all.length ? counts.question : '–';
  document.getElementById('m-stat-spam').textContent     = all.length ? counts.spam     : '–';
  document.getElementById('m-stat-archived').textContent = all.length ? counts.archived : '–';

  const filterLabels = {
    all:      `Tous (${total})`,
    scam:     `🚨 Scam (${counts.scam})`,
    lead:     `💬 Leads (${counts.lead})`,
    question: `❓ Questions (${counts.question})`,
    spam:     `🗑 Spam (${counts.spam})`,
    archived: `📦 Archivés (${counts.archived})`,
  };
  document.querySelectorAll('.inbox-filter').forEach(btn => {
    const label = filterLabels[btn.dataset.filter];
    if (label) btn.textContent = label;
  });

  const list = document.getElementById('m-list');
  const hint = document.getElementById('m-empty-hint');
  list.innerHTML = '';

  if (!all.length) {
    hint.hidden = false;
    hint.textContent = cache
      ? 'Aucune conversation dans ta boîte.'
      : 'Clique sur "Rafraîchir" pour charger ta boîte de réception leboncoin.';
    return;
  }
  hint.hidden = true;

  const isArchived = activeInboxFilter === 'archived';
  const q = inboxSearchQuery.trim().toLowerCase();
  const visible = all.filter(c => {
    const archived = dismissed.has(c.conversationId);
    if (isArchived) {
      if (!archived) return false;
    } else {
      if (archived) return false;
      if (activeInboxFilter !== 'all' && c._classification?.category !== activeInboxFilter) return false;
    }
    if (!q) return true;
    const hay = `${c.partnerName || ''} ${c.subject || ''} ${c.lastMessagePreview || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (!visible.length) {
    hint.hidden = false;
    hint.textContent = q
      ? `Aucun message ne correspond à « ${q} ».`
      : 'Aucune conversation dans cette catégorie.';
    return;
  }

  visible.sort((a, b) => {
    const da = new Date(a.lastMessageDate || 0).getTime();
    const db = new Date(b.lastMessageDate || 0).getTime();
    return db - da;
  });

  for (const conv of visible) {
    list.appendChild(renderInboxCard(conv, dismissed, { isArchived }));
  }
}

export function initInbox() {
  document.getElementById('m-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('m-refresh');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-inline"></span>Chargement…';
    try {
      await chrome.runtime.sendMessage({ type: 'INBOX_REFRESH' });
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 Rafraîchir la boîte';
      await loadInbox();
    }
  });

  document.getElementById('m-search')?.addEventListener('input', async (e) => {
    inboxSearchQuery = e.target.value;
    const { inboxCache, inboxDismissed = [] } = await chrome.storage.local.get(['inboxCache', 'inboxDismissed']);
    renderInbox(inboxCache, new Set(inboxDismissed));
  });

  document.querySelectorAll('.inbox-filter').forEach(btn => {
    btn.addEventListener('click', async () => {
      activeInboxFilter = btn.dataset.filter;
      document.querySelectorAll('.inbox-filter').forEach(b => b.classList.toggle('active', b === btn));
      const { inboxCache, inboxDismissed = [] } = await chrome.storage.local.get(['inboxCache', 'inboxDismissed']);
      renderInbox(inboxCache, new Set(inboxDismissed));
    });
  });
}
