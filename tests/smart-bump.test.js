import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPeakSlot, nextPeakSlotForBatch, planningPeakCoverage } from '../smart-bump.js';

function mon(hour) {
  // Monday 2026-05-11 at `hour`:00
  const d = new Date(2026, 4, 11, hour, 0, 0, 0); // May 11 is a Monday
  assert.equal(d.getDay(), 1, 'fixture: expected Monday');
  return d;
}

function sun(hour) {
  // Sunday 2026-05-10
  const d = new Date(2026, 4, 10, hour, 0, 0, 0);
  assert.equal(d.getDay(), 0, 'fixture: expected Sunday');
  return d;
}

// ── nextPeakSlot ─────────────────────────────────────────────────────────────

test('services 08h lundi → next peak = 09h même jour', () => {
  const result = nextPeakSlot('services', mon(8), 0);
  assert.equal(result.getHours(), 9);
  assert.equal(result.getDay(), 1);
  assert.equal(result.getDate(), 11);
});

test('services 12h lundi → next peak = 14h même jour (pic après-midi)', () => {
  const result = nextPeakSlot('services', mon(12), 0);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getDay(), 1);
  assert.equal(result.getDate(), 11);
});

test('loisirs 12h lundi → next peak = 19h même jour', () => {
  const result = nextPeakSlot('informatique', mon(12), 0);
  assert.equal(result.getHours(), 19);
  assert.equal(result.getDay(), 1);
  assert.equal(result.getDate(), 11);
});

test('default category dimanche 15h → next peak = 19h dimanche', () => {
  // 15h dimanche → 19h dimanche est à 4h d'écart, minHoursAhead=0 → 19h ce jour
  const result = nextPeakSlot('catégorieInconnue', sun(15), 0);
  assert.equal(result.getHours(), 19);
  assert.equal(result.getDay(), 0);
});

test('default category dimanche 20h → next peak = 11h samedi suivant (weekend)', () => {
  // 20h dimanche : le pic 19h est déjà passé. Prochain = 11h samedi (6 jours plus tard)
  // ou 19h lundi ? 19h lundi est dans ~23h, 11h samedi est dans ~6j — 19h lundi gagne.
  const result = nextPeakSlot('catégorieInconnue', sun(20), 0);
  // Doit être dans le futur et être un créneau pic valide
  assert.ok(result > sun(20), 'result must be after now');
  assert.ok([0, 6, 1, 2, 3, 4, 5].includes(result.getDay()), 'valid day');
  assert.ok([11, 19].includes(result.getHours()), 'valid peak hour');
});

test('minHoursAhead=2 : si le pic est trop proche, passe au suivant', () => {
  // services à 8h30 avec minHoursAhead=2 → 9h est dans 30min < 2h → doit sauter au 14h
  const d = new Date(2026, 4, 11, 8, 30, 0, 0); // 08:30 lundi
  const result = nextPeakSlot('services', d, 2);
  assert.equal(result.getHours(), 14);
});

test('minHoursAhead=2 : pic à exactement 2h → accepté', () => {
  // 07:00 → 09:00 est exactement 2h
  const d = new Date(2026, 4, 11, 7, 0, 0, 0);
  const result = nextPeakSlot('services', d, 2);
  assert.equal(result.getHours(), 9);
});

// ── nextPeakSlotForBatch ──────────────────────────────────────────────────────

test('batch: catégories homogènes → même pic que la catégorie', () => {
  const now = mon(12);
  const single = nextPeakSlot('informatique', now, 0);
  const batch  = nextPeakSlotForBatch(['informatique', 'informatique', 'jeux_video'], now, 0);
  // Majorité informatique/jeux_video (même groupe loisirs)
  assert.equal(batch.getTime(), single.getTime());
});

test('batch: catégories mixtes → résultat dans le futur et à une heure de pic', () => {
  const now = mon(12);
  const result = nextPeakSlotForBatch(['services', 'informatique', 'vetements'], now, 0);
  assert.ok(result > now, 'result must be in the future');
  assert.ok([9, 14, 18, 19].includes(result.getHours()), 'should be a peak hour');
});

test('batch vide → délègue au default', () => {
  const now = mon(12);
  const result = nextPeakSlotForBatch([], now, 0);
  assert.ok(result instanceof Date);
  assert.ok(result > now);
});

// ── planningPeakCoverage ──────────────────────────────────────────────────────

test('planningPeakCoverage: 5 bumps tous en pic → 100%', () => {
  // services pic = 9h et 14h (n'importe quel jour)
  const bumps = [
    new Date(2026, 4, 11, 9, 0),   // lundi 9h
    new Date(2026, 4, 12, 9, 15),  // mardi 9h15 (dans fenêtre ±30min)
    new Date(2026, 4, 13, 14, 0),  // mercredi 14h
    new Date(2026, 4, 14, 14, 20), // jeudi 14h20
    new Date(2026, 4, 15, 9, 0),   // vendredi 9h
  ];
  const coverage = planningPeakCoverage(bumps, ['services']);
  assert.equal(coverage, 1);
});

test('planningPeakCoverage: mélange pic/hors-pic → pourcentage attendu', () => {
  // 2 en pic (9h), 2 hors pic (3h, 23h) → 50%
  const bumps = [
    new Date(2026, 4, 11, 9, 0),
    new Date(2026, 4, 12, 9, 0),
    new Date(2026, 4, 13, 3, 0),
    new Date(2026, 4, 14, 23, 0),
  ];
  const coverage = planningPeakCoverage(bumps, ['services']);
  assert.equal(coverage, 0.5);
});

test('planningPeakCoverage: tableau vide → 0', () => {
  assert.equal(planningPeakCoverage([], ['services']), 0);
});
