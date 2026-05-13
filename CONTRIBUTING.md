# Contribuer

Merci d'envisager une contribution.

## Ce qui a le plus de valeur

1. **Correctifs de sélecteurs** — quand leboncoin redesigne une page, le bumper casse. Les PRs qui mettent à jour les sélecteurs DOM dans `orchestrator.js` sont mergées rapidement.
2. **Nouveaux mots-clés ou ajustements de regex** — ouvre une PR avec un test dans `tests/prospect.test.js` prouvant que le changement fait ce qu'il prétend.
3. **Polish de l'UX du popup** — accessibilité, mode sombre, layout responsive.
4. **Rapports de bugs** avec une repro (version Chrome, page leboncoin concernée, logs console).

## Setup

```bash
git clone https://github.com/ohugonnot/leboncoin-bumper.git
cd leboncoin-bumper
npm test     # 189 tests, 0 dépendance
```

Charge l'extension non empaquetée depuis `chrome://extensions` (Mode développeur → Charger l'extension non empaquetée).

## Style de code

- ES modules modernes partout (`import` / `export`).
- Pas de build step ; les fichiers sont chargés tels quels par Chrome.
- **Aucune dépendance runtime.** Les tests utilisent le `node:test` built-in.
- Documente les fonctions publiques avec JSDoc. La logique pure doit être testable depuis Node — garde les appels `chrome.*` hors des helpers.
- Identifiants, JSDoc et noms de fonctions en anglais (le code = langage international). Commentaires métiers / docs utilisateur en français.

## Tester tes changements manuellement

1. Après une édition, recharge l'extension dans `chrome://extensions`.
2. **Si tu touches `manifest.json` (en particulier `host_permissions`)**, un soft reload ne re-grante pas les nouvelles permissions. Clique **Supprimer** puis **Charger l'extension non empaquetée** à nouveau — ou utilise `chrome.runtime.reload()` depuis la DevTools du service worker.
3. Teste d'abord le bumper en mode **Dry-run** avec un seul ID d'annonce.

## Pull Requests

- Branche à partir de `main`.
- Une feature ou un fix par PR.
- Ajoute ou mets à jour les tests quand tu modifies la logique de scoring, le dédoublonnage, ou les regex.
- Mets à jour le `README.md` si tu changes le comportement visible côté utilisateur.

## Signaler une casse leboncoin

Dans l'issue, donne :

1. L'action qui a échoué (sur quel bouton tu as cliqué).
2. Le message d'erreur depuis la DevTools du service worker (`chrome://extensions` → lien "service worker" sur la carte de l'extension).
3. L'URL courante de l'onglet piloté.
4. Un extrait du DOM autour du sélecteur cassé (clic-droit → Inspecter sur l'élément fautif, colle l'outer HTML).

## Sécurité & CGU

Cette extension automatise un site tiers. Soyons clairs :

- Ne propose pas de features qui augmentent le risque de détection (boucles multi-comptes, busting de rate-limit).
- Pas de télémétrie, pas de scripts tiers.
- **Ne commit jamais de données personnelles** (`backups/` est `.gitignore`d pour une raison).
