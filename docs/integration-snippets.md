# Snippets prêts à intégrer dans ton CV + web-developpeur.com

Le repo public est ici : **https://github.com/ohugonnot/leboncoin-bumper**
La meilleure capture d'écran pour le hero : `docs/screenshots/prospect-hero.png`

---

## 1) CV — bullet point court

À insérer dans la rubrique "Projets" ou "Side-projects" :

> **Leboncoin Bumper** — Extension Chrome MV3 (JS/CSS) — *2026*
> Automatise la republication hebdomadaire d'annonces leboncoin (scrape DOM, suppression, redépôt via wizard) et scrute l'API `/finder/search` pour remonter les demandes tech pertinentes (scoring par regex, dédoublonnage). Service worker MV3, `chrome.alarms`, tests Node (18, 0 dep). **Open source — github.com/ohugonnot/leboncoin-bumper**

### Version plus longue (paragraphe)

> Conception et réalisation d'une extension Chrome (Manifest V3) en JavaScript moderne pour automatiser la maintenance d'annonces sur leboncoin.fr. Pilote un onglet en arrière-plan pour exécuter le cycle scrape→delete→repost, et appelle directement l'API privée `/finder/search` pour faire de la veille hebdomadaire sur 62 mots-clés tech. Suite de tests Node sans dépendance, code documenté, MIT, publié sur GitHub.

### Stack à mentionner
`JavaScript ES2022` · `Chrome MV3` · `Service Workers` · `chrome.alarms / chrome.scripting / chrome.storage` · `Playwright (dev)` · `Node Test Runner`

---

## 2) Site web-developpeur.com — bloc HTML

Selon comment tu structures la section "Projets / Realisations" de ton site, voici 3 variantes.

### Variante A — Carte projet compacte (Bootstrap/Tailwind agnostic)

```html
<article class="project-card">
  <img src="https://raw.githubusercontent.com/ohugonnot/leboncoin-bumper/main/docs/screenshots/prospect-hero.png"
       alt="Leboncoin Bumper — capture d'écran de l'onglet Prospect Watch"
       loading="lazy" />
  <div class="content">
    <h3>Leboncoin Bumper</h3>
    <p class="tag-row">
      <span class="tag">Chrome MV3</span>
      <span class="tag">JavaScript</span>
      <span class="tag">Service Worker</span>
      <span class="tag">Open Source</span>
    </p>
    <p>
      Extension Chrome qui automatise la republication hebdomadaire d'annonces
      leboncoin et scrute l'API officielle pour repérer les demandes de missions
      tech (PHP, WordPress, Symfony, IA, automatisation, retrogaming…).
    </p>
    <p class="links">
      <a href="https://github.com/ohugonnot/leboncoin-bumper" target="_blank" rel="noopener">
        Code source GitHub →
      </a>
    </p>
  </div>
</article>
```

### Variante B — Détaillée avec features list

```html
<section id="project-leboncoin-bumper" class="project">
  <header>
    <h2>Leboncoin Bumper</h2>
    <p class="subtitle">Extension Chrome (Manifest V3) — auto-bump &amp; veille tech</p>
  </header>

  <figure>
    <img src="https://raw.githubusercontent.com/ohugonnot/leboncoin-bumper/main/docs/screenshots/prospect-hero.png"
         alt="Aperçu de l'onglet Prospect Watch listant les demandes tech récentes." />
  </figure>

  <p>
    Outil open-source que j'ai conçu pour résoudre un irritant personnel :
    remettre en avant mes annonces leboncoin chaque semaine sans intervention
    manuelle, et trouver automatiquement les particuliers cherchant un dev
    pour un projet ponctuel.
  </p>

  <ul class="features">
    <li><strong>Bumper</strong> : pilote un onglet Chrome en arrière-plan
        pour réaliser le cycle <em>scrape&nbsp;→&nbsp;delete&nbsp;→&nbsp;repost</em>
        sur chaque annonce.</li>
    <li><strong>Prospect Watch</strong> : appelle l'API <code>/finder/search</code>
        de leboncoin pour 62 mots-clés tech, score par regex, dédoublonne contre
        les annonces déjà vues.</li>
    <li><strong>Planification</strong> via <code>chrome.alarms</code>,
        persistance dans <code>chrome.storage.local</code>, popup en double
        onglet (Bumper / Prospects).</li>
    <li><strong>Suite de tests Node</strong> (18 tests, 0 dépendance) sur la
        logique de scoring + dédoublonnage.</li>
  </ul>

  <p class="stack">
    Stack&nbsp;:
    <span class="tag">JavaScript&nbsp;ES2022</span>
    <span class="tag">Chrome&nbsp;MV3</span>
    <span class="tag">Service&nbsp;Worker</span>
    <span class="tag">Playwright</span>
    <span class="tag">Node&nbsp;Test&nbsp;Runner</span>
  </p>

  <p class="cta">
    <a class="button" href="https://github.com/ohugonnot/leboncoin-bumper"
       target="_blank" rel="noopener">
      Voir sur GitHub
    </a>
  </p>
</section>
```

### Variante C — Carte minimale type "portfolio grid"

```html
<a href="https://github.com/ohugonnot/leboncoin-bumper"
   target="_blank" rel="noopener"
   class="project-tile">
  <img src="https://raw.githubusercontent.com/ohugonnot/leboncoin-bumper/main/docs/screenshots/prospect-hero.png"
       alt="" />
  <h4>Leboncoin Bumper</h4>
  <p>Extension Chrome MV3 — auto-bump &amp; veille tech sur leboncoin</p>
</a>
```

---

## 3) Tweet / post LinkedIn (si tu veux push)

```
Petit week-end project devenu utilisable au quotidien :

🧩 Leboncoin Bumper, une extension Chrome (MV3) qui :
↻ republie automatiquement mes annonces leboncoin chaque semaine
🎯 scrute l'API officielle pour repérer les demandes de missions tech
   (PHP, WordPress, Symfony, IA, automatisation…)

Open source, MIT, 0 dépendance runtime, 18 tests Node :
https://github.com/ohugonnot/leboncoin-bumper

PRs bienvenues (notamment quand leboncoin change ses sélecteurs 😅)
```
