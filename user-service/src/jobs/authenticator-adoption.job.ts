import cron, { type ScheduledTask } from 'node-cron';
import { AuthenticatorAdoptionDayModel, computeAdoption } from '../services/authenticator-adoption.service';
import { doualaDay } from '../services/activity-signals.service';
import logger from '../utils/logger';

const log = logger.getLogger('AuthenticatorAdoptionJob');

/**
 * Security plan Phase 3 rollout: daily snapshot of authenticator adoption among
 * members holding more than 5,000 F (03:55 Douala; at start if today's is missing).
 * AUTHENTICATOR_ADOPTION_JOB_DISABLED=true stops it.
 */
class AuthenticatorAdoptionJob {
    private task: ScheduledTask | null = null;

    private async run(): Promise<void> {
        try { await computeAdoption(); } catch (err: any) { log.error(`Adoption snapshot failed: ${err?.message ?? err}`); }
    }

    start(): void {
        if (String(process.env.AUTHENTICATOR_ADOPTION_JOB_DISABLED || '').toLowerCase() === 'true') {
            log.warn('Authenticator adoption job disabled');
            return;
        }
        this.task = cron.schedule('55 3 * * *', () => { void this.run(); }, { timezone: 'Africa/Douala' });
        setTimeout(() => {
            AuthenticatorAdoptionDayModel.exists({ _id: doualaDay() })
                .then(found => (found ? undefined : this.run()))
                .catch((err: any) => log.error(`Adoption startup check failed: ${err?.message ?? err}`));
        }, 90_000).unref?.();
        log.info('Authenticator adoption job scheduled (03:55 Africa/Douala)');
    }

    stop(): void { this.task?.stop(); this.task = null; }
}

export const authenticatorAdoptionJob = new AuthenticatorAdoptionJob();
