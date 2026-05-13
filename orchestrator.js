// Drives a single tab through the weekly bump cycle: scrape → delete → repost.
// Critical rule, learned during E2E mapping: NEVER navigate back in the deposit wizard
// after a step has been submitted. Going back and re-submitting creates a duplicate listing.

import { decodeJwt, buildMyAdsPayload, normalizeAd } from './my-ads.js';

const LBC = 'https://www.leboncoin.fr';
const LISTINGS_URL = `${LBC}/compte/part/mes-annonces`;
const DEPOSIT_URL = `${LBC}/deposer-une-annonce`;
const DASHBOARD_API = 'https://api.leboncoin.fr/api/dashboard/v1/search';

export async function runCycle({ trigger }) {
  const { settings } = await chrome.storage.local.get('settings');
  const skipDelete = settings.skipDeleteForTest === true;
  await log(`▶ Cycle started (${trigger}). dryRun=${settings.dryRun}${skipDelete ? ' [skipDelete]' : ''}, onlyAdIds=${JSON.stringify(settings.onlyAdIds)}`);

  let tab;
  let success = 0, failed = 0;
  try {
    tab = await chrome.tabs.create({ url: LISTINGS_URL, active: true });
    await waitForTabLoad(tab.id);

    const { listings } = await scrapeListings(tab.id);
    await log(`Found ${listings.length} listing(s).`);

    let targets = settings.onlyAdIds?.length
      ? listings.filter(l => settings.onlyAdIds.includes(l.id))
      : listings;

    // Paused listings can't be edited via /editer (leboncoin returns an error page).
    // They have to be reactivated by the user first.
    const paused = targets.filter(l => /pause/i.test(l.status || ''));
    if (paused.length) {
      await log(`⚠ ${paused.length} annonce(s) en pause ignorée(s) (à réactiver sur leboncoin avant bump) : ${paused.map(p => p.id).join(', ')}`);
      targets = targets.filter(l => !/pause/i.test(l.status || ''));
    }

    if (!targets.length) {
      await log('Aucune annonce à traiter. Rien à faire.');
      await persistCycleResult({ trigger, count: 0, success: 0, failed: 0 });
      return { ok: true, processed: 0, skipped: paused.length };
    }

    const total = targets.length;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      await chrome.storage.local.set({
        bumpProgress: { adIndex: i + 1, adTotal: total, adTitle: target.title, phase: 'scrape', at: Date.now() }
      });
      await log(`— Listing ${target.id} ("${target.title.slice(0, 40)}", cat=${target.catSlug})`);
      try {
        const data = await scrapeEditPage(tab.id, target.id);
        data.catSlug = target.catSlug;
        await log(`  scraped: ${data.photos.length} photos, ${data.body.length} body chars`);

        if (settings.dryRun) {
          await log('  [dry-run] would delete + repost. Skipping.');
          success++;
          continue;
        }

        if (skipDelete) {
          await log('  [skipDelete] delete skipped — testing wizard only. L\'annonce originale reste en ligne, un doublon va être créé.');
        } else {
          await chrome.storage.local.set({
            bumpProgress: { adIndex: i + 1, adTotal: total, adTitle: target.title, phase: 'delete', at: Date.now() }
          });
          await deleteListing(tab.id, target.id);
          await log('  deleted.');
        }

        await chrome.storage.local.set({
          bumpProgress: { adIndex: i + 1, adTotal: total, adTitle: target.title, phase: 'repost', at: Date.now() }
        });
        await repostListing(tab.id, data);
        await log('  reposted (in moderation).');
        success++;
      } catch (itemErr) {
        failed++;
        await log(`  ✗ failed: ${itemErr.message}`);
      }
    }

    await log(`✓ Cycle done. ${success} success, ${failed} failed.`);
    await persistCycleResult({ trigger, count: total, success, failed });
    return { ok: true, processed: total, success, failed };
  } catch (err) {
    await log(`✗ Cycle failed: ${err.message}`);
    await persistCycleResult({ trigger, count: 0, success, failed });
    return { ok: false, error: err.message, success, failed };
  } finally {
    await chrome.storage.local.remove('bumpProgress');
    if (tab?.id) {
      const { settings: s } = await chrome.storage.local.get('settings');
      if (!s.dryRun) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function persistCycleResult({ trigger, count, success, failed }) {
  const lastRun = { ts: Date.now(), trigger, count, success, failed };
  const { bumpHistory = [] } = await chrome.storage.local.get('bumpHistory');
  const nextHistory = [lastRun, ...bumpHistory].slice(0, 20);
  await chrome.storage.local.set({ lastBumpRun: lastRun, bumpHistory: nextHistory });
}

/**
 * Scrape the listings on the given tab. The tab MUST already be on /mes-annonces
 * and fully loaded — the caller is responsible for navigation + waiting.
 */
async function scrapeListings(tabId) {
  // Make sure cards have actually rendered (SPA hydration can lag past status=complete)
  await waitForSelector(tabId, 'li[data-qa-id="ad_item_container"]', 10000).catch(() => {});
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const dedupHalf = (s) => {
        s = (s || '').trim().replace(/\s+/g, ' ');
        if (s.length < 20) return s;
        const probeLen = Math.min(30, Math.floor(s.length / 3));
        const probe = s.slice(0, probeLen);
        const second = s.indexOf(probe, probeLen);
        return second > 0 ? s.slice(0, second).trim() : s;
      };
      const listings = [...document.querySelectorAll('li[data-qa-id="ad_item_container"]')].map(card => {
        const link = card.querySelector('a[href*="/ad/"]');
        const href = link?.getAttribute('href') || '';
        const m = href.match(/^\/ad\/([^/]+)\/(\d+)$/);
        const img = card.querySelector('img')?.src || null;
        const title = dedupHalf(link?.textContent || '');
        // Status detection: the card contains action buttons that imply state.
        // "Mettre en pause" button → ad is currently online.
        // "Mettre en ligne" / "Réactiver" / "Republier" → ad is paused.
        // Earlier regex matched the action button text and produced false positives
        // ("Mettre en pause" matches /En pause/i → all ads flagged as paused).
        const btnTexts = [...card.querySelectorAll('button')].map(b => b.textContent.trim());
        const hasPauseAction = btnTexts.some(t => /^mettre en pause$/i.test(t));
        const hasResumeAction = btnTexts.some(t => /mettre en ligne|r[ée]activer|republier/i.test(t));
        let statusText = null;
        if (hasResumeAction) statusText = 'En pause';
        else if (hasPauseAction) statusText = 'En ligne';
        else if (/En cours de v[ée]rification/i.test(card.textContent)) statusText = 'En cours de vérification';
        else if (/Expir[ée]e/i.test(card.textContent)) statusText = 'Expirée';
        return { id: m?.[2], catSlug: m?.[1] || null, title, href, thumbnail: img, status: statusText };
      }).filter(x => x.id);
      // Pseudo : the listings page header shows "Bonjour <pseudo>" or similar.
      // We probe a few possible selectors; null is fine, it's just a nice-to-have.
      let pseudo = null;
      try {
        pseudo = document.body.innerText.match(/Bonjour\s+([A-Za-zÀ-ÿ0-9_\-\.\s]{2,30})/)?.[1]?.trim()
              || document.querySelector('[data-qa-id="user-pseudo"], [data-test-id="account-name"]')?.textContent?.trim()
              || null;
      } catch { /* ignore */ }
      return { listings, pseudo };
    }
  });
  return result;
}

/**
 * Standalone helper: open a background tab on /mes-annonces, scrape the list,
 * close the tab. Used by the popup's listings picker.
 *
 * @returns {Promise<{listings: object[], fetchedAt: string}>}
 */
export async function listUserAds() {
  const tab = await chrome.tabs.create({ url: LISTINGS_URL, active: false });
  try {
    await waitForTabLoad(tab.id);
    const { listings, pseudo } = await scrapeListings(tab.id);
    return { listings, pseudo, fetchedAt: new Date().toISOString() };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Fetch all of the user's own listings via the private dashboard API.
 * Must run via a real leboncoin tab — same reason as fetchInboxViaTab (DataDome).
 *
 * Paginates automatically until all ads are fetched (offset >= total).
 *
 * @returns {Promise<{listings: object[], pseudo: string|null, fetchedAt: string}>}
 */
export async function fetchMyAdsViaApi() {
  const tab = await chrome.tabs.create({ url: LBC + '/', active: false });
  try {
    await waitForTabLoad(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [DASHBOARD_API],
      func: async (apiUrl) => {
        const jwt = localStorage.getItem('luat');
        if (!jwt) throw new Error('luat absent du localStorage — utilisateur non connecté');

        // Decode JWT payload (no signature verification needed).
        const parts = jwt.split('.');
        if (parts.length < 2) throw new Error('JWT malformé');
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        const userId = payload.account_id;
        if (!userId) throw new Error('account_id absent du JWT');

        const headers = {
          'Authorization': `Bearer ${jwt}`,
          'content-type': 'application/json'
        };

        let allAds = [];
        let offset = 0;
        const limit = 100;
        let total = null;

        do {
          const body = JSON.stringify({
            context: 'default',
            filters: { owner: { user_id: userId } },
            limit,
            offset,
            sort_by: 'time',
            sort_order: 'desc',
            include_inactive: true,
            include_draft: true
          });
          const res = await fetch(apiUrl, { method: 'POST', headers, body });
          if (!res.ok) throw new Error(`dashboard API returned ${res.status}`);
          const data = await res.json();
          if (total === null) total = data.total ?? 0;
          allAds = allAds.concat(data.ads ?? []);
          offset += limit;
          if (offset < total) await new Promise(r => setTimeout(r, 250));
        } while (offset < total);

        // Pseudo from the owner name on the first ad (consistent across ads).
        const pseudo = allAds[0]?.owner?.name ?? null;
        return { rawAds: allAds, pseudo };
      }
    });
    const listings = (result.rawAds || []).map(normalizeAd);
    return { listings, pseudo: result.pseudo ?? null, fetchedAt: new Date().toISOString() };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Login state derived from the cached listings fetch.
 *
 * The previous strategy (direct fetch from the service worker) was blocked by
 * DataDome's anti-bot challenge — the SW fetch lacks the JS execution context
 * DataDome expects, so even an authenticated user got `loggedIn: false`.
 * `listUserAds()` works because it uses a real tab, which DataDome accepts.
 *
 * @returns {Promise<{loggedIn: boolean, pseudo?: string, stale?: boolean}>}
 */
export async function checkLoginStatus() {
  const { myListings } = await chrome.storage.local.get('myListings');
  if (!myListings?.listings?.length) return { loggedIn: false };
  const ageMs = Date.now() - new Date(myListings.fetchedAt || 0).getTime();
  const stale = ageMs > 7 * 24 * 3600 * 1000;
  return { loggedIn: true, pseudo: myListings.pseudo || null, stale };
}

/**
 * Fetch raw ads from /finder/search for each keyword + the user's existing
 * conversations (so we can flag prospects already contacted). Runs inside a
 * real leboncoin tab because DataDome rejects fetches from
 * `chrome-extension://` origins with a 403 + captcha challenge.
 *
 * @returns {Promise<{adsByKeyword: Object, contactedAdIds: string[]}>}
 */
export async function fetchAdsViaTab(keywords, maxAgeDays = 30, adType = 'demand', apiFilters = {}) {
  const tab = await chrome.tabs.create({ url: LBC + '/', active: false });
  try {
    await waitForTabLoad(tab.id);
    const adTypes = adType === 'both' ? ['demand', 'offer'] : [adType];
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [keywords, maxAgeDays, adTypes, apiFilters],
      func: async (kws, maxAge, adTypesEnum, extra) => {
        // Serialized into the tab context — cannot import from prospect.js.
        // Same public key visible in every browser request to LBC.
        const API_URL = 'https://api.leboncoin.fr/finder/search';
        const API_KEY = 'ba0c2dad52b3ec';
        const ageDays = (iso) => {
          if (!iso) return null;
          const d = new Date(String(iso).replace(' ', 'T'));
          return isNaN(d.getTime()) ? null : (Date.now() - d.getTime()) / 86400000;
        };

        // 1) Existing conversations — one global call. The Bearer JWT lives in
        //    localStorage.luat, the userId is in cookie lbc_user_id. The same
        //    request from a chrome-extension:// origin returns 401 (no token),
        //    that's why this whole function runs inside the lbc tab.
        let contactedAdIds = [];
        try {
          const jwt = localStorage.getItem('luat');
          const userIdCookie = document.cookie.split(';').map(s => s.trim())
            .find(s => s.startsWith('lbc_user_id='));
          const userId = userIdCookie ? decodeURIComponent(userIdCookie.split('=')[1]) : null;
          if (jwt && userId) {
            const cRes = await fetch(`https://api.leboncoin.fr/messaging/proxy/api/v1/hal/${userId}/conversations?presenceStatus=true`, {
              headers: { authorization: `Bearer ${jwt}`, accept: 'application/hal+json' },
              credentials: 'include'
            });
            if (cRes.ok) {
              const cData = await cRes.json();
              const convs = cData?._embedded?.conversations || [];
              contactedAdIds = convs.map(c => String(c.itemId || '')).filter(Boolean);
            }
          }
        } catch { /* non-fatal — just won't tag */ }

        const adsByKeyword = {};
        for (let i = 0; i < kws.length; i++) {
          const kw = kws[i];
          const items = [];
          let offset = 0;
          for (let page = 0; page < 10; page++) {
            await chrome.storage.local.set({
              prospectScanProgress: {
                kwIndex: i + 1,
                kwTotal: kws.length,
                kw,
                page: page + 1,
                pageMax: 10,
                found: items.length,
                at: Date.now()
              }
            });
            let data;
            try {
              // Build dynamic filters from per-profile config
              const filters = { enums: { ad_type: adTypesEnum }, keywords: { text: kw } };
              if (extra.priceMin != null || extra.priceMax != null) {
                const price = {};
                if (extra.priceMin != null) price.min = Number(extra.priceMin);
                if (extra.priceMax != null) price.max = Number(extra.priceMax);
                filters.ranges = { price };
              }
              if (Array.isArray(extra.departments) && extra.departments.length) {
                filters.location = { departments: extra.departments };
              }
              const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'api_key': API_KEY },
                credentials: 'include',
                body: JSON.stringify({
                  // Always time-desc : pagination bails on age cutoff. Display
                  // sort is applied post-fetch in sortEntries().
                  sort_by: 'time', sort_order: 'desc',
                  limit: 100, offset, filters
                })
              });
              if (!res.ok) break;
              data = await res.json();
            } catch { break; }
            const ads = data?.ads ?? [];
            if (!ads.length) break;
            items.push(...ads);
            const oldest = ageDays(ads[ads.length - 1]?.first_publication_date);
            if (oldest !== null && oldest > maxAge) break;
            offset += 100;
            if (offset >= (data.total ?? 0)) break;
            await new Promise(r => setTimeout(r, 250));
          }
          adsByKeyword[kw] = items;
        }
        await chrome.storage.local.remove('prospectScanProgress');
        return { adsByKeyword, contactedAdIds };
      }
    });
    return result;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Fetch the user's inbox conversations from leboncoin's messaging API.
 *
 * Must run via a real leboncoin tab: the Bearer JWT lives in localStorage.luat
 * and the userId is in cookie lbc_user_id — both unavailable from the SW
 * origin. The tab is opened in the background and closed after the fetch.
 *
 * Conversation shape (real API fields, verified 2026-05):
 *   conversationId, itemId, subject, partnerName,
 *   lastMessagePreview, lastMessageDate, unseenCounter
 *
 * @returns {Promise<{conversations: object[], at: number}>}
 */
export async function fetchInboxViaTab() {
  const tab = await chrome.tabs.create({ url: LBC + '/', active: false });
  try {
    await waitForTabLoad(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const jwt = localStorage.getItem('luat');
        const userIdCookie = document.cookie.split(';').map(s => s.trim())
          .find(s => s.startsWith('lbc_user_id='));
        const userId = userIdCookie ? decodeURIComponent(userIdCookie.split('=')[1]) : null;
        if (!jwt || !userId) throw new Error('Not authenticated — luat or lbc_user_id missing');

        const BASE = 'https://api.leboncoin.fr';
        const headers = { authorization: `Bearer ${jwt}`, accept: 'application/hal+json' };
        const MAX_PAGES = 50;

        let nextUrl = `${BASE}/messaging/proxy/api/v1/hal/${userId}/conversations?presenceStatus=true`;
        const allConversations = [];
        let pages = 0;

        while (nextUrl && pages < MAX_PAGES) {
          const r = await fetch(nextUrl, { headers, credentials: 'include' });
          if (!r.ok) throw new Error(`Inbox API returned ${r.status}`);
          const d = await r.json();
          allConversations.push(...(d?._embedded?.conversations || []));
          pages++;
          // _links.next is null or absent on the last page
          const rawNext = d?._links?.next?.href ?? null;
          if (!rawNext) break;
          // Prefix relative paths (e.g. /messaging/proxy/...?continuationToken=...)
          nextUrl = rawNext.startsWith('http') ? rawNext : BASE + rawNext;
          if (pages < MAX_PAGES) await new Promise(r => setTimeout(r, 250));
        }

        return allConversations;
      }
    });
    return { conversations: result || [], at: Date.now() };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Open leboncoin's /reply/{adId} form pre-filled with `message` and bring the
 * tab to the foreground so the user can review and click "Envoyer".
 *
 * We do NOT auto-submit — the user always validates the message themselves.
 */
export async function openReplyForm(adId, message) {
  if (!adId) throw new Error('missing adId');
  const tab = await chrome.tabs.create({ url: `${LBC}/reply/${adId}`, active: true });
  // Wait for the form to render, then inject the message.
  await waitForTabLoad(tab.id);
  await waitForSelector(tab.id, 'textarea[name="body"], textarea#body', 8000).catch(() => {});
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [message],
    func: (msg) => {
      const ta = document.querySelector('textarea[name="body"], textarea#body');
      if (!ta) return;
      // React-controlled textarea : use the native setter then dispatch input
      // event so React picks up the new value.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, msg);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      ta.focus();
    }
  });
  return tab.id;
}

async function scrapeEditPage(tabId, adId) {
  await navigate(tabId, `${LBC}/annonce/${adId}/editer`);
  await waitForSelector(tabId, 'input[name="subject"]');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const get = (sel) => document.querySelector(sel)?.value || '';
      return {
        subject: get('input[name="subject"]'),
        body: document.querySelector('textarea[name="body"]')?.value || '',
        price: get('input[name="price"]'),
        location: get('input[name="location"]'),
        phoneHidden: document.querySelector('input[name="phone_hidden"]')?.checked || false,
        photos: [...new Set(
          [...document.querySelectorAll('img')]
            .map(i => i.src)
            .filter(s => s.includes('img.leboncoin.fr/api/v1/lbcpb1'))
            .map(s => s.replace(/\?rule=[^&]+/, '?rule=ad-large'))
        )]
      };
    }
  });
  return { adId, ...result };
}

async function deleteListing(tabId, adId) {
  await navigate(tabId, LISTINGS_URL);
  await waitForSelector(tabId, 'li[data-qa-id="ad_item_container"]');

  await chrome.scripting.executeScript({
    target: { tabId },
    args: [adId],
    func: (id) => {
      const cards = [...document.querySelectorAll('li[data-qa-id="ad_item_container"]')];
      const card = cards.find(c =>
        c.querySelector('a[href*="/ad/"]')?.getAttribute('href')?.endsWith('/' + id)
      );
      if (!card) throw new Error('listing card not found: ' + id);
      const del = [...card.querySelectorAll('a[title="Supprimer"]')]
        .find(a => a.offsetParent !== null);
      if (!del) throw new Error('delete link not visible on card ' + id);
      del.click();
    }
  });

  await waitForUrl(tabId, /\/compte\/mes-annonces\/suppression/);
  await waitForSelector(tabId, 'button[data-qa-id="button-delete-confirm"]');

  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.querySelector('button[data-qa-id="button-delete-confirm"]').click();
    }
  });

  // Confirmation page shows "demande de suppression a bien été prise en compte"
  await waitForText(tabId, 'a bien été prise en compte', 10000);
}

async function repostListing(tabId, data) {
  await navigate(tabId, DEPOSIT_URL);
  await waitForSelector(tabId, 'input[name="subject"]');
  await log('    [wizard] step 1: subject + category');

  await fillField(tabId, 'input[name="subject"]', data.subject);
  await waitForSelector(tabId, 'input[type="radio"]', 8000).catch(() => {});
  await sleep(1200);

  const [{ result: radioPick }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [data.catSlug],
    func: (slug) => {
      const wanted = (slug || '').replace(/_/g, ' ').toLowerCase();
      const radios = [...document.querySelectorAll('input[type="radio"]')];
      const labels = radios.map(r => (r.closest('label') || r.parentElement)?.textContent?.trim().toLowerCase() || '');
      const matchIdx = labels.findIndex(l => l.endsWith(wanted));
      if (matchIdx >= 0) { radios[matchIdx].click(); return { matched: true, label: labels[matchIdx], suggestions: labels }; }
      return { matched: false, suggestions: labels };
    }
  });
  if (!radioPick.matched) {
    throw new Error(`Catégorie "${data.catSlug}" non suggérée par LBC. Suggestions : ${radioPick.suggestions.join(' | ')}. Renomme l'annonce pour matcher.`);
  }
  await log(`    [wizard] step 1: category matched "${radioPick.label}"`);
  await sleep(800);

  // Step 2: photos. Some categories now show the photo step inline after radio
  // click (no "Continuer" needed). The single `input[type="file"]` with
  // multiple=true accepts all photos at once; LBC orders them as cover, side
  // views, etc. Defensive: also handle multi-input designs (1 input per slot).
  await waitForSelector(tabId, 'input[type="file"]', 15000);
  await log(`    [wizard] step 2: file input found, uploading ${data.photos.length} photo(s)`);
  await uploadPhotos(tabId, data.photos);
  await sleep(1500);
  await clickContinue(tabId);
  await log('    [wizard] step 2: photos uploaded, continued');

  await waitForSelector(tabId, 'textarea[name="body"]');
  await fillField(tabId, 'textarea[name="body"]', data.body);
  await sleep(300);
  await clickContinue(tabId);
  await log('    [wizard] step 3: description filled');

  await waitForSelector(tabId, 'input[name="price"]');
  await fillField(tabId, 'input[name="price"]', data.price || '0');
  await sleep(300);
  await clickContinue(tabId);
  await log('    [wizard] step 4: price filled');

  await waitForSelector(tabId, 'input[name="location"]');
  await fillField(tabId, 'input[name="location"]', data.location);
  await sleep(1500);
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [data.location],
    func: (loc) => {
      const want = (loc || '').trim().toLowerCase();
      const items = [...document.querySelectorAll('li, button, [role="option"]')]
        .filter(el => el.offsetParent !== null);
      const exact = items.find(el => (el.textContent || '').trim().toLowerCase() === want);
      const target = exact || items.find(el => (el.textContent || '').toLowerCase().includes(want));
      if (!target) throw new Error('location suggestion not found for: ' + loc);
      target.click();
    }
  });
  await sleep(300);
  await clickContinue(tabId);
  await log('    [wizard] step 5: location filled');

  await waitForSelector(tabId, 'input[name="phone_hidden"]');
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [data.phoneHidden],
    func: (hidden) => {
      const cb = document.querySelector('input[name="phone_hidden"]');
      if (!cb) return;
      if (cb.checked !== hidden) cb.click();
    }
  });
  await sleep(200);
  await clickContinue(tabId);
  await log('    [wizard] step 6: contact prefs set');

  await waitForUrl(tabId, /\/options/);
  await sleep(800);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const btn = [...document.querySelectorAll('button, a')]
        .find(b => /sans booster|gratuitement|d[ée]poser sans/i.test(b.textContent || ''));
      if (!btn) throw new Error('"Déposer sans booster" button not found');
      btn.click();
    }
  });

  await waitForUrl(tabId, /\/confirmation/);
  await waitForText(tabId, 'bien reçu votre annonce', 15000);
}

async function uploadPhotos(tabId, photoUrls) {
  if (!photoUrls?.length) return;
  const payload = [];
  for (const url of photoUrls) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`photo fetch failed (${resp.status}): ${url}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    payload.push({ b64: btoa(bin), type: resp.headers.get('content-type') || 'image/jpeg' });
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [payload],
    func: (items) => {
      const decode = (it, i) => {
        const bin = atob(it.b64);
        const buf = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) buf[j] = bin.charCodeAt(j);
        const ext = (it.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        return new File([buf], `photo-${i + 1}.${ext}`, { type: it.type });
      };
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      if (inputs.length === 0) throw new Error('Aucun input[type=file] sur la page photos');
      // Cas A : un seul input multiple → LBC range les photos par ordre (cover, vues, …).
      // Cas B : plusieurs inputs single → une photo par input dans l'ordre (futur-proof).
      if (inputs.length === 1 && inputs[0].multiple !== false) {
        const dt = new DataTransfer();
        items.forEach((it, i) => dt.items.add(decode(it, i)));
        inputs[0].files = dt.files;
        inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        items.forEach((it, i) => {
          if (i >= inputs.length) return;
          const dt = new DataTransfer();
          dt.items.add(decode(it, i));
          inputs[i].files = dt.files;
          inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
    }
  });
}

async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoad(tabId);
}

function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise(async (resolve, reject) => {
    // Tab might already be loaded by the time we attach the listener.
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete') {
        setTimeout(resolve, 800);
        return;
      }
    } catch { /* tab gone */ }
    const t0 = Date.now();
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearInterval(timer);
        setTimeout(resolve, 800);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setInterval(() => {
      if (Date.now() - t0 > timeoutMs) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearInterval(timer);
        reject(new Error('tab load timeout'));
      }
    }, 500);
  });
}

async function waitForSelector(tabId, selector, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, args: [selector],
      func: (sel) => !!document.querySelector(sel)
    });
    if (result) return;
    await sleep(250);
  }
  throw new Error('selector timeout: ' + selector);
}

async function waitForText(tabId, text, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, args: [text],
      func: (t) => document.body.textContent.includes(t)
    });
    if (result) return;
    await sleep(300);
  }
  throw new Error('text timeout: ' + text);
}

async function waitForUrl(tabId, regex, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = await chrome.tabs.get(tabId);
    if (regex.test(t.url || '')) {
      await sleep(800);
      return;
    }
    await sleep(250);
  }
  throw new Error('url timeout: ' + regex);
}

async function fillField(tabId, selector, value) {
  await chrome.scripting.executeScript({
    target: { tabId }, args: [selector, value],
    func: (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('field not found: ' + sel);
      // Use the native setter so React state updates correctly.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

async function clickContinue(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => /^continuer$/i.test((b.textContent || '').trim()));
      if (!btn) throw new Error('Continuer button not found');
      btn.click();
    }
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function log(message) {
  const ts = new Date().toISOString();
  const { log: existing = [] } = await chrome.storage.local.get('log');
  await chrome.storage.local.set({ log: [...existing, { ts, message }].slice(-200) });
  console.log('[lbc-bumper]', ts, message);
}
