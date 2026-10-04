import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { listMembers, type Member } from './api';
import { Avatar, Card, SearchInput, Spinner } from '../../ui';
import { formatPhone } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';

/** Find one member by name, phone, email or id. */
export function MemberPicker({ value, onChange, autoFocus }: { value: Member | null; onChange: (m: Member | null) => void; autoFocus?: boolean }) {
    const [q, setQ] = useState('');
    const term = useDebounced(q.trim());
    const results = useQuery({
        queryKey: ['member-picker', term],
        queryFn: () => listMembers({ search: term }, 1, 8),
        enabled: term.length >= 2 && !value,
    });

    if (value) {
        return (
            <Card className="flex items-center gap-3">
                <Avatar name={value.name} src={value.avatar} size={40} />
                <div className="min-w-0 flex-1"><p className="font-semibold truncate">{value.name}</p><p className="text-sm text-ink-2">{formatPhone(value.phoneNumber)}</p></div>
                <button type="button" aria-label="Changer de membre" onClick={() => onChange(null)} className="size-9 grid place-items-center rounded-pill text-ink-3 hover:bg-surface-2"><X size={18} /></button>
            </Card>
        );
    }
    return (
        <div className="space-y-2">
            <SearchInput value={q} onChange={setQ} placeholder="Nom, téléphone, email ou ID du membre" autoFocus={autoFocus} />
            {results.isFetching && <Spinner className="py-4" label="Recherche…" />}
            {results.data && results.data.items.length === 0 && <p className="text-sm text-ink-3 px-1">Aucun membre trouvé.</p>}
            {results.data && results.data.items.length > 0 && (
                <ul className="bg-surface border border-border rounded-card divide-y divide-border overflow-hidden">
                    {results.data.items.map(m => (
                        <li key={m._id}>
                            <button type="button" onClick={() => onChange(m)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                                <Avatar name={m.name} src={m.avatar} size={32} />
                                <span className="min-w-0"><span className="block font-semibold truncate">{m.name}</span><span className="block text-xs text-ink-2">{formatPhone(m.phoneNumber)}{m.email ? ` · ${m.email}` : ''}</span></span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
