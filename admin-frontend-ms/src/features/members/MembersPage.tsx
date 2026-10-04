import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, X } from 'lucide-react';
import { listMembers, type Member, type MemberFilters } from './api';
import { Avatar, Badge, Button, DataList, EmptyState, Pagination, Page, SearchInput, Select, Sheet, type Column } from '../../ui';
import { formatDate, formatMoney, formatPhone, startOfTodayDouala } from '../../lib/format';
import { countryName, SUBSCRIPTION_LABEL } from '../../lib/labels';
import { ROLE_LABEL } from '../../lib/roles';
import { useDebounced, useParamState } from '../../lib/hooks';

const STATUS: Record<string, string> = { active: 'Actifs', blocked: 'Bloqués', deleted: 'Supprimés' };
const SUBS: Record<string, string> = { any: 'Abonnés', classique: 'Classique', cible: 'Ciblé', none: 'Sans abonnement' };
const PARTNER: Record<string, string> = { any: 'Partenaires', silver: 'Partenaires Silver', gold: 'Partenaires Gold' };
const ROLES: Record<string, string> = { admin: 'Administrateurs', withdrawal_admin: 'Admins retraits', moderator: 'Modérateurs', tester: 'Testeurs' };

function Subs({ m }: { m: Member }) {
    return (
        <span className="flex flex-wrap gap-1">
            {(m.activeSubscriptionTypes ?? []).map(t => <Badge key={t} tone={SUBSCRIPTION_LABEL[t]?.[1] ?? 'neutral'}>{SUBSCRIPTION_LABEL[t]?.[0] ?? t}</Badge>)}
            {m.partnerPack && <Badge tone="accent">{m.partnerPack === 'gold' ? 'Gold' : 'Silver'}</Badge>}
            {!(m.activeSubscriptionTypes?.length) && !m.partnerPack && <span className="text-ink-3 text-sm">—</span>}
        </span>
    );
}

function State({ m }: { m: Member }) {
    if (m.deleted) return <Badge tone="neutral">Supprimé</Badge>;
    if (m.blocked) return <Badge tone="danger">Bloqué</Badge>;
    if (m.role && m.role !== 'user') return <Badge tone="warning">{ROLE_LABEL[m.role] ?? m.role}</Badge>;
    return null;
}

/** Every member: search by name, phone, email or id, then narrow with filters. */
export default function MembersPage() {
    const navigate = useNavigate();
    const [q, setQ] = useParamState('q', '');
    const [status, setStatus] = useParamState('statut', '');
    const [subscription, setSubscription] = useParamState('abonnement', '');
    const [partner, setPartner] = useParamState('partenaire', '');
    const [role, setRole] = useParamState('role', '');
    const [since, setSince] = useParamState('depuis', '');
    const [page, setPage] = useState(1);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const search = useDebounced(q, 350);

    const filters: MemberFilters = {
        search, status: status as MemberFilters['status'], subscription: subscription as MemberFilters['subscription'],
        partner: partner as MemberFilters['partner'], role, createdFrom: since === 'aujourdhui' ? startOfTodayDouala() : undefined,
    };
    const list = useQuery({
        queryKey: ['members', filters, page],
        queryFn: () => listMembers(filters, page),
        placeholderData: keepPreviousData,
    });

    const chips: Array<[string, () => void]> = [
        status && [STATUS[status], () => setStatus('')],
        subscription && [SUBS[subscription], () => setSubscription('')],
        partner && [PARTNER[partner], () => setPartner('')],
        role && [ROLES[role] ?? role, () => setRole('')],
        since === 'aujourdhui' && ['Inscrits aujourd’hui', () => setSince('')],
    ].filter(Boolean) as Array<[string, () => void]>;
    const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

    const columns: Column<Member>[] = [
        { key: 'm', header: 'Membre', cell: m => (
            <span className="flex items-center gap-2.5 min-w-0">
                <Avatar name={m.name} src={m.avatar} size={36} />
                <span className="min-w-0">
                    <span className="block font-semibold truncate">{m.name}</span>
                    <span className="block text-xs text-ink-2 truncate">{formatPhone(m.phoneNumber)}</span>
                </span>
            </span>
        ) },
        { key: 'c', header: 'Pays', cell: m => <span className="text-ink-2">{countryName(m.country)}</span> },
        { key: 's', header: 'Abonnement', cell: m => <Subs m={m} /> },
        { key: 'b', header: 'Solde', align: 'right', cell: m => formatMoney(m.balance) },
        { key: 'd', header: 'Inscrit', cell: m => <span className="text-ink-2 whitespace-nowrap">{formatDate(m.createdAt)}</span> },
        { key: 'st', header: '', cell: m => <State m={m} /> },
    ];

    return (
        <Page title="Membres" subtitle={list.data ? `${list.data.total.toLocaleString('fr-FR')} membre${list.data.total > 1 ? 's' : ''}` : undefined}>
            <div className="space-y-3">
                <div className="flex gap-2">
                    <SearchInput className="flex-1" value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Nom, téléphone, email ou ID" />
                    <Button variant="secondary" icon={<SlidersHorizontal size={16} />} onClick={() => setFiltersOpen(true)}>
                        <span className="hidden sm:inline">Filtres</span>{chips.length > 0 && <span className="tabular">({chips.length})</span>}
                    </Button>
                </div>
                {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {chips.map(([label, clear]) => (
                            <button key={label} type="button" onClick={() => { clear(); setPage(1); }}
                                className="inline-flex items-center gap-1 rounded-pill bg-primary-soft text-primary text-sm font-semibold pl-3 pr-2 h-8">
                                {label}<X size={14} />
                            </button>
                        ))}
                    </div>
                )}
                <DataList rows={list.data?.items} columns={columns} rowKey={m => m._id} loading={list.isLoading} error={list.error}
                    onRetry={() => list.refetch()} onRowClick={m => navigate(`/membres/${m._id}`)}
                    empty={<EmptyState title="Aucun membre trouvé">Essaie un autre nom, un numéro sans indicatif, ou retire un filtre.</EmptyState>}
                    card={m => (
                        <span className="flex items-center gap-3 min-w-0">
                            <Avatar name={m.name} src={m.avatar} size={40} />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2"><span className="font-semibold truncate">{m.name}</span><State m={m} /></span>
                                <span className="block text-sm text-ink-2 truncate">{formatPhone(m.phoneNumber)} · {countryName(m.country)}</span>
                                <span className="mt-1 flex items-center justify-between gap-2"><Subs m={m} /><span className="text-sm font-semibold tabular">{formatMoney(m.balance)}</span></span>
                            </span>
                        </span>
                    )} />
                {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />}
            </div>

            <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres"
                footer={<div className="flex gap-2"><Button variant="secondary" full onClick={() => { setStatus(''); setSubscription(''); setPartner(''); setRole(''); setSince(''); setPage(1); }}>Tout effacer</Button><Button full onClick={() => setFiltersOpen(false)}>Voir les membres</Button></div>}>
                <div className="space-y-4">
                    <Select label="Statut" value={status} onChange={e => reset(setStatus)(e.target.value)}>
                        <option value="">Tous</option>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Select label="Abonnement" value={subscription} onChange={e => reset(setSubscription)(e.target.value)}>
                        <option value="">Tous</option>{Object.entries(SUBS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Select label="Partenaires" value={partner} onChange={e => reset(setPartner)(e.target.value)}>
                        <option value="">Tous</option>{Object.entries(PARTNER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Select label="Équipe" value={role} onChange={e => reset(setRole)(e.target.value)}>
                        <option value="">Tous</option>{Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Select label="Inscription" value={since} onChange={e => reset(setSince)(e.target.value)}>
                        <option value="">Peu importe</option><option value="aujourdhui">Aujourd’hui</option>
                    </Select>
                </div>
            </Sheet>
        </Page>
    );
}
