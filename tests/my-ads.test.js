import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt, buildMyAdsPayload, normalizeAd, normalizeClassifiedAd, normalizeUserCard, mapStatus } from '../my-ads.js';

// ─── decodeJwt ────────────────────────────────────────────────────────────────

// Build a minimal valid JWT: header.payload.signature (all base64url-encoded)
function makeJwt(payload) {
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.fakesig`;
}

test('decodeJwt: returns parsed payload with account_id', () => {
  const jwt = makeJwt({ account_id: 'abc-123', sub: 'user@example.com', exp: 9999999999 });
  const result = decodeJwt(jwt);
  assert.equal(result.account_id, 'abc-123');
  assert.equal(result.sub, 'user@example.com');
});

test('decodeJwt: throws on empty string', () => {
  assert.throws(() => decodeJwt(''), /invalid jwt/i);
});

test('decodeJwt: throws on non-string', () => {
  assert.throws(() => decodeJwt(null), /invalid jwt/i);
});

test('decodeJwt: throws on JWT with only one part', () => {
  assert.throws(() => decodeJwt('onlyone'), /invalid jwt/i);
});

test('decodeJwt: throws on JWT with invalid base64 payload', () => {
  // header.badpayload.sig — payload is not base64url-decodable to JSON
  assert.throws(() => decodeJwt('eyJhbGciOiJIUzI1NiJ9.!!!.fakesig'), /invalid jwt/i);
});

// ─── buildMyAdsPayload ────────────────────────────────────────────────────────

test('buildMyAdsPayload: defaults offset=0, limit=100', () => {
  const p = buildMyAdsPayload({ userId: 'u-001' });
  assert.equal(p.offset, 0);
  assert.equal(p.limit, 100);
  assert.equal(p.filters.owner.user_id, 'u-001');
  assert.equal(p.context, 'default');
  assert.equal(p.sort_by, 'time');
  assert.equal(p.sort_order, 'desc');
  assert.equal(p.include_inactive, true);
  assert.equal(p.include_draft, true);
});

test('buildMyAdsPayload: offset and limit can be overridden', () => {
  const p = buildMyAdsPayload({ userId: 'u-002', offset: 30, limit: 50 });
  assert.equal(p.offset, 30);
  assert.equal(p.limit, 50);
  assert.equal(p.filters.owner.user_id, 'u-002');
});

// ─── mapStatus ────────────────────────────────────────────────────────────────

test('mapStatus: active → En ligne', () => {
  assert.equal(mapStatus('active'), 'En ligne');
});

test('mapStatus: paused → En pause', () => {
  assert.equal(mapStatus('paused'), 'En pause');
});

test('mapStatus: inactive → En pause', () => {
  assert.equal(mapStatus('inactive'), 'En pause');
});

test('mapStatus: pending → En cours de vérification', () => {
  assert.equal(mapStatus('pending'), 'En cours de vérification');
});

test('mapStatus: expired → Expirée', () => {
  assert.equal(mapStatus('expired'), 'Expirée');
});

test('mapStatus: unknown value passthrough', () => {
  assert.equal(mapStatus('some_future_status'), 'some_future_status');
});

test('mapStatus: null/undefined → null', () => {
  assert.equal(mapStatus(undefined), null);
  assert.equal(mapStatus(null), null);
});

// ─── normalizeAd (real fixture from dashboard-search-response.json) ───────────

// Ad 1: cours particuliers / active / with price=0 / Lyon
const rawAd1 = {
  list_id: 3196611948,
  subject: 'Propose cours d\'informatique particuliers bénévoles à distance',
  body: 'Professionnel de l\'informatique depuis 10 ans...',
  price: [0],
  category_id: '36',
  category_name: 'Cours particuliers',
  images: {
    nb_images: 1,
    thumb_url: 'https://img.leboncoin.fr/api/v1/lbcpb1/images/0c/01/7b/0c017bf12f27f59a982758fab556c6064ceec1f3.jpg?rule=ad-thumb',
    urls: ['https://img.leboncoin.fr/api/v1/lbcpb1/images/0c/01/7b/0c017bf12f27f59a982758fab556c6064ceec1f3.jpg?rule=ad-image']
  },
  location: { city: 'Lyon', zipcode: '69002', department_id: '69' },
  owner: { user_id: 'c32a1e9d-2c20-4282-92d0-ceb8cb6c0d3d', type: 'private' },
  status: 'active',
  first_publication_date: '2026-05-12 16:21:38',
  url: 'https://www.leboncoin.fr/ad/cours_particuliers/3196611948'
};

// Ad 2: jeux_video / active / no explicit price field
const rawAd2 = {
  list_id: 3118280238,
  subject: 'Aide Gratuite Rétrogaming – installation et conseils personnalisés',
  body: 'Salut les passionnés de retrogaming...',
  price: [0],
  category_id: '84',
  category_name: 'Jeux vidéo',
  images: {
    nb_images: 1,
    thumb_url: 'https://img.leboncoin.fr/api/v1/lbcpb1/images/17/23/79/1723790209bf01961fc955ca8343a80832e5f3b6.jpg?rule=ad-thumb',
    urls: ['https://img.leboncoin.fr/api/v1/lbcpb1/images/17/23/79/1723790209bf01961fc955ca8343a80832e5f3b6.jpg?rule=ad-image']
  },
  location: { city: 'Besançon', zipcode: '25000', department_id: '25' },
  owner: { user_id: 'c32a1e9d-2c20-4282-92d0-ceb8cb6c0d3d', type: 'private' },
  status: 'active',
  first_publication_date: '2025-12-27 15:44:48',
  url: 'https://www.leboncoin.fr/ad/jeux_video/3118280238'
};

test('normalizeAd: backward-compat fields present and correct', () => {
  const ad = normalizeAd(rawAd1);
  assert.equal(ad.id, '3196611948');
  assert.equal(ad.catSlug, 'cours_particuliers');
  assert.equal(ad.href, '/ad/cours_particuliers/3196611948');
  assert.equal(ad.title, 'Propose cours d\'informatique particuliers bénévoles à distance');
  assert.equal(ad.status, 'En ligne');
  assert.ok(ad.thumbnail?.includes('thumb'));
});

test('normalizeAd: new fields populated', () => {
  const ad = normalizeAd(rawAd1);
  assert.equal(ad.price, 0);
  assert.equal(ad.categoryId, '36');
  assert.equal(ad.categoryName, 'Cours particuliers');
  assert.deepEqual(ad.photos, ['https://img.leboncoin.fr/api/v1/lbcpb1/images/0c/01/7b/0c017bf12f27f59a982758fab556c6064ceec1f3.jpg?rule=ad-image']);
  assert.deepEqual(ad.location, { city: 'Lyon', zipcode: '69002', dept: '69' });
  assert.deepEqual(ad.owner, { userId: 'c32a1e9d-2c20-4282-92d0-ceb8cb6c0d3d', type: 'private' });
  assert.equal(ad.publishedAt, '2026-05-12 16:21:38');
});

test('normalizeAd: second ad maps correctly (different catSlug)', () => {
  const ad = normalizeAd(rawAd2);
  assert.equal(ad.id, '3118280238');
  assert.equal(ad.catSlug, 'jeux_video');
  assert.equal(ad.href, '/ad/jeux_video/3118280238');
  assert.equal(ad.status, 'En ligne');
  assert.equal(ad.location.city, 'Besançon');
  assert.equal(ad.location.dept, '25');
});

test('normalizeAd: ad with no images returns empty photos array', () => {
  const ad = normalizeAd({ ...rawAd1, images: undefined });
  assert.deepEqual(ad.photos, []);
  assert.equal(ad.thumbnail, null);
});

test('normalizeAd: ad with no location returns null location', () => {
  const ad = normalizeAd({ ...rawAd1, location: undefined });
  assert.equal(ad.location, null);
});

// ─── normalizeAd — stats ──────────────────────────────────────────────────────

test('normalizeAd: stats present → mapped correctly', () => {
  const ad = normalizeAd({ ...rawAd1, stats: { Views: 7, Favorites: 2, Messages: 1, Leads: 3, Phones: 0, Replies: 1 } });
  assert.deepEqual(ad.stats, { views: 7, favorites: 2, messages: 1, leads: 3, phones: 0, replies: 1 });
});

test('normalizeAd: stats absent → all zeros', () => {
  const ad = normalizeAd({ ...rawAd1, stats: undefined });
  assert.deepEqual(ad.stats, { views: 0, favorites: 0, messages: 0, leads: 0, phones: 0, replies: 0 });
});

test('normalizeAd: stats partial (only Views) → missing fields default to 0', () => {
  const ad = normalizeAd({ ...rawAd1, stats: { Views: 5 } });
  assert.equal(ad.stats.views, 5);
  assert.equal(ad.stats.favorites, 0);
  assert.equal(ad.stats.messages, 0);
  assert.equal(ad.stats.leads, 0);
  assert.equal(ad.stats.phones, 0);
  assert.equal(ad.stats.replies, 0);
});

// ─── normalizeClassifiedAd (response shape: /api/adfinder/v1/classified/{id}) ───

const rawClassified = {
  list_id: 3196611948,
  subject: 'Test annonce',
  body: 'Description test',
  price_cents: 12345, // = 123.45
  category_id: '36',
  category_name: 'Cours particuliers',
  images: {
    urls_large: ['https://img.leboncoin.fr/api/v1/lbcpb1/images/aa/bb/cc/aabbcc.jpg?rule=ad-large']
  },
  attributes: [
    { key: 'shippable', value: 'true', value_label: 'Disponible' }
  ],
  location: { city: 'Paris', zipcode: '75001', department_id: '75', lat: 48.85, lng: 2.34 },
  owner: { user_id: 'u-1', type: 'private', name: 'Alice' },
  status: 'active',
  ad_type: 'offer',
  has_phone: true,
  counters: { favorites: 7 },
  first_publication_date: '2026-05-12 16:21:38',
  expiration_date: '2026-08-12 16:21:38',
  url: 'https://www.leboncoin.fr/ad/cours_particuliers/3196611948'
};

test('normalizeClassifiedAd: maps price_cents → price (euros)', () => {
  const ad = normalizeClassifiedAd(rawClassified);
  assert.equal(ad.price, 123.45);
});

test('normalizeClassifiedAd: maps images.urls_large → photos', () => {
  const ad = normalizeClassifiedAd(rawClassified);
  assert.deepEqual(ad.photos, ['https://img.leboncoin.fr/api/v1/lbcpb1/images/aa/bb/cc/aabbcc.jpg?rule=ad-large']);
});

test('normalizeClassifiedAd: maps counters.favorites + has_phone', () => {
  const ad = normalizeClassifiedAd(rawClassified);
  assert.equal(ad.favorites, 7);
  assert.equal(ad.hasPhone, true);
});

test('normalizeClassifiedAd: preserves attributes array', () => {
  const ad = normalizeClassifiedAd(rawClassified);
  assert.equal(ad.attributes.length, 1);
  assert.equal(ad.attributes[0].key, 'shippable');
});

test('normalizeClassifiedAd: location includes lat/lng', () => {
  const ad = normalizeClassifiedAd(rawClassified);
  assert.equal(ad.location.lat, 48.85);
  assert.equal(ad.location.lng, 2.34);
});

test('normalizeClassifiedAd: owner.name included', () => {
  const ad = normalizeClassifiedAd(rawClassified);
  assert.equal(ad.owner.name, 'Alice');
});

test('normalizeClassifiedAd: price_cents missing → price null', () => {
  const ad = normalizeClassifiedAd({ ...rawClassified, price_cents: undefined });
  assert.equal(ad.price, null);
});

test('normalizeClassifiedAd: derives catSlug from url', () => {
  const ad = normalizeClassifiedAd(rawClassified);
  assert.equal(ad.catSlug, 'cours_particuliers');
  assert.equal(ad.id, '3196611948');
});

test('normalizeClassifiedAd: empty attributes when missing', () => {
  const ad = normalizeClassifiedAd({ ...rawClassified, attributes: undefined });
  assert.deepEqual(ad.attributes, []);
});

// ─── normalizeUserCard (/api/user-card/v2/{id}/infos) ────────────────────────

const rawUser = {
  user_id: 'u-42',
  name: 'Alice',
  registered_at: '2020-01-15',
  location: 'Paris',
  account_type: 'private',
  total_ads: 12,
  description: 'Bonjour',
  profile_picture: { extra_large_url: 'https://x/p.jpg' },
  feedback: {
    overall_score: 0.9,          // → 4.5 on /5 scale
    received_count: 30,
    category_scores: { COMMUNICATION: 0.95, RESPECT: 0.88 }
  },
  reply: { rate: 85, rate_text: 'Très réactif', in_minutes: 12, reply_time_text: 'Répond en ~12min' },
  presence: { status: 'online', presence_text: 'En ligne', last_activity: '2026-05-14T09:00:00Z', enabled: true },
  badges: [{ type: 'identity_verified', name: 'Identité vérifiée' }]
};

test('normalizeUserCard: scales overall_score to /5', () => {
  const u = normalizeUserCard(rawUser);
  assert.equal(u.feedback.score, 4.5);
});

test('normalizeUserCard: maps reply + presence', () => {
  const u = normalizeUserCard(rawUser);
  assert.equal(u.reply.rate, 85);
  assert.equal(u.reply.inMinutes, 12);
  assert.equal(u.presence.status, 'online');
  assert.equal(u.presence.lastActivity, '2026-05-14T09:00:00Z');
});

test('normalizeUserCard: badges preserved', () => {
  const u = normalizeUserCard(rawUser);
  assert.equal(u.badges.length, 1);
  assert.equal(u.badges[0].type, 'identity_verified');
});

test('normalizeUserCard: category_scores partial — missing keys are null', () => {
  const u = normalizeUserCard(rawUser);
  assert.equal(u.feedback.categoryScores.communication, 0.95);
  assert.equal(u.feedback.categoryScores.product, null);
});

test('normalizeUserCard: isPro derived from account_type', () => {
  const priv = normalizeUserCard(rawUser);
  assert.equal(priv.isPro, false);
  const pro = normalizeUserCard({ ...rawUser, account_type: 'pro' });
  assert.equal(pro.isPro, true);
});

test('normalizeUserCard: feedback null when overall_score missing', () => {
  const u = normalizeUserCard({ ...rawUser, feedback: {} });
  assert.equal(u.feedback.score, null);
});

test('normalizeUserCard: pro block populated when proData provided', () => {
  const proData = {
    online_store_id: 7,
    online_store_name: 'Acme',
    owner: { activitySector: 'Auto', siren: '123456789', siret: '12345678900012', activeSince: '2018-03-01' },
    brand: { logo: { large: 'https://x/l.png' }, slogan: 'Best deals' },
    information: { description: 'Pro desc', opening_hours: '9-18', website_url: 'https://acme.fr' },
    rating: { rating_value: 4.2, user_ratings_total: 88 }
  };
  const u = normalizeUserCard({ ...rawUser, account_type: 'pro' }, proData);
  assert.equal(u.pro.onlineStoreName, 'Acme');
  assert.equal(u.pro.siret, '12345678900012');
  assert.equal(u.pro.rating.value, 4.2);
});

test('normalizeUserCard: pro null when not pro', () => {
  const u = normalizeUserCard(rawUser, null);
  assert.equal(u.pro, null);
});
