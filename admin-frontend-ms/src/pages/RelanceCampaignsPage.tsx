import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Cancel01Icon, FilterIcon, MoreHorizontalIcon, PauseIcon, PlayIcon, RefreshIcon, SentIcon, Target02Icon, UserGroupIcon, ViewIcon,
} from '@hugeicons/core-free-icons';
import {
    cancelCampaign, getAllCampaigns, getCampaignStats, pauseCampaign, resumeCampaign, type Campaign,
} from '../services/adminRelanceApi';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { Can } from '../components/Can';
import {
    Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger,
    Metric, PageHeader, Pagination, Panel, ResponsiveList, Select, SheetContent, Skeleton, Textarea, type ListColumn,
} from '../components/ui';
import { ErrorState } from '../components/display/ErrorState';
import { RelativeDate } from '../components/display/RelativeDate';
import { apiError, fmtInt, fmtPct } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';
import { CAMPAIGN_STATUS, CampaignStatusBadge, ChannelLabel, TYPE_LABELS } from '../components/relance/labels';
import { CampaignSheet } from '../components/relance/CampaignSheet';
import { campaignDeliveryRate } from '../components/relance/rates';

const PAGE_SIZE = 20;
const URL_DEFAULTS = { statut: 'all', type: 'all', canal: 'all', membre: '', page: '1' };

const STATUS_OPTIONS = [{ value: 'all', label: 'Tous les statuts' }, ...Object.entries(CAMPAIGN_STATUS).filter(([k]) => k !== 'failed').map(([value, s]) => ({ value, label: s.label }))];
const TYPE_OPTIONS = [{ value: 'all', label: 'Tous les types' }, { value: 'default', label: TYPE_LABELS.default }, { value: 'filtered', label: TYPE_LABELS.filtered }];
const CHANNEL_OPTIONS = [{ value: 'all', label: 'Tous les canaux' }, { value: 'email', label: 'E-mail' }, { value: 'sms', label: 'SMS' }, { value: 'both', label: 'E-mail + SMS' }];

const deliveryRate = campaignDeliveryRate;

/**
 * Campagnes de relance: every parrain's campaigns (a parrain pushes his
 * older filleuls through the 7-day journey). Pause, resume and cancel act on
 * the owner's campaign; details, filleuls and sent messages open on the side.
 */
export default function RelanceCampaignsPage() {
    const queryClient = useQueryClient();
    const filters = usePageFilters();
    const url = useUrlParams(URL_DEFAULTS);
    const page = Math.max(1, Number(url.get('page')) || 1);
    const statut = url.get('statut');
    const type = url.get('type');
    const canal = url.get('canal');
    const membre = url.get('membre');
    const [membreDraft, setMembreDraft] = useState(membre);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [open, setOpen] = useState<Campaign | null>(null);
    const [cancelling, setCancelling] = useState<Campaign | null>(null);
    const [reason, setReason] = useState('');

    const listParams = {
        ...filters.apiParams,
        page, limit: PAGE_SIZE,
        ...(statut !== 'all' ? { status: statut } : {}),
        ...(type !== 'all' ? { type: type as 'default' | 'filtered' } : {}),
        // API: channel is not filtered by the server yet (sent anyway).
        ...(canal !== 'all' ? { channel: canal } : {}),
        ...(membre ? { userId: membre } : {}),
    };
    const list = useQuery({ queryKey: ['relance-campaigns', listParams], queryFn: () => getAllCampaigns(listParams), placeholderData: keepPreviousData });
    const stats = useQuery({ queryKey: ['relance-campaign-stats-all', filters.apiParams], queryFn: () => getCampaignStats(filters.apiParams), placeholderData: keepPreviousData });
    // Queue: paused campaigns, whatever the period (country only).
    const queueParams = { ...(filters.country ? { country: filters.country } : {}), status: 'paused', limit: 1 };
    const pausedQueue = useQuery({ queryKey: ['relance-campaigns-paused', queueParams], queryFn: () => getAllCampaigns(queueParams) });

    const replace = (c: Campaign) => {
        void queryClient.invalidateQueries({ queryKey: ['relance-campaigns'] });
        void queryClient.invalidateQueries({ queryKey: ['relance-campaigns-paused'] });
        void queryClient.invalidateQueries({ queryKey: ['relance-campaign-stats-all'] });
        setOpen(prev => (prev && prev._id === c._id ? { ...prev, ...c, owner: prev.owner } : prev));
    };
    const pause = useMutation({
        mutationFn: (c: Campaign) => pauseCampaign(c._id, c.userId),
        onSuccess: c => { toast.success('Campagne mise en pause : plus aucun envoi jusqu’à la reprise.'); replace(c); },
        onError: e => toast.error(apiError(e, 'La campagne n’a pas pu être mise en pause.')),
    });
    const resume = useMutation({
        mutationFn: (c: Campaign) => resumeCampaign(c._id, c.userId),
        onSuccess: c => { toast.success('Campagne reprise.'); replace(c); },
        onError: e => toast.error(apiError(e, 'La campagne n’a pas pu reprendre.')),
    });
    const cancel = useMutation({
        mutationFn: ({ c, why }: { c: Campaign; why: string }) => cancelCampaign(c._id, c.userId, why.trim() || undefined),
        onSuccess: c => { toast.success('Campagne annulée.'); setCancelling(null); setReason(''); replace(c); },
        onError: e => toast.error(apiError(e, 'La campagne n’a pas pu être annulée.')),
    });
    const busy = pause.isPending || resume.isPending || cancel.isPending;

    const startCancel = (c: Campaign) => { setReason(''); setCancelling(c); };
    const clearOwn = () => { url.set({ statut: 'all', type: 'all', canal: 'all', membre: '' }); setMembreDraft(''); };
    const ownCount = [statut !== 'all', type !== 'all', canal !== 'all', !!membre].filter(Boolean).length;
    const anyFilter = filters.isFiltered || ownCount > 0;

    const rowMenu = (c: Campaign) => {
        const canCancel = c.status === 'active' || c.status === 'paused' || c.status === 'scheduled';
        return (
            <Menu>
                <MenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label={`Actions pour ${c.name}`} onClick={e => e.stopPropagation()}>
                        <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden="true" />
                    </Button>
                </MenuTrigger>
                <MenuContent onClick={e => e.stopPropagation()}>
                    <MenuItem onSelect={() => setOpen(c)}>
                        <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />
                        Détails, filleuls et messages
                    </MenuItem>
                    <MenuItem onSelect={() => { url.set({ membre: c.userId }); setMembreDraft(c.userId); }}>
                        <HugeiconsIcon icon={UserGroupIcon} size={16} aria-hidden="true" />
                        Campagnes de ce parrain
                    </MenuItem>
                    <Can module="relance" write>
                        {(c.status === 'active' || c.status === 'paused' || canCancel) && <MenuSeparator />}
                        {c.status === 'active' && (
                            <MenuItem onSelect={() => pause.mutate(c)} disabled={busy}>
                                <HugeiconsIcon icon={PauseIcon} size={16} aria-hidden="true" />
                                Mettre en pause
                            </MenuItem>
                        )}
                        {c.status === 'paused' && (
                            <MenuItem onSelect={() => resume.mutate(c)} disabled={busy}>
                                <HugeiconsIcon icon={PlayIcon} size={16} aria-hidden="true" />
                                Reprendre
                            </MenuItem>
                        )}
                        {canCancel && (
                            <MenuItem destructive onSelect={() => startCancel(c)}>
                                <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
                                Annuler la campagne
                            </MenuItem>
                        )}
                    </Can>
                </MenuContent>
            </Menu>
        );
    };

    const progress = (c: Campaign) => {
        const rate = deliveryRate(c);
        return (
            <div className="text-right">
                <p className="tabular-nums text-fg">{fmtInt(c.messagesSent)} envoyés</p>
                <p className="text-xs text-fg-muted tabular-nums">{rate === null ? 'Aucun envoi' : `${fmtPct(rate)} remis`}</p>
            </div>
        );
    };

    const columns: ListColumn<Campaign>[] = [
        {
            key: 'name', header: 'Campagne', cell: c => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{c.name}</p>
                    <p className="truncate text-xs text-fg-muted">{c.owner?.name ?? c.userId} · {TYPE_LABELS[c.type] ?? c.type}</p>
                </div>
            ),
        },
        { key: 'status', header: 'Statut', cell: c => <CampaignStatusBadge status={c.status} /> },
        { key: 'channel', header: 'Canal', cell: c => <ChannelLabel channel={c.channel} /> },
        { key: 'enrolled', header: 'Filleuls', numeric: true, cell: c => fmtInt(c.targetsEnrolled) },
        { key: 'sent', header: 'Envois', numeric: true, cell: progress },
        { key: 'created', header: 'Créée', cell: c => <RelativeDate value={c.createdAt} className="text-sm text-fg-muted" /> },
        { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', hideOnCard: true, cell: rowMenu },
    ];

    const card = (c: Campaign) => {
        const rate = deliveryRate(c);
        return (
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate text-sm font-medium text-fg">{c.name}</p>
                    <p className="truncate text-xs text-fg-muted">{c.owner?.name ?? c.userId}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <CampaignStatusBadge status={c.status} />
                        <ChannelLabel channel={c.channel} />
                    </div>
                    <p className="text-xs text-fg-muted tabular-nums">
                        {fmtInt(c.targetsEnrolled)} filleuls · {fmtInt(c.messagesSent)} envois{rate !== null ? ` · ${fmtPct(rate)} remis` : ''} · <RelativeDate value={c.createdAt} />
                    </p>
                </div>
                {rowMenu(c)}
            </div>
        );
    };

    const ownFilters = (stack: boolean) => (
        <>
            <Field label="Statut">
                <Select value={statut} onValueChange={v => url.set({ statut: v })} options={STATUS_OPTIONS} className={stack ? 'h-11' : 'h-9 sm:w-44'} />
            </Field>
            <Field label="Type">
                <Select value={type} onValueChange={v => url.set({ type: v })} options={TYPE_OPTIONS} className={stack ? 'h-11' : 'h-9 sm:w-48'} />
            </Field>
            <Field label="Canal" help={stack ? 'Le serveur ne filtre pas encore par canal.' : undefined}>
                <Select value={canal} onValueChange={v => url.set({ canal: v })} options={CHANNEL_OPTIONS} className={stack ? 'h-11' : 'h-9 sm:w-40'} />
            </Field>
            <Field label="Identifiant du parrain">
                <Input
                    value={membreDraft}
                    onChange={e => setMembreDraft(e.target.value)}
                    onBlur={() => url.set({ membre: membreDraft.trim() })}
                    onKeyDown={e => { if (e.key === 'Enter') url.set({ membre: membreDraft.trim() }); }}
                    placeholder="ID du membre"
                    className={stack ? 'h-11' : 'h-9 sm:w-56'}
                    inputMode="text"
                />
            </Field>
        </>
    );

    const s = stats.data;
    const paused = pausedQueue.data?.total ?? 0;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Campagnes de relance"
                description="Les campagnes lancées par les parrains vers leurs anciens filleuls : suivre, mettre en pause, reprendre ou annuler."
                actions={(
                    <Button size="lg" className="w-full sm:w-auto" onClick={() => void queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('relance-campaign') })} loading={list.isFetching && !list.isLoading}>
                        {!(list.isFetching && !list.isLoading) && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
                        Actualiser
                    </Button>
                )}
            />

            <div>
                <PageFilters filters={filters} onReset={clearOwn} className="mb-0">
                    <div className="hidden items-end gap-2 md:flex [&_label]:sr-only">{ownFilters(false)}</div>
                    <Button size="lg" className="w-full md:hidden" onClick={() => setFiltersOpen(true)}>
                        <HugeiconsIcon icon={FilterIcon} size={16} aria-hidden="true" />
                        Filtres{ownCount ? ` (${ownCount})` : ''}
                    </Button>
                    {!filters.isFiltered && ownCount > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearOwn} className="self-start sm:self-auto">
                            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
                            Effacer les filtres
                        </Button>
                    )}
                </PageFilters>
            </div>

            {paused > 0 && statut !== 'paused' && (
                <Panel className="border-warning/40 bg-warning-soft/40" role="status">
                    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div>
                            <p className="text-sm font-medium text-fg">À traiter : {fmtInt(paused)} campagne{paused > 1 ? 's' : ''} en pause</p>
                            <p className="mt-0.5 text-sm text-fg-muted">Rien ne part tant qu’elles ne sont pas reprises ou annulées (toutes périodes confondues).</p>
                        </div>
                        <Button size="lg" onClick={() => url.set({ statut: 'paused' })}>Voir les campagnes en pause</Button>
                    </div>
                </Panel>
            )}

            <div className={`grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4 ${stats.isFetching && !stats.isLoading ? 'opacity-60 transition-opacity' : ''}`}>
                <Metric label="Campagnes" icon={Target02Icon} value={s ? fmtInt(s.totalCampaigns) : <Skeleton className="h-8 w-14" />} hint={s ? `${fmtInt(s.completedCampaigns)} terminées` : undefined} />
                <Metric label="En cours" icon={PlayIcon} tone="success" value={s ? fmtInt(s.activeCampaigns) : <Skeleton className="h-8 w-14" />} />
                <Metric label="Filleuls inscrits" icon={UserGroupIcon} value={s ? fmtInt(s.totalTargetsEnrolled) : <Skeleton className="h-8 w-14" />} />
                {/* The API's averageSuccessRate ignores failed sends (always ~100 %): the per-row rate counts them. */}
                <Metric label="Messages envoyés" icon={SentIcon} value={s ? fmtInt(s.totalMessagesSent) : <Skeleton className="h-8 w-14" />} hint="Taux de remise par campagne dans la liste" />
            </div>


            <Panel className={list.isFetching && !list.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                <ResponsiveList
                    rows={list.data?.campaigns ?? []}
                    columns={columns}
                    card={card}
                    rowKey={c => c._id}
                    onRowClick={c => setOpen(c)}
                    loading={list.isLoading}
                    empty={list.isError ? (
                        <ErrorState message={apiError(list.error, 'Les campagnes n’ont pas pu être chargées.')} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                    ) : (
                        <EmptyState
                            icon={Target02Icon}
                            title={anyFilter ? 'Aucune campagne ne correspond' : 'Aucune campagne'}
                            description={anyFilter ? 'Élargissez la période ou effacez les filtres.' : 'Les campagnes apparaissent ici dès qu’un parrain en lance une.'}
                            action={anyFilter ? <Button size="lg" onClick={() => { filters.reset(); clearOwn(); }}>Effacer les filtres</Button> : undefined}
                        />
                    )}
                />
                {list.data && (
                    <Pagination page={page} totalPages={list.data.totalPages} total={list.data.total} pageSize={PAGE_SIZE} onPageChange={p => url.set({ page: String(p) })} />
                )}
            </Panel>

            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
                <SheetContent
                    title="Filtres"
                    footer={(
                        <>
                            <Button size="lg" onClick={clearOwn}>Effacer</Button>
                            <Button variant="primary" size="lg" onClick={() => { url.set({ membre: membreDraft.trim() }); setFiltersOpen(false); }}>Afficher</Button>
                        </>
                    )}
                >
                    <div className="space-y-4">{ownFilters(true)}</div>
                </SheetContent>
            </Dialog>

            <Dialog open={!!open} onOpenChange={o => { if (!o) setOpen(null); }}>
                {open && (
                    <CampaignSheet
                        campaign={open}
                        busy={busy}
                        onPause={c => pause.mutate(c)}
                        onResume={c => resume.mutate(c)}
                        onCancel={startCancel}
                    />
                )}
            </Dialog>

            <Dialog open={!!cancelling} onOpenChange={o => { if (!o && !cancel.isPending) setCancelling(null); }}>
                {cancelling && (
                    <DialogContent
                        size="sm"
                        title="Annuler la campagne ?"
                        description={`« ${cancelling.name} » s’arrête pour de bon : tous ses filleuls encore en cours sortent de la boucle. Ça ne se reprend pas.`}
                        footer={(
                            <>
                                <DialogClose asChild><Button size="lg" disabled={cancel.isPending}>Garder la campagne</Button></DialogClose>
                                <Button variant="danger" size="lg" loading={cancel.isPending} onClick={() => cancel.mutate({ c: cancelling, why: reason })}>Annuler la campagne</Button>
                            </>
                        )}
                    >
                        <Field label="Motif (facultatif)" help="Visible dans le détail de la campagne.">
                            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Pourquoi cette campagne est annulée" />
                        </Field>
                    </DialogContent>
                )}
            </Dialog>
        </div>
    );
}
