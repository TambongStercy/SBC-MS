import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon, CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon, HourglassIcon, Loading03Icon, Undo02Icon, UserIcon,
} from '@hugeicons/core-free-icons';
import { Badge } from '../ui';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
interface StatusInfo { label: string; tone: Tone; icon: IconSvgElement }

/** Payment intents (money coming in): statuses as the admin reads them. */
export const PAYMENT_STATUS: Record<string, StatusInfo> = {
  PENDING_USER_INPUT: { label: 'En attente du membre', tone: 'neutral', icon: UserIcon },
  PENDING_PROVIDER: { label: 'En attente du fournisseur', tone: 'warning', icon: HourglassIcon },
  PROCESSING: { label: 'En cours', tone: 'info', icon: Loading03Icon },
  SUCCEEDED: { label: 'Réussi', tone: 'success', icon: CheckmarkCircle02Icon },
  FAILED: { label: 'Échoué', tone: 'danger', icon: Alert02Icon },
  CANCELED: { label: 'Annulé', tone: 'neutral', icon: CancelCircleIcon },
  EXPIRED: { label: 'Expiré', tone: 'neutral', icon: Clock01Icon },
  ERROR: { label: 'Erreur', tone: 'danger', icon: Alert02Icon },
  REQUIRES_ACTION: { label: 'Action requise', tone: 'warning', icon: HourglassIcon },
  REFUNDED: { label: 'Remboursé', tone: 'info', icon: Undo02Icon },
};

/** Account transactions (members' wallets). */
export const ACCOUNT_STATUS: Record<string, StatusInfo> = {
  pending: { label: 'En attente', tone: 'warning', icon: HourglassIcon },
  completed: { label: 'Terminé', tone: 'success', icon: CheckmarkCircle02Icon },
  failed: { label: 'Échoué', tone: 'danger', icon: Alert02Icon },
  cancelled: { label: 'Annulé', tone: 'neutral', icon: CancelCircleIcon },
  refunded: { label: 'Remboursé', tone: 'info', icon: Undo02Icon },
};

export const ACCOUNT_TYPE: Record<string, string> = {
  deposit: 'Dépôt',
  withdrawal: 'Retrait',
  transfer: 'Transfert',
  payment: 'Paiement',
  refund: 'Remboursement',
  fee: 'Frais',
  conversion: 'Conversion',
};

const GATEWAYS: Record<string, string> = {
  feexpay: 'FeexPay',
  cinetpay: 'CinetPay',
  moneyfusion: 'MoneyFusion',
  nowpayments: 'NOWPayments',
  lygos: 'Lygos',
  testing: 'Test',
  none: 'Non choisie',
};
export const gatewayLabel = (g?: string | null) => (g ? GATEWAYS[g.toLowerCase()] ?? g : '—');

export function StatusBadge({ status, map }: { status: string; map: Record<string, StatusInfo> }) {
  const info = map[status];
  return (
    <Badge tone={info?.tone ?? 'neutral'}>
      {info && <HugeiconsIcon icon={info.icon} size={12} aria-hidden="true" />}
      {info?.label ?? status}
    </Badge>
  );
}
