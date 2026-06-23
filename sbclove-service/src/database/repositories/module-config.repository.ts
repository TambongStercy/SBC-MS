import ModuleConfigModel, { IModuleConfig } from '../models/module-config.model';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('ModuleConfigRepository');

const SINGLETON_KEY = 'singleton';

export class ModuleConfigRepository {

    /**
     * Returns the singleton config, creating it (seeded from env) on first access.
     */
    async get(): Promise<IModuleConfig> {
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
        return cfg;
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
        return cfg as IModuleConfig;
    }
}

export const moduleConfigRepository = new ModuleConfigRepository();
