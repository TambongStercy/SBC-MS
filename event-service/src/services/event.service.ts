import { Types } from 'mongoose';
import slugify from 'slugify';
import Event, { IEvent, EventStatus } from '../database/models/event.model';
import TicketType, { ITicketType, TicketTypeStatus } from '../database/models/ticket-type.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import { generateEventSlugSuffix } from '../utils/serial';
import { AppError } from '../utils/errors';
import config from '../config';

const buildShareUrls = (slug: string) => {
    const landing = `${config.appBaseUrl.replace(/\/$/, '')}/e/${slug}`;
    const text = encodeURIComponent(`Découvrez cet événement sur SBC : ${landing}`);
    return {
        link: landing,
        whatsapp: `https://wa.me/?text=${text}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(landing)}`,
    };
};

const generateUniqueSlug = async (title: string): Promise<string> => {
    const base = slugify(title, { lower: true, strict: true, trim: true }).slice(0, 100) || 'event';
    // Try base, then base-XXXXXX
    if (!(await Event.exists({ slug: base }))) return base;
    for (let i = 0; i < 5; i++) {
        const candidate = `${base}-${generateEventSlugSuffix()}`;
        if (!(await Event.exists({ slug: candidate }))) return candidate;
    }
    throw new AppError('Impossible de générer un slug unique. Veuillez réessayer.', 500);
};

export const createEvent = async (organizerId: string, payload: Partial<IEvent>): Promise<IEvent> => {
    if (!payload.title?.trim()) throw new AppError('Le titre est obligatoire.', 400);
    if (!payload.description?.trim()) throw new AppError('La description est obligatoire.', 400);
    if (!payload.startsAt || !payload.endsAt) throw new AppError('Les dates de début et de fin sont obligatoires.', 400);
    if (new Date(payload.endsAt) <= new Date(payload.startsAt)) throw new AppError('La fin doit être après le début.', 400);

    const slug = await generateUniqueSlug(payload.title);

    const doc = await Event.create({
        organizerId: new Types.ObjectId(organizerId),
        slug,
        title: payload.title.trim(),
        description: payload.description.trim(),
        posterFileId: payload.posterFileId,
        category: payload.category?.trim() || 'autre',
        country: payload.country?.trim() || undefined,
        city: payload.city?.trim() || '',
        venue: payload.venue?.trim() || '',
        address: payload.address?.trim() || '',
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        status: EventStatus.DRAFT,
        resaleEnabled: payload.resaleEnabled !== false,
        maxResalePricePct: payload.maxResalePricePct ?? null,
        shareUrls: buildShareUrls(slug),
    });
    return doc;
};

/**
 * Only editable-before-sale fields may change freely. Once tickets exist,
 * changes are restricted per spec §18.
 */
const IMMUTABLE_AFTER_SALE = new Set(['startsAt', 'endsAt', 'venue', 'address']);

export const updateEvent = async (
    organizerId: string,
    eventId: string,
    patch: Partial<IEvent>,
): Promise<IEvent> => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) });
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status === EventStatus.CANCELLED || event.status === EventStatus.COMPLETED) {
        throw new AppError('Cet événement ne peut plus être modifié.', 409);
    }

    // Guard: if any ticket already exists for this event, refuse to change
    // critical fields. This is the spec §18 rule.
    const hasSoldTickets = await Ticket.exists({ eventId: event._id, status: { $in: [TicketStatus.ISSUED, TicketStatus.CHECKED_IN] } });
    for (const key of Object.keys(patch)) {
        if (hasSoldTickets && IMMUTABLE_AFTER_SALE.has(key)) {
            throw new AppError(`Le champ « ${key} » ne peut plus être modifié après une vente.`, 409);
        }
    }

    Object.assign(event, patch);
    if (patch.title) {
        // Slug is stable — never regenerate after publication (would break shared links).
        if (event.status !== EventStatus.DRAFT) delete (patch as any).title;
    }
    await event.save();
    return event;
};

export const publishEvent = async (organizerId: string, eventId: string): Promise<IEvent> => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) });
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status === EventStatus.PUBLISHED) return event;
    if (event.status !== EventStatus.DRAFT && event.status !== EventStatus.SUSPENDED) {
        throw new AppError(`Un événement ${event.status} ne peut pas être publié.`, 409);
    }

    const hasTicketType = await TicketType.exists({ eventId: event._id, status: TicketTypeStatus.ACTIVE });
    if (!hasTicketType) throw new AppError('Créez au moins un type de billet avant de publier.', 400);

    event.status = EventStatus.PUBLISHED;
    event.publishedAt = event.publishedAt ?? new Date();
    await event.save();
    return event;
};

export const suspendEvent = async (organizerId: string, eventId: string): Promise<IEvent> => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) });
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status !== EventStatus.PUBLISHED) throw new AppError('Seul un événement publié peut être suspendu.', 409);
    event.status = EventStatus.SUSPENDED;
    await event.save();
    return event;
};

/**
 * Organizer-side cancel. Delegates to the same cascade as the admin path so
 * buyers get their money AND their notification regardless of who cancels.
 * Uses the organizer's own userId as the initiator for audit.
 */
export const cancelEvent = async (
    organizerId: string,
    eventId: string,
    reason?: string,
    initiatedByUserId?: string,
): Promise<IEvent> => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) });
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status === EventStatus.CANCELLED) return event;

    const { cancelEventAndCascade } = await import('./cancellation.service');
    const result = await cancelEventAndCascade({
        eventId: String(event._id),
        initiatedByAdminId: initiatedByUserId || String(event.organizerId), // reuse the same field for audit
        reason,
    });
    return result.event;
};

export interface EventListFilters {
    q?: string;
    city?: string;
    country?: string;
    category?: string;
    dateFrom?: Date;
    dateTo?: Date;
    priceMin?: number;
    priceMax?: number;
    /** true → return events whose endsAt is already in the past. Sorted newest-first. */
    includePast?: boolean;
    limit?: number;
    skip?: number;
}

export const listPublicEvents = async (filters: EventListFilters) => {
    const now = new Date();
    const filter: any = {
        status: EventStatus.PUBLISHED,
    };
    // Default is "still relevant" (not yet ended). If the caller passed an
    // explicit dateFrom, they're asking "starting after date X" so honor that.
    // Otherwise use endsAt >= now so ongoing events (already started but not
    // over yet) still show — a user creating an event for tonight expects it
    // to appear right away, not only until the moment the clock ticks past
    // its start time.
    if (filters.includePast) {
        // Past-events view: everything already ended, newest-completed first.
        filter.endsAt = { $lt: now };
    } else if (filters.dateFrom) {
        filter.startsAt = { $gte: filters.dateFrom };
    } else {
        filter.endsAt = { $gte: now };
    }
    if (filters.dateTo) filter.startsAt = { ...(filter.startsAt || {}), $lte: filters.dateTo };
    if (filters.city) filter.city = filters.city;
    if (filters.country) filter.country = filters.country;
    if (filters.category) filter.category = filters.category;
    if (filters.q?.trim()) {
        // Prefer text index when available; fall back to a case-insensitive
        // contains match on title so short/partial queries (that never win a
        // text-index score above threshold) still surface something.
        const q = filters.q.trim();
        filter.$or = [
            { $text: { $search: q } } as any,
            { title: { $regex: q, $options: 'i' } },
        ];
    }

    const [items, total] = await Promise.all([
        Event.find(filter)
            .sort(filters.includePast ? { endsAt: -1 } : { startsAt: 1 })
            .limit(Math.min(filters.limit ?? 20, 100))
            .skip(filters.skip ?? 0)
            .lean(),
        Event.countDocuments(filter),
    ]);

    // Price filter is post-hoc — cheapest ticket type per event
    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
        const withPrice = await Promise.all(items.map(async (ev) => {
            const cheapest = await TicketType.findOne({ eventId: ev._id, status: TicketTypeStatus.ACTIVE })
                .sort({ price: 1 }).lean();
            return { ...ev, priceFrom: cheapest?.price ?? null };
        }));
        return {
            items: withPrice.filter((ev) => {
                if (!ev.priceFrom && ev.priceFrom !== 0) return true;
                if (filters.priceMin !== undefined && ev.priceFrom < filters.priceMin) return false;
                if (filters.priceMax !== undefined && ev.priceFrom > filters.priceMax) return false;
                return true;
            }),
            total,
        };
    }

    return { items, total };
};

export const getPublicEventBySlug = async (slug: string): Promise<{ event: any; ticketTypes: any[] }> => {
    const event = await Event.findOne({ slug, status: { $in: [EventStatus.PUBLISHED, EventStatus.SUSPENDED, EventStatus.COMPLETED] } }).lean();
    if (!event) throw new AppError('Événement introuvable.', 404);
    const ticketTypes = await TicketType.find({ eventId: event._id, status: TicketTypeStatus.ACTIVE })
        .sort({ price: 1 }).lean();
    return {
        event,
        ticketTypes: ticketTypes.map((t) => ({
            ...t,
            available: Math.max(0, (t.quantityTotal ?? 0) - (t.quantitySold ?? 0)),
        })),
    };
};

export const listOrganizerEvents = async (organizerId: string, params: { limit?: number; skip?: number; status?: EventStatus }) => {
    const filter: any = { organizerId: new Types.ObjectId(organizerId) };
    if (params.status) filter.status = params.status;
    const [items, total] = await Promise.all([
        Event.find(filter).sort({ createdAt: -1 }).limit(params.limit ?? 20).skip(params.skip ?? 0).lean(),
        Event.countDocuments(filter),
    ]);
    return { items, total };
};

export const getOrganizerEvent = async (organizerId: string, eventId: string) => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) }).lean();
    if (!event) throw new AppError('Événement introuvable.', 404);
    return event;
};

export const createTicketType = async (organizerId: string, eventId: string, payload: Partial<ITicketType>): Promise<ITicketType> => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) });
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (!payload.name?.trim()) throw new AppError('Le nom du billet est obligatoire.', 400);
    if (payload.price === undefined || payload.price < 0) throw new AppError('Le prix est invalide.', 400);
    if (!payload.quantityTotal || payload.quantityTotal < 1) throw new AppError('La quantité totale doit être ≥ 1.', 400);

    return TicketType.create({
        eventId: event._id,
        name: payload.name.trim(),
        description: payload.description?.trim(),
        price: payload.price,
        quantityTotal: payload.quantityTotal,
        quantitySold: 0,
        maxPerOrder: payload.maxPerOrder ?? 10,
        salesStart: payload.salesStart,
        salesEnd: payload.salesEnd,
        status: TicketTypeStatus.ACTIVE,
    });
};

export const listTicketTypes = async (organizerId: string, eventId: string) => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) });
    if (!event) throw new AppError('Événement introuvable.', 404);
    return TicketType.find({ eventId: event._id }).sort({ price: 1 }).lean();
};
