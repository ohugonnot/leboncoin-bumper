import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  scoreAd, ageDays, buildSearchPayload, buildEntry,
  sortEntries, runProspectScan, formatReplyTemplate,
  parseProfileKeywords, explainScore, groupByOwner, searchKeyword,
  mergeUserCardIntoEntry, enrichProspectsWithUserCard,
  filterFreshForNotification, buildWebhookPayload, markResultsNotified,
  STRONG_SIGNALS, MODERATE_SIGNALS, NEG_SIGNALS, DEMAND_PREFIX, DEMAND_HINTS
} from '../prospect.js';
import {
  adWordpressMetz, adProgrammeurN8N, adCleaner,
  adOldDeveloper, adShortTitle, adVagueButTechBody,
  mockFetch
} from './fixtures.js';

// ─── scoreAd ──────────────────────────────────────────────────────────────

test('scoreAd: strong title signal scores high', () => {
  const s = scoreAd('Cherche un technicien web, CRM WordPress', '');
  // STRONG title (+5) + DEMAND_PREFIX "Cherche" (+2) = 7
  assert.equal(s, 7);
});

test('scoreAd: body-only strong signal still scores', () => {
  const s = scoreAd('Demande aide projet professionnel',
    'Je dois finir un site web avec PHP Symfony et un peu de Vue.js');
  // body STRONG (+3) + title MODERATE no, "Demande" prefix (+2) = 5
  assert.ok(s >= 5, `expected >=5, got ${s}`);
});

test('scoreAd: negative signal drops to 0 even with strong tech words', () => {
  const s = scoreAd('Cherche femme de ménage pour site web', '');
  assert.equal(s, 0);
});

test('scoreAd: too-short title returns 0', () => {
  assert.equal(scoreAd('Aide', 'Demande aide pour mon site web wordpress.'), 0);
});

test('scoreAd: empty inputs return 0', () => {
  assert.equal(scoreAd('', ''), 0);
  assert.equal(scoreAd(null, null), 0);
});

test('scoreAd: moderate signal counts', () => {
  const s = scoreAd('Recherche dépannage informatique sur Lyon', '');
  // "informatique" is in STRONG via "aide informatique"? no — only matches MODERATE
  // MODERATE title (+2) + DEMAND prefix (+2) = 4
  assert.equal(s, 4);
});

// ─── ageDays ──────────────────────────────────────────────────────────────

test('ageDays: parses leboncoin naive datetime', () => {
  const now = new Date('2026-05-12T12:00:00Z');
  const age = ageDays('2026-05-10 12:00:00', now);
  assert.ok(Math.abs(age - 2) < 0.1, `expected ~2 days, got ${age}`);
});

test('ageDays: returns null on garbage', () => {
  assert.equal(ageDays('not a date'), null);
  assert.equal(ageDays(null), null);
  assert.equal(ageDays(undefined), null);
});

// ─── buildSearchPayload ───────────────────────────────────────────────────

test('buildSearchPayload: defaults', () => {
  const p = buildSearchPayload({ keyword: 'wordpress' });
  assert.deepEqual(p.filters, { enums: { ad_type: ['demand'] }, keywords: { text: 'wordpress' } });
  assert.equal(p.limit, 100);
  assert.equal(p.offset, 0);
  assert.equal(p.sort_by, 'time');
});

test('buildSearchPayload: respects custom offset', () => {
  const p = buildSearchPayload({ keyword: 'php', offset: 200, limit: 50 });
  assert.equal(p.offset, 200);
  assert.equal(p.limit, 50);
});

test('buildSearchPayload: mimicks official client metadata', () => {
  const p0 = buildSearchPayload({ keyword: 'x' });
  assert.equal(p0.disable_total, true);
  assert.equal(p0.extend, true);
  assert.equal(p0.limit_alu, 0);
  assert.equal(p0.listing_source, 'direct-search');

  const p1 = buildSearchPayload({ keyword: 'x', offset: 100 });
  assert.equal(p1.listing_source, 'pagination');
});

test('buildSearchPayload: pushes owner_type server-side (skip when all)', () => {
  const allP = buildSearchPayload({ keyword: 'x', ownerType: 'all' });
  assert.equal(allP.owner_type, undefined);

  const proP = buildSearchPayload({ keyword: 'x', ownerType: 'pro' });
  assert.equal(proP.owner_type, 'pro');

  const privP = buildSearchPayload({ keyword: 'x', ownerType: 'private' });
  assert.equal(privP.owner_type, 'private');
});

test('buildSearchPayload: pushes shippable into filters.location', () => {
  const p = buildSearchPayload({ keyword: 'x', shippable: true });
  assert.equal(p.filters.location.shippable, true);
});

test('buildSearchPayload: shippable composes with departments', () => {
  const p = buildSearchPayload({ keyword: 'x', shippable: true, departments: ['75', '92'] });
  assert.deepEqual(p.filters.location, { departments: ['75', '92'], shippable: true });
});

test('buildSearchPayload: price range', () => {
  const p = buildSearchPayload({ keyword: 'x', priceMin: 100, priceMax: 500 });
  assert.deepEqual(p.filters.ranges, { price: { min: 100, max: 500 } });

  const pMinOnly = buildSearchPayload({ keyword: 'x', priceMin: 100 });
  assert.deepEqual(pMinOnly.filters.ranges, { price: { min: 100 } });
});

test('buildSearchPayload: custom adTypes', () => {
  const p = buildSearchPayload({ keyword: 'x', adTypes: ['demand', 'offer'] });
  assert.deepEqual(p.filters.enums.ad_type, ['demand', 'offer']);
});

// ─── buildEntry ───────────────────────────────────────────────────────────

test('buildEntry: extracts location + truncates body', () => {
  const ad = { ...adWordpressMetz, body: 'x'.repeat(1500) };
  const e = buildEntry(ad, { score: 8, kw: 'wordpress', isNew: true });
  assert.equal(e.list_id, '3196483489');
  assert.equal(e.location, 'Metz 57000');
  assert.equal(e.body.length, 1200);
  assert.equal(e.score, 8);
  assert.equal(e.is_new, true);
});

// ─── sortEntries ──────────────────────────────────────────────────────────

test('sortEntries: new before seen, then by score', () => {
  const sorted = sortEntries([
    { list_id: 'a', score: 10, age_days: 5, is_new: false },
    { list_id: 'b', score: 6, age_days: 1, is_new: true },
    { list_id: 'c', score: 8, age_days: 3, is_new: true }
  ]);
  assert.deepEqual(sorted.map(e => e.list_id), ['c', 'b', 'a']);
});

test('sortEntries: price-asc puts cheapest first, null prices last', () => {
  const sorted = sortEntries([
    { list_id: 'a', score: 5, age_days: 1, is_new: true, price: 30 },
    { list_id: 'b', score: 5, age_days: 1, is_new: true, price: null },
    { list_id: 'c', score: 5, age_days: 1, is_new: true, price: 10 }
  ], 'price-asc');
  assert.deepEqual(sorted.map(e => e.list_id), ['c', 'a', 'b']);
});

test('sortEntries: price-desc puts most expensive first, null prices last', () => {
  const sorted = sortEntries([
    { list_id: 'a', score: 5, age_days: 1, is_new: true, price: 30 },
    { list_id: 'b', score: 5, age_days: 1, is_new: true, price: null },
    { list_id: 'c', score: 5, age_days: 1, is_new: true, price: 100 }
  ], 'price-desc');
  assert.deepEqual(sorted.map(e => e.list_id), ['c', 'a', 'b']);
});

test('sortEntries: NEW always wins over seen, even with sort=price', () => {
  const sorted = sortEntries([
    { list_id: 'a', is_new: false, price: 5, score: 5, age_days: 1 },
    { list_id: 'b', is_new: true, price: 999, score: 5, age_days: 1 }
  ], 'price-asc');
  assert.deepEqual(sorted.map(e => e.list_id), ['b', 'a']);  // new wins
});

// ─── runProspectScan (integration with mock fetch) ────────────────────────

test('runProspectScan: filters by minScore, drops too-old, dedup by id', async () => {
  const fetchFn = mockFetch({
    wordpress: [adWordpressMetz, adVagueButTechBody, adCleaner, adShortTitle],
    'aide site': [adWordpressMetz],          // duplicate of metz — must dedup
    'site web': [adOldDeveloper],            // too old — must drop
    développeur: [adProgrammeurN8N]
  });
  const out = await runProspectScan({
    keywords: ['wordpress', 'aide site', 'site web', 'développeur'],
    minScore: 5,
    maxAgeDays: 30,
    fetchFn
  });
  const ids = out.results.map(r => r.list_id);
  assert.ok(ids.includes('3196483489'), 'WordPress Metz must appear');
  assert.ok(ids.includes('3193981434'), 'N8N must appear');
  assert.equal(ids.filter(i => i === '3196483489').length, 1, 'metz must be deduped');
  assert.ok(!ids.includes('9000000001'), 'cleaner ad must be dropped');
  assert.ok(!ids.includes('9000000002'), 'old ad must be dropped');
  assert.ok(!ids.includes('9000000003'), 'short-title ad must be dropped');
  assert.equal(out.scannedKeywords, 4);
});

test('runProspectScan: respects seenIds (is_new flag)', async () => {
  const fetchFn = mockFetch({ wordpress: [adWordpressMetz, adVagueButTechBody] });
  const seenIds = new Set(['3196483489']);
  const out = await runProspectScan({ keywords: ['wordpress'], seenIds, fetchFn });
  const metz = out.results.find(r => r.list_id === '3196483489');
  const vague = out.results.find(r => r.list_id === '9000000004');
  assert.equal(metz?.is_new, false);
  assert.equal(vague?.is_new, true);
});

test('runProspectScan: empty keywords returns empty results', async () => {
  const fetchFn = mockFetch({});
  const out = await runProspectScan({ keywords: [], fetchFn });
  assert.equal(out.total, 0);
  assert.equal(out.scannedKeywords, 0);
});

// ─── Regex regression guards ──────────────────────────────────────────────

test('regex: STRONG_SIGNALS does not match "vue" alone (used to false-positive)', () => {
  assert.ok(!STRONG_SIGNALS.test('Cherche maison avec vue mer'));
  assert.ok(STRONG_SIGNALS.test('Mission Vue.js + Laravel'));
});

test('regex: NEG_SIGNALS catches common non-tech demands', () => {
  for (const t of [
    'Recherche femme de ménage',
    'Cherche cuisinier pour restaurant',
    'Recherche colocation Lyon',
    'Cherche garde enfant'
  ]) {
    assert.ok(NEG_SIGNALS.test(t), `should match: ${t}`);
  }
});

test('regex: DEMAND_PREFIX catches request titles', () => {
  for (const t of ['Cherche dev PHP', 'Recherche freelance', 'Besoin aide WordPress', 'Aide pour mon site']) {
    assert.ok(DEMAND_PREFIX.test(t), `should match: ${t}`);
  }
  assert.ok(!DEMAND_PREFIX.test('Mon site est cassé'), 'no false positive');
});

// ─── formatReplyTemplate ──────────────────────────────────────────────────

test('formatReplyTemplate: substitutes {subject} {keyword} {location} {age_days}', () => {
  const out = formatReplyTemplate(
    'Bonjour, {subject} en {location} (il y a {age_days}) — kw={keyword}',
    { subject: 'Cherche dev PHP', kw_hit: '#php', location: 'Besançon 25000', age_days: 3 }
  );
  assert.equal(out, 'Bonjour, Cherche dev PHP en Besançon 25000 (il y a 3j) — kw=php');
});

test('formatReplyTemplate: strips leading # from keyword', () => {
  assert.equal(
    formatReplyTemplate('kw={keyword}', { kw_hit: '#wordpress' }),
    'kw=wordpress'
  );
});

test('formatReplyTemplate: leaves unknown placeholders untouched', () => {
  const out = formatReplyTemplate('Hello {unknown} {subject}', { subject: 'X' });
  assert.equal(out, 'Hello {unknown} X');
});

test('formatReplyTemplate: handles empty/null prospect fields', () => {
  const out = formatReplyTemplate('{subject}-{location}-{age_days}', {});
  assert.equal(out, '--');
});

test('formatReplyTemplate: returns empty string for empty template', () => {
  assert.equal(formatReplyTemplate('', { subject: 'X' }), '');
  assert.equal(formatReplyTemplate(null, { subject: 'X' }), '');
});

// ─── scoreAd: keyword-match mode (new dynamic scoring) ────────────────────

test('scoreAd v2: title match weighs 2x body match', () => {
  // wordpress in title = +2, prestashop in title = +2, php in body = +1, Cherche detected = +1
  const s = scoreAd(
    'Cherche dev WordPress + PrestaShop urgent',
    'Site existant, besoin de migration PHP 8.',
    ['wordpress', 'prestashop', 'php']
  );
  assert.equal(s, 6);
});

test('scoreAd v2: per-keyword weight via :N syntax', () => {
  const s = scoreAd('Recalbox setup help', '', ['recalbox:3']);
  // recalbox in title with weight 3 = +6, no demand hint in title = 0
  // "help" is not a demand hint, only French words
  assert.equal(s, 6);
});

test('scoreAd v2: demand bonus triggers anywhere in title', () => {
  // "Particulier cherche..." — Cherche is not at start
  const s = scoreAd('Particulier cherche dev WordPress', '', ['wordpress']);
  // wordpress title +2 + cherche anywhere = +1 = 3
  assert.equal(s, 3);
});

test('scoreAd v2: body match only counted if not in title', () => {
  const s = scoreAd('WordPress problème', 'WordPress et PHP', ['wordpress', 'php']);
  // wordpress in title (+2), php in body (+1) = 3
  assert.equal(s, 3);
});

test('parseProfileKeywords: parses :N syntax and clamps weights', () => {
  const out = parseProfileKeywords(['wordpress', 'recalbox:3', '  batocera : 5 ', 'too:99', 'php:0', 'x']);
  // 'x' (1 char) is dropped because too short
  assert.deepEqual(out, [
    { term: 'wordpress', weight: 1 },
    { term: 'recalbox', weight: 3 },
    { term: 'batocera', weight: 5 },
    { term: 'too', weight: 10 },  // clamped to max 10
    { term: 'php', weight: 1 }    // weight 0 falls back to default 1
  ]);
});

test('scoreAd v2: special regex chars in keywords are escaped safely', () => {
  // `.*` shouldn't act as a wildcard, `(php)` shouldn't be capture group
  const s = scoreAd('I use C++ and .NET', '', ['.*', 'C++', '.NET']);
  // Only literal "C++" and ".NET" should match (".*" is too short after escape ? no, length 2 OK).
  // ".*" as literal won't match anything in the text → 0.
  // "C++" matches → +2. ".NET" matches → +2. Total 4.
  assert.equal(s, 4);
});

test('scoreAd v2: keyword with parentheses doesn\'t break regex', () => {
  const s = scoreAd('Recherche (php)', '', ['(php)']);
  // Literal "(php)" matches the title → +2 + no demand prefix in our regex (Recherche is demand)
  // Recherche → +1. Total 3.
  assert.equal(s, 3);
});

test('explainScore: returns per-keyword breakdown for tooltip', () => {
  const r = explainScore(
    'Cherche dev WordPress + PrestaShop',
    'PHP migration',
    ['wordpress', 'prestashop:2', 'php']
  );
  assert.equal(r.total, 2 + 4 + 1 + 1);  // wordpress titre + prestashop titre×2 + php body + demande
  assert.ok(r.parts.includes('wordpress (titre +2)'));
  assert.ok(r.parts.includes('prestashop (titre +4)'));
  assert.ok(r.parts.includes('php (description +1)'));
  assert.ok(r.parts.some(p => p.includes('demande')));
});

test('scoreAd: keyword-match ignores ads with NEG_SIGNALS', () => {
  assert.equal(
    scoreAd('Cherche WordPress femme de ménage', '', ['wordpress']),
    0
  );
});

test('scoreAd: keyword-match returns 0 when no keywords match', () => {
  const s = scoreAd(
    'Cherche dev iOS Swift',
    'Application mobile iOS native, expérience SwiftUI requise',
    ['wordpress', 'prestashop']
  );
  // No keyword match, but DEMAND_PREFIX matches → +1
  assert.equal(s, 1);
});

test('scoreAd: keyword-match empty array gives only demand bonus', () => {
  const s = scoreAd('Cherche developpeur web', 'long body text here', []);
  assert.equal(s, 1);
});

test('scoreAd: keyword-match skips too-short keywords (<2 chars)', () => {
  const s = scoreAd('php is the best', 'long enough body php php php', ['p', 'php']);
  // 'p' is too short (1 char) → filtered. 'php' in title → +2. No demand. Total 2.
  assert.equal(s, 2);
});

// ─── groupByOwner ─────────────────────────────────────────────────────────

function makeEntry(list_id, owner_id = '', owner_name = '') {
  return { list_id, owner_id, owner_name, owner_type: '', score: 5, age_days: 1, is_new: true };
}

test('groupByOwner: 3 entries same owner_id → 1 group with 2 others', () => {
  const entries = [makeEntry('1', 'A'), makeEntry('2', 'A'), makeEntry('3', 'A')];
  const groups = groupByOwner(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.list_id, '1');
  assert.deepEqual(groups[0].others.map(e => e.list_id), ['2', '3']);
});

test('groupByOwner: entries without owner_id stay individual', () => {
  const entries = [makeEntry('1', ''), makeEntry('2', ''), makeEntry('3', '')];
  const groups = groupByOwner(entries);
  assert.equal(groups.length, 3);
  assert.ok(groups.every(g => g.others.length === 0));
});

test('groupByOwner: mix of grouped and solo entries', () => {
  const entries = [
    makeEntry('1', 'A'),
    makeEntry('2', 'B'),
    makeEntry('3', 'A'),
    makeEntry('4', '')
  ];
  const groups = groupByOwner(entries);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].ownerId, 'A');
  assert.equal(groups[0].others.length, 1);
  assert.equal(groups[1].ownerId, 'B');
  assert.equal(groups[1].others.length, 0);
  assert.equal(groups[2].ownerId, '');  // solo anonymous
  assert.equal(groups[2].others.length, 0);
});

test('groupByOwner: preserves primary order — [A1, B1, A2] → primaries [A1, B1]', () => {
  const entries = [makeEntry('A1', 'A'), makeEntry('B1', 'B'), makeEntry('A2', 'A')];
  const groups = groupByOwner(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].primary.list_id, 'A1');
  assert.equal(groups[0].others[0].list_id, 'A2');
  assert.equal(groups[1].primary.list_id, 'B1');
});

// ─── searchKeyword rate-limiting ──────────────────────────────────────────

test('searchKeyword: inserts ≥250ms delay between paginated pages', async () => {
  // Simulate 200 ads spread over 2 pages (limit=100 each) with a recent date
  // so the age cutoff doesn't short-circuit after page 1.
  const recentDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
  const makeAd = (id) => ({ ...adWordpressMetz, list_id: id, first_publication_date: recentDate });
  const page1 = Array.from({ length: 100 }, (_, i) => makeAd(i + 1));
  const page2 = Array.from({ length: 100 }, (_, i) => makeAd(i + 101));
  let callCount = 0;
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    callCount++;
    const ads = callCount === 1 ? page1 : page2;
    return { ok: true, status: 200, json: async () => ({ ads, total: 200 }) };
  };

  const t0 = Date.now();
  const results = await searchKeyword('wordpress', { maxAgeDays: 90, fetchFn });
  const elapsed = Date.now() - t0;

  assert.equal(callCount, 2);
  assert.equal(results.length, 200);
  // Inter-page sleep is 250ms; allow generous margin for test-runner overhead.
  assert.ok(elapsed >= 200, `expected ≥200ms inter-page delay, got ${elapsed}ms`);
});

// ─── mergeUserCardIntoEntry / enrichProspectsWithUserCard ─────────────────

const baseEntry = {
  list_id: 'a1', subject: 'X', body: '', category_name: 'Y', url: '', price: null,
  location: 'Paris', first_publication_date: '2026-05-01', age_days: 5,
  score: 7, kw_hit: 'wordpress', is_new: true, owner_id: 'u-1', owner_name: 'Alice', owner_type: 'private'
};

const fullCard = {
  id: 'u-1', name: 'Alice', registeredAt: '2020-01-15', accountType: 'private',
  totalAds: 12, isPro: false,
  reply: { rate: 85, inMinutes: 12 },
  presence: { status: 'online', lastActivity: '2026-05-14T09:00:00Z' },
  feedback: { score: 4.5, receivedCount: 30 },
  badges: [{ type: 'identity_verified', name: 'Id' }, { type: 'phone', name: 'Tel' }]
};

test('mergeUserCardIntoEntry: copies reply/presence/feedback/badges', () => {
  const e = mergeUserCardIntoEntry(baseEntry, fullCard);
  assert.equal(e.user_reply_rate, 85);
  assert.equal(e.user_reply_minutes, 12);
  assert.equal(e.user_presence_status, 'online');
  assert.equal(e.user_feedback_score, 4.5);
  assert.equal(e.user_feedback_count, 30);
  assert.equal(e.user_total_ads, 12);
  assert.equal(e.user_is_pro, false);
  assert.deepEqual(e.user_badges, ['identity_verified', 'phone']);
});

test('mergeUserCardIntoEntry: null card → entry untouched', () => {
  const e = mergeUserCardIntoEntry(baseEntry, null);
  assert.equal(e, baseEntry);
});

test('mergeUserCardIntoEntry: web extras (followers + profilePicture) propagés', () => {
  const cardWeb = {
    ...fullCard,
    profilePicture: 'https://img/p.jpg',
    web: { followers: 42, adsTotal: 12, adsActive: 10, pictureDefault: false }
  };
  const e = mergeUserCardIntoEntry(baseEntry, cardWeb);
  assert.equal(e.user_followers, 42);
  assert.equal(e.user_profile_picture, 'https://img/p.jpg');
});

test('mergeUserCardIntoEntry: web extras absents → user_followers/picture null', () => {
  const e = mergeUserCardIntoEntry(baseEntry, fullCard);
  assert.equal(e.user_followers, null);
  assert.equal(e.user_profile_picture, null);
});

test('mergeUserCardIntoEntry: missing reply/presence/feedback → null fields, no throw', () => {
  const e = mergeUserCardIntoEntry(baseEntry, { id: 'u-1' });
  assert.equal(e.user_reply_rate, null);
  assert.equal(e.user_presence_status, null);
  assert.equal(e.user_feedback_score, null);
  assert.equal(e.user_feedback_count, 0);
});

test('enrichProspectsWithUserCard: fetches only unique owners, populates cache', async () => {
  const e1 = { ...baseEntry, owner_id: 'u-1' };
  const e2 = { ...baseEntry, list_id: 'a2', owner_id: 'u-2' };
  const e3 = { ...baseEntry, list_id: 'a3', owner_id: 'u-1' }; // dupe
  let calls = 0;
  const fetchCard = async (uid) => { calls++; return { ...fullCard, id: uid }; };

  const out = await enrichProspectsWithUserCard({
    entries: [e1, e2, e3], fetchCard
  });

  assert.equal(calls, 2, 'should dedupe by owner_id');
  assert.ok(out.cache['u-1']);
  assert.ok(out.cache['u-2']);
  assert.equal(out.entries[0].user_reply_rate, 85);
  assert.equal(out.entries[2].user_reply_rate, 85);
});

test('enrichProspectsWithUserCard: respects TTL cache hit', async () => {
  const cache = { 'u-1': { card: fullCard, at: Date.now() } };
  let calls = 0;
  const fetchCard = async () => { calls++; return fullCard; };

  await enrichProspectsWithUserCard({
    entries: [{ ...baseEntry, owner_id: 'u-1' }],
    fetchCard, cache, ttlMs: 86400_000
  });

  assert.equal(calls, 0, 'fresh cache → no fetch');
});

test('enrichProspectsWithUserCard: TTL expired triggers re-fetch', async () => {
  const cache = { 'u-1': { card: fullCard, at: Date.now() - 2 * 86400_000 } };
  let calls = 0;
  const fetchCard = async () => { calls++; return fullCard; };

  await enrichProspectsWithUserCard({
    entries: [{ ...baseEntry, owner_id: 'u-1' }],
    fetchCard, cache, ttlMs: 86400_000
  });

  assert.equal(calls, 1, 'stale cache → fetch');
});

test('enrichProspectsWithUserCard: fetchCard throws → entry kept without enrichment', async () => {
  const fetchCard = async () => { throw new Error('boom'); };
  const out = await enrichProspectsWithUserCard({
    entries: [{ ...baseEntry, owner_id: 'u-1' }], fetchCard
  });
  assert.equal(out.entries[0].user_reply_rate, undefined);
});

test('enrichProspectsWithUserCard: empty entries → noop', async () => {
  const out = await enrichProspectsWithUserCard({ entries: [], fetchCard: async () => fullCard });
  assert.deepEqual(out.entries, []);
});

test('enrichProspectsWithUserCard: entries with no owner_id are skipped', async () => {
  let calls = 0;
  const fetchCard = async () => { calls++; return fullCard; };
  await enrichProspectsWithUserCard({
    entries: [{ ...baseEntry, owner_id: '' }, { ...baseEntry, owner_id: null }],
    fetchCard
  });
  assert.equal(calls, 0);
});

test('enrichProspectsWithUserCard: fetchCard renvoie null (datadome / 404) → entry intact', async () => {
  const fetchCard = async () => null;
  const out = await enrichProspectsWithUserCard({
    entries: [{ ...baseEntry, owner_id: 'u-1' }], fetchCard
  });
  assert.equal(out.entries[0].user_reply_rate, undefined);
  assert.equal(out.entries[0].owner_id, 'u-1');
});

test('enrichProspectsWithUserCard: card partiel (champs null) ne throw pas et merge', async () => {
  const partialCard = { id: 'u-1', isPro: false, totalAds: null, profilePicture: null };
  const fetchCard = async () => partialCard;
  const out = await enrichProspectsWithUserCard({
    entries: [{ ...baseEntry, owner_id: 'u-1' }], fetchCard
  });
  assert.equal(out.entries[0].user_total_ads, null);
  assert.equal(out.entries[0].user_reply_rate, null);
  assert.equal(out.entries[0].user_is_pro, false);
});

test('enrichProspectsWithUserCard: purge des entrées expirées > 2*ttlMs', async () => {
  const cache = {
    'u-fresh': { card: fullCard, at: Date.now() },
    'u-stale': { card: fullCard, at: Date.now() - 3 * 86400_000 }  // 3 jours
  };
  await enrichProspectsWithUserCard({
    entries: [{ ...baseEntry, owner_id: 'u-fresh' }],
    fetchCard: async () => fullCard,
    cache, ttlMs: 86400_000
  });
  assert.ok(cache['u-fresh'], 'fresh kept');
  assert.equal(cache['u-stale'], undefined, 'stale purged');
});

// ─── Drift detection : prospect.buildSearchPayload ↔ orchestrator inline ────

// Extract the body of fetchAdsViaTab from the file (between its `export async`
// declaration and the next `export async function`). Used to assert the inline
// payload structure doesn't drift from buildSearchPayload.
function extractFetchAdsViaTabBody() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(__dirname, '../orchestrator.js'), 'utf8');
  const start = src.indexOf('export async function fetchAdsViaTab');
  assert.ok(start > 0, 'fetchAdsViaTab declaration not found');
  const tail = src.slice(start + 1);
  const next = tail.indexOf('export async function');
  return next > 0 ? tail.slice(0, next) : tail;
}

test('drift: orchestrator inline payload contains every key from buildSearchPayload', () => {
  const expected = buildSearchPayload({
    keyword: 'x', offset: 100, ownerType: 'pro', shippable: true,
    priceMin: 10, priceMax: 90, departments: ['75'], adTypes: ['demand']
  });
  const body = extractFetchAdsViaTabBody();
  for (const key of Object.keys(expected)) {
    assert.ok(body.includes(key), `inline orchestrator payload missing key "${key}"`);
  }
  // listing_source toggle
  assert.ok(body.includes("'direct-search'"), 'inline missing listing_source direct-search');
  assert.ok(body.includes("'pagination'"), 'inline missing listing_source pagination');
});

test('drift: orchestrator inline conditional fields mirror buildSearchPayload flags', () => {
  const body = extractFetchAdsViaTabBody();
  assert.ok(/extra\.shippableOnly/.test(body), 'shippable not propagated');
  assert.ok(/extra\.ownerType\s*&&\s*extra\.ownerType\s*!==\s*'all'/.test(body), 'ownerType not gated by != all');
  assert.ok(/extra\.priceMin/.test(body), 'priceMin not propagated');
  assert.ok(/extra\.priceMax/.test(body), 'priceMax not propagated');
  assert.ok(/extra\.departments/.test(body), 'departments not propagated');
});

test('drift: fetchUserCardViaTab utilise les 4 endpoints web (sans api_key)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(__dirname, '../orchestrator.js'), 'utf8');
  const start = src.indexOf('export async function fetchUserCardViaTab');
  assert.ok(start > 0, 'fetchUserCardViaTab declaration not found');
  const tail = src.slice(start);
  const next = tail.indexOf('\nexport ', 1);
  const body = next > 0 ? tail.slice(0, next) : tail;

  // Les 4 paths web (pas /api/user-card/v2 qui est mobile-only)
  assert.ok(body.includes('/api/users/v1/users/'), 'missing account-type endpoint');
  assert.ok(body.includes('/api/adfinder/v2/owner_listing'), 'missing owner_listing endpoint');
  assert.ok(body.includes('/api/followme/v1/followers-number/'), 'missing followers endpoint');
  assert.ok(body.includes('/api/profile-picture/v1/users/'), 'missing picture endpoint');
  // Body owner_listing : doit utiliser filters.owner.user_id (validé live)
  assert.ok(/filters:\s*{\s*owner:\s*{\s*user_id/.test(body), 'owner_listing body shape incorrect');
  // PAS de api_key en tant que header actif (casse le CORS preflight).
  // Tolère les commentaires qui expliquent justement pourquoi.
  assert.ok(!/['"]api_key['"]\s*:/.test(body), 'api_key utilisé comme header — casse le CORS preflight');
  // Pattern Promise.all pour parallel
  assert.ok(/Promise\.all\s*\(\[/.test(body), 'endpoints pas appelés en parallèle');
});

// ─── filterFreshForNotification ───────────────────────────────────────────────

test('filterFreshForNotification: already-notified result is excluded', () => {
  const results = [
    { list_id: 'a1', score: 8 },
    { list_id: 'a2', score: 9 },
    { list_id: 'a3', score: 7 }
  ];
  const seen = new Set();
  const notified = new Set(['a1']);
  const ignored = new Set();
  const fresh = filterFreshForNotification(results, seen, notified, ignored, 5);
  assert.deepEqual(fresh.map(r => r.list_id), ['a2', 'a3']);
});

test('filterFreshForNotification: score below minScore is excluded', () => {
  const results = [{ list_id: 'b1', score: 4 }, { list_id: 'b2', score: 8 }];
  const fresh = filterFreshForNotification(results, new Set(), new Set(), new Set(), 7);
  assert.deepEqual(fresh.map(r => r.list_id), ['b2']);
});

test('filterFreshForNotification: seen and ignored also excluded', () => {
  const results = [
    { list_id: 'c1', score: 8 },
    { list_id: 'c2', score: 8 },
    { list_id: 'c3', score: 8 }
  ];
  const fresh = filterFreshForNotification(results, new Set(['c1']), new Set(), new Set(['c2']), 5);
  assert.deepEqual(fresh.map(r => r.list_id), ['c3']);
});

// ─── markResultsNotified (purge 7j) ──────────────────────────────────────────

test('markResultsNotified: purges entries older than 7 days and adds new ones', async () => {
  const profileId = 'test-profile';
  const now = Date.now();
  const eightDaysAgo = now - 8 * 24 * 3600 * 1000;
  const threeDaysAgo = now - 3 * 24 * 3600 * 1000;

  // Minimal chrome.storage.local mock
  let stored = {
    prospectNotifiedIdsByProfile: {
      [profileId]: {
        old_ad: eightDaysAgo,
        recent_ad: threeDaysAgo
      }
    }
  };
  const origChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => {
          if (typeof key === 'string') return { [key]: stored[key] };
          const out = {};
          for (const k of key) out[k] = stored[k];
          return out;
        },
        set: async (data) => { Object.assign(stored, data); }
      }
    }
  };

  try {
    await markResultsNotified(['new_ad'], profileId);
    const map = stored.prospectNotifiedIdsByProfile[profileId];
    assert.ok(!('old_ad' in map), 'entry older than 7 days should be purged');
    assert.ok('recent_ad' in map, 'entry within 7 days should be kept');
    assert.ok('new_ad' in map, 'newly notified id should be present');
  } finally {
    globalThis.chrome = origChrome;
  }
});

// ─── buildWebhookPayload ──────────────────────────────────────────────────────

test('buildWebhookPayload: produces correct shape and excludes sensitive fields', () => {
  const profile = { id: 'p-abc', name: 'Veille test' };
  const trigger = 'alarm';
  const fresh = [{
    list_id: 'x1', subject: 'Dev PHP', url: 'https://lbc.fr/x1', score: 9,
    location: 'Paris', kw_hit: 'php', age_days: 2, price: 500,
    owner_name: 'Bob',
    // Fields that must NOT appear in the payload
    score_breakdown: { title: 5, body: 3 },
    prospectContactedLocal: true,
    jwt: 'super-secret-token'
  }];

  const payload = buildWebhookPayload(profile, trigger, fresh);

  assert.deepEqual(payload.profile, { id: 'p-abc', name: 'Veille test' });
  assert.equal(payload.trigger, 'alarm');
  assert.ok(typeof payload.ts === 'string', 'ts should be an ISO string');
  assert.equal(payload.fresh.length, 1);

  const r = payload.fresh[0];
  assert.equal(r.list_id, 'x1');
  assert.equal(r.subject, 'Dev PHP');
  assert.equal(r.url, 'https://lbc.fr/x1');
  assert.equal(r.score, 9);
  assert.equal(r.location, 'Paris');
  assert.equal(r.kw_hit, 'php');
  assert.equal(r.age_days, 2);
  assert.equal(r.price, 500);
  assert.equal(r.owner_name, 'Bob');

  // Sensitive / verbose fields must be absent
  assert.ok(!('score_breakdown' in r), 'score_breakdown must not be in payload');
  assert.ok(!('prospectContactedLocal' in r), 'prospectContactedLocal must not be in payload');
  assert.ok(!('jwt' in r), 'jwt must not be in payload');
});
