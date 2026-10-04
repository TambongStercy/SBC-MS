import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, SkipForward } from 'lucide-react';
import ReviewVideoPlayer from '../../components/common/ReviewVideoPlayer';
import { approveManualVerification, getManualVerifications, rejectManualVerification, type ManualVerification } from '../../api/adsNetwork';
import { Badge, Button, ButtonLink, Card, ConfirmSheet, EmptyState, ErrorState, Input, KeyValue, ListSkeleton, Page, notify } from '../../ui';
import { formatNumber, formatPhone, timeAgo } from '../../lib/format';

const REFUSE_REASONS = [
    'Le code n’apparaît pas dans la vidéo',
    'Le code ne correspond pas',
    'Le nombre de vues est illisible',
    'La vidéo est coupée ou trop courte',
    'Ce n’est pas le bon statut',
];

/**
 * The video-proof queue, one recording at a time (≈155 decisions a day, mostly
 * on phones). The recording must show the code we issued, then the status
 * views: the admin checks the code, types the views read, and validates —
 * which credits the diffuseur — or refuses with a reason the diffuseur sees.
 */
export default function ProofQueuePage() {
    const qc = useQueryClient();
    const list = useQuery({ queryKey: ['proofs'], queryFn: getManualVerifications, refetchInterval: 60_000 });
    const [decided, setDecided] = useState<Set<string>>(new Set());
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    const [views, setViews] = useState('');
    const [sheet, setSheet] = useState<'approve' | 'refuse' | 'ban' | null>(null);
    const viewsRef = useRef<HTMLInputElement>(null);

    // Oldest first; decided ones disappear at once, skipped ones go to the back.
    const pending = useMemo(() => (list.data ?? [])
        .filter(i => !decided.has(i.manualVerificationId))
        .sort((a, b) => (a.uploadedAt || a.codeIssuedAt).localeCompare(b.uploadedAt || b.codeIssuedAt)), [list.data, decided]);
    const current: ManualVerification | undefined = pending.find(i => !skipped.has(i.manualVerificationId)) ?? pending[0];
    const next = pending.find(i => i !== current && !skipped.has(i.manualVerificationId));

    useEffect(() => { setViews(''); }, [current?.manualVerificationId]);

    const done = (id: string) => {
        setDecided(s => new Set(s).add(id));
        setSkipped(s => { const n = new Set(s); n.delete(id); return n; });
        qc.invalidateQueries({ queryKey: ['queue', 'proofs'] });
    };

    const count = Number(views);
    const viewsValid = views.trim() !== '' && Number.isInteger(count) && count >= 0;

    // Keyboard on a computer: V validate, R refuse, S skip.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (sheet || !current) return;
            const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
            if (typing) return;
            if (e.key === 'v' || e.key === 'V') { e.preventDefault(); viewsValid ? setSheet('approve') : viewsRef.current?.focus(); }
            if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setSheet('refuse'); }
            if (e.key === 's' || e.key === 'S') { e.preventDefault(); setSkipped(s => new Set(s).add(current.manualVerificationId)); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [sheet, current, viewsValid]);

    const position = current ? pending.indexOf(current) + 1 : 0;

    return (
        <Page title="Vérifications vidéo" back="/" width="wide"
            subtitle={list.data ? (pending.length ? `${pending.length} en attente` : 'Aucune en attente') : undefined}>
            {list.isLoading ? <ListSkeleton rows={3} /> : list.isError ? (
                <ErrorState message="Impossible de charger les vérifications." onRetry={() => list.refetch()} />
            ) : !current ? (
                <Card>
                    <EmptyState icon={<CheckCircle2 size={26} className="text-success" />} title="Tout est vérifié">
                        Les nouvelles vidéos apparaîtront ici.
                    </EmptyState>
                    <div className="flex justify-center pb-4"><ButtonLink to="/" variant="secondary">Retour à l’accueil</ButtonLink></div>
                </Card>
            ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
                    <div className="space-y-2">
                        {current.videoUrl ? (
                            <>
                                <ReviewVideoPlayer key={current.manualVerificationId} src={current.videoUrl} />
                                <a href={current.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                                    <ExternalLink size={14} />La vidéo ne se lance pas ? Ouvrir dans un nouvel onglet
                                </a>
                            </>
                        ) : (
                            <Card className="text-center text-ink-2">Vidéo indisponible : refuse-la pour que le diffuseur recommence.</Card>
                        )}
                        {/* Ready the next recording's first bytes (metadata only, light on mobile data). */}
                        {next?.videoUrl && <video src={next.videoUrl} preload="metadata" muted className="hidden" aria-hidden />}
                    </div>

                    <Card className="space-y-4 lg:sticky lg:top-20">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-bold text-ink truncate">{current.diffuseurName}</p>
                                <p className="text-sm text-ink-2">{current.diffuseurPhone ? formatPhone(current.diffuseurPhone) : '—'}</p>
                            </div>
                            <span className="text-xs text-ink-3 tabular shrink-0">{position} / {pending.length}</span>
                        </div>
                        <div className="rounded-tile bg-primary-soft px-4 py-3 text-center">
                            <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider">Code à voir dans la vidéo</p>
                            <p className="text-3xl font-extrabold tracking-[0.25em] text-primary tabular">{current.code}</p>
                        </div>
                        <KeyValue items={[
                            ['Campagne', current.isTestCampaign ? <Badge tone="accent">Campagne test</Badge> : current.campaignTitle],
                            ['Jour', `Jour ${current.day}`],
                            ['Code émis', timeAgo(current.codeIssuedAt)],
                            current.uploadedAt ? ['Vidéo reçue', timeAgo(current.uploadedAt)] : null,
                        ]} />
                        <Input ref={viewsRef} label="Vues lues dans la vidéo" type="number" inputMode="numeric" min={0} placeholder="ex. 262"
                            value={views} onChange={e => setViews(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && viewsValid) setSheet('approve'); }}
                            className="text-lg font-bold" />
                        <div className="space-y-2">
                            <Button variant="success" size="lg" full disabled={!viewsValid} onClick={() => setSheet('approve')}>
                                Valider{viewsValid ? ` · ${formatNumber(count)} vues` : ''}
                            </Button>
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="secondary" onClick={() => setSheet('refuse')}>Refuser…</Button>
                                <Button variant="ghost" icon={<SkipForward size={16} />} disabled={pending.length < 2}
                                    onClick={() => setSkipped(s => new Set(s).add(current.manualVerificationId))}>Passer</Button>
                            </div>
                            <button type="button" onClick={() => setSheet('ban')} className="w-full text-center text-sm font-semibold text-danger py-1 hover:underline">
                                Refuser et bannir…
                            </button>
                        </div>
                        <p className="hidden lg:block text-xs text-ink-3">Raccourcis : V valider · R refuser · S passer</p>
                    </Card>
                </div>
            )}

            {current && (
                <>
                    <ConfirmSheet open={sheet === 'approve'} onClose={() => setSheet(null)} tone="success"
                        title={`Valider le jour ${current.day} ?`}
                        message={<p><b className="text-ink">{formatNumber(count)} vues</b> seront créditées à {current.diffuseurName}.</p>}
                        confirmLabel="Valider"
                        onConfirm={async () => {
                            await approveManualVerification(current.manualVerificationId, count);
                            notify.success(`Jour ${current.day} validé : ${formatNumber(count)} vues pour ${current.diffuseurName}.`);
                            done(current.manualVerificationId);
                        }} />
                    <ConfirmSheet open={sheet === 'refuse'} onClose={() => setSheet(null)} tone="danger"
                        title="Refuser cette vidéo ?"
                        message={<p>{current.diffuseurName} verra le motif et pourra recommencer.</p>}
                        reason={{ label: 'Motif (visible par le diffuseur)', suggestions: REFUSE_REASONS, minLength: 5 }}
                        confirmLabel="Refuser"
                        onConfirm={async (reason) => {
                            await rejectManualVerification(current.manualVerificationId, reason, false);
                            notify.success('Vidéo refusée. Le diffuseur peut recommencer.');
                            done(current.manualVerificationId);
                        }} />
                    <ConfirmSheet open={sheet === 'ban'} onClose={() => setSheet(null)} tone="danger"
                        title={`Bannir ${current.diffuseurName} ?`}
                        message={<p>La vidéo est refusée et {current.diffuseurName} ne pourra plus prendre de campagne. Réserve-le à la fraude.</p>}
                        reason={{ label: 'Motif du bannissement', suggestions: ['Vidéo truquée', 'Vues falsifiées', 'Code réutilisé'], minLength: 5 }}
                        confirmLabel="Refuser et bannir"
                        onConfirm={async (reason) => {
                            await rejectManualVerification(current.manualVerificationId, reason, true);
                            notify.success(`${current.diffuseurName} est banni du réseau diffuseur.`);
                            done(current.manualVerificationId);
                        }} />
                </>
            )}
        </Page>
    );
}
