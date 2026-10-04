import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { listMembers, setRole, type Member } from '../members/api';
import { MemberPicker } from '../members/MemberPicker';
import { Button, Card, ConfirmSheet, EmptyState, MemberLink, Page, SectionTitle, Select, Sheet, Skeleton, notify } from '../../ui';
import { ROLE_LABEL } from '../../lib/roles';

const STAFF = [
    { role: 'admin', what: 'Accès à tout l’admin.' },
    { role: 'withdrawal_admin', what: 'Valide les retraits ; rien d’autre.' },
    { role: 'moderator', what: 'Vérifie les vidéos Ads Network ; rien d’autre.' },
    { role: 'tester', what: 'Voit l’app sans les restrictions d’abonnement, pour tester ; pas d’accès à l’admin.' },
] as const;

/** Who has which role. Staff roles open the admin; each change asks first. */
export default function RolesPage() {
    const qc = useQueryClient();
    const lists = useQueries({ queries: STAFF.map(s => ({ queryKey: ['members', 'role', s.role], queryFn: () => listMembers({ role: s.role }, 1, 50) })) });
    const [adding, setAdding] = useState(false);
    const [member, setMember] = useState<Member | null>(null);
    const [newRole, setNewRole] = useState('moderator');
    const [pending, setPending] = useState<{ m: Member; role: string } | null>(null);

    const apply = async () => {
        if (!pending) return;
        await setRole(pending.m._id, pending.role);
        notify.success(`${pending.m.name} : ${ROLE_LABEL[pending.role] ?? pending.role}.`);
        qc.invalidateQueries({ queryKey: ['members'] });
        setAdding(false); setMember(null);
    };
    const staff = (role: string) => ['admin', 'withdrawal_admin', 'moderator'].includes(role);

    return (
        <Page title="Équipe admin" width="narrow" actions={<Button size="sm" icon={<UserPlus size={16} />} onClick={() => setAdding(true)}>Ajouter</Button>}>
            <div className="space-y-5">
                {STAFF.map((s, i) => {
                    const q = lists[i];
                    return (
                        <section key={s.role}>
                            <SectionTitle>{ROLE_LABEL[s.role]}{q.data ? ` · ${q.data.total}` : ''}</SectionTitle>
                            <p className="text-sm text-ink-2 -mt-1 mb-2">{s.what}</p>
                            {q.isLoading ? <Skeleton className="h-16 rounded-card" /> : !q.data?.items.length ? (
                                <Card><EmptyState className="py-6" title="Personne" /></Card>
                            ) : (
                                <ul className="bg-surface border border-border rounded-card divide-y divide-border">
                                    {q.data.items.map(m => (
                                        <li key={m._id} className="flex items-center gap-3 px-4 py-2.5">
                                            <div className="min-w-0 flex-1"><MemberLink id={m._id} name={m.name} phone={m.phoneNumber} avatar={m.avatar} sub={m.email} /></div>
                                            <Button size="sm" variant="ghost" onClick={() => setPending({ m, role: 'user' })}>Retirer</Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>

            <Sheet open={adding} onClose={() => { setAdding(false); setMember(null); }} title="Donner un rôle"
                footer={<Button full disabled={!member} onClick={() => member && setPending({ m: member, role: newRole })}>Continuer</Button>}>
                <div className="space-y-4">
                    <MemberPicker value={member} onChange={setMember} autoFocus />
                    <Select label="Rôle" value={newRole} onChange={e => setNewRole(e.target.value)}>
                        {STAFF.map(s => <option key={s.role} value={s.role}>{ROLE_LABEL[s.role]}</option>)}
                    </Select>
                    <p className="text-sm text-ink-2">{STAFF.find(s => s.role === newRole)?.what}</p>
                </div>
            </Sheet>

            {pending && (
                <ConfirmSheet open onClose={() => setPending(null)} tone={staff(pending.role) ? 'danger' : 'primary'}
                    title={pending.role === 'user' ? `Retirer le rôle de ${pending.m.name} ?` : `${pending.m.name} : ${ROLE_LABEL[pending.role]} ?`}
                    message={<p>{pending.role === 'user'
                        ? `${pending.m.name} redevient un membre simple${staff(pending.m.role ?? '') ? ' et perd l’accès à l’admin' : ''}.`
                        : staff(pending.role) ? `${pending.m.name} pourra se connecter à l’admin : ${STAFF.find(s => s.role === pending.role)?.what.toLowerCase()}` : STAFF.find(s => s.role === pending.role)?.what}</p>}
                    confirmLabel={pending.role === 'user' ? 'Retirer' : 'Donner le rôle'} onConfirm={apply} />
            )}
        </Page>
    );
}
