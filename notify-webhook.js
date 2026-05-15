export async function postNotificationWebhook(url, payload, profileId) {
  // Accept http (local proxy) and https only.
  let parsed;
  try { parsed = new URL(url); } catch {
    await _logWebhookError(profileId, 'invalid URL');
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    await _logWebhookError(profileId, `unsupported protocol: ${parsed.protocol}`);
    return;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      await _logWebhookError(profileId, `HTTP ${res.status}`);
    } else {
      // Clear any previous error on success.
      const { lastWebhookErrorByProfile = {} } = await chrome.storage.local.get('lastWebhookErrorByProfile');
      delete lastWebhookErrorByProfile[profileId];
      await chrome.storage.local.set({ lastWebhookErrorByProfile });
    }
  } catch (e) {
    clearTimeout(timer);
    await _logWebhookError(profileId, e?.message || String(e));
  }
}

export async function _logWebhookError(profileId, error) {
  const { lastWebhookErrorByProfile = {} } = await chrome.storage.local.get('lastWebhookErrorByProfile');
  lastWebhookErrorByProfile[profileId] = { at: new Date().toISOString(), error };
  await chrome.storage.local.set({ lastWebhookErrorByProfile });
}
