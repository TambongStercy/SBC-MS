import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteMember, restoreMember, setBlocked, setPartnerPack, setRole, setSubscription, type Member } from './api';
import { Button, Card, ConfirmSheet, SectionTitle, Select, notify } from '../../ui';
import { ROLE_LABEL } from '../../lib/roles';

type Pending =
    | { kind: 'subscription'; value: 'CLASSIQUE' | 'CIBLE' | 'NONE' }
    | { kind: 'pack'; value: 'silver' | 'gold' | 'none' }
    | { kind: 'role'; value: string }
    | { kind: 'block' } | { kind: 'unblock' } | { kind: 'delete' } | { kind: 'restore' };

const SUB_NAME = { CLASSIQUE: 'Classique', CIBLE: 'Ciblé', NONE: 'aucun abonnement' };
const PACK_NAME = { silver: 'Silver', gold: 'Gold', none: 'aucun pack' };

/** What the member is and can do: subscription, partner pack, role, blocking. Every change asks first. */
export function MemberAccess({ member }: { member: Member }) {
    const qc = useQueryClient();
    const subs = member.activeSubscriptionTypes ?? [];
    const currentSub: 'CLASSIQUE' | 'CIBLE' | 'NONE' = subs.includes('CIBLE') ? 'CIBLE' : subs.includes('CLASSIQUE') ? 'CLASSIQUE' : 'NONE';
    const [sub, setSub] = useState<string>(currentSub);
    const [pack, setPack] = useState<string>(member.partnerPack ?? 'none');
    const [role, setRoleValue] = useState<string>(member.role ?? 'user');
    const [pending, setPending] = useState<Pending | null>(null);

    const refresh = () => { qc.invalidateQueries({ queryKey: ['member', member._id] }); qc.invalidateQueries({ queryKey: ['members'] }); };

    const run = async () => {
        if (!pending) return;
        switch (pending.kind) {
            case 'subscription': await setSubscription(member._id, pending.value); notify.success('Abonnement mis à jour.'); break;
            case 'pack': await setPartnerPack(member._id, pending.value); notify.success('Pack partenaire mis à jour.'); break;
            case 'role': await setRole(member._id, pending.value); notify.success(`Rôle : ${ROLE_LABEL[pending.value] ?? pending.value}.`); break;
            case 'block': await setBlocked(member._id, true); notify.success(`${member.name} est bloqué.`); break;
            case 'unblock': await setBlocked(member._id, false); notify.success(`${member.name} est débloqué.`); break;
            case 'delete': await deleteMember(member._id); notify.success(`${member.name} est supprimé.`); break;
            case 'restore': await restoreMember(member._id); notify.success(`${member.name} est restauré.`); break;
        }
        refresh();
    };

    const sheet = (() => {
        if (!pending) return null;
        switch (pending.kind) {
            case 'subscription': return { title: "Changer l'abonnement ?", tone: 'primary' as const, label: 'Appliquer',
                message: <p>{member.name} passera à <b className="text-ink">{SUB_NAME[pending.value]}</b>. Cela change ses accès et ce qu’il touche sur ses filleuls.</p> };
            case 'pack': return { title: 'Changer le pack partenaire ?', tone: 'primary' as const, label: 'Appliquer',
                message: <p>{member.name} passera à <b className="text-ink">{PACK_NAME[pending.value]}</b>. Cela change ses commissions de partenaire.</p> };
            case 'role': {
                const staff = ['admin', 'withdrawal_admin', 'moderator'].includes(pending.value);
                return { title: `Rôle : ${ROLE_LABEL[pending.value] ?? pending.value} ?`, tone: staff ? 'danger' as const : 'primary' as const, label: 'Changer le rôle',
                    message: <p>{staff ? `${member.name} aura accès à l’administration (${ROLE_LABEL[pending.value]}).` : `${member.name} n’aura plus accès à l’administration.`}</p> };
            }
            case 'block': return { title: `Bloquer ${member.name} ?`, tone: 'danger' as const, label: 'Bloquer', message: <p>Le membre ne pourra plus se connecter.</p> };
            case 'unblock': return { title: `Débloquer ${member.name} ?`, tone: 'success' as const, label: 'Débloquer', message: <p>Le membre pourra de nouveau se connecter.</p> };
            case 'delete': return { title: `Supprimer ${member.name} ?`, tone: 'danger' as const, label: 'Supprimer', message: <p>Le compte disparaît de l’app. Il reste visible ici et peut être restauré.</p> };
            case 'restore': return { title: `Restaurer ${member.name} ?`, tone: 'success' as const, label: 'Restaurer', message: <p>Le compte réapparaît dans l’app.</p> };
        }
    })();

    return (
        <div className="space-y-4">
            <Card className="space-y-4">
                <SectionTitle>Abonnement et partenariat</SectionTitle>
                <div className="flex items-end gap-2">
                    <div className="flex-1"><Select label="Abonnement" value={sub} onChange={e => setSub(e.target.value)}>
                        <option value="NONE">Aucun</option><option value="CLASSIQUE">Classique</option><option value="CIBLE">Ciblé</option>
                    </Select></div>
                    <Button variant="secondary" disabled={sub === currentSub} onClick={() => setPending({ kind: 'subscription', value: sub as 'CLASSIQUE' | 'CIBLE' | 'NONE' })}>Appliquer</Button>
                </div>
                <div className="flex items-end gap-2">
                    <div className="flex-1"><Select label="Pack partenaire" value={pack} onChange={e => setPack(e.target.value)}>
                        <option value="none">Aucun</option><option value="silver">Silver</option><option value="gold">Gold</option>
                    </Select></div>
                    <Button variant="secondary" disabled={pack === (member.partnerPack ?? 'none')} onClick={() => setPending({ kind: 'pack', value: pack as 'silver' | 'gold' | 'none' })}>Appliquer</Button>
                </div>
            </Card>
            <Card className="space-y-4">
                <SectionTitle>Rôle</SectionTitle>
                <div className="flex items-end gap-2">
                    <div className="flex-1"><Select label="Rôle dans SBC" value={role} onChange={e => setRoleValue(e.target.value)}>
                        <option value="user">Membre</option><option value="tester">Testeur</option>
                        <option value="moderator">Modérateur (vérifications vidéo)</option><option value="withdrawal_admin">Admin retraits</option><option value="admin">Administrateur</option>
                    </Select></div>
                    <Button variant="secondary" disabled={role === (member.role ?? 'user')} onClick={() => setPending({ kind: 'role', value: role })}>Changer</Button>
                </div>
            </Card>
            <Card className="space-y-3">
                <SectionTitle>Compte</SectionTitle>
                <div className="flex flex-wrap gap-2">
                    {member.deleted ? (
                        <Button variant="success" onClick={() => setPending({ kind: 'restore' })}>Restaurer le compte</Button>
                    ) : (
                        <>
                            {member.blocked
                                ? <Button variant="success" onClick={() => setPending({ kind: 'unblock' })}>Débloquer</Button>
                                : <Button variant="danger-soft" onClick={() => setPending({ kind: 'block' })}>Bloquer</Button>}
                            <Button variant="danger-soft" onClick={() => setPending({ kind: 'delete' })}>Supprimer le compte</Button>
                        </>
                    )}
                </div>
            </Card>
            {sheet && <ConfirmSheet open onClose={() => setPending(null)} title={sheet.title} tone={sheet.tone} confirmLabel={sheet.label} message={sheet.message} onConfirm={run} />}
        </div>
    );
}
