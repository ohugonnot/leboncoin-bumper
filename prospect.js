// SPDX-License-Identifier: MIT
//
// Prospect Watch — passive weekly scan of leboncoin demands matching a
// configurable tech profile. Calls leboncoin's public /finder/search API
// (one POST per keyword), scores ad titles + bodies, and deduplicates
// against previously-seen ad IDs to surface only what is new.
//
// All exports are pure functions wherever possible (no chrome.* access)
// so they can be exercised by Node's built-in test runner.

const API_URL = 'https://api.leboncoin.fr/finder/search';
// Leboncoin's public web-client API key — visible in every browser request.
// It is not a secret; embedding it here keeps the extension self-contained.
const API_KEY = 'ba0c2dad52b3ec';

/** Default keyword set, tuned for a French full-stack/backend developer profile. */
export const DEFAULT_KEYWORDS = [
  'wordpress','prestashop','shopify','magento','symfony','laravel',
  'php','javascript','python','golang','typescript','react native','vuejs',
  'développeur','programmeur','informaticien','webmaster','informatique',
  'développement','application','appli','site web','site internet',
  'projet web','création site','logiciel','code',
  'wordpress aide','aide site','intelligence artificielle','chatgpt','ia',
  'crypto','bitcoin','trading','blockchain','automatisation','automatiser',
  'scraping','n8n','no-code','excel','vba','macro',
  'retrogaming','rétrogaming','émulateur','lunii',
  'domotique','home assistant','raspberry',
  'ffmpeg','montage vidéo','elasticsearch',
  'freelance','mission tech','e-commerce','seo','réparation informatique',
  'bot discord','wix','mobile android'
];

/** Strong tech signals — when present in title or body, add a high score boost. */
export const STRONG_SIGNALS = /\b(symfony|laravel|wordpress|prestashop|magento|shopify|opencart|woocommerce|php\d?\b|golang|nodejs|node\.js|typescript|reactjs|react native|vuejs|vue\.js|fastapi|django|flask|nextjs|next\.js|nuxt|angular|webmaster|fullstack|backend|frontend|ffmpeg|elasticsearch|kubernetes|docker|terraform|aws lambda|chatgpt|openai|llm|prompt engineer|claude\.ai|gemini api|mistral|algo[- ]trading|trading bot|blockchain|web3|nft|defi|smart contract|home assistant|jeedom|raspberry pi|arduino|esp32|esp8266|retropie|recalbox|émulateur|emulateur|retrogaming|r[ée]trogaming|pincab|n8n|zapier|make\.com|automatis|web scrap|scraping|crawler|vba|macro excel|google sheets|tableur complexe|développeur|programmeur|développement web|développement mobile|création de site|cr[ée]ation site|cr[ée]ation web|site internet|site web|application web|application mobile|api rest|crm wordpress|cours d['’]?informatique|aide informatique|formation informatique|lunii|conteuse audio)\b/i;

/** Moderate signals — broader IT vocabulary, smaller boost. */
export const MODERATE_SIGNALS = /\b(informatique|ordinateur|logiciel|programmation|code source|site marchand|boutique en ligne|e-commerce|seo\b|référencement|panne pc|réparation pc|dépannage informatique|maintenance pc)\b/i;

/** Negative signals — appearance in title OR body drops the ad entirely. */
export const NEG_SIGNALS = /\b(m[ée]nage|repassage|jardinage|cuisinier|cuisini[èe]re|chef de cuisine|bardeur|couvreur|carrelag|maçonnerie|plomberie|électricien|mécanicien|garde enfant|nounou|baby[- ]sitting|d[ée]m[ée]nagement|chauffeur|saxophon|guitare|piano|chant\b|musicien|colocation|maison\b|appartement|chambre\b|studio\b|tondre|gravât|épave|agricole|ouvrier\b|pelouse|couturi[èe]re|cours d['’]anglais|cours de fran[çc]ais|cours de math|soutien scolaire|aide aux devoirs|primaire|coll[èe]ge\b|aide soignant|infirmier|gardiennage|massage|barman|aide à domicile|écharpe|bijou|figurant|mannequin)\b/i;

/** Titles that start with these words look like genuine demands. */
export const DEMAND_PREFIX = /^(cherche|recherche|besoin|aide |aidez|demande|qui veut|qui peut)/i;

/**
 * Score an ad based on title + body content.
 * Pure function — no IO, deterministic, easy to test.
 *
 * @param {string} title  Ad subject (leboncoin field `subject`).
 * @param {string} body   Ad body (leboncoin field `body`).
 * @returns {number}      0 if the ad should be dropped, otherwise a positive score.
 */
export function scoreAd(title, body) {
  if (!title || title.trim().length < 8) return 0;
  if (NEG_SIGNALS.test(title) || NEG_SIGNALS.test(body || '')) return 0;
  let score = 0;
  if (STRONG_SIGNALS.test(title)) score += 5;
  if (STRONG_SIGNALS.test(body || '')) score += 3;
  if (MODERATE_SIGNALS.test(title)) score += 2;
  if (MODERATE_SIGNALS.test(body || '')) score += 1;
  if (DEMAND_PREFIX.test(title)) score += 2;
  return score;
}

/**
 * Number of full days between an ISO-ish date string and now.
 * Accepts leboncoin's "YYYY-MM-DD HH:MM:SS" naive format and ISO 8601.
 *
 * @param {string|null|undefined} iso
 * @param {Date} [now=new Date()]
 * @returns {number|null}  fractional days, or null if unparseable.
 */
export function ageDays(iso, now = new Date()) {
  if (!iso) return null;
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / 86400000;
}

/**
 * Build the JSON body sent to /finder/search for one keyword + offset.
 * Pure helper, exported for testing.
 */
export function buildSearchPayload({ keyword, offset = 0, limit = 100 }) {
  return {
    sort_by: 'time', sort_order: 'desc', limit, offset,
    filters: {
      enums: { ad_type: ['demand'] },
      keywords: { text: keyword }
    }
  };
}

/**
 * Fetch one keyword's demand pages, stopping when the page's oldest ad
 * exceeds maxAgeDays or the API runs out of results.
 *
 * Injectable `fetchFn` makes this testable in Node without polyfilling fetch.
 *
 * @param {string} keyword
 * @param {object} [opts]
 * @param {number} [opts.maxAgeDays=30]
 * @param {Function} [opts.fetchFn=fetch]
 * @returns {Promise<object[]>}  raw leboncoin ad objects
 */
export async function searchKeyword(keyword, { maxAgeDays = 30, fetchFn = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
  if (!fetchFn) throw new Error('No fetch available — pass fetchFn explicitly');
  const items = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {  // hard cap = 1000 ads/keyword
    let data;
    try {
      const res = await fetchFn(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api_key': API_KEY },
        credentials: 'include',
        body: JSON.stringify(buildSearchPayload({ keyword, offset, limit: 100 }))
      });
      if (!res.ok) break;
      data = await res.json();
    } catch { break; }
    const ads = data?.ads ?? [];
    if (!ads.length) break;
    items.push(...ads);
    const oldestAge = ageDays(ads[ads.length - 1]?.first_publication_date);
    if (oldestAge !== null && oldestAge > maxAgeDays) break;
    offset += 100;
    if (offset >= (data.total ?? 0)) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return items;
}

/**
 * Convert a raw leboncoin ad object into the compact entry stored in
 * `chrome.storage.local.prospectResults`.
 *
 * @param {object} ad     raw ad from /finder/search
 * @param {object} extras {score, kw, isNew}
 */
export function buildEntry(ad, { score, kw, isNew }) {
  return {
    list_id: String(ad.list_id || ''),
    subject: ad.subject,
    body: (ad.body || '').slice(0, 600),
    category_name: ad.category_name,
    url: ad.url,
    location: `${ad.location?.city || '?'} ${ad.location?.zipcode || ''}`.trim(),
    first_publication_date: ad.first_publication_date,
    age_days: Math.round(ageDays(ad.first_publication_date) ?? 0),
    score,
    kw_hit: kw,
    is_new: isNew
  };
}

/**
 * Sort: brand-new first, then highest score, then youngest.
 */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.is_new !== b.is_new) return a.is_new ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.age_days - b.age_days;
  });
}

/**
 * Top-level scan: iterate keywords → score → dedup → sort.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.keywords]
 * @param {number}   [opts.maxAgeDays=30]
 * @param {number}   [opts.minScore=5]
 * @param {Set<string>} [opts.seenIds]    IDs known to the user — flags isNew=false.
 * @param {Function} [opts.fetchFn]       Custom fetch (tests).
 * @returns {Promise<{results: object[], scannedKeywords: number, total: number}>}
 */
export async function runProspectScan({
  keywords = DEFAULT_KEYWORDS,
  maxAgeDays = 30,
  minScore = 5,
  seenIds = new Set(),
  fetchFn
} = {}) {
  const byId = new Map();
  for (const kw of keywords) {
    const ads = await searchKeyword(kw, { maxAgeDays, fetchFn });
    for (const ad of ads) {
      const lid = String(ad.list_id || '');
      if (!lid) continue;
      const age = ageDays(ad.first_publication_date);
      if (age === null || age > maxAgeDays) continue;
      const score = scoreAd(ad.subject || '', ad.body || '');
      if (score < minScore) continue;
      const entry = buildEntry(ad, { score, kw, isNew: !seenIds.has(lid) });
      const prev = byId.get(lid);
      if (!prev || prev.score < score) byId.set(lid, entry);
    }
  }
  const results = sortEntries([...byId.values()]);
  return { results, scannedKeywords: keywords.length, total: results.length };
}

/**
 * Persist the IDs the user has acknowledged.
 * Only safe to call from extension contexts (popup / service worker).
 */
export async function markResultsSeen(results) {
  const { prospectSeenIds = [] } = await chrome.storage.local.get('prospectSeenIds');
  const next = new Set(prospectSeenIds);
  for (const r of results) next.add(r.list_id);
  // Keep history bounded to avoid runaway growth.
  await chrome.storage.local.set({ prospectSeenIds: [...next].slice(-5000) });
}

export const DEFAULT_REPLY_TEMPLATE = (
  "Bonjour,\n\n" +
  "Je suis Odilon, développeur full-stack basé à Besançon (PHP/Symfony, JS/TS, Go), 10+ ans d'expérience.\n" +
  "Votre annonce \"{subject}\" m'intéresse — {keyword} fait partie de mes spécialités.\n\n" +
  "Je peux vous aider rapidement, à distance ou sur site selon le besoin.\n" +
  "Mon profil : https://www.web-developpeur.com\n\n" +
  "Cordialement,\n" +
  "Odilon"
);

/**
 * Fill placeholders in a reply template using a prospect entry.
 * Supported: {subject}, {keyword}, {location}, {age_days}.
 * Unknown placeholders are left untouched so users can spot typos.
 */
export function formatReplyTemplate(template, prospect) {
  if (!template) return '';
  const map = {
    subject: prospect?.subject || '',
    keyword: (prospect?.kw_hit || '').replace(/^#/, ''),
    location: prospect?.location || '',
    age_days: prospect?.age_days != null ? `${prospect.age_days}j` : ''
  };
  return template.replace(/\{(\w+)\}/g, (full, key) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : full
  );
}
