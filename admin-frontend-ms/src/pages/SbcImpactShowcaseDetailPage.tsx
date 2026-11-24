import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, Award01Icon, LinkSquare02Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { usePermission } from '../hooks/usePermission';
import { Badge, Button, Field, Input, PageHeader, Panel, PanelBody, PanelHeader, Skeleton } from '../components/ui';
import {
    ConfirmDialog, DetailList, ErrorState, Notice, formatDate, type ConfirmOptions,
} from '../components/moduleKit';
import ShowcaseNewsDialog from '../components/sbcImpact/ShowcaseNewsDialog';
import ShowcaseUpdateCard from '../components/sbcImpact/ShowcaseUpdateCard';
import { CandidatePhoto } from '../components/sbcImpact/shared';
import { showcaseResultText } from '../components/sbcImpact/showcaseFormat';
import {
    editShowcase, getShowcase, httpsUrlError, impactErrorMessage, readImpactError, showcaseMinEnd, showcasePublicUrl,
    youtubeUrlError, type ShowcaseDetail, type ShowcaseEdit,
} from '../services/impactV2Api';

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date → "YYYY-MM-DD" in local time (for <input type="date">). */
const dayInput = (d: Date | string) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
/** "YYYY-MM-DD" → the end of that day, local time, as ISO: the page stays visible all of that day. */
const endOfDayIso = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString(); };

type LinkKey = 'podcast.url' | 'youtubeUrl' | 'shopUrl';

/** Podcast, YouTube, shop or site; '' removes a link. Only the changed links are sent. */
function LinksPanel({ page, canWrite, onSaved }: { page: ShowcaseDetail; canWrite: boolean; onSaved: () => void }) {
    const [podcastUrl, setPodcastUrl] = useState(page.podcast?.url ?? '');
    const [podcastTitle, setPodcastTitle] = useState(page.podcast?.title ?? '');
    const [podcastPlatform, setPodcastPlatform] = useState(page.podcast?.platform ?? '');
    const [youtube, setYoutube] = useState(page.youtubeUrl ?? '');
    const [shop, setShop] = useState(page.shopUrl ?? '');
    const [errors, setErrors] = useState<Partial<Record<LinkKey, string>>>({});
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setPodcastUrl(page.podcast?.url ?? ''); setPodcastTitle(page.podcast?.title ?? ''); setPodcastPlatform(page.podcast?.platform ?? '');
        setYoutube(page.youtubeUrl ?? ''); setShop(page.shopUrl ?? '');
    }, [page.podcast?.url, page.podcast?.title, page.podcast?.platform, page.youtubeUrl, page.shopUrl]);

    const body: ShowcaseEdit = {};
    const podcastChanged = podcastUrl.trim() !== (page.podcast?.url ?? '') || podcastTitle.trim() !== (page.podcast?.title ?? '') || podcastPlatform.trim() !== (page.podcast?.platform ?? '');
    if (podcastChanged) body.podcast = podcastUrl.trim() ? { url: podcastUrl.trim(), title: podcastTitle.trim(), platform: podcastPlatform.trim() } : null;
    if (youtube.trim() !== (page.youtubeUrl ?? '')) body.youtubeUrl = youtube.trim();
    if (shop.trim() !== (page.shopUrl ?? '')) body.shopUrl = shop.trim();
    const dirty = Object.keys(body).length > 0;

    const save = async () => {
        const errs: Partial<Record<LinkKey, string>> = {};
        const p = httpsUrlError(podcastUrl); if (p) errs['podcast.url'] = p;
        const y = youtubeUrlError(youtube); if (y) errs.youtubeUrl = y;
        const s = httpsUrlError(shop); if (s) errs.shopUrl = s;
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setSaving(true);
        try {
            await editShowcase(page._id, body);
            toast.success('Liens enregistrés.');
            onSaved();
        } catch (err) {
            const x = readImpactError(err, 'Les liens n’ont pas pu être enregistrés.');
            const f = x.fields[0] as LinkKey | undefined;
            if (f && ['podcast.url', 'youtubeUrl', 'shopUrl'].includes(f)) setErrors({ [f]: x.message });
            else toast.error(x.message);
        } finally {
            setSaving(false);
        }
    };

    const ctl = 'h-11 sm:h-9';
    return (
        <Panel>
            <PanelHeader title="Liens" description="Laissez un champ vide pour retirer le lien. Adresses https uniquement." />
            <PanelBody className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Podcast (adresse)" error={errors['podcast.url']} className="sm:col-span-3">
                        <Input type="url" inputMode="url" className={ctl} value={podcastUrl} onChange={e => setPodcastUrl(e.target.value)} disabled={!canWrite} placeholder="https://" />
                    </Field>
                    <Field label="Titre du podcast" className="sm:col-span-2">
                        <Input className={ctl} value={podcastTitle} onChange={e => setPodcastTitle(e.target.value)} disabled={!canWrite || !podcastUrl.trim()} maxLength={160} />
                    </Field>
                    <Field label="Plateforme">
                        <Input className={ctl} value={podcastPlatform} onChange={e => setPodcastPlatform(e.target.value)} disabled={!canWrite || !podcastUrl.trim()} maxLength={60} placeholder="ex. Spotify" />
                    </Field>
                </div>
                <Field label="Vidéo YouTube" error={errors.youtubeUrl} help="youtube.com ou youtu.be.">
                    <Input type="url" inputMode="url" className={ctl} value={youtube} onChange={e => setYoutube(e.target.value)} disabled={!canWrite} placeholder="https://www.youtube.com/watch?v=…" />
                </Field>
                <Field label="Boutique SBC ou site" error={errors.shopUrl}>
                    <Input type="url" inputMode="url" className={ctl} value={shop} onChange={e => setShop(e.target.value)} disabled={!canWrite} placeholder="https://" />
                </Field>
                {canWrite && (
                    <div className="flex justify-end">
                        <Button variant="primary" size="lg" onClick={() => void save()} loading={saving} disabled={!dirty}>Enregistrer les liens</Button>
                    </div>
                )}
            </PanelBody>
        </Panel>
    );
}

/** The end date (never under the minimum) and hiding the page. */
function VisibilityPanel({ page, minEnd, canWrite, onSaved, ask }: {
    page: ShowcaseDetail; minEnd: Date; canWrite: boolean; onSaved: () => void; ask: (o: ConfirmOptions) => void;
}) {
    const [until, setUntil] = useState(dayInput(page.visibleUntil));
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => { setUntil(dayInput(page.visibleUntil)); }, [page.visibleUntil]);
    const minDay = dayInput(minEnd);
    const hidden = page.hidden ?? !!page.hiddenAt;

    const extend = async () => {
        if (!until) { setError('Choisissez une date.'); return; }
        if (until < minDay) { setError(`La page reste visible au moins jusqu’au ${formatDate(minEnd)}.`); return; }
        setSaving(true);
        setError(null);
        try {
            await editShowcase(page._id, { visibleUntil: endOfDayIso(until) });
            toast.success(`Page visible jusqu’au ${formatDate(endOfDayIso(until))}.`);
            onSaved();
        } catch (err) {
            // TOO_EARLY: the server's own minimum.
            setError(readImpactError(err, 'La date n’a pas pu être enregistrée.').message);
        } finally {
            setSaving(false);
        }
    };

    const askHide = () => ask({
        title: 'Masquer la page ?',
        confirmLabel: 'Masquer la page',
        description: 'La page n’apparaît plus nulle part publiquement, jusqu’à ce que vous l’affichiez à nouveau. Rien n’est supprimé.',
        reason: { label: 'Raison', required: true, minLength: 10 },
        onConfirm: async (reason: string) => {
            try {
                await editShowcase(page._id, { hidden: true, hiddenReason: reason });
                toast.success('Page masquée.');
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'La page n’a pas pu être masquée.'));
            } finally {
                onSaved();
            }
        },
    });
    const askShow = () => ask({
        title: 'Afficher la page à nouveau ?',
        tone: 'primary',
        confirmLabel: 'Afficher à nouveau',
        description: new Date(page.visibleUntil).getTime() > Date.now()
            ? 'La page redevient publique dans l’espace SBC Impact.'
            : 'Sa date de fin est passée : elle reviendra dans les archives.',
        onConfirm: async () => {
            try {
                await editShowcase(page._id, { hidden: false });
                toast.success('Page affichée à nouveau.');
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'La page n’a pas pu être affichée.'));
            } finally {
                onSaved();
            }
        },
    });

    return (
        <Panel>
            <PanelHeader title="Visibilité" description={`En ligne depuis le ${formatDate(page.visibleFrom)}, au moins jusqu’au ${formatDate(minEnd)}.`} />
            <PanelBody className="space-y-4">
                {hidden && (
                    <Notice tone="danger">Page masquée{page.hiddenAt ? ` le ${formatDate(page.hiddenAt)}` : ''} : « {page.hiddenReason} »</Notice>
                )}
                <DetailList items={[
                    ['Visible jusqu’au', formatDate(page.visibleUntil)],
                    ['État', hidden ? 'Masquée' : page.archived ? 'Archivée (date de fin passée)' : 'En ligne'],
                ]} />
                {canWrite && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <Field label="Prolonger jusqu’au" error={error ?? undefined} className="min-w-0 sm:w-56">
                            <Input type="date" className="h-11 sm:h-9" value={until} min={minDay} onChange={e => setUntil(e.target.value)} />
                        </Field>
                        <Button variant="outline" size="lg" className="sm:h-9" onClick={() => void extend()} loading={saving}
                            disabled={until === dayInput(page.visibleUntil)}>Enregistrer la date</Button>
                        <div className="sm:ml-auto">
                            {hidden
                                ? <Button variant="primary" size="lg" className="sm:h-9" onClick={askShow}>Afficher à nouveau</Button>
                                : <Button variant="danger-ghost" size="lg" className="sm:h-9" onClick={askHide}>Masquer la page</Button>}
                        </div>
                    </div>
                )}
            </PanelBody>
        </Panel>
    );
}

/** One SBC Impact page: links, visibility, news. */
export default function SbcImpactShowcaseDetailPage() {
    const { id = '' } = useParams<{ id: string }>();
    const queryClient = useQueryClient();
    const canWrite = usePermission('impactChallenge') === 'write';
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [publishing, setPublishing] = useState(false);
    const q = useQuery({ queryKey: ['sbc-impact', 'showcase-page', id], queryFn: () => getShowcase(id), enabled: !!id });
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['sbc-impact'] }); };

    const back = (
        <Link to="/sbc-impact/vitrine" className="inline-flex h-11 items-center gap-1 text-sm text-fg-muted hover:text-fg sm:h-auto">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> SBC Impact
        </Link>
    );
    if (q.isLoading) return <div className="space-y-4">{back}<Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
    if (!q.data) return <div className="space-y-4">{back}<Panel><ErrorState error={new Error(impactErrorMessage(q.error, 'Page introuvable.'))} onRetry={() => void q.refetch()} /></Panel></div>;
    const p = q.data;
    const hidden = p.hidden ?? !!p.hiddenAt;
    // The server says how far the end date may go down (visibleFrom + the edition's « Durée dans SBC Impact »).
    const minEnd = p.minVisibleUntil ? new Date(p.minVisibleUntil) : showcaseMinEnd(p.visibleFrom);

    return (
        <div className="space-y-6">
            <div>
                {back}
                <PageHeader
                    className="mb-0 mt-2"
                    title={<span className="flex flex-wrap items-center gap-3">{p.profile.name}{p.result.winner && <Badge tone="success"><HugeiconsIcon icon={Award01Icon} size={12} aria-hidden="true" />Gagnant</Badge>}</span>}
                    description={`${p.profile.projectName} · ${p.result.editionName} · ${showcaseResultText(p.result)}`}
                    actions={(
                        <Button asChild variant="outline" size="lg">
                            <a href={showcasePublicUrl(p._id)} target="_blank" rel="noreferrer noopener">
                                <HugeiconsIcon icon={LinkSquare02Icon} size={16} aria-hidden="true" />Page publique
                            </a>
                        </Button>
                    )}
                />
            </div>

            <Panel>
                <PanelBody className="flex flex-col gap-4 pt-5 sm:flex-row">
                    <CandidatePhoto fileId={p.profile.photoFileId} name={p.profile.name} />
                    <div className="min-w-0 flex-1 space-y-2 text-sm">
                        <p className="text-fg-muted">{[p.profile.activity, p.profile.city, p.profile.country].filter(Boolean).join(' · ')}</p>
                        {p.profile.projectDescription && <p className="whitespace-pre-line text-fg">{p.profile.projectDescription}</p>}
                        <div className="flex flex-wrap gap-1">
                            {hidden ? <Badge tone="danger">Masquée</Badge> : p.archived ? <Badge tone="neutral">Archivée</Badge> : <Badge tone="success">En ligne</Badge>}
                            {p.videoFileId ? <Badge tone="outline">Vidéo de présentation</Badge> : <Badge tone="outline">Pas de vidéo</Badge>}
                        </div>
                    </div>
                </PanelBody>
            </Panel>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <LinksPanel page={p} canWrite={canWrite} onSaved={refresh} />
                <VisibilityPanel page={p} minEnd={minEnd} canWrite={canWrite} onSaved={refresh} ask={setConfirm} />
            </div>

            <Panel>
                <PanelHeader
                    title="Nouvelles du projet"
                    description="Celles des finalistes passent par votre validation ; les vôtres sont publiées tout de suite."
                    actions={canWrite && !p.archived && !hidden ? (
                        <Button variant="outline" size="lg" className="sm:h-9" onClick={() => setPublishing(true)}>
                            <HugeiconsIcon icon={PlusSignIcon} size={16} aria-hidden="true" />Publier une nouvelle
                        </Button>
                    ) : undefined}
                />
                <PanelBody className="space-y-3">
                    {hidden
                        ? <Notice>Page masquée : affichez-la d’abord pour publier une nouvelle.</Notice>
                        : p.archived && <Notice>Page archivée : plus de nouvelles possibles.</Notice>}
                    {p.updates.length === 0
                        ? <p className="text-sm text-fg-muted">Aucune nouvelle pour l’instant.</p>
                        : p.updates.map(u => <ShowcaseUpdateCard key={u._id} u={u} canWrite={canWrite} ask={setConfirm} onChanged={refresh} />)}
                </PanelBody>
            </Panel>

            {publishing && <ShowcaseNewsDialog showcaseId={p._id} onClose={() => setPublishing(false)} onPublished={() => { setPublishing(false); refresh(); }} />}
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
