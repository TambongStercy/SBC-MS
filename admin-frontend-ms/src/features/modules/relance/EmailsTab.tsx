import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { Badge, ErrorState, ListSkeleton, NavList, NavRow } from '../../../ui';
import { listEmailDays } from './api';

export const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** The 7 SBC e-mails of the loop, one per day. */
export function EmailsTab() {
    const q = useQuery({ queryKey: ['relance', 'emails'], queryFn: listEmailDays });
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    return (
        <div className="space-y-3">
            <p className="text-sm text-ink-2">
                Ce que reçoit un filleul chaque jour, en relance des nouveaux comme en campagne. Une campagne écrite par son parrain envoie ses propres messages à la place.
            </p>
            {q.isLoading ? <ListSkeleton rows={7} /> : (
                <NavList>
                    {DAYS.map(day => {
                        const m = q.data?.find(x => x.dayNumber === day);
                        return (
                            <NavRow key={day} to={`/modules/relance/emails/${day}`} icon={<Mail size={18} />} tone={m?.active ? 'primary' : 'neutral'}
                                title={`Jour ${day}`}
                                description={m ? (m.subject || 'Objet automatique') : 'Pas encore écrit'}
                                trailing={!m ? <Badge tone="warning">À écrire</Badge> : !m.active ? <Badge tone="danger">Désactivé</Badge> : undefined} />
                        );
                    })}
                </NavList>
            )}
        </div>
    );
}
