// Pure helpers for fetching the user's own listings via the dashboard API
// instead of DOM-scraping /mes-annonces.

const DASHBOARD_API = 'https://api.leboncoin.fr/api/dashboard/v1/search';

/**
 * Decode JWT payload without signature verification.
 * @param {string} jwt
 * @returns {object}
 */
export function decodeJwt(jwt) {
  if (typeof jwt !== 'string' || !jwt) throw new Error('invalid jwt: empty or non-string');
  const parts = jwt.split('.');
  if (parts.length < 2) throw new Error('invalid jwt: expected 3 dot-separated parts');
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  let json;
  try {
    json = atob(b64);
  } catch {
    throw new Error('invalid jwt: base64 decode failed');
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('invalid jwt: payload is not valid JSON');
  }
}

/**
 * Build the POST body for one page of /api/dashboard/v1/search.
 */
export function buildMyAdsPayload({ userId, offset = 0, limit = 100 }) {
  return {
    context: 'default',
    filters: { owner: { user_id: userId } },
    limit,
    offset,
    sort_by: 'time',
    sort_order: 'desc',
    include_inactive: true,
    include_draft: true
  };
}

// Map the raw dashboard status enum to the same human labels that
// scrapeListings() produced — downstream code does regex on these strings.
const STATUS_MAP = {
  active:   'En ligne',
  paused:   'En pause',
  // Less common states observed in the wild
  inactive: 'En pause',
  pending:  'En cours de vérification',
  expired:  'Expirée',
  deleted:  'Expirée',
  draft:    'Expirée'
};

/**
 * Map raw dashboard `status` string → human label used by the rest of the extension.
 * @param {string} rawStatus
 * @returns {string}
 */
export function mapStatus(rawStatus) {
  return STATUS_MAP[rawStatus] ?? rawStatus ?? null;
}

/**
 * Normalize one raw ad from the dashboard API to the shape consumed by the extension.
 *
 * Backward-compat fields (present in old scrapeListings output):
 *   id, catSlug, title, href, thumbnail, status
 *
 * New fields added on top (used by backup/duplicate feature):
 *   description, price, categoryId, categoryName,
 *   photos, location, owner, publishedAt
 */
export function normalizeAd(rawAd) {
  // Derive catSlug + canonical href from the `url` field.
  // URL shape: https://www.leboncoin.fr/ad/<catSlug>/<id>
  const urlMatch = (rawAd.url || '').match(/\/ad\/([^/]+)\/(\d+)/);
  const catSlug = urlMatch?.[1] ?? null;
  const idFromUrl = urlMatch?.[2] ?? null;
  const id = String(rawAd.list_id ?? idFromUrl ?? '');
  const href = catSlug && id ? `/ad/${catSlug}/${id}` : (rawAd.url || null);

  return {
    id,
    catSlug,
    title: rawAd.subject ?? null,
    href,
    thumbnail: rawAd.images?.thumb_url ?? null,
    status: mapStatus(rawAd.status),
    description: rawAd.body ?? null,
    price: rawAd.price?.[0] ?? null,
    categoryId: rawAd.category_id ?? null,
    categoryName: rawAd.category_name ?? null,
    photos: rawAd.images?.urls ?? [],
    location: rawAd.location
      ? {
          city:    rawAd.location.city    ?? null,
          zipcode: rawAd.location.zipcode ?? null,
          dept:    rawAd.location.department_id ?? null
        }
      : null,
    owner: rawAd.owner
      ? { userId: rawAd.owner.user_id ?? null, type: rawAd.owner.type ?? null }
      : null,
    publishedAt: rawAd.first_publication_date ?? null,
    stats: {
      views:     rawAd.stats?.Views     ?? 0,
      favorites: rawAd.stats?.Favorites ?? 0,
      messages:  rawAd.stats?.Messages  ?? 0,
      leads:     rawAd.stats?.Leads     ?? 0,
      phones:    rawAd.stats?.Phones    ?? 0,
      replies:   rawAd.stats?.Replies   ?? 0,
    }
  };
}

/**
 * Normalize one raw ad from /api/adfinder/v1/classified/{id} — the public
 * single-ad endpoint. Differs from the dashboard payload:
 *  - price exposed as `price_cents` (integer cents), not array
 *  - photos in `images.urls_large`, not `images.urls`
 *  - `counters.favorites` replaces `stats.Favorites`
 *  - includes `has_phone`, `expiration_date`, `attributes[]`
 *
 * Used to replace DOM-scraping the /editer page for backup/duplicate flows.
 */
export function normalizeClassifiedAd(rawAd) {
  const urlMatch = (rawAd.url || '').match(/\/ad\/([^/]+)\/(\d+)/);
  const catSlug = urlMatch?.[1] ?? null;
  const idFromUrl = urlMatch?.[2] ?? null;
  const id = String(rawAd.list_id ?? idFromUrl ?? '');
  const price = rawAd.price_cents != null ? rawAd.price_cents / 100 : null;

  return {
    id,
    catSlug,
    title: rawAd.subject ?? null,
    description: rawAd.body ?? null,
    price,
    categoryId: rawAd.category_id ?? null,
    categoryName: rawAd.category_name ?? null,
    photos: rawAd.images?.urls_large ?? [],
    attributes: Array.isArray(rawAd.attributes) ? rawAd.attributes : [],
    location: rawAd.location
      ? {
          city:    rawAd.location.city    ?? null,
          zipcode: rawAd.location.zipcode ?? null,
          dept:    rawAd.location.department_id ?? null,
          lat:     rawAd.location.lat     ?? null,
          lng:     rawAd.location.lng     ?? null
        }
      : null,
    owner: rawAd.owner
      ? { userId: rawAd.owner.user_id ?? null, type: rawAd.owner.type ?? null, name: rawAd.owner.name ?? null }
      : null,
    publishedAt: rawAd.first_publication_date ?? null,
    expiresAt: rawAd.expiration_date ?? null,
    status: rawAd.status ?? null,
    adType: rawAd.ad_type ?? null,
    hasPhone: !!rawAd.has_phone,
    favorites: rawAd.counters?.favorites ?? 0,
    url: rawAd.url ?? (catSlug && id ? `https://www.leboncoin.fr/ad/${catSlug}/${id}` : null)
  };
}

/**
 * Normalize the response from /api/user-card/v2/{userId}/infos (+ optional
 * /api/onlinestores/v2/users/{userId}?fields=all for pro accounts).
 *
 * Fields surfaced are tuned for prospect-enrichment use cases:
 *  - replyRate / replyInMinutes : how reactive is this seller
 *  - presence.lastActivity      : recently online?
 *  - feedback.score             : trust signal (0-5)
 *  - accountType (pro|private)  : filter target
 *  - totalAds                   : activity level
 *
 * @param {object} userData  raw /user-card/v2 body
 * @param {object|null} proData  raw /onlinestores/v2 body (null for private)
 */
export function normalizeUserCard(userData, proData = null) {
  const fb = userData?.feedback ?? {};
  const cs = fb.category_scores ?? {};
  const reply = userData?.reply ?? {};
  const presence = userData?.presence ?? {};
  const badges = Array.isArray(userData?.badges) ? userData.badges : [];

  // overall_score is 0-1 in the API ; *5 mirrors lbc lib's exposed range.
  const feedbackScore = fb.overall_score != null ? fb.overall_score * 5 : null;

  const out = {
    id: userData?.user_id ?? null,
    name: userData?.name ?? null,
    registeredAt: userData?.registered_at ?? null,
    location: userData?.location ?? null,
    accountType: userData?.account_type ?? null,
    totalAds: userData?.total_ads ?? 0,
    description: userData?.description ?? null,
    profilePicture: userData?.profile_picture?.extra_large_url ?? null,
    feedback: {
      score: feedbackScore,
      receivedCount: fb.received_count ?? 0,
      categoryScores: {
        cleanness:     cs.CLEANNESS     ?? null,
        communication: cs.COMMUNICATION ?? null,
        conformity:    cs.CONFORMITY    ?? null,
        package:       cs.PACKAGE       ?? null,
        product:       cs.PRODUCT       ?? null,
        recommendation: cs.RECOMMENDATION ?? null,
        respect:       cs.RESPECT       ?? null,
        transaction:   cs.TRANSACTION   ?? null,
        userAttention: cs.USER_ATTENTION ?? null
      }
    },
    reply: {
      rate:       reply.rate           ?? null,
      rateText:   reply.rate_text      ?? null,
      inMinutes:  reply.in_minutes     ?? null,
      timeText:   reply.reply_time_text ?? null
    },
    presence: {
      status:       presence.status        ?? null,
      text:         presence.presence_text ?? null,
      lastActivity: presence.last_activity ?? null,
      enabled:      !!presence.enabled
    },
    badges: badges.map(b => ({ type: b.type ?? null, name: b.name ?? null })),
    isPro: userData?.account_type === 'pro',
    pro: null,
    // Champs exposes uniquement par le path web-aggregated (fetchUserCardViaTab).
    // null si la source venait d'un autre fetcher (futur mobile-via-curl ou rien).
    web: userData?._web_extras ? {
      followers: userData._web_extras.followers ?? null,
      adsTotal: userData._web_extras.ads_total ?? null,
      adsActive: userData._web_extras.ads_active ?? null,
      pictureDefault: userData._web_extras.picture_default ?? null
    } : null
  };

  if (proData) {
    const owner = proData.owner ?? {};
    const brand = proData.brand ?? {};
    const info  = proData.information ?? {};
    const rating = proData.rating ?? {};
    out.pro = {
      onlineStoreId:   proData.online_store_id   ?? null,
      onlineStoreName: proData.online_store_name ?? null,
      activitySector:  owner.activitySector     ?? null,
      siren:           owner.siren              ?? null,
      siret:           owner.siret              ?? null,
      activeSince:     owner.activeSince        ?? null,
      logo:            brand.logo?.large        ?? null,
      cover:           brand.cover?.large       ?? null,
      slogan:          brand.slogan             ?? null,
      description:     info.description         ?? null,
      openingHours:    info.opening_hours       ?? null,
      websiteUrl:      info.website_url         ?? null,
      rating: {
        value: rating.rating_value       ?? null,
        total: rating.user_ratings_total ?? 0
      }
    };
  }

  return out;
}
