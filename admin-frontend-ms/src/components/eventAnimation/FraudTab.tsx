import { useEffect, useState } from 'react';
import {
    FRAUD_FLAG_STATUS_LABELS, FRAUD_SIGNAL_LABELS, fmtDate, listFraudFlags, num, reviewFraudFlag, type AnimFraudFlag, type FraudFlagStatus,
} from '../../api/animation';
import { InformationCircleIcon, Shield01Icon } from '@hugeicons/core-free-icons';
import { Can } from '../Can';
import { usePermission } from '../../hooks/usePermission';
import { EmptyState, Panel, ResponsiveList, Segmented, type ListColumn } from '../ui';
import { DateText, ErrorState, Notice } from '../moduleKit';
import { FLAG_STATUS, FREEZE_BLOCK_SCORE, flagSubjectKind, plural, shortRef, useAnim, useAsync } from './shared';
import { Badge, Button, KV, Modal, Pager, ReasonConfirm, Section, StatusBadge, Toggle, UserRef } from './ui';

const PAGE = 24;
const signalName = (code: string) => FRAUD_SIGNAL_LABELS[code]?.label ?? 'Autre signal';
const measure = (v: number | undefined, code: string) => (v === undefined || v === null ? '—' : `${num(v)} ${FRAUD_SIGNAL_LABELS[code]?.unit ?? ''}`.trim());

function Subject({ f }: { f: AnimFraudFlag }) {
    const name = f.subjectLabel || (f.subjectType === 'IP' ? shortRef(f.subjectId) : 'Inconnu');
    return <span className="min-w-0"><span className="block text-xs text-fg-muted">{flagSubjectKind(f)}</span><span className="block font-medium">{name}</span></span>;
}

function Score({ f }: { f: AnimFraudFlag }) {
    return <Badge tone={f.score >= FREEZE_BLOCK_SCORE ? 'danger' : 'neutral'}>Score {f.score}</Badge>;
}

type Review = { flag: AnimFraudFlag; decision: 'clear' | 'confirm' };

/**
 * "À vérifier": what the anti-fraud signals put aside. Nothing is ever removed
 * automatically — clearing or confirming is SBC's call, highest scores first.
 */
export default function FraudTab() {
    const { refresh, notifySuccess, apiParams, queueParams, scopeKey } = useAnim();
    const canWrite = usePermission('events') === 'write';
    const [status, setStatus] = useState<FraudFlagStatus>('OPEN');
    const [page, setPage] = useState(1);
    // a new country/period starts again at page 1
    useEffect(() => { setPage(1); }, [scopeKey]);
    const [legend, setLegend] = useState(false);
    const [open, setOpen] = useState<AnimFraudFlag | null>(null);
    const [review, setReview] = useState<Review | null>(null);
    const [opts, setOpts] = useState({ voidVotes: true, refund: false, disqualify: false });
    // open flags are a queue: country only, whatever the period
    const q = useAsync(() => listFraudFlags({ status, page, limit: PAGE, ...(status === 'OPEN' ? queueParams : apiParams) }), `${status}|${page}|${scopeKey}`);
    const items = q.data?.items ?? [];

    const start = (flag: AnimFraudFlag, decision: Review['decision']) => {
        setOpts({ voidVotes: true, refund: false, disqualify: false });
        setReview({ flag, decision });
    };

    const columns: ListColumn<AnimFraudFlag>[] = [
        { key: 'subject', header: 'Sujet', cell: f => <Subject f={f} /> },
        { key: 'challenge', header: 'Défi', cell: f => <span className="text-fg-muted">{f.challenge?.name ?? 'Défi'}</span> },
        { key: 'signals', header: 'Signaux', cell: f => <span className="text-fg-muted">{f.signals.map(x => signalName(x.code)).join(', ')}</span> },
        { key: 'score', header: 'Score', cell: f => <Score f={f} /> },
        { key: 'at', header: 'Signalé', cell: f => <DateText value={f.createdAt} className="text-fg-muted" /> },
        {
            key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true,
            cell: f => f.status === 'OPEN' ? (
                <Can module="events" write>
                    <span className="inline-flex gap-1.5">
                        <Button small onClick={() => start(f, 'clear')}>Classer</Button>
                        <Button small variant="danger" onClick={() => start(f, 'confirm')}>Fraude…</Button>
                    </span>
                </Can>
            ) : <StatusBadge status={f.status} labels={FLAG_STATUS} />,
        },
    ];

    return (
        <div className="space-y-4">
            <Notice icon={InformationCircleIcon}>
                Les signaux anti-fraude ne suppriment jamais rien automatiquement : ils placent un compte, un achat, un candidat, une adresse
                réseau ou un appareil « à vérifier ». Un signalement ouvert de score {FREEZE_BLOCK_SCORE} ou plus empêche de figer le résultat du défi.
            </Notice>
            <Panel>
                <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                    <Segmented label="Statut des signalements" value={status} onValueChange={v => { setStatus(v); setPage(1); }}
                        options={(['OPEN', 'CLEARED', 'CONFIRMED'] as FraudFlagStatus[]).map(x => ({ value: x, label: FRAUD_FLAG_STATUS_LABELS[x] }))} />
                    <Button onClick={() => setLegend(v => !v)}>{legend ? 'Masquer' : 'Comprendre'} les signaux</Button>
                </div>
                {legend && (
                    <div className="grid gap-3 border-b border-line p-4 md:grid-cols-2">
                        {Object.entries(FRAUD_SIGNAL_LABELS).map(([code, x]) => (
                            <div key={code} className="text-sm"><p className="font-medium text-fg">{x.label}</p><p className="text-fg-muted">{x.help}</p></div>
                        ))}
                    </div>
                )}
                <div className={q.loading && q.data ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={items}
                        columns={columns}
                        rowKey={f => f._id}
                        onRowClick={setOpen}
                        loading={q.loading && !q.data}
                        empty={q.error && !q.data ? <ErrorState error={new Error(q.error)} onRetry={q.reload} /> : (
                            <EmptyState icon={Shield01Icon} title={status === 'OPEN' ? 'Rien à vérifier pour le moment' : 'Aucun signalement'} />
                        )}
                    />
                </div>
                {q.data && <Pager page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} pageSize={PAGE} onChange={setPage} />}
            </Panel>

            {open && (
                <Modal onClose={() => setOpen(null)} title={`${flagSubjectKind(open)} à vérifier`} subtitle={open.challenge?.name}
                    footer={open.status === 'OPEN' && canWrite ? <>
                        <Button onClick={() => start(open, 'clear')}>Classer sans suite…</Button>
                        <Button variant="danger" onClick={() => start(open, 'confirm')}>Confirmer la fraude…</Button>
                    </> : undefined}>
                    <div className="flex flex-wrap gap-1.5">
                        <StatusBadge status={open.status} labels={FLAG_STATUS} /><Score f={open} />
                        {open.score >= FREEZE_BLOCK_SCORE && open.status === 'OPEN' && <Badge tone="warning">Bloque le figeage du résultat</Badge>}
                    </div>
                    {open.subjectType === 'USER' ? <UserRef id={open.subjectId} fallback={open.subjectLabel ?? 'Compte'} /> : (
                        <p className="font-medium text-fg">{open.subjectLabel || (open.subjectType === 'IP' ? `${flagSubjectKind(open)} partagé${open.subjectId.startsWith('ua:') ? '' : 'e'} · ${shortRef(open.subjectId)}` : 'Sujet inconnu')}</p>
                    )}
                    <KV items={[
                        ['Défi', open.challenge?.name ?? 'Défi'],
                        ['Signalé le', fmtDate(open.createdAt)],
                        ['Mis à jour le', fmtDate(open.updatedAt)],
                        open.reviewedAt ? ['Traité le', fmtDate(open.reviewedAt)] : null,
                        open.reviewNote ? ['Note', open.reviewNote] : null,
                    ]} />
                    <Section title="Signaux">
                        <ul className="space-y-2">
                            {open.signals.map((s, i) => (
                                <li key={i} className="space-y-1 rounded-panel border border-line p-3 text-sm">
                                    <p className="font-medium text-fg">{signalName(s.code)}</p>
                                    {FRAUD_SIGNAL_LABELS[s.code]?.help && <p className="text-fg-muted">{FRAUD_SIGNAL_LABELS[s.code].help}</p>}
                                    <p><span className="text-fg-muted">Mesuré :</span> <b>{measure(s.value, s.code)}</b> <span className="text-fg-muted">· seuil {measure(s.threshold, s.code)}</span></p>
                                    {s.note && <p className="text-fg-muted">{s.note}</p>}
                                </li>
                            ))}
                        </ul>
                    </Section>
                </Modal>
            )}

            {review && canWrite && (
                <>
                    <ReasonConfirm open={review.decision === 'clear'} title="Classer sans suite ?" variant="primary"
                        message="Le signalement est clos et les achats concernés sont marqués comme vérifiés. Aucun vote n’est modifié."
                        label="Note (facultative)" optional confirmText="Classer" onCancel={() => setReview(null)}
                        onConfirm={async (note) => {
                            await reviewFraudFlag(review.flag._id, { decision: 'clear', note: note || undefined });
                            notifySuccess('Signalement classé sans suite.');
                            setOpen(null); refresh();
                        }} />
                    <ReasonConfirm open={review.decision === 'confirm'} title="Confirmer la fraude ?"
                        message="Choisissez les mesures à appliquer. Chacune est journalisée."
                        label="Note (obligatoire)" minLength={3} confirmText="Confirmer la fraude" onCancel={() => setReview(null)}
                        onConfirm={async (note) => {
                            const { result } = await reviewFraudFlag(review.flag._id, {
                                decision: 'confirm', note,
                                voidVotes: opts.voidVotes, refund: opts.refund,
                                disqualify: review.flag.subjectType === 'CANDIDATE' && opts.disqualify,
                            });
                            const parts = [
                                result.voidedFreeVotes !== undefined ? `${result.voidedFreeVotes} ${plural(result.voidedFreeVotes, 'vote gratuit annulé', 'votes gratuits annulés')}` : null,
                                result.refunded !== undefined ? `${result.refunded} ${plural(result.refunded, 'achat remboursé', 'achats remboursés')}` : null,
                                result.disqualified ? 'candidat disqualifié' : null,
                            ].filter(Boolean);
                            notifySuccess(`Fraude confirmée${parts.length ? ` : ${parts.join(', ')}` : ''}.`);
                            setOpen(null); refresh();
                        }}>
                        <div className="divide-y divide-line rounded-panel border border-line">
                            <Toggle label="Annuler les votes gratuits" checked={opts.voidVotes} onChange={v => setOpts({ ...opts, voidVotes: v })}
                                help={review.flag.subjectType === 'TRANSACTION' ? 'Sans effet pour un achat (aucun vote gratuit associé).' : undefined} />
                            <Toggle label="Rembourser les achats" checked={opts.refund} onChange={v => setOpts({ ...opts, refund: v })}
                                help="Les achats payés sont remboursés intégralement sur le solde SBC du votant et leurs votes retirés." />
                            {review.flag.subjectType === 'CANDIDATE' && (
                                <Toggle label="Disqualifier le candidat" checked={opts.disqualify} onChange={v => setOpts({ ...opts, disqualify: v })} />
                            )}
                        </div>
                    </ReasonConfirm>
                </>
            )}
        </div>
    );
}
