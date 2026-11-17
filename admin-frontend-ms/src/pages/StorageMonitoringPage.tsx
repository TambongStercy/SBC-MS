import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
    Alert02Icon, CheckmarkCircle02Icon, CloudIcon, Delete02Icon, HardDriveIcon, InformationCircleIcon, RefreshIcon, Shield01Icon,
} from '@hugeicons/core-free-icons';
import { getCleanupCandidates, getStorageStatus, runStorageCheck } from '../api/storageApi';
import { Can } from '../components/Can';
import {
    Badge, Button, Dialog, EmptyState, Metric, PageHeader, Panel, PanelBody, PanelHeader, ResponsiveList, Segmented,
    SheetContent, Skeleton, Switch, type ListColumn,
} from '../components/ui';
import { ErrorState } from '../components/display/ErrorState';
import { RelativeDate } from '../components/display/RelativeDate';
import { fmtBytes, fmtInt, fmtXaf } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';
import { RankedBars } from '../components/storage/RankedBars';
import { frSize, frStorage } from '../components/storage/translate';

type Health = 'HEALTHY' | 'MODERATE' | 'WARNING' | 'CRITICAL';
const HEALTH: Record<Health, { label: string; tone: 'success' | 'info' | 'warning' | 'danger'; icon: IconSvgElement; hint: string }> = {
    HEALTHY: { label: 'Sain', tone: 'success', icon: CheckmarkCircle02Icon, hint: 'Coût sous 1 000 F par mois' },
    MODERATE: { label: 'Modéré', tone: 'info', icon: CloudIcon, hint: 'Coût au-dessus de 1 000 F par mois' },
    WARNING: { label: 'À surveiller', tone: 'warning', icon: Alert02Icon, hint: 'Seuil d’alerte de 5 000 F dépassé' },
    CRITICAL: { label: 'Critique', tone: 'danger', icon: Alert02Icon, hint: 'Seuil critique de 15 000 F dépassé' },
};

const PROTECTION_LABEL: Record<string, string> = { PROTECTED: 'Protégé', CLEANABLE: 'Supprimable' };
const AGES = [{ value: '7', label: '7 j' }, { value: '30', label: '30 j' }, { value: '90', label: '90 j' }];
const DEFAULTS = { jours: '7' };

type Candidate = { id: string; name: string; createdTime: string; size: string; mimeType: string };

/**
 * Stockage (module `settings`): the public and private R2 buckets
 * (Cloudflare R2 since 2026-11-02), what they hold, an estimate of the
 * monthly bill, and the temporary files that can go. Server:
 * settings-service /settings/storage/{status,check,cleanup-candidates}.
 */
export default function StorageMonitoringPage() {
    const queryClient = useQueryClient();
    const params = useUrlParams(DEFAULTS);
    const days = AGES.some(a => a.value === params.get('jours')) ? params.get('jours') : '7';
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [showFiles, setShowFiles] = useState(false);

    const status = useQuery({
        queryKey: ['storage', 'status'],
        queryFn: getStorageStatus,
        refetchInterval: autoRefresh ? 60_000 : false,
    });
    const cleanup = useQuery({
        queryKey: ['storage', 'cleanup', days],
        queryFn: () => getCleanupCandidates(Number(days)),
        placeholderData: keepPreviousData,
        refetchInterval: autoRefresh ? 60_000 : false,
    });

    const check = useMutation({
        mutationFn: runStorageCheck,
        onSuccess: () => {
            toast.success('Vérification terminée.');
            void queryClient.invalidateQueries({ queryKey: ['storage'] });
        },
        onError: () => toast.error('La vérification du stockage a échoué.'),
    });

    const refresh = () => { void status.refetch(); void cleanup.refetch(); };
    const data = status.data?.data;
    const health = data ? HEALTH[data.healthStatus] ?? HEALTH.HEALTHY : null;
    const alert = data?.alert && data.alert.level !== 'info' ? data.alert : null;
    const cand = cleanup.data?.data;

    const header = (
        <PageHeader
            title="Stockage des fichiers"
            description="Les fichiers des membres sur Cloudflare R2 : volume, coût mensuel estimé et fichiers temporaires supprimables."
            className="mb-3"
            actions={(
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <label className="flex h-11 items-center gap-2 text-sm text-fg-muted">
                        <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Actualiser chaque minute" />
                        Chaque minute
                    </label>
                    <Button variant="outline" size="lg" onClick={refresh} loading={status.isFetching && !status.isLoading}>
                        {!(status.isFetching && !status.isLoading) && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
                        Actualiser
                    </Button>
                    <Can module="settings" write>
                        <Button variant="primary" size="lg" onClick={() => check.mutate()} loading={check.isPending}>
                            {!check.isPending && <HugeiconsIcon icon={HardDriveIcon} size={16} aria-hidden="true" />}
                            Lancer une vérification
                        </Button>
                    </Can>
                </div>
            )}
        />
    );

    if (status.isLoading) {
        return (
            <div className="space-y-6">
                {header}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-panel" />)}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                    <Skeleton className="h-64 rounded-panel" />
                    <Skeleton className="h-64 rounded-panel" />
                </div>
            </div>
        );
    }

    if (status.isError || !data || !health) {
        return (
            <div className="space-y-6">
                {header}
                <Panel>
                    <ErrorState
                        title="Les données de stockage n’ont pas pu être chargées"
                        message="Le service de stockage n’a pas répondu. Vérifiez la connexion, puis réessayez."
                        onRetry={refresh}
                        retrying={status.isFetching}
                    />
                </Panel>
            </div>
        );
    }

    const b = data.breakdown;
    const fileBars = b ? [
        { key: 'profile', label: 'Photos de profil', value: b.profilePictureFiles },
        { key: 'product', label: 'Images produits', value: b.productFiles },
        { key: 'document', label: 'Documents', value: b.documentFiles },
        { key: 'other', label: 'Autres fichiers', value: b.otherFiles },
    ] : [];
    const costBars = [
        { key: 'storage', label: 'Stockage', value: data.costs.raw.storage },
        { key: 'bandwidth', label: 'Bande passante', value: data.costs.raw.bandwidth },
        { key: 'operations', label: 'Opérations', value: data.costs.raw.operations },
    ];

    const candidateColumns: ListColumn<Candidate>[] = [
        { key: 'name', header: 'Fichier', className: 'max-w-0 w-1/2', cell: c => <span className="block truncate font-medium" title={c.name}>{c.name}</span> },
        { key: 'size', header: 'Taille', numeric: true, cell: c => frSize(c.size) },
        { key: 'created', header: 'Créé', cell: c => <RelativeDate value={c.createdTime} className="text-fg-muted" /> },
    ];

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                {header}
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                    Données mises à jour <RelativeDate value={status.dataUpdatedAt} />
                    {autoRefresh && <span>· actualisation chaque minute</span>}
                </p>
            </div>

            {alert && (
                <Panel className={alert.level === 'critical' ? 'border-danger/40 bg-danger-soft/40' : 'border-warning/40 bg-warning-soft/40'} role="alert">
                    <div className="flex items-start gap-3 p-4 sm:p-5">
                        <HugeiconsIcon icon={Alert02Icon} size={20} aria-hidden="true" className={alert.level === 'critical' ? 'mt-0.5 shrink-0 text-danger' : 'mt-0.5 shrink-0 text-warning'} />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-fg">
                                À traiter : le coût mensuel estimé ({fmtXaf(data.costs.raw.total)}) dépasse le seuil {alert.level === 'critical' ? 'critique' : 'd’alerte'} de {fmtXaf(alert.costThreshold)}.
                            </p>
                            {alert.recommendedActions.length > 0 && (
                                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-fg-muted">
                                    {alert.recommendedActions.map((a, i) => <li key={i}>{frStorage(a)}</li>)}
                                </ul>
                            )}
                        </div>
                    </div>
                </Panel>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Espace utilisé" value={fmtBytes(data.usage.raw.used)} hint={`${fmtInt(data.usage.raw.fileCount)} fichiers`} icon={HardDriveIcon} />
                <Metric label="Coût estimé" value={fmtXaf(data.costs.raw.total)} hint="par mois, au tarif R2" icon={CloudIcon} />
                <Metric
                    label="État"
                    value={<Badge tone={health.tone} className="px-2.5 py-1 text-sm"><HugeiconsIcon icon={health.icon} size={14} aria-hidden="true" />{health.label}</Badge>}
                    hint={health.hint}
                    tone={health.tone === 'info' ? 'primary' : health.tone}
                    icon={Shield01Icon}
                />
                <Metric
                    label="Fichiers supprimables"
                    value={cand ? fmtInt(cand.totalFiles) : <Skeleton className="h-7 w-16" />}
                    hint={cand ? `${frSize(cand.totalSizeToFree)} · temporaires de plus de ${cand.daysOld} j` : 'Calcul…'}
                    icon={Delete02Icon}
                    onClick={cand && cand.totalFiles > 0 ? () => setShowFiles(true) : undefined}
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                    <PanelHeader title="Répartition des fichiers" description={b ? `${fmtInt(b.totalFiles)} fichiers en tout, par catégorie` : undefined} />
                    <PanelBody>
                        {b ? (
                            <RankedBars data={fileBars} format={fmtInt} label="Nombre de fichiers par catégorie" unitHeader="Fichiers" />
                        ) : (
                            <EmptyState icon={HardDriveIcon} title="Répartition indisponible" description="Le service n’a pas pu classer les fichiers cette fois-ci." className="py-8" />
                        )}
                    </PanelBody>
                </Panel>

                <Panel>
                    <PanelHeader title="Coût mensuel estimé" description={`${fmtXaf(data.costs.raw.total)} par mois, détail par poste`} />
                    <PanelBody>
                        <RankedBars
                            data={costBars}
                            format={fmtXaf}
                            label="Coût mensuel estimé par poste"
                            unitHeader="Par mois"
                            footer={(
                                <p className="flex items-start gap-2 text-xs text-fg-muted">
                                    <HugeiconsIcon icon={InformationCircleIcon} size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    Estimation du service au tarif Cloudflare R2 (1 $ ≈ 600 F), pas la facture réelle.
                                </p>
                            )}
                        />
                    </PanelBody>
                </Panel>
            </div>

            <Panel>
                <PanelHeader
                    title="Fichiers temporaires supprimables"
                    description="Seuls les fichiers temporaires ou de cache sont proposés. Les photos, produits et contenus des membres sont toujours protégés."
                    actions={<Segmented size="sm" label="Ancienneté minimale" value={days} onValueChange={v => params.set({ jours: v })} options={AGES} />}
                />
                <PanelBody className={cleanup.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
                    {cleanup.isError ? (
                        <ErrorState message="La liste des fichiers temporaires n’a pas pu être chargée." onRetry={() => void cleanup.refetch()} retrying={cleanup.isFetching} className="py-8" />
                    ) : !cand ? (
                        <Skeleton className="h-16 w-full" />
                    ) : cand.totalFiles === 0 ? (
                        <p className="text-sm text-fg-muted">Aucun fichier temporaire de plus de {cand.daysOld} jours : rien à nettoyer.</p>
                    ) : (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-fg">
                                <strong className="font-semibold tabular-nums">{fmtInt(cand.totalFiles)}</strong> fichiers de plus de {cand.daysOld} jours,{' '}
                                <strong className="font-semibold">{frSize(cand.totalSizeToFree)}</strong> à libérer{parseInt(cand.estimatedCostSavings, 10) > 0 ? <>, soit environ {fmtXaf(parseInt(cand.estimatedCostSavings, 10))} par mois</> : null}.
                            </p>
                            <Button size="lg" onClick={() => setShowFiles(true)}>Voir les fichiers</Button>
                        </div>
                    )}
                    <p className="mt-3 text-xs text-fg-subtle">Cet écran n’efface rien : le nettoyage se fait côté serveur.</p>
                </PanelBody>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                    <PanelHeader title="Protection du contenu" description="Ce que le nettoyage n’a jamais le droit de toucher." />
                    <PanelBody>
                        <dl className="divide-y divide-line text-sm">
                            {([
                                ['Photos de profil', data.protectionPolicy.profilePictures],
                                ['Images produits', data.protectionPolicy.productImages],
                                ['Contenu des membres', data.protectionPolicy.userGeneratedContent],
                                ['Fichiers temporaires', data.protectionPolicy.temporaryFiles],
                            ] as const).map(([label, v]) => (
                                <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                                    <dt className="text-fg-muted">{label}</dt>
                                    <dd>
                                        <Badge tone={v === 'PROTECTED' ? 'success' : 'warning'}>
                                            <HugeiconsIcon icon={v === 'PROTECTED' ? Shield01Icon : Delete02Icon} size={12} aria-hidden="true" />
                                            {PROTECTION_LABEL[v] ?? v}
                                        </Badge>
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </PanelBody>
                </Panel>
                <Panel>
                    <PanelHeader title="Conseils du service" />
                    <PanelBody>
                        {data.recommendations.length ? (
                            <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
                                {data.recommendations.map((r, i) => <li key={i}>{frStorage(r)}</li>)}
                            </ul>
                        ) : (
                            <p className="text-sm text-fg-muted">Aucun conseil pour le moment.</p>
                        )}
                    </PanelBody>
                </Panel>
            </div>

            <Dialog open={showFiles} onOpenChange={setShowFiles}>
                {showFiles && cand && (
                    <SheetContent
                        width="lg"
                        title="Fichiers temporaires supprimables"
                        description={`${fmtInt(cand.totalFiles)} fichiers de plus de ${cand.daysOld} jours · ${frSize(cand.totalSizeToFree)}`}
                    >
                        <ResponsiveList
                            className="-mx-6"
                            rows={cand.candidates}
                            columns={candidateColumns}
                            rowKey={c => c.id}
                            empty={<EmptyState icon={CheckmarkCircle02Icon} title="Rien à nettoyer" />}
                        />
                    </SheetContent>
                )}
            </Dialog>
        </div>
    );
}
