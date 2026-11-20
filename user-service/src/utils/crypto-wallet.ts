/**
 * The crypto wallet that receives a member's crypto withdrawals (NOWPayments
 * payouts). Like the Mobile Money number, changing it needs the account
 * password and a code sent to the account email, and replacing an existing
 * wallet blocks withdrawals for 48 h (Security plan Phase 0).
 */
export const CRYPTO_WALLET_CURRENCIES = ['BTC', 'LTC', 'XRP', 'TRX', 'USDTSOL', 'USDTBSC', 'BNBBSC'] as const;
export type CryptoWalletCurrency = typeof CRYPTO_WALLET_CURRENCIES[number];

const B58 = '[1-9A-HJ-NP-Za-km-z]';
const BECH32 = '[02-9ac-hj-np-z]';

/**
 * Address formats per currency. A typo in an address loses the money for
 * good, so an address that cannot belong to the chosen network is refused
 * before a code is even sent.
 */
const ADDRESS_PATTERNS: Record<CryptoWalletCurrency, RegExp> = {
    BTC: new RegExp(`^(bc1${BECH32}{11,87}|[13]${B58}{25,34})$`),
    LTC: new RegExp(`^(ltc1${BECH32}{11,87}|[LM3]${B58}{26,33})$`),
    XRP: new RegExp(`^r${B58}{24,34}$`),
    TRX: new RegExp(`^T${B58}{33}$`),
    USDTSOL: new RegExp(`^${B58}{32,44}$`),
    USDTBSC: /^0x[0-9a-fA-F]{40}$/,
    BNBBSC: /^0x[0-9a-fA-F]{40}$/,
};

export function normalizeCryptoCurrency(raw: unknown): CryptoWalletCurrency | null {
    const value = String(raw ?? '').trim().toUpperCase();
    return (CRYPTO_WALLET_CURRENCIES as readonly string[]).includes(value) ? value as CryptoWalletCurrency : null;
}

/** The address as it will be stored, or null when it cannot belong to `currency`. */
export function normalizeCryptoAddress(raw: unknown, currency: CryptoWalletCurrency): string | null {
    if (typeof raw !== 'string') return null;
    let address = raw.trim();
    // Bech32 addresses are case-insensitive but stored lower-case.
    if (/^(bc1|ltc1)/i.test(address)) address = address.toLowerCase();
    return ADDRESS_PATTERNS[currency].test(address) ? address : null;
}

/** Hex (0x…) and bech32 addresses compare without case; the others are case-sensitive. */
function sameAddress(a: string, b: string): boolean {
    if (a === b) return true;
    const caseless = /^(0x|bc1|ltc1)/i;
    return caseless.test(a) && caseless.test(b) && a.toLowerCase() === b.toLowerCase();
}

export function isSameCryptoWallet(
    current: { cryptoWalletAddress?: string | null; cryptoWalletCurrency?: string | null },
    address: string,
    currency: string,
): boolean {
    return !!current.cryptoWalletAddress
        && String(current.cryptoWalletCurrency ?? '').toUpperCase() === currency.toUpperCase()
        && sameAddress(current.cryptoWalletAddress.trim(), address.trim());
}

/** The OTP target that binds a code to one currency + address. */
export function cryptoChangeTarget(address: string, currency: string): string {
    return `${currency}|${address}`;
}

/** For logs and alerts: never the whole address. */
export function addressTail(address: string): string {
    return address.slice(-4);
}
