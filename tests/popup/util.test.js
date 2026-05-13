import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeAttr, timeAgo } from '../../popup/util.js';

describe('escapeHtml', () => {
  test('échappe les 5 caractères dangereux HTML', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('échappe &', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  test('échappe les apostrophes', () => {
    assert.equal(escapeHtml("it's"), 'it&#39;s');
  });

  test('null/undefined → chaîne vide', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  test('string sans caractères dangereux → inchangée', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });
});

describe('escapeAttr', () => {
  test('payload XSS attribut : guillemets et chevrons échappés', () => {
    const payload = '" onmouseover="alert(1)';
    const out = escapeAttr(payload);
    assert.ok(!out.includes('"'), 'should not contain raw "');
    assert.ok(out.includes('&quot;'), 'should contain &quot;');
  });
});

describe('timeAgo', () => {
  test('moins d\'une minute → "à l\'instant"', () => {
    const d = new Date(Date.now() - 30_000);
    assert.equal(timeAgo(d), 'à l\'instant');
  });

  test('5 minutes → "il y a 5 min"', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    assert.equal(timeAgo(d), 'il y a 5 min');
  });

  test('2 heures → "il y a 2 h"', () => {
    const d = new Date(Date.now() - 2 * 3600 * 1000);
    assert.equal(timeAgo(d), 'il y a 2 h');
  });

  test('3 jours → "il y a 3 j"', () => {
    const d = new Date(Date.now() - 3 * 86400 * 1000);
    assert.equal(timeAgo(d), 'il y a 3 j');
  });
});
