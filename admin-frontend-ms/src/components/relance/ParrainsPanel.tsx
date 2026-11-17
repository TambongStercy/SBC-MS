import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { MoreHorizontalIcon, SmartPhone01Icon, Target02Icon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { adminUpdateUserConfig, getAdminParrains, type AdminFilterParams, type RelanceParrain } from '../../services/adminRelanceApi';
import { Can } from '../Can';
import {
    Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger,
    Pagination, Panel, PanelHeader, ResponsiveList, Segmented, type ListColumn,
} from '../ui';
import { ErrorState } from '../display/ErrorState';
import { apiError, fmtInt } from '../display/format';

const PAGE_SIZE = 20;

function State({ p }: { p: RelanceParrain }) {
    if (!p.enabled) return <Badge tone="neutral">Relance coupée</Badge>;
    if (p.sendingPaused) return <Badge tone="warning">Envoi en pause</Badge>;
    return <Badge tone="success">Active</Badge>;
}

/**
 * Parrains' relance accounts (GET /relance/admin/parrains): who has credits,
 * how many filleuls each has in a journey, and their SMS switch, for support.
 */
export function ParrainsPanel({ filters, page, onPageChange }: {
    filters: AdminFilterParams;
    page: number;
    onPageChange: (page: number) => void;
}) {
    const queryClient = useQueryClient();
    const [withCredits, setWithCredits] = useState<'yes' | 'all'>('yes');
    const [smsTarget, setSmsTarget] = useState<RelanceParrain | null>(null);

    const query = useQuery({
        queryKey: ['relance-parrains', filters, withCredits, page],
        queryFn: () => getAdminParrains({ ...filters, page, limit: PAGE_SIZE, withCredits: withCredits === 'yes' }),
        placeholderData: keepPreviousData,
    });

    const toggleSms = useMutation({
        mutationFn: (p: RelanceParrain) => adminUpdateUserConfig(p.userId, { smsEnabled: !p.smsEnabled }),
        onSuccess: (_, p) => {
            toast.success(p.smsEnabled ? 'SMS désactivé pour ce parrain.' : 'SMS activé pour ce parrain.');
            setSmsTarget(null);
            void queryClient.invalidateQueries({ queryKey: ['relance-parrains'] });
        },
        onError: error => toast.error(apiError(error, 'Le réglage SMS n’a pas pu être changé.')),
    });

    const rows = query.data?.parrains ?? [];
    const name = (p: RelanceParrain) => p.user?.name || 'Membre introuvable';

    const actions = (p: RelanceParrain) => (
        <Menu>
            <MenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label={`Actions pour ${name(p)}`} onClick={e => e.stopPropagation()}>
                    <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden="true" />
                </Button>
            </MenuTrigger>
            <MenuContent>
                <MenuItem asChild>
                    <Link to={`/relance/campaigns?membre=${p.userId}`}>
                        <HugeiconsIcon icon={Target02Icon} size={16} aria-hidden="true" />
                        Voir ses campagnes
                    </Link>
                </MenuItem>
                <Can module="relance" write>
                    <MenuItem onSelect={() => setSmsTarget(p)}>
                        <HugeiconsIcon icon={SmartPhone01Icon} size={16} aria-hidden="true" />
                        {p.smsEnabled ? 'Désactiver le SMS' : 'Activer le SMS'}
                    </MenuItem>
                </Can>
            </MenuContent>
        </Menu>
    );

    const columns: ListColumn<RelanceParrain>[] = [
        {
            key: 'who', header: 'Parrain', cell: p => (
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{name(p)}</p>
                    <p className="truncate text-xs text-fg-muted">{p.user?.phoneNumber || p.user?.email || p.userId}</p>
                </div>
            ),
        },
        {
            key: 'credits', header: 'Crédits', numeric: true, cell: p => (
                <span className="tabular-nums">
                    {fmtInt(p.emailBalance)} e-mails{p.smsEnabled && <span className="text-fg-muted"> · {fmtInt(p.smsBalance)} SMS</span>}
                </span>
            ),
        },
        {
            key: 'loop', header: 'Filleuls en cours', numeric: true, cell: p => (
                <span className="tabular-nums">
                    {fmtInt(p.inLoop.nouveaux)} <span className="text-fg-muted">nouveaux</span> · {fmtInt(p.inLoop.campaigns)} <span className="text-fg-muted">campagnes</span>
                </span>
            ),
        },
        { key: 'today', header: 'Envoyés aujourd’hui', numeric: true, cell: p => fmtInt(p.emailsSentToday) },
        { key: 'state', header: 'État', cell: p => <State p={p} /> },
        { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', hideOnCard: true, cell: actions },
    ];

    const card = (p: RelanceParrain) => (
        <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-fg">{name(p)}</p>
                    <State p={p} />
                </div>
                <p className="text-sm text-fg-muted tabular-nums">
                    {fmtInt(p.emailBalance)} e-mails{p.smsEnabled ? ` · ${fmtInt(p.smsBalance)} SMS` : ''} · {fmtInt(p.inLoop.nouveaux + p.inLoop.campaigns)} filleuls en cours
                </p>
            </div>
            {actions(p)}
        </div>
    );

    return (
        <Panel>
            <PanelHeader
                title="Parrains"
                description={query.data ? `${fmtInt(query.data.total)} parrain${query.data.total > 1 ? 's' : ''} · inscrits à la relance sur la période` : 'Crédits et filleuls en cours, par parrain'}
                actions={(
                    <Segmented
                        size="sm"
                        label="Parrains affichés"
                        value={withCredits}
                        onValueChange={v => { setWithCredits(v); onPageChange(1); }}
                        options={[{ value: 'yes', label: 'Avec crédits' }, { value: 'all', label: 'Tous' }]}
                    />
                )}
            />
            <div className={query.isFetching && !query.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                <ResponsiveList
                    rows={rows}
                    columns={columns}
                    card={card}
                    rowKey={p => p.userId}
                    loading={query.isLoading}
                    empty={query.isError ? (
                        <ErrorState message={apiError(query.error, 'La liste des parrains n’a pas pu être chargée.')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
                    ) : (
                        <EmptyState
                            icon={UserGroupIcon}
                            title={withCredits === 'yes' ? 'Aucun parrain avec des crédits' : 'Aucun parrain'}
                            description="Changez de pays ou de période, ou affichez tous les parrains."
                        />
                    )}
                />
            </div>
            {query.data && (
                <Pagination page={page} totalPages={query.data.totalPages} total={query.data.total} pageSize={PAGE_SIZE} onPageChange={onPageChange} />
            )}

            <Dialog open={!!smsTarget} onOpenChange={o => { if (!o && !toggleSms.isPending) setSmsTarget(null); }}>
                {smsTarget && (
                    <DialogContent
                        size="sm"
                        title={smsTarget.smsEnabled ? 'Désactiver le SMS ?' : 'Activer le SMS ?'}
                        description={`Pour ${name(smsTarget)}.`}
                        footer={(
                            <>
                                <DialogClose asChild><Button size="lg" disabled={toggleSms.isPending}>Annuler</Button></DialogClose>
                                <Button variant="primary" size="lg" loading={toggleSms.isPending} onClick={() => toggleSms.mutate(smsTarget)}>
                                    {smsTarget.smsEnabled ? 'Désactiver' : 'Activer'}
                                </Button>
                            </>
                        )}
                    >
                        <p className="text-sm text-fg-muted">
                            La relance par SMS est réservée aux parrains du Cameroun et ne part que vers des numéros +237.
                            {smsTarget.smsEnabled ? ' Ses crédits SMS restent sur son compte.' : ''}
                        </p>
                    </DialogContent>
                )}
            </Dialog>
        </Panel>
    );
}
