import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, CheckmarkCircle02Icon, Comment01Icon } from '@hugeicons/core-free-icons';
import { Can } from '../components/Can';
import { usePermission } from '../hooks/usePermission';
import {
    Badge, Button, EmptyState, MenuItem, MenuSeparator, Metric, PageHeader, Panel, PanelHeader, Pagination,
    ResponsiveList, Select, Skeleton, type ListColumn,
} from '../components/ui';
import { ConfirmDialog, ErrorState, RowMenu, type ConfirmOptions } from '../components/moduleKit';
import { RelativeDate } from '../components/display/RelativeDate';
import { fmtInt } from '../components/display/format';
import { PageFilters } from '../components/filters/PageFilters';
import { usePageFilters } from '../hooks/usePageFilters';
import { PopupComposer } from '../components/popups/PopupComposer';
import { describeTargeting, popupApi, type PopupAnnouncement, type PopupState } from '../components/popups/api';
import { useSearchParams } from 'react-router-dom';

const STATE: Record<PopupState, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
    live: { label: 'En ligne', tone: 'success' },
    scheduled: { label: 'Programmée', tone: 'info' },
    paused: { label: 'En pause', tone: 'warning' },
    expired: { label: 'Terminée (date de fin)', tone: 'neutral' },
    ended: { label: 'Terminée', tone: 'neutral' },
};

const STATUS_OPTIONS = [
    { value: 'all', label: 'Tous les statuts' },
    { value: 'active', label: 'Actives (en ligne ou programmées)' },
    { value: 'paused', label: 'En pause' },
    { value: 'ended', label: 'Terminées' },
];

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—');

/** "Vues 1 200 · Bouton 15 % · Fermées 80 %". Rates are out of the members who saw it. */
function Reach({ a }: { a: PopupAnnouncement }) {
    const { shown, clicked, closed } = a.stats;
    return (
        <div className="min-w-0 text-sm">
            <p className="tabular-nums text-fg">{fmtInt(shown)} vue{shown > 1 ? 's' : ''} <span className="text-fg-muted">sur {fmtInt(a.audience)}</span></p>
            <p className="text-xs text-fg-muted">
                {a.buttonUrl ? <>Bouton {pct(clicked, shown)} · </> : null}Fermée {pct(closed, shown)}
            </p>
        </div>
    );
}

/**
 * Annonces pop-up (module `notifications`): a window that opens in the member
 * app, for every member or those a targeting picks (country, age, sex,
 * subscription, interests, profession). Each member sees it once: closing it
 * or tapping its button ends it for them.
 * Server: notification-service /notifications/announcements/admin.
 */
export default function PopupAnnouncementsPage() {
    const queryClient = useQueryClient();
    const filters = usePageFilters();
    const canWrite = usePermission('notifications') === 'write';
    const [params, setParams] = useSearchParams();
    const status = params.get('statut') ?? 'all';
    const page = Math.max(Number(params.get('page')) || 1, 1);
    const [composer, setComposer] = useState<{ open: boolean; editing: PopupAnnouncement | null }>({ open: false, editing: null });
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

    const list = useQuery({
        queryKey: ['popups', 'list', filters.apiParams, status, page],
        queryFn: () => popupApi.list({ ...filters.apiParams, ...(status !== 'all' ? { status } : {}), page, limit: 20 }),
        placeholderData: keepPreviousData,
    });

    const setStatus = (v: string) => setParams(p => {
        const n = new URLSearchParams(p);
        if (v === 'all') n.delete('statut'); else n.set('statut', v);
        n.delete('page');
        return n;
    }, { replace: true });
    const setPage = (n: number) => setParams(p => { const x = new URLSearchParams(p); if (n > 1) x.set('page', String(n)); else x.delete('page'); return x; });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['popups'] });
    const changeStatus = async (a: PopupAnnouncement, next: 'active' | 'paused' | 'ended', done: string) => {
        await popupApi.update(a.id, { status: next });
        toast.success(done);
        void refresh();
    };

    const ask = {
        pause: (a: PopupAnnouncement) => setConfirm({
            title: 'Mettre en pause ?', tone: 'primary', confirmLabel: 'Mettre en pause',
            description: 'Plus personne ne la voit tant qu’elle est en pause. Vous pourrez la reprendre.',
            onConfirm: () => changeStatus(a, 'paused', 'Annonce en pause.'),
        }),
        resume: (a: PopupAnnouncement) => setConfirm({
            title: 'Reprendre la diffusion ?', tone: 'primary', confirmLabel: 'Reprendre',
            description: 'Les membres ciblés qui ne l’ont pas encore fermée la verront à leur prochaine ouverture de l’app.',
            onConfirm: () => changeStatus(a, 'active', 'Annonce reprise.'),
        }),
        end: (a: PopupAnnouncement) => setConfirm({
            title: 'Terminer l’annonce ?', tone: 'danger', confirmLabel: 'Terminer',
            description: 'Plus personne ne la verra. Ses chiffres restent consultables ici.',
            onConfirm: () => changeStatus(a, 'ended', 'Annonce terminée.'),
        }),
        remove: (a: PopupAnnouncement) => setConfirm({
            title: 'Supprimer l’annonce ?', tone: 'danger', confirmLabel: 'Supprimer',
            description: 'Elle disparaît avec ses chiffres, sans retour possible. Pour garder les chiffres, choisissez plutôt « Terminer ».',
            onConfirm: async () => { await popupApi.remove(a.id); toast.success('Annonce supprimée.'); void refresh(); },
        }),
    };

    const menu = (a: PopupAnnouncement) => canWrite && (
        <RowMenu>
            <MenuItem onSelect={() => setComposer({ open: true, editing: a })}>Modifier</MenuItem>
            {a.status === 'active' && <MenuItem onSelect={() => ask.pause(a)}>Mettre en pause</MenuItem>}
            {a.status === 'paused' && <MenuItem onSelect={() => ask.resume(a)}>Reprendre</MenuItem>}
            {a.status !== 'ended' && <MenuItem onSelect={() => ask.end(a)}>Terminer</MenuItem>}
            <MenuSeparator />
            <MenuItem destructive onSelect={() => ask.remove(a)}>Supprimer</MenuItem>
        </RowMenu>
    );

    const when = (a: PopupAnnouncement) => (
        <p className="text-xs text-fg-muted">
            {a.state === 'scheduled' ? <>Commence <RelativeDate value={a.startsAt} /></> : <>Depuis <RelativeDate value={a.startsAt} /></>}
            {a.endsAt ? <> · fin <RelativeDate value={a.endsAt} /></> : null}
        </p>
    );

    const columns: ListColumn<PopupAnnouncement>[] = [
        {
            key: 'msg', header: 'Annonce', className: 'max-w-0 w-[38%]',
            cell: a => (
                <div className="flex min-w-0 items-start gap-3">
                    {a.imageUrl && <img src={a.imageUrl} alt="" className="h-10 w-14 shrink-0 rounded-md border border-line object-cover" />}
                    <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{a.title}</p>
                        <p className="line-clamp-2 text-xs text-fg-muted">{a.message}</p>
                    </div>
                </div>
            ),
        },
        { key: 'to', header: 'Destinataires', cell: a => <p className="line-clamp-2 text-sm text-fg-muted">{describeTargeting(a.filter)}</p> },
        { key: 'reach', header: 'Résultats', cell: a => <Reach a={a} /> },
        {
            key: 'state', header: 'Statut',
            cell: a => <div className="space-y-1"><Badge tone={STATE[a.state].tone}>{STATE[a.state].label}</Badge>{when(a)}</div>,
        },
        { key: 'menu', header: <span className="sr-only">Actions</span>, className: 'w-12', cell: a => menu(a) },
    ];

    const card = (a: PopupAnnouncement) => (
        <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-medium text-fg">{a.title}</p>
                    <p className="line-clamp-2 text-sm text-fg-muted">{a.message}</p>
                </div>
                {menu(a)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATE[a.state].tone}>{STATE[a.state].label}</Badge>
                {when(a)}
            </div>
            <p className="text-xs text-fg-muted">{describeTargeting(a.filter)}</p>
            <Reach a={a} />
        </div>
    );

    const d = list.data;
    const totalPages = d ? Math.max(Math.ceil(d.total / d.limit), 1) : 1;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Annonces pop-up"
                description="Une fenêtre qui s’ouvre dans l’app des membres : à tous, ou ciblée par pays, âge, centres d’intérêt ou métier."
                actions={(
                    <Can module="notifications" write>
                        <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => setComposer({ open: true, editing: null })}>
                            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" /> Nouvelle annonce
                        </Button>
                    </Can>
                )}
            />

            <div className="grid grid-cols-2 gap-3">
                <Metric label="En ligne maintenant" value={list.isLoading ? <Skeleton className="h-7 w-12" /> : fmtInt(d?.live)} hint="Visibles à l’ouverture de l’app" icon={CheckmarkCircle02Icon} />
                <Metric label="Annonces" value={list.isLoading ? <Skeleton className="h-7 w-12" /> : fmtInt(d?.total)} hint={filters.isFiltered || status !== 'all' ? 'Pour ces filtres' : 'Depuis le début'} icon={Comment01Icon} />
            </div>

            <section className="space-y-3" aria-label="Annonces">
                <PageFilters filters={filters} resetKeys={['statut', 'page']}>
                    <Select className="h-11 md:h-9 sm:w-60" value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />
                </PageFilters>
                <p className="text-xs text-fg-muted">Le pays montre les annonces destinées à ce pays (ou à tous) ; la période porte sur la date de création.</p>
                <Panel className={list.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
                    <PanelHeader title="Annonces" description="La plus récente en premier. Une vue = un membre qui l’a vue (une fois par membre)." />
                    <ResponsiveList
                        rows={d?.items ?? []}
                        columns={columns}
                        rowKey={a => a.id}
                        card={card}
                        loading={list.isLoading}
                        empty={list.isError ? (
                            <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                        ) : filters.isFiltered || status !== 'all' ? (
                            <EmptyState icon={Comment01Icon} title="Aucune annonce pour ces filtres" description="Changez de pays, de période ou de statut." />
                        ) : (
                            <EmptyState
                                icon={Comment01Icon}
                                title="Aucune annonce pour le moment"
                                description="Créez la première : elle s’ouvrira dans l’app des membres que vous choisissez."
                            />
                        )}
                    />
                    {d && totalPages > 1 && (
                        <div className="border-t border-line px-4 py-3">
                            <Pagination page={page} totalPages={totalPages} total={d.total} pageSize={d.limit} onPageChange={setPage} />
                        </div>
                    )}
                </Panel>
            </section>

            <PopupComposer open={composer.open} editing={composer.editing} onClose={() => setComposer({ open: false, editing: null })} />
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}

