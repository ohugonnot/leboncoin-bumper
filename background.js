// Two scheduled jobs run independently:
//   - lbc-weekly-bump: deletes & reposts the user's own listings.
//   - lbc-weekly-prospect: scans leboncoin demands matching the user's tech profile.

import { runCycle, listUserAds, checkLoginStatus, fetchAdsViaTab } from './orchestrator.js';
import { processRawAds, markResultsSeen, DEFAULT_KEYWORDS } from './prospect.js';

const BUMP_ALARM = 'lbc-weekly-bump';
const PROSPECT_ALARM = 'lbc-weekly-prospect';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['settings', 'prospectSettings']);
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
  if (!stored.prospectSettings) {
    await chrome.storage.local.set({
      prospectSettings: {
        enabled: false,
        dayOfWeek: 1, hour: 10, minute: 0,
        maxAgeDays: 30, minScore: 5,
        keywords: DEFAULT_KEYWORDS,
        notifyOnNew: true,
        notifyMinScore: 7
      },
      prospectSeenIds: [],
      prospectResults: [],
      prospectLastRun: null
    });
  }
  await rescheduleBump();
  await rescheduleProspect();
});

chrome.runtime.onStartup.addListener(async () => {
  await rescheduleBump();
  await rescheduleProspect();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BUMP_ALARM) {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings?.enabled) await runCycle({ trigger: 'alarm' });
    await rescheduleBump();
  } else if (alarm.name === PROSPECT_ALARM) {
    const { prospectSettings } = await chrome.storage.local.get('prospectSettings');
    if (prospectSettings?.enabled) await doProspectScan('alarm');
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
      await markResultsSeen(msg.results || []);
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
    }
  })();
  return true;
});

async function doProspectScan(trigger) {
  const { prospectSettings, prospectSeenIds = [] } = await chrome.storage.local.get(['prospectSettings', 'prospectSeenIds']);
  const seen = new Set(prospectSeenIds);
  const keywords = prospectSettings.keywords || DEFAULT_KEYWORDS;
  const maxAgeDays = prospectSettings.maxAgeDays || 30;
  const minScore = prospectSettings.minScore || 5;
  // Fetch routed through a leboncoin tab — direct SW fetch is 403'd by DataDome.
  const adsByKeyword = await fetchAdsViaTab(keywords, maxAgeDays);
  const out = processRawAds({ adsByKeyword, maxAgeDays, minScore, seenIds: seen });
  await chrome.storage.local.set({
    prospectResults: out.results,
    prospectLastRun: { ts: new Date().toISOString(), trigger, total: out.total, scanned: out.scannedKeywords }
  });
  await maybeNotify(out.results, seen, prospectSettings);
  return out;
}

async function maybeNotify(results, seenBefore, settings) {
  if (settings?.notifyOnNew === false) return;
  const minScore = settings?.notifyMinScore ?? 7;
  const fresh = results.filter(r => !seenBefore.has(r.list_id) && r.score >= minScore);
  if (!fresh.length) return;

  const top = fresh[0];
  const others = fresh.length - 1;
  const title = fresh.length === 1
    ? `🎯 Nouveau prospect (score ${top.score})`
    : `🎯 ${fresh.length} nouveaux prospects (top score ${top.score})`;
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
  const { prospectSettings } = await chrome.storage.local.get('prospectSettings');
  await chrome.alarms.clear(PROSPECT_ALARM);
  if (!prospectSettings?.enabled) return;
  const jitter = jitterMs(prospectSettings.jitterMinutes ?? 30);
  chrome.alarms.create(PROSPECT_ALARM, {
    when: nextOccurrence(prospectSettings.dayOfWeek, prospectSettings.hour, prospectSettings.minute) + jitter,
    periodInMinutes: 7 * 24 * 60
  });
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
