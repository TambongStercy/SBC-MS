import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { Badge, Button, ConfirmSheet, ErrorState, ListSkeleton, NavList, NavRow, SectionTitle, Sheet, Switch, Textarea, notify } from '../../../ui';
import { errorMessage } from '../../../lib/hooks';
import { listSms, saveSms, type SmsKind, type SmsTemplate } from './api';

const LINK = '{{link}}';

const dayLabel = (t: SmsTemplate) => (t.type === 'auto' && t.dayNumber === 0 ? 'J0 · 15 min après l’inscription' : `Jour ${t.dayNumber}`);

/** Edit one SMS: text (with the parrain's link) and on/off. */
function SmsSheet({ t, onClose }: { t: SmsTemplate; onClose: () => void }) {
    const qc = useQueryClient();
    const [text, setText] = useState(t.templateText);
    const [active, setActive] = useState(t.active);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmOff, setConfirmOff] = useState(false);
    useEffect(() => { setText(t.templateText); setActive(t.active); }, [t]);

    const withoutLink = text.split(LINK).join('').length;
    const hasLink = text.includes(LINK);
    const dirty = text !== t.templateText || active !== t.active;

    const save = async () => {
        if (!text.trim()) { setError('Le SMS ne peut pas être vide.'); return; }
        setSaving(true); setError(null);
        try {
            await saveSms(t, { templateText: text, active });
            await qc.invalidateQueries({ queryKey: ['relance', 'sms'] });
            notify.success('SMS enregistré.');
            onClose();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet open onClose={onClose} busy={saving} title={`${t.type === 'auto' ? 'Nouveaux' : 'Campagnes'} · ${dayLabel(t)}`}
            footer={<div className="flex justify-end"><Button onClick={() => (t.active && !active ? setConfirmOff(true) : save())} loading={saving} disabled={!dirty}>Enregistrer</Button></div>}>
            <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="font-semibold">Envoyer ce SMS</p>
                        <p className="text-sm text-ink-2">{active ? 'Part ce jour-là, avec l’e-mail.' : 'Désactivé : ce jour-là, seul l’e-mail part.'}</p>
                    </div>
                    <Switch checked={active} onChange={setActive} label="Envoyer ce SMS" />
                </div>
                <Textarea label="Texte" rows={6} value={text} onChange={e => { setText(e.target.value); setError(null); }}
                    hint={`${withoutLink} caractères${hasLink ? ' + le lien du parrain' : ''}`} error={error} />
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" disabled={hasLink} onClick={() => setText(text.trimEnd() + ' ' + LINK)}>Ajouter le lien du parrain</Button>
                    {!hasLink && <span className="text-xs text-warning">Sans lien, le parrain n’a rien à mettre dans ce SMS.</span>}
                </div>
                <p className="text-xs text-ink-3">{LINK} est remplacé par le lien que le parrain a enregistré pour ce jour. S’il n’en a pas mis, il disparaît du message.</p>
            </div>
            <ConfirmSheet open={confirmOff} onClose={() => setConfirmOff(false)} title="Désactiver ce SMS ?"
                message={<p>Ce jour-là, les filleuls ne recevront que l’e-mail. Les crédits SMS des parrains ne seront pas utilisés pour ce jour.</p>}
                confirmLabel="Désactiver et enregistrer" onConfirm={save} />
        </Sheet>
    );
}

function Group({ title, intro, items, onOpen }: { title: string; intro: string; items: SmsTemplate[]; onOpen: (t: SmsTemplate) => void }) {
    return (
        <section>
            <SectionTitle>{title}</SectionTitle>
            <p className="-mt-1 mb-2 text-sm text-ink-2">{intro}</p>
            {items.length === 0 ? <p className="text-sm text-ink-3">Aucun SMS.</p> : (
                <NavList>
                    {items.map(t => (
                        <NavRow key={t._id} icon={<MessageSquare size={18} />} tone={t.active ? 'primary' : 'neutral'} onClick={() => onOpen(t)}
                            title={dayLabel(t)} description={t.templateText}
                            trailing={!t.active ? <Badge tone="danger">Désactivé</Badge> : undefined} />
                    ))}
                </NavList>
            )}
        </section>
    );
}

/** The SMS texts relance sends, with each parrain's own link. */
export function SmsTab() {
    const q = useQuery({ queryKey: ['relance', 'sms'], queryFn: listSms });
    const [openId, setOpenId] = useState<string | null>(null);
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    if (q.isLoading) return <ListSkeleton rows={8} />;
    const of = (k: SmsKind) => (q.data ?? []).filter(t => t.type === k).sort((a, b) => a.dayNumber - b.dayNumber);
    const open = q.data?.find(t => t._id === openId) ?? null;
    return (
        <div className="space-y-6">
            <p className="text-sm text-ink-2">
                Partent seulement vers des numéros du Cameroun (+237), aux filleuls sans abonnement, pour les parrains qui ont activé les SMS et ont des crédits SMS.
            </p>
            <Group title="Relance des nouveaux" intro="Du J0 (15 minutes après l’inscription) au jour 7." items={of('auto')} onOpen={t => setOpenId(t._id)} />
            <Group title="Campagnes de relance" intro="Jours 1 à 7, pour les campagnes créées avec les SMS." items={of('manual')} onOpen={t => setOpenId(t._id)} />
            {open && <SmsSheet t={open} onClose={() => setOpenId(null)} />}
        </div>
    );
}
