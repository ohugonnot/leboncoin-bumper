# leboncoin-bumper — gotchas non déductibles du code

## Architecture réseau
- **Tous les fetches `api.leboncoin.fr` doivent partir d'une vraie tab leboncoin.fr** — DataDome rejette les requêtes depuis `chrome-extension://` avec 403 + captcha.
- Conséquence : `chrome.scripting.executeScript` sérialise la fonction → **pas d'import possible**, duplication inline acceptée (`fetchAdsViaTab`, `fetchAdDetailViaTab`, `fetchUserCardViaTab`).
- `api_key: 'ba0c2dad52b3ec'` = clé publique du client web LBC, visible dans toute requête navigateur. Non secret.

## Endpoints LBC utilisés
- `POST /finder/search` — anonyme, prospect scan. Payload mimique le site (`listing_source`, `extend`, `disable_total`, `limit_alu`).
- `GET /api/adfinder/v1/classified/{id}` — anonyme, détail d'une annonce. Sentinels : 403/404/410/error.
- `GET /api/user-card/v2/{id}/infos` — anonyme, profil public (feedback, reply rate, presence). Chain avec `/api/onlinestores/v2/users/{id}?fields=all` si `account_type === 'pro'` (404 toléré : pros sans page publique).
- `POST /api/dashboard/v1/search` — **auth Bearer JWT** (`localStorage.luat`), dashboard utilisateur.
- `GET /messaging/proxy/api/v1/hal/{userId}/conversations` — **auth Bearer JWT**, userId dans cookie `lbc_user_id`. Pagination HAL via `_links.next`.

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
- `npx playwright test --config tests/e2e/playwright.config.js` = 33 e2e via serveur statique local sur `http://localhost:7331`, mock `chrome.*` injecté avant chargement modules.
- Fetch réseau jamais testé en e2e (DataDome) — couvert par normalizers purs.
