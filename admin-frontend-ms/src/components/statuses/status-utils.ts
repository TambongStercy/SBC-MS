import type { Status, StatusCategory } from '../../services/statusApi';

/** One author's stories, oldest first (the order the story viewer plays them). */
export interface StatusGroup {
    authorId: string;
    authorName: string;
    authorAvatar?: string;
    statuses: Status[];
    latestTime: Date;
}

/** Groups stories by author, most recent author first (as the original story bar did). */
export function groupByAuthor(statuses: Status[]): StatusGroup[] {
    const groups = new Map<string, StatusGroup>();
    statuses.forEach(status => {
        if (!status.author) return;
        const authorId = status.author._id;
        if (!groups.has(authorId)) {
            groups.set(authorId, {
                authorId,
                authorName: status.author.name,
                authorAvatar: status.author.avatar,
                statuses: [],
                latestTime: new Date(status.createdAt),
            });
        }
        groups.get(authorId)!.statuses.push(status);
    });
    groups.forEach(group => {
        group.statuses.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
    return Array.from(groups.values()).sort((a, b) => b.latestTime.getTime() - a.latestTime.getTime());
}

/** French name of a story's category. */
export function categoryLabel(status: Status, categories: StatusCategory[]): string {
    const cat = categories.find(c => c.key === status.category);
    return cat?.nameFr || status.categoryInfo?.name || cat?.nameEn || status.category;
}

export const MEDIA_LABEL: Record<Status['mediaType'], string> = {
    text: 'Texte',
    image: 'Image',
    flyer: 'Affiche',
    video: 'Vidéo',
};

/** Where the story was posted from, if given. */
export const placeOf = (s: Status) => [s.city, s.region, s.country].filter(Boolean).join(', ');
