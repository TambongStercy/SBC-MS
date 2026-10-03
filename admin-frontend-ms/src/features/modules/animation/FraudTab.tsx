import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
    FRAUD_FLAG_STATUS_LABELS, FRAUD_SIGNAL_LABELS, listFraudFlags, reviewFraudFlag, type AnimFraudFlag, type FraudFlagStatus,
} from '../../../api/animation';
import {
    Badge, Button, Card, ConfirmSheet, DataList, EmptyState, KeyValue, Pagination, SectionTitle, Select, Sheet, StatusBadge, Switch, Textarea, notify, type Column,
} from '../../../ui';
import { formatDateTime, formatNumber } from '../../../lib/format';
import { MemberById } from '../../members/MemberById';
import { FLAG_STATUS, FREEZE_BLOCK_SCORE, flagSubjectKind, shortRef, useAnimRefresh } from './shared';

const PAGE = 24;
const signalName = (code: string) => FRAUD_SIGNAL_LABELS[code]?.label ?? 'Autre signal';
const measure = (v: number | undefined, code: string) => (v === undefined || v === null ? '—' : `${formatNumber(v)} ${FRAUD_SIGNAL_LABELS[code]?.unit ?? ''}`.trim());

function Subject({ f }: { f: AnimFraudFlag }) {
    const name = f.subjectLabel || (f.subjectType === 'IP' ? shortRef(f.subjectId) : 'Inconnu');
    return <span className="min-w-0"><span className="block text-xs text-ink-2">{flagSubjectKind(f)}</span><span className="block font-semibold truncate">{name}</span></span>;
}

function Score({ f }: { f: AnimFraudFlag }) {
    return <Badge tone={f.score >= FREEZE_BLOCK_SCORE ? 'danger' : 'neutral'}>Score {f.score}</Badge>;
}

type Review = { flag: AnimFraudFlag; decision: 'clear' | 'confirm' };

/**
 * "À vérifier": what the anti-fraud signals put aside. Nothing is ever removed
 * automatically — clearing or confirming is SBC's call, highest scores first.
 */
export function FraudTab() {
    const refresh = useAnimRefresh();
    const [status, setStatus] = useState<FraudFlagStatus>('OPEN');
    const [page, setPage] = useState(1);
    const [legend, setLegend] = useState(false);
    const [open, setOpen] = useState<AnimFraudFlag | null>(null);
    const [review, setReview] = useState<Review | null>(null);
    const [opts, setOpts] = useState({ voidVotes: true, refund: false, disqualify: false });
    const [clearNote, setClearNote] = useState('');
    const q = useQuery({
        queryKey: ['animation', 'fraud', status, page],
        queryFn: () => listFraudFlags({ status, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });

    const start = (flag: AnimFraudFlag, decision: Review['decision']) => {
        setOpts({ voidVotes: true, refund: false, disqualify: false });
        setClearNote('');
        setReview({ flag, decision });
    };

    const cols: Column<AnimFraudFlag>[] = [
        { key: 'w', header: 'Sujet', cell: f => <Subject f={f} /> },
        { key: 'c', header: 'Défi', cell: f => <span className="text-ink-2">{f.challenge?.name ?? 'Défi'}</span> },
        { key: 's', header: 'Signaux', cell: f => <span className="text-ink-2">{f.signals.map(s => signalName(s.code)).join(', ')}</span> },
        { key: 'x', header: 'Score', cell: f => <Score f={f} /> },
        { key: 'd', header: 'Signalé', cell: f => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(f.createdAt)}</span> },
        { key: 't', header: 'Statut', cell: f => <StatusBadge status={f.status} labels={FLAG_STATUS} /> },
    ];

    return (
        <div className="space-y-3">
            <p className="text-sm text-ink-2">
                Les signaux anti-fraude ne suppriment jamais rien automatiquement : ils placent un compte, un achat, un candidat, une adresse
                réseau ou un appareil « à vérifier ». Un signalement ouvert de score {FREEZE_BLOCK_SCORE} ou plus empêche de figer le résultat du défi.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="sm:w-56"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as FraudFlagStatus); setPage(1); }}>
                    {(['OPEN', 'CLEARED', 'CONFIRMED'] as FraudFlagStatus[]).map(s => <option key={s} value={s}>{FRAUD_FLAG_STATUS_LABELS[s]}</option>)}
                </Select></div>
                <Button variant="ghost" size="sm" className="sm:ml-auto self-start" onClick={() => setLegend(v => !v)}>{legend ? 'Masquer' : 'Comprendre'} les signaux</Button>
            </div>
            {legend && (
                <Card className="grid md:grid-cols-2 gap-3">
                    {Object.entries(FRAUD_SIGNAL_LABELS).map(([code, s]) => (
                        <div key={code} className="text-sm"><p className="font-semibold text-ink">{s.label}</p><p className="text-ink-2">{s.help}</p></div>
                    ))}
                </Card>
            )}

            <DataList rows={q.data?.items} columns={cols} rowKey={f => f._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen}
                empty={<Card><EmptyState title={status === 'OPEN' ? 'Rien à vérifier pour le moment' : 'Aucun signalement'} /></Card>}
                card={f => (
                    <span className="block space-y-1">
                        <span className="flex items-start justify-between gap-3"><Subject f={f} /><Score f={f} /></span>
                        <span className="block text-xs text-ink-2 truncate">{f.challenge?.name ?? 'Défi'} · {f.signals.map(s => signalName(s.code)).join(', ')}</span>
                        <span className="block text-xs text-ink-3">Signalé {formatDateTime(f.createdAt)}{f.status !== 'OPEN' ? ` · ${FRAUD_FLAG_STATUS_LABELS[f.status]}` : ''}</span>
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}

            {open && (
                <Sheet open onClose={() => setOpen(null)} size="lg" title={`${flagSubjectKind(open)} à vérifier`}
                    footer={open.status === 'OPEN' ? (
                        <div className="grid grid-cols-2 gap-2">
                            <Button variant="secondary" onClick={() => start(open, 'clear')}>Classer sans suite…</Button>
                            <Button variant="danger" onClick={() => start(open, 'confirm')}>Confirmer la fraude…</Button>
                        </div>
                    ) : undefined}>
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-1.5"><StatusBadge status={open.status} labels={FLAG_STATUS} /><Score f={open} />
                            {open.score >= FREEZE_BLOCK_SCORE && open.status === 'OPEN' && <Badge tone="warning">Bloque le figeage du résultat</Badge>}</div>
                        {open.subjectType === 'USER' ? <MemberById id={open.subjectId} fallback={open.subjectLabel ?? 'Compte'} /> : (
                            <p className="font-semibold">{open.subjectLabel || (open.subjectType === 'IP' ? `${flagSubjectKind(open)} partagé${open.subjectId.startsWith('ua:') ? '' : 'e'} · ${shortRef(open.subjectId)}` : 'Sujet inconnu')}</p>
                        )}
                        <KeyValue items={[
                            ['Défi', open.challenge?.name ?? 'Défi'],
                            ['Signalé le', formatDateTime(open.createdAt)],
                            ['Mis à jour le', formatDateTime(open.updatedAt)],
                            open.reviewedAt ? ['Traité le', formatDateTime(open.reviewedAt)] : null,
                        ]} />
                        {open.reviewNote && <p className="text-sm text-ink-2"><b className="text-ink">Note :</b> {open.reviewNote}</p>}
                        <section>
                            <SectionTitle>Signaux</SectionTitle>
                            <ul className="space-y-2">
                                {open.signals.map((s, i) => (
                                    <li key={i} className="rounded-tile bg-surface-2 p-3 text-sm space-y-1">
                                        <p className="font-semibold">{signalName(s.code)}</p>
                                        {FRAUD_SIGNAL_LABELS[s.code]?.help && <p className="text-ink-2">{FRAUD_SIGNAL_LABELS[s.code].help}</p>}
                                        <p className="tabular"><span className="text-ink-2">Mesuré :</span> <b>{measure(s.value, s.code)}</b> <span className="text-ink-2">· seuil {measure(s.threshold, s.code)}</span></p>
                                        {s.note && <p className="text-ink-2">{s.note}</p>}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </div>
                </Sheet>
            )}

            {review && (
                <>
                    <ConfirmSheet open={review.decision === 'clear'} onClose={() => setReview(null)} title="Classer sans suite ?"
                        message={<>
                            <p>Le signalement est clos et les achats concernés sont marqués comme vérifiés. Aucun vote n’est modifié.</p>
                            <Textarea label="Note (facultative)" rows={2} value={clearNote} onChange={e => setClearNote(e.target.value)} maxLength={1000} />
                        </>}
                        confirmLabel="Classer"
                        onConfirm={async () => {
                            await reviewFraudFlag(review.flag._id, { decision: 'clear', note: clearNote.trim() || undefined });
                            notify.success('Signalement classé sans suite.');
                            setOpen(null); refresh();
                        }} />
                    <ConfirmSheet open={review.decision === 'confirm'} onClose={() => setReview(null)} tone="danger" title="Confirmer la fraude ?"
                        message={<>
                            <p>Choisis les mesures à appliquer. Chacune est journalisée.</p>
                            <div className="divide-y divide-border border border-border rounded-tile">
                                <Option label="Annuler les votes gratuits" checked={opts.voidVotes} onChange={v => setOpts({ ...opts, voidVotes: v })}
                                    help={review.flag.subjectType === 'TRANSACTION' ? 'Sans effet pour un achat (aucun vote gratuit associé).' : undefined} />
                                <Option label="Rembourser les achats" checked={opts.refund} onChange={v => setOpts({ ...opts, refund: v })}
                                    help="Les achats payés sont remboursés intégralement sur le solde SBC du votant et leurs votes retirés." />
                                {review.flag.subjectType === 'CANDIDATE' && (
                                    <Option label="Disqualifier le candidat" checked={opts.disqualify} onChange={v => setOpts({ ...opts, disqualify: v })} />
                                )}
                            </div>
                        </>}
                        reason={{ label: 'Note (obligatoire)', minLength: 3 }}
                        confirmLabel="Confirmer la fraude"
                        onConfirm={async (note) => {
                            const { result } = await reviewFraudFlag(review.flag._id, {
                                decision: 'confirm', note,
                                voidVotes: opts.voidVotes, refund: opts.refund,
                                disqualify: review.flag.subjectType === 'CANDIDATE' && opts.disqualify,
                            });
                            const parts = [
                                result.voidedFreeVotes !== undefined ? `${result.voidedFreeVotes} vote${result.voidedFreeVotes > 1 ? 's' : ''} gratuit${result.voidedFreeVotes > 1 ? 's' : ''} annulé${result.voidedFreeVotes > 1 ? 's' : ''}` : null,
                                result.refunded !== undefined ? `${result.refunded} achat${result.refunded > 1 ? 's' : ''} remboursé${result.refunded > 1 ? 's' : ''}` : null,
                                result.disqualified ? 'candidat disqualifié' : null,
                            ].filter(Boolean);
                            notify.success(`Fraude confirmée${parts.length ? ` : ${parts.join(', ')}` : ''}.`);
                            setOpen(null); refresh();
                        }} />
                </>
            )}
        </div>
    );
}

function Option({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{label}</span>{help && <span className="block text-xs text-ink-3">{help}</span>}</span>
            <Switch checked={checked} onChange={onChange} label={label} />
        </div>
    );
}
