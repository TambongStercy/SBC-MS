import React, { useEffect, useState } from 'react';
import { Search, UserCheck, X } from 'lucide-react';
import { AdminUserData, getUserDetails, listUsers } from '../../services/adminUserApi';
import { fieldClass } from './styles';

const describe = (u: AdminUserData) => [u.email, u.phoneNumber ? String(u.phoneNumber) : null].filter(Boolean).join(' · ');

/**
 * Links an entrepreneur to a member account, found by name, e-mail or phone
 * through the admin member search. The winner's share is credited to the
 * balance of this account — without one, the payout is refused.
 */
const SbcAccountPicker: React.FC<{
    value: string | null;
    onChange: (userId: string | null) => void;
    /** Typed into the search on demand, e.g. the entrepreneur's e-mail. */
    suggestion?: string;
    disabled?: boolean;
}> = ({ value, onChange, suggestion, disabled = false }) => {
    const [linked, setLinked] = useState<AdminUserData | null>(null);
    const [linkedError, setLinkedError] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<AdminUserData[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Who the current id belongs to.
    useEffect(() => {
        if (!value) { setLinked(null); setLinkedError(false); return; }
        if (linked?._id === value) return;
        let cancelled = false;
        setLinkedError(false);
        getUserDetails(value)
            .then(u => { if (!cancelled) setLinked(u); })
            .catch(() => { if (!cancelled) { setLinked(null); setLinkedError(true); } });
        return () => { cancelled = true; };
    }, [value, linked?._id]);

    // Search after a pause in typing.
    useEffect(() => {
        const term = query.trim();
        if (term.length < 3) { setResults([]); setSearchError(null); return; }
        let cancelled = false;
        const t = setTimeout(async () => {
            setSearching(true);
            setSearchError(null);
            try {
                const res = await listUsers({ search: term }, { page: 1, limit: 6 });
                if (!cancelled) setResults(res.data || []);
            } catch (err) {
                if (!cancelled) setSearchError(err instanceof Error ? err.message : 'Recherche impossible.');
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 400);
        return () => { cancelled = true; clearTimeout(t); };
    }, [query]);

    const pick = (u: AdminUserData) => {
        setLinked(u);
        onChange(u._id);
        setQuery('');
        setResults([]);
    };

    return (
        <div className="space-y-2">
            {value ? (
                <div className="flex items-start justify-between gap-3 bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex items-start gap-2">
                        <UserCheck className="w-4 h-4 mt-0.5 text-green-400 shrink-0" />
                        {linked ? (
                            <div className="min-w-0">
                                <p className="text-sm text-white truncate">{linked.name}</p>
                                <p className="text-xs text-gray-400 truncate">{describe(linked)}</p>
                            </div>
                        ) : linkedError ? (
                            <div className="min-w-0">
                                <p className="text-sm text-amber-300">Compte introuvable</p>
                                <p className="text-xs text-gray-400 break-all">Identifiant {value}</p>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-400">Chargement…</p>
                        )}
                    </div>
                    {!disabled && (
                        <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-400 hover:text-red-300 inline-flex items-center gap-1 shrink-0">
                            <X className="w-3.5 h-3.5" /> Retirer
                        </button>
                    )}
                </div>
            ) : (
                <p className="text-sm text-amber-300">Aucun compte SBC lié.</p>
            )}

            {!disabled && (
                <>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <input
                            className={`${fieldClass} pl-9`}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={value ? 'Lier un autre compte : nom, e-mail ou téléphone' : 'Chercher le membre : nom, e-mail ou téléphone'}
                        />
                    </div>
                    {suggestion && !query && (
                        <button type="button" onClick={() => setQuery(suggestion)} className="text-xs text-blue-300 hover:text-blue-200">
                            Chercher « {suggestion} »
                        </button>
                    )}
                    {searching && <p className="text-xs text-gray-400">Recherche…</p>}
                    {searchError && <p className="text-xs text-red-300">{searchError}</p>}
                    {!searching && query.trim().length >= 3 && results.length === 0 && !searchError && (
                        <p className="text-xs text-gray-400">Aucun membre trouvé.</p>
                    )}
                    {results.length > 0 && (
                        <ul className="border border-gray-700 rounded-lg divide-y divide-gray-700 overflow-hidden">
                            {results.map(u => (
                                <li key={u._id} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-900/40">
                                    <div className="min-w-0">
                                        <p className="text-sm text-white truncate">{u.name}</p>
                                        <p className="text-xs text-gray-400 truncate">{describe(u)}</p>
                                    </div>
                                    <button type="button" onClick={() => pick(u)} disabled={u._id === value}
                                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 shrink-0">
                                        {u._id === value ? 'Lié' : 'Lier'}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
};

export default SbcAccountPicker;
