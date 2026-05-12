# Changelog

Toutes les modifications notables sont listées ici.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et ce projet suit le [Versioning Sémantique](https://semver.org/lang/fr/).

## [0.1.0] — 2026-05-12

### Ajouté
- Release publique initiale.
- **Bumper** : cycle hebdomadaire qui scrape chaque annonce active, la supprime, puis la republie à l'identique (titre, description, prix, localité, photos, préférence numéro masqué).
- **Prospect Watch** : scan hebdomadaire des demandes leboncoin via `/finder/search`, avec moteur de scoring regex et index `seenIds`.
- UI popup avec deux onglets (Bumper / Prospects), réglages persistés dans `chrome.storage.local`.
- Suite de tests Node-only couvrant la logique de scoring, le dédoublonnage et les régressions regex.
- Licence MIT + disclaimer CGU.
