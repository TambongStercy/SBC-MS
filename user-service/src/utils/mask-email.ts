/**
 * Mask an email so the owner can recognise it without exposing the full
 * address to someone who merely knows the account's phone number.
 *
 * Shape: first 1–2 characters of the local part, three asterisks, @ and the
 * full domain. Short local parts (<= 2 chars) keep a single character so a
 * two-letter inbox is not fully revealed.
 *
 *   john.doe@gmail.com      -> jo***@gmail.com
 *   al@yahoo.fr             -> a***@yahoo.fr
 *   q@gmail.com             -> ***@gmail.com
 */
export function maskEmail(email: string | null | undefined): string {
    const trimmed = (email || '').trim().toLowerCase();
    const at = trimmed.indexOf('@');
    if (at <= 0 || at === trimmed.length - 1) return '***';

    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at + 1);

    const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
    return `${shown}***@${domain}`;
}
