// Central pacing config + jitter helpers, shared across the extension.
// Pure (no chrome.*) so it imports into the service worker, popup, and is
// JSON-passed into executeScript funcs.
export const PACING = {
  warmup:       [1500, 3500],   // ms, after tab load, before 1st fetch
  page:         [600, 1600],    // ms, between pagination pages
  keyword:      [1200, 3000],   // ms, between prospect-scan keywords
  card:         [500, 1200],    // ms, between the 4 user-card endpoints
  photo:        [150, 500],     // ms, between photo CDN fetches
  longPauseEvery: 20,           // every N requests in a long loop
  longPause:    [15000, 35000], // ms, "human stepped away" pause
  backoffBase:  1000,           // ms, full-jitter backoff base on 5xx
  backoffCap:   30000,
  maxRetries:   2               // retries on 5xx/network before giving up
};

export function jitter(min, max) {
  return min + Math.random() * (max - min);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
