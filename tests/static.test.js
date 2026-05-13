/**
 * Vérifications statiques du projet :
 * 1. manifest.json — champs requis, permissions, host_permissions
 * 2. Cohérence DOM IDs : chaque ID utilisé dans popup/*.js existe dans popup.html
 * 3. Imports résolus : chaque fichier importé existe sur le disque
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

// ── 1. manifest.json ─────────────────────────────────────────────────────────

describe('manifest.json', () => {
  const manifest = JSON.parse(read('manifest.json'));

  test('manifest_version est 3', () => {
    assert.equal(manifest.manifest_version, 3);
  });

  test('champs name, version, description présents et non vides', () => {
    assert.ok(manifest.name?.length > 0, 'name missing');
    assert.ok(manifest.version?.length > 0, 'version missing');
    assert.ok(manifest.description?.length > 0, 'description missing');
  });

  test('section background avec service_worker et type module', () => {
    assert.ok(manifest.background?.service_worker, 'background.service_worker missing');
    assert.equal(manifest.background?.type, 'module');
    assert.ok(existsSync(join(ROOT, manifest.background.service_worker)),
      `service_worker file not found: ${manifest.background.service_worker}`);
  });

  test('section action avec default_popup', () => {
    assert.ok(manifest.action?.default_popup, 'action.default_popup missing');
    assert.ok(existsSync(join(ROOT, manifest.action.default_popup)),
      `popup file not found: ${manifest.action.default_popup}`);
  });

  test('permissions contiennent storage, alarms, scripting, tabs, notifications', () => {
    const required = ['storage', 'alarms', 'scripting', 'tabs', 'notifications'];
    for (const perm of required) {
      assert.ok(manifest.permissions?.includes(perm), `permission "${perm}" missing`);
    }
  });

  test('host_permissions couvrent api.leboncoin.fr et img.leboncoin.fr', () => {
    const hosts = manifest.host_permissions || [];
    const joined = hosts.join('\n');
    assert.ok(joined.includes('api.leboncoin.fr'), 'api.leboncoin.fr missing from host_permissions');
    assert.ok(joined.includes('img.leboncoin.fr'), 'img.leboncoin.fr missing from host_permissions');
  });

  test('icons déclarent les 3 tailles (16, 48, 128) et les fichiers existent', () => {
    const sizes = ['16', '48', '128'];
    for (const size of sizes) {
      const path = manifest.icons?.[size];
      assert.ok(path, `icon ${size} missing`);
      assert.ok(existsSync(join(ROOT, path)), `icon file not found: ${path}`);
    }
  });
});

// ── 2. Cohérence DOM IDs ─────────────────────────────────────────────────────

describe('DOM IDs — cohérence HTML ↔ JS', () => {
  // IDs déclarés dans popup.html
  const htmlContent = read('popup/popup.html');
  const htmlIds = new Set([...htmlContent.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

  // IDs utilisés via getElementById dans les fichiers popup/*.js
  const popupFiles = ['popup/bumper.js', 'popup/inbox.js', 'popup/prospect-ui.js', 'popup/popup.js', 'popup/util.js'];
  const jsIds = new Map(); // id → fichier source (pour le message d'erreur)
  for (const file of popupFiles) {
    const src = read(file);
    for (const m of src.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
      if (!jsIds.has(m[1])) jsIds.set(m[1], file);
    }
  }

  test('tous les IDs utilisés dans popup/*.js existent dans popup.html (ou sont créés dynamiquement)', () => {
    // 'toast' est créé dynamiquement via document.createElement — pas dans le HTML, c'est attendu
    const dynamicIds = new Set(['toast']);
    const missing = [];
    for (const [id, file] of jsIds) {
      if (!htmlIds.has(id) && !dynamicIds.has(id)) {
        missing.push(`${id} (${file})`);
      }
    }
    assert.deepEqual(missing, [], `IDs utilisés en JS mais absents du HTML : ${missing.join(', ')}`);
  });

  test('signale les IDs HTML jamais référencés dans le JS (nettoyage possible)', () => {
    const unused = [...htmlIds].filter(id => !jsIds.has(id));
    // On ne fail pas — c'est informatif. Mais on le vérifie pour avoir une baseline.
    // Si un ID est ajouté au HTML sans usage JS, ce test le documente.
    const knownUnused = [
      // IDs qui sont utilisés via CSS / aria / data-panel mais pas via getElementById
      'b-help', 'b-selection-bar', 'b-history-section', 'b-planning-section', 'b-log-section',
      'b-bump-meta', 'm-help', 'panel-bumper', 'panel-messages', 'panel-prospect',
      'p-scan-limits-hint',
      // Tab buttons — referenced via aria-labelledby on tabpanel sections, not getElementById
      'tab-bumper', 'tab-messages', 'tab-prospect',
    ];
    const unexpected = unused.filter(id => !knownUnused.includes(id));
    // Fail si de nouveaux orphelins apparaissent (régression HTML)
    assert.deepEqual(
      unexpected, [],
      `Nouveaux IDs HTML sans usage JS (supprimer ou ajouter à knownUnused) : ${unexpected.join(', ')}`
    );
  });
});

// ── 3. Imports résolus ───────────────────────────────────────────────────────

describe('Imports ES modules — fichiers cibles existants', () => {
  // Fichiers à inspecter
  const filesToCheck = [
    'popup/bumper.js',
    'popup/inbox.js',
    'popup/prospect-ui.js',
    'popup/popup.js',
    'background.js',
    'orchestrator.js',
  ];

  test('tous les imports from "./..." ou "../..." pointent vers un fichier existant', () => {
    const broken = [];
    for (const file of filesToCheck) {
      const src = read(file);
      const fileDir = join(ROOT, dirname(file));
      for (const m of src.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
        const importPath = m[1];
        // Resolve relative to the importing file
        const abs = resolve(fileDir, importPath);
        // Add .js if no extension
        const candidates = [abs, abs + '.js'];
        const found = candidates.some(p => existsSync(p));
        if (!found) {
          broken.push(`${file} → ${importPath}`);
        }
      }
    }
    assert.deepEqual(broken, [], `Imports non résolus : ${broken.join(', ')}`);
  });

  test('les noms importés existent dans les fichiers sources (vérification par export keyword)', () => {
    // Vérifie que chaque `import { foo } from './bar.js'` a bien un `export ... foo` dans bar.js
    // Approche regex — pas d'AST, conservatrice : si `export` + nom présent → OK.
    const broken = [];
    for (const file of filesToCheck) {
      const src = read(file);
      const fileDir = join(ROOT, dirname(file));
      for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
        const names = m[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, '').trim()).filter(Boolean);
        const importPath = m[2];
        const abs = resolve(fileDir, importPath.endsWith('.js') ? importPath : importPath + '.js');
        if (!existsSync(abs)) continue; // déjà reporté ci-dessus
        const targetSrc = readFileSync(abs, 'utf-8');
        for (const name of names) {
          // export function foo | export const foo | export { foo } | export { ..., foo, ... }
          const exported = new RegExp(`export[\\s\\S]*?\\b${name}\\b`).test(targetSrc);
          if (!exported) broken.push(`${file}: "${name}" absent de ${importPath}`);
        }
      }
    }
    assert.deepEqual(broken, [], `Noms importés absents des sources : ${broken.join(', ')}`);
  });
});
