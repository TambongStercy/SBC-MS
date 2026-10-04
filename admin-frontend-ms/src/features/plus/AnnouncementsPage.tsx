import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Moon } from 'lucide-react';
import apiClient from '../../api/apiClient';
import { countryCodeToNameMap } from '../../utils/countryUtils';
import { Badge, Button, Card, ConfirmSheet, EmptyState, Input, KeyValue, Page, SearchInput, SectionTitle, Select, Stat, Switch, Tabs, Textarea, notify } from '../../ui';
import { formatDateTime, formatNumber } from '../../lib/format';

type Filter = { countries?: string[]; subscription?: 'subscribed' | 'unsubscribed'; sex?: 'male' | 'female' };
type Announcement = { _id: string; title: string; body: string; url?: string; recipients: number; createdAt: string; filter?: Filter; sendNow?: boolean };
type Overview = { recent: Announcement[]; toAllToday: number; toAllPerDay: number; audience: number };

const COUNTRIES = Object.entries(countryCodeToNameMap).filter(([c]) => /^[A-Z]{2}$/.test(c)).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
const SUBSCRIPTION = { subscribed: 'Abonnés', unsubscribed: 'Non abonnés' } as const;
const SEX = { male: 'Hommes', female: 'Femmes' } as const;

/** "Tout le monde", or "Cameroun, Gabon · Non abonnés · Femmes". */
const describe = (f?: Filter) => {
    if (!f) return 'Tout le monde';
    const parts = [f.countries?.length ? f.countries.map(c => countryCodeToNameMap[c] ?? c).join(', ') : '', f.subscription ? SUBSCRIPTION[f.subscription] : '', f.sex ? SEX[f.sex] : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Tout le monde';
};

/**
 * Pages of the member app an announcement can open, as members know them.
 * Keep in step with SBC-WEB-UI's App.tsx when pages move.
 */
const APP_PAGES: Array<{ group: string; pages: Array<{ label: string; url: string }> }> = [
    { group: 'Général', pages: [
        { label: 'Accueil', url: '/' },
        { label: 'Formations', url: '/formations' },
        { label: 'SBC Shop', url: '/marketplace' },
        { label: 'Classement', url: '/classement' },
        { label: 'Contacts', url: '/contacts' },
        { label: 'Messages', url: '/chat' },
        { label: 'SBC Love', url: '/sbclove' },
    ] },
    { group: 'Argent', pages: [
        { label: 'Portefeuille', url: '/wallet' },
        { label: 'Solde d\'activation', url: '/activation-balance' },
        { label: 'Abonnement', url: '/abonnement' },
    ] },
    { group: 'Parrainage', pages: [
        { label: 'Mes filleuls', url: '/filleuls' },
        { label: 'Espace partenaire', url: '/partenaire' },
        { label: 'Relance', url: '/relance' },
        { label: 'Campagnes de relance', url: '/relance/campagnes' },
    ] },
    { group: 'Événements', pages: [
        { label: 'Événements', url: '/events' },
        { label: 'Mes billets', url: '/events/mes-billets' },
        { label: 'Revente de billets', url: '/events/revente' },
    ] },
    { group: 'Ads Network', pages: [
        { label: 'Ads Network', url: '/ads-network' },
        { label: 'Espace diffuseur', url: '/ads-network/diffuseur' },
        { label: 'Espace annonceur', url: '/ads-network/annonceur' },
        { label: 'Nouvelle campagne pub', url: '/ads-network/annonceur/nouvelle-campagne' },
    ] },
    { group: 'Compte', pages: [
        { label: 'Profil', url: '/profile' },
        { label: 'Notifications', url: '/notifications' },
    ] },
];
const pageLabel = (url: string) => APP_PAGES.flatMap(g => g.pages).find(p => p.url === url)?.label ?? 'Accueil';

/** Douala is UTC+1 all year: announcements wait 22:00–07:00 unless sent now. */
const isNightInDouala = () => { const h = (new Date().getUTCHours() + 1) % 24; return h >= 22 || h < 7; };
const TITLE_MAX = 120;
const BODY_MAX = 400;

/**
 * Push announcements to members who turned notifications on — everyone, or
 * those a filter picks. One to everyone per 24 h (server-side); targeted ones
 * are not limited. At night they wait for 07:00 unless sent now.
 */
export default function AnnouncementsPage() {
    const qc = useQueryClient();
    const overview = useQuery({ queryKey: ['announcements'], queryFn: async (): Promise<Overview> => (await apiClient.get('/notifications/push/admin/announcements')).data.data });
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [url, setUrl] = useState('/');
    const [targeted, setTargeted] = useState<'tous' | 'filtre'>('tous');
    const [countries, setCountries] = useState<string[]>([]);
    const [countrySearch, setCountrySearch] = useState('');
    const [subscription, setSubscription] = useState<'' | 'subscribed' | 'unsubscribed'>('');
    const [sex, setSex] = useState<'' | 'male' | 'female'>('');
    const [sendNow, setSendNow] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const night = isNightInDouala();

    // "Filtre" with nothing picked is everyone, exactly as the server reads it.
    const filter: Filter | null = useMemo(() => {
        if (targeted === 'tous') return null;
        const f: Filter = { ...(countries.length ? { countries } : {}), ...(subscription ? { subscription } : {}), ...(sex ? { sex } : {}) };
        return Object.keys(f).length ? f : null;
    }, [targeted, countries, subscription, sex]);

    const audience = useQuery({
        queryKey: ['announcements', 'audience', filter],
        enabled: !!filter,
        queryFn: async (): Promise<number> => (await apiClient.post('/notifications/push/admin/audience', { filter })).data.data.count,
    });
    useEffect(() => { if (!night) setSendNow(false); }, [night]);

    const toAll = !filter;
    const reach = toAll ? overview.data?.audience : audience.data;
    const capReached = toAll && !!overview.data && overview.data.toAllToday >= overview.data.toAllPerDay;
    const ready = !!title.trim() && !!body.trim() && !capReached && !!reach && !(filter && audience.isFetching);
    const shownCountries = COUNTRIES.filter(([c, n]) => !countrySearch.trim() || `${c} ${n}`.toLowerCase().includes(countrySearch.trim().toLowerCase()));
    const toggleCountry = (c: string) => setCountries(cs => (cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]));

    return (
        <Page title="Notifications aux membres" width="narrow">
            <div className="space-y-5">
                <div className="grid grid-cols-2 gap-2">
                    <Stat label="Membres joignables" value={formatNumber(overview.data?.audience)} loading={overview.isLoading} hint="notifications activées" />
                    <Stat label="À tout le monde (24 h)" value={overview.data ? `${overview.data.toAllToday} / ${overview.data.toAllPerDay}` : '—'} loading={overview.isLoading}
                        tone={capReached ? 'danger' : undefined} hint="les annonces filtrées ne comptent pas" />
                </div>

                <Card className="space-y-4">
                    <Input label="Titre" value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} placeholder="Nouvelle formation disponible" />
                    <Textarea label={`Message (${body.length}/${BODY_MAX})`} value={body} maxLength={BODY_MAX} rows={3} onChange={e => setBody(e.target.value)}
                        placeholder="Découvre la formation « Vendre sur WhatsApp » dès maintenant." />
                    <Select label="En touchant l’annonce, le membre ouvre" value={url} onChange={e => setUrl(e.target.value)}>
                        {APP_PAGES.map(g => <optgroup key={g.group} label={g.group}>{g.pages.map(p => <option key={p.url} value={p.url}>{p.label}</option>)}</optgroup>)}
                    </Select>

                    <div className="space-y-3">
                        <SectionTitle>Qui la reçoit</SectionTitle>
                        <Tabs value={targeted} onChange={setTargeted} items={[{ value: 'tous', label: 'Tout le monde' }, { value: 'filtre', label: 'Filtrer' }]} />
                        {targeted === 'filtre' && (
                            <div className="space-y-3 rounded-tile bg-surface-2 p-3">
                                <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">Pays</span>
                                    {countries.length > 0 && <button type="button" className="text-sm font-semibold text-primary" onClick={() => setCountries([])}>Effacer ({countries.length})</button>}</div>
                                {countries.length > 0 && <div className="flex flex-wrap gap-1.5">{countries.map(c => <button key={c} type="button" onClick={() => toggleCountry(c)} className="rounded-pill bg-primary text-white text-sm px-3 h-8">{countryCodeToNameMap[c] ?? c} ×</button>)}</div>}
                                <SearchInput value={countrySearch} onChange={setCountrySearch} placeholder="Chercher un pays" />
                                <div className="max-h-48 overflow-y-auto rounded-tile bg-surface border border-border divide-y divide-border">
                                    {shownCountries.map(([c, n]) => (
                                        <label key={c} className="flex items-center gap-3 px-3 h-11 text-sm cursor-pointer">
                                            <input type="checkbox" className="size-5" checked={countries.includes(c)} onChange={() => toggleCountry(c)} />{n}
                                        </label>
                                    ))}
                                </div>
                                <p className="text-xs text-ink-3">Aucun pays coché = tous les pays.</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <Select label="Abonnement" value={subscription} onChange={e => setSubscription(e.target.value as typeof subscription)}>
                                        <option value="">Tous</option><option value="subscribed">Abonnés</option><option value="unsubscribed">Non abonnés</option>
                                    </Select>
                                    <Select label="Sexe" value={sex} onChange={e => setSex(e.target.value as typeof sex)}>
                                        <option value="">Tous</option><option value="male">Hommes</option><option value="female">Femmes</option>
                                    </Select>
                                </div>
                                <p className="text-sm">
                                    {!filter ? <span className="text-warning">Rien de coché : elle part à tout le monde.</span>
                                        : audience.isFetching ? <span className="text-ink-3">Calcul…</span>
                                        : audience.isError ? <span className="text-danger">Impossible de compter les membres pour le moment.</span>
                                        : <>Elle touchera <b>{formatNumber(audience.data)}</b> membre{audience.data === 1 ? '' : 's'}.</>}
                                </p>
                            </div>
                        )}
                    </div>

                    {(title || body) && (
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-1.5">Aperçu</p>
                            <div className="rounded-card bg-[#0F172A] text-white p-3 flex gap-3 items-start">
                                <img src="/sbc-app-icon.png" alt="" className="size-10 rounded-pill shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold truncate">{title || 'Titre'}</p>
                                    <p className="text-sm text-white/80 line-clamp-3">{body || 'Message'}</p>
                                    <p className="mt-2 text-xs font-semibold text-[#7AA5FA]">Découvrir → {pageLabel(url)}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {night && (
                        <div className="rounded-tile bg-warning-soft text-warning p-3 space-y-2">
                            <p className="text-sm flex gap-2"><Moon size={16} className="shrink-0 mt-0.5" />
                                {sendNow ? 'Les téléphones sonneront tout de suite, en pleine nuit. À garder pour les urgences.' : 'Il fait nuit à Douala : l’annonce apparaît tout de suite dans l’app, mais les téléphones sonnent à 7 h.'}</p>
                            <label className="flex items-center justify-between gap-3 text-sm font-semibold"><span>Envoyer quand même maintenant</span><Switch label="Envoyer maintenant" checked={sendNow} onChange={setSendNow} /></label>
                        </div>
                    )}

                    <Button full size="lg" icon={<Megaphone size={18} />} disabled={!ready} onClick={() => setConfirm(true)}>
                        {capReached ? 'Limite atteinte pour tout le monde : filtre-la' : toAll ? 'Envoyer à tout le monde' : `Envoyer à ${formatNumber(reach)} membre${reach === 1 ? '' : 's'}`}
                    </Button>
                    <p className="text-xs text-ink-3">Les membres qui ont désactivé « Annonces SBC » ne la reçoivent pas.</p>
                </Card>

                <section>
                    <SectionTitle>Dernières annonces</SectionTitle>
                    {overview.data?.recent.length ? (
                        <ul className="space-y-2">
                            {overview.data.recent.map(a => (
                                <li key={a._id}><Card>
                                    <div className="flex items-start justify-between gap-3"><p className="font-semibold">{a.title}</p><span className="text-xs text-ink-3 shrink-0">{formatDateTime(a.createdAt)}</span></div>
                                    <p className="text-sm text-ink-2 mt-0.5">{a.body}</p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        <Badge>{formatNumber(a.recipients)} membre{a.recipients === 1 ? '' : 's'}</Badge><Badge tone="primary">{describe(a.filter)}</Badge>
                                        {a.url && <Badge>{pageLabel(a.url)}</Badge>}{a.sendNow && <Badge tone="warning">Envoyée la nuit</Badge>}
                                    </div>
                                </Card></li>
                            ))}
                        </ul>
                    ) : <Card><EmptyState title={overview.isLoading ? 'Chargement…' : 'Aucune annonce pour l’instant'} /></Card>}
                </section>
            </div>

            <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} tone="primary" title="Envoyer cette annonce ?"
                message={<>
                    <KeyValue items={[['Destinataires', `${formatNumber(reach)} membre${reach === 1 ? '' : 's'}`], ['Qui', describe(filter ?? undefined)], ['Ouvre', pageLabel(url)],
                        ['Quand', night && !sendNow ? 'Dans l’app tout de suite, téléphones à 7 h' : 'Tout de suite']]} />
                    <p>{toAll ? `Une seule annonce à tout le monde par 24 h. ` : ''}Elle ne peut pas être rappelée.</p>
                </>}
                confirmLabel="Envoyer"
                onConfirm={async () => {
                    const { data } = await apiClient.post('/notifications/push/admin/announce', { title: title.trim(), body: body.trim(), url, ...(filter ? { filter } : {}), ...(night && sendNow ? { sendNow: true } : {}) });
                    notify.success(data.data.heldUntil
                        ? `Enregistrée pour ${formatNumber(data.data.recipients)} membres : dans l’app maintenant, sur les téléphones à 7 h.`
                        : `Envoi en cours à ${formatNumber(data.data.recipients)} membres.`);
                    setTitle(''); setBody(''); setUrl('/'); setSendNow(false);
                    qc.invalidateQueries({ queryKey: ['announcements'] });
                }} />
        </Page>
    );
}
