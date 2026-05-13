// Inbox classification — pure functions, zero Chrome dependencies.
// Classifies incoming leboncoin messages into 4 categories to help surface
// scams and low-value messages before reading them.

/**
 * Scam signal patterns.
 * Each entry: [signalName, regex].
 * All regexes are case-insensitive; accent-tolerance is handled by the
 * patterns themselves (alternation or character classes).
 */
export const SCAM_PATTERNS = [
  ['mandat-cash',     /\b(mandat[- ]cash|western\s+union|moneygram|pcs\s+mastercard|pcs\b)\b/i],
  ['qr-code',         /scann?[ée]?(er|ez|é)?\s*(ce\s*)?(code\s*)?qr|qr\s*code/i],
  ['transporteur-fake', /transporteur.{0,30}(agent|priv[ée]|à mes frais|mon livreur)/i],
  ['off-platform',    /whatsapp|telegram|signal\s|demande.*(?:email|mail|t[ée]l[ée]phone|num[ée]ro)|(?:email|mail|t[ée]l[ée]phone|num[ée]ro).*hors\s+plateforme/i],
  ['phone-foreign',   /\+(?!33)\d/],
  ['external-link',   /https?:\/\/(?!(www\.)?leboncoin\.)[^\s]+/i],
  ['prepay',          /paypal\s+friends?|payer\s+[àa]\s+l['']avance|acompte\s+virement|revolut\b|code\s+de\s+retrait/i],
  ['urgency-scam',    /urgent.{0,60}(whatsapp|telegram|vacances|[àa]\s+l['']?[ée]tranger|mission)|(?:vacances|[àa]\s+l['']?[ée]tranger|mission).{0,60}urgent/i],
  ['auth-code',       /code\s+(sms|de\s+validation|de\s+v[ée]rification)/i],
];

/**
 * Low-value / question-type signal patterns.
 * Each entry: [signalName, testFn(text)].
 */
export const QUESTION_PATTERNS = [
  // Short message asking only if the item is still available
  ['dispo-only', (text) => text.length <= 50 && /toujours\s+dispo|encore\s+dispo|encore\s+disponible|encore\s+l[àa]|encore\s+en\s+vente|int[ée]ress/i.test(text)],
  // Near-empty message
  ['bare-question', (text) => text.trim().length <= 10],
];

/**
 * Classify a single message text.
 *
 * @param {string} text  Raw message body.
 * @param {object} [ctx] Optional context — {adTitle, senderPseudo}.
 *                       Reserved for future use; currently unused.
 * @returns {{ category: 'scam'|'spam'|'question'|'lead', signals: string[], confidence: number }}
 */
export function classifyMessage(text, ctx = {}) {
  const t = String(text || '');
  const signals = [];

  for (const [name, re] of SCAM_PATTERNS) {
    if (re.test(t)) signals.push(name);
  }

  if (signals.length > 0) {
    const confidence = Math.min(95, 60 + signals.length * 10);
    return { category: 'scam', signals, confidence };
  }

  for (const [name, testFn] of QUESTION_PATTERNS) {
    if (testFn(t)) {
      if (name === 'bare-question') {
        return { category: 'spam', signals: [name], confidence: 80 };
      }
      if (name === 'dispo-only') {
        return { category: 'question', signals: [name], confidence: 70 };
      }
    }
  }

  // Lead: confidence grows with message length, capped at 90
  const confidence = Math.min(90, 30 + t.length / 5);
  return { category: 'lead', signals: [], confidence };
}

/**
 * Classify a list of raw conversation objects from the leboncoin inbox API.
 *
 * Expected shape per conversation (real API fields):
 *   conversationId, itemId, subject, partnerName,
 *   lastMessagePreview, lastMessageDate, lastMessageSentAt, unseenCounter
 *
 * @param {object[]} conversations  Raw conversation objects.
 * @returns {{ all: object[], counts: {scam: number, lead: number, question: number, spam: number} }}
 */
export function classifyConversations(conversations) {
  const counts = { scam: 0, lead: 0, question: 0, spam: 0 };
  const all = (conversations || []).map(conv => {
    const text = conv.lastMessagePreview || conv.last_message?.body || '';
    const classification = classifyMessage(text);
    counts[classification.category]++;
    return { ...conv, _classification: classification };
  });
  return { all, counts };
}
