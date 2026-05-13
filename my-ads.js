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
