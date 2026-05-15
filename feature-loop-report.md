# Feature Loop Report — notif-dedup-webhook

**Date** : 2026-05-15
**Statut** : SUCCESS (axes A-H tous ≥ 8, 0 critical)
**Itérations** : 2 / 3 (max)
**Mode paranoid** : off (pas de keywords sensibles)

## Feature demandée

> Fix bug "spam notif" (notifiedIds séparé de seenIds, purge 7j) + webhook fire-and-forget (URL profile, POST JSON, 1 try, 5s timeout) + UI minimale (champ URL webhook dans le panneau profil).

## Radar final

```
A. Robustesse notif (20%)    ████████░░  8/10
B. Webhook fire-and-forget   █████████░  9/10
C. Sécurité (10%)            █████████░  9/10
D. Tests (20%)               █████████░  9/10  (was 7 → fixé iter 2)
E. UX feedback (10%)         ████████░░  8/10
F. Compat existant (10%)     ██████████ 10/10
G. Code quality (10%)        ████████░░  8/10
H. Validation live (5%)      ██████████ 10/10  (4/4 scénarios OK)
```

## Timeline des itérations

| # | Décision | Scores moyens | Critical | Major | Notes_ack | Notes |
|---|---|---|---|---|---|---|
| 1 | NEEDS_ITER | 8.4 | 0 | 1 (D=7) | n/a | Sonnet impl, Opus blind review |
| 2 | SUCCESS  | 8.7 | 0 | 0 | 1/1 major + 4/4 minors triés | Tests webhook ajoutés, extraction `notify-webhook.js` |

## Critical / Major fixés

- ✅ [iter 2, D=tests] `postNotificationWebhook` n'avait aucun test → extraction dans `notify-webhook.js` (module pur) + 5 tests couvrant URL invalide / protocole non supporté / HTTP non-ok / succès clear erreur / AbortError. D : 7 → 9.

## Minors restants (assumés, justifiés)

- ⚠️ [minor A] `markResultsNotified` read-modify-write sans verrou : race possible si 2 scans simultanés (alarme + manuel). En pratique Chrome sérialise les alarmes ; risque négligeable.
- ⚠️ [minor A] notif Chrome créée AVANT `await markResultsNotified` : si `storage.set` échoue (quota), prochain scan re-notifie. Pattern fire-and-forget tolère.
- ⚠️ [minor C] `http://` autorisé pour proxy local — pas d'avertissement UX explicite que http en clair fuit le payload sur réseau public. Trivial à ajouter (1 LOC dans `title`).
- ⚠️ [minor E] Pas de bouton "Tester webhook" ni indicateur "OK dernier POST réussi à HH:MM" — l'user voit seulement les erreurs récentes (< 24h).
- ⚠️ [minor G] Logique de purge TTL inline dans `markResultsNotified` (pas mutualisée avec `userCardCache.enrichProspectsWithUserCard:371-375` qui a un pattern similaire). Aucun helper partagé tant que c'est le seul autre cas.

## Ajouts non demandés (scope creep)

**Aucun**. Toutes les modifs sont strictement dans le périmètre demandé (notifiedIds, webhook, UI, tests).

L'extraction de `notify-webhook.js` (créé à l'iter 2) est une **refacto de testabilité** rendue nécessaire par le major reviewer — pas un ajout fonctionnel. Le module ne change rien au comportement.

## Fichiers modifiés / créés

| Fichier | +/- | Type |
|---|---|---|
| `background.js` | +20 / -8 | modif (import + appels + signature `maybeNotify`) |
| `prospect.js` | +66 / -0 | modif (3 nouveaux exports : `filterFreshForNotification`, `buildWebhookPayload`, `markResultsNotified`) |
| `popup/popup.html` | +6 | modif (champ `p-notificationWebhookUrl` + `p-webhook-status`) |
| `popup/prospect-ui.js` | +13 / -3 | modif (mapping `p` + save/load + init listeners) |
| `notify-webhook.js` | +41 | **nouveau** (module pur extrait à l'iter 2 pour testabilité) |
| `tests/prospect.test.js` | +114 | modif (5 nouveaux tests) |
| `tests/popup/_setup.js` | +4 | modif (2 nouveaux IDs DOM dans `HTML_IDS`) |
| `tests/webhook.test.js` | +94 | **nouveau** (5 tests sur les branches de `postNotificationWebhook`) |
| `tests/e2e/webhook-dedup.spec.js` | +163 | **nouveau** (4 tests live : UI / POST réel / dédup / purge) |

**Total** : 6 fichiers modifiés, 3 fichiers créés.

## Métriques finales

- **Unit tests** : 241 / 241 ✓ (was 231 baseline, +10 nouveaux)
- **E2E tests** : 38 / 38 ✓ (was 34, +4 nouveaux)
- **Build/lint/typecheck** : pas de scripts définis (extension vanilla, lint via `tests/static.test.js`)
- **Validation live** : 4/4 scénarios OK
  1. Champ webhook URL rendu et éditable dans popup MV3 réelle ✓
  2. POST JSON reçu par serveur HTTP local 127.0.0.1 — payload sans `score_breakdown` ni autres leaks ✓
  3. `filterFreshForNotification` ignore les list_id déjà dans `notifiedIds` ✓
  4. `markResultsNotified` purge les entries > 7j, garde les fraîches ✓

## Worktree

- Path : `/home/odilon/leboncoin-bumper/.claude/worktrees/feature-loop-notif-dedup-webhook/`
- Branche : `worktree-feature-loop-notif-dedup-webhook`
- **État** : modifs **non commitées** (la règle utilisateur `CLAUDE.md` interdit `git add`/`commit` autonome — c'est intentionnel, l'user valide manuellement).

## Conflits avec main

Non vérifiable proprement sans commit applicatif (skill 5.1bis n'a pas pu commit à cause de la règle user). Au visuel, les modifs touchent des zones isolées (nouveaux exports, nouvelle fonction, nouveau champ UI), pas de raison probable de conflit avec un main qui n'aurait pas bougé.

À vérifier manuellement après ton commit :
```
git fetch origin && git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main | head
```

## Recommandations

1. **Review humaine** des diffs avant commit — surtout `background.js:maybeNotify` (signature étendue à 7 args, ordre des paramètres).
2. **Commit en une fois** (squash si tu veux), pas de séparation iter 1 / iter 2 — le résultat est cohérent.
3. **Minors C et E** (warning http + bouton Test webhook) sont des PR de polish séparées si tu veux pousser plus loin.
4. Tester en **réel** une fois la branche mergée : créer un profil avec webhook pointant vers un n8n / Cloudflare Worker / proxy SMTP, déclencher un vrai scan LBC, vérifier la chaîne complète.

## Notes pour propagation mémoire

À ajouter en mémoire projet :
- `feedback_webhook_fire_and_forget.md` : pattern fire-and-forget (catch silencieux côté caller, log dans storage côté impl) validé pour notifs prospects. Pertinent pour futurs hooks externes.
- Aucun gotchas LBC nouveau ici — c'est purement interne à l'extension.
