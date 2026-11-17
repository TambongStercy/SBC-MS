/**
 * Server-side anonymisation of a member's question before anything leaves
 * for DeepSeek (an external processor outside Benin, APDP). We remove what
 * identifies a person or a transaction: emails, phone numbers, amounts,
 * references and ids, links, and any remaining long number.
 *
 * Names cannot be removed reliably; the assistant never needs them and the
 * member is told not to type personal details.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
// Amount with a currency, before or after the number: "5 000 F", "5000FCFA", "$12.5", "12 USD", "3.000 francs".
const AMOUNT_AFTER = /(?:\d[\d\s.,']*\d|\d)\s*(?:f\s?cfa|fcfa|xaf|xof|cfa|francs?|frs?|f|usd|eur|euros?|€|\$|dollars?|usdt)(?![a-z])/gi;
const AMOUNT_BEFORE = /(?:\$|€|usd|xaf|xof|fcfa)\s*\d[\d\s.,']*/gi;
// Phone numbers: optional +, 8+ digits possibly split by spaces, dots or dashes.
const PHONE = /(?:\+|00)?\d(?:[\s.\-()]*\d){7,}/g;
// References: Mongo ids, uuids, SUP-000123, SBX-..., tokens mixing letters and digits.
const OBJECT_ID = /\b[a-f0-9]{24}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PREFIXED_REF = /\b[A-Z]{2,5}[-_](?=[A-Z0-9_-]*\d)[A-Z0-9_-]{3,}\b/gi;
const MIXED_TOKEN = /\b(?=[A-Z0-9_-]*\d)(?=[A-Z0-9_-]*[A-Z])[A-Z0-9_-]{6,}\b/gi;
const LONG_NUMBER = /\d{4,}/g;

export function anonymizeQuestion(text: string): string {
    let s = String(text || '').slice(0, 2000);
    s = s.replace(EMAIL, '[email]');
    s = s.replace(URL, '[lien]');
    s = s.replace(UUID, '[référence]');
    s = s.replace(OBJECT_ID, '[référence]');
    s = s.replace(PREFIXED_REF, '[référence]');
    s = s.replace(AMOUNT_BEFORE, '[montant] ');
    s = s.replace(AMOUNT_AFTER, '[montant] ');
    s = s.replace(PHONE, '[numéro]');
    s = s.replace(MIXED_TOKEN, '[référence]');
    s = s.replace(LONG_NUMBER, '[nombre]');
    return s.replace(/\s{2,}/g, ' ').trim();
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const ACTIVATION = /\b(activ\w*|pas active|non active|abonnement|pack|souscri\w*|subscription)\b/;
const WITHDRAWAL = /\b(retrai\w*|retir\w*|withdraw\w*|cash ?out|decaiss\w*)\b/;
const MONEY = /\b(argent|solde|balance|paiement|paye|payer|paie|rembours\w*|commission\w*|montant|transaction\w*|virement|depot|deposit|momo|mobile money|orange money|mtn|moov|wave|airtel|fcfa|xaf|cfa|francs?|dollars?|usdt|crypto|frais|dette|debit\w*|credit\w*|gain\w*|bonus|payout|transfert)\b/;
const PERSONAL = /\b(mon compte|mon profil|mon numero|mon email|mon e-mail|mon mot de passe|pirat\w*|hack\w*|vol[eé]?|bloque|suspendu|desactive|supprim\w*|code (?:otp|de verification)|otp|mon parrain|mes filleuls)\b/;

export type SensitiveRoute = 'activation' | 'withdrawal' | 'ticket';

/**
 * Questions about money or the member's own account never go to the AI:
 * they get the secure path (activation check, withdrawal status) or a ticket.
 * Run it on the anonymised text (an amount shows up as [montant]).
 */
export function classifySensitive(text: string): SensitiveRoute | null {
    const s = norm(text.includes('[montant]') ? text : anonymizeQuestion(text));
    if (s.includes('[montant]') && !WITHDRAWAL.test(s) && !ACTIVATION.test(s)) return 'ticket';
    if (WITHDRAWAL.test(s)) return 'withdrawal';
    if (ACTIVATION.test(s) && (MONEY.test(s) || /\b(compte|account)\b/.test(s))) return 'activation';
    if (/\b(pas active|non active|activer mon compte|activation)\b/.test(s)) return 'activation';
    if (MONEY.test(s) || PERSONAL.test(s) || s.includes('[montant]')) return 'ticket';
    return null;
}

/** Last line of defence on the AI answer: no amounts, no deadlines, no transaction status. */
export function answerLooksUnsafe(answer: string): boolean {
    const s = norm(answer);
    if (AMOUNT_AFTER.test(answer) || AMOUNT_BEFORE.test(answer)) { AMOUNT_AFTER.lastIndex = 0; AMOUNT_BEFORE.lastIndex = 0; return true; }
    AMOUNT_AFTER.lastIndex = 0; AMOUNT_BEFORE.lastIndex = 0;
    return /\b(\d+\s*(heures?|h|jours?|minutes?)\b|votre (paiement|retrait|transaction) (est|a ete))/.test(s);
}
