import { HugeiconsIcon } from '@hugeicons/react';
import {
    Calendar03Icon, Cancel01Icon, CheckmarkCircle02Icon, Clock01Icon, Edit02Icon, Mail01Icon, PauseIcon, PlayIcon, SmartPhone01Icon,
} from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { Badge } from '../ui';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/** Campaign states, in words, with a tone and an icon (a state is never colour alone). */
export const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone; icon: IconSvgElement }> = {
    draft: { label: 'Brouillon', tone: 'neutral', icon: Edit02Icon },
    scheduled: { label: 'Programmée', tone: 'info', icon: Calendar03Icon },
    active: { label: 'En cours', tone: 'success', icon: PlayIcon },
    paused: { label: 'En pause', tone: 'warning', icon: PauseIcon },
    completed: { label: 'Terminée', tone: 'primary', icon: CheckmarkCircle02Icon },
    cancelled: { label: 'Annulée', tone: 'danger', icon: Cancel01Icon },
    failed: { label: 'Échouée', tone: 'danger', icon: Cancel01Icon },
};

export function CampaignStatusBadge({ status }: { status: string }) {
    const s = CAMPAIGN_STATUS[status] ?? { label: status, tone: 'neutral' as Tone, icon: Clock01Icon };
    return (
        <Badge tone={s.tone}>
            <HugeiconsIcon icon={s.icon} size={12} aria-hidden="true" />
            {s.label}
        </Badge>
    );
}

/** A filleul's journey (target) state. */
export const TARGET_STATUS: Record<string, { label: string; tone: Tone }> = {
    active: { label: 'Dans la boucle', tone: 'success' },
    paused: { label: 'En pause', tone: 'warning' },
    completed: { label: 'Sorti', tone: 'neutral' },
    failed: { label: 'Échec', tone: 'danger' },
};

export function TargetStatusBadge({ status }: { status: string }) {
    const s = TARGET_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
    return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const TYPE_LABELS: Record<string, string> = { default: 'Relance des nouveaux', filtered: 'Campagne filtrée' };

export const CHANNEL: Record<string, { label: string; icon: IconSvgElement }> = {
    email: { label: 'E-mail', icon: Mail01Icon },
    sms: { label: 'SMS', icon: SmartPhone01Icon },
    both: { label: 'E-mail + SMS', icon: Mail01Icon },
};

export function ChannelLabel({ channel }: { channel?: string }) {
    const c = CHANNEL[channel || 'email'] ?? CHANNEL.email;
    return (
        <span className="inline-flex items-center gap-1.5 text-sm text-fg">
            <HugeiconsIcon icon={c.icon} size={14} className="text-fg-muted" aria-hidden="true" />
            {c.label}
        </span>
    );
}

export const EXIT_REASON_LABELS: Record<string, string> = {
    paid: 'A payé',
    completed_7_days: '7 jours terminés',
    completed_7days: '7 jours terminés',
    // The stats endpoint counts "referrer_inactive" under this key.
    subscription_expired: 'Parrain inactif',
    referrer_inactive: 'Parrain inactif',
    manual: 'Sortie manuelle',
    expired: 'Expiré (ancien)',
};

export const GENDER_LABELS: Record<string, string> = { male: 'Hommes', female: 'Femmes', other: 'Autre' };
export const LANGUAGE_LABELS: Record<string, string> = { fr: 'Français', en: 'Anglais' };
