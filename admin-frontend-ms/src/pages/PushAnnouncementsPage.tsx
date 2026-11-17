import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Alert02Icon, ArrowRight01Icon, Megaphone02Icon, Moon02Icon, Notification03Icon, SentIcon, UserGroupIcon,
} from '@hugeicons/core-free-icons';
import apiClient from '../api/apiClient';
import { Can } from '../components/Can';
import {
    Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Metric, PageHeader, Panel, PanelBody,
    PanelHeader, ResponsiveList, Segmented, Select, Skeleton, Switch, Textarea, type ListColumn,
} from '../components/ui';
import { ErrorState } from '../components/display/ErrorState';
import { RelativeDate } from '../components/display/RelativeDate';
import { apiError, fmtInt } from '../components/display/format';
import { CountryPicker } from '../components/notifications/CountryPicker';
import { PageFilters } from '../components/filters/PageFilters';
import { usePageFilters } from '../hooks/usePageFilters';
import { countryName as pageCountryName } from '../lib/countries';
import {
    APP_PAGES, BODY_MAX, describeFilter, isNightInDouala, pageLabel, SEX_LABEL, SUBSCRIPTION_LABEL, TITLE_MAX,
    type Announcement, type PushFilter, type PushOverview,
} from '../components/notifications/pushShared';

const OVERVIEW_KEY = ['push', 'announcements'] as const;

const PAGE_OPTIONS = APP_PAGES.flatMap(g => g.pages.map(p => ({
    value: p.url,
    label: <span>{p.label} <span className="text-fg-subtle">· {g.group}</span></span>,
})));
const SUBSCRIPTION_OPTIONS = [
    { value: 'all', label: 'Tous' },
    { value: 'subscribed', label: SUBSCRIPTION_LABEL.subscribed },
    { value: 'unsubscribed', label: SUBSCRIPTION_LABEL.unsubscribed },
];
const SEX_OPTIONS = [
    { value: 'all', label: 'Tous' },
    { value: 'male', label: SEX_LABEL.male },
    { value: 'female', label: SEX_LABEL.female },
];

const membres = (n: number) => `${fmtInt(n)} membre${n > 1 ? 's' : ''}`;

/** What members see on their phone. */
function PushPreview({ title, body, url }: { title: string; body: string; url: string }) {
    return (
        <div className="flex items-start gap-3 rounded-panel border border-line bg-surface-2 p-3">
            {/* The icon members actually see on their phone. */}
            <img src="/sbc-app-icon.png" alt="" className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{title || 'Titre de l’annonce'}</p>
                <p className="line-clamp-3 text-sm text-fg-muted">{body || 'Le message apparaît ici.'}</p>
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    Découvrir <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" /> {pageLabel(url)}
                </p>
            </div>
        </div>
    );
}

/**
 * Annonces push (module `notifications`): a push to members who turned
 * notifications on — everyone, or those a filter picks. One to everyone per
 * 24 h (server-side): past that, people stop reading or switch "Annonces SBC"
 * off. Targeted ones are not limited. Sent at night (22:00–07:00 Douala) they
 * wait for 07:00 unless "send now" is ticked.
 * Server: notification-service /push/admin/{announcements,audience,announce}.
 */
export default function PushAnnouncementsPage() {
    const queryClient = useQueryClient();
    const filters = usePageFilters();
    // Unfiltered: what the composer relies on (audience to everyone, the 24 h cap).
    // The page's country/period filters only scope the history below: they must
    // never change who an announcement goes to (its own picker decides that).
    const overview = useQuery({
        queryKey: [...OVERVIEW_KEY, {}],
        queryFn: async () => (await apiClient.get('/notifications/push/admin/announcements')).data.data as PushOverview,
    });
    const history = useQuery({
        queryKey: [...OVERVIEW_KEY, filters.apiParams],
        queryFn: async () => (await apiClient.get('/notifications/push/admin/announcements', { params: filters.apiParams })).data.data as PushOverview,
        placeholderData: keepPreviousData,
    });

    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [url, setUrl] = useState('/');
    const [targeted, setTargeted] = useState<'all' | 'filter'>('all');
    const [countries, setCountries] = useState<string[]>([]);
    const [subscription, setSubscription] = useState('all');
    const [sex, setSex] = useState('all');
    const [filteredCount, setFilteredCount] = useState<number | null>(null);
    const [counting, setCounting] = useState(false);
    const [sendNow, setSendNow] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    // "Filter" with nothing picked is everyone, exactly as the server reads it.
    const filter: PushFilter | null = useMemo(() => {
        if (targeted !== 'filter') return null;
        const f: PushFilter = {
            ...(countries.length ? { countries } : {}),
            ...(subscription !== 'all' ? { subscription: subscription as PushFilter['subscription'] } : {}),
            ...(sex !== 'all' ? { sex: sex as PushFilter['sex'] } : {}),
        };
        return Object.keys(f).length ? f : null;
    }, [targeted, countries, subscription, sex]);

    // Live count while the admin shapes the filter (read-only call).
    useEffect(() => {
        if (!filter) { setFilteredCount(null); setCounting(false); return; }
        let cancelled = false;
        setCounting(true);
        const timer = setTimeout(async () => {
            try {
                const { data } = await apiClient.post('/notifications/push/admin/audience', { filter });
                if (!cancelled) setFilteredCount(data.data.count);
            } catch {
                if (!cancelled) setFilteredCount(null);
            } finally {
                if (!cancelled) setCounting(false);
            }
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [filter]);

    const o = overview.data;
    const toAll = !filter;
    const reach = toAll ? o?.audience ?? 0 : filteredCount;
    const capReached = toAll && !!o && o.toAllToday >= o.toAllPerDay;
    const night = isNightInDouala();
    const missing = !title.trim() || !body.trim();
    const canSend = !missing && !capReached && !counting && !!reach;

    const send = useMutation({
        mutationFn: async () => (await apiClient.post('/notifications/push/admin/announce', {
            title: title.trim(), body: body.trim(), url,
            ...(filter ? { filter } : {}),
            ...(night && sendNow ? { sendNow: true } : {}),
        })).data.data as { recipients: number; heldUntil?: string },
        onSuccess: res => {
            toast.success(res.heldUntil
                ? `Enregistrée pour ${membres(res.recipients)} : visible tout de suite dans leurs notifications, sur leur téléphone à 07:00 (Douala).`
                : `Envoi à ${membres(res.recipients)}.`);
            setTitle(''); setBody(''); setUrl('/'); setSendNow(false);
            setConfirmOpen(false);
            void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
        },
        onError: err => {
            toast.error(apiError(err, 'L’annonce n’a pas pu être envoyée.'));
            setConfirmOpen(false);
        },
    });

    const sendLabel = capReached
        ? 'Limite du jour atteinte : ajoutez un filtre'
        : missing ? 'Saisissez un titre et un message'
            : toAll ? `Envoyer à tout le monde (${membres(o?.audience ?? 0)})`
                : counting || reach === null ? 'Comptage des destinataires…' : `Envoyer à ${membres(reach)}`;

    const columns: ListColumn<Announcement>[] = [
        {
            key: 'msg', header: 'Annonce', className: 'max-w-0 w-1/2',
            cell: a => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{a.title}</p>
                    <p className="line-clamp-2 text-xs text-fg-muted">{a.body}</p>
                </div>
            ),
        },
        {
            key: 'to', header: 'Destinataires',
            cell: a => (
                <div className="min-w-0">
                    <p className="tabular-nums text-fg">{membres(a.recipients)}</p>
                    <p className="truncate text-xs text-fg-muted">{describeFilter(a.filter)}</p>
                </div>
            ),
        },
        { key: 'page', header: 'Ouvre', cell: a => <span className="text-fg-muted">{a.url ? pageLabel(a.url) : '—'}</span> },
        {
            key: 'when', header: 'Envoyée',
            cell: a => (
                <div className="flex flex-col items-start gap-1">
                    <RelativeDate value={a.createdAt} className="text-fg-muted" />
                    {a.sendNow && <Badge tone="warning"><HugeiconsIcon icon={Moon02Icon} size={12} aria-hidden="true" />De nuit</Badge>}
                </div>
            ),
        },
    ];

    const card = (a: Announcement) => (
        <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium text-fg">{a.title}</p>
                <RelativeDate value={a.createdAt} className="shrink-0 text-xs text-fg-muted" />
            </div>
            <p className="line-clamp-2 text-sm text-fg-muted">{a.body}</p>
            <p className="text-xs text-fg-muted">
                {membres(a.recipients)} · {describeFilter(a.filter)}{a.url ? ` · ${pageLabel(a.url)}` : ''}
            </p>
            {a.sendNow && <Badge tone="warning"><HugeiconsIcon icon={Moon02Icon} size={12} aria-hidden="true" />Envoyée de nuit</Badge>}
        </div>
    );

    const composer = (
        <Panel>
            <PanelHeader title="Nouvelle annonce" description="Une notification sur le téléphone des membres qui ont activé « Annonces SBC »." />
            <PanelBody className="space-y-5">
                <Field label="Titre" help={`${title.length}/${TITLE_MAX}`}>
                    <Input className="h-11" value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} placeholder="Nouvelle formation disponible" />
                </Field>
                <Field label="Message" help={`${body.length}/${BODY_MAX}`}>
                    <Textarea rows={3} value={body} maxLength={BODY_MAX} onChange={e => setBody(e.target.value)} placeholder="Découvre la formation « Vendre sur WhatsApp » dès maintenant." />
                </Field>
                <Field label="Page ouverte au toucher">
                    <Select className="h-11" value={url} onValueChange={setUrl} options={PAGE_OPTIONS} />
                </Field>

                <div className="space-y-3">
                    <p className="text-sm font-medium text-fg">Destinataires</p>
                    <Segmented
                        fill
                        size="lg"
                        label="Destinataires"
                        value={targeted}
                        onValueChange={setTargeted}
                        options={[{ value: 'all', label: 'Tout le monde' }, { value: 'filter', label: 'Filtrer' }]}
                    />
                    {targeted === 'filter' && (
                        <div className="space-y-4 rounded-panel border border-line bg-surface-2 p-4">
                            <CountryPicker value={countries} onChange={setCountries} />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field label="Abonnement">
                                    <Select className="h-11" value={subscription} onValueChange={setSubscription} options={SUBSCRIPTION_OPTIONS} />
                                </Field>
                                <Field label="Sexe">
                                    <Select className="h-11" value={sex} onValueChange={setSex} options={SEX_OPTIONS} />
                                </Field>
                            </div>
                            <p className="text-sm" aria-live="polite">
                                {!filter
                                    ? <span className="text-fg">Aucun filtre choisi : l’annonce part à tout le monde.</span>
                                    : counting
                                        ? <span className="text-fg-muted">Comptage…</span>
                                        : filteredCount === null
                                            ? <span className="text-danger">Impossible de compter les membres pour le moment.</span>
                                            : <span className="text-fg">Touche <strong className="tabular-nums">{fmtInt(filteredCount)}</strong> membre{filteredCount > 1 ? 's' : ''} avec notifications activées.</span>}
                            </p>
                        </div>
                    )}
                </div>

                {night && (
                    <div className="space-y-3 rounded-panel border border-warning/40 bg-warning-soft/40 p-4">
                        <p className="flex items-start gap-2 text-sm text-fg">
                            <HugeiconsIcon icon={Moon02Icon} size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                            {sendNow
                                ? 'Les téléphones sonneront maintenant, en pleine nuit. À réserver aux vraies urgences.'
                                : 'Il fait nuit à Douala : les membres la voient tout de suite dans leurs notifications, mais leur téléphone ne sonne qu’à 07:00.'}
                        </p>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg">
                            <Switch checked={sendNow} onCheckedChange={setSendNow} />
                            Faire sonner les téléphones maintenant, malgré la nuit
                        </label>
                    </div>
                )}

                {capReached && (
                    <p className="flex items-start gap-2 text-sm text-danger" role="alert">
                        <HugeiconsIcon icon={Alert02Icon} size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                        Une annonce à tout le monde est déjà partie ces dernières 24 h. Choisissez « Filtrer » pour viser un groupe : les annonces filtrées ne sont pas limitées.
                    </p>
                )}

                {/* Sticky on phones: the form is long, the action stays in reach. */}
                <div className="sticky bottom-0 -mx-5 border-t border-line bg-surface px-5 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
                    <Button variant="primary" size="lg" className="w-full" disabled={!canSend} onClick={() => setConfirmOpen(true)}>
                        <HugeiconsIcon icon={SentIcon} size={16} aria-hidden="true" />
                        {sendLabel}
                    </Button>
                    <p className="mt-2 text-xs text-fg-muted">Les membres qui ont désactivé « Annonces SBC » ne la reçoivent pas.</p>
                </div>
            </PanelBody>
        </Panel>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Annonces push"
                description="Prévenir les membres sur leur téléphone : une nouveauté, une formation, une urgence."
            />

            <div className="grid grid-cols-2 gap-3">
                <Metric
                    label="Membres joignables"
                    value={overview.isLoading ? <Skeleton className="h-7 w-20" /> : fmtInt(o?.audience)}
                    hint="Notifications activées"
                    icon={UserGroupIcon}
                />
                <Metric
                    label="À tout le monde (24 h)"
                    value={overview.isLoading ? <Skeleton className="h-7 w-16" /> : `${fmtInt(o?.toAllToday)} / ${fmtInt(o?.toAllPerDay ?? 1)}`}
                    hint={capReached ? 'Limite atteinte · filtrées illimitées' : 'Les annonces filtrées ne sont pas limitées'}
                    tone={capReached ? 'danger' : 'neutral'}
                    icon={Megaphone02Icon}
                />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Can
                    module="notifications"
                    write
                    fallback={(
                        <Panel>
                            <EmptyState icon={Notification03Icon} title="Lecture seule" description="Vous pouvez consulter les annonces envoyées, pas en envoyer." />
                        </Panel>
                    )}
                >
                    {composer}
                </Can>

                <div className="space-y-6">
                    <Panel>
                        <PanelHeader title="Aperçu" description="Ce que les membres verront." />
                        <PanelBody><PushPreview title={title} body={body} url={url} /></PanelBody>
                    </Panel>
                </div>
            </div>

            <section className="space-y-3" aria-labelledby="push-history">
            <h2 id="push-history" className="text-base font-semibold text-fg">Historique des annonces</h2>
            <PageFilters filters={filters} />
            <Panel className={history.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
                <PanelHeader
                    title="Annonces récentes"
                    description={filters.country && history.data
                        ? `${pageCountryName(filters.country)} : les 20 dernières annonces reçues dans ce pays · ${membres(history.data.audience)} joignables`
                        : 'Les 20 dernières, la plus récente en premier.'}
                />
                <ResponsiveList
                    rows={history.data?.recent ?? []}
                    columns={columns}
                    rowKey={a => a._id}
                    card={card}
                    loading={history.isLoading}
                    empty={history.isError ? (
                        <ErrorState message={apiError(history.error, 'Les annonces n’ont pas pu être chargées.')} onRetry={() => void history.refetch()} retrying={history.isFetching} />
                    ) : filters.isFiltered ? (
                        <EmptyState icon={Megaphone02Icon} title="Aucune annonce pour ces filtres" description="Changez de pays ou de période pour en voir d’autres." />
                    ) : (
                        <EmptyState icon={Megaphone02Icon} title="Aucune annonce pour le moment" description="Les annonces envoyées s’affichent ici, avec leurs destinataires." />
                    )}
                />
            </Panel>
            </section>

            <Dialog open={confirmOpen} onOpenChange={open => { if (!send.isPending) setConfirmOpen(open); }}>
                {confirmOpen && (
                    <DialogContent
                        title={`Envoyer à ${membres(reach ?? 0)} ?`}
                        description="Une annonce envoyée ne peut pas être retirée."
                        footer={(
                            <>
                                <DialogClose asChild><Button variant="outline" size="lg" disabled={send.isPending}>Annuler</Button></DialogClose>
                                <Button variant="primary" size="lg" loading={send.isPending} onClick={() => send.mutate()}>
                                    Envoyer à {membres(reach ?? 0)}
                                </Button>
                            </>
                        )}
                    >
                        <div className="space-y-3 text-sm">
                            <PushPreview title={title} body={body} url={url} />
                            <dl className="space-y-1.5">
                                <div className="flex justify-between gap-3"><dt className="text-fg-muted">Destinataires</dt><dd className="text-right text-fg">{describeFilter(filter)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-fg-muted">Nombre</dt><dd className="tabular-nums text-fg">{membres(reach ?? 0)}</dd></div>
                                <div className="flex justify-between gap-3">
                                    <dt className="text-fg-muted">Sonnerie</dt>
                                    <dd className="text-right text-fg">{!night ? 'Tout de suite' : sendNow ? 'Tout de suite, malgré la nuit' : 'À 07:00 (Douala)'}</dd>
                                </div>
                            </dl>
                            {toAll && (
                                <p className="text-fg-muted">
                                    C’est l’annonce à tout le monde du jour : {fmtInt(o?.toAllPerDay ?? 1)} au maximum par 24 h.
                                </p>
                            )}
                        </div>
                    </DialogContent>
                )}
            </Dialog>
        </div>
    );
}
