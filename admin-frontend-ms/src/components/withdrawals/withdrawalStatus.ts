import type { IconSvgElement } from '@hugeicons/react';
import {
    Alert02Icon, CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon, HourglassIcon, Loading03Icon, Undo02Icon,
} from '@hugeicons/core-free-icons';

/**
 * Withdrawal status label (French), badge tone and icon.
 * Local to the admin pages; the API service keeps its own English helpers.
 */
const STATUS_LABELS: Record<string, string> = {
    pending_admin_approval: 'À valider',
    pending_otp_verification: 'OTP en attente',
    processing: 'En cours',
    completed: 'Payé',
    failed: 'Échoué',
    rejected_by_admin: 'Rejeté',
    cancelled: 'Annulé',
    refunded: 'Remboursé',
    pending: 'En attente',
};

export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const STATUS_TONES: Record<string, StatusTone> = {
    pending_admin_approval: 'warning',
    pending_otp_verification: 'neutral',
    pending: 'neutral',
    processing: 'info',
    completed: 'success',
    failed: 'danger',
    rejected_by_admin: 'danger',
    cancelled: 'neutral',
    refunded: 'info',
};

const STATUS_ICONS: Record<string, IconSvgElement> = {
    pending_admin_approval: HourglassIcon,
    pending_otp_verification: Clock01Icon,
    pending: Clock01Icon,
    processing: Loading03Icon,
    completed: CheckmarkCircle02Icon,
    failed: Alert02Icon,
    rejected_by_admin: CancelCircleIcon,
    cancelled: CancelCircleIcon,
    refunded: Undo02Icon,
};

/** Older class-based colours (kept for any caller still using them). */
const STATUS_COLORS: Record<string, string> = {
    pending_admin_approval: 'bg-warning-soft text-warning',
    processing: 'bg-info-soft text-info',
    completed: 'bg-success-soft text-success',
    failed: 'bg-danger-soft text-danger',
    rejected_by_admin: 'bg-danger-soft text-danger',
};

export function withdrawalStatusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

export function withdrawalStatusTone(status: string): StatusTone {
    return STATUS_TONES[status] ?? 'neutral';
}

export function withdrawalStatusIcon(status: string): IconSvgElement | undefined {
    return STATUS_ICONS[status];
}

export function withdrawalStatusColor(status: string): string {
    return STATUS_COLORS[status] ?? 'bg-surface-2 text-fg-muted';
}

/** "Mobile Money" or "Crypto". */
export function withdrawalTypeLabel(type?: string): string {
    return type === 'crypto' ? 'Crypto' : 'Mobile Money';
}
