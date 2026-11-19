import config from '../config';
import { TICKET_CATEGORIES } from '../config/constants';
import logger from '../utils/logger';

const log = logger.getLogger('Ntfy');

/**
 * Phone notification (ntfy) for each new request, so the team sees a complaint
 * the moment it arrives. Off unless NTFY_URL and NTFY_TOPIC are set; NTFY_TOKEN
 * for a protected topic. The text passes through the ntfy server, so it carries
 * no phone number or email: the link opens the request in the desk (login needed).
 * Fire and forget: ntfy being down never fails or slows a request.
 */

const PRIORITY: Record<string, number> = { urgent: 5, high: 4, normal: 3, low: 2 };
const SOURCE: Record<string, string> = { member: 'Membre', assistant: 'Via l’assistant', public: 'Sans compte', agent: 'Agent', system: 'Système' };

export const ntfyEnabled = () => Boolean(config.ntfy.url && config.ntfy.topic);

export type NewTicketNotice = {
    id: string; number: string; category: string; priority: string; source: string;
    subject: string; body: string; name?: string | null;
};

export function ntfyMessage(t: NewTicketNotice) {
    const category = TICKET_CATEGORIES.find((c) => c.key === t.category)?.label ?? t.category;
    const excerpt = t.body.replace(/\s+/g, ' ').trim();
    return {
        topic: config.ntfy.topic,
        title: `Nouvelle demande ${t.number} · ${category}`,
        message: [
            `${t.name || 'Membre'} (${SOURCE[t.source] ?? t.source})`,
            `« ${t.subject} »`,
            excerpt.length > 280 ? `${excerpt.slice(0, 280)}…` : excerpt,
        ].join('\n'),
        priority: PRIORITY[t.priority] ?? 3,
        tags: [t.priority === 'urgent' || t.priority === 'high' ? 'warning' : 'speech_balloon', t.category],
        click: `${config.publicUrl}/tickets/${t.id}`,
    };
}

export function notifyNewTicket(t: NewTicketNotice): void {
    if (!ntfyEnabled()) return;
    void (async () => {
        try {
            // JSON publishing (POST to the server root) keeps accents intact; headers would not.
            const res = await fetch(config.ntfy.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(config.ntfy.token ? { Authorization: `Bearer ${config.ntfy.token}` } : {}) },
                body: JSON.stringify(ntfyMessage(t)),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) log.warn('ntfy refused the notification', { status: res.status, ticket: t.number });
        } catch (err) {
            log.warn('ntfy unreachable', { message: (err as Error).message, ticket: t.number });
        }
    })();
}
