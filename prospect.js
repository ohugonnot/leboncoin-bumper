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

/** Default keyword set, tuned for a French full-stack/backend developer profile.
 *  Frozen to prevent accidental mutation across calls. */
export const DEFAULT_KEYWORDS = Object.freeze([
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
]);

/** Strong tech signals — when present in title or body, add a high score boost. */
export const STRONG_SIGNALS = /\b(symfony|laravel|wordpress|prestashop|magento|shopify|opencart|woocommerce|php\d?\b|golang|nodejs|node\.js|typescript|reactjs|react native|vuejs|vue\.js|fastapi|django|flask|nextjs|next\.js|nuxt|angular|webmaster|fullstack|backend|frontend|ffmpeg|elasticsearch|kubernetes|docker|terraform|aws lambda|chatgpt|openai|llm|prompt engineer|claude\.ai|gemini api|mistral|algo[- ]trading|trading bot|blockchain|web3|nft|defi|smart contract|home assistant|jeedom|raspberry pi|arduino|esp32|esp8266|retropie|recalbox|batocera|retrobat|émulateur|emulateur|retrogaming|r[ée]trogaming|pincab|n8n|zapier|make\.com|automatis|web scrap|scraping|crawler|vba|macro excel|google sheets|tableur complexe|développeur|programmeur|développement web|développement mobile|création de site|cr[ée]ation site|cr[ée]ation web|site internet|site web|application web|application mobile|api rest|crm wordpress|cours d['’]?informatique|aide informatique|formation informatique|lunii|conteuse audio)\b/i;

/** Moderate signals — broader IT vocabulary, smaller boost. */
export const MODERATE_SIGNALS = /\b(informatique|ordinateur|logiciel|programmation|code source|site marchand|boutique en ligne|e-commerce|seo\b|référencement|panne pc|réparation pc|dépannage informatique|maintenance pc)\b/i;

/** Negative signals — appearance in title OR body drops the ad entirely. */
export const NEG_SIGNALS = /\b(m[ée]nage|repassage|jardinage|cuisinier|cuisini[èe]re|chef de cuisine|bardeur|couvreur|carrelag|maçonnerie|plomberie|électricien|mécanicien|garde enfant|nounou|baby[- ]sitting|d[ée]m[ée]nagement|chauffeur|saxophon|guitare|piano|chant\b|musicien|colocation|maison\b|appartement|chambre\b|studio\b|tondre|gravât|épave|agricole|ouvrier\b|pelouse|couturi[èe]re|cours d['’]anglais|cours de fran[çc]ais|cours de math|soutien scolaire|aide aux devoirs|primaire|coll[èe]ge\b|aide soignant|infirmier|gardiennage|massage|barman|aide à domicile|écharpe|bijou|figurant|mannequin)\b/i;

/** Titles that start with these words look like genuine demands (legacy, anchored). */
export const DEMAND_PREFIX = /^(cherche|recherche|besoin|aide |aidez|demande|qui veut|qui peut)/i;

/** Demand hints anywhere in the title (v2 scoring). Broader than DEMAND_PREFIX. */
export const DEMAND_HINTS = /\b(cherche|recherche|besoin|aide|aider|aidez|demande|quelqu'un|conseil|conseils|d[ée]pannage|r[ée]paration)\b/i;

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Build a regex that matches `term` with proper word boundaries — including
 * terms that start/end with non-word chars like "C++", ".NET", "C#". The
 * naive \b fails there (\b is between word and non-word chars, but both
 * sides of "+" are non-word).
 *
 * We use lookbehind/lookahead on a "word-ish" character class.
 */
function termRegex(term) {
  const W = '[A-Za-zÀ-ÿ0-9_]';
  return new RegExp(`(?<!${W})${escapeRegex(term)}(?!${W})`, 'i');
}

/**
 * Parse the user's keyword list. Each entry can be `term` (weight 1) or
 * `term:N` (custom weight). Whitespace tolerant. Returns the parsed list.
 *
 * Examples : "wordpress" → {term: "wordpress", weight: 1}
 *            "recalbox:3" → {term: "recalbox", weight: 3}
 *            "  raspberry pi : 2  " → {term: "raspberry pi", weight: 2}
 */
export function parseProfileKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];
  return keywords.map(raw => {
    const s = String(raw || '').trim();
    if (s.length < 2) return null;
    const m = s.match(/^(.+?)\s*:\s*(\d+)\s*$/);
    if (m) {
      const term = m[1].trim();
      const weight = Math.max(1, Math.min(10, parseInt(m[2], 10) || 1));
      return term.length >= 2 ? { term, weight } : null;
    }
    return { term: s, weight: 1 };
  }).filter(Boolean);
}

/**
 * Score v2 — title match worth twice body match, weighted per keyword,
 * demand hints detected anywhere in the title.
 *
 * Legacy mode (no profileKeywords) kept for backward-compatible tests.
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} [profileKeywords]  enables keyword-match scoring
 */
export function scoreAd(title, body, profileKeywords) {
  if (!title || title.trim().length < 8) return 0;
  if (NEG_SIGNALS.test(title) || NEG_SIGNALS.test(body || '')) return 0;
  if (Array.isArray(profileKeywords)) {
    return explainScore(title, body, profileKeywords).total;
  }
  // Legacy scoring
  let score = 0;
  if (STRONG_SIGNALS.test(title)) score += 5;
  if (STRONG_SIGNALS.test(body || '')) score += 3;
  if (MODERATE_SIGNALS.test(title)) score += 2;
  if (MODERATE_SIGNALS.test(body || '')) score += 1;
  if (DEMAND_PREFIX.test(title)) score += 2;
  return score;
}

/**
 * Return both the total score and a breakdown of where points came from
 * (for the UI tooltip on each ★ badge).
 */
export function explainScore(title, body, profileKeywords) {
  const parts = [];
  if (!title || title.trim().length < 8) return { total: 0, parts: ['titre trop court'] };
  if (NEG_SIGNALS.test(title) || NEG_SIGNALS.test(body || '')) return { total: 0, parts: ['signal négatif détecté'] };
  const parsed = parseProfileKeywords(profileKeywords || []);
  let total = 0;
  for (const { term, weight } of parsed) {
    const re = termRegex(term);
    if (re.test(title)) {
      const pts = weight * 2;
      total += pts; parts.push(`${term} (titre +${pts})`);
    } else if (re.test(body || '')) {
      const pts = weight;
      total += pts; parts.push(`${term} (description +${pts})`);
    }
  }
  if (DEMAND_HINTS.test(title)) {
    total += 1; parts.push('mot de demande dans le titre +1');
  }
  if (!parts.length) parts.push('aucun mot-clé matché');
  return { total, parts };
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
  // Price : leboncoin exposes `price` as an array (often [N]) or sometimes
  // missing for "demande" ads. We keep the first value if any.
  const priceArr = Array.isArray(ad.price) ? ad.price : (ad.price != null ? [ad.price] : []);
  const price = priceArr.length ? Number(priceArr[0]) : null;
  return {
    list_id: String(ad.list_id || ''),
    subject: ad.subject,
    body: (ad.body || '').slice(0, 1200),
    category_name: ad.category_name,
    url: ad.url,
    price: Number.isFinite(price) && price > 0 ? price : null,
    location: `${ad.location?.city || '?'} ${ad.location?.zipcode || ''}`.trim(),
    first_publication_date: ad.first_publication_date,
    age_days: Math.round(ageDays(ad.first_publication_date) ?? 0),
    score,
    kw_hit: kw,
    is_new: isNew
  };
}

/**
 * Sort entries by the requested display order.
 *
 * NEW prospects always bubble to the top (otherwise they get lost in score-
 * sorted lists). Within new / seen, the chosen order applies.
 *
 * @param {object[]} entries
 * @param {'score'|'time'|'price-asc'|'price-desc'} [order='score']
 */
export function sortEntries(entries, order = 'score') {
  const cmp = comparators[order] || comparators.score;
  return [...entries].sort((a, b) => {
    if (a.is_new !== b.is_new) return a.is_new ? -1 : 1;
    return cmp(a, b);
  });
}

// Sort comparators. Missing prices are pushed to the end regardless of asc/desc.
const comparators = {
  score: (a, b) => (b.score - a.score) || (a.age_days - b.age_days),
  time:  (a, b) => a.age_days - b.age_days,  // age asc = most recent first
  'price-asc':  (a, b) => priceOr(a, Infinity) - priceOr(b, Infinity),
  'price-desc': (a, b) => priceOr(b, -Infinity) - priceOr(a, -Infinity),
};
function priceOr(e, fallback) { return e.price != null ? e.price : fallback; }

/**
 * Pure post-processing : score → filter → dedup → sort.
 *
 * Split out from runProspectScan so the network phase (which must run inside
 * a leboncoin tab to bypass DataDome) can stay separate from the scoring
 * logic that remains testable in Node.
 *
 * @param {object} opts
 * @param {Object<string, object[]>} opts.adsByKeyword  raw ads grouped by keyword
 * @param {number} [opts.maxAgeDays=30]
 * @param {number} [opts.minScore=5]
 * @param {Set<string>} [opts.seenIds]
 */
export function processRawAds({
  adsByKeyword, maxAgeDays = 30, minScore = 5,
  seenIds = new Set(), contactedIds = new Set(),
  profileKeywords,
  ownerType = 'all',          // 'all' | 'pro' | 'private'
  shippableOnly = false,
  sortOrder = 'score'         // 'score' | 'time' | 'price-asc' | 'price-desc'
}) {
  const byId = new Map();
  const usePk = Array.isArray(profileKeywords);
  for (const [kw, ads] of Object.entries(adsByKeyword)) {
    for (const ad of ads || []) {
      const lid = String(ad.list_id || '');
      if (!lid) continue;
      // Post-filter : owner type
      if (ownerType !== 'all' && ad.owner?.type !== ownerType) continue;
      // Post-filter : shipping available (attribute "shippable" === "true")
      if (shippableOnly) {
        const shippable = (ad.attributes || []).some(a => a.key === 'shippable' && a.value === 'true');
        if (!shippable) continue;
      }
      const age = ageDays(ad.first_publication_date);
      if (age === null || age > maxAgeDays) continue;
      const explanation = usePk ? explainScore(ad.subject || '', ad.body || '', profileKeywords) : null;
      const score = usePk ? explanation.total : scoreAd(ad.subject || '', ad.body || '');
      if (score < minScore) continue;
      const entry = buildEntry(ad, { score, kw, isNew: !seenIds.has(lid) });
      if (explanation) entry.score_breakdown = explanation.parts;
      entry.already_contacted = contactedIds.has(lid);
      const prev = byId.get(lid);
      if (!prev || prev.score < score) byId.set(lid, entry);
    }
  }
  const results = sortEntries([...byId.values()], sortOrder);
  return { results, scannedKeywords: Object.keys(adsByKeyword).length, total: results.length };
}

/**
 * Top-level scan: iterate keywords → score → dedup → sort.
 *
 * Used by tests via `fetchFn` mock. Production calls `processRawAds` directly
 * after fetching from a leboncoin tab (see orchestrator.fetchAdsViaTab).
 */
export async function runProspectScan({
  keywords = DEFAULT_KEYWORDS,
  maxAgeDays = 30,
  minScore = 5,
  seenIds = new Set(),
  fetchFn
} = {}) {
  const adsByKeyword = {};
  for (const kw of keywords) {
    adsByKeyword[kw] = await searchKeyword(kw, { maxAgeDays, fetchFn });
  }
  return processRawAds({ adsByKeyword, maxAgeDays, minScore, seenIds });
}

/**
 * Persist the IDs the user has acknowledged for a given profile.
 * Only safe to call from extension contexts (popup / service worker).
 */
export async function markResultsSeen(results, profileId) {
  const { prospectSeenIdsByProfile = {} } = await chrome.storage.local.get('prospectSeenIdsByProfile');
  const next = new Set(prospectSeenIdsByProfile[profileId] || []);
  for (const r of results) next.add(r.list_id);
  // Keep history bounded to avoid runaway growth.
  await chrome.storage.local.set({
    prospectSeenIdsByProfile: {
      ...prospectSeenIdsByProfile,
      [profileId]: [...next].slice(-5000)
    }
  });
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
