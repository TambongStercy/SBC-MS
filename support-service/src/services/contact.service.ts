import { badRequest } from '../utils/errors';

/**
 * Contact details typed at the top of a request: how the person wants to be
 * reached. Never trusted as an identity: a request made without an account
 * (`source: 'public'`) carries only these, and anyone can type someone else's
 * email or number. The desk shows them as « non vérifié » in that case.
 */
export type TicketContact = { name: string | null; phone: string | null; email: string | null };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,200}\.[^\s@]{2,24}$/;

export function cleanContact(input: unknown, required: boolean): TicketContact | null {
    const c = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const name = str(c.name, 80);
    const phone = str(c.phone, 30);
    const email = str(c.email, 254).toLowerCase();

    if (name && name.length < 2) throw badRequest('Indiquez votre nom.', 'BAD_CONTACT_NAME');
    const digits = phone.replace(/\D/g, '');
    if (phone && (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < 6 || digits.length > 15)) {
        throw badRequest('Ce numéro de téléphone n’est pas valide.', 'BAD_CONTACT_PHONE');
    }
    if (email && !EMAIL.test(email)) throw badRequest('Cette adresse email n’est pas valide.', 'BAD_CONTACT_EMAIL');
    if (required) {
        if (!name) throw badRequest('Indiquez votre nom.', 'BAD_CONTACT_NAME');
        if (!phone) throw badRequest('Indiquez votre numéro de téléphone.', 'BAD_CONTACT_PHONE');
        if (!email) throw badRequest('Indiquez votre adresse email : la réponse y sera envoyée.', 'BAD_CONTACT_EMAIL');
    }
    if (!name && !phone && !email) return null;
    return { name: name || null, phone: phone || null, email: email || null };
}
