import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, SkipForward } from 'lucide-react';
import { listProfiles, validateProfile, ProfileStatus, type LoveProfile } from '../../../services/adminSbcLoveApi';
import { Badge, Button, Card, ConfirmSheet, EmptyState, ErrorState, KeyValue, ListSkeleton, MemberLink, SearchInput, notify } from '../../../ui';
import { formatDate, timeAgo } from '../../../lib/format';
import { useDebounced } from '../../../lib/hooks';
import { countryName } from '../../../lib/labels';
import { INTENTION, PHOTO_SLOTS, sexLabel } from './shared';

const REFUSE = [
    'Le visage n’est pas visible',
    'La photo en pied manque',
    'La description contient un numéro ou un lien',
    'Photo d’une autre personne',
    'Contenu inapproprié',
];

/** The photos at a size where a face is recognisable; tap one for the full file. */
export function Photos({ p }: { p: LoveProfile }) {
    if (!p.photos.length) return <Card className="text-center text-ink-2">Aucune photo.</Card>;
    return (
        <div className="grid grid-cols-2 gap-2">
            {[...p.photos].sort((a, b) => a.order - b.order).map((ph, i) => (
                <figure key={ph.fileId} className="min-w-0">
                    {ph.url ? (
                        <a href={ph.url} target="_blank" rel="noreferrer" className="block">
                            <img src={ph.url} alt={PHOTO_SLOTS[i] ?? `Photo ${i + 1}`} className="w-full aspect-[3/4] object-cover rounded-tile bg-surface-2" />
                        </a>
                    ) : <div className="w-full aspect-[3/4] rounded-tile bg-surface-2 grid place-items-center text-xs text-ink-3">Photo indisponible</div>}
                    <figcaption className="mt-1 text-xs text-ink-2">{PHOTO_SLOTS[i] ?? `Photo ${i + 1}`}</figcaption>
                </figure>
            ))}
        </div>
    );
}

/** Who is behind the profile and what it says. */
export function ProfileFacts({ p }: { p: LoveProfile }) {
    return (
        <div className="space-y-4">
            <MemberLink id={p.userId} name={p.memberName ?? p.displayName} sub={p.memberEmail} />
            <KeyValue items={[
                ['Prénom affiché', p.displayName || '—'],
                ['Sexe', sexLabel(p.sex)],
                ['Âge', p.ageBracket ?? '—'],
                ['Ville', [p.city, p.country ? countryName(p.country) : null].filter(Boolean).join(', ') || '—'],
                ['Intention', p.intention === 'autre' && p.otherIntentionText ? p.otherIntentionText : INTENTION[p.intention] ?? p.intention],
                ['Membre SBC depuis', p.memberSince ? formatDate(p.memberSince) : '—'],
                ['Signalements', p.moderation.reportCount ? <span className="text-danger">{p.moderation.reportCount}</span> : '0'],
            ]} />
            <div>
                <p className="text-sm font-semibold mb-1">Description</p>
                {p.description ? <p className="text-sm text-ink-2 whitespace-pre-line break-words">{p.description}</p> : <p className="text-sm text-ink-3">Aucune.</p>}
                <p className="mt-1.5 text-xs text-ink-3">Interdits : numéros, WhatsApp, réseaux sociaux, liens, e-mails.</p>
            </div>
            {p.moderation.rejectionReason && <KeyValue items={[['Motif du dernier refus', p.moderation.rejectionReason]]} />}
        </div>
    );
}

/**
 * New and edited profiles, one at a time, oldest first. Every edit by the member
 * sends the profile back here, so this queue never really ends. A search narrows
 * the queue to matching profiles — server-side, across every pending profile,
 * not just the batch on screen — so a member who asks can be found directly.
 */
export function ReviewTab() {
    const [search, setSearch] = useState('');
    const term = useDebounced(search.trim());
    return (
        <div className="space-y-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Chercher : pseudo, nom, e-mail, téléphone, ville" />
            <ReviewQueue key={term} term={term} />
        </div>
    );
}

function ReviewQueue({ term }: { term: string }) {
    const qc = useQueryClient();
    const q = useQuery({
        queryKey: ['sbclove', 'pending', term],
        queryFn: () => listProfiles({ status: ProfileStatus.PENDING, limit: 100, search: term || undefined }),
        refetchInterval: 60_000,
    });
    const [decided, setDecided] = useState<Set<string>>(new Set());
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    const [sheet, setSheet] = useState<'approve' | 'reject' | null>(null);

    const pending = useMemo(() => (q.data?.data ?? []).filter(p => !decided.has(p._id))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)), [q.data, decided]);
    const current = pending.find(p => !skipped.has(p._id)) ?? pending[0];
    const done = (id: string) => {
        setDecided(s => new Set(s).add(id));
        setSkipped(s => { const n = new Set(s); n.delete(id); return n; });
        qc.invalidateQueries({ queryKey: ['sbclove'] });
        qc.invalidateQueries({ queryKey: ['queue', 'love'] });
    };

    if (q.isLoading) return <ListSkeleton rows={3} />;
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    if (!current) return (
        term
            ? <Card><EmptyState title="Aucun profil à valider ne correspond">Vérifie l’orthographe, ou cherche dans l’onglet Profils (tous les statuts).</EmptyState></Card>
            : <Card><EmptyState icon={<CheckCircle2 size={26} className="text-success" />} title="Aucun profil à valider">Les nouveaux profils et les profils modifiés arrivent ici.</EmptyState></Card>
    );
    const name = current.displayName || current.memberName || 'ce profil';
    const total = q.data?.pagination.total ?? pending.length;

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
            <div className="space-y-3">
                {!current.meetsPhotoRequirement && (
                    <p className="text-sm text-warning bg-warning-soft rounded-tile px-3 py-2">
                        {current.photoCount} photo{current.photoCount > 1 ? 's' : ''} sur {current.minPhotos} : impossible de le publier. Refuse-le pour que le membre complète.
                    </p>
                )}
                <Photos p={current} />
            </div>
            <Card className="space-y-4 lg:sticky lg:top-20">
                <div className="flex items-center justify-between gap-2">
                    <Badge tone="warning">Reçu {timeAgo(current.updatedAt)}</Badge>
                    <span className="text-xs text-ink-3 tabular">{pending.indexOf(current) + 1} / {Math.max(total - decided.size, pending.length)}</span>
                </div>
                <ProfileFacts p={current} />
                <div className="space-y-2">
                    <Button variant="success" size="lg" full disabled={!current.meetsPhotoRequirement} onClick={() => setSheet('approve')}>Publier</Button>
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setSheet('reject')}>Refuser…</Button>
                        <Button variant="ghost" icon={<SkipForward size={16} />} disabled={pending.length < 2}
                            onClick={() => setSkipped(s => new Set(s).add(current._id))}>Passer</Button>
                    </div>
                </div>
            </Card>

            <ConfirmSheet open={sheet === 'approve'} onClose={() => setSheet(null)} tone="success" title={`Publier ${name} ?`}
                message={<p>Le profil devient visible pendant les sessions SBC Love et le membre peut manifester son intérêt.</p>}
                confirmLabel="Publier"
                onConfirm={async () => { await validateProfile(current._id, true); notify.success('Profil publié.'); done(current._id); }} />
            <ConfirmSheet open={sheet === 'reject'} onClose={() => setSheet(null)} tone="danger" title={`Refuser ${name} ?`}
                message={<p>Le membre voit son profil « Refusé » et peut le modifier pour le renvoyer. Le motif reste dans l’admin : le membre ne le voit pas.</p>}
                reason={{ label: 'Motif (pour l’équipe)', suggestions: REFUSE, minLength: 5 }}
                confirmLabel="Refuser"
                onConfirm={async (reason) => { await validateProfile(current._id, false, reason); notify.success('Profil refusé.'); done(current._id); }} />
        </div>
    );
}
