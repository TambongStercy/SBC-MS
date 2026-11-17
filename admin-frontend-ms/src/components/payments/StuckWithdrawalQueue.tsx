import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, RefreshIcon, SourceCodeIcon } from '@hugeicons/core-free-icons';
import type { WithdrawalTransaction } from '../../services/adminWithdrawalApi';
import { STUCK_KEY, providerRef, waitedFor, type Fetcher, type StuckProvider } from './stuck';
import { Badge, Button, Dialog, EmptyState, Panel, PanelHeader, ResponsiveList, SheetContent, type ListColumn } from '../ui';
import { ErrorState, FilterBar } from '../common/DataStates';
import Pagination from '../common/Pagination';
import MetadataViewerModal from '../common/MetadataViewerModal';
import { formatMoney, formatNumber, formatRelative } from '../common/format';
import { getCountryName } from '../../utils/countryUtils';
import { withdrawalStatusLabel } from '../withdrawals/withdrawalStatus';
import { AgeBadge, CopyValue, DetailRow, MemberCell, SearchInput } from './shared';
import { fullDate, useUrlSearchAndPage } from './useUrlSearchAndPage';
import { usePageFilters } from '../../hooks/usePageFilters';

const PAGE_SIZE = 20;

const statusTone = (s: string) => (s === 'processing' ? 'info' : s === 'pending' ? 'warning' : 'neutral') as 'info' | 'warning' | 'neutral';

export interface QueueRowActions {
  /** Buttons for a row (desktop: compact; phone: full width). */
  row: (tx: WithdrawalTransaction, phone: boolean) => ReactNode;
  /** Buttons at the bottom of the details sheet. */
  sheet: (tx: WithdrawalTransaction) => ReactNode;
}

/**
 * A provider's stuck withdrawals as a work queue: how many, the oldest, what
 * to check before acting, the search, the list (oldest first, as the server
 * sorts it) and a details sheet per withdrawal.
 */
export function StuckWithdrawalQueue({ provider, fetcher, providerName, refLabel, checkFirst, actions, emptyDescription, detailsOpen, onDetailsOpenChange }: {
  provider: StuckProvider;
  fetcher: Fetcher;
  providerName: string;
  /** "tokenPay MoneyFusion"… */
  refLabel: string;
  checkFirst: ReactNode;
  actions: QueueRowActions;
  emptyDescription: string;
  /** The withdrawal whose sheet is open (owned by the page so actions can close it). */
  detailsOpen: WithdrawalTransaction | null;
  onDetailsOpenChange: (tx: WithdrawalTransaction | null) => void;
}) {
  const { input, setInput, q, page, setPage, clear, clearAll } = useUrlSearchAndPage();
  // Country / period come from the page's filter row (URL). The period is
  // sent only when the admin picked one: by default every stuck item shows.
  const filters = usePageFilters();
  const [rawFor, setRawFor] = useState<WithdrawalTransaction | null>(null);

  const query = useQuery({
    queryKey: [...STUCK_KEY, provider, page, q, filters.apiParams],
    queryFn: () => fetcher(page, PAGE_SIZE, q || undefined, filters.apiParams),
    placeholderData: keepPreviousData,
  });
  const narrowed = !!q || filters.isFiltered;

  const rows = query.data?.data.withdrawals ?? [];
  const total = query.data?.data.pagination.total ?? 0;
  const totalPages = query.data?.data.pagination.totalPages ?? 1;
  const oldest = !narrowed && page === 1 ? rows[0]?.createdAt : undefined;

  const title = query.isLoading
    ? 'Chargement…'
    : query.isError && !query.data
      ? 'Liste indisponible'
      : narrowed && total === 0
      ? 'Aucun retrait bloqué pour ces filtres'
      : narrowed
      ? `${formatNumber(total)} retrait${total > 1 ? 's' : ''} bloqué${total > 1 ? 's' : ''}${q ? ` pour « ${q} »` : ' pour ces filtres'}`
      : total === 0
        ? 'Aucun retrait bloqué'
        : `${formatNumber(total)} retrait${total > 1 ? 's' : ''} bloqué${total > 1 ? 's' : ''} chez ${providerName}`;

  const columns: ListColumn<WithdrawalTransaction>[] = [
    { key: 'member', header: 'Membre', cell: tx => <MemberCell name={tx.userName} email={tx.userEmail} /> },
    { key: 'amount', header: 'Montant brut', numeric: true, cell: tx => <span className="font-medium">{formatMoney(tx.amount, tx.currency)}</span> },
    {
      key: 'momo', header: 'Bénéficiaire', cell: tx => {
        const a = tx.metadata?.accountInfo;
        return (
          <div className="min-w-0">
            <p className="font-mono text-sm text-fg">{a?.fullMomoNumber || '—'}</p>
            <p className="text-xs text-fg-muted">{[a?.momoOperator, a?.countryCode && getCountryName(a.countryCode)].filter(Boolean).join(' · ') || '—'}</p>
          </div>
        );
      },
    },
    {
      key: 'age', header: 'En attente', cell: tx => <AgeBadge date={tx.createdAt} />,
    },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true, cell: tx => actions.row(tx, false) },
  ];

  const card = (tx: WithdrawalTransaction) => {
    const a = tx.metadata?.accountInfo;
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <MemberCell name={tx.userName} email={tx.userEmail} />
          <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-fg">{formatMoney(tx.amount, tx.currency)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0">
            <span className="block font-mono text-fg">{a?.fullMomoNumber || '—'}</span>
            {a?.momoOperator && <span className="block text-xs text-fg-muted">{a.momoOperator}</span>}
          </span>
          <AgeBadge date={tx.createdAt} />
        </div>
        <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role="presentation">{actions.row(tx, true)}</div>
      </div>
    );
  };

  const tx = detailsOpen;
  const a = tx?.metadata?.accountInfo;

  return (
    <>
      <Panel>
        <PanelHeader
          title={<span className="text-base">{title}</span>}
          description={oldest ? `Les plus anciens en premier · le plus ancien attend depuis ${waitedFor(oldest)}.` : 'Les plus anciens en premier.'}
          actions={(
            <Button variant="outline" size="md" className="h-11 sm:h-9" onClick={() => void query.refetch()} loading={query.isFetching && !query.isLoading} aria-label="Actualiser la liste">
              {!(query.isFetching && !query.isLoading) && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
              <span className="hidden sm:inline">Actualiser</span>
            </Button>
          )}
        />
        <div className="space-y-3 px-5 pb-4">
          {checkFirst}
          {/* The filter row's own "Effacer les filtres" also clears the search: show one button at a time. */}
          <FilterBar active={!!input && !filters.isFiltered} onClear={clear}>
            <SearchInput
              value={input}
              onChange={setInput}
              label="Rechercher un retrait bloqué"
              placeholder="Nom, e-mail, téléphone, ID de transaction ou numéro MoMo"
            />
          </FilterBar>
        </div>
        <div className={query.isFetching && !query.isLoading ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={rows}
            columns={columns}
            rowKey={r => r.transactionId}
            card={card}
            onRowClick={r => onDetailsOpenChange(r)}
            loading={query.isLoading}
            className="border-t border-line"
            empty={query.isError ? (
              <ErrorState
                description={query.error instanceof Error ? query.error.message : undefined}
                onRetry={() => void query.refetch()}
                retrying={query.isFetching}
              />
            ) : narrowed ? (
              <EmptyState
                title={q ? `Aucun retrait bloqué ne correspond à « ${q} »` : 'Aucun retrait bloqué pour ces filtres'}
                description={q ? 'Vérifiez l’orthographe ou cherchez par ID de transaction.' : 'Essayez un autre pays ou une autre période.'}
                action={filters.isFiltered ? undefined : <Button size="lg" onClick={clearAll}>Effacer la recherche</Button>}
              />
            ) : (
              <EmptyState icon={CheckmarkCircle02Icon} title={`Rien à traiter chez ${providerName}`} description={emptyDescription} />
            )}
          />
        </div>
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </Panel>

      <Dialog open={!!tx} onOpenChange={open => { if (!open) onDetailsOpenChange(null); }}>
        {tx && (
          <SheetContent
            width="lg"
            title={`Retrait de ${tx.userName || 'membre inconnu'}`}
            description={`${formatMoney(tx.amount, tx.currency)} · ${providerName} · demandé ${formatRelative(tx.createdAt)}`}
            footer={actions.sheet(tx)}
          >
            <dl className="divide-y divide-line">
              <DetailRow label="Statut"><Badge tone={statusTone(tx.status)}>{withdrawalStatusLabel(tx.status)}</Badge></DetailRow>
              <DetailRow label="Membre">{tx.userName || '—'}</DetailRow>
              <DetailRow label="E-mail">{tx.userEmail || '—'}</DetailRow>
              <DetailRow label="Téléphone du compte">{tx.userPhoneNumber || '—'}</DetailRow>
              <DetailRow label="Montant brut (débité si payé)"><span className="font-medium tabular-nums">{formatMoney(tx.amount, tx.currency)}</span></DetailRow>
              <DetailRow label="Net demandé par le membre"><span className="tabular-nums">{formatMoney(tx.metadata?.netAmountRequested, tx.metadata?.payoutCurrency || tx.currency)}</span></DetailRow>
              <DetailRow label="Frais SBC"><span className="tabular-nums">{formatMoney(tx.fee, tx.currency)}</span></DetailRow>
              <DetailRow label="Numéro MoMo du bénéficiaire"><CopyValue value={a?.fullMomoNumber} label="Copier le numéro" /></DetailRow>
              <DetailRow label="Opérateur">{a?.momoOperator || '—'}</DetailRow>
              <DetailRow label="Pays">{a?.countryCode ? `${getCountryName(a.countryCode)} (${a.countryCode})` : '—'}</DetailRow>
              <DetailRow label={refLabel}><CopyValue value={providerRef(tx)} label={`Copier ${refLabel}`} /></DetailRow>
              <DetailRow label="ID de transaction"><CopyValue value={tx.transactionId} label="Copier l’ID" /></DetailRow>
              <DetailRow label="Demandé le">{fullDate(tx.createdAt)}</DetailRow>
              <DetailRow label="Dernière mise à jour">{fullDate(tx.updatedAt)}</DetailRow>
              {tx.metadata?.statusDetails && <DetailRow label="Détail du statut">{tx.metadata.statusDetails}</DetailRow>}
              {tx.description && <DetailRow label="Description">{tx.description}</DetailRow>}
            </dl>
            <Button variant="ghost" size="md" className="mt-3 h-11 sm:h-9" onClick={() => setRawFor(tx)}>
              <HugeiconsIcon icon={SourceCodeIcon} size={16} aria-hidden="true" />
              Voir les données brutes
            </Button>
            {/* Inside the sheet so Radix treats it as a nested dialog */}
            <MetadataViewerModal isOpen={!!rawFor} onClose={() => setRawFor(null)} metadata={rawFor?.metadata ?? null} title="Données brutes du retrait" />
          </SheetContent>
        )}
      </Dialog>
    </>
  );
}
