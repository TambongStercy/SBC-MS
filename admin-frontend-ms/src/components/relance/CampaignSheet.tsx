import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon, Mail01Icon, PauseIcon, PlayIcon, UserGroupIcon, ViewIcon, Cancel01Icon } from '@hugeicons/core-free-icons';
import {
    getCampaignById, getCampaignRecentMessages, getCampaignStatsById, getCampaignTargets, type Campaign,
} from '../../services/adminRelanceApi';
import { Can } from '../Can';
import {
    Avatar, Badge, Button, Dialog, DialogContent, EmptyState, Metric, SheetContent, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip,
} from '../ui';
import { ErrorState } from '../display/ErrorState';
import { RelativeDate } from '../display/RelativeDate';
import { apiError, fmtDate, fmtDateTime, fmtInt, fmtPct } from '../display/format';
import { campaignDeliveryRate } from './rates';
import { CampaignStatusBadge, ChannelLabel, EXIT_REASON_LABELS, GENDER_LABELS, LANGUAGE_LABELS, TargetStatusBadge, TYPE_LABELS } from './labels';

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
            <dt className="shrink-0 text-fg-muted">{label}</dt>
            <dd className="min-w-0 text-right text-fg">{children}</dd>
        </div>
    );
}

/**
 * Filleuls currently at each day J1…J7: ordered categories, so the bars keep
 * the day order (not sorted), one hue, value at the bar's end, exact figure on
 * hover/focus, and the same numbers readable without hovering.
 */
function DayBars({ data }: { data: { day: number; count: number }[] }) {
    const max = Math.max(...data.map(d => d.count), 0);
    if (max === 0) return <p className="py-4 text-sm text-fg-muted">Personne en cours de parcours.</p>;
    return (
        <ul className="space-y-2" aria-label="Filleuls par jour du parcours">
            {[...data].sort((a, b) => a.day - b.day).map(d => (
                <li key={d.day} className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-3">
                    <span className="text-sm text-fg-muted">Jour {d.day}</span>
                    <Tooltip content={`Jour ${d.day} : ${fmtInt(d.count)} filleul${d.count > 1 ? 's' : ''}`}>
                        <div tabIndex={0} className="h-3 w-full rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Jour ${d.day} : ${fmtInt(d.count)}`}>
                            {d.count > 0 && <div className="h-3 rounded-r-[4px] bg-chart-1" style={{ width: `max(${(d.count / max) * 100}%, 2px)` }} />}
                        </div>
                    </Tooltip>
                    <span className="text-right text-sm text-fg tabular-nums">{fmtInt(d.count)}</span>
                </li>
            ))}
        </ul>
    );
}

/**
 * One campaign: summary and figures, its filleuls, the last messages sent
 * (with the e-mail as received). Pause / resume / cancel stay one tap away.
 */
export function CampaignSheet({ campaign, onPause, onResume, onCancel, busy }: {
    campaign: Campaign;
    onPause: (c: Campaign) => void;
    onResume: (c: Campaign) => void;
    onCancel: (c: Campaign) => void;
    busy: boolean;
}) {
    const [tab, setTab] = useState('summary');
    const [email, setEmail] = useState<string | null>(null);
    const id = campaign._id;

    const full = useQuery({ queryKey: ['relance-campaign', id], queryFn: () => getCampaignById(id) });
    const stats = useQuery({ queryKey: ['relance-campaign-stats', id], queryFn: () => getCampaignStatsById(id) });
    const targets = useQuery({ queryKey: ['relance-campaign-targets', id], queryFn: () => getCampaignTargets(id, 1, 50), enabled: tab === 'targets' });
    const messages = useQuery({ queryKey: ['relance-campaign-messages', id], queryFn: () => getCampaignRecentMessages(id, 15), enabled: tab === 'messages' });

    // The list row is fresher after a pause/resume; the full record adds the filters.
    const c: Campaign = { ...(full.data ?? {}), ...campaign, targetFilter: full.data?.targetFilter ?? campaign.targetFilter };
    const st = stats.data;
    const rate = campaignDeliveryRate(c);
    const tf = c.targetFilter;
    const filterChips = tf ? [
        tf.countries?.length ? `Pays : ${tf.countries.join(', ')}` : null,
        tf.gender && tf.gender !== 'all' ? (GENDER_LABELS[tf.gender] ?? tf.gender) : null,
        tf.professions?.length ? `${fmtInt(tf.professions.length)} profession${tf.professions.length > 1 ? 's' : ''}` : null,
        tf.minAge ? `${tf.minAge} ans et plus` : null,
        tf.maxAge ? `${tf.maxAge} ans au plus` : null,
        tf.registrationDateFrom ? `Inscrits depuis le ${fmtDate(tf.registrationDateFrom)}` : null,
        tf.registrationDateTo ? `Inscrits jusqu’au ${fmtDate(tf.registrationDateTo)}` : null,
    ].filter(Boolean) as string[] : [];

    const canPause = c.status === 'active';
    const canResume = c.status === 'paused';
    const canCancel = c.status === 'active' || c.status === 'paused' || c.status === 'scheduled';

    return (
        <SheetContent
            width="lg"
            title={c.name}
            description={c.owner?.name ? `Campagne de ${c.owner.name}` : TYPE_LABELS[c.type] ?? c.type}
            footer={(canPause || canResume || canCancel) ? (
                <Can module="relance" write>
                    {canCancel && (
                        <Button variant="danger-ghost" size="lg" disabled={busy} onClick={() => onCancel(c)}>
                            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
                            Annuler la campagne
                        </Button>
                    )}
                    {canPause && (
                        <Button size="lg" loading={busy} onClick={() => onPause(c)}>
                            <HugeiconsIcon icon={PauseIcon} size={16} aria-hidden="true" />
                            Mettre en pause
                        </Button>
                    )}
                    {canResume && (
                        <Button variant="primary" size="lg" loading={busy} onClick={() => onResume(c)}>
                            <HugeiconsIcon icon={PlayIcon} size={16} aria-hidden="true" />
                            Reprendre
                        </Button>
                    )}
                </Can>
            ) : undefined}
        >
            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="mb-4 pb-px [scrollbar-width:none]">
                    <TabsTrigger value="summary">Résumé</TabsTrigger>
                    <TabsTrigger value="targets">Filleuls</TabsTrigger>
                    <TabsTrigger value="messages">Messages</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="space-y-6">
                    <div className="grid grid-cols-2 gap-3">
                        {/* The campaign's own counters: the per-campaign stats only see filleuls still on file. */}
                        <Metric label="Filleuls inscrits" value={fmtInt(c.targetsEnrolled)} hint={st ? `${fmtInt(st.activeTargets)} en cours` : undefined} />
                        <Metric
                            label="Taux de remise"
                            value={rate === null ? '—' : fmtPct(rate)}
                            hint={`${fmtInt(c.messagesDelivered)} remis · ${fmtInt(c.messagesFailed)} échecs`}
                        />
                    </div>

                    <section>
                        <h3 className="mb-2 text-sm font-semibold text-fg">Où en sont les filleuls</h3>
                        {stats.isLoading ? <Skeleton className="h-40 w-full" /> : stats.isError ? (
                            <ErrorState message={apiError(stats.error, 'Les chiffres n’ont pas pu être chargés.')} onRetry={() => void stats.refetch()} className="py-4" />
                        ) : st ? <DayBars data={st.dayProgression} /> : null}
                    </section>

                    {st && Object.keys(st.exitReasons).length > 0 && (
                        <section>
                            <h3 className="mb-1 text-sm font-semibold text-fg">Sorties</h3>
                            <dl className="divide-y divide-line">
                                {Object.entries(st.exitReasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                                    <Row key={k} label={EXIT_REASON_LABELS[k] ?? k}><span className="tabular-nums">{fmtInt(n)}</span></Row>
                                ))}
                            </dl>
                        </section>
                    )}

                    <section>
                        <h3 className="mb-1 text-sm font-semibold text-fg">Campagne</h3>
                        <dl className="divide-y divide-line">
                            <Row label="Statut"><CampaignStatusBadge status={c.status} /></Row>
                            <Row label="Type">{TYPE_LABELS[c.type] ?? c.type}</Row>
                            <Row label="Canal"><ChannelLabel channel={c.channel} /></Row>
                            <Row label="Parrain">
                                {c.owner?.name ?? 'Inconnu'}
                                <span className="block font-mono text-xs text-fg-muted">{c.userId}</span>
                            </Row>
                            {typeof c.contactBatch?.offset === 'number' && typeof c.contactBatch?.limit === 'number' && (
                                <Row label="Lot de contacts">Positions {fmtInt(c.contactBatch!.offset)} → {fmtInt(c.contactBatch!.offset + c.contactBatch!.limit - 1)} ({fmtInt(c.contactBatch!.limit)})</Row>
                            )}
                            <Row label="Créée">{fmtDateTime(c.createdAt)}</Row>
                            {c.scheduledStartDate && <Row label="Démarrage prévu">{fmtDateTime(c.scheduledStartDate)}</Row>}
                            {c.startedAt && <Row label="Démarrée">{fmtDateTime(c.startedAt)}</Row>}
                            {c.actualEndDate && <Row label="Terminée">{fmtDateTime(c.actualEndDate)}</Row>}
                            {c.cancellationReason && <Row label="Motif d’annulation">{c.cancellationReason}</Row>}
                            <Row label="Messages envoyés"><span className="tabular-nums">{fmtInt(c.messagesSent)} · {fmtInt(c.messagesDelivered)} remis · {fmtInt(c.messagesFailed)} échecs</span></Row>
                            <Row label="Filleuls terminés / sortis"><span className="tabular-nums">{fmtInt(c.targetsCompleted)} / {fmtInt(c.targetsExited)}</span></Row>
                        </dl>
                    </section>

                    {c.type === 'filtered' && (
                        <section>
                            <h3 className="mb-2 text-sm font-semibold text-fg">Filleuls visés</h3>
                            {full.isLoading ? <Skeleton className="h-8 w-full" /> : filterChips.length ? (
                                <div className="flex flex-wrap gap-2">{filterChips.map(t => <Badge key={t} tone="outline">{t}</Badge>)}</div>
                            ) : <p className="text-sm text-fg-muted">Aucun critère.</p>}
                            <p className="mt-2 text-xs text-fg-muted">Estimation au lancement : {c.estimatedTargetCount ? fmtInt(c.estimatedTargetCount) : '—'} filleuls.</p>
                        </section>
                    )}
                </TabsContent>

                <TabsContent value="targets">
                    {targets.isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div> : targets.isError ? (
                        <ErrorState message={apiError(targets.error, 'Les filleuls n’ont pas pu être chargés.')} onRetry={() => void targets.refetch()} />
                    ) : !targets.data?.targets.length ? (
                        <EmptyState icon={UserGroupIcon} title="Aucun filleul enregistré pour cette campagne" description={c.targetsEnrolled > 0 ? `${fmtInt(c.targetsEnrolled)} filleuls y sont passés ; leurs parcours ne sont plus en base.` : undefined} />
                    ) : (
                        <>
                            <p className="mb-2 text-xs text-fg-muted">
                                {targets.data.total > targets.data.targets.length ? `Les ${fmtInt(targets.data.targets.length)} derniers sur ${fmtInt(targets.data.total)}.` : `${fmtInt(targets.data.total)} filleul${targets.data.total > 1 ? 's' : ''}.`}
                            </p>
                            <ul className="divide-y divide-line">
                                {targets.data.targets.map(t => (
                                    <li key={t._id} className="space-y-1 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium text-fg">Jour {t.currentDay}/7</span>
                                            <TargetStatusBadge status={t.status} />
                                            {t.exitReason && <Badge tone="outline">{EXIT_REASON_LABELS[t.exitReason] ?? t.exitReason}</Badge>}
                                        </div>
                                        <p className="text-xs text-fg-muted">
                                            Entré <RelativeDate value={t.enteredLoopAt} /> · prochain message <RelativeDate value={t.nextMessageDue} /> · {fmtInt(t.messagesDelivered.length)} messages · {LANGUAGE_LABELS[t.language] ?? t.language}
                                        </p>
                                        <p className="truncate font-mono text-xs text-fg-subtle">Filleul {t.referralUserId}</p>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </TabsContent>

                <TabsContent value="messages">
                    {messages.isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div> : messages.isError ? (
                        <ErrorState message={apiError(messages.error, 'Les messages n’ont pas pu être chargés.')} onRetry={() => void messages.refetch()} />
                    ) : !messages.data?.messages.length ? (
                        <EmptyState
                            icon={Mail01Icon}
                            title="Aucun message retrouvé"
                            description={c.messagesSent > 0 ? 'Les envois se lisent sur les filleuls encore enregistrés pour cette campagne ; il n’en reste plus.' : 'Les messages apparaissent ici dès le premier envoi.'}
                        />
                    ) : (
                        <ul className="divide-y divide-line">
                            {messages.data.messages.map((m, i) => {
                                const name = m.referralUser?.name || 'Membre inconnu';
                                return (
                                    <li key={`${m.sentAt}-${i}`} className="flex items-start gap-3 py-3">
                                        <Avatar src={m.referralUser?.avatar} name={name} size="sm" />
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="truncate text-sm font-medium text-fg">{name}</span>
                                                <span className="text-xs text-fg-muted">Jour {m.day}</span>
                                                {m.status === 'delivered' ? (
                                                    <Badge tone="success"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} aria-hidden="true" />Remis</Badge>
                                                ) : (
                                                    <Badge tone="danger"><HugeiconsIcon icon={Alert02Icon} size={12} aria-hidden="true" />Échec</Badge>
                                                )}
                                            </div>
                                            <p className="truncate text-xs text-fg-muted">
                                                {[m.referralUser?.email, m.referralUser?.phoneNumber].filter(Boolean).join(' · ') || 'Pas de contact'} · <RelativeDate value={m.sentAt} />
                                            </p>
                                            {m.errorMessage && <p className="text-xs text-danger">Erreur : {m.errorMessage}</p>}
                                        </div>
                                        {m.renderedHtml && (
                                            <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => setEmail(m.renderedHtml!)}>
                                                <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />
                                                E-mail
                                            </Button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </TabsContent>
            </Tabs>

            <Dialog open={!!email} onOpenChange={o => { if (!o) setEmail(null); }}>
                {email && (
                    <DialogContent size="lg" title="L’e-mail tel qu’il a été reçu">
                        <div className="overflow-hidden rounded-md border border-line bg-white">
                            <iframe srcDoc={email} title="E-mail reçu" sandbox="allow-same-origin" className="h-[65dvh] w-full border-0" />
                        </div>
                    </DialogContent>
                )}
            </Dialog>
        </SheetContent>
    );
}
