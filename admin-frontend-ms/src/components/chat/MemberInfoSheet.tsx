import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
    Calendar03Icon, Call02Icon, Location01Icon, Mail01Icon, StarIcon, Wallet01Icon, ArrowRight01Icon,
} from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import { getUserDetails, PartnerPack, SubscriptionType, type AdminUserData } from '../../services/adminUserApi';
import { ROLE_LABEL } from '../../lib/roles';
import { Can } from '../Can';
import { Avatar, Badge, Button, Dialog, SheetContent, Skeleton } from '../ui';
import { ErrorState } from '../display/ErrorState';
import { fmtDate, fmtInt } from '../display/format';

const SUBSCRIPTION_LABELS: Record<string, string> = {
    [SubscriptionType.CLASSIQUE]: 'Classique',
    [SubscriptionType.CIBLE]: 'Ciblé',
    [SubscriptionType.RELANCE]: 'Relance',
};

const PARTNER_LABELS: Record<string, string> = {
    [PartnerPack.SILVER]: 'Partenaire Silver',
    [PartnerPack.GOLD]: 'Partenaire Gold',
};

function Row({ icon, label, children }: { icon: IconSvgElement; label: string; children: ReactNode }) {
    return (
        <div className="flex items-start gap-3 py-3">
            <HugeiconsIcon icon={icon} size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-subtle" />
            <div className="min-w-0">
                <dt className="text-xs text-fg-muted">{label}</dt>
                <dd className="mt-0.5 break-words text-sm text-fg">{children}</dd>
            </div>
        </div>
    );
}

/** Who the admin is talking to: contact, packs, balance (read-only). */
export function MemberInfoSheet({ userId, onClose }: { userId: string | null; onClose: () => void }) {
    const [user, setUser] = useState<AdminUserData | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!userId) {
            setUser(null);
            setFailed(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setFailed(false);
        getUserDetails(userId)
            .then(data => { if (!cancelled) setUser(data); })
            .catch(err => {
                console.error('Failed to fetch user details:', err);
                if (!cancelled) setFailed(true);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [userId, attempt]);

    const subscriptions = (user?.activeSubscriptionTypes ?? []).map(s => SUBSCRIPTION_LABELS[s] ?? s);
    const partner = user?.partnerPack && user.partnerPack !== PartnerPack.NONE ? PARTNER_LABELS[user.partnerPack] ?? user.partnerPack : null;
    const phone = user?.phoneNumber ? String(user.phoneNumber) : null;

    return (
        <Dialog open={!!userId} onOpenChange={open => { if (!open) onClose(); }}>
            <SheetContent
                title="Profil du membre"
                description="Les informations du compte, en lecture seule."
                footer={userId && (
                    <Can module="members">
                        <Button asChild variant="outline" size="lg">
                            <Link to={`/userpage/${userId}`}>
                                Ouvrir la fiche membre
                                <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                            </Link>
                        </Button>
                    </Can>
                )}
            >
                {loading ? (
                    <div className="space-y-4" aria-busy="true">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-14 w-14 rounded-full" />
                            <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
                        </div>
                        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                ) : failed ? (
                    <ErrorState title="Le profil n’a pas pu être chargé" onRetry={() => setAttempt(a => a + 1)} />
                ) : user ? (
                    <>
                        <div className="flex items-center gap-3">
                            <Avatar src={getAvatarUrl(user.avatar)} name={user.name || '?'} size="lg" />
                            <div className="min-w-0">
                                <p className="truncate text-base font-semibold text-fg">{user.name}</p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {user.role && <Badge tone={user.role === 'user' ? 'neutral' : 'primary'}>{ROLE_LABEL[user.role] ?? user.role}</Badge>}
                                    {partner && <Badge tone="warning">{partner}</Badge>}
                                    {user.blocked && <Badge tone="danger">Bloqué</Badge>}
                                    {user.deleted && <Badge tone="neutral">Supprimé</Badge>}
                                </div>
                            </div>
                        </div>
                        <dl className="mt-4 divide-y divide-line">
                            {user.email && <Row icon={Mail01Icon} label="E-mail">{user.email}</Row>}
                            {phone && <Row icon={Call02Icon} label="Téléphone"><span className="tabular-nums">{phone}</span></Row>}
                            {(user.city || user.country) && <Row icon={Location01Icon} label="Lieu">{[user.city, user.country].filter(Boolean).join(', ')}</Row>}
                            <Row icon={StarIcon} label="Abonnements actifs">
                                {subscriptions.length > 0 ? subscriptions.join(', ') : <span className="text-fg-muted">Aucun abonnement actif</span>}
                            </Row>
                            {user.balance !== undefined && (
                                <Row icon={Wallet01Icon} label="Solde">
                                    <span className="tabular-nums">{fmtInt(user.balance)} F</span>
                                    {user.usdBalance !== undefined && user.usdBalance > 0 && (
                                        <span className="ml-2 text-fg-muted tabular-nums">
                                            ({user.usdBalance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $)
                                        </span>
                                    )}
                                </Row>
                            )}
                            {user.createdAt && <Row icon={Calendar03Icon} label="Inscrit le">{fmtDate(user.createdAt)}</Row>}
                        </dl>
                    </>
                ) : null}
            </SheetContent>
        </Dialog>
    );
}
