export interface RelancePack {
    id: string;
    credits: number;
    priceXAF: number;
    type: 'email' | 'sms';
}

export const EMAIL_PACKS: RelancePack[] = [
    { id: 'email_3k',  credits: 3000,  priceXAF: 2500,   type: 'email' },
    { id: 'email_7k',  credits: 7000,  priceXAF: 6000,   type: 'email' },
    { id: 'email_15k', credits: 15000, priceXAF: 12000,  type: 'email' },
];

export const SMS_PACKS: RelancePack[] = [
    { id: 'sms_250',  credits: 250,   priceXAF: 4000,   type: 'sms' },
    { id: 'sms_1k',  credits: 1000,  priceXAF: 15000,  type: 'sms' },
    { id: 'sms_10k', credits: 10000, priceXAF: 125000, type: 'sms' },
];

export const ALL_PACKS = [...EMAIL_PACKS, ...SMS_PACKS];

export function findPack(packId: string): RelancePack | undefined {
    return ALL_PACKS.find(p => p.id === packId);
}

// Recommend a pack based on referral count (shown in the frontend)
export function recommendPack(type: 'email' | 'sms', referralCount: number): RelancePack {
    const packs = type === 'email' ? EMAIL_PACKS : SMS_PACKS;
    // Each referral = 7 messages over the loop; recommend enough for at least one full cycle
    const needed = referralCount * 7;
    return packs.find(p => p.credits >= needed) || packs[packs.length - 1];
}
