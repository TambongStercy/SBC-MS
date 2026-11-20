/**
 * Contact masking for agents without members.read.full (CONTRACT §4):
 * `+237 6•• •• 34`, `j•••@gmail.com`.
 */
export function maskPhone(phone?: string | null): string | null {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 5) return '••••';
    // Country codes in the markets served are 3 digits (237, 225, 229, 242, 243, ...).
    const cc = digits.length > 9 ? digits.slice(0, digits.length - 9 >= 3 ? 3 : digits.length - 9) : '';
    const national = cc ? digits.slice(cc.length) : digits;
    const first = national[0];
    const last = national.slice(-2);
    return `${cc ? `+${cc} ` : ''}${first}•• •• ${last}`;
}

export function maskEmail(email?: string | null): string | null {
    if (!email) return null;
    const [local, domain] = String(email).split('@');
    if (!domain) return '•••';
    return `${local.slice(0, 1)}•••@${domain}`;
}

/** Last two digits only, for logs. */
export const phoneTail = (phone?: string | null) => (phone ? `…${String(phone).replace(/\D/g, '').slice(-2)}` : '-');
