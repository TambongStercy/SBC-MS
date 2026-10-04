import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../api/apiClient';
import { useToast } from '../hooks/useToast';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { countryCodeToNameMap } from '../utils/countryUtils';

type Filter = { countries?: string[]; subscription?: 'subscribed' | 'unsubscribed'; sex?: 'male' | 'female' };
type Announcement = {
    _id: string; title: string; body: string; url?: string; recipients: number; createdAt: string;
    filter?: Filter; sendNow?: boolean;
};
type Overview = { recent: Announcement[]; toAllToday: number; toAllPerDay: number; audience: number };

const COUNTRIES = Object.entries(countryCodeToNameMap)
    .filter(([code]) => /^[A-Z]{2}$/.test(code))
    .sort((a, b) => a[1].localeCompare(b[1], 'fr'));

const SUBSCRIPTION_LABEL = { subscribed: 'Subscribed', unsubscribed: 'Not subscribed' } as const;
const SEX_LABEL = { male: 'Men', female: 'Women' } as const;

/** "Everyone", or "Cameroun, Gabon · Not subscribed · Women". */
const describeFilter = (f?: Filter) => {
    if (!f) return 'Everyone';
    const parts = [
        f.countries?.length ? f.countries.map(c => countryCodeToNameMap[c] ?? c).join(', ') : '',
        f.subscription ? SUBSCRIPTION_LABEL[f.subscription] : '',
        f.sex ? SEX_LABEL[f.sex] : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Everyone';
};

/**
 * Pages of the member app an announcement can open, as members know them.
 * A list rather than a text box: an admin should not have to know routes.
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

/** Douala hour now (UTC+1, no DST): announcements wait 22:00–07:00 unless sent now. */
const doualaHour = () => (new Date().getUTCHours() + 1) % 24;
const isNightInDouala = () => { const h = doualaHour(); return h >= 22 || h < 7; };

const TITLE_MAX = 120;
const BODY_MAX = 400;

/**
 * Push announcements to members who turned notifications on — everyone, or
 * those a filter picks. One to everyone per 24 h (server-side): past that,
 * people stop reading — or switch "Annonces SBC" off, and then nothing
 * reaches them. Targeted ones are not limited.
 */
const PushAnnouncementsPage: React.FC = () => {
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [overview, setOverview] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [url, setUrl] = useState('/');
    const [targeted, setTargeted] = useState(false);
    const [countries, setCountries] = useState<string[]>([]);
    const [countrySearch, setCountrySearch] = useState('');
    const [subscription, setSubscription] = useState<'' | 'subscribed' | 'unsubscribed'>('');
    const [sex, setSex] = useState<'' | 'male' | 'female'>('');
    const [filteredCount, setFilteredCount] = useState<number | null>(null);
    const [counting, setCounting] = useState(false);
    const [sendNow, setSendNow] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [sending, setSending] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await apiClient.get('/notifications/push/admin/announcements');
            setOverview(data.data);
        } catch {
            showError('Could not load announcements.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => { load(); }, [load]);

    // "Filter" with nothing picked is everyone, exactly as the server reads it.
    const filter: Filter | null = useMemo(() => {
        if (!targeted) return null;
        const f: Filter = {
            ...(countries.length ? { countries } : {}),
            ...(subscription ? { subscription } : {}),
            ...(sex ? { sex } : {}),
        };
        return Object.keys(f).length ? f : null;
    }, [targeted, countries, subscription, sex]);

    // Live count while the admin shapes the filter.
    useEffect(() => {
        if (!filter) { setFilteredCount(null); return; }
        let cancelled = false;
        setCounting(true);
        const timer = setTimeout(async () => {
            try {
                const { data } = await apiClient.post('/notifications/push/admin/audience', { filter });
                if (!cancelled) setFilteredCount(data.data.count);
            } catch {
                if (!cancelled) setFilteredCount(null);
            } finally {
                if (!cancelled) setCounting(false);
            }
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [filter]);

    const toAll = !filter;
    const reach = toAll ? overview?.audience ?? 0 : filteredCount;
    const capReached = toAll && !!overview && overview.toAllToday >= overview.toAllPerDay;
    const canSend = !!title.trim() && !!body.trim() && !capReached && !sending && !counting && !!reach;
    const night = isNightInDouala();
    const shownCountries = COUNTRIES.filter(([code, name]) =>
        !countrySearch.trim() || `${code} ${name}`.toLowerCase().includes(countrySearch.trim().toLowerCase()));
    const toggleCountry = (code: string) =>
        setCountries(cs => cs.includes(code) ? cs.filter(c => c !== code) : [...cs, code]);

    const buttonLabel = capReached
        ? 'Daily limit to everyone reached — add a filter'
        : toAll ? 'Send to everyone' : `Send to ${counting || reach === null ? '…' : reach} member(s)`;

    const send = async () => {
        setSending(true);
        try {
            const { data } = await apiClient.post('/notifications/push/admin/announce', {
                title: title.trim(), body: body.trim(), url,
                ...(filter ? { filter } : {}),
                ...(night && sendNow ? { sendNow: true } : {}),
            });
            showSuccess(data.data.heldUntil
                ? `Saved for ${data.data.recipients} member(s): in their notifications now, on their phones at 07:00 (Douala).`
                : `Sending to ${data.data.recipients} member(s).`);
            setTitle(''); setBody(''); setUrl('/'); setSendNow(false);
            load();
        } catch (err) {
            const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
            showError(message || 'The announcement could not be sent.');
        } finally {
            setSending(false);
            setConfirmOpen(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white p-4 md:p-8">
            <ToastContainer toasts={toasts} onRemove={removeToast} />
            <h1 className="text-2xl md:text-3xl font-bold mb-6">Push Announcements</h1>

            <div className="max-w-3xl mx-auto grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-sm text-gray-400">Members with notifications on</div>
                    <div className="text-2xl font-bold">{loading ? '…' : overview?.audience ?? 0}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-sm text-gray-400">To everyone, last 24 h</div>
                    <div className={`text-2xl font-bold ${overview && overview.toAllToday >= overview.toAllPerDay ? 'text-red-400' : ''}`}>
                        {loading ? '…' : `${overview?.toAllToday ?? 0} / ${overview?.toAllPerDay ?? 1}`}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Filtered ones are not limited</div>
                </div>
            </div>

            <div className="max-w-3xl mx-auto bg-gray-800 rounded-lg p-6 space-y-4">
                <label className="block">
                    <span className="text-sm text-gray-300">Title</span>
                    <input
                        value={title}
                        maxLength={TITLE_MAX}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Nouvelle formation disponible"
                        className="mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white"
                    />
                </label>
                <label className="block">
                    <span className="text-sm text-gray-300">Message ({body.length}/{BODY_MAX})</span>
                    <textarea
                        value={body}
                        maxLength={BODY_MAX}
                        rows={3}
                        onChange={e => setBody(e.target.value)}
                        placeholder="Découvre la formation « Vendre sur WhatsApp » dès maintenant."
                        className="mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white"
                    />
                </label>
                <label className="block">
                    <span className="text-sm text-gray-300">Tapping it opens</span>
                    <select
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        className="mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white"
                    >
                        {APP_PAGES.map(g => (
                            <optgroup key={g.group} label={g.group}>
                                {g.pages.map(p => <option key={p.url} value={p.url}>{p.label}</option>)}
                            </optgroup>
                        ))}
                    </select>
                </label>

                <div>
                    <span className="text-sm text-gray-300">Who gets it</span>
                    <div role="radiogroup" className="mt-1 grid grid-cols-2 gap-1 p-1 bg-gray-700 rounded-md">
                        {[{ value: false, label: 'Everyone' }, { value: true, label: 'Filter' }].map(o => (
                            <button
                                key={o.label}
                                role="radio"
                                aria-checked={targeted === o.value}
                                onClick={() => setTargeted(o.value)}
                                className={`py-1.5 rounded text-sm font-semibold ${targeted === o.value ? 'bg-gray-900 text-white' : 'text-gray-300'}`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>

                {targeted && (
                    <div className="space-y-3 bg-gray-900/50 rounded-md p-3">
                        <div>
                            <div className="flex items-baseline justify-between">
                                <span className="text-sm text-gray-300">Countries</span>
                                {countries.length > 0 && (
                                    <button onClick={() => setCountries([])} className="text-xs text-blue-300">Clear ({countries.length})</button>
                                )}
                            </div>
                            {countries.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {countries.map(c => (
                                        <button key={c} onClick={() => toggleCountry(c)} className="text-xs bg-blue-600 rounded-full px-2 py-0.5">
                                            {countryCodeToNameMap[c] ?? c} ×
                                        </button>
                                    ))}
                                </div>
                            )}
                            <input
                                value={countrySearch}
                                onChange={e => setCountrySearch(e.target.value)}
                                placeholder="Search a country"
                                className="mt-2 w-full bg-gray-700 rounded-md px-3 py-1.5 text-sm text-white"
                            />
                            <div className="mt-1 max-h-40 overflow-auto rounded-md bg-gray-800">
                                {shownCountries.map(([code, name]) => (
                                    <label key={code} className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-gray-700 cursor-pointer">
                                        <input type="checkbox" checked={countries.includes(code)} onChange={() => toggleCountry(code)} />
                                        {name}
                                    </label>
                                ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">None picked = all countries.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="text-sm text-gray-300">Subscription</span>
                                <select
                                    value={subscription}
                                    onChange={e => setSubscription(e.target.value as typeof subscription)}
                                    className="mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white"
                                >
                                    <option value="">All</option>
                                    <option value="subscribed">{SUBSCRIPTION_LABEL.subscribed}</option>
                                    <option value="unsubscribed">{SUBSCRIPTION_LABEL.unsubscribed}</option>
                                </select>
                            </label>
                            <label className="block">
                                <span className="text-sm text-gray-300">Sex</span>
                                <select
                                    value={sex}
                                    onChange={e => setSex(e.target.value as typeof sex)}
                                    className="mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white"
                                >
                                    <option value="">All</option>
                                    <option value="male">{SEX_LABEL.male}</option>
                                    <option value="female">{SEX_LABEL.female}</option>
                                </select>
                            </label>
                        </div>
                        <p className="text-sm">
                            {!filter
                                ? <span className="text-amber-300">Nothing picked: it goes to everyone.</span>
                                : counting
                                    ? <span className="text-gray-400">Counting…</span>
                                    : filteredCount === null
                                        ? <span className="text-red-400">Could not count members right now.</span>
                                        : <span>Reaches <strong>{filteredCount}</strong> member(s) with notifications on.</span>}
                        </p>
                    </div>
                )}

                {(title || body) && (
                    <div>
                        <div className="text-sm text-gray-400 mb-1">Preview</div>
                        <div className="bg-gray-950 rounded-xl p-3 flex gap-3 items-start">
                            {/* The icon members actually see on their phone. */}
                            <img src="/sbc-app-icon.png" alt="" className="w-10 h-10 rounded-full shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold truncate">{title || 'Title'}</div>
                                <div className="text-sm text-gray-300 line-clamp-3">{body || 'Message'}</div>
                                <div className="mt-2 inline-block text-xs font-semibold text-blue-300">Découvrir → {pageLabel(url)}</div>
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canSend}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-md py-2 font-semibold"
                >
                    {buttonLabel}
                </button>
                {night && (
                    <div className="text-sm text-amber-300 bg-amber-900/30 rounded-md px-3 py-2 space-y-2">
                        <p>
                            {sendNow
                                ? 'Phones buzz now, in the night. Keep this for real emergencies.'
                                : "It's night in Douala: members see it in their notifications right away, but phones only buzz at 07:00."}
                        </p>
                        <label className="flex items-center gap-2 cursor-pointer text-amber-100">
                            <input type="checkbox" checked={sendNow} onChange={e => setSendNow(e.target.checked)} />
                            Send now anyway, even at night
                        </label>
                    </div>
                )}
                <p className="text-xs text-gray-400">
                    Members who switched off « Annonces SBC » don't receive it.
                </p>
            </div>

            <div className="max-w-3xl mx-auto mt-6">
                <h2 className="text-lg font-semibold mb-3">Recent</h2>
                {overview?.recent.length ? (
                    <ul className="space-y-2">
                        {overview.recent.map(a => (
                            <li key={a._id} className="bg-gray-800 rounded-lg p-3">
                                <div className="flex justify-between gap-3">
                                    <span className="font-medium">{a.title}</span>
                                    <span className="text-xs text-gray-400 shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="text-sm text-gray-300">{a.body}</div>
                                <div className="text-xs text-gray-400 mt-1">
                                    {a.recipients} member(s) · {describeFilter(a.filter)}{a.url ? ` · ${pageLabel(a.url)}` : ''}{a.sendNow ? ' · sent at night' : ''}
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-400">{loading ? 'Loading…' : 'No announcement yet.'}</p>
                )}
            </div>

            <ConfirmationModal
                isOpen={confirmOpen}
                title="Send this announcement?"
                message={toAll
                    ? `It goes to ${reach ?? 0} member(s). Only ${overview?.toAllPerDay ?? 1} announcement to everyone per 24 h. It cannot be recalled.`
                    : `It goes to ${reach ?? 0} member(s): ${describeFilter(filter ?? undefined)}. It cannot be recalled.`}
                confirmText="Send"
                cancelText="Cancel"
                isLoading={sending}
                onConfirm={send}
                onCancel={() => setConfirmOpen(false)}
            />
        </div>
    );
};

export default PushAnnouncementsPage;
