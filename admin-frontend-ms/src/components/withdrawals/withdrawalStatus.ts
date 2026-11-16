/**
 * Withdrawal status label (French) and badge colours that follow the theme.
 * Local to the admin pages; the API service keeps its own English helpers.
 */
const STATUS_LABELS: Record<string, string> = {
    pending_admin_approval: 'À valider',
    pending_otp_verification: 'OTP en attente',
    processing: 'En cours',
    completed: 'Terminé',
    failed: 'Échoué',
    rejected_by_admin: 'Rejeté',
    cancelled: 'Annulé',
    refunded: 'Remboursé',
    pending: 'En attente',
};

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

export function withdrawalStatusColor(status: string): string {
    return STATUS_COLORS[status] ?? 'bg-surface-2 text-fg-muted';
}
