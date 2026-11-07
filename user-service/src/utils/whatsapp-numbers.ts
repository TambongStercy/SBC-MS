/**
 * A member's WhatsApp numbers in the order others should save them: the one
 * they chose to show first, then the main number, then the other extras.
 */
export function contactNumbers(user: {
    phoneNumber?: string | number | null;
    featuredWhatsappNumber?: string | null;
    extraWhatsappNumbers?: { number: string }[] | null;
}): string[] {
    const all = [user.featuredWhatsappNumber, user.phoneNumber, ...(user.extraWhatsappNumbers ?? []).map(n => n.number)]
        .filter((n): n is string | number => n !== undefined && n !== null && String(n).trim() !== '')
        .map(String);
    return Array.from(new Set(all));
}

/** The number to show and to open WhatsApp with. */
export const displayWhatsappNumber = (user: { phoneNumber?: string | number | null; featuredWhatsappNumber?: string | null }) =>
    String(user.featuredWhatsappNumber || user.phoneNumber || '');
