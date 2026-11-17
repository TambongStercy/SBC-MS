import axios from 'axios';
import { randomUUID } from 'crypto';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SupportServiceClient');

export interface ViewTaskPayload {
    sourceId: string;
    submittedAt: string;
    campaignId: string;
    diffuseurUserId: string;
    dayIndex: number;
    country: string | null;
}

/**
 * Hands a video proof that just entered `pending_review` to SBC Support, which
 * turns it into a verifier task (POST /api/support/internal/view-tasks,
 * idempotent on sourceId; contract §2.5).
 *
 * Never throws and never waits long: the caller is a diffuseur's upload, which
 * must succeed whether or not support-service is reachable. A proof missed here
 * is picked up by support-service's catch-up sync (GET /internal/manual-verifications).
 * When SUPPORT_SERVICE_URL is unset the call is skipped with a warning.
 */
export const sendViewTask = async (payload: ViewTaskPayload): Promise<boolean> => {
    const base = config.services.supportService;
    if (!base) {
        log.warn(`SUPPORT_SERVICE_URL is not set: view task for proof ${payload.sourceId} not sent to SBC Support`);
        return false;
    }
    const requestId = randomUUID();
    try {
        await axios.post(`${base}/support/internal/view-tasks`, payload, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.services.serviceSecret}`,
                'x-service-name': 'advertising-service',
                'x-request-id': requestId,
            },
        });
        log.info(`View task for proof ${payload.sourceId} sent to SBC Support (request ${requestId})`);
        return true;
    } catch (err: any) {
        log.warn(
            `Could not send view task for proof ${payload.sourceId} to SBC Support (request ${requestId}): `
            + `${err?.response?.status ?? ''} ${err?.message ?? err}`,
        );
        return false;
    }
};
