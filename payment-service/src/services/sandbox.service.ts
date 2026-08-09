import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('SandboxService');

/**
 * Preprod payment sandbox.
 *
 * Testing the payment flows for real means moving real money: a payin charges a
 * real phone, a withdrawal pays a real one. So the second half of every flow —
 * webhooks, debit-on-success, reconciliation pages — could only ever be
 * exercised in production, on real users.
 *
 * The sandbox replaces exactly one thing: the HTTP call to the provider. The
 * magic values below decide what the provider "answers", and a sweeper later
 * feeds that answer through the same webhook handlers a real provider would
 * hit. Everything on our side of the provider boundary — gateway selection,
 * OTP, admin approval, wallet debits, notifications — runs unchanged.
 *
 * Magic values (documented for testers):
 *   Payins — phone number ending decides the outcome:
 *     ...00  rejected at initiation (provider refuses the request)
 *     ...11  FAILED webhook after the delay (e.g. insufficient funds)
 *     ...22  hangs forever (no webhook — tests expiry and status checkers)
 *     other  SUCCESS webhook after the delay
 *   Withdrawals — net amount's last two digits decide the outcome:
 *     ..01   FAILED webhook (wallet untouched — debit-on-success)
 *     ..02   hangs forever (tests the /fix-*-withdrawals reconcile pages)
 *     ..03   rejected at initiation
 *     other  COMPLETED webhook after the delay (wallet debited)
 */

export type SandboxOutcome = 'success' | 'fail' | 'hang' | 'reject';

export const SBX_PREFIX = 'SBX-';

const DEFAULT_DELAY_MS = 15_000;

export const sandboxDelayMs = (): number => {
    const raw = parseInt(process.env.SANDBOX_COMPLETE_DELAY_MS || '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DELAY_MS;
};

/**
 * Hard stop. The flag alone is not enough: NODE_ENV=production wins no matter
 * what is set, so a copied .env can never put fake payments in front of users.
 */
export const isSandboxActive = (): boolean => {
    if (!config.sandboxEnabled) return false;
    if (config.nodeEnv === 'production') return false;
    return true;
};

/** Loud startup complaint if someone tries to enable it in production anyway. */
export const warnIfMisconfigured = (): void => {
    if (config.sandboxEnabled && config.nodeEnv === 'production') {
        log.error(
            'PAYMENT_SANDBOX_ENABLED is set but NODE_ENV=production — the sandbox is REFUSED. ' +
            'Remove the flag from the production environment.'
        );
    } else if (isSandboxActive()) {
        log.warn('==============================================================');
        log.warn('  PAYMENT SANDBOX ACTIVE — no real provider calls will be made');
        log.warn(`  Simulated outcomes resolve after ${sandboxDelayMs() / 1000}s`);
        log.warn('==============================================================');
    }
};

export const payinOutcomeForPhone = (phone: string): SandboxOutcome => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.endsWith('00')) return 'reject';
    if (digits.endsWith('11')) return 'fail';
    if (digits.endsWith('22')) return 'hang';
    return 'success';
};

export const payoutOutcomeForAmount = (amount: number): SandboxOutcome => {
    const cents = Math.round(Math.abs(amount)) % 100;
    if (cents === 1) return 'fail';
    if (cents === 2) return 'hang';
    if (cents === 3) return 'reject';
    return 'success';
};

/**
 * Sandbox references are self-describing: `SBX-<outcome>-<dueEpochMs>-<suffix>`.
 * The outcome and due time travel inside the reference itself, so the sweeper
 * and the status-check stubs need no extra state and survive restarts — the
 * database already holds everything.
 */
export const makeSandboxRef = (outcome: Exclude<SandboxOutcome, 'reject'>): string => {
    const due = Date.now() + sandboxDelayMs();
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${SBX_PREFIX}${outcome}-${due}-${suffix}`;
};

export const isSandboxRef = (ref: unknown): ref is string =>
    typeof ref === 'string' && ref.startsWith(SBX_PREFIX);

export const parseSandboxRef = (ref: string): { outcome: SandboxOutcome; dueAt: number } | null => {
    if (!isSandboxRef(ref)) return null;
    const match = /^SBX-(success|fail|hang)-(\d+)-/.exec(ref);
    if (!match) return null;
    return { outcome: match[1] as SandboxOutcome, dueAt: parseInt(match[2], 10) };
};

/** What a provider status API would answer right now for this reference. */
export const refStatusNow = (ref: string): 'pending' | 'completed' | 'failed' => {
    const parsed = parseSandboxRef(ref);
    if (!parsed) return 'pending';
    if (parsed.outcome === 'hang') return 'pending';
    if (Date.now() < parsed.dueAt) return 'pending';
    return parsed.outcome === 'success' ? 'completed' : 'failed';
};
