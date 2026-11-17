import React, { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, UserCheck01Icon } from '@hugeicons/core-free-icons';
import { AdminUserData, getUserDetails, listUsers } from '../../services/adminUserApi';
import { Button } from '../ui';
import { SearchInput } from '../moduleKit';

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
                <div className="flex items-start justify-between gap-3 rounded-panel border border-line bg-surface-2 px-3 py-2">
                    <div className="flex min-w-0 items-start gap-2">
                        <HugeiconsIcon icon={UserCheck01Icon} size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                        {linked ? (
                            <div className="min-w-0">
                                <p className="truncate text-sm text-fg">{linked.name}</p>
                                <p className="truncate text-xs text-fg-muted">{describe(linked)}</p>
                            </div>
                        ) : linkedError ? (
                            <div className="min-w-0">
                                <p className="text-sm text-danger">Compte introuvable</p>
                                <p className="break-all text-xs text-fg-muted">Identifiant {value}</p>
                            </div>
                        ) : (
                            <p className="text-sm text-fg-muted">Chargement…</p>
                        )}
                    </div>
                    {!disabled && (
                        <Button type="button" variant="ghost" size="sm" className="h-11 shrink-0 sm:h-8" onClick={() => onChange(null)}>
                            <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden="true" /> Retirer
                        </Button>
                    )}
                </div>
            ) : (
                <p className="text-sm text-[color-mix(in_oklch,var(--warning),var(--fg)_35%)]">Aucun compte SBC lié.</p>
            )}

            {!disabled && (
                <>
                    <SearchInput
                        value={query}
                        onChange={setQuery}
                        delay={0}
                        placeholder={value ? 'Lier un autre compte : nom, e-mail ou téléphone' : 'Chercher le membre : nom, e-mail ou téléphone'}
                    />
                    {suggestion && !query && (
                        <Button type="button" variant="link" size="sm" onClick={() => setQuery(suggestion)}>
                            Chercher « {suggestion} »
                        </Button>
                    )}
                    {searching && <p className="text-xs text-fg-muted">Recherche…</p>}
                    {searchError && <p className="text-xs text-danger">{searchError}</p>}
                    {!searching && query.trim().length >= 3 && results.length === 0 && !searchError && (
                        <p className="text-xs text-fg-muted">Aucun membre trouvé.</p>
                    )}
                    {results.length > 0 && (
                        <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line">
                            {results.map(u => (
                                <li key={u._id} className="flex items-center justify-between gap-3 px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm text-fg">{u.name}</p>
                                        <p className="truncate text-xs text-fg-muted">{describe(u)}</p>
                                    </div>
                                    <Button type="button" variant="soft" size="sm" className="h-11 shrink-0 sm:h-8" onClick={() => pick(u)} disabled={u._id === value}>
                                        {u._id === value ? 'Lié' : 'Lier'}
                                    </Button>
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
