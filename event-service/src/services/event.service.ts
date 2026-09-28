import { Types } from 'mongoose';
import slugify from 'slugify';
import Event, { IEvent, EventStatus, WEBINAR_CATEGORY, WEBINAR_VENUE } from '../database/models/event.model';
import Organizer from '../database/models/organizer.model';
import TicketType, { ITicketType, TicketTypeStatus, saleWindowState } from '../database/models/ticket-type.model';
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

/**
 * A WhatsApp group invite, chat (wa.me / api.whatsapp.com) or channel link —
 * nothing else, so a webinar can't be used to hand buyers an arbitrary URL.
 */
const WHATSAPP_LINK = /^https:\/\/(chat\.whatsapp\.com\/[A-Za-z0-9]{10,}|(www\.)?whatsapp\.com\/channel\/[A-Za-z0-9]{10,}|wa\.me\/\d{6,15}|api\.whatsapp\.com\/send\/?\?phone=\d{6,15})([/?#&]\S*)?$/i;

const normalizeWhatsAppLink = (raw: unknown): string | undefined => {
    let link = typeof raw === 'string' ? raw.trim() : '';
    if (!link) return undefined;
    if (!/^https?:\/\//i.test(link)) link = `https://${link}`;
    link = link.replace(/^http:\/\//i, 'https://');
    if (!WHATSAPP_LINK.test(link)) {
        throw new AppError('Le lien doit être un lien WhatsApp : groupe (chat.whatsapp.com/…), discussion (wa.me/…) ou chaîne (whatsapp.com/channel/…).', 400);
    }
    return link;
};

/**
 * A webinar has no place: the location fields read "En ligne", resale is off
 * (a buyer who has seen the link keeps it, so reselling the ticket would sell
 * the same seat twice) and the WhatsApp link is validated. Any other category
 * drops the link.
 */
const applyCategoryRules = (fields: Record<string, any>) => {
    if (fields.category === WEBINAR_CATEGORY) {
        fields.city = 'En ligne';
        fields.venue = WEBINAR_VENUE;
        fields.address = 'En ligne';
        fields.resaleEnabled = false;
        fields.accessLink = normalizeWhatsAppLink(fields.accessLink);
    } else {
        fields.accessLink = undefined;
    }
};

export const createEvent = async (organizerId: string, payload: Partial<IEvent>): Promise<IEvent> => {
    if (!payload.title?.trim()) throw new AppError('Le titre est obligatoire.', 400);
    if (!payload.description?.trim()) throw new AppError('La description est obligatoire.', 400);
    if (!payload.startsAt || !payload.endsAt) throw new AppError('Les dates de début et de fin sont obligatoires.', 400);
    if (new Date(payload.endsAt) <= new Date(payload.startsAt)) throw new AppError('La fin doit être après le début.', 400);

    const fields: Record<string, any> = {
        title: payload.title.trim(),
        description: payload.description.trim(),
        posterFileId: payload.posterFileId,
        videoFileId: payload.videoFileId,
        category: payload.category?.trim() || 'autre',
        country: payload.country?.trim() || undefined,
        city: payload.city?.trim() || '',
        venue: payload.venue?.trim() || '',
        address: payload.address?.trim() || '',
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        resaleEnabled: payload.resaleEnabled !== false,
        maxResalePricePct: payload.maxResalePricePct ?? null,
        accessLink: payload.accessLink,
    };
    applyCategoryRules(fields);
    if (fields.category === WEBINAR_CATEGORY && !fields.accessLink) {
        throw new AppError('Ajoutez le lien WhatsApp du webinaire.', 400);
    }

    const slug = await generateUniqueSlug(payload.title);

    const doc = await Event.create({
        ...fields,
        organizerId: new Types.ObjectId(organizerId),
        slug,
        status: EventStatus.DRAFT,
        shareUrls: buildShareUrls(slug),
    });
    return doc;
};

/**
 * Only editable-before-sale fields may change freely. Once tickets exist,
 * changes are restricted per spec §18.
 */
const IMMUTABLE_AFTER_SALE = new Set(['startsAt', 'endsAt', 'venue', 'address', 'category']);

/**
 * What the organizer form may change. Anything else in the body (status,
 * totals, organizerId, slug…) is ignored — otherwise an organizer could send
 * `status: PUBLISHED` and skip the admin review.
 */
const EDITABLE_FIELDS = [
    'title', 'description', 'posterFileId', 'videoFileId', 'category', 'country', 'city',
    'venue', 'address', 'startsAt', 'endsAt', 'resaleEnabled', 'maxResalePricePct', 'accessLink',
] as const;

const sameValue = (a: unknown, b: unknown) => {
    if (a instanceof Date || b instanceof Date) return new Date(a as any).getTime() === new Date(b as any).getTime();
    return String(a ?? '').trim() === String(b ?? '').trim();
};

export const updateEvent = async (
    organizerId: string,
    eventId: string,
    body: Record<string, unknown>,
): Promise<IEvent> => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) }).select('+accessLink');
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status === EventStatus.CANCELLED || event.status === EventStatus.COMPLETED) {
        throw new AppError('Cet événement ne peut plus être modifié.', 409);
    }

    // Guard: if any ticket already exists for this event, refuse to change
    // critical fields. This is the spec §18 rule.
    const patch: Record<string, any> = {};
    for (const key of EDITABLE_FIELDS) if (body[key] !== undefined) patch[key] = body[key];
    const merged: Record<string, any> = { category: event.category, accessLink: event.accessLink, ...patch };
    applyCategoryRules(merged);
    for (const key of ['city', 'venue', 'address', 'resaleEnabled', 'accessLink'] as const) {
        if (key in patch || merged.category === WEBINAR_CATEGORY || key === 'accessLink') patch[key] = merged[key];
    }

    // A form save resends every field, so only a field whose value actually
    // changes counts as an edit.
    const hasSoldTickets = await Ticket.exists({ eventId: event._id, status: { $in: [TicketStatus.ISSUED, TicketStatus.CHECKED_IN] } });
    for (const key of Object.keys(patch)) {
        if (hasSoldTickets && IMMUTABLE_AFTER_SALE.has(key) && !sameValue(event.get(key), patch[key])) {
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

/**
 * Organizer "publish". A new (or refused) event does not go live directly: it
 * is submitted for admin review (PENDING_REVIEW) and only an admin acceptance
 * publishes it. A SUSPENDED event was already accepted once, so it resumes.
 */
export const publishEvent = async (organizerId: string, eventId: string): Promise<IEvent> => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) }).select('+accessLink');
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status === EventStatus.PUBLISHED || event.status === EventStatus.PENDING_REVIEW) return event;
    if (event.status !== EventStatus.DRAFT && event.status !== EventStatus.REJECTED && event.status !== EventStatus.SUSPENDED) {
        throw new AppError(`Un événement ${event.status} ne peut pas être publié.`, 409);
    }

    const hasTicketType = await TicketType.exists({ eventId: event._id, status: TicketTypeStatus.ACTIVE });
    if (!hasTicketType) throw new AppError('Créez au moins un type de billet avant de publier.', 400);
    if (event.category === WEBINAR_CATEGORY && !event.accessLink) {
        throw new AppError('Ajoutez le lien WhatsApp du webinaire avant de le soumettre.', 400);
    }

    if (event.status === EventStatus.SUSPENDED) {
        event.status = EventStatus.PUBLISHED;
        await event.save();
        return event;
    } else {
        event.status = EventStatus.PENDING_REVIEW;
        event.submittedAt = new Date();
        event.rejectionReason = undefined;
    }
    await event.save();
    return event;
};

/** Admin accepts a submitted event — it goes live. */
export const approveEvent = async (eventId: string): Promise<IEvent> => {
    const event = await Event.findById(eventId);
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status !== EventStatus.PENDING_REVIEW) {
        throw new AppError('Seul un événement en attente de validation peut être accepté.', 409);
    }
    event.status = EventStatus.PUBLISHED;
    event.publishedAt = event.publishedAt ?? new Date();
    event.reviewedAt = new Date();
    event.rejectionReason = undefined;
    await event.save();
    return event;
};

/**
 * Admin refuses a submitted event. Only this event is affected: the organizer
 * keeps their account and can edit + resubmit it or create other events.
 */
export const rejectEvent = async (eventId: string, reason?: string): Promise<IEvent> => {
    const event = await Event.findById(eventId);
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status !== EventStatus.PENDING_REVIEW) {
        throw new AppError('Seul un événement en attente de validation peut être refusé.', 409);
    }
    event.status = EventStatus.REJECTED;
    event.reviewedAt = new Date();
    event.rejectionReason = reason?.trim().slice(0, 500) || undefined;
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

/** A public event card: the stored document plus the two fields the feed needs (§3). */
export interface PublicEventListItem extends Record<string, any> {
    priceFrom: number | null;
    ticketsSold: number;
}

export const listPublicEvents = async (
    filters: EventListFilters,
): Promise<{ items: PublicEventListItem[]; total: number }> => {
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
        // Mongo forbids $text inside $or (must be top-level and unique per
        // query), so we can't cleanly combine the text-index with a regex
        // fallback here. Regex-across-title+city is good enough for short
        // queries and predictable ordering — the text index would help scale
        // but nothing at expected V1 volumes needs it.
        const q = filters.q.trim();
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { title: { $regex: escaped, $options: 'i' } },
            { city: { $regex: escaped, $options: 'i' } },
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

    // "à partir de" is part of every card (§3), so priceFrom is attached ALWAYS —
    // it used to be computed only when a price filter was present, which left the
    // normal feed with no price at all. One grouped query for the whole page,
    // not one per event. ticketsSold rides along so the feed can rank popularity.
    const cheapestByEvent = new Map<string, number>();
    if (items.length) {
        const rows = await TicketType.aggregate<{ _id: Types.ObjectId; price: number }>([
            { $match: { eventId: { $in: items.map((ev) => ev._id) }, status: TicketTypeStatus.ACTIVE } },
            { $group: { _id: '$eventId', price: { $min: '$price' } } },
        ]);
        for (const row of rows) cheapestByEvent.set(String(row._id), row.price);
    }

    const enriched = items.map((ev) => ({
        ...ev,
        priceFrom: cheapestByEvent.has(String(ev._id)) ? cheapestByEvent.get(String(ev._id))! : null,
        ticketsSold: (ev as any).totals?.ticketsSold ?? 0,
    }));

    if (filters.priceMin === undefined && filters.priceMax === undefined) {
        return { items: enriched, total };
    }

    return {
        items: enriched.filter((ev) => {
            // An event with no active ticket type has no price to judge — keep it.
            if (ev.priceFrom === null) return true;
            if (filters.priceMin !== undefined && ev.priceFrom < filters.priceMin) return false;
            if (filters.priceMax !== undefined && ev.priceFrom > filters.priceMax) return false;
            return true;
        }),
        total,
    };
};

export const getPublicEventBySlug = async (slug: string): Promise<{ event: any; ticketTypes: any[] }> => {
    const event = await Event.findOne({ slug, status: { $in: [EventStatus.PUBLISHED, EventStatus.SUSPENDED, EventStatus.COMPLETED] } }).lean();
    if (!event) throw new AppError('Événement introuvable.', 404);
    // §4 lists the organizer among the detail fields — a buyer decides partly on
    // who is running the event. Only the public identity, never contact details.
    const organizer = await Organizer.findById(event.organizerId)
        .select('displayName logoFileId')
        .lean();
    const ticketTypes = await TicketType.find({ eventId: event._id, status: TicketTypeStatus.ACTIVE })
        .sort({ price: 1 }).lean();
    const now = new Date();
    return {
        event: { ...event, organizer: organizer ? { displayName: organizer.displayName, logoFileId: (organizer as any).logoFileId } : undefined },
        ticketTypes: ticketTypes.map((t) => {
            // Out-of-window types stay in the list, greyed out by the UI: hiding
            // them would leave a buyer wondering where the VIP ticket went, and
            // `saleWindow` tells them when it opens / when it closed (spec §6/§7).
            const window = saleWindowState(t, now);
            return {
                ...t,
                available: Math.max(0, (t.quantityTotal ?? 0) - (t.quantitySold ?? 0)),
                onSale: window === null,
                saleWindow: window,
            };
        }),
    };
};

export const listOrganizerEvents = async (organizerId: string, params: { limit?: number; skip?: number; status?: EventStatus }) => {
    const filter: any = { organizerId: new Types.ObjectId(organizerId) };
    if (params.status) filter.status = params.status;
    const [items, total] = await Promise.all([
        Event.find(filter).select('+accessLink').sort({ createdAt: -1 }).limit(params.limit ?? 20).skip(params.skip ?? 0).lean(),
        Event.countDocuments(filter),
    ]);
    return { items, total };
};

export const getOrganizerEvent = async (organizerId: string, eventId: string) => {
    const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: new Types.ObjectId(organizerId) }).select('+accessLink').lean();
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
