export enum StatusCategory {
    PROJECTS_TESTIMONIALS = 'projects_testimonials',
    EVENTS_NEWS = 'events_news',
    NEEDS_JOBS = 'needs_jobs',
    BUSINESS_OPPORTUNITIES = 'business_opportunities',
    CULTURE_TOURISM = 'culture_tourism'
}

export interface ICategoryDefinition {
    key: StatusCategory;
    name: string;
    nameFr: string;
    nameEn: string;
    badge: string;
    badgeColor: string;
    icon: string;
    adminOnly: boolean;
    description: string;
}

export const STATUS_CATEGORIES: Record<StatusCategory, ICategoryDefinition> = {
    [StatusCategory.PROJECTS_TESTIMONIALS]: {
        key: StatusCategory.PROJECTS_TESTIMONIALS,
        name: 'Echo des Projets et Temoignages',
        nameFr: 'Echo des Projets et Temoignages',
        nameEn: 'Project Echoes & Testimonials',
        badge: 'gold',
        badgeColor: '#FFD700',
        icon: 'trophy',
        adminOnly: true,
        description: 'Success stories and project testimonials'
    },
    [StatusCategory.EVENTS_NEWS]: {
        key: StatusCategory.EVENTS_NEWS,
        name: 'Evenements Actualite',
        nameFr: 'Evenements Actualite',
        nameEn: 'Events & News',
        badge: 'blue',
        badgeColor: '#3B82F6',
        icon: 'calendar',
        adminOnly: true,
        description: 'Platform news and upcoming events'
    },
    [StatusCategory.NEEDS_JOBS]: {
        key: StatusCategory.NEEDS_JOBS,
        name: 'Besoins et Offres d\'emploi',
        nameFr: 'Besoins et Offres d\'emploi',
        nameEn: 'Needs & Job Offers',
        badge: 'green',
        badgeColor: '#22C55E',
        icon: 'briefcase',
        adminOnly: false,
        description: 'Job postings and service needs'
    },
    [StatusCategory.BUSINESS_OPPORTUNITIES]: {
        key: StatusCategory.BUSINESS_OPPORTUNITIES,
        name: 'Opportunites Business',
        nameFr: 'Opportunites Business',
        nameEn: 'Business Opportunities',
        badge: 'violet',
        badgeColor: '#8B5CF6',
        icon: 'trending-up',
        adminOnly: false,
        description: 'Business and investment opportunities'
    },
    [StatusCategory.CULTURE_TOURISM]: {
        key: StatusCategory.CULTURE_TOURISM,
        name: 'Culture et Tourisme',
        nameFr: 'Culture et Tourisme',
        nameEn: 'Culture & Tourism',
        badge: 'orange',
        badgeColor: '#F97316',
        icon: 'globe',
        adminOnly: false,
        description: 'Cultural events and tourism'
    }
};

export const isAdminCategory = (category: string): boolean => {
    const categoryDef = STATUS_CATEGORIES[category as StatusCategory];
    return categoryDef?.adminOnly === true;
};

export const getCategoryDefinition = (category: string): ICategoryDefinition | undefined => {
    return STATUS_CATEGORIES[category as StatusCategory];
};

export const getAllCategories = (): ICategoryDefinition[] => {
    return Object.values(STATUS_CATEGORIES);
};

export const getUserCategories = (): ICategoryDefinition[] => {
    return Object.values(STATUS_CATEGORIES).filter(cat => !cat.adminOnly);
};

export const getAdminCategories = (): ICategoryDefinition[] => {
    return Object.values(STATUS_CATEGORIES).filter(cat => cat.adminOnly);
};
