import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { forceReconnectWhatsApp, getWhatsAppQr, getWhatsAppStatus, logoutWhatsApp, type WhatsAppStatus } from '../../api/whatsapp';
import { Badge, Button, Card, ConfirmSheet, ErrorState, IconButton, KeyValue, Page, Skeleton, notify, type Tone } from '../../ui';
import { formatDateTime } from '../../lib/format';
import { errorMessage } from '../../lib/hooks';

const STATE: Record<string, [string, Tone]> = {
    connected: ['Connecté', 'success'], open: ['Connecté', 'success'],
    waiting_for_scan: ['QR code à scanner', 'warning'], connecting: ['Connexion…', 'primary'],
    disconnected: ['Déconnecté', 'danger'], close: ['Déconnecté', 'danger'], error: ['Erreur', 'danger'],
};
const isCloud = (s: WhatsAppStatus) => s.implementation === 'WhatsApp Cloud API' || s.lastHealthCheck !== undefined;

/** The QR code to link SBC's WhatsApp (older WhatsApp-Web link only), refreshed while waiting. */
function QrCode({ timestamp }: { timestamp?: number | null }) {
    const [src, setSrc] = useState<string | null>(null);
    const [error, setError] = useState(false);
    useEffect(() => {
        let url: string | null = null;
        let alive = true;
        getWhatsAppQr().then(blob => { if (!alive) return; url = URL.createObjectURL(blob); setSrc(url); setError(false); }).catch(() => alive && setError(true));
        return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    }, [timestamp]);
    if (error) return <p className="text-sm text-danger">Le QR code n’a pas pu être chargé. Actualise dans un instant.</p>;
    if (!src) return <Skeleton className="size-64 mx-auto" />;
    return <img src={src} alt="QR code WhatsApp à scanner" className="size-64 mx-auto rounded-tile bg-white p-2" />;
}

/**
 * SBC's own WhatsApp account, which sends OTPs and notifications. With the
 * official Cloud API there is nothing to scan; with the older WhatsApp-Web
 * link, an admin scans the QR code from the SBC phone.
 */
export default function WhatsAppPage() {
    const qc = useQueryClient();
    const [sheet, setSheet] = useState<'logout' | 'reconnect' | null>(null);
    const status = useQuery({
        queryKey: ['whatsapp'],
        queryFn: getWhatsAppStatus,
        // poll fast while something is changing, slowly once connected
        refetchInterval: q => (q.state.data?.isReady ? 60_000 : 8_000),
    });
    const s = status.data;
    const [label, tone] = s ? STATE[s.connectionState] ?? [s.connectionState, 'neutral' as Tone] : ['—', 'neutral' as Tone];

    return (
        <Page title="WhatsApp" back="/plus" width="narrow" actions={<IconButton label="Actualiser" onClick={() => status.refetch()}><RefreshCw size={20} /></IconButton>}>
            {status.isLoading ? <Skeleton className="h-48 rounded-card" /> : status.isError || !s ? (
                <ErrorState message="Impossible de lire l’état de WhatsApp." onRetry={() => status.refetch()} />
            ) : (
                <div className="space-y-4">
                    <Card className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <p className="font-bold text-lg">Compte WhatsApp de SBC</p>
                            <Badge tone={tone}>{label}</Badge>
                        </div>
                        <KeyValue items={[
                            ['Connexion', isCloud(s) ? 'API WhatsApp Cloud (officielle)' : 'Lien WhatsApp Web'],
                            ['Prêt à envoyer', s.isReady ? 'Oui' : 'Non'],
                            s.lastHealthCheck ? ['Dernière vérification', formatDateTime(s.lastHealthCheck)] : null,
                            s.reconnectAttempts ? ['Tentatives de reconnexion', String(s.reconnectAttempts)] : null,
                        ]} />
                        {isCloud(s) && !s.isReady && (
                            <p className="text-sm rounded-tile bg-danger-soft text-danger px-3 py-2">L’API Cloud ne répond pas. Vérifie la configuration dans Meta Business Manager (jeton, numéro).</p>
                        )}
                    </Card>

                    {!isCloud(s) && s.connectionState === 'waiting_for_scan' && (
                        <Card className="space-y-3 text-center">
                            <p className="font-semibold">Scanne ce code avec le téléphone de SBC</p>
                            <p className="text-sm text-ink-2">WhatsApp → Appareils connectés → Connecter un appareil.</p>
                            <QrCode timestamp={s.qrTimestamp} />
                        </Card>
                    )}

                    {!isCloud(s) && (
                        <Card className="space-y-2">
                            <Button variant="secondary" full onClick={() => setSheet('reconnect')}>Forcer la reconnexion</Button>
                            <Button variant="danger-soft" full onClick={() => setSheet('logout')}>Déconnecter WhatsApp</Button>
                        </Card>
                    )}
                </div>
            )}
            <ConfirmSheet open={sheet === 'reconnect'} onClose={() => setSheet(null)} title="Forcer la reconnexion ?"
                message={<p>La connexion est coupée puis rétablie. Les messages en cours d’envoi peuvent être retardés de quelques secondes.</p>}
                confirmLabel="Reconnecter"
                onConfirm={async () => { notify.success((await forceReconnectWhatsApp()) || 'Reconnexion lancée.'); qc.invalidateQueries({ queryKey: ['whatsapp'] }); }} />
            <ConfirmSheet open={sheet === 'logout'} onClose={() => setSheet(null)} tone="danger" title="Déconnecter WhatsApp ?"
                message={<p>SBC n’enverra plus rien par WhatsApp (codes, notifications) tant qu’on n’a pas rescanné le QR code depuis le téléphone de SBC.</p>}
                confirmLabel="Déconnecter"
                onConfirm={async () => {
                    try { notify.success((await logoutWhatsApp()) || 'WhatsApp déconnecté.'); } catch (e) { throw new Error(errorMessage(e)); }
                    qc.invalidateQueries({ queryKey: ['whatsapp'] });
                }} />
        </Page>
    );
}
