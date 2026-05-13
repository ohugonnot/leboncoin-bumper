import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeBackup, deserializeBackup, diffBackup, fetchAndEncodePhotos } from '../backup.js';

const FIXTURES = [
  { id: '111', title: 'Annonce A', catSlug: 'services', status: 'En ligne' },
  { id: '222', title: 'Annonce B', catSlug: 'informatique', status: 'En ligne' },
];

// ── serializeBackup ───────────────────────────────────────────────────────────

test('serialize: produit un JSON valide avec la structure attendue', () => {
  const { filename, json, count } = serializeBackup(FIXTURES, 'Mon profil');
  assert.equal(count, 2);
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.extension, 'leboncoin-bumper');
  assert.equal(parsed.count, 2);
  assert.equal(parsed.profileName, 'Mon profil');
  assert.ok(Array.isArray(parsed.listings));
  assert.equal(parsed.listings.length, 2);
  assert.ok(parsed.exportedAt);
});

test('serialize: sans profileName → profileName null, filename sans tiret de profil', () => {
  const { filename, json } = serializeBackup(FIXTURES);
  const parsed = JSON.parse(json);
  assert.equal(parsed.profileName, null);
  // filename = lbc-backup-YYYY-MM-DD.json (pas de segment profil)
  assert.match(filename, /^lbc-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

test('serialize: filename contient profileName sanitisé + date', () => {
  const { filename } = serializeBackup(FIXTURES, 'Mon Profil!');
  // Caractères spéciaux remplacés par _
  assert.match(filename, /^lbc-backup-Mon_Profil_-\d{4}-\d{2}-\d{2}\.json$/);
});

test('serialize: listings vide → count = 0', () => {
  const { count, json } = serializeBackup([], 'vide');
  assert.equal(count, 0);
  const parsed = JSON.parse(json);
  assert.equal(parsed.listings.length, 0);
});

test('serialize: input undefined → traité comme tableau vide', () => {
  const { count } = serializeBackup(undefined);
  assert.equal(count, 0);
});

// ── deserializeBackup ─────────────────────────────────────────────────────────

test('deserialize: JSON valide → ok=true, listings restituées', () => {
  const { json } = serializeBackup(FIXTURES, 'test');
  const result = deserializeBackup(json);
  assert.equal(result.ok, true);
  assert.equal(result.listings.length, 2);
  assert.equal(result.meta.profileName, 'test');
  assert.equal(result.meta.version, 1);
});

test('deserialize: JSON cassé → ok=false avec message d\'erreur', () => {
  const result = deserializeBackup('{ pas du json valide }}}');
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});

test('deserialize: mauvaise version → ok=false', () => {
  const payload = JSON.stringify({
    version: 99,
    extension: 'leboncoin-bumper',
    exportedAt: new Date().toISOString(),
    profileName: null,
    count: 0,
    listings: []
  });
  const result = deserializeBackup(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /version/i);
});

test('deserialize: extension inconnue → ok=false', () => {
  const payload = JSON.stringify({
    version: 1,
    extension: 'autre-extension',
    exportedAt: new Date().toISOString(),
    profileName: null,
    count: 0,
    listings: []
  });
  const result = deserializeBackup(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /source inconnue/i);
});

test('deserialize: chaîne vide → ok=false', () => {
  const result = deserializeBackup('');
  assert.equal(result.ok, false);
});

test('deserialize: tableau au lieu d\'objet → ok=false', () => {
  const result = deserializeBackup(JSON.stringify([1, 2, 3]));
  assert.equal(result.ok, false);
});

test('deserialize: listings manquant → ok=false', () => {
  const payload = JSON.stringify({
    version: 1,
    extension: 'leboncoin-bumper',
    exportedAt: new Date().toISOString(),
    profileName: null,
    count: 0
    // pas de champ listings
  });
  const result = deserializeBackup(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /listings/i);
});

// ── diffBackup ────────────────────────────────────────────────────────────────

test('diff: annonces manquantes correctement identifiées', () => {
  const current = [{ id: '111' }, { id: '333' }];
  const backup = [{ id: '111' }, { id: '222' }, { id: '444' }];
  const { missing, existing } = diffBackup(current, backup);
  assert.deepEqual(missing.map(l => l.id).sort(), ['222', '444']);
  assert.deepEqual(existing.map(l => l.id), ['111']);
});

test('diff: toutes les annonces présentes → missing vide', () => {
  const current = [{ id: '111' }, { id: '222' }];
  const backup = [{ id: '111' }, { id: '222' }];
  const { missing, existing } = diffBackup(current, backup);
  assert.equal(missing.length, 0);
  assert.equal(existing.length, 2);
});

test('diff: current vide → toutes les backup manquantes', () => {
  const { missing, existing } = diffBackup([], FIXTURES);
  assert.equal(missing.length, 2);
  assert.equal(existing.length, 0);
});

test('diff: entrées sans id ignorées', () => {
  const current = [{ id: '111' }];
  const backup = [{ id: '111' }, { title: 'sans id' }];
  const { missing, existing } = diffBackup(current, backup);
  assert.equal(missing.length, 0);
  assert.equal(existing.length, 1);
});

test('diff: inputs undefined → résultat vide sans crash', () => {
  const { missing, existing } = diffBackup(undefined, undefined);
  assert.equal(missing.length, 0);
  assert.equal(existing.length, 0);
});

// ── fetchAndEncodePhotos ──────────────────────────────────────────────────────

function makeFetchMock(responses) {
  // responses: Map<url, { ok, dataUrl }> — or a default handler
  return async (url) => {
    const entry = responses[url];
    if (!entry) throw new Error('unexpected url: ' + url);
    if (!entry.ok) return { ok: false, status: 404, blob: async () => null };
    // Return a Blob-like object whose text is the data the FileReader will see.
    const fakeBlob = new Blob([entry.data], { type: entry.type || 'image/jpeg' });
    return { ok: true, status: 200, blob: async () => fakeBlob };
  };
}

test('fetchAndEncodePhotos: encode thumbnail via fetchFn', async () => {
  const listings = [
    { id: '1', title: 'A', thumbnail: 'https://img.lbc.fr/photo1.jpg' }
  ];
  const fetchMock = makeFetchMock({
    'https://img.lbc.fr/photo1.jpg': { ok: true, data: 'imgdata', type: 'image/jpeg' }
  });
  const { listings: out, encoded, total } = await fetchAndEncodePhotos(listings, fetchMock);
  assert.equal(total, 1);
  assert.equal(encoded, 1);
  assert.ok(out[0].thumbnail.startsWith('data:image/jpeg;base64,'), 'thumbnail should be a data URI');
});

test('fetchAndEncodePhotos: échec partiel → garde URL originale, pas de crash', async () => {
  const listings = [
    {
      id: '2', title: 'B',
      thumbnail: 'https://img.lbc.fr/ok.jpg',
      photos: ['https://img.lbc.fr/fail.jpg', 'https://img.lbc.fr/ok2.jpg']
    }
  ];
  const fetchMock = makeFetchMock({
    'https://img.lbc.fr/ok.jpg':  { ok: true, data: 'img1', type: 'image/jpeg' },
    'https://img.lbc.fr/fail.jpg': { ok: false },
    'https://img.lbc.fr/ok2.jpg': { ok: true, data: 'img2', type: 'image/png' }
  });
  const { listings: out, encoded, total } = await fetchAndEncodePhotos(listings, fetchMock);
  assert.equal(total, 3); // 2 photos + 1 thumbnail
  assert.equal(encoded, 2); // fail.jpg kept as URL
  // fail.jpg stays as original URL string
  assert.equal(out[0].photos[0], 'https://img.lbc.fr/fail.jpg');
  // ok2.jpg is encoded
  assert.ok(out[0].photos[1].startsWith('data:'), 'second photo should be encoded');
  // thumbnail encoded
  assert.ok(out[0].thumbnail.startsWith('data:'), 'thumbnail should be encoded');
});

test('fetchAndEncodePhotos: listings sans photos ni thumbnail → inchangé', async () => {
  const listings = [{ id: '3', title: 'C' }];
  const { listings: out, encoded, total } = await fetchAndEncodePhotos(listings, async () => {
    throw new Error('should not be called');
  });
  assert.equal(total, 0);
  assert.equal(encoded, 0);
  assert.deepEqual(out[0], { id: '3', title: 'C' });
});
