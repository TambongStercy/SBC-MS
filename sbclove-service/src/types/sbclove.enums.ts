/**
 * Enums owned by the SBCLOVE module.
 *
 * Identity/demographic data (sex, age, city, country, name) is NOT redefined
 * here — it lives in user-service and is hydrated at read time. Only data that
 * the platform does not already have is modeled as SBCLOVE-owned enums.
 */

// Relationship intention (spec §5)
export enum Intention {
    SERIOUS_RELATIONSHIP = 'relation_serieuse',
    GET_ACQUAINTED = 'faire_connaissance',
    MARRIAGE_PROJECT = 'projet_mariage',
    EXPAND_SOCIAL_CIRCLE = 'elargir_cercle_social',
    VALUES_RESPECT_EXCHANGE = 'echange_valeurs_respect',
    OTHER = 'autre',
}

// Age bracket derived from User.birthDate at read time (spec §4)
export enum AgeBracket {
    AGE_18_25 = '18-25',
    AGE_26_35 = '26-35',
    AGE_36_45 = '36-45',
    AGE_46_55 = '46-55',
    AGE_56_PLUS = '56+',
}

// Profile lifecycle (spec §7 validation, §14 suspension)
export enum ProfileStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    SUSPENDED = 'suspended',
}

// Per-user choice within a match (spec §12-13, double opt-in)
export enum ContactChoice {
    PENDING = 'pending',
    WANTS_CONTACT = 'wants_contact',
    DECLINED = 'declined',
}

// Report lifecycle (spec §14)
export enum ReportStatus {
    OPEN = 'open',
    REVIEWED = 'reviewed',
    DISMISSED = 'dismissed',
}

/**
 * Computes the AgeBracket for a given birth date (evaluated against `now`).
 * Returns null if no birth date is available.
 */
export const ageBracketFromBirthDate = (
    birthDate: Date | string | undefined | null,
    now: Date = new Date()
): AgeBracket | null => {
    if (!birthDate) {
        return null;
    }
    const dob = new Date(birthDate);
    if (isNaN(dob.getTime())) {
        return null;
    }
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
        age--;
    }
    if (age < 18) return null;
    if (age <= 25) return AgeBracket.AGE_18_25;
    if (age <= 35) return AgeBracket.AGE_26_35;
    if (age <= 45) return AgeBracket.AGE_36_45;
    if (age <= 55) return AgeBracket.AGE_46_55;
    return AgeBracket.AGE_56_PLUS;
};
