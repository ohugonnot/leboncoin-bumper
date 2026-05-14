// MV3 popups auto-close on blur. When a popup awaits an async sendMessage and
// disappears mid-flight, Chrome rejects with "message channel closed" — but
// the handler already persisted its result to chrome.storage. Silence only
// these well-identified peer-gone rejections.
const POPUP_GONE_RE = /message channel closed|Frame with ID|back\/forward cache|No tab with id|tab was closed|Extension context invalidated|Receiving end does not exist/i;
self.addEventListener('unhandledrejection', (e) => {
  const text = String(e.reason?.message ?? e.reason ?? '');
  if (POPUP_GONE_RE.test(text)) e.preventDefault();
});

import { runCycle, listUserAds, checkLoginStatus, fetchAdsViaTab, openReplyForm, fetchInboxViaTab, fetchMyAdsViaApi, fetchUserCardViaTab } from './orchestrator.js';
import { processRawAds, markResultsSeen, DEFAULT_KEYWORDS, enrichProspectsWithUserCard } from './prospect.js';
import { normalizeUserCard } from './my-ads.js';
import { classifyConversations } from './messaging.js';

const BUMP_ALARM = 'lbc-weekly-bump';
const PROSPECT_ALARM = 'lbc-weekly-prospect';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['settings', 'prospectSettings', 'prospectProfiles']);
  if (!stored.settings) {
    await chrome.storage.local.set({
      settings: {
        enabled: false, dryRun: true,
        dayOfWeek: 1, hour: 9, minute: 0, onlyAdIds: [],
        jitterMinutes: 60
      },
      log: []
    });
  }
  await migrateToProfiles();
  await rescheduleBump();
  await rescheduleProspect();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateToProfiles();
  await rescheduleBump();
  await rescheduleProspect();
});

/**
 * One-shot migration : pre-v0.4 stored everything in a single prospectSettings
 * object. We now support multiple isolated profiles. This function runs each
 * startup but is a no-op once profiles exist.
 */
async function migrateToProfiles() {
  const s = await chrome.storage.local.get([
    'prospectProfiles', 'prospectSettings',
    'prospectResults', 'prospectSeenIds', 'prospectIgnoredIds', 'prospectLastRun'
  ]);
  if (s.prospectProfiles?.length) return;  // already migrated
  const old = s.prospectSettings || {};
  const defaultProfile = {
    id: 'default',
    name: 'Veille principale',
    keywords: old.keywords?.length ? old.keywords : DEFAULT_KEYWORDS,
    minScore: old.minScore ?? 5,
    maxAgeDays: old.maxAgeDays ?? 30,
    replyTemplate: old.replyTemplate || ''
  };
  await chrome.storage.local.set({
    prospectProfiles: [defaultProfile],
    activeProfileId: 'default',
    prospectGlobalSettings: {
      enabled: old.enabled ?? false,
      frequency: 'week',
      dayOfWeek: old.dayOfWeek ?? 1,
      hour: old.hour ?? 10,
      minute: old.minute ?? 0,
      notifyOnNew: old.notifyOnNew !== false,
      notifyMinScore: old.notifyMinScore ?? 7
    },
    prospectResultsByProfile: { default: s.prospectResults || [] },
    prospectSeenIdsByProfile: { default: s.prospectSeenIds || [] },
    prospectIgnoredIdsByProfile: { default: s.prospectIgnoredIds || [] },
    prospectLastRunByProfile: { default: s.prospectLastRun || null }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BUMP_ALARM) {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings?.enabled) await runCycle({ trigger: 'alarm' });
    await rescheduleBump();
  } else if (alarm.name === PROSPECT_ALARM) {
    const { prospectGlobalSettings } = await chrome.storage.local.get('prospectGlobalSettings');
    if (prospectGlobalSettings?.enabled) await doProspectScan('alarm');
    await rescheduleProspect();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  let responded = false;
  const respond = (data) => {
    if (responded) return;
    responded = true;
    try { sendResponse(data); } catch { /* peer gone, see POPUP_GONE_RE */ }
  };
  // Fast fire-and-forget : respond synchronously so the channel can close
  // even if the popup dies mid-await ; work continues in the background.
  if (msg.type === 'RESCHEDULE') {
    respond({ ok: true });
    rescheduleBump();
    return false;
  }
  if (msg.type === 'RESCHEDULE_PROSPECT') {
    respond({ ok: true });
    rescheduleProspect();
    return false;
  }
  if (msg.type === 'PROFILE_SET_ACTIVE') {
    respond({ ok: true });
    chrome.storage.local.set({ activeProfileId: msg.id });
    return false;
  }
  if (msg.type === 'INBOX_DISMISS') {
    respond({ ok: true });
    (async () => {
      try {
        const { inboxDismissed = [] } = await chrome.storage.local.get('inboxDismissed');
        const next = new Set(inboxDismissed);
        next.add(msg.convId);
        await chrome.storage.local.set({ inboxDismissed: [...next].slice(-2000) });
      } catch (e) { console.warn('INBOX_DISMISS failed:', e); }
    })();
    return false;
  }
  if (msg.type === 'INBOX_RESTORE') {
    respond({ ok: true });
    (async () => {
      try {
        const { inboxDismissed = [] } = await chrome.storage.local.get('inboxDismissed');
        const next = new Set(inboxDismissed);
        next.delete(msg.convId);
        await chrome.storage.local.set({ inboxDismissed: [...next] });
      } catch (e) { console.warn('INBOX_RESTORE failed:', e); }
    })();
    return false;
  }
  if (msg.type === 'MARK_PROSPECTS_SEEN') {
    respond({ ok: true });
    (async () => {
      try {
        const { activeProfileId } = await chrome.storage.local.get('activeProfileId');
        await markResultsSeen(msg.results || [], activeProfileId);
      } catch (e) { console.warn('MARK_PROSPECTS_SEEN failed:', e); }
    })();
    return false;
  }
  // Slow ops : popup awaits a real result, keep the channel open.
  (async () => {
    try {
      if (msg.type === 'RUN_NOW') {
        respond({ ok: true, result: await runCycle({ trigger: 'manual' }) });
      } else if (msg.type === 'RUN_PROSPECT_NOW') {
        respond({ ok: true, result: await doProspectScan('manual') });
      } else if (msg.type === 'CHECK_LOGIN') {
        respond({ ok: true, result: await checkLoginStatus() });
      } else if (msg.type === 'REFRESH_LISTINGS') {
        let out;
        try {
          out = await fetchMyAdsViaApi();
        } catch (apiErr) {
          // API failed (401, network error, DataDome…) — fall back to DOM scrape.
          console.warn('[lbc-bumper] dashboard API failed, falling back to DOM scrape:', apiErr.message);
          out = await listUserAds();
        }
        if (out?.datadomeBlocked) await notifyDatadomeBlock('dashboard');
        await chrome.storage.local.set({ myListings: out });
        respond({ ok: true, result: out });
      } else if (msg.type === 'GET_BUMP_STATUS') {
        const { lastBumpRun } = await chrome.storage.local.get('lastBumpRun');
        const alarm = await chrome.alarms.get(BUMP_ALARM);
        respond({ ok: true, result: {
          lastRun: lastBumpRun || null,
          nextRunAt: alarm?.scheduledTime || null,
          scheduled: !!alarm
        }});
      } else if (msg.type === 'OPEN_REPLY_FORM') {
        await openReplyForm(msg.listId, msg.message);
        respond({ ok: true });
      } else if (msg.type === 'PROFILE_CREATE') {
        respond({ ok: true, result: await profileCreate(msg.name) });
      } else if (msg.type === 'PROFILE_RENAME') {
        await profileRename(msg.id, msg.name);
        respond({ ok: true });
      } else if (msg.type === 'PROFILE_DELETE') {
        await profileDelete(msg.id);
        respond({ ok: true });
      } else if (msg.type === 'INBOX_REFRESH') {
        try {
          const { conversations, at, datadomeBlocked } = await fetchInboxViaTab();
          if (datadomeBlocked) await notifyDatadomeBlock('inbox');
          const classified = classifyConversations(conversations);
          await chrome.storage.local.set({
            inboxCache: classified,
            inboxLastRun: { at, error: null }
          });
          respond({ ok: true, result: classified });
        } catch (e) {
          await chrome.storage.local.set({
            inboxLastRun: { at: Date.now(), error: String(e?.message || e) }
          });
          respond({ ok: false, error: e.message });
        }
      } else {
        respond({ ok: false, error: `unknown message type: ${msg.type}` });
      }
    } catch (e) {
      respond({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

async function doProspectScan(trigger) {
  const {
    prospectProfiles = [], activeProfileId,
    prospectGlobalSettings = {},
    prospectSeenIdsByProfile = {},
    prospectIgnoredIdsByProfile = {},
    prospectResultsByProfile = {},
    prospectLastRunByProfile = {},
    prospectContactedLocal = []
  } = await chrome.storage.local.get([
    'prospectProfiles', 'activeProfileId', 'prospectGlobalSettings',
    'prospectSeenIdsByProfile', 'prospectIgnoredIdsByProfile',
    'prospectResultsByProfile', 'prospectLastRunByProfile',
    'prospectContactedLocal'
  ]);
  const profile = prospectProfiles.find(p => p.id === activeProfileId) || prospectProfiles[0];
  if (!profile) throw new Error('No prospect profile found');
  const seen = new Set(prospectSeenIdsByProfile[profile.id] || []);
  const keywords = profile.keywords?.length ? profile.keywords : DEFAULT_KEYWORDS;
  const maxAgeDays = profile.maxAgeDays || 30;
  const minScore = profile.minScore || 5;
  const adType = profile.adType || 'demand';
  // API is always queried in `time desc` order : this lets the pagination
  // loop bail out as soon as ads exceed maxAgeDays. Display sort is applied
  // post-fetch by sortEntries() based on profile.sortOrder.
  const apiFilters = {
    priceMin: profile.priceMin,
    priceMax: profile.priceMax,
    departments: profile.departments || [],
    ownerType: profile.ownerType || 'all',
    shippableOnly: !!profile.shippableOnly
  };
  // Fetch routed through a leboncoin tab — direct SW fetch is 403'd by DataDome.
  // Errors here usually mean : (a) tab couldn't load (network), (b) DataDome
  // captcha not solved (rare), (c) leboncoin API rate-limited. All recoverable
  // on next manual scan — but we must surface the failure to the user.
  let adsByKeyword, contactedAdIds, datadomeBlocked = false;
  try {
    ({ adsByKeyword, contactedAdIds = [], datadomeBlocked = false } = await fetchAdsViaTab(keywords, maxAgeDays, adType, apiFilters));
  } catch (err) {
    await chrome.storage.local.set({
      prospectLastRunByProfile: {
        ...prospectLastRunByProfile,
        [profile.id]: {
          ts: new Date().toISOString(),
          trigger, total: 0, scanned: 0,
          error: String(err?.message || err)
        }
      }
    });
    throw err;
  }
  if (datadomeBlocked) {
    await notifyDatadomeBlock('prospect-scan');
  }
  const allContacted = new Set([...contactedAdIds, ...prospectContactedLocal]);
  const out = processRawAds({
    adsByKeyword, maxAgeDays, minScore,
    seenIds: seen, contactedIds: allContacted,
    profileKeywords: keywords,
    ownerType: profile.ownerType || 'all',
    shippableOnly: !!profile.shippableOnly,
    sortOrder: profile.sortOrder || 'score'
  });
  // Opt-in : enrichir top-N résultats avec /api/user-card. Coûteux (N tabs ouvertes
  // séquentiellement) — limité à enrichTopN entrées pour éviter DataDome thrash.
  if (profile.enrichUserCard) {
    const topN = Math.max(1, Math.min(20, profile.enrichTopN || 10));
    out.results = await enrichTopResults(out.results, topN);
  }
  await chrome.storage.local.set({
    prospectResultsByProfile: { ...prospectResultsByProfile, [profile.id]: out.results },
    prospectLastRunByProfile: {
      ...prospectLastRunByProfile,
      [profile.id]: { ts: new Date().toISOString(), trigger, total: out.total, scanned: out.scannedKeywords }
    }
  });
  const ignored = new Set(prospectIgnoredIdsByProfile[profile.id] || []);
  await maybeNotify(out.results, seen, prospectGlobalSettings, profile, ignored);
  return out;
}

// Persisted cache lives in chrome.storage.local.userCardCache. Loaded once,
// passed in/out of enrichProspectsWithUserCard, saved back after.
async function enrichTopResults(results, topN) {
  if (!results?.length) return results;
  const top = results.slice(0, topN);
  const rest = results.slice(topN);
  const { userCardCache = {} } = await chrome.storage.local.get('userCardCache');

  const fetchCard = async (userId) => {
    const res = await fetchUserCardViaTab(userId);
    if (res?.datadomeBlocked) { await notifyDatadomeBlock('user-card'); return null; }
    if (res?.notFound || res?.error || !res?.userData) return null;
    return normalizeUserCard(res.userData, res.proData);
  };

  const { entries: enrichedTop, cache: newCache } = await enrichProspectsWithUserCard({
    entries: top, fetchCard, cache: userCardCache
  });
  await chrome.storage.local.set({ userCardCache: newCache });
  return [...enrichedTop, ...rest];
}

async function profileCreate(name) {
  const { prospectProfiles = [] } = await chrome.storage.local.get('prospectProfiles');
  const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  // New profiles start empty : the user defines their own keywords for their own
  // niche. Score min 0 = pas de filtre score (chaque niche a son propre vocabulaire,
  // notre regex de scoring est calibré pour le profil dev — pas universel).
  const profile = {
    id, name: (name || 'Nouvelle veille').slice(0, 60),
    keywords: [],
    minScore: 1, maxAgeDays: 30, adType: 'demand',
    priceMin: null, priceMax: null,
    departments: [],     // array of FR dept codes (strings : "25", "2A", "75")
    sortOrder: 'score',  // 'score' | 'time' | 'price-asc' | 'price-desc' — display sort
    ownerType: 'all',    // 'all' | 'pro' | 'private'
    shippableOnly: false,
    replyTemplate: ''
  };
  await chrome.storage.local.set({
    prospectProfiles: [...prospectProfiles, profile],
    activeProfileId: id
  });
  return profile;
}

async function profileRename(id, name) {
  const { prospectProfiles = [] } = await chrome.storage.local.get('prospectProfiles');
  const next = prospectProfiles.map(p => p.id === id ? { ...p, name: name.slice(0, 60) } : p);
  await chrome.storage.local.set({ prospectProfiles: next });
}

async function profileDelete(id) {
  const {
    prospectProfiles = [], activeProfileId,
    prospectResultsByProfile = {}, prospectSeenIdsByProfile = {},
    prospectIgnoredIdsByProfile = {}, prospectLastRunByProfile = {}
  } = await chrome.storage.local.get([
    'prospectProfiles', 'activeProfileId',
    'prospectResultsByProfile', 'prospectSeenIdsByProfile',
    'prospectIgnoredIdsByProfile', 'prospectLastRunByProfile'
  ]);
  if (!prospectProfiles.some(p => p.id === id)) throw new Error(`unknown profile id: ${id}`);
  if (prospectProfiles.length <= 1) throw new Error('cannot delete the last profile');
  const next = prospectProfiles.filter(p => p.id !== id);
  const nextActive = activeProfileId === id ? next[0].id : activeProfileId;
  const strip = (obj) => { const { [id]: _, ...rest } = obj; return rest; };
  await chrome.storage.local.set({
    prospectProfiles: next,
    activeProfileId: nextActive,
    prospectResultsByProfile: strip(prospectResultsByProfile),
    prospectSeenIdsByProfile: strip(prospectSeenIdsByProfile),
    prospectIgnoredIdsByProfile: strip(prospectIgnoredIdsByProfile),
    prospectLastRunByProfile: strip(prospectLastRunByProfile)
  });
}

// Surface DataDome captcha hits to the user — silent breaks left them
// wondering why scans returned 0 results. Stored so the popup can show a
// dismissable banner; notification fires at most once per hour.
async function notifyDatadomeBlock(source) {
  const now = Date.now();
  const { datadomeBlock } = await chrome.storage.local.get('datadomeBlock');
  await chrome.storage.local.set({
    datadomeBlock: { at: new Date(now).toISOString(), source }
  });
  const lastNotifAt = datadomeBlock?.notifiedAt ? new Date(datadomeBlock.notifiedAt).getTime() : 0;
  if (now - lastNotifAt < 3600_000) return;
  await chrome.storage.local.set({
    datadomeBlock: { at: new Date(now).toISOString(), source, notifiedAt: new Date(now).toISOString() }
  });
  await chrome.notifications.create(`lbc-datadome-${now}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: '⚠️ Leboncoin a bloqué la requête',
    message: 'DataDome a refusé une requête API. Va sur leboncoin.fr et résous le captcha, puis relance le scan.',
    contextMessage: 'Leboncoin Bumper',
    priority: 2
  });
}

async function maybeNotify(results, seenBefore, settings, profile, ignored = new Set()) {
  if (settings?.notifyOnNew === false) return;
  const minScore = settings?.notifyMinScore ?? 7;
  // Don't notify on ads the user explicitly ignored.
  const fresh = results.filter(r => !seenBefore.has(r.list_id) && !ignored.has(r.list_id) && r.score >= minScore);
  if (!fresh.length) return;

  const top = fresh[0];
  const others = fresh.length - 1;
  const profileSuffix = profile?.name ? ` · ${profile.name}` : '';
  const title = fresh.length === 1
    ? `🎯 Nouveau prospect (score ${top.score})${profileSuffix}`
    : `🎯 ${fresh.length} nouveaux prospects (top score ${top.score})${profileSuffix}`;
  const message = others
    ? `${top.subject}\n— et ${others} autre${others > 1 ? 's' : ''}.`
    : `${top.subject}\n📍 ${top.location || ''}`;

  const id = `lbc-prospect-${Date.now()}`;
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
    contextMessage: 'Leboncoin Bumper',
    priority: 1
  });
  pendingNotificationTarget.set(id, fresh.length === 1 ? top.url : null);
  // Drop oldest entries if user never clicks notifications (memory cap).
  if (pendingNotificationTarget.size > 50) {
    const firstKey = pendingNotificationTarget.keys().next().value;
    pendingNotificationTarget.delete(firstKey);
  }
}

const pendingNotificationTarget = new Map();

chrome.notifications.onClicked.addListener(async (id) => {
  const url = pendingNotificationTarget.get(id);
  pendingNotificationTarget.delete(id);
  await chrome.notifications.clear(id);
  if (url && url.startsWith('https://')) {
    chrome.tabs.create({ url });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?fullpage=1#prospect') });
  }
});

async function rescheduleBump() {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.alarms.clear(BUMP_ALARM);
  if (!settings?.enabled) return;
  // Jitter avoids a perfectly regular weekly signature (DataDome heuristic).
  const jitter = jitterMs(settings.jitterMinutes ?? 60);
  chrome.alarms.create(BUMP_ALARM, {
    when: nextOccurrence(settings.dayOfWeek, settings.hour, settings.minute) + jitter,
    periodInMinutes: 7 * 24 * 60
  });
}

async function rescheduleProspect() {
  const { prospectGlobalSettings: s = {} } = await chrome.storage.local.get('prospectGlobalSettings');
  await chrome.alarms.clear(PROSPECT_ALARM);
  if (!s.enabled) return;
  const jitter = jitterMs(s.jitterMinutes ?? 30);
  const frequency = s.frequency || 'week';
  let whenMs;
  let periodInMinutes;
  if (frequency === 'hour') {
    // Every hour, ~5 min past the start of the next hour
    const next = new Date();
    next.setHours(next.getHours() + 1, 5, 0, 0);
    whenMs = next.getTime();
    periodInMinutes = 60;
  } else if (frequency === 'day') {
    whenMs = nextOccurrenceDaily(s.hour ?? 10, s.minute ?? 0);
    periodInMinutes = 24 * 60;
  } else {
    whenMs = nextOccurrence(s.dayOfWeek ?? 1, s.hour ?? 10, s.minute ?? 0);
    periodInMinutes = 7 * 24 * 60;
  }
  chrome.alarms.create(PROSPECT_ALARM, { when: whenMs + jitter, periodInMinutes });
}

function nextOccurrenceDaily(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function jitterMs(maxMinutes) {
  if (!maxMinutes || maxMinutes <= 0) return 0;
  // Symmetric ±N: half before, half after the nominal slot.
  const span = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * span) - Math.floor(span / 2);
}

function nextOccurrence(dow, hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  const diff = (dow - now.getDay() + 7) % 7;
  target.setDate(now.getDate() + diff);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target.getTime();
}
