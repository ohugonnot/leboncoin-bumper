# Leboncoin Bumper

> Chrome MV3 extension that **auto-bumps your leboncoin listings** every week and **watches for tech demands** matching your skills.

<p align="center">
  <img src="docs/screenshots/prospect-hero.png" width="480" alt="Prospect Watch screen — fresh demands matching your skills, scored and deduplicated">
</p>

[![Tests](https://img.shields.io/badge/tests-18%20passing-success)](#tests)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Manifest](https://img.shields.io/badge/Chrome-MV3-orange)](manifest.json)

## Why

If you sell or offer services on leboncoin.fr, your listings sink in search results after a few days. The only free way to come back to the top is to **delete and repost**. Doing it manually for 5–10 listings every week is annoying.

This extension does it for you, on a weekly schedule, fully local, no third-party service. As a bonus, it also scans leboncoin for **fresh tech-related demands** you might want to answer (developer, WordPress help, automation, retrogaming…).

## Features

### ↻ Bumper
- **Scrapes your active listings** (title, body, price, location, photos)
- **Deletes them** via leboncoin's own confirmation flow
- **Reposts them identically** via the deposit wizard (category auto-matched, photos re-uploaded, phone-hidden preference preserved)
- **Weekly schedule** via `chrome.alarms`
- **Dry-run mode** to preview without acting
- **Filter by listing IDs** to test on a subset first

### 🎯 Prospect Watch
- Hits leboncoin's **`/finder/search` API** directly (one POST per keyword)
- **62 default tech keywords** tuned for a French full-stack dev profile, fully editable
- **Scoring engine** with strong/moderate/negative regex signals — drops jardiniers/ménages/colocations, keeps WordPress/Symfony/N8N/IA missions
- **`<30 days` freshness filter**
- **Dedup with `seenIds`** — once you've reviewed an ad, it stays in the list but loses the orange `NEW` badge
- **Weekly schedule** independent of the bumper
- **Click-through** to the leboncoin ad in a new tab

## Install

> The extension is not on the Chrome Web Store. Install it as an unpacked extension.

```bash
git clone https://github.com/ohugonnot/leboncoin-bumper.git
```

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** in the top-right.
3. Click **Load unpacked** and select the cloned `leboncoin-bumper/` folder.
4. Pin the orange icon to your toolbar.

<p align="center">
  <img src="docs/screenshots/install-extensions-page.png" width="640" alt="chrome://extensions page after install">
</p>

Make sure you are **logged into leboncoin.fr** in the same Chrome profile before using the bumper.

## Usage

### Bumper

<p align="center">
  <img src="docs/screenshots/bumper.png" width="480" alt="Bumper tab — schedule + dry-run + per-ID filter + live log">
</p>

1. Open the popup, **Bumper** tab.
2. Keep **Dry-run** checked for the first run. Optionally enter one of your real listing IDs in **Restreindre aux IDs** to test on a single ad.
3. Click **Lancer maintenant**. Watch the log — you should see `Found N listings.` then `scraped: …` and `[dry-run] would delete + repost.`
4. If the dry-run looks right, uncheck **Dry-run**, check **Activé**, set a Day/Hour, leave the IDs field empty (= bump everything). The next bump happens at the chosen time and then every 7 days.

### Prospect Watch

1. Open the popup, **🎯 Prospects** tab.
2. Click **Scanner maintenant**. ~30–60 s for 62 keywords.
3. Read the cards (most relevant first). Click any title to open the ad in a new tab.
4. Click **Marquer toutes comme vues** once you've processed them — next scan only highlights what's truly new.
5. Optionally enable **Veille hebdo activée** to run the scan automatically every week.

### Customizing the keywords

The default keyword list is tuned for a French full-stack dev. Edit the textarea in the **Prospects** tab (one keyword per line) to match your own niche.

## Configuration reference

All state lives in `chrome.storage.local`. The popup exposes:

| Tab | Setting | Effect |
|---|---|---|
| Bumper | `enabled` | Run the bump cycle on schedule |
| Bumper | `dryRun` | Scrape only; never delete or repost |
| Bumper | `dayOfWeek`/`hour`/`minute` | When to fire |
| Bumper | `onlyAdIds` | Comma-separated allow-list; empty = all listings |
| Prospects | `enabled` | Run the scan on schedule |
| Prospects | `dayOfWeek`/`hour` | When to fire |
| Prospects | `minScore` | Drop ads scored below (default 5) |
| Prospects | `maxAgeDays` | Drop ads older than (default 30) |
| Prospects | `keywords` | One keyword per line |

## How it works

```
┌────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ chrome.alarms  │───►│  background.js   │───►│  orchestrator.js    │
│ (weekly)       │    │  (service worker)│    │  scrape → delete →  │
└────────────────┘    └──────────────────┘    │  repost via tab     │
                              │                └─────────────────────┘
                              │                ┌─────────────────────┐
                              └───────────────►│  prospect.js        │
                                               │  /finder/search API │
                                               │  score + dedup      │
                                               └─────────────────────┘
```

- **Bumper** (`orchestrator.js`) drives a real Chrome tab through the leboncoin UI. It mirrors what you'd click yourself: card → "Supprimer" → `button-delete-confirm` → deposit wizard. All selectors are reverse-engineered from the live DOM.
- **Prospect Watch** (`prospect.js`) calls the same API leboncoin's own frontend uses (`POST https://api.leboncoin.fr/finder/search`) with `ad_type=demand`. The `api_key` is the public web-client key visible in every browser request.

## Tests

Pure scoring/dedup logic is covered by Node's built-in test runner — no extra deps.

```bash
npm test
# or
node --test tests/
```

18 tests, ~120 ms. Coverage includes regex regressions (e.g. "vue" alone must not match the JS framework signal), seenIds behavior, age filtering, and dedup across keywords.

## Limitations & disclaimer

- **leboncoin's Terms of Service forbid automated actions.** Using this extension may get your account flagged or suspended. Use a throwaway account first if you are risk-averse.
- The bumper depends on leboncoin's HTML/DOM. When they redesign, selectors break. Open an issue or send a PR — fixes are typically 5-line locator updates.
- The first deposit wizard step occasionally shows an extra "Type" (Offre/Demande) screen depending on the auto-detected category. The orchestrator skips it when not present.
- DataDome (leboncoin's anti-bot) is fine with low-volume usage in a real user session. Don't crank the schedule below daily.

This project is **not affiliated with leboncoin.fr** in any way. It is provided "as is" under the MIT license — see [LICENSE](LICENSE).

## Roadmap

- [ ] Visual picker for "Restreindre aux IDs" (auto-list listings with checkboxes)
- [ ] Per-listing status (✓ bumped / ⏸ skipped / ✗ failed) in a dashboard
- [ ] Persistent run history (last 5 cycles)
- [ ] Optional micro-randomization of repost timestamps to look more natural
- [ ] Open the body of a prospect inline (no need to leave the popup)

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Selector fixes after a leboncoin redesign are the most valuable contribution.

## Credits

Built by [Odilon Hugonnot](https://www.web-developpeur.com) — full-stack backend dev (PHP/Symfony/Go), Besançon, France.
