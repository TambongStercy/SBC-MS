import type { RecheckResult } from '../../api/types';
import { formatDateTime, formatMoney } from '../../lib/format';
import { Panel } from '../ui';
import { RECHECK_RESULT, StatusBadge } from './labels';

/** The provider's answer to a recheck, as returned (CONTRACT §2.2 RecheckResult). */
export function RecheckResultCard({ result, className }: { result: RecheckResult; className?: string }) {
  const meta = RECHECK_RESULT[result.result];
  return (
    <Panel className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">Réponse du prestataire</span>
          <StatusBadge map={RECHECK_RESULT} value={result.result} />
        </div>
        <span className="text-xs text-fg-muted">{formatDateTime(result.checkedAt)}</span>
      </div>
      <div className="px-4 py-3">
        {meta && <p className="mb-3 text-sm text-fg-muted">{meta.help}</p>}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Prestataire" value={result.provider} />
          <Row label="Statut chez le prestataire" value={result.providerStatus} mono />
          <Row label="Référence prestataire" value={result.providerRef} mono />
          {result.amount != null && <Row label="Montant" value={formatMoney(result.amount, result.currency)} />}
          <Row label="Identifiant de requête" value={result.requestId} mono />
        </dl>
      </div>
    </Panel>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-xs text-fg' : 'text-fg'}>{value || '—'}</dd>
    </div>
  );
}
