import ModuleConfigModel, { IModuleConfig } from '../models/module-config.model';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('ModuleConfigRepository');

const SINGLETON_KEY = 'singleton';

// The config is read on every window-gated request (browse/interest/status).
// During the weekly spike that would be one findOne per request, so we cache the
// singleton in-process for a short TTL. Each replica keeps its own cache; a stale
// read lasts at most CACHE_TTL_MS (admin changes converge within that window).
const CACHE_TTL_MS = 30 * 1000;

export class ModuleConfigRepository {

    private cache: { value: IModuleConfig; expiresAt: number } | null = null;

    private setCache(value: IModuleConfig): IModuleConfig {
        this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
        return value;
    }

    /** Drops the in-process cache (used after an update so changes apply immediately on this replica). */
    invalidate(): void {
        this.cache = null;
    }

    /**
     * Returns the singleton config, creating it (seeded from env) on first access.
     * Served from the in-process cache when fresh.
     */
    async get(): Promise<IModuleConfig> {
        if (this.cache && this.cache.expiresAt > Date.now()) {
            return this.cache.value;
        }
        let cfg = await ModuleConfigModel.findOne({ key: SINGLETON_KEY }).exec();
        if (!cfg) {
            log.info('Seeding SBCLOVE module config singleton from env defaults.');
            cfg = await ModuleConfigModel.create({
                key: SINGLETON_KEY,
                enabled: true,
                activeWeekday: config.sbclove.activeWeekday,
                openHour: config.sbclove.openHour,
                closeHour: config.sbclove.closeHour,
                timezone: config.sbclove.timezone,
                maxInterestsPerWeek: config.sbclove.maxInterestsPerWeek,
                autoSuspendThreshold: config.sbclove.autoSuspendThreshold,
                autoApprove: config.sbclove.autoApprove,
            });
        }
        return this.setCache(cfg);
    }

    async update(data: Partial<IModuleConfig>, updatedBy?: string): Promise<IModuleConfig> {
        const update = { ...data, updatedBy };
        delete (update as any).key; // never allow key changes
        const cfg = await ModuleConfigModel.findOneAndUpdate(
            { key: SINGLETON_KEY },
            { $set: update },
            { new: true, upsert: true }
        ).exec();
        log.info('SBCLOVE module config updated.', { updatedBy });
        return this.setCache(cfg as IModuleConfig);
    }
}

export const moduleConfigRepository = new ModuleConfigRepository();
