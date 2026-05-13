// Peak-hour heuristics per category group. dow: 0=Sun…6=Sat, -1=any day.
export const CATEGORY_PEAKS = {
  services:   [{ dow: -1, hour: 9 }, { dow: -1, hour: 14 }],
  emploi:     [{ dow: -1, hour: 9 }, { dow: -1, hour: 14 }],
  prestations:[{ dow: -1, hour: 9 }, { dow: -1, hour: 14 }],
  cours_particuliers: [{ dow: -1, hour: 9 }, { dow: -1, hour: 14 }],
  autres_services:    [{ dow: -1, hour: 9 }, { dow: -1, hour: 14 }],

  jeux_video:             [{ dow: -1, hour: 19 }],
  jeux_jouets:            [{ dow: -1, hour: 19 }],
  informatique:           [{ dow: -1, hour: 19 }],
  accessoires_informatique:[{ dow: -1, hour: 19 }],
  consoles:               [{ dow: -1, hour: 19 }],

  vetements:    [{ dow: -1, hour: 18 }, { dow: 0, hour: 10 }, { dow: 6, hour: 10 }],
  decoration:   [{ dow: -1, hour: 18 }, { dow: 0, hour: 10 }, { dow: 6, hour: 10 }],
  ameublement:  [{ dow: -1, hour: 18 }, { dow: 0, hour: 10 }, { dow: 6, hour: 10 }],
  electromenager:[{ dow: -1, hour: 18 }, { dow: 0, hour: 10 }, { dow: 6, hour: 10 }],

  locations:          [{ dow: 0, hour: 10 }, { dow: 6, hour: 10 }, { dow: -1, hour: 18 }],
  ventes_immobilieres:[{ dow: 0, hour: 10 }, { dow: 6, hour: 10 }, { dow: -1, hour: 18 }],
  voitures:           [{ dow: 0, hour: 10 }, { dow: 6, hour: 10 }, { dow: -1, hour: 18 }],
  motos:              [{ dow: 0, hour: 10 }, { dow: 6, hour: 10 }, { dow: -1, hour: 18 }],
};

// Peaks for unknown categories: 19h weekdays, 11h weekends.
const DEFAULT_PEAKS = [
  { dow: 0, hour: 11 },
  { dow: 6, hour: 11 },
  { dow: -1, hour: 19 },
];

/**
 * Returns the next optimal slot for a given category starting from `now`.
 * @param {string} category
 * @param {Date}   now
 * @param {number} [minHoursAhead=2]
 * @returns {Date}
 */
export function nextPeakSlot(category, now, minHoursAhead = 2) {
  const peaks = CATEGORY_PEAKS[category] ?? DEFAULT_PEAKS;
  const earliest = new Date(now.getTime() + minHoursAhead * 3600_000);

  // Expand peaks over the next 8 days (enough to cover any dow=-1 and specific dow combos).
  const candidates = [];
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    for (const peak of peaks) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(peak.hour, 0, 0, 0);
      if (candidate < earliest) continue;
      if (peak.dow !== -1 && candidate.getDay() !== peak.dow) continue;
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => a - b);
  return candidates[0];
}

/**
 * Next optimal slot for a batch of listings. For mixed categories, picks the
 * earliest slot that falls in the majority category's peak, or the median
 * candidate when no majority exists.
 * @param {string[]} categories
 * @param {Date}     now
 * @param {number}   [minHoursAhead=2]
 * @returns {Date}
 */
export function nextPeakSlotForBatch(categories, now, minHoursAhead = 2) {
  if (!categories?.length) return nextPeakSlot(undefined, now, minHoursAhead);

  const freq = {};
  for (const c of categories) freq[c] = (freq[c] ?? 0) + 1;
  const dominant = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];

  if (freq[dominant] / categories.length > 0.5) {
    return nextPeakSlot(dominant, now, minHoursAhead);
  }

  // No clear majority: pick the median slot across unique categories.
  const slots = [...new Set(categories)].map(c => nextPeakSlot(c, now, minHoursAhead));
  slots.sort((a, b) => a - b);
  return slots[Math.floor(slots.length / 2)];
}

/**
 * Fraction of planned bump times that fall within any peak window (±30 min).
 * Returns a number in [0, 1].
 * @param {Date[]}   plannedAt  Array of Date objects representing scheduled bumps.
 * @param {string[]} categories Parallel array (one per listing); can be shorter/longer.
 * @returns {number}
 */
export function planningPeakCoverage(plannedAt, categories) {
  if (!plannedAt?.length) return 0;

  const WINDOW_MS = 30 * 60_000;

  let hits = 0;
  for (const date of plannedAt) {
    const hour = date.getHours() + date.getMinutes() / 60;
    const dow  = date.getDay();

    // Union all peaks across all supplied categories.
    const allPeaks = new Set();
    const catList = categories?.length ? categories : [];
    for (const cat of catList) {
      const peaks = CATEGORY_PEAKS[cat] ?? DEFAULT_PEAKS;
      for (const p of peaks) allPeaks.add(`${p.dow}:${p.hour}`);
    }
    if (!allPeaks.size) {
      // No categories supplied: use defaults.
      for (const p of DEFAULT_PEAKS) allPeaks.add(`${p.dow}:${p.hour}`);
    }

    let inPeak = false;
    for (const key of allPeaks) {
      const [d, h] = key.split(':').map(Number);
      if (d !== -1 && d !== dow) continue;
      const diff = Math.abs(hour - h) * 3600_000;
      if (diff <= WINDOW_MS) { inPeak = true; break; }
    }
    if (inPeak) hits++;
  }

  return hits / plannedAt.length;
}
