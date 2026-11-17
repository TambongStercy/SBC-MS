import { useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon, FilterIcon, Globe02Icon, Search01Icon, UserIcon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import { listUsers, type AdminUserData } from '../../services/adminUserApi';
import { Avatar, Badge, Button, Dialog, EmptyState, Field, Input, Segmented, SheetContent, Skeleton } from '../ui';
import { apiError } from '../display/format';

type StatusFilter = 'all' | 'active' | 'blocked' | 'deleted';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'active', label: 'Actifs' },
    { value: 'blocked', label: 'Bloqués' },
    { value: 'deleted', label: 'Supprimés' },
];

/**
 * Find a member to write to: by name or e-mail (2 characters at least), or
 * by country, profession and interests. Picking one opens the conversation.
 */
export function NewConversationSheet({ open, onOpenChange, onPick }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPick: (user: AdminUserData) => void;
}) {
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [country, setCountry] = useState('');
    const [profession, setProfession] = useState('');
    const [interests, setInterests] = useState('');
    const [showMore, setShowMore] = useState(false);
    const [results, setResults] = useState<AdminUserData[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hasAdvanced = !!(country.trim() || profession.trim() || interests.trim());
    const canSearch = query.trim().length >= 2 || hasAdvanced;

    // Same search as before: 300 ms after the last keystroke, 20 results.
    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        if (!open || !canSearch) {
            setResults([]);
            setError(null);
            return;
        }
        timer.current = setTimeout(async () => {
            setLoading(true);
            setError(null);
            try {
                const filters: { search?: string; status?: 'active' | 'blocked' | 'deleted'; country?: string; profession?: string; interests?: string[] } = {};
                if (query.trim().length >= 2) filters.search = query;
                if (status !== 'all') filters.status = status;
                if (country.trim()) filters.country = country.trim();
                if (profession.trim()) filters.profession = profession.trim();
                if (interests.trim()) filters.interests = interests.split(',').map(i => i.trim()).filter(i => i.length > 0);
                const response = await listUsers(filters, { page: 1, limit: 20 });
                setResults(response.data);
            } catch (e) {
                console.error('Failed to search users:', e);
                setError(apiError(e, 'La recherche a échoué. Réessayez.'));
            } finally {
                setLoading(false);
            }
        }, 300);
        return () => { if (timer.current) clearTimeout(timer.current); };
    }, [open, canSearch, query, status, country, profession, interests]);

    const reset = () => {
        setQuery(''); setStatus('all'); setCountry(''); setProfession(''); setInterests('');
        setShowMore(false); setResults([]); setError(null);
    };

    const close = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <SheetContent title="Nouvelle conversation" description="Cherchez le membre à qui écrire.">
                <div className="space-y-3">
                    <div className="relative">
                        <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                        <Input
                            type="search"
                            aria-label="Rechercher par nom ou e-mail"
                            placeholder="Nom ou e-mail"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            className="h-11 pl-9"
                            autoFocus
                        />
                    </div>
                    <Segmented label="État du compte" value={status} onValueChange={setStatus} options={STATUS_OPTIONS} fill size="lg" />

                    <Button variant="ghost" size="lg" className="w-full justify-between px-3" onClick={() => setShowMore(v => !v)} aria-expanded={showMore}>
                        <span className="flex items-center gap-2">
                            <HugeiconsIcon icon={FilterIcon} size={16} aria-hidden="true" />
                            Pays, profession, centres d’intérêt
                            {hasAdvanced && <Badge tone="primary">Actifs</Badge>}
                        </span>
                        <HugeiconsIcon icon={showMore ? ArrowUp01Icon : ArrowDown01Icon} size={16} aria-hidden="true" />
                    </Button>
                    {showMore && (
                        <div className="space-y-3 rounded-panel border border-line p-3">
                            <Field label="Pays"><Input className="h-11" placeholder="ex. : CM, Cameroun…" value={country} onChange={e => setCountry(e.target.value)} /></Field>
                            <Field label="Profession"><Input className="h-11" placeholder="ex. : ingénieur, enseignant…" value={profession} onChange={e => setProfession(e.target.value)} /></Field>
                            <Field label="Centres d’intérêt" help="Séparés par des virgules.">
                                <Input className="h-11" placeholder="ex. : football, musique, tech…" value={interests} onChange={e => setInterests(e.target.value)} />
                            </Field>
                            {hasAdvanced && (
                                <Button variant="ghost" size="lg" className="w-full" onClick={() => { setCountry(''); setProfession(''); setInterests(''); }}>
                                    Effacer les filtres
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                <div className="mt-4">
                    {loading ? (
                        <div className="space-y-2" aria-busy="true">
                            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                        </div>
                    ) : error ? (
                        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
                    ) : results.length === 0 ? (
                        <EmptyState
                            icon={UserIcon}
                            title={canSearch ? 'Aucun membre trouvé' : 'Cherchez un membre'}
                            description={canSearch ? 'Essayez un autre nom ou retirez des filtres.' : 'Tapez au moins 2 caractères, ou utilisez les filtres.'}
                            className="py-8"
                        />
                    ) : (
                        <ul className="-mx-2 divide-y divide-line">
                            {results.map(user => (
                                <li key={user._id}>
                                    <button
                                        type="button"
                                        onClick={() => { onPick(user); reset(); }}
                                        className="flex min-h-14 w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
                                    >
                                        <Avatar src={getAvatarUrl(user.avatar)} name={user.name || '?'} size="md" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-fg">{user.name}</span>
                                            <span className="block truncate text-xs text-fg-muted">{user.email}</span>
                                        </span>
                                        {user.country && (
                                            <span className="flex shrink-0 items-center gap-1 text-xs text-fg-subtle">
                                                <HugeiconsIcon icon={Globe02Icon} size={12} aria-hidden="true" /> {user.country}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </SheetContent>
        </Dialog>
    );
}
