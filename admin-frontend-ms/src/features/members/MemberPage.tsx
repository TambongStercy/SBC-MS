import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { getMember, listReferrals } from './api';
import { MemberMovements, MemberPayments, MemberWithdrawals } from './MemberActivity';
import { MemberReferrals } from './MemberReferrals';
import { MemberProfile } from './MemberProfile';
import { MemberAccess } from './MemberAccess';
import { Avatar, Badge, Card, ErrorState, MemberLink, Page, Skeleton, Stat, Tabs, notify } from '../../ui';
import { formatDate, formatMoney, formatNumber, formatPhone } from '../../lib/format';
import { SUBSCRIPTION_LABEL, countryName } from '../../lib/labels';
import { ROLE_LABEL } from '../../lib/roles';
import { useParamState } from '../../lib/hooks';

type View = 'mouvements' | 'retraits' | 'paiements' | 'filleuls' | 'profil' | 'acces';

/**
 * One member, whole: who they are, their balances, everything that moved,
 * their filleuls, and what an admin can change — each change confirmed.
 */
export default function MemberPage() {
    const { userId = '' } = useParams();
    const [view, setView] = useParamState('vue', 'mouvements');
    const member = useQuery({ queryKey: ['member', userId], queryFn: () => getMember(userId), enabled: !!userId });
    const directs = useQuery({ queryKey: ['member', userId, 'referrals', 'count'], queryFn: () => listReferrals(userId, 1, 1), enabled: !!userId });
    const m = member.data;

    return (
        <Page title={m?.name || 'Membre'} back="/membres" subtitle={m ? formatPhone(m.phoneNumber) : undefined}>
            {member.isLoading ? (
                <div className="space-y-3"><Skeleton className="h-36 rounded-card" /><Skeleton className="h-20 rounded-card" /></div>
            ) : member.isError || !m ? (
                <ErrorState message="Membre introuvable ou impossible à charger." onRetry={() => member.refetch()} />
            ) : (
                <div className="space-y-4" key={m._id}>
                    <Card>
                        <div className="flex items-start gap-4">
                            <Avatar name={m.name} src={m.avatar} size={56} />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {(m.activeSubscriptionTypes ?? []).map(t => <Badge key={t} tone={SUBSCRIPTION_LABEL[t]?.[1] ?? 'neutral'}>{SUBSCRIPTION_LABEL[t]?.[0] ?? t}</Badge>)}
                                    {!m.activeSubscriptionTypes?.length && <Badge>Pas abonné</Badge>}
                                    {m.partnerPack && <Badge tone="accent">Partenaire {m.partnerPack === 'gold' ? 'Gold' : 'Silver'}</Badge>}
                                    {m.role && m.role !== 'user' && <Badge tone="warning">{ROLE_LABEL[m.role] ?? m.role}</Badge>}
                                    {m.blocked && <Badge tone="danger">Bloqué</Badge>}
                                    {m.deleted && <Badge>Supprimé</Badge>}
                                </div>
                                <dl className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                                    <div className="flex gap-2"><dt className="text-ink-3">Email</dt><dd className="truncate">{m.email || '—'}</dd></div>
                                    <div className="flex gap-2"><dt className="text-ink-3">Pays</dt><dd>{countryName(m.country)}{m.city ? ` · ${m.city}` : ''}</dd></div>
                                    <div className="flex gap-2"><dt className="text-ink-3">Inscrit</dt><dd>{formatDate(m.createdAt)}</dd></div>
                                    {m.referralCode && (
                                        <div className="flex gap-2 items-center"><dt className="text-ink-3">Code</dt><dd className="font-mono">{m.referralCode}</dd>
                                            <button type="button" aria-label="Copier le code" className="text-ink-3 hover:text-ink"
                                                onClick={() => navigator.clipboard?.writeText(m.referralCode!).then(() => notify.success('Code copié.')).catch(() => {})}><Copy size={13} /></button>
                                        </div>
                                    )}
                                </dl>
                            </div>
                        </div>
                        {m.referrer && (
                            <div className="mt-4 pt-3 border-t border-border">
                                <p className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-1.5">Parrain</p>
                                <MemberLink id={m.referrer._id} name={m.referrer.name} phone={m.referrer.phoneNumber} avatar={m.referrer.avatar} />
                            </div>
                        )}
                    </Card>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        <Stat label="Solde" value={formatMoney(m.balance)} />
                        <Stat label="Solde d’activation" value={formatMoney(m.activationBalance ?? 0)} />
                        {(m.usdBalance ?? 0) > 0 && <Stat label="Solde USD" value={formatMoney(m.usdBalance, 'USD')} />}
                        <Stat label="Filleuls directs" value={formatNumber(directs.data?.total)} loading={directs.isLoading} />
                    </div>

                    <Tabs<View> value={view as View} onChange={setView} phoneColumns={3} items={[
                        { value: 'mouvements', label: 'Mouvements' },
                        { value: 'retraits', label: 'Retraits' },
                        { value: 'paiements', label: 'Paiements' },
                        { value: 'filleuls', label: 'Filleuls' },
                        { value: 'profil', label: 'Profil' },
                        { value: 'acces', label: 'Accès' },
                    ]} />

                    {view === 'mouvements' && <MemberMovements memberId={m._id} />}
                    {view === 'retraits' && <MemberWithdrawals memberId={m._id} />}
                    {view === 'paiements' && <MemberPayments memberId={m._id} />}
                    {view === 'filleuls' && <MemberReferrals memberId={m._id} />}
                    {view === 'profil' && <MemberProfile member={m} />}
                    {view === 'acces' && <MemberAccess member={m} />}
                </div>
            )}
        </Page>
    );
}
