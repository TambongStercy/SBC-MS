/**
 * What a member may see of a transaction (member-facing /api/transactions
 * routes). Provider references (MoneyFusion tokenPay, CinetPay/FeexPay ids,
 * NOWPayments payout ids), raw provider payloads, our internal review and
 * reconciliation notes, OTP fields and request fingerprints are removed: a
 * provider token in the wrong hands is enough to forge a webhook.
 */
const DROP_TOP = ['externalTransactionId', 'verificationCode', 'verificationExpiry', 'ipAddress', 'deviceInfo', 'approvedBy', 'rejectedBy', 'adminNotes', 'idempotencyKey', 'pendingId', 'relatedTransactions', '__v'];
const DROP_META = /token|reference|ref$|providerraw|webhook|payload|cinetpay|feexpay|moneyfusion|cryptopayoutid|batchwithdrawal|uniqueexternal|providertransaction|providerspecific|providerwebhook|mfreview|reservation|regularization|manualcompletion|reconciliation|transactionhash|internalfailure|balanceupdatefailed|walletdebit|errorafterprovider|duplicatesuccess|webhookprocessing|initiatedbyadmin|approvedbyadmin|rejectedbyadmin|completedby|extraid|finaladdress|needsreview|payoutinitiation|payoutmessage|payouterror|lastunconfirmed/i;

export function toMemberTransaction<T = any>(tx: T): T {
    if (!tx || typeof tx !== 'object') return tx;
    const plain: any = JSON.parse(JSON.stringify((tx as any).toObject ? (tx as any).toObject() : tx));
    for (const k of DROP_TOP) delete plain[k];
    if (plain.metadata && typeof plain.metadata === 'object') {
        for (const k of Object.keys(plain.metadata)) if (DROP_META.test(k)) delete plain.metadata[k];
    }
    if (plain.paymentProvider && typeof plain.paymentProvider === 'object') {
        delete plain.paymentProvider.transactionId;
        if (plain.paymentProvider.metadata) {
            for (const k of Object.keys(plain.paymentProvider.metadata)) if (DROP_META.test(k)) delete plain.paymentProvider.metadata[k];
        }
    }
    return plain;
}

export const toMemberTransactions = <T = any>(list: T[] | undefined | null): T[] => (Array.isArray(list) ? list.map((t) => toMemberTransaction(t)) : []);
