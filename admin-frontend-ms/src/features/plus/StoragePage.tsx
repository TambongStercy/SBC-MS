import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getCleanupCandidates, getStorageStatus, runStorageCheck } from '../../api/storageApi';
import { Button, Card, ErrorState, IconButton, KeyValue, Page, SectionTitle, Skeleton, Stat, notify } from '../../ui';
import { formatNumber } from '../../lib/format';
import { errorMessage } from '../../lib/hooks';

/**
 * What SBC stores on Google Cloud Storage. Honest about its limit: the bill
 * is mostly downloads (egress), which this monitor does not measure — it
 * prices storage only. See CLAUDE.md "Cloud Storage bills egress".
 */
export default function StoragePage() {
    const qc = useQueryClient();
    const status = useQuery({ queryKey: ['storage'], queryFn: () => getStorageStatus().then(r => r.data) });
    const old = useQuery({ queryKey: ['storage', 'cleanup'], queryFn: () => getCleanupCandidates(7).then(r => r.data) });
    const [checking, setChecking] = useState(false);
    const s = status.data;
    const b = s?.breakdown;

    const check = async () => {
        setChecking(true);
        try { await runStorageCheck(); notify.success('Relevé mis à jour.'); qc.invalidateQueries({ queryKey: ['storage'] }); }
        catch (e) { notify.error(errorMessage(e, 'Le relevé a échoué.')); }
        finally { setChecking(false); }
    };

    return (
        <Page title="Stockage" back="/plus" width="narrow" actions={<IconButton label="Actualiser" onClick={() => status.refetch()}><RefreshCw size={20} /></IconButton>}>
            {status.isLoading ? <Skeleton className="h-60 rounded-card" /> : status.isError || !s ? (
                <ErrorState message="Impossible de lire l’état du stockage." onRetry={() => status.refetch()} />
            ) : (
                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-2">
                        <Stat label="Espace utilisé" value={s.usage.used} />
                        <Stat label="Fichiers" value={formatNumber(s.usage.raw.fileCount)} />
                    </div>
                    <Card className="space-y-2 bg-warning-soft border-warning/30">
                        <p className="text-sm font-semibold text-warning">Ce suivi ne mesure que le stockage</p>
                        <p className="text-sm text-ink-2">La facture Google Cloud vient surtout des téléchargements (bande passante), qui ne sont pas comptés ici. En août 2026 : environ 64 $ de téléchargements pour 1 $ de stockage. Coût du stockage seul estimé : <b className="text-ink">{s.costs.storage}</b> par mois.</p>
                    </Card>
                    {b && (
                        <section>
                            <SectionTitle>Répartition</SectionTitle>
                            <Card><KeyValue items={[
                                ['Photos de profil', formatNumber(b.profilePictureFiles)],
                                ['Images de produits', formatNumber(b.productFiles)],
                                ['Documents', formatNumber(b.documentFiles)],
                                ['Autres (vidéos, créations…)', formatNumber(b.otherFiles)],
                            ]} /></Card>
                        </section>
                    )}
                    {s.alert && (
                        <Card className="space-y-1">
                            <p className="font-semibold">{s.alert.message}</p>
                            <ul className="list-disc pl-5 text-sm text-ink-2">{s.alert.recommendedActions.map(a => <li key={a}>{a}</li>)}</ul>
                        </Card>
                    )}
                    <section>
                        <SectionTitle>Fichiers temporaires de plus de 7 jours</SectionTitle>
                        <Card>
                            {old.isLoading ? <Skeleton className="h-10" /> : old.data ? (
                                <KeyValue items={[['Fichiers', formatNumber(old.data.totalFiles)], ['Place libérable', old.data.totalSizeToFree]]} />
                            ) : <p className="text-sm text-ink-3">Indisponible.</p>}
                            <p className="mt-2 text-xs text-ink-3">Photos de profil, produits et contenus des membres ne sont jamais supprimés automatiquement.</p>
                        </Card>
                    </section>
                    <Button variant="secondary" full loading={checking} onClick={check}>Refaire le relevé maintenant</Button>
                </div>
            )}
        </Page>
    );
}
