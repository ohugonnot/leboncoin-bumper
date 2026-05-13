const BACKUP_VERSION = 1;
const EXTENSION_ID = 'leboncoin-bumper';

/**
 * Sérialise une liste d'annonces scrapées en format JSON portable.
 * @param {object[]} listings  Liste depuis storage.local.myListings.listings
 * @param {string} [profileName]
 * @returns {{ filename: string, json: string, count: number }}
 */
export function serializeBackup(listings, profileName) {
  const safe = Array.isArray(listings) ? listings : [];
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const profilePart = profileName
    ? '-' + profileName.replace(/[^a-z0-9]/gi, '_').slice(0, 30)
    : '';
  const filename = `lbc-backup${profilePart}-${datePart}.json`;
  const payload = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    extension: EXTENSION_ID,
    profileName: profileName || null,
    count: safe.length,
    listings: safe
  };
  return { filename, json: JSON.stringify(payload, null, 2), count: safe.length };
}

/**
 * Désérialise et valide un JSON de backup.
 * @param {string} jsonText  Contenu brut du fichier
 * @returns {{ ok: true, listings: object[], meta: object } | { ok: false, error: string }}
 */
export function deserializeBackup(jsonText) {
  if (typeof jsonText !== 'string' || !jsonText.trim()) {
    return { ok: false, error: 'Fichier vide ou invalide.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'JSON invalide — fichier corrompu ou mauvais format.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Format inattendu — l\'objet racine est manquant.' };
  }
  if (parsed.extension !== EXTENSION_ID) {
    return { ok: false, error: `Source inconnue (extension="${parsed.extension}") — ce fichier ne provient pas de Booster Leboncoin.` };
  }
  if (parsed.version !== BACKUP_VERSION) {
    return { ok: false, error: `Version ${parsed.version} non supportée (attendu : ${BACKUP_VERSION}).` };
  }
  if (!Array.isArray(parsed.listings)) {
    return { ok: false, error: 'Format invalide — champ "listings" manquant ou non-tableau.' };
  }
  const meta = {
    version: parsed.version,
    exportedAt: parsed.exportedAt || null,
    profileName: parsed.profileName || null,
    count: parsed.count ?? parsed.listings.length
  };
  return { ok: true, listings: parsed.listings, meta };
}

/**
 * Fetches each photo URL and replaces it with a base64 data URI so the backup
 * remains self-contained after Leboncoin purges its CDN.
 *
 * Stored listings carry a `photos` array (strings or {url, ...} objects) and/or
 * a `thumbnail` string. Both are encoded when present.
 * A failed fetch keeps the original URL — one bad photo never aborts the whole export.
 *
 * @param {object[]} listings
 * @param {Function} [fetchFn=fetch]  Injectable for tests.
 * @param {Function} [onProgress]     Called with { done, total } after each photo.
 * @returns {Promise<{ listings: object[], encoded: number, total: number }>}
 */
export async function fetchAndEncodePhotos(listings, fetchFn = fetch, onProgress) {
  const safe = Array.isArray(listings) ? listings : [];
  let done = 0;

  // Count every URL that will be attempted.
  const total = safe.reduce((n, l) => {
    return n + (l.photos?.length || 0) + (l.thumbnail ? 1 : 0);
  }, 0);

  let encoded = 0;
  const out = [];

  for (const l of safe) {
    const next = { ...l };

    // Encode photos array (strings or {url, ...} objects).
    if (Array.isArray(l.photos) && l.photos.length) {
      const newPhotos = [];
      for (const photo of l.photos) {
        const url = typeof photo === 'string' ? photo : photo?.url;
        if (url) {
          const dataUri = await _fetchDataUri(url, fetchFn);
          if (dataUri) {
            newPhotos.push(typeof photo === 'string' ? dataUri : { ...photo, dataUri });
            encoded++;
          } else {
            newPhotos.push(photo);
          }
        } else {
          newPhotos.push(photo);
        }
        done++;
        onProgress?.({ done, total });
      }
      next.photos = newPhotos;
    }

    if (l.thumbnail) {
      const dataUri = await _fetchDataUri(l.thumbnail, fetchFn);
      if (dataUri) {
        next.thumbnail = dataUri;
        encoded++;
      }
      done++;
      onProgress?.({ done, total });
    }

    out.push(next);
  }

  return { listings: out, encoded, total };
}

async function _fetchDataUri(url, fetchFn) {
  try {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await _blobToDataUri(blob);
  } catch {
    return null;
  }
}

async function _blobToDataUri(blob) {
  // FileReader is browser-only; in Node (tests) fall back to arrayBuffer + Buffer.
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  return `data:${blob.type};base64,${b64}`;
}

/**
 * Compare les annonces actives vs le backup — retourne celles manquantes dans current.
 * La comparaison se fait par ID d'annonce (champ `id`).
 * @param {object[]} current  Annonces actives (myListings.listings)
 * @param {object[]} backup   Annonces du fichier backup
 * @returns {{ missing: object[], existing: object[] }}
 */
export function diffBackup(current, backup) {
  const currentIds = new Set((current || []).map(l => l.id).filter(Boolean));
  const missing = (backup || []).filter(l => l.id && !currentIds.has(l.id));
  const existing = (backup || []).filter(l => l.id && currentIds.has(l.id));
  return { missing, existing };
}
