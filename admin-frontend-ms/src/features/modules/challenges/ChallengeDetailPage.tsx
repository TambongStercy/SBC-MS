import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trophy } from 'lucide-react';
import { MemberById } from '../../members/MemberById';
import { MemberPicker } from '../../members/MemberPicker';
import type { Member } from '../../members/api';
import { uploadAdsFile } from '../../../api/adsNetwork';
import { Badge, Button, Card, ConfirmSheet, DataList, EmptyState, ErrorState, Input, KeyValue, MemberLink, Page, Pagination, SectionTitle, Sheet, Skeleton, StatusBadge, Tabs, Textarea, notify, type Column } from '../../../ui';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { monthName } from '../tombola/api';
import {
    PAYMENT, STATUS, addEntrepreneur, approveEntrepreneur, closeVoting, deleteChallenge, deleteEntrepreneur, descriptionFr, distributeFunds,
    getChallenge, getFundSummary, listVotes, setChallengeStatus, updateChallenge, updateEntrepreneur,
    type Challenge, type Entrepreneur, type EntrepreneurInput, type Vote,
} from './api';

const API = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api';
const MAX_ENTREPRENEURS = 3;

function EntrepreneurSheet({ challengeId, e, onClose }: { challengeId: string; e: Entrepreneur | null; onClose: () => void }) {
    const qc = useQueryClient();
    const [f, setF] = useState({
        name: e?.name ?? '', email: e?.email ?? '', phoneNumber: e?.phoneNumber ?? '', country: e?.country ?? 'CM', city: e?.city ?? '',
        projectName: e?.projectName ?? '', businessCategory: e?.businessCategory ?? '', fr: e?.projectDescription.fr ?? '', en: e?.projectDescription.en ?? '',
    });
    const [member, setMember] = useState<Member | null>(null);
    const [video, setVideo] = useState<{ url: string; filename: string; duration?: number } | null>(e ? { url: e.videoUrl, filename: e.videoFilename, duration: e.videoDuration } : null);
    const [progress, setProgress] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setError(null); };

    const pickVideo = async (file: File) => {
        setError(null);
        // Read the duration locally first: the service refuses videos over 90 s.
        const duration = await new Promise<number | undefined>(res => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.onloadedmetadata = () => { res(Number.isFinite(v.duration) ? Math.round(v.duration) : undefined); URL.revokeObjectURL(v.src); };
            v.onerror = () => res(undefined);
            v.src = URL.createObjectURL(file);
        });
        if (duration && duration > 90) { setError(`La vidéo dure ${duration} s : 90 s au plus.`); return; }
        setProgress(0);
        try {
            const fileId = await uploadAdsFile(file, setProgress);
            setVideo({ url: `${API}/settings/files/${encodeURIComponent(fileId)}`, filename: file.name, duration });
        } catch (err) { setError(errorMessage(err)); }
        finally { setProgress(null); }
    };

    const save = async () => {
        const missing = (['name', 'email', 'phoneNumber', 'country', 'city', 'projectName', 'businessCategory', 'fr', 'en'] as const).filter(k => !f[k].trim());
        if (missing.length) { setError('Tous les champs sont demandés, description en français et en anglais comprise.'); return; }
        if (!video) { setError('Ajoute la vidéo de présentation.'); return; }
        const body: EntrepreneurInput = {
            name: f.name.trim(), email: f.email.trim(), phoneNumber: f.phoneNumber.trim(), country: f.country.trim().toUpperCase(), city: f.city.trim(),
            projectName: f.projectName.trim(), businessCategory: f.businessCategory.trim(), projectDescription: { fr: f.fr.trim(), en: f.en.trim() },
            videoUrl: video.url, videoFilename: video.filename, videoDuration: video.duration,
            ...(member ? { userId: member._id } : {}),
        };
        setBusy(true); setError(null);
        try {
            if (e) await updateEntrepreneur(e._id, body); else await addEntrepreneur(challengeId, body);
            await qc.invalidateQueries({ queryKey: ['challenges'] });
            notify.success(e ? 'Entrepreneur modifié.' : 'Entrepreneur ajouté. Approuve-le pour qu’on puisse voter pour lui.');
            onClose();
        } catch (err) { setError(errorMessage(err)); }
        finally { setBusy(false); }
    };

    return (
        <Sheet open onClose={onClose} busy={busy || progress !== null} size="lg" title={e ? `Modifier ${e.name}` : 'Ajouter un entrepreneur'}
            footer={<div className="flex justify-end"><Button onClick={save} loading={busy} disabled={progress !== null}>Enregistrer</Button></div>}>
            <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                    <Input label="Nom complet" value={f.name} onChange={ev => set('name', ev.target.value)} />
                    <Input label="Projet" value={f.projectName} onChange={ev => set('projectName', ev.target.value)} />
                    <Input label="E-mail" type="email" value={f.email} onChange={ev => set('email', ev.target.value)} />
                    <Input label="Téléphone" type="tel" value={f.phoneNumber} onChange={ev => set('phoneNumber', ev.target.value)} />
                    <Input label="Pays (code, ex. CM)" value={f.country} maxLength={2} onChange={ev => set('country', ev.target.value)} />
                    <Input label="Ville" value={f.city} onChange={ev => set('city', ev.target.value)} />
                </div>
                <Input label="Secteur" value={f.businessCategory} onChange={ev => set('businessCategory', ev.target.value)} placeholder="Agriculture, couture, transport…" />
                <Textarea label="Le projet (français)" rows={3} value={f.fr} onChange={ev => set('fr', ev.target.value)} />
                <Textarea label="Le projet (anglais)" rows={3} value={f.en} onChange={ev => set('en', ev.target.value)} />
                <div>
                    <p className="text-sm font-semibold mb-1.5">Vidéo de présentation (90 s au plus)</p>
                    {video && <video src={video.url} controls playsInline preload="metadata" className="w-full max-h-64 rounded-tile bg-black mb-2" />}
                    <label className="inline-flex">
                        <input type="file" accept="video/*" className="sr-only" disabled={progress !== null} onChange={ev => { const file = ev.target.files?.[0]; ev.target.value = ''; if (file) pickVideo(file); }} />
                        <span className="inline-flex items-center h-9 px-3 rounded-pill border border-border text-sm font-semibold cursor-pointer hover:bg-surface-2">
                            {progress !== null ? `Envoi… ${progress} %` : video ? 'Remplacer la vidéo' : 'Choisir la vidéo'}
                        </span>
                    </label>
                </div>
                <div>
                    <p className="text-sm font-semibold mb-1.5">Compte SBC de l’entrepreneur</p>
                    {e?.userId && !member && <div className="mb-2"><MemberById id={e.userId} /></div>}
                    <MemberPicker value={member} onChange={setMember} />
                    <p className="mt-1 text-xs text-ink-3">Indispensable pour lui verser ses gains s’il gagne : l’argent arrive sur ce compte.</p>
                </div>
                {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
            </div>
        </Sheet>
    );
}

function EditChallenge({ c, onClose }: { c: Challenge; onClose: () => void }) {
    const qc = useQueryClient();
    const desc = typeof c.description === 'string' ? { fr: c.description, en: '' } : { fr: c.description?.fr ?? '', en: c.description?.en ?? '' };
    const [f, setF] = useState({ campaignName: c.campaignName, startDate: c.startDate.slice(0, 10), endDate: c.endDate.slice(0, 10), fr: desc.fr, en: desc.en });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const save = async () => {
        if (!f.campaignName.trim() || !f.fr.trim() || !f.en.trim()) { setError('Nom et description (français et anglais) sont demandés.'); return; }
        if (f.endDate <= f.startDate) { setError('La fin doit venir après le début.'); return; }
        setBusy(true); setError(null);
        try {
            await updateChallenge(c._id, { campaignName: f.campaignName.trim(), startDate: f.startDate, endDate: f.endDate, description: { fr: f.fr.trim(), en: f.en.trim() } });
            await qc.invalidateQueries({ queryKey: ['challenges'] });
            notify.success('Challenge modifié.');
            onClose();
        } catch (e) { setError(errorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <Sheet open onClose={onClose} busy={busy} title="Modifier le challenge"
            footer={<div className="flex justify-end"><Button onClick={save} loading={busy}>Enregistrer</Button></div>}>
            <div className="space-y-3">
                <Input label="Nom" value={f.campaignName} onChange={e => setF({ ...f, campaignName: e.target.value })} />
                <div className="grid sm:grid-cols-2 gap-3">
                    <Input label="Début" type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />
                    <Input label="Fin" type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} />
                </div>
                <Textarea label="Description (français)" rows={3} value={f.fr} onChange={e => setF({ ...f, fr: e.target.value })} />
                <Textarea label="Description (anglais)" rows={3} value={f.en} onChange={e => setF({ ...f, en: e.target.value })} />
                {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
            </div>
        </Sheet>
    );
}

function Votes({ c, names }: { c: Challenge; names: Record<string, string> }) {
    const [page, setPage] = useState(1);
    const q = useQuery({ queryKey: ['challenges', 'votes', c._id, page], queryFn: () => listVotes(c._id, page, 20), placeholderData: keepPreviousData });
    const who = (v: Vote) => (v.userId ? <MemberById id={v.userId} /> : <MemberLink name={v.isAnonymous ? 'Anonyme' : v.supporterName || 'Soutien'} phone={v.supporterPhone} link={false} />);
    const cols: Column<Vote>[] = [
        { key: 'w', header: 'Par', cell: who },
        { key: 'e', header: 'Pour', cell: v => <span className="text-ink-2">{names[v.entrepreneurId] ?? '—'}</span> },
        { key: 't', header: 'Type', cell: v => <Badge tone={v.voteType === 'vote' ? 'primary' : 'accent'}>{v.voteType === 'vote' ? `${v.voteQuantity} vote${v.voteQuantity > 1 ? 's' : ''}` : 'Soutien'}</Badge> },
        { key: 'a', header: 'Montant', align: 'right', cell: v => <span className="font-semibold tabular">{formatMoney(v.amountPaid)}</span> },
        { key: 's', header: 'Paiement', cell: v => <StatusBadge status={v.paymentStatus} labels={PAYMENT} /> },
        { key: 'd', header: 'Date', cell: v => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(v.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <DataList rows={q.data?.votes} columns={cols} rowKey={v => v._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                empty={<EmptyState title="Aucun vote pour l’instant" />}
                card={v => (
                    <span className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">{who(v)}<span className="mt-1 block text-xs text-ink-2">pour {names[v.entrepreneurId] ?? '—'} · {formatDateTime(v.createdAt)}</span></span>
                        <span className="text-right shrink-0"><span className="block font-semibold tabular">{formatMoney(v.amountPaid)}</span><StatusBadge status={v.paymentStatus} labels={PAYMENT} /></span>
                    </span>
                )} />
            {q.data && q.data.total > 20 && <Pagination page={page} totalPages={Math.ceil(q.data.total / 20)} total={q.data.total} onChange={setPage} />}
        </div>
    );
}

type Action = 'open' | 'close' | 'distribute' | 'cancel' | 'delete' | 'edit';

/** One Impact Challenge, from draft to payout. */
export default function ChallengeDetailPage() {
    const id = useParams().challengeId!;
    const navigate = useNavigate();
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['challenges', 'one', id], queryFn: () => getChallenge(id) });
    const [tab, setTab] = useState<'entrepreneurs' | 'votes'>('entrepreneurs');
    const [action, setAction] = useState<Action | null>(null);
    const [editing, setEditing] = useState<Entrepreneur | 'new' | null>(null);
    const [entAction, setEntAction] = useState<{ kind: 'approve' | 'delete'; e: Entrepreneur } | null>(null);
    const fund = useQuery({ queryKey: ['challenges', 'fund', id], queryFn: () => getFundSummary(id), enabled: q.data?.challenge.status === 'voting_closed' });

    if (q.isError) return <Page title="Impact Challenge" back="/modules/impact-challenge"><ErrorState onRetry={() => q.refetch()} /></Page>;
    if (!q.data) return <Page title="Impact Challenge" back="/modules/impact-challenge"><Skeleton className="h-64" /></Page>;
    const { challenge: c, entrepreneurs } = q.data;
    const refresh = () => qc.invalidateQueries({ queryKey: ['challenges'] });
    const names = Object.fromEntries(entrepreneurs.map(e => [e._id, e.name]));
    const approved = entrepreneurs.filter(e => e.approved).length;
    const editable = c.status === 'draft' || c.status === 'active';
    const canDelete = (c.status === 'draft' || c.status === 'cancelled') && c.totalVoteCount === 0;
    const sorted = [...entrepreneurs].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.voteCount - a.voteCount);
    const f = fund.data;

    return (
        <Page title={c.campaignName} subtitle={`${monthName(c.month)} ${c.year}`} back="/modules/impact-challenge">
            <div className="space-y-5">
                <Card className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={c.status} labels={STATUS} />
                        {editable && <Button size="sm" variant="ghost" onClick={() => setAction('edit')}>Modifier</Button>}
                    </div>
                    <KeyValue items={[
                        ['Collecté', <span className="text-success">{formatMoney(c.totalCollected)}</span>],
                        ['Votes', formatNumber(c.totalVoteCount)],
                        ['Période', `${formatDate(c.startDate)} → ${formatDate(c.endDate)}`],
                        ['Tombola liée', <Link to={`/modules/tombola/tirage/${c.tombolaMonthId}`} className="text-primary hover:underline">Voir la tombola</Link>],
                        c.status === 'funds_distributed' ? ['Versé au gagnant', formatMoney(c.winnerPayoutAmount)] : null,
                        c.status === 'funds_distributed' ? ['Cagnotte tombola', formatMoney(c.lotteryPoolAmount)] : null,
                        c.status === 'funds_distributed' ? ['Commission SBC', formatMoney(c.commissionAmount)] : null,
                        c.distributionDate ? ['Versé le', formatDateTime(c.distributionDate)] : null,
                    ]} />
                    {descriptionFr(c.description) && <p className="text-sm text-ink-2 whitespace-pre-line">{descriptionFr(c.description)}</p>}
                    <div className="flex flex-wrap gap-2">
                        {c.status === 'draft' && <Button onClick={() => setAction('open')}>Ouvrir les votes…</Button>}
                        {c.status === 'active' && <Button onClick={() => setAction('close')}>Clore les votes…</Button>}
                        {c.status === 'voting_closed' && <Button variant="success" onClick={() => setAction('distribute')} disabled={!f}>Verser les fonds…</Button>}
                        {['draft', 'active', 'voting_closed'].includes(c.status) && <Button variant="danger-soft" onClick={() => setAction('cancel')}>Annuler…</Button>}
                        {canDelete && <Button variant="ghost" onClick={() => setAction('delete')}>Supprimer…</Button>}
                    </div>
                </Card>

                <Tabs value={tab} onChange={setTab} items={[{ value: 'entrepreneurs', label: `Entrepreneurs (${entrepreneurs.length})` }, { value: 'votes', label: 'Votes' }]} />
                {tab === 'votes' ? <Votes c={c} names={names} /> : (
                    <section className="space-y-3">
                        {sorted.length === 0 ? <Card><EmptyState title="Aucun entrepreneur">Ajoute jusqu’à {MAX_ENTREPRENEURS} entrepreneurs avec leur vidéo.</EmptyState></Card> : sorted.map(e => (
                            <Card key={e._id} className="space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-bold flex items-center gap-1.5">{e.isWinner && <Trophy size={16} className="text-warning" />}{e.name}</p>
                                        <p className="text-sm text-ink-2">{e.projectName} · {e.businessCategory} · {e.city}</p>
                                    </div>
                                    {e.approved ? <Badge tone="success">Approuvé</Badge> : <Badge tone="warning">À approuver</Badge>}
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                    <span><b className="tabular">{formatNumber(e.voteCount)}</b> votes</span>
                                    <span><b className="tabular">{formatMoney(e.totalAmount)}</b></span>
                                    {e.rank && <span className="text-ink-2">{e.rank === 1 ? '1er' : `${e.rank}e`}</span>}
                                    {!e.userId && <span className="text-warning">Pas de compte SBC lié</span>}
                                </div>
                                {e.videoUrl && <video src={e.videoUrl} controls playsInline preload="none" className="w-full max-h-60 rounded-tile bg-black" />}
                                {editable && (
                                    <div className="flex flex-wrap gap-2">
                                        {!e.approved && <Button size="sm" variant="success" onClick={() => setEntAction({ kind: 'approve', e })}>Approuver</Button>}
                                        <Button size="sm" variant="secondary" onClick={() => setEditing(e)}>Modifier</Button>
                                        {e.voteCount === 0 && <Button size="sm" variant="ghost" onClick={() => setEntAction({ kind: 'delete', e })}>Retirer…</Button>}
                                    </div>
                                )}
                            </Card>
                        ))}
                        {editable && entrepreneurs.length < MAX_ENTREPRENEURS && (
                            <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Ajouter un entrepreneur</Button>
                        )}
                    </section>
                )}
            </div>

            {action === 'edit' && <EditChallenge c={c} onClose={() => setAction(null)} />}
            {editing && <EntrepreneurSheet challengeId={c._id} e={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

            <ConfirmSheet open={action === 'open'} onClose={() => setAction(null)} tone="success" title="Ouvrir les votes ?"
                message={<>
                    <p>Le challenge apparaît dans l’app : les membres paient pour voter et chaque vote leur donne aussi des billets de la tombola du mois.</p>
                    {approved === 0 ? <p className="text-warning">Aucun entrepreneur n’est approuvé : personne ne pourra voter tant que tu n’en approuves pas.</p>
                        : <p>{approved} entrepreneur{approved > 1 ? 's' : ''} approuvé{approved > 1 ? 's' : ''} sur {entrepreneurs.length}.</p>}
                </>}
                confirmLabel="Ouvrir les votes"
                onConfirm={async () => { await setChallengeStatus(c._id, 'active'); notify.success('Votes ouverts.'); refresh(); }} />
            <ConfirmSheet open={action === 'close'} onClose={() => setAction(null)} title="Clore les votes ?"
                message={<p>Plus aucun vote n’est accepté. Les entrepreneurs sont classés par nombre de votes et le premier est désigné gagnant. C’est définitif.</p>}
                confirmLabel="Clore les votes"
                onConfirm={async () => { await closeVoting(c._id); notify.success('Votes clos, gagnant désigné.'); refresh(); }} />
            <ConfirmSheet open={action === 'distribute'} onClose={() => setAction(null)} tone="success" title="Verser les fonds ?"
                message={f ? <>
                    <p>Sur {formatMoney(f.totalCollected)} collectés :</p>
                    <KeyValue items={[
                        [`${f.winner?.name ?? 'Gagnant'} (50 %)`, formatMoney(f.winnerPayout)],
                        ['Cagnotte tombola (30 %)', formatMoney(f.lotteryPool)],
                        ['Commission SBC (20 %)', formatMoney(f.commission)],
                    ]} />
                    {f.winner?.userId ? <p>La part du gagnant est créditée sur le solde de son compte SBC. C’est définitif.</p>
                        : <p className="text-danger">Le gagnant n’a pas de compte SBC lié : le versement sera refusé. Lie son compte avec « Modifier » d’abord.</p>}
                </> : null}
                confirmLabel="Verser"
                onConfirm={async () => { await distributeFunds(c._id); notify.success('Fonds versés.'); refresh(); }} />
            <ConfirmSheet open={action === 'cancel'} onClose={() => setAction(null)} tone="danger" title="Annuler ce challenge ?"
                message={<p>Les votes s’arrêtent et rien n’est versé. {c.totalCollected > 0 ? `Les ${formatMoney(c.totalCollected)} déjà payés ne sont pas remboursés automatiquement.` : ''} C’est définitif.</p>}
                confirmLabel="Annuler le challenge"
                onConfirm={async () => { await setChallengeStatus(c._id, 'cancelled'); notify.success('Challenge annulé.'); refresh(); }} />
            <ConfirmSheet open={action === 'delete'} onClose={() => setAction(null)} tone="danger" title="Supprimer ce challenge ?"
                message={<p>Il disparaît de la liste. La tombola liée reste.</p>}
                confirmLabel="Supprimer"
                onConfirm={async () => { await deleteChallenge(c._id); notify.success('Challenge supprimé.'); refresh(); navigate('/modules/impact-challenge'); }} />
            <ConfirmSheet open={entAction?.kind === 'approve'} onClose={() => setEntAction(null)} tone="success" title={`Approuver ${entAction?.e.name} ?`}
                message={<p>Les membres pourront voter pour son projet{c.status === 'active' ? ' dès maintenant' : ' quand les votes seront ouverts'}.</p>}
                confirmLabel="Approuver"
                onConfirm={async () => { await approveEntrepreneur(entAction!.e._id); notify.success('Entrepreneur approuvé.'); refresh(); }} />
            <ConfirmSheet open={entAction?.kind === 'delete'} onClose={() => setEntAction(null)} tone="danger" title={`Retirer ${entAction?.e.name} ?`}
                message={<p>Il n’a encore reçu aucun vote. Il disparaît du challenge.</p>}
                confirmLabel="Retirer"
                onConfirm={async () => { await deleteEntrepreneur(entAction!.e._id); notify.success('Entrepreneur retiré.'); refresh(); }} />
        </Page>
    );
}
