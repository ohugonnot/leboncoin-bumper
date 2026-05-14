# Changelog

Toutes les modifications notables sont listées ici.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et ce projet suit le [Versioning Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté
- Payload `/finder/search` enrichi : `listing_source`, `extend`, `disable_total`, `limit_alu` (mimétisme client web officiel).
- Filtres serveur `owner_type` (pro/private/all) et `filters.location.shippable` poussés côté API au lieu d'être appliqués post-fetch.
- Détection 403 DataDome explicite sur les trois chemins authentifiés (`/finder/search`, `/api/dashboard/v1/search`, `/messaging/proxy/...`) + stockage `datadomeBlock` + notification système (throttle 1 h).
- Retry exponentiel sur 5xx (2 retries, backoff 400ms/1200ms) sur `fetchAdsViaTab` et `fetchAdDetailViaTab`.
- Timeout par tentative via `AbortController` (15 s) sur les mêmes chemins.
- `orchestrator.fetchAdDetailViaTab(adId)` : GET `/api/adfinder/v1/classified/{id}` avec sentinels 403/404/410.
- `orchestrator.fetchUserCardViaTab(userId)` : GET `/api/user-card/v2/{id}/infos` + `/api/onlinestores/v2/users/{id}?fields=all` si pro.
- `my-ads.normalizeClassifiedAd(raw)` et `my-ads.normalizeUserCard(userData, proData)` : normalisation pure des réponses.
- `prospect.mergeUserCardIntoEntry(entry, card)` + `prospect.enrichProspectsWithUserCard({entries, fetchCard, cache, ttlMs, concurrency})` : enrichissement prospects avec reply rate, présence, feedback, badges ; cache 24 h.

### Modifié
- `prospect.buildSearchPayload` accepte désormais `ownerType`, `shippable`, `priceMin/Max`, `departments`, `adTypes` et émet le payload mimicry officiel.

## [0.3.0] — 2026-05

### Ajouté
- **Multi-veilles isolées** : profils Prospect nommés, chacun avec ses keywords, filtres, template et résultats indépendants.
- **Scoring v2 transparent** : poids `:N` par keyword, titre ×2 vs description, breakdown au survol du ★.
- **Filtres Prospects étendus** : prix min/max, départements, type (Demande / Offre / Les deux), vendeur Pro/Particulier, livraison seulement.
- **Tri d'affichage** : pertinence / récent / prix asc/desc — les NOUVEAUX bullent toujours en tête.
- **Messages** : onglet boîte de réception avec classification anti-scam (9 patterns) en 4 catégories (scam / lead / question / spam), filtres, archivage local.
- **Smart Bump** : planning au prochain créneau de pic selon la catégorie des annonces.
- **Backup / Restore JSON** : export local des annonces (URLs ou photos en base64), import qui republie les manquantes.
- **Éditer avant republier** : modifier titre, description ou prix appliqués au prochain bump.
- **Dashboard API** pour récupérer les annonces actives (fallback DOM scrape).
- **Login dot** + détection conversations existantes (badge "DÉJÀ contacté").

## [0.1.0] — 2026-05-12

### Ajouté
- Release publique initiale.
- **Bumper** : cycle hebdomadaire qui scrape chaque annonce active, la supprime, puis la republie à l'identique (titre, description, prix, localité, photos, préférence numéro masqué).
- **Prospect Watch** : scan hebdomadaire des demandes leboncoin via `/finder/search`, avec moteur de scoring regex et index `seenIds`.
- UI popup avec deux onglets (Bumper / Prospects), réglages persistés dans `chrome.storage.local`.
- Suite de tests Node-only couvrant la logique de scoring, le dédoublonnage et les régressions regex.
- Licence MIT + disclaimer CGU.
