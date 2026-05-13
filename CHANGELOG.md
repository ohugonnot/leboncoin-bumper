# Changelog

Toutes les modifications notables sont listées ici.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et ce projet suit le [Versioning Sémantique](https://semver.org/lang/fr/).

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
