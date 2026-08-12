import { Response } from 'express';
import { Types } from 'mongoose';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../../database/models/campaign-participation.model';
import {
    startSession,
    getSession,
    cancelSession,
    NoCapacityError,
    activeCount,
} from '../../services/verification-session.service';
import { applyExtraction, bindWhatsAppIdentity, lastPostExpired } from '../../services/verification.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('VerificationController');

const currentUserId = (req: AuthenticatedRequest): Types.ObjectId => {
    const id = req.user?.userId || req.user?.id;
    if (!id) throw new AppError('Authentication required', 401);
    return new Types.ObjectId(id);
};

const fail = (res: Response, err: unknown, context: string) => {
    if (err instanceof NoCapacityError) {
        // 503 + Retry-After so the client backs off rather than hammering a full queue.
        res.set('Retry-After', '30');
        return res.status(503).json({ success: false, message: err.message });
    }
    const status = (err as AppError)?.statusCode ?? 500;
    // Pino serializes a bare Error to {} — every 500 logged as "details: {}"
    // and the real cause was unrecoverable from the logs. Spell it out.
    if (status >= 500) {
        log.error(`${context}: ${(err as Error)?.message}`, { stack: (err as Error)?.stack });
    }
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Une erreur est survenue.' : (err as Error).message,
    });
};

/**
 * Opens a verification session and returns its id. The client then polls for the
 * QR, the diffuseur scans, and the result lands on a later poll.
 *
 * Returns immediately rather than holding the request open: linking takes as long
 * as the user takes to find their phone.
 */
export const start = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const participation = await CampaignParticipationModel.findOne({
            _id: req.params.participationId,
            diffuseurUserId: userId,
        });
        if (!participation) throw new AppError('Participation introuvable.', 404);
        if (participation.status !== ParticipationStatus.IN_PROGRESS) {
            throw new AppError('Cette campagne n\'est pas en cours.', 400);
        }

        const pending = participation.days.find(d => d.status !== DayStatus.VERIFIED);
        // All days verified is no longer the end: the last status keeps
        // collecting views for 24h, and re-verifying is how those views get
        // counted before the sweep completes the participation. Only once the
        // last status has expired is there truly nothing left to check.
        if (!pending && lastPostExpired(participation)) {
            throw new AppError('Toutes les journées sont déjà vérifiées.', 400);
        }
        const targetDay = pending ?? participation.days[participation.days.length - 1];

        // Two ways in. Diffuseurs link the same phone that is showing this page,
        // so pointing a camera at their own screen is not an option for most of
        // them — the pairing code is what makes the flow usable on one device.
        const method = req.body?.method === 'code' ? 'code' : 'qr';
        let pairWithPhone: string | undefined;

        if (method === 'code') {
            const digits = String(req.body?.phoneNumber ?? '').replace(/\D/g, '');
            if (digits.length < 8) {
                throw new AppError(
                    'Indiquez le numéro WhatsApp à connecter, avec son indicatif pays.',
                    400,
                );
            }
            pairWithPhone = digits;
        }

        const session = startSession({
            diffuseurUserId: userId,
            participationId: participation._id,
            day: targetDay.day,
            pairWithPhone,
            // Needed for the perceptual media check; without the bytes there is
            // nothing to compare against the campaign creative.
            downloadMedia: true,
        });

        return res.status(201).json({
            success: true,
            data: { sessionId: session.id, state: session.state, day: targetDay.day, method },
        });
    } catch (err) {
        return fail(res, err, 'startVerification');
    }
};

/**
 * Polls a session. Carries the QR while waiting for a scan, then the verdicts.
 *
 * The extraction result is applied here rather than in the session service so that
 * a client that stops polling cannot leave a scanned status unrecorded.
 */
export const poll = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const session = getSession(req.params.sessionId);
        if (!session) throw new AppError('Session introuvable ou expirée.', 404);
        if (session.diffuseurUserId !== String(userId)) {
            throw new AppError('Session introuvable ou expirée.', 404);
        }

        if (session.state === 'failed') {
            return res.json({ success: false, data: { state: session.state, error: session.error } });
        }

        if (session.state !== 'done') {
            return res.json({
                success: true,
                data: {
                    state: session.state,
                    method: session.method,
                    qr: session.qr,
                    pairingCode: session.pairingCode,
                    day: session.day,
                },
            });
        }

        if (!session.result) throw new AppError('Résultat de vérification manquant.', 500);

        // Identity binding first: if this WhatsApp belongs to another SBC account,
        // nothing about this extraction should be recorded.
        await bindWhatsAppIdentity(userId, session.result);

        const verdicts = await applyExtraction(
            new Types.ObjectId(session.participationId),
            session.result,
        );

        const accepted = verdicts.filter(v => v.accepted);
        return res.json({
            success: true,
            data: {
                state: 'done',
                verdicts,
                daysVerified: accepted.length,
                totalViews: accepted.reduce((sum, v) => sum + v.viewCount, 0),
                totalEarned: accepted.reduce((sum, v) => sum + v.earnedAmount, 0),
                // Earnings become payable on completion; the payout engine moves money.
                note: accepted.length
                    ? 'Vos gains seront crédités une fois la campagne terminée.'
                    : undefined,
            },
        });
    } catch (err) {
        return fail(res, err, 'pollVerification');
    }
};

export const cancel = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const session = getSession(req.params.sessionId);
        if (session && session.diffuseurUserId === String(userId)) {
            cancelSession(session.id);
        }
        return res.json({ success: true });
    } catch (err) {
        return fail(res, err, 'cancelVerification');
    }
};

/** Lets the UI warn about a queue before the diffuseur commits to scanning. */
export const capacity = async (_req: AuthenticatedRequest, res: Response) => {
    return res.json({ success: true, data: { active: activeCount() } });
};
