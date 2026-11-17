import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, UserSearch01Icon, Wrench01Icon } from '@hugeicons/core-free-icons';
import { reprocessFeexpayPaymentsForUser, searchUsersForFeexPayFix, ReprocessFeexpayResult } from '../services/adminPaymentApi';
import { AdminUserData } from '../services/adminUserApi';
import { getAvatarUrl } from '../api/apiClient';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PaymentsFilterRow } from '../components/payments/PaymentsFilterRow';
import {
    Avatar, Badge, Button, EmptyState, PageHeader, Panel, PanelHeader, ResponsiveList, type ListColumn,
} from '../components/ui';
import { ErrorState, FilterBar } from '../components/common/DataStates';
import { CheckFirst, CopyValue, SearchInput } from '../components/payments/shared';
import { useUrlSearchAndPage } from '../components/payments/useUrlSearchAndPage';

/** Payment intent statuses FeexPay correction can report. */
const RESULT_STATUS_LABELS: Record<string, string> = {
    SUCCEEDED: 'Réussi',
    FAILED: 'Échoué',
    PENDING: 'En attente',
    PROCESSING: 'En cours',
    PENDING_PROVIDER: 'En attente du fournisseur',
    PENDING_USER_INPUT: 'En attente du membre',
    ERROR: 'Erreur',
    CANCELED: 'Annulé',
    EXPIRED: 'Expiré',
};
const RESULT_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
    SUCCEEDED: 'success', FAILED: 'danger', ERROR: 'danger', CANCELED: 'neutral', EXPIRED: 'neutral',
};

/** The service answers in English: say it in French, keep unknown text as is. */
function resultMessage(message: string): string {
    const ok = /^Reprocessing successful\. New status: (\w+)\.?$/.exec(message);
    if (ok) return `Statut redemandé à FeexPay : ${RESULT_STATUS_LABELS[ok[1]] ?? ok[1]}.`;
    const ko = /^Reprocessing failed: (.*?)\.?$/.exec(message);
    if (ko) return `FeexPay n’a pas pu être interrogé : ${ko[1]}.`;
    return message;
}

interface FixFeexpayPaymentsPageProps {
    embedded?: boolean; // Suppress the page header when rendered inside the unified /fix-provider-issues page.
}

/**
 * A member says they paid by FeexPay and nothing happened: find them, then ask
 * FeexPay again for every pending / processing / error payment they have. Only
 * what FeexPay confirms is applied (server side, it stops at the first success).
 */
function FixFeexpayPaymentsPage({ embedded = false }: FixFeexpayPaymentsPageProps = {}) {
    const { input, setInput, q, clear } = useUrlSearchAndPage();
    const [reprocessingUserId, setReprocessingUserId] = useState<string | null>(null);
    const [reprocessingResults, setReprocessingResults] = useState<Record<string, { name: string; results: ReprocessFeexpayResult[] }>>({});

    // Country narrows the member search; a period means nothing here.
    const filters = usePageFilters();
    const usersQuery = useQuery({
        queryKey: ['payments-feexpay-member-search', q, filters.country],
        queryFn: () => searchUsersForFeexPayFix(q, filters.country || undefined),
        enabled: q !== '',
    });

    useEffect(() => {
        if (usersQuery.isError) toast.error('La recherche de membres a échoué.');
    }, [usersQuery.isError]);

    const handleReprocessPayments = async (user: AdminUserData) => {
        const userId = user._id;
        if (reprocessingUserId) return; // one correction at a time
        setReprocessingUserId(userId);
        setReprocessingResults(prev => ({ ...prev, [userId]: { name: user.name, results: [] } }));
        const toastId = toast.loading('Correction des paiements en cours… Cela peut prendre jusqu\'à 5 minutes.', { duration: 300000 });
        try {
            const results = await reprocessFeexpayPaymentsForUser(userId);
            setReprocessingResults(prev => ({ ...prev, [userId]: { name: user.name, results } }));
            toast.success('Correction lancée. Consultez les résultats.', { id: toastId });
        } catch (error) {
            console.error('Error during reprocessing:', error);
            toast.error('Impossible de lancer la correction.', { id: toastId });
            setReprocessingResults(prev => ({ ...prev, [userId]: { name: user.name, results: [{ sessionId: '', status: '', message: 'Le retraitement a échoué.' }] } }));
        } finally {
            setReprocessingUserId(null);
            toast.dismiss(toastId);
        }
    };

    const users = q ? usersQuery.data ?? [] : [];

    const actionButton = (u: AdminUserData, phone: boolean) => {
        const busy = reprocessingUserId === u._id;
        return (
            <Can module="payments" write fallback={phone ? null : <span className="text-xs text-fg-subtle">Lecture seule</span>}>
                <Button
                    variant="soft"
                    size={phone ? 'lg' : 'sm'}
                    className={phone ? 'w-full' : undefined}
                    loading={busy}
                    disabled={!!reprocessingUserId && !busy}
                    onClick={e => { e.stopPropagation(); void handleReprocessPayments(u); }}
                >
                    {!busy && <HugeiconsIcon icon={Wrench01Icon} size={16} aria-hidden="true" />}
                    {busy ? 'Correction…' : 'Corriger ses paiements FeexPay'}
                </Button>
            </Can>
        );
    };

    const identity = (u: AdminUserData) => (
        <div className="flex min-w-0 items-center gap-3">
            <Avatar src={getAvatarUrl(u.avatar)} name={u.name || '?'} size="sm" />
            <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{u.name || 'Sans nom'}</p>
                <p className="truncate text-xs text-fg-muted">{u.email || '—'}</p>
            </div>
        </div>
    );

    const columns: ListColumn<AdminUserData>[] = [
        { key: 'member', header: 'Membre', cell: identity },
        { key: 'phone', header: 'Téléphone', cell: u => <span className="font-mono text-sm">{u.phoneNumber || '—'}</span> },
        { key: 'action', header: <span className="sr-only">Action</span>, className: 'text-right', hideOnCard: true, cell: u => actionButton(u, false) },
    ];

    const resultEntries = Object.entries(reprocessingResults).reverse();

    return (
        <div className="flex flex-col gap-6">
            {!embedded && (
                <PageHeader
                    className="mb-0"
                    title="Paiements FeexPay à corriger"
                    description="Un membre a payé par FeexPay mais rien ne s’est passé : retrouvez-le et redemandez à FeexPay le statut de ses paiements."
                />
            )}
            {!embedded && <PaymentsFilterRow filters={filters} hidePeriod />}

            {resultEntries.length > 0 && (
                <Panel>
                    <PanelHeader
                        title="Résultats des corrections"
                        description="Ce que FeexPay a répondu, membre par membre (le plus récent en haut)."
                        actions={(
                            <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setReprocessingResults({})} disabled={!!reprocessingUserId}>
                                <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
                                Effacer
                            </Button>
                        )}
                    />
                    <div className="space-y-4 px-5 pb-4">
                        {resultEntries.map(([userId, { name, results }]) => (
                            <div key={userId} className="rounded-control border border-line">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                                    <p className="text-sm font-medium text-fg">{name || 'Membre'}</p>
                                    <CopyValue value={userId} label="Copier l’ID du membre" />
                                </div>
                                {reprocessingUserId === userId ? (
                                    <p className="px-4 py-3 text-sm text-fg-muted">Correction en cours… (jusqu’à 5 minutes)</p>
                                ) : results.length === 0 ? (
                                    <p className="px-4 py-3 text-sm text-fg-muted">Aucun paiement FeexPay en attente pour ce membre : rien à corriger.</p>
                                ) : (
                                    <ul className="divide-y divide-line">
                                        {results.map((r, i) => (
                                            <li key={`${r.sessionId}-${i}`} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                                <div className="min-w-0">
                                                    <p className="text-sm text-fg">{resultMessage(r.message)}</p>
                                                    {r.sessionId && <CopyValue value={r.sessionId} label="Copier l’ID de session" className="mt-0.5" />}
                                                </div>
                                                {r.status && <Badge tone={RESULT_TONE[r.status] ?? 'warning'} className="self-start sm:self-center">{RESULT_STATUS_LABELS[r.status] ?? r.status}</Badge>}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                </Panel>
            )}

            <Panel>
                <PanelHeader title="Rechercher le membre" description="Par nom, e-mail ou téléphone." />
                <div className="space-y-3 px-5 pb-4">
                    <FilterBar active={!!input && !filters.isFiltered} onClear={clear}>
                        <SearchInput value={input} onChange={setInput} label="Rechercher un membre" placeholder="Nom, e-mail ou téléphone" />
                    </FilterBar>
                    <CheckFirst>
                        <p>
                            La correction redemande à FeexPay le statut des paiements en attente du membre et n’applique que ce que FeexPay confirme.
                            Un paiement « en attente » est le plus souvent abandonné : le contrôle automatique le revérifie déjà toutes les 10 minutes.
                        </p>
                    </CheckFirst>
                </div>
                <ResponsiveList
                    rows={users}
                    columns={columns}
                    rowKey={u => u._id}
                    className="border-t border-line"
                    loading={q !== '' && usersQuery.isLoading}
                    card={u => (
                        <div className="space-y-3">
                            {identity(u)}
                            {u.phoneNumber && <p className="font-mono text-sm text-fg-muted">{u.phoneNumber}</p>}
                            {actionButton(u, true)}
                        </div>
                    )}
                    empty={!q ? (
                        <EmptyState icon={UserSearch01Icon} title="Commencez à taper pour rechercher un membre" description="Le membre qui dit avoir payé par FeexPay sans résultat." />
                    ) : usersQuery.isError ? (
                        <ErrorState title="La recherche a échoué" onRetry={() => void usersQuery.refetch()} retrying={usersQuery.isFetching} />
                    ) : (
                        <EmptyState title={`Aucun membre ne correspond à « ${q} »`} description="Essayez l’e-mail ou le numéro de téléphone." />
                    )}
                />
            </Panel>
        </div>
    );
}

export default FixFeexpayPaymentsPage;
