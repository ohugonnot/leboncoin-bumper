import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage, classifyConversations, SCAM_PATTERNS, QUESTION_PATTERNS } from '../messaging.js';

// ─── scam signals ─────────────────────────────────────────────────────────

test('scam: mandat-cash pattern', () => {
  const r = classifyMessage('Je peux payer par mandat cash ou Western Union');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('mandat-cash'));
});

test('scam: qr-code pattern', () => {
  const r = classifyMessage('Scannez ce QR code pour recevoir le paiement');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('qr-code'));
});

test('scam: qr-code accent variant (scanné)', () => {
  const r = classifyMessage('Vous avez scanné ce code qr ?');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('qr-code'));
});

test('scam: whatsapp off-platform', () => {
  const r = classifyMessage('Contactez-moi sur WhatsApp pour plus de détails');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('off-platform'));
});

test('scam: phone-foreign number', () => {
  const r = classifyMessage('Appelez-moi au +44 7700 123456');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('phone-foreign'));
});

test('scam: +33 is NOT flagged as foreign', () => {
  const r = classifyMessage('Voici mon numéro : +33 6 12 34 56 78');
  assert.notEqual(r.category, 'scam');
});

test('scam: external-link (bit.ly)', () => {
  const r = classifyMessage('Voir les détails ici : https://bit.ly/3xAbc');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('external-link'));
});

test('scam: leboncoin link is NOT flagged', () => {
  const r = classifyMessage('L\'annonce est sur https://www.leboncoin.fr/annonce/123');
  assert.notEqual(r.category, 'scam');
});

test('scam: prepay revolut', () => {
  const r = classifyMessage('Envoyez-moi d\'abord sur Revolut et je vous envoie l\'objet');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('prepay'));
});

test('scam: auth-code vérification (with accent)', () => {
  const r = classifyMessage('Donnez-moi le code de vérification reçu par SMS');
  assert.equal(r.category, 'scam');
  assert.ok(r.signals.includes('auth-code'));
});

test('scam: two signals → higher confidence than one', () => {
  const one = classifyMessage('Paiement par Revolut');
  const two = classifyMessage('Paiement par Revolut, contactez WhatsApp');
  assert.ok(two.confidence > one.confidence);
  assert.ok(two.signals.length > one.signals.length);
});

test('scam: confidence capped at 95 with many signals', () => {
  const r = classifyMessage(
    'Paiement Revolut, contactez WhatsApp, scannez le QR code, code de validation SMS, envoyez acompte virement'
  );
  assert.equal(r.category, 'scam');
  assert.ok(r.confidence <= 95);
});

// ─── question / spam signals ───────────────────────────────────────────────

test('question: "toujours dispo ?" (≤50 chars) → category question', () => {
  const r = classifyMessage('toujours dispo ?');
  assert.equal(r.category, 'question');
  assert.ok(r.signals.includes('dispo-only'));
});

test('question: "encore disponible ?" (≤50 chars) → category question', () => {
  const r = classifyMessage('Bonjour, encore disponible ?');
  assert.equal(r.category, 'question');
});

test('question: dispo-only but long message → NOT a question, becomes lead', () => {
  const long = 'encore dispo ? ' + 'x'.repeat(60);
  const r = classifyMessage(long);
  // Exceeds 50 chars, so dispo-only doesn't fire → lead
  assert.equal(r.category, 'lead');
});

test('spam: bare "?" → category spam', () => {
  const r = classifyMessage('?');
  assert.equal(r.category, 'spam');
  assert.ok(r.signals.includes('bare-question'));
});

test('spam: "ok" → category spam', () => {
  const r = classifyMessage('ok');
  assert.equal(r.category, 'spam');
});

// ─── lead ─────────────────────────────────────────────────────────────────

test('lead: well-formed message → category lead', () => {
  const r = classifyMessage(
    'Bonjour, je suis intéressé par votre annonce. Pourriez-vous me donner plus de détails sur la configuration et l\'état du matériel ? Merci'
  );
  assert.equal(r.category, 'lead');
  assert.equal(r.signals.length, 0);
});

test('lead: empty message → no crash, returns lead or spam', () => {
  const r = classifyMessage('');
  assert.ok(['lead', 'spam'].includes(r.category));
  assert.ok(typeof r.confidence === 'number');
});

test('lead: confidence grows with message length', () => {
  const short = classifyMessage('Bonjour votre prix est-il négociable ?');
  const long = classifyMessage('Bonjour, ' + 'votre article m\'intéresse beaucoup. '.repeat(10));
  // Both leads
  assert.equal(short.category, 'lead');
  assert.equal(long.category, 'lead');
  assert.ok(long.confidence >= short.confidence);
});

// ─── ctx ignored ──────────────────────────────────────────────────────────

test('ctx: adTitle and senderPseudo do not alter classification', () => {
  const withCtx = classifyMessage('Bonjour je suis intéressé', { adTitle: 'Scam ad', senderPseudo: 'trickster' });
  const withoutCtx = classifyMessage('Bonjour je suis intéressé');
  assert.equal(withCtx.category, withoutCtx.category);
  assert.equal(withCtx.confidence, withoutCtx.confidence);
});

// ─── classifyConversations ────────────────────────────────────────────────

test('classifyConversations: aggregates counts correctly', () => {
  const convs = [
    { conversationId: '1', lastMessagePreview: 'Paiement Western Union' },
    { conversationId: '2', lastMessagePreview: 'Bonjour, ce produit est-il encore disponible ?' },
    { conversationId: '3', lastMessagePreview: '?' },
    { conversationId: '4', lastMessagePreview: 'Je suis intéressé par votre annonce, pouvez-vous me donner plus de détails?' },
    { conversationId: '5', lastMessagePreview: 'Contactez-moi sur WhatsApp pour finaliser' },
  ];
  const { all, counts } = classifyConversations(convs);
  assert.equal(all.length, 5);
  assert.equal(counts.scam, 2);
  assert.equal(counts.question, 1);
  assert.equal(counts.spam, 1);
  assert.equal(counts.lead, 1);
  // Each enriched conv has _classification
  for (const c of all) {
    assert.ok(c._classification);
    assert.ok(['scam','lead','question','spam'].includes(c._classification.category));
  }
});

test('classifyConversations: empty input → zero counts', () => {
  const { all, counts } = classifyConversations([]);
  assert.equal(all.length, 0);
  assert.equal(counts.scam, 0);
  assert.equal(counts.lead, 0);
});

test('classifyConversations: null input → no crash', () => {
  const { all, counts } = classifyConversations(null);
  assert.equal(all.length, 0);
});

test('classifyConversations: falls back to last_message.body if no preview', () => {
  const convs = [{ conversationId: 'x', last_message: { body: 'Revolut payment' } }];
  const { all } = classifyConversations(convs);
  assert.equal(all[0]._classification.category, 'scam');
});
