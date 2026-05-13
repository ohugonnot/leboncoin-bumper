import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreAd, ageDays, buildSearchPayload, buildEntry,
  sortEntries, runProspectScan, formatReplyTemplate,
  parseProfileKeywords, explainScore, groupByOwner,
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
