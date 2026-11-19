import config from '../config';
import { Setting } from '../database/models/setting.model';

/**
 * Settings (CONTRACT §5). Defaults pending SBC validation; every value is a
 * setting, not code. Cached per process for 30 s, invalidated locally on write.
 */

type Validator = (v: unknown) => boolean;

const isPosInt = (max: number): Validator => (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const isBool: Validator = (v) => typeof v === 'boolean';
const oneOf = (...vals: string[]): Validator => (v) => typeof v === 'string' && vals.includes(v);

interface SettingDef { default: () => unknown; validate: Validator; label: string }

export const SETTING_DEFS: Record<string, SettingDef> = {
    'approval.regularization': { default: () => 'always', validate: oneOf('always'), label: 'Régularisation : double validation' },
    'approval.manualActivation': { default: () => 'always', validate: oneOf('always'), label: 'Activation de secours : double validation' },
    'approval.contactChange': { default: () => 'always', validate: oneOf('always'), label: 'Changement d’email/téléphone : double validation' },
    'approval.withdrawalManualCompleteAbove': { default: () => 50000, validate: isPosInt(100_000_000), label: 'Finalisation manuelle de retrait : seuil (XAF) — sans effet tant que la régularisation exige toujours une double validation' },
    'finance.alertHours': {
        default: () => [24, 48, 72],
        validate: (v) => Array.isArray(v) && v.length === 3 && v.every((h) => Number.isInteger(h) && h > 0 && h <= 24 * 30)
            && (v as number[])[0] < (v as number[])[1] && (v as number[])[1] < (v as number[])[2],
        label: 'Retraits : alerte, dossier, critique (heures)',
    },
    'views.assignmentMode': { default: () => 'round_robin', validate: oneOf('round_robin', 'load', 'manual'), label: 'Vérifications : mode d’affectation' },
    'views.unstartedRequeueMinutes': { default: () => 10, validate: isPosInt(24 * 60), label: 'Tâche non commencée : remise en file (min)' },
    'views.idleAlertMinutes': { default: () => 15, validate: isPosInt(24 * 60), label: 'Tâche inactive : alerte (min)' },
    'views.qaSamplePercent': { default: () => 5, validate: isPosInt(100), label: 'Contrôle qualité (%)' },
    'tickets.autoCloseResolvedDays': { default: () => 7, validate: isPosInt(365), label: 'Fermeture auto des tickets résolus (jours)' },
    'assistant.dailyQuestionsPerMember': { default: () => 20, validate: isPosInt(1000), label: 'Assistant : questions par membre et par jour' },
    'assistant.monthlyBudgetUsd': { default: () => 30, validate: (v) => typeof v === 'number' && v >= 0 && v <= 10000, label: 'Assistant : budget mensuel (USD)' },
    'killswitch.autoActivation': { default: () => false, validate: isBool, label: 'Couper l’activation automatique' },
    'killswitch.autoWithdrawalFinalize': { default: () => false, validate: isBool, label: 'Couper la finalisation automatique des retraits' },
    'killswitch.reconciliation': { default: () => false, validate: isBool, label: 'Couper le rapprochement' },
    // On (DeepSeek off) until DEEPSEEK_API_KEY is set.
    'killswitch.deepseek': { default: () => !config.deepseek.apiKey, validate: isBool, label: 'Couper DeepSeek' },
    'killswitch.autoAssignment': { default: () => false, validate: isBool, label: 'Couper l’affectation automatique' },
};

const TTL_MS = 30_000;
let cache: { at: number; values: Map<string, unknown> } | null = null;

async function loadAll(): Promise<Map<string, unknown>> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
    const docs = await Setting.find({}).lean();
    const values = new Map<string, unknown>();
    for (const d of docs) if (SETTING_DEFS[d.key]) values.set(d.key, d.value);
    cache = { at: Date.now(), values };
    return values;
}

export function invalidateSettingsCache(): void { cache = null; }

export async function getSetting<T = unknown>(key: string): Promise<T> {
    const def = SETTING_DEFS[key];
    if (!def) throw new Error(`Unknown setting ${key}`);
    const values = await loadAll();
    return (values.has(key) ? values.get(key) : def.default()) as T;
}

export async function getAllSettings(): Promise<{ key: string; label: string; value: unknown; isDefault: boolean }[]> {
    const values = await loadAll();
    return Object.entries(SETTING_DEFS).map(([key, def]) => ({
        key, label: def.label, value: values.has(key) ? values.get(key) : def.default(), isDefault: !values.has(key),
    }));
}

export async function setSetting(key: string, value: unknown, by: string): Promise<{ before: unknown; after: unknown }> {
    const def = SETTING_DEFS[key];
    if (!def) throw new Error('UNKNOWN_SETTING');
    if (!def.validate(value)) throw new Error('INVALID_SETTING');
    const before = await getSetting(key);
    await Setting.updateOne({ key }, { $set: { value, updatedBy: by } }, { upsert: true });
    invalidateSettingsCache();
    return { before, after: value };
}

export const isKillSwitchOn = (name: string): Promise<boolean> => getSetting<boolean>(`killswitch.${name}`);
