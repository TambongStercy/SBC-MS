import { useQuery } from '@tanstack/react-query';
import { getMember } from './api';
import { MemberLink, Skeleton } from '../../ui';

/** A member shown by name when the record only carries their id. Cached per member. */
export function MemberById({ id, fallback = 'Membre' }: { id?: string | null; fallback?: string }) {
    const q = useQuery({ queryKey: ['member', id], queryFn: () => getMember(id!), enabled: !!id, staleTime: 300_000 });
    if (!id) return <span className="text-sm text-ink-3">—</span>;
    if (q.isLoading) return <Skeleton className="h-9 w-40" />;
    return <MemberLink id={id} name={q.data?.name ?? fallback} phone={q.data?.phoneNumber} avatar={q.data?.avatar} />;
}
