// Two scheduled jobs run independently:
//   - lbc-weekly-bump: deletes & reposts the user's own listings.
//   - lbc-weekly-prospect: scans leboncoin demands matching the user's tech profile.

import { runCycle, listUserAds, checkLoginStatus } from './orchestrator.js';
import { runProspectScan, markResultsSeen, DEFAULT_KEYWORDS } from './prospect.js';

const BUMP_ALARM = 'lbc-weekly-bump';
const PROSPECT_ALARM = 'lbc-weekly-prospect';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['settings', 'prospectSettings']);
  if (!stored.settings) {
    await chrome.storage.local.set({
      settings: {
        enabled: false, dryRun: true,
        dayOfWeek: 1, hour: 9, minute: 0, onlyAdIds: []
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
        keywords: DEFAULT_KEYWORDS
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
  const out = await runProspectScan({
    keywords: prospectSettings.keywords || DEFAULT_KEYWORDS,
    maxAgeDays: prospectSettings.maxAgeDays || 30,
    minScore: prospectSettings.minScore || 5,
    seenIds: seen
  });
  await chrome.storage.local.set({
    prospectResults: out.results,
    prospectLastRun: { ts: new Date().toISOString(), trigger, total: out.total, scanned: out.scannedKeywords }
  });
  return out;
}

async function rescheduleBump() {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.alarms.clear(BUMP_ALARM);
  if (!settings?.enabled) return;
  chrome.alarms.create(BUMP_ALARM, {
    when: nextOccurrence(settings.dayOfWeek, settings.hour, settings.minute),
    periodInMinutes: 7 * 24 * 60
  });
}

async function rescheduleProspect() {
  const { prospectSettings } = await chrome.storage.local.get('prospectSettings');
  await chrome.alarms.clear(PROSPECT_ALARM);
  if (!prospectSettings?.enabled) return;
  chrome.alarms.create(PROSPECT_ALARM, {
    when: nextOccurrence(prospectSettings.dayOfWeek, prospectSettings.hour, prospectSettings.minute),
    periodInMinutes: 7 * 24 * 60
  });
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
