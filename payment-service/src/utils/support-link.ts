/**
 * « Contacter le support » on the payment page (failed, expired, cancelled or
 * archived payment): opens a new request in the member app's « Aide », with the
 * payment reference filled in, so the agent finds the payment and its recorded
 * failure on the member's page.
 *
 * Shown only once SBC Support is live: set SUPPORT_HELP_URL in payment-service
 * .env to the member app's help section (e.g. https://sniperbuisnesscenter.com/aide).
 * Empty = no button.
 */
export function supportRequestUrl(sessionId: string): string | null {
    const base = String(process.env.SUPPORT_HELP_URL || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/.test(base)) return null;
    return `${base}/demandes/nouvelle?paiement=${encodeURIComponent(sessionId)}`;
}
