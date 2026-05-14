# Prompt d'itération auto-injecté

Tu travailles en boucle sur le projet **leboncoin-bumper** pour amener tous les axes de la rubrique `audit/RUBRIC.md` à ≥ 85 et le score global à ≥ 95, sans warning rouge actif.

## Procédure exacte de chaque itération

1. **Lire l'état** : `Read audit/STATE.json` → identifier `nextPriority` et premier item non fait dans `todo` (pas dans `doneIds`).

2. **Implémenter UNE seule amélioration** (la première restante du `todo`).
   - Code minimal, conforme aux principes CLAUDE.md (YAGNI, pas de sur-ingénierie, commentaires signal pur).
   - Si l'amélioration touche un endpoint privé : ajouter gestion 403/404 dans la même passe.

3. **Tester** :
   - `npm test` — doit rester 100% pass
   - `npx playwright test --config tests/e2e/playwright.config.js` — doit rester 100% pass
   - Si un test casse : corriger AVANT de scorer.

4. **Re-scorer** : recalculer A-G selon `RUBRIC.md`. Mettre à jour `STATE.json` :
   - `iteration++`
   - `lastIterationAt = today`
   - `scores.*` mis à jour
   - `global` recalculé
   - `doneIds` += [id implémenté]
   - `nextPriority` = axe le plus bas restant
   - `warnings` = liste à jour

5. **Logger** : appendre une entrée dans `audit/LOG.md` avec format :
   ```
   ## Itération N — YYYY-MM-DD
   - **Fait** : <id + description>
   - **Tests** : unit X/X, e2e Y/Y
   - **Scores** : A=.. B=.. C=.. D=.. E=.. F=.. G=.. → global=..
   - **Warnings** : <liste ou "aucun">
   - **Next** : <id suivant>
   ```

6. **Auto-évaluation critique** : lister explicitement dans le LOG ce qu'un reviewer senior pourrait critiquer dans ton implémentation actuelle. Si > 0 critique, créer un nouvel item dans `todo` pour la prochaine itération.

7. **Décider** :
   - Si `global ≥ 95 && tous axes ≥ 85 && warnings vide && critiques vide` → écrire "FINI" dans LOG et arrêter la boucle (ne pas re-scheduler).
   - Sinon → re-scheduler la boucle (un autre tour).

## Contraintes absolues

- **JAMAIS `git add` / `git commit` / `git push`** (CLAUDE.md utilisateur)
- **JAMAIS mentionner Claude / AI** dans le code, commentaires, ou logs
- **JAMAIS lire `.env*`** (sauf `.example`)
- **Toujours** valider chaque modif par les deux suites de tests avant de scorer
- **Toujours** rester sur la branche courante (pas de branche nouvelle)

## Mode reviewer

Après chaque implémentation, relire son propre diff comme si on était un reviewer hostile :
- Code mort ? Abstraction prématurée ? Comment qui paraphrase ? → corriger immédiatement, ne pas attendre l'itération suivante.

## Auto-pacing

Chaque itération doit être complète (implé + tests + score + log) avant de scheduler la suivante. Si bloqué sur une difficulté technique (DataDome, mock impossible, dep manquante) : logger le blocage et passer au todo suivant.
