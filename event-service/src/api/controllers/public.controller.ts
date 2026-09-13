import { Request, Response } from 'express';
import Event, { EventStatus } from '../../database/models/event.model';
import TicketType, { TicketTypeStatus } from '../../database/models/ticket-type.model';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('PublicController');

const fmtDate = (d: Date) => {
    try {
        return new Intl.DateTimeFormat('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        }).format(d);
    } catch {
        return d.toISOString();
    }
};

const posterFileUrl = (fileId?: string): string => {
    if (!fileId) return '';
    // Route through settings-service /files with a thumbnail-friendly width so
    // WhatsApp/FB fetch a small preview instead of the full-resolution asset —
    // the "hourly-boundary signed URL snap" pattern keeps this cache-friendly.
    return `${config.appBaseUrl.replace(/\/$/, '')}/api/settings/files/${fileId}?w=800`;
};

/**
 * Server-rendered event landing at /e/:slug. Ships OG meta tags so the link
 * previews on WhatsApp/Facebook, then deep-links into the SPA at /events/:slug.
 * Nginx routes /e/ to this service directly (not via the gateway) so the URL
 * stays as short as possible for social sharing.
 */
export const eventLanding = async (req: Request, res: Response) => {
    const { slug } = req.params;
    try {
        const event = await Event.findOne({ slug }).lean();
        if (!event || event.status === EventStatus.DRAFT) {
            return res.status(404).render('event-not-found');
        }
        const cheapest = await TicketType.findOne({ eventId: event._id, status: TicketTypeStatus.ACTIVE })
            .sort({ price: 1 }).lean();
        const descriptionPreview = (event.description || '').slice(0, 200);
        res.render('event-landing', {
            event,
            descriptionPreview,
            startsAtFormatted: fmtDate(new Date(event.startsAt)),
            posterUrl: posterFileUrl(event.posterFileId),
            priceFrom: cheapest?.price ?? null,
            appUrl: `${config.appBaseUrl.replace(/\/$/, '')}/events/${encodeURIComponent(event.slug)}`,
            canonicalUrl: `${config.appBaseUrl.replace(/\/$/, '')}/e/${encodeURIComponent(event.slug)}`,
        });
    } catch (err) {
        log.error(`Event landing render failed for ${slug}:`, err);
        res.status(500).render('event-not-found');
    }
};
