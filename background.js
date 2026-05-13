// Two scheduled jobs run independently:
//   - lbc-weekly-bump: deletes & reposts the user's own listings.
//   - lbc-weekly-prospect: scans leboncoin demands matching the user's tech profile.

import { runCycle, listUserAds, checkLoginStatus, fetchAdsViaTab, openReplyForm } from './orchestrator.js';
import { processRawAds, markResultsSeen, DEFAULT_KEYWORDS } from './prospect.js';

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
  (async () => {
    if (msg.type === 'RUN_NOW') {
      sendResponse({ ok: true, result: await runCycle({ trigger: 'manual' }) });
    } else if (msg.type === 'RESCHEDULE') {
      await rescheduleBump();
      sendResponse({ ok: true });
    } else if (msg.type === 'RUN_PROSPECT_NOW') {
      sendResponse({ ok: true, result: await doProspectScan('manual') });
    } else if (msg.type === 'RESCHEDULE_PROSPECT') {
      await rescheduleProspect();
      sendResponse({ ok: true });
    } else if (msg.type === 'MARK_PROSPECTS_SEEN') {
      const { activeProfileId } = await chrome.storage.local.get('activeProfileId');
      await markResultsSeen(msg.results || [], activeProfileId);
      sendResponse({ ok: true });
    } else if (msg.type === 'CHECK_LOGIN') {
      sendResponse({ ok: true, result: await checkLoginStatus() });
    } else if (msg.type === 'REFRESH_LISTINGS') {
      try {
        const out = await listUserAds();
        await chrome.storage.local.set({ myListings: out });
        sendResponse({ ok: true, result: out });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    } else if (msg.type === 'OPEN_REPLY_FORM') {
      try {
        await openReplyForm(msg.listId, msg.message);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    } else if (msg.type === 'PROFILE_CREATE') {
      const out = await profileCreate(msg.name);
      sendResponse({ ok: true, result: out });
    } else if (msg.type === 'PROFILE_RENAME') {
      await profileRename(msg.id, msg.name);
      sendResponse({ ok: true });
    } else if (msg.type === 'PROFILE_DELETE') {
      await profileDelete(msg.id);
      sendResponse({ ok: true });
    } else if (msg.type === 'PROFILE_SET_ACTIVE') {
      await chrome.storage.local.set({ activeProfileId: msg.id });
      sendResponse({ ok: true });
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
  const apiFilters = {
    priceMin: profile.priceMin,
    priceMax: profile.priceMax,
    departments: profile.departments || [],
    sortBy: profile.sortBy || 'time',
    sortOrder: profile.sortOrder || 'desc'
  };
  // Fetch routed through a leboncoin tab — direct SW fetch is 403'd by DataDome.
  const { adsByKeyword, contactedAdIds = [] } = await fetchAdsViaTab(keywords, maxAgeDays, adType, apiFilters);
  // Merge live conversations (API) with the local memory of past contacts
  // (which survives deletion of conversations on leboncoin's side).
  const allContacted = new Set([...contactedAdIds, ...prospectContactedLocal]);
  const out = processRawAds({
    adsByKeyword, maxAgeDays, minScore,
    seenIds: seen, contactedIds: allContacted,
    profileKeywords: keywords,
    ownerType: profile.ownerType || 'all',
    shippableOnly: !!profile.shippableOnly
  });
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

// ── Profile CRUD ───────────────────────────────────────────────────────────

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
    sortBy: 'time',      // 'time' | 'price'
    sortOrder: 'desc',   // 'asc' | 'desc'
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
}

const pendingNotificationTarget = new Map();

chrome.notifications.onClicked.addListener(async (id) => {
  const url = pendingNotificationTarget.get(id);
  pendingNotificationTarget.delete(id);
  await chrome.notifications.clear(id);
  if (url) {
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
  // Compute the next firing slot.
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
