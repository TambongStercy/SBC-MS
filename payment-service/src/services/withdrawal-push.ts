import notificationService from './clients/notification.service.client';

/**
 * Tells the user on their phone that a withdrawal arrived or did not.
 *
 * Notification only — it moves no money and is never awaited. Called right
 * after the status is settled, next to the existing emails; "money" pushes
 * go out at any hour.
 */
export function pushWithdrawalResult(
    tx: { userId: unknown; transactionId: string; amount: number; currency: string; metadata?: Record<string, any> },
    outcome: 'completed' | 'failed',
    /**
     * Only where SBC debits on success (mobile money through the provider
     * webhooks): a failure there never touched the balance, and saying so is
     * what stops the worry. createCryptoPayout debits up front, so not there.
     */
    opts: { saysNotDebited?: boolean } = {},
): void {
    const net = Number(tx.metadata?.netAmountRequested ?? Math.abs(tx.amount));
    const currency = tx.metadata?.payoutCurrency || tx.currency;
    const amount = currency === 'USD' ? `$${net}` : `${Math.round(net).toLocaleString('fr-FR')} ${currency === 'XAF' ? 'FCFA' : currency}`;
    const phone: string | undefined = tx.metadata?.accountInfo?.fullMomoNumber;
    const to = currency === 'USD' ? 'ton portefeuille crypto' : phone ? `le ${phone.replace(/\D/g, '').slice(-4).padStart(8, '•')}` : 'ton compte';

    const { title, body } = outcome === 'completed'
        ? { title: 'Retrait envoyé ✅', body: `${amount} envoyés vers ${to}.` }
        : {
            title: 'Retrait non abouti',
            body: `Le retrait de ${amount} n'a pas pu être envoyé. ${opts.saysNotDebited ? "Ton solde n'a pas été débité." : 'Ouvre SBC pour les détails.'}`,
        };

    void notificationService.sendPush({
        userId: String(tx.userId),
        category: 'money',
        title,
        body,
        url: '/wallet',
        tag: `withdrawal-${tx.transactionId}`,
    });
}
