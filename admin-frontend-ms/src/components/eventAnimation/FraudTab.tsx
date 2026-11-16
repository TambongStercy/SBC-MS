import { useState } from 'react';
import {
    FRAUD_FLAG_STATUS_LABELS, FRAUD_SIGNAL_LABELS, fmtDate, listFraudFlags, num, reviewFraudFlag, type AnimFraudFlag, type FraudFlagStatus,
} from '../../api/animation';
import { FLAG_STATUS, FREEZE_BLOCK_SCORE, flagSubjectKind, plural, shortRef, useAnim, useAsync } from './shared';
import { Badge, Button, Card, KV, Modal, Pager, ReasonConfirm, Section, StatusBadge, Table, Toggle, UserRef, selectCls, tdCls, trCls } from './ui';

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
    const { refresh, notifySuccess } = useAnim();
    const [status, setStatus] = useState<FraudFlagStatus>('OPEN');
    const [page, setPage] = useState(1);
    const [legend, setLegend] = useState(false);
    const [open, setOpen] = useState<AnimFraudFlag | null>(null);
    const [review, setReview] = useState<Review | null>(null);
    const [opts, setOpts] = useState({ voidVotes: true, refund: false, disqualify: false });
    const q = useAsync(() => listFraudFlags({ status, page, limit: PAGE }), `${status}|${page}`);
    const items = q.data?.items ?? [];

    const start = (flag: AnimFraudFlag, decision: Review['decision']) => {
        setOpts({ voidVotes: true, refund: false, disqualify: false });
        setReview({ flag, decision });
    };

    return (
        <div className="space-y-3">
            <p className="text-sm text-fg-muted">
                Les signaux anti-fraude ne suppriment jamais rien automatiquement : ils placent un compte, un achat, un candidat, une adresse
                réseau ou un appareil « à vérifier ». Un signalement ouvert de score {FREEZE_BLOCK_SCORE} ou plus empêche de figer le résultat du défi.
            </p>
            <div className="flex flex-wrap items-center gap-3">
                <select value={status} onChange={e => { setStatus(e.target.value as FraudFlagStatus); setPage(1); }} className={selectCls}>
                    {(['OPEN', 'CLEARED', 'CONFIRMED'] as FraudFlagStatus[]).map(s => <option key={s} value={s}>{FRAUD_FLAG_STATUS_LABELS[s]}</option>)}
                </select>
                <Button className="ml-auto" onClick={() => setLegend(v => !v)}>{legend ? 'Masquer' : 'Comprendre'} les signaux</Button>
            </div>
            {legend && (
                <Card className="grid md:grid-cols-2 gap-3">
                    {Object.entries(FRAUD_SIGNAL_LABELS).map(([code, s]) => (
                        <div key={code} className="text-sm"><p className="font-semibold text-fg">{s.label}</p><p className="text-fg-muted">{s.help}</p></div>
                    ))}
                </Card>
            )}

            <Table headers={['Sujet', 'Défi', 'Signaux', 'Score', 'Signalé', 'Statut', '']}
                loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload}
                empty={q.data && items.length === 0 ? (status === 'OPEN' ? 'Rien à vérifier pour le moment' : 'Aucun signalement') : undefined}>
                {items.map(f => (
                    <tr key={f._id} className={trCls} onClick={() => setOpen(f)}>
                        <td className={tdCls}><Subject f={f} /></td>
                        <td className={`${tdCls} text-fg-muted`}>{f.challenge?.name ?? 'Défi'}</td>
                        <td className={`${tdCls} text-fg-muted`}>{f.signals.map(s => signalName(s.code)).join(', ')}</td>
                        <td className={tdCls}><Score f={f} /></td>
                        <td className={`${tdCls} text-xs text-fg-muted whitespace-nowrap`}>{fmtDate(f.createdAt)}</td>
                        <td className={tdCls}><StatusBadge status={f.status} labels={FLAG_STATUS} /></td>
                        <td className={`${tdCls} whitespace-nowrap space-x-2`} onClick={e => e.stopPropagation()}>
                            {f.status === 'OPEN' && <>
                                <Button small onClick={() => start(f, 'clear')}>Classer</Button>
                                <Button small variant="danger" onClick={() => start(f, 'confirm')}>Fraude</Button>
                            </>}
                        </td>
                    </tr>
                ))}
            </Table>
            {q.data && <Pager page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}

            {open && (
                <Modal onClose={() => setOpen(null)} title={`${flagSubjectKind(open)} à vérifier`} subtitle={open.challenge?.name}
                    footer={open.status === 'OPEN' ? <>
                        <Button onClick={() => start(open, 'clear')}>Classer sans suite…</Button>
                        <Button variant="danger" onClick={() => start(open, 'confirm')}>Confirmer la fraude…</Button>
                    </> : undefined}>
                    <div className="flex flex-wrap gap-1.5">
                        <StatusBadge status={open.status} labels={FLAG_STATUS} /><Score f={open} />
                        {open.score >= FREEZE_BLOCK_SCORE && open.status === 'OPEN' && <Badge tone="warning">Bloque le figeage du résultat</Badge>}
                    </div>
                    {open.subjectType === 'USER' ? <UserRef id={open.subjectId} fallback={open.subjectLabel ?? 'Compte'} /> : (
                        <p className="font-semibold">{open.subjectLabel || (open.subjectType === 'IP' ? `${flagSubjectKind(open)} partagé${open.subjectId.startsWith('ua:') ? '' : 'e'} · ${shortRef(open.subjectId)}` : 'Sujet inconnu')}</p>
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
                                <li key={i} className="rounded-lg bg-surface border border-line p-3 text-sm space-y-1">
                                    <p className="font-semibold">{signalName(s.code)}</p>
                                    {FRAUD_SIGNAL_LABELS[s.code]?.help && <p className="text-fg-muted">{FRAUD_SIGNAL_LABELS[s.code].help}</p>}
                                    <p><span className="text-fg-muted">Mesuré :</span> <b>{measure(s.value, s.code)}</b> <span className="text-fg-muted">· seuil {measure(s.threshold, s.code)}</span></p>
                                    {s.note && <p className="text-fg-muted">{s.note}</p>}
                                </li>
                            ))}
                        </ul>
                    </Section>
                </Modal>
            )}

            {review && (
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
                        message="Choisis les mesures à appliquer. Chacune est journalisée."
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
                        <div className="divide-y divide-line border border-line rounded-lg mb-3">
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
