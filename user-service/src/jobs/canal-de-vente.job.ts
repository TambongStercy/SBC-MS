import cron, { type ScheduledTask } from 'node-cron';
import config from '../config';
import { ensureMissingCanalLinks, isCanalConfigured } from '../services/canal-de-vente.service';
import logger from '../utils/logger';

const log = logger.getLogger('CanalDeVenteJob');

/**
 * Retries the canal de vente link of Winner members who still have none (the
 * canal backend was down at activation). Every 30 minutes by default
 * (CANAL_RETRY_CRON). No WhatsApp message on retries.
 */
class CanalDeVenteJob {
    private task: ScheduledTask | null = null;
    private running = false;

    start(): void {
        if (this.task) return;
        if (!isCanalConfigured()) {
            log.info('CANAL_SERVICE_SECRET not set: canal de vente retry job not started.');
            return;
        }
        if (!cron.validate(config.canalDeVente.cron)) {
            log.error(`Invalid CANAL_RETRY_CRON "${config.canalDeVente.cron}": retry job not started.`);
            return;
        }
        this.task = cron.schedule(config.canalDeVente.cron, async () => {
            if (this.running) return;
            this.running = true;
            try {
                const r = await ensureMissingCanalLinks({ notify: false, limit: 200 });
                if (r.missing) log.info(`Canal de vente retry: ${r.linked} linked, ${r.failed} still missing`);
            } catch (err: any) {
                log.error(`Canal de vente retry failed: ${err?.message ?? err}`);
            } finally {
                this.running = false;
            }
        });
        log.info(`Canal de vente retry job scheduled (${config.canalDeVente.cron}).`);
    }

    stop(): void {
        this.task?.stop();
        this.task = null;
    }
}

export const canalDeVenteJob = new CanalDeVenteJob();
