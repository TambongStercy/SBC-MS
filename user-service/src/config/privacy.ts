/**
 * Version of the privacy policy members consent to. Bump it when the policy
 * changes in a way that needs a new consent: members whose recorded version
 * differs are asked again (the web app compares it). Keep in step with the
 * web app's POLICY_VERSION.
 */
export const PRIVACY_POLICY_VERSION = '2026-12';

/** Benin members only must also accept the transfer of their data outside Benin (Rufus, 2026-11-08). */
export const isBeninCountry = (country?: string | null): boolean =>
    ['BJ', 'BENIN', 'BÉNIN'].includes(String(country ?? '').trim().toUpperCase());
