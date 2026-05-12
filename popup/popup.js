// ---- Tab switching --------------------------------------------------------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === target));
  });
});

// ---- Bumper panel ---------------------------------------------------------
const b = {
  enabled: document.getElementById('b-enabled'),
  dryRun: document.getElementById('b-dryRun'),
  dayOfWeek: document.getElementById('b-dayOfWeek'),
  hour: document.getElementById('b-hour'),
  minute: document.getElementById('b-minute'),
  onlyAdIds: document.getElementById('b-onlyAdIds'),
  runNow: document.getElementById('b-runNow'),
  clearLog: document.getElementById('b-clearLog'),
  log: document.getElementById('b-log')
};

async function loadBumper() {
  const { settings = {}, log = [] } = await chrome.storage.local.get(['settings', 'log']);
  b.enabled.checked = !!settings.enabled;
  b.dryRun.checked = settings.dryRun !== false;
  b.dayOfWeek.value = settings.dayOfWeek ?? 1;
  b.hour.value = settings.hour ?? 9;
  b.minute.value = settings.minute ?? 0;
  b.onlyAdIds.value = (settings.onlyAdIds || []).join(', ');
  renderLog(log);
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
async function saveBumper() {
  const settings = {
    enabled: b.enabled.checked,
    dryRun: b.dryRun.checked,
    dayOfWeek: +b.dayOfWeek.value,
    hour: +b.hour.value,
    minute: +b.minute.value,
    onlyAdIds: b.onlyAdIds.value.split(',').map(s => s.trim()).filter(Boolean)
  };
  await chrome.storage.local.set({ settings });
  await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
}
[b.enabled, b.dryRun, b.dayOfWeek, b.hour, b.minute, b.onlyAdIds].forEach(el => {
  el.addEventListener('change', saveBumper);
  el.addEventListener('blur', saveBumper);
});
b.runNow.addEventListener('click', async () => {
  b.runNow.disabled = true;
  b.runNow.innerHTML = '<span class="spinner-inline"></span>En cours…';
  try { await chrome.runtime.sendMessage({ type: 'RUN_NOW' }); }
  finally {
    b.runNow.disabled = false;
    b.runNow.textContent = 'Lancer maintenant';
    const { log = [] } = await chrome.storage.local.get('log');
    renderLog(log);
  }
});
b.clearLog.addEventListener('click', async () => {
  await chrome.storage.local.set({ log: [] });
  renderLog([]);
});

// ---- Prospect panel -------------------------------------------------------
const p = {
  enabled: document.getElementById('p-enabled'),
  dayOfWeek: document.getElementById('p-dayOfWeek'),
  hour: document.getElementById('p-hour'),
  minScore: document.getElementById('p-minScore'),
  maxAgeDays: document.getElementById('p-maxAgeDays'),
  keywords: document.getElementById('p-keywords'),
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
        ${isNew ? '<span class="badge new">NEW</span>' : ''}
        <span class="badge score">${r.score}</span>
      </div>
      <div class="card-meta">
        <span class="loc">${escapeHtml(r.location)}</span>
        <span class="age">${r.age_days}j</span>
        <span class="kw">${escapeHtml(r.kw_hit)}</span>
      </div>
      <div class="card-body">${escapeHtml((r.body || '').slice(0, 200))}</div>
    `;
    p.list.appendChild(card);
  }
}

async function saveProspect() {
  const prospectSettings = {
    enabled: p.enabled.checked,
    dayOfWeek: +p.dayOfWeek.value,
    hour: +p.hour.value,
    minute: 0,
    minScore: +p.minScore.value,
    maxAgeDays: +p.maxAgeDays.value,
    keywords: p.keywords.value.split('\n').map(s => s.trim()).filter(Boolean)
  };
  await chrome.storage.local.set({ prospectSettings });
  await chrome.runtime.sendMessage({ type: 'RESCHEDULE_PROSPECT' });
}
[p.enabled, p.dayOfWeek, p.hour, p.minScore, p.maxAgeDays, p.keywords].forEach(el => {
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

// ---- Helpers --------------------------------------------------------------
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
});

loadBumper();
loadProspect();
