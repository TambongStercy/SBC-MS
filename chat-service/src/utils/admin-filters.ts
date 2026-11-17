/**
 * Filters shared by every admin list / stats / chart endpoint (admin plan, phase 3).
 *
 *   ?country=CM        ISO-2, any case. Absent (or empty, or "ALL") = every country.
 *   ?from=…&to=…       ISO 8601 instants, both inclusive. Absent = no bound.
 *                      A bare date ("2026-11-16") for `to` means the end of that
 *                      day (UTC), so `from=2026-11-01&to=2026-11-30` covers November.
 *
 * Bad input is a 400 with a French message; the response shapes do not change.
 * The same file lives in every service that takes these filters (no shared package).
 */
import { Request, Response } from 'express';

export interface AdminFilters {
    /** ISO-2, upper case. */
    country?: string;
    from?: Date;
    to?: Date;
}

export class AdminFilterError extends Error {
    readonly statusCode = 400;
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readString(value: unknown): string | undefined {
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
}

function parseInstant(raw: string, name: 'from' | 'to'): Date {
    // Only ISO 8601 (a date, optionally with a time): "Date.parse" alone would
    // also take "11/16/2026" or "Monday", which the admin never sends.
    if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)) {
        throw new AdminFilterError(`Date « ${name} » invalide : format ISO 8601 attendu (ex. 2026-11-16 ou 2026-11-16T00:00:00Z).`);
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
        throw new AdminFilterError(`Date « ${name} » invalide : format ISO 8601 attendu (ex. 2026-11-16 ou 2026-11-16T00:00:00Z).`);
    }
    if (name === 'to' && BARE_DATE.test(raw)) d.setUTCHours(23, 59, 59, 999);
    return d;
}

/** Reads and validates ?country, ?from, ?to. Throws AdminFilterError (400). */
export function parseAdminFilters(query: Record<string, unknown>): AdminFilters {
    const filters: AdminFilters = {};

    const country = readString(query.country);
    if (country && country.toUpperCase() !== 'ALL') {
        if (!/^[A-Za-z]{2}$/.test(country)) {
            throw new AdminFilterError('Code pays invalide : utilisez un code ISO à 2 lettres (ex. CM).');
        }
        filters.country = country.toUpperCase();
    }

    const from = readString(query.from);
    const to = readString(query.to);
    if (from) filters.from = parseInstant(from, 'from');
    if (to) filters.to = parseInstant(to, 'to');
    if (filters.from && filters.to && filters.from > filters.to) {
        throw new AdminFilterError('La date de début (from) doit précéder la date de fin (to).');
    }
    return filters;
}

/**
 * Express helper: the filters, or null after answering 400 itself.
 *   const f = readAdminFilters(req, res); if (!f) return;
 */
export function readAdminFilters(req: Request, res: Response): AdminFilters | null {
    try {
        return parseAdminFilters(req.query as Record<string, unknown>);
    } catch (error) {
        if (error instanceof AdminFilterError) {
            res.status(400).json({ success: false, message: error.message });
            return null;
        }
        throw error;
    }
}

/** `{ [field]: { $gte, $lte } }` for the bounds that are set, `{}` otherwise. */
export function dateMatch(field: string, filters: AdminFilters): Record<string, { $gte?: Date; $lte?: Date }> {
    if (!filters.from && !filters.to) return {};
    return {
        [field]: {
            ...(filters.from ? { $gte: filters.from } : {}),
            ...(filters.to ? { $lte: filters.to } : {}),
        },
    };
}

/** Same bounds, for a `$expr`/in-memory check on an already loaded date. */
export function inDateRange(value: Date | string | null | undefined, filters: AdminFilters): boolean {
    if (!filters.from && !filters.to) return true;
    if (!value) return false;
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) return false;
    if (filters.from && t < filters.from.getTime()) return false;
    if (filters.to && t > filters.to.getTime()) return false;
    return true;
}
