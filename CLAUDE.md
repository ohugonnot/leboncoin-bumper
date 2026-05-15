# leboncoin-bumper — gotchas non déductibles du code

## Architecture réseau
- **Tous les fetches `api.leboncoin.fr` doivent partir d'une vraie tab leboncoin.fr** — DataDome rejette les requêtes depuis `chrome-extension://` avec 403 + captcha.
- Conséquence : `chrome.scripting.executeScript` sérialise la fonction → **pas d'import possible**, duplication inline acceptée (`fetchAdsViaTab`, `fetchAdDetailViaTab`, `fetchUserCardViaTab`).
- `api_key: 'ba0c2dad52b3ec'` = clé publique du client web LBC, visible dans toute requête navigateur. Non secret.

## Endpoints LBC utilisés
- `POST /finder/search` — anonyme, prospect scan. Header `api_key: ba0c2dad52b3ec` requis. Payload mimique le site (`listing_source`, `extend`, `disable_total`, `limit_alu`).
- `GET /api/adfinder/v1/classified/{id}` — anonyme, détail d'une annonce. **Header `api_key` obligatoire** (sinon 403 systématique, validé live 2026-05-14). Sentinels : 403/404/410/error.
- `POST /api/dashboard/v1/search` — **auth Bearer JWT** (`localStorage.luat`), dashboard utilisateur. Pas d'api_key.
- `GET /messaging/proxy/api/v1/hal/{userId}/conversations` — **auth Bearer JWT**, userId dans cookie `lbc_user_id`. Pagination HAL via `_links.next`.

## Endpoints user-card : web-aggregated (4 endpoints, PAS de api_key)
`fetchUserCardViaTab(uid)` agrège ces 4 endpoints en parallèle (Promise.all) :
- `GET /api/users/v1/users/{uid}/account-type` → `{accountType: "private-individual"|"pro-..."}`
- `POST /api/adfinder/v2/owner_listing` body `{filters:{owner:{user_id:uid}}, limit, offset}` → `{total, total_active, ads:[...]}`
- `GET /api/followme/v1/followers-number/{uid}` → `{count}`
- `GET /api/profile-picture/v1/users/{uid}/picture` → `{extra_large_url, large_url, ...}`

**Piège majeur** : **AUCUN header `api_key`** sur ces 4 endpoints (contrairement à `/finder/search` et `/classified/{id}` qui l'exigent). Si on l'ajoute, CORS preflight rejette → "Failed to fetch" opaque. Validé live 2026-05-15.

Limitation : le path web n'expose PAS feedback/reply/presence/badges/name/registered_at (mobile-only). Les champs concernés restent `null` après enrichissement.

## Endpoints LBC mobile-only (à éviter depuis browser)
- `GET /api/user-card/v2/{id}/infos` : mobile-only. Depuis browser → "Failed to fetch" même sans/avec api_key (DataDome TLS-reject avant CORS, validé live 2026-05-14). La lib `etienne-hd/lbc` y arrive via UA + TLS fingerprint mobile via curl_cffi — impossible depuis extension Chrome.

## Auth — pièges
- `localStorage.luat` = JWT court. Décodé sans vérif (`my-ads.decodeJwt`) pour extraire `account_id`.
- `lbc_user_id` cookie ≠ `account_id` JWT. Le messaging veut le cookie, le dashboard veut le JWT-payload.
- 403 = DataDome captcha, **pas** session expirée (la tab a chargé OK). Surfacé via `notifyDatadomeBlock(source)` + storage `datadomeBlock`.

## Conventions internes
- Robustesse fetch pattern : retry 5xx (backoff 400/1200ms) + AbortController 15s + sentinels 403/404 → toujours répliqué inline dans chaque tab block.
- Cache user-card : `chrome.storage.local.userCardCache[uid] = { card, at }`, TTL 24h, géré par `prospect.enrichProspectsWithUserCard`.
- Audit framework : `audit/RUBRIC.md` + `audit/STATE.json` + `audit/LOG.md` — scoring 7 axes pour l'amélioration itérative.

## Tests
- `npm test` = Node test runner, 220+ tests purs (pas de fetch réseau).
- `npx playwright test --config tests/e2e/playwright.config.js` = 33+ e2e via serveur statique local sur `http://localhost:7331`, mock `chrome.*` injecté avant chargement modules. `tests/e2e/extension.spec.js` charge l'extension MV3 réelle (`--headless=new` + `launchPersistentContext`) — catch les violations CSP.
- Fetch réseau jamais testé en e2e (DataDome) — couvert par normalizers purs.

## Tests live LBC (session connectée)
- Profil Playwright persistant **déjà connecté à LBC** : `~/.config/playwright-mcp-leboncoin/` — utilisé par les outils `mcp__playwright__browser_*`. Ne pas en créer un nouveau, réutiliser celui-ci. Cookies LBC + JWT survivent entre sessions.
- WSLg dispo (`DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`) → on peut lancer Chromium headed visible côté utilisateur.
- Chromium Playwright binaires dans `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` (prendre la version la plus récente).
- L'utilisateur ne souhaite **jamais** d'action destructive auto en test live : pas de submit du wizard de dépôt, pas de click sur Supprimer. S'arrêter avant l'action finale.
