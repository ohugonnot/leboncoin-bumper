# Rubrique de scoring — leboncoin-bumper

7 axes, score 0-100 chacun. Score global = moyenne pondérée.
**Critère d'arrêt de la boucle** : score global ≥ 95 ET aucun axe < 85 ET 0 warning bloquant.

## A. Couverture endpoints API (poids 20)

Inspiré de la lib `etienne-hd/lbc`. Bonus pour chaque endpoint adopté correctement.

- [0/20] `POST /finder/search` utilisé avec payload complet (`listing_source`, `extend`, `disable_total`, `limit_alu`)
- [0/20] `owner_type` poussé côté serveur (au lieu de filtre client)
- [0/20] `filters.location.shippable` poussé côté serveur
- [0/20] `GET /api/adfinder/v1/classified/{id}` pour fetch annonce détaillée (remplace `scrapeEditPage`)
- [0/20] `GET /api/user-card/v2/{userId}/infos` pour enrichir prospects (reply rate, presence, feedback)

## B. Robustesse réseau (poids 15)

- [0/25] Gestion explicite 403 DataDome (log + notif user, pas silence)
- [0/25] Gestion 404/410 comme "annonce supprimée"
- [0/25] Retry exponentiel sur 5xx / timeout
- [0/25] Timeout explicite sur chaque fetch

## C. Mimétisme navigateur (poids 10)

- [0/50] Champs payload exacts vs site officiel (`listing_source: 'direct-search'|'pagination'`, `extend`, `disable_total`, `limit_alu`)
- [0/50] Drift-detection test : le payload inline (`orchestrator.fetchAdsViaTab`) garde les mêmes clés que `prospect.buildSearchPayload` exporté (test automatisé sur le source)

> Le critère original « tester sans `api_key` » a été remplacé : non vérifiable hors tab LBC live, donc inadapté à un loop autonome.

## D. Tests (poids 20)

- [0/40] 100% unit tests passent
- [0/30] Tests unitaires pour chaque nouvelle fonction ajoutée
- [0/30] 100% e2e Playwright passent

## E. Qualité code (poids 15)

- [0/30] Pas de duplication payload builder (factorisation prospect.js / orchestrator.js inline)
- [0/30] Commentaires : conformes à CLAUDE.md (audience dev senior, signal pur)
- [0/20] Pas de dead code
- [0/20] Pas de dépendance circulaire / imports inutiles

## F. Performance (poids 10)

- [0/40] Backup/duplicate n'ouvre plus de tab pour scrape DOM (utilise `/classified/{id}`)
- [0/30] Dedup user-card par owner_id (1 fetch par seller, pas par annonce)
- [0/30] Cache enrichissement user-card (TTL 24h) persisté entre sessions

> Le critère "parallélisation inbox + dashboard + search" a été retiré : ces flux sont user-triggered et jamais simultanés ; la parallélisation intra-flow déclencherait DataDome (rate limit). La dedup user-card remplace ce critère.

## G. Documentation projet (poids 10)

- [0/50] CLAUDE.md à jour (nouveaux endpoints documentés si gotcha)
- [0/50] CHANGELOG.md mis à jour à chaque itération

## Pondération

```
global = 0.20*A + 0.15*B + 0.10*C + 0.20*D + 0.15*E + 0.10*F + 0.10*G
```

## Warnings bloquants (rouges)

Un seul warning rouge actif → ne pas arrêter la boucle, même si score > 95.

- W1 : un test cassé (unit ou e2e)
- W2 : une régression DOM-visible (fonctionnalité utilisateur cassée)
- W3 : un secret/JWT/api_key loggué en clair dans la console
- W4 : un endpoint privé sans gestion 403
- W5 : payload qui diffère du site officiel sur un champ obligatoire
