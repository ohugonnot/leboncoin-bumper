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

export async function postNotificationEmail(email, payload, profileId) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await _logEmailError(profileId, 'invalid email');
    return;
  }

  const { buildEmailFromPayload } = await import('./prospect.js');
  const { subject, body } = buildEmailFromPayload(payload);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, _subject: subject, _template: 'table', message: body }),
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      await _logEmailError(profileId, `HTTP ${res.status}`);
      return;
    }
    const json = await res.json();
    if (json?.success === 'true') {
      const { lastEmailErrorByProfile = {} } = await chrome.storage.local.get('lastEmailErrorByProfile');
      delete lastEmailErrorByProfile[profileId];
      await chrome.storage.local.set({ lastEmailErrorByProfile });
    } else {
      await _logEmailError(profileId, json?.message || 'formsubmit error');
    }
  } catch (e) {
    clearTimeout(timer);
    await _logEmailError(profileId, e?.message || String(e));
  }
}

export async function _logEmailError(profileId, error) {
  const { lastEmailErrorByProfile = {} } = await chrome.storage.local.get('lastEmailErrorByProfile');
  lastEmailErrorByProfile[profileId] = { at: new Date().toISOString(), error };
  await chrome.storage.local.set({ lastEmailErrorByProfile });
}
