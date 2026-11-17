import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
    Alert02Icon, CheckmarkCircle02Icon, CloudIcon, LinkSquare02Icon, Loading03Icon, Logout03Icon, QrCodeIcon, RefreshIcon,
    SmartPhone01Icon,
} from '@hugeicons/core-free-icons';
import { forceReconnectWhatsApp, getWhatsAppQr, getWhatsAppStatus, logoutWhatsApp, type WhatsAppStatus } from '../api/whatsapp';
import { Can } from './Can';
import { Badge, Button, Dialog, DialogClose, DialogContent, Panel, PanelBody, PanelHeader, Skeleton } from './ui';
import { fmtDateTime } from './display/format';

const isBailey = (s: WhatsAppStatus | null) =>
    s !== null && (s.hasQr !== undefined || s.qrTimestamp !== undefined || s.reconnectAttempts !== undefined);
const isCloudApi = (s: WhatsAppStatus | null) =>
    s !== null && (s.implementation === 'WhatsApp Cloud API' || s.lastHealthCheck !== undefined);

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

function stateOf(s: WhatsAppStatus): { label: string; tone: Tone; icon: IconSvgElement; spin?: boolean } {
    if (s.isInitializing) return { label: 'Initialisation…', tone: 'info', icon: Loading03Icon, spin: true };
    // Past 5 attempts the session has given up: show the plain state.
    if (s.reconnectAttempts && s.reconnectAttempts > 0 && s.reconnectAttempts < 5) return { label: `Reconnexion (${s.reconnectAttempts}/5)`, tone: 'warning', icon: Loading03Icon, spin: true };
    switch (s.connectionState) {
        case 'connected':
        case 'open': return { label: 'Connecté', tone: 'success', icon: CheckmarkCircle02Icon };
        case 'waiting_for_scan': return { label: 'En attente du scan', tone: 'warning', icon: QrCodeIcon };
        case 'disconnected':
        case 'close': return { label: 'Déconnecté', tone: 'danger', icon: Alert02Icon };
        case 'connecting': return { label: 'Connexion…', tone: 'info', icon: Loading03Icon, spin: true };
        default: return { label: `État inconnu (${s.connectionState})`, tone: 'neutral', icon: SmartPhone01Icon };
    }
}

function Notice({ tone, icon, title, children, action }: { tone: Tone; icon: IconSvgElement; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
    const box = {
        success: 'border-success/40 bg-success-soft/40', warning: 'border-warning/40 bg-warning-soft/40', danger: 'border-danger/40 bg-danger-soft/40',
        info: 'border-info/40 bg-info-soft/40', neutral: 'border-line bg-surface-2',
    }[tone];
    const ink = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', info: 'text-info', neutral: 'text-fg-muted' }[tone];
    return (
        <div className={`flex flex-col gap-3 rounded-panel border p-4 sm:flex-row sm:items-start ${box}`}>
            <HugeiconsIcon icon={icon} size={20} className={`mt-0.5 shrink-0 ${ink}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{title}</p>
                {children && <div className="mt-1 text-sm text-fg-muted">{children}</div>}
            </div>
            {action}
        </div>
    );
}

/**
 * The server's own WhatsApp connection (module `whatsapp`): Cloud API (Meta,
 * nothing to scan) or the older Bailey session (QR code to scan). Polls the
 * status, faster while connecting. Server: notification-service /whatsapp/*.
 */
const WhatsAppManager = () => {
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [pollInterval, setPollInterval] = useState<number>(5000);
    const [failed, setFailed] = useState(false);
    const [confirmLogout, setConfirmLogout] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const statusData = await getWhatsAppStatus();
            setStatus(statusData);
            setLastUpdated(new Date());
            setFailed(false);
        } catch (error) {
            console.error('Error fetching WhatsApp status:', error);
            setFailed(true);
            toast.error('Impossible de récupérer l’état de WhatsApp.', { id: 'whatsapp-status' });
        }
    }, []);

    const fetchQrCode = useCallback(async () => {
        if (!status?.hasQr || !isBailey(status)) return;
        setIsLoading(true);
        try {
            const blob = await getWhatsAppQr();
            setQrCode(URL.createObjectURL(blob));
        } catch (error) {
            console.error('Error fetching QR code:', error);
            toast.error('Impossible de récupérer le QR code.');
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    const handleLogout = async () => {
        setIsLoggingOut(true);
        try {
            const message = await logoutWhatsApp();
            toast.success(message || 'WhatsApp déconnecté.');
            setQrCode(null);
            setConfirmLogout(false);
            setTimeout(fetchStatus, 2000);
        } catch (error) {
            console.error('Error logging out WhatsApp:', error);
            toast.error('La déconnexion de WhatsApp a échoué.');
        } finally {
            setIsLoggingOut(false);
        }
    };

    const handleForceReconnect = async () => {
        setIsReconnecting(true);
        try {
            const message = await forceReconnectWhatsApp();
            toast.success(message || 'Reconnexion de WhatsApp lancée.');
            setQrCode(null);
            setTimeout(fetchStatus, 2000);
        } catch (error) {
            console.error('Error force reconnecting WhatsApp:', error);
            toast.error('La reconnexion de WhatsApp a échoué.');
        } finally {
            setIsReconnecting(false);
        }
    };

    const handleRefresh = () => {
        void fetchStatus();
        if (status?.hasQr) void fetchQrCode();
    };

    useEffect(() => { void fetchStatus(); }, [fetchStatus]);

    // Fetch the QR code when the status says one is available.
    useEffect(() => {
        if (status?.hasQr && !qrCode) void fetchQrCode();
    }, [status?.hasQr, qrCode, fetchQrCode]);

    // Poll faster while connecting, slower once ready (Cloud API is the steadier one).
    useEffect(() => {
        if (!status) return;
        let next = 5000;
        if (isCloudApi(status)) {
            next = status.isReady ? 15000 : 8000;
        } else if (isBailey(status)) {
            if (status.isReady) next = 10000;
            else if (status.isInitializing || (status.reconnectAttempts && status.reconnectAttempts > 0)) next = 3000;
            else if (status.connectionState === 'waiting_for_scan') next = 5000;
        }
        if (next !== pollInterval) setPollInterval(next);
    }, [status, pollInterval]);

    useEffect(() => {
        const interval = setInterval(fetchStatus, pollInterval);
        return () => clearInterval(interval);
    }, [fetchStatus, pollInterval]);

    // Release the QR code's object URL.
    useEffect(() => () => { if (qrCode) URL.revokeObjectURL(qrCode); }, [qrCode]);

    const cloud = isCloudApi(status);
    const bailey = isBailey(status);
    const state = status ? stateOf(status) : null;
    const disconnected = status && (status.connectionState === 'disconnected' || status.connectionState === 'close');

    return (
        <Panel>
            <PanelHeader
                title={(
                    <span className="flex items-center gap-2">
                        <HugeiconsIcon icon={cloud ? CloudIcon : SmartPhone01Icon} size={16} className="text-fg-muted" aria-hidden="true" />
                        Connexion WhatsApp du serveur
                    </span>
                )}
                description={status ? (cloud ? 'WhatsApp Cloud API (Meta) : aucun QR code à scanner.' : bailey ? 'Bailey (WhatsApp Web) : se connecte en scannant un QR code.' : 'Implémentation non reconnue.') : 'Chargement de l’état…'}
                actions={(
                    <Button variant="ghost" size="icon" className="h-11 w-11" onClick={handleRefresh} disabled={isLoading} aria-label="Actualiser l’état">
                        <HugeiconsIcon icon={RefreshIcon} size={16} className={isLoading ? 'animate-spin' : undefined} aria-hidden="true" />
                    </Button>
                )}
            />
            <PanelBody className="space-y-4">
                {!status ? (
                    failed ? (
                        <Notice tone="danger" icon={Alert02Icon} title="L’état de WhatsApp n’a pas pu être lu" action={<Button size="lg" onClick={handleRefresh}>Réessayer</Button>}>
                            Le service de notifications ne répond pas. Nouvel essai automatique dans quelques secondes.
                        </Notice>
                    ) : (
                        <div className="space-y-3" aria-busy="true">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-24 w-full" />
                        </div>
                    )
                ) : (
                    <>
                        {/* Current state, with the one action that applies to it. */}
                        <div className="flex flex-col gap-3 rounded-panel border border-line bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-1">
                                {state && (
                                    <Badge tone={state.tone} className="px-2.5 py-1 text-sm">
                                        <HugeiconsIcon icon={state.icon} size={14} className={state.spin ? 'animate-spin' : undefined} aria-hidden="true" />
                                        {state.label}
                                    </Badge>
                                )}
                                <p className="text-xs text-fg-muted">
                                    {lastUpdated && <>Vérifié à {lastUpdated.toLocaleTimeString('fr-FR')}</>}
                                    {cloud && status.lastHealthCheck && <> · dernier contrôle Meta à {new Date(status.lastHealthCheck).toLocaleTimeString('fr-FR')}</>}
                                </p>
                            </div>
                            {bailey && (
                                <Can module="whatsapp" write>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        {!status.isReady && disconnected && (status.reconnectAttempts || 0) < 5 && (
                                            <Button size="lg" onClick={handleForceReconnect} loading={isReconnecting} disabled={status.isInitializing}>
                                                {!isReconnecting && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
                                                Forcer la reconnexion
                                            </Button>
                                        )}
                                        {status.isReady && (
                                            <Button variant="danger-ghost" size="lg" onClick={() => setConfirmLogout(true)}>
                                                <HugeiconsIcon icon={Logout03Icon} size={16} aria-hidden="true" />
                                                Déconnecter WhatsApp
                                            </Button>
                                        )}
                                    </div>
                                </Can>
                            )}
                            {cloud && (
                                <Button asChild variant="outline" size="lg">
                                    <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener noreferrer">
                                        Business Manager
                                        <HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden="true" />
                                    </a>
                                </Button>
                            )}
                        </div>

                        {status.isReady && (
                            <Notice tone="success" icon={CheckmarkCircle02Icon} title={cloud ? 'WhatsApp Cloud API prête' : 'Connexion WhatsApp prête'}>
                                {cloud
                                    ? 'L’API officielle WhatsApp Business est active : le serveur peut envoyer ses messages.'
                                    : 'La session WhatsApp Web est active : le serveur peut envoyer ses messages.'}
                            </Notice>
                        )}

                        {status.isInitializing && (
                            <Notice tone="info" icon={Loading03Icon} title="Initialisation de la connexion">
                                Préparation du service WhatsApp, patientez quelques secondes.
                            </Notice>
                        )}

                        {cloud && !status.isReady && (
                            <Notice tone="danger" icon={Alert02Icon} title="WhatsApp Cloud API indisponible">
                                L’API ne répond pas correctement. Vérifiez le compte dans Facebook Business Manager et les identifiants de l’API sur le serveur.
                            </Notice>
                        )}

                        {bailey && disconnected && !status.hasQr && !status.isInitializing && (
                            <Notice
                                tone="danger"
                                icon={Alert02Icon}
                                title="WhatsApp déconnecté"
                                action={(status.reconnectAttempts || 0) >= 5 ? (
                                    <Can module="whatsapp" write>
                                        <Button variant="danger" size="lg" onClick={handleForceReconnect} loading={isReconnecting}>Réessayer la connexion</Button>
                                    </Can>
                                ) : undefined}
                            >
                                {(status.reconnectAttempts || 0) >= 5
                                    ? 'Nombre maximal de tentatives de reconnexion atteint.'
                                    : 'Un nouveau QR code devrait apparaître sous peu.'}
                            </Notice>
                        )}

                        {bailey && status.hasQr && status.connectionState === 'waiting_for_scan' && (
                            <div className="rounded-panel border border-line p-5 text-center">
                                <p className="text-sm font-medium text-fg">Scannez ce QR code avec le téléphone du compte WhatsApp</p>
                                <ol className="mx-auto mt-2 max-w-md list-decimal space-y-0.5 pl-5 text-left text-sm text-fg-muted">
                                    <li>Ouvrez WhatsApp sur le téléphone.</li>
                                    <li>Paramètres, puis Appareils connectés.</li>
                                    <li>Touchez « Connecter un appareil » et scannez le code.</li>
                                </ol>
                                <div className="mt-4 flex justify-center">
                                    {isLoading ? (
                                        <Skeleton className="h-64 w-64" />
                                    ) : qrCode ? (
                                        <div className="rounded-panel bg-white p-3">
                                            <img src={qrCode} alt="QR code WhatsApp" className="h-60 w-60 object-contain" />
                                        </div>
                                    ) : (
                                        <p className="py-16 text-sm text-fg-muted">QR code indisponible pour le moment.</p>
                                    )}
                                </div>
                                {status.qrTimestamp && <p className="mt-3 text-xs text-fg-muted">Généré le {fmtDateTime(status.qrTimestamp)}</p>}
                            </div>
                        )}

                        {cloud && (
                            <details className="rounded-panel border border-line px-4 py-3 text-sm">
                                <summary className="cursor-pointer font-medium text-fg">Où se règle WhatsApp Cloud API ?</summary>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
                                    <li>Le compte WhatsApp Business se configure dans Facebook Business Manager.</li>
                                    <li>Le numéro doit être validé dans Meta Business Manager.</li>
                                    <li>Les webhooks doivent être configurés.</li>
                                    <li>Les identifiants de l’API sont dans les variables d’environnement du serveur.</li>
                                </ul>
                            </details>
                        )}

                        {!cloud && !bailey && (
                            <Notice tone="warning" icon={Alert02Icon} title="Implémentation inconnue">
                                Le type de connexion WhatsApp n’a pas pu être déterminé. Vérifiez la configuration du serveur.
                            </Notice>
                        )}
                    </>
                )}
            </PanelBody>

            <Dialog open={confirmLogout} onOpenChange={open => { if (!isLoggingOut) setConfirmLogout(open); }}>
                {confirmLogout && (
                    <DialogContent
                        size="sm"
                        title="Déconnecter WhatsApp ?"
                        description="Le serveur n’enverra plus de messages WhatsApp tant qu’un nouveau QR code n’aura pas été scanné."
                        footer={(
                            <>
                                <DialogClose asChild><Button variant="outline" size="lg" disabled={isLoggingOut}>Annuler</Button></DialogClose>
                                <Button variant="danger" size="lg" loading={isLoggingOut} onClick={handleLogout}>Déconnecter</Button>
                            </>
                        )}
                    />
                )}
            </Dialog>
        </Panel>
    );
};

export default WhatsAppManager;
