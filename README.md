# Booster Leboncoin

> **Extension Chrome / Edge / Brave** pour **freelances et auto-entrepreneurs** : **republie automatiquement tes annonces Leboncoin** chaque semaine et **détecte les demandes de prospects** (développement web, WordPress, dépannage, retrogaming, automatisation, IA…) avec scoring de pertinence et **réponse en un clic**.
>
> 🇫🇷 *100 % local, sans serveur tiers, sans abonnement. Multi-veilles, filtres avancés (prix, département, livraison, pro/particulier), template de réponse pré-rempli.*

<p align="center">
  <img src="docs/screenshots/prospect-hero.png" width="720" alt="Booster Leboncoin — onglet Prospects : veille multi-profil, scoring pondéré, ignore / contacter en un clic">
</p>

[![Tests](https://img.shields.io/badge/tests-231%20passing-success)](#tests)
[![Licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
[![Manifest](https://img.shields.io/badge/Chrome-MV3-orange)](manifest.json)
[![No tracking](https://img.shields.io/badge/données-100%25%20local-success)](#vie-privée)

**Mots-clés** : extension Leboncoin · republier annonces automatiquement · bump Leboncoin · auto-repost Leboncoin · veille prospects freelance · trouver des clients sur Leboncoin · prospection développeur web · WordPress · Symfony · PrestaShop · retrogaming · API Leboncoin · Manifest V3 · extension freelance France

🇬🇧 **English version** below ([#english](#english))

---

## Pourquoi cette extension ?

Sur Leboncoin, **tes annonces de freelance / artisan / vendeur coulent en quelques jours** dans les résultats de recherche. Le seul moyen gratuit de remonter en haut, c'est de **supprimer puis republier**. Sur 5 à 10 annonces, chaque semaine, à la main, c'est une corvée.

En parallèle, des **dizaines de demandes** apparaissent chaque jour sur Leboncoin ("cherche développeur WordPress", "besoin d'aide retrogaming", "recherche dépannage Symfony"…) — mais sans veille, **tu passes à côté**.

**Booster Leboncoin** automatise les deux :

- **↻ Bumper** : republie tes annonces selon un planning, à l'heure que tu choisis.
- **🎯 Prospects** : scrute Leboncoin sur tes mots-clés, score chaque annonce par pertinence, te prévient des nouvelles demandes, et ouvre la messagerie pré-remplie au clic.

Tout tourne dans ton navigateur. **Aucune donnée ne quitte ta machine.** Pas de compte, pas de SaaS, pas d'abonnement.

## Fonctionnalités

### ↻ Republier (Bumper)

- **Récupère tes annonces actives** (titre, description, prix, localité, photos, préférences de contact)
- **Les supprime puis les republie à l'identique** via le wizard de dépôt natif (catégorie auto-matchée, photos ré-uploadées)
- **Sélecteur visuel** : coche les annonces à bumper directement dans la liste, avec miniatures + statut
- **Annonces "en pause" détectées et ignorées** automatiquement
- **Planning hebdomadaire** précis (jour + heure + jitter optionnel pour humaniser)
- **🤖 Smart Bump** : planifie au prochain créneau de forte affluence selon la catégorie de tes annonces (services/B2B en journée, loisirs/tech en soirée, immo/véhicules le soir et weekend)
- **Éditer avant republier** : modifier titre, description ou prix d'une annonce sans la modifier sur Leboncoin (qui demande un paiement). Les modifications s'appliquent au prochain bump.
- **Mode test (dry-run)** pour prévisualiser sans rien toucher
- **Confirmation explicite** avant chaque cycle réel

### 💬 Messages — filtre anti-scam + classement boîte de réception

- **Classification automatique** de chaque message en 4 catégories : 🚨 Scam · 💬 Lead · ❓ Question · 🗑 Spam
- **9 patterns d'arnaque détectés** : mandat-cash / Western Union, QR-code, faux transporteur, WhatsApp/Telegram hors plateforme, téléphone étranger, liens externes, PayPal Friends, code SMS, urgence + voyage
- **Filtres + recherche** dans la boîte de réception, badges visuels par catégorie
- **Archives locales** : "Archiver" un message le cache de l'extension sans rien supprimer côté Leboncoin (restaurable)

### 🎯 Prospects — veille intelligente

- **Multi-veilles isolées** : crée plusieurs profils ("Dev web", "Retrogaming", "Dépannage local"…) chacun avec ses keywords, filtres, template et résultats indépendants
- **Scoring pondéré transparent** : `+2 × poids` si match dans le titre, `+1 × poids` si dans la description, `+1` si demande détectée (cherche / recherche / besoin / aide / conseil). Syntaxe `recalbox:3` pour booster un keyword
- **Détail du score au survol du ★** — plus de boîte noire
- **Filtres Leboncoin natifs** : prix min/max, départements (codes postaux), type d'annonce (Demande / Offre / Les deux)
- **Post-filtres** : Vendeur (Pro / Particulier / Tous), Avec livraison uniquement
- **Tri d'affichage** : pertinence ★ / plus récent / prix croissant ou décroissant (les **NOUVEAUX bullent toujours en tête**)
- **Ignorer une annonce** d'un clic → elle disparaît et **ne reviendra plus** dans les prochains scans
- **Bouton Contacter** : ouvre `/reply/{id}` et **pré-remplit la zone de message** avec ton template (placeholders `{subject}`, `{keyword}`, `{location}`)
- **Détection des conversations déjà entamées** via l'API messagerie Leboncoin — badge sur les annonces déjà contactées
- **Notifications desktop** au-dessus d'un seuil de score configurable (1 = toute nouvelle annonce, 3+ = seulement les plus pertinentes)
- **Planning flexible** : chaque heure / chaque jour / chaque semaine, indépendant du bumper
- **Enrichissement profil vendeur (opt-in)** : pour les top-N résultats, agrège 4 endpoints LBC (account type, nombre total d'annonces du vendeur, followers, photo de profil) pour t'aider à prioriser les prospects sérieux vs comptes test. Cache 24 h, dedup par vendeur, dégradation gracieuse si DataDome bloque. À activer dans le storage du profil via `enrichUserCard: true` (UI à venir).

## Captures d'écran

<p align="center">
  <img src="docs/screenshots/prospect-hero.png" width="720" alt="Onglet Prospects — multi-veille, scoring, Ignore / Contacter">
  <br><em>Onglet Prospects : veille multi-profil avec scoring transparent et actions par card</em>
</p>

<p align="center">
  <img src="docs/screenshots/bumper.png" width="720" alt="Onglet Republier — sélecteur d'annonces, stats par annonce (vues/favoris/contacts), Smart Bump, backup JSON">
  <br><em>Onglet Republier : sélection visuelle, stats vues/favoris/contacts, Smart Bump au pic d'affluence, backup JSON local</em>
</p>

<p align="center">
  <img src="docs/screenshots/messages.png" width="720" alt="Onglet Messages — filtre anti-scam, classement scam/lead/question/spam, recherche">
  <br><em>Onglet Messages : classification automatique anti-scam, filtres et recherche dans la boîte de réception</em>
</p>

## Installation

> L'extension n'est **pas sur le Chrome Web Store** (les CGU Leboncoin compliquent la review). Installation manuelle en 60 secondes.

```bash
git clone https://github.com/ohugonnot/leboncoin-bumper.git
```

1. Ouvre `chrome://extensions` (ou `edge://extensions`, `brave://extensions`)
2. Active le **Mode développeur** (interrupteur en haut à droite)
3. Clique **Charger l'extension non empaquetée** et sélectionne le dossier `leboncoin-bumper/`
4. Épingle l'icône à ta barre d'outils

<p align="center">
  <img src="docs/screenshots/install-extensions-page.png" width="640" alt="Page chrome://extensions après installation de Booster Leboncoin">
</p>

Assure-toi d'être **connecté à leboncoin.fr** dans le même profil de navigateur avant d'utiliser l'extension.

## Utilisation rapide

### Republier tes annonces

1. Onglet **↻ Republier** → **⟳ Charger** pour récupérer tes annonces.
2. **Coche** celles à bumper (rien de coché = toutes).
3. Garde **Mode test coché** au premier essai → ça simule sans rien supprimer.
4. Si OK, décoche Mode test → **↻ Republier maintenant** → confirme.
5. Ouvre **📅 Planifier** pour activer le bump auto chaque semaine.

### Surveiller les prospects

1. Onglet **🎯 Prospects** → choisis ou crée une veille (`+`).
2. Édite les mots-clés (un par ligne, `recalbox:3` pour booster).
3. Règle prix / départements / type / vendeur / livraison.
4. **🔍 Scanner maintenant** (~30 à 60 s la première fois).
5. **★ Survole** une carte pour voir le détail du score, **✗ Ignorer** pour masquer définitivement, **✉ Contacter** pour ouvrir la messagerie pré-remplie.

### Exemples de veilles

| Profil | Mots-clés type | Réglages conseillés |
|---|---|---|
| **Dev web / WordPress** | `wordpress:2 prestashop symfony php site internet` | Type: Demandes · Score min: 2 |
| **Retrogaming** | `retrogaming raspberry recalbox batocera retrobat` | Type: Les deux · Âge: 60 j · Score min: 1 |
| **Dépannage local** | `dépannage informatique aide pc ordinateur` | Départements: ton dép. · Vendeur: Particuliers |
| **Achat tech** | `macbook iphone serveur` | Type: Offres · Tri: prix croissant |

## Comment ça marche

```
┌────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ chrome.alarms  │───►│  background.js   │───►│  orchestrator.js    │
│  (planning)    │    │  (service worker)│    │  scrape → delete →  │
└────────────────┘    └──────────────────┘    │  repost (vrai onglet)│
                              │                └─────────────────────┘
                              │                ┌─────────────────────┐
                              └───────────────►│  prospect.js        │
                                               │  /finder/search API │
                                               │  scoring + dédup    │
                                               └─────────────────────┘
```

- **Bumper** : pilote un vrai onglet Leboncoin via `chrome.scripting` — reproduit ce que tu cliquerais (carte → Supprimer → confirmation → wizard de dépôt). Sélecteurs reverse-engineerés du DOM live.
- **Prospects** : appelle la même API JSON que le front Leboncoin (`POST /finder/search`) à travers un onglet pour contourner DataDome. Conversations existantes récupérées via `/messaging/proxy/.../conversations` (JWT lu dans `localStorage`).

## Vie privée

- **Aucun serveur tiers.** Tout vit dans `chrome.storage.local`.
- **Aucune télémétrie, aucun tracker.** Lis le code, il fait ~2 000 lignes.
- **Aucune API key, aucun compte à créer** côté Booster.
- Permissions strictes : uniquement `*.leboncoin.fr` + `chrome.alarms` + `chrome.notifications`.

## Tests

Logique pure (scoring, dédoublonnage, filtres) couverte par le test runner Node natif — zéro dépendance.

```bash
npm test
# ou
node --test tests/
```

**189 tests, ~430 ms.** Couvre : regex de keyword (mots accentués, `C++`, `.NET`, parenthèses), scoring v2 (titre ×2 + poids `:N` + bonus demande), parsing des poids, tri d'affichage (NOUVEAU prioritaire), filtre âge / score / vendeur / livraison, classification messages (scam/lead/question/spam), backup JSON, smart-bump, sérialisation des profils, cohérence DOM IDs popup ↔ HTML.

## Limitations & avertissement

- **Les CGU de Leboncoin interdisent l'automatisation** (art. 8 — usage de robot, script…). Cette extension peut faire flagger ou suspendre ton compte. Si tu es prudent·e, teste d'abord sur un compte secondaire.
- Le bumper dépend du DOM de Leboncoin. À chaque redesign, des sélecteurs cassent → ouvre une issue ou envoie une PR.
- DataDome (anti-bot) tolère un usage modéré dans une vraie session. Ne descends pas le planning sous "chaque heure".

Projet **non affilié à Leboncoin SAS**. Fourni "tel quel" sous licence MIT — voir [LICENSE](LICENSE).

## Roadmap

### Fait
- [x] Multi-veilles isolées avec profils nommés
- [x] Scoring transparent avec poids et breakdown au survol
- [x] Filtres Leboncoin avancés (prix, dépts, vendeur, livraison)
- [x] Ignorer une annonce → ne revient plus
- [x] Contacter → ouvre la messagerie pré-remplie
- [x] Détection des conversations déjà entamées
- [x] Indicateur de connexion compact
- [x] Historique persistant des cycles de bump
- [x] Boîte de réception avec filtre anti-scam (9 patterns) et classement en 4 catégories
- [x] Smart Bump — planning au prochain créneau de pic selon la catégorie
- [x] Backup / clone d'annonces (export JSON local + restauration / duplication 1 clic)

### Suggestions à venir — selon demandes utilisateur

Tu utilises l'extension et l'une de ces features te manque ? **Ouvre une issue** sur le repo et elle remonte dans la file.

- [ ] **A/B test titre / photo / prix** — tracker vues & favoris avant/après changement, suggérer la variante gagnante
- [ ] **Détection annonce à risque** — lint pré-publication : mots interdits, liens externes, photos sans watermark, catégorie incohérente
- [ ] **Relance des intéressés sur baisse de prix** — message groupé aux contacts précédents quand tu baisses le prix d'une annonce
- [ ] **Map des prospects** — carte des leads non contactés (utile artisans / déménageurs / services locaux)
- [ ] **Suivi CA & seuils micro-BIC** — tracker CA cumulé LBC vs seuils fiscaux (auto-entrepreneurs)
- [ ] **Détection doublons / clonage** — alerter si quelqu'un copie une de tes annonces
- [ ] Statut par annonce (✓ bumpée / ⏸ skipped / ✗ failed) dans un dashboard
- [ ] Vue inline du corps d'un prospect (sans quitter le popup)
- [ ] Export CSV des prospects

## Contribuer

PRs bienvenues — voir [CONTRIBUTING.md](CONTRIBUTING.md). Les correctifs de sélecteurs après un redesign Leboncoin sont la contribution la plus précieuse.

## Crédits

Construit par [Odilon Hugonnot](https://www.web-developpeur.com) — dev full-stack/backend (PHP/Symfony/Go), Besançon.

Si l'extension te fait gagner du temps : ⭐ le repo, ça aide les autres freelances à la trouver.

---

<a id="english"></a>
## English

Chrome MV3 extension for freelancers: auto-bump your Leboncoin listings on a weekly schedule, and watch Leboncoin for tech demands (web dev, WordPress, automation…) with weighted scoring, multi-watchlists, advanced filters and one-click reply.

**Quick start:**

```bash
git clone https://github.com/ohugonnot/leboncoin-bumper.git
```

Then `chrome://extensions` → enable Developer mode → "Load unpacked" → select the cloned folder.

Full docs are in French above — codebase, identifiers and inline JSDoc are in English, contributing is language-neutral.

This project automates user actions on a third-party site (leboncoin.fr) against their Terms of Service. Use at your own risk on personal accounts. See [LICENSE](LICENSE).
