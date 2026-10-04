import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, ConfirmSheet, ErrorState, IconButton, Input, Page, SectionTitle, Sheet, Skeleton, Spinner, Switch, Textarea, notify } from '../../../ui';
import { errorMessage } from '../../../lib/hooks';
import { listEmailDays, previewEmailDay, saveEmailDay, type EmailButton, type EmailDay } from './api';
import { DAYS } from './EmailsTab';

const VARIABLES: Array<[string, string]> = [['{{name}}', 'Prénom du filleul'], ['{{referrerName}}', 'Nom du parrain'], ['{{day}}', 'Numéro du jour']];
const MAX_BUTTONS = 3;
const DEFAULT_COLOR = '#F59E0B';

type Field = 'subject' | 'fr' | 'en';

function blank(day: number): EmailDay {
    return { dayNumber: day, subject: '', messageTemplate: { fr: '', en: '' }, mediaUrls: [], buttons: [], active: true };
}

/** Edit one of the 7 SBC relance e-mails: subject, French and English text, buttons, on/off. */
export default function EmailDayPage() {
    const day = Number(useParams().day);
    const valid = DAYS.includes(day);
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['relance', 'emails'], queryFn: listEmailDays, enabled: valid });
    const saved = useMemo(() => q.data?.find(m => m.dayNumber === day), [q.data, day]);

    const [form, setForm] = useState<EmailDay | null>(null);
    useEffect(() => { if (q.data) setForm(JSON.parse(JSON.stringify(saved ?? blank(day)))); }, [q.data, saved, day]);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmOff, setConfirmOff] = useState(false);
    const [preview, setPreview] = useState<{ html: string | null; error?: string } | null>(null);

    // Variables go where the cursor was last, in whichever field had it.
    const refs = { subject: useRef<HTMLInputElement>(null), fr: useRef<HTMLTextAreaElement>(null), en: useRef<HTMLTextAreaElement>(null) };
    const [lastField, setLastField] = useState<Field>('fr');

    if (!valid) return <Page title="E-mail" back="/modules/relance?onglet=emails"><ErrorState message="Ce jour n’existe pas." /></Page>;

    const backTo = '/modules/relance?onglet=emails';
    if (q.isError) return <Page title={`E-mail du jour ${day}`} back={backTo}><ErrorState onRetry={() => q.refetch()} /></Page>;
    if (!form) return <Page title={`E-mail du jour ${day}`} back={backTo}><Skeleton className="h-96" /></Page>;

    const set = (patch: Partial<EmailDay>) => { setForm({ ...form, ...patch }); setError(null); };
    const setText = (field: Field, value: string) =>
        field === 'subject' ? set({ subject: value }) : set({ messageTemplate: { ...form.messageTemplate, [field]: value } });
    const textOf = (field: Field) => (field === 'subject' ? form.subject ?? '' : form.messageTemplate[field]);

    const insert = (token: string) => {
        const el = refs[lastField].current;
        const value = textOf(lastField);
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        setText(lastField, value.slice(0, start) + token + value.slice(end));
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
    };

    const setButton = (i: number, patch: Partial<EmailButton>) => set({ buttons: form.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

    const problem = (): string | null => {
        if (!form.messageTemplate.fr.trim()) return 'Écris le texte en français.';
        // The sender picks the English text for English-speaking filleuls; empty, they would get an empty e-mail.
        if (!form.messageTemplate.en.trim()) return 'Écris aussi le texte en anglais : les filleuls anglophones le reçoivent.';
        for (const b of form.buttons) {
            if (!b.label.trim()) return 'Chaque bouton a besoin d’un texte.';
            if (!/^https?:\/\/\S+$/i.test(b.url.trim())) return `Le lien du bouton « ${b.label} » doit commencer par https://`;
        }
        return null;
    };

    const dirty = JSON.stringify(form) !== JSON.stringify(saved ?? blank(day));

    const save = async () => {
        const p = problem();
        if (p) { setError(p); return; }
        setSaving(true);
        try {
            await saveEmailDay({
                dayNumber: day,
                // Sent even when empty: an empty subject means "automatic", and leaving it out would keep the old one.
                subject: (form.subject ?? '').trim(),
                messageTemplate: { fr: form.messageTemplate.fr, en: form.messageTemplate.en },
                mediaUrls: form.mediaUrls,
                buttons: form.buttons.map(b => ({ label: b.label.trim(), url: b.url.trim(), color: b.color || DEFAULT_COLOR })),
                active: form.active,
            });
            await qc.invalidateQueries({ queryKey: ['relance', 'emails'] });
            notify.success(`E-mail du jour ${day} enregistré.`);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    };
    const onSave = () => (saved?.active !== false && !form.active ? setConfirmOff(true) : save());

    const openPreview = async () => {
        if (!form.messageTemplate.fr.trim()) { setError('Écris le texte en français pour voir l’aperçu.'); return; }
        setPreview({ html: null });
        try {
            const html = await previewEmailDay({
                dayNumber: day, subject: form.subject || undefined, messageTemplate: form.messageTemplate, mediaUrls: form.mediaUrls,
                buttons: form.buttons.filter(b => b.label.trim() && b.url.trim()),
            });
            setPreview({ html });
        } catch (e) {
            setPreview({ html: null, error: errorMessage(e) });
        }
    };

    return (
        <Page title={`E-mail du jour ${day}`} subtitle={saved ? undefined : 'Pas encore écrit'} back={backTo} width="narrow">
            <div className="space-y-4">
                <Card className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="font-semibold">Envoyer ce jour</p>
                        <p className="text-sm text-ink-2">
                            {form.active ? 'Les filleuls arrivés au jour ' + day + ' reçoivent cet e-mail.'
                                : 'Désactivé : les filleuls arrivés à ce jour restent bloqués dessus et ne reçoivent plus d’e-mail tant qu’il n’est pas réactivé.'}
                        </p>
                    </div>
                    <Switch checked={form.active} onChange={v => set({ active: v })} label="Envoyer ce jour" />
                </Card>

                <Card className="space-y-4">
                    <Input ref={refs.subject} label="Objet" value={form.subject ?? ''} onChange={e => setText('subject', e.target.value)} onFocus={() => setLastField('subject')}
                        placeholder="Vide = objet automatique" maxLength={150} />
                    <Textarea ref={refs.fr} label="Texte en français" rows={9} value={form.messageTemplate.fr}
                        onChange={e => setText('fr', e.target.value)} onFocus={() => setLastField('fr')} />
                    <Textarea ref={refs.en} label="Texte en anglais" rows={9} value={form.messageTemplate.en}
                        onChange={e => setText('en', e.target.value)} onFocus={() => setLastField('en')} hint="Pour les filleuls qui ont choisi l’anglais." />
                    <div>
                        <p className="text-sm font-semibold mb-1.5">Insérer</p>
                        <div className="flex flex-wrap gap-1.5">
                            {VARIABLES.map(([token, label]) => (
                                <button key={token} type="button" onMouseDown={e => e.preventDefault()} onClick={() => insert(token)}
                                    className="rounded-pill border border-border px-3 h-9 text-sm text-ink-2 hover:bg-surface-2">{label}</button>
                            ))}
                        </div>
                        <p className="mt-1.5 text-xs text-ink-3">Remplacé à l’envoi par le vrai prénom, nom ou numéro du jour.</p>
                    </div>
                </Card>

                <Card className="space-y-3">
                    <SectionTitle className="mb-0">Boutons</SectionTitle>
                    {form.buttons.length === 0 && <p className="text-sm text-ink-3">Aucun bouton.</p>}
                    {form.buttons.map((b, i) => (
                        <div key={i} className="rounded-tile border border-border p-3 space-y-2">
                            <div className="flex items-end gap-2">
                                <div className="flex-1"><Input label="Texte du bouton" value={b.label} onChange={e => setButton(i, { label: e.target.value })} placeholder="J’active mon compte" maxLength={60} /></div>
                                <label className="shrink-0 mb-[1px]" title="Couleur">
                                    <span className="sr-only">Couleur</span>
                                    <input type="color" value={b.color || DEFAULT_COLOR} onChange={e => setButton(i, { color: e.target.value })}
                                        className="h-11 w-11 rounded-tile border border-border bg-surface p-1 cursor-pointer" />
                                </label>
                                <IconButton label="Retirer ce bouton" onClick={() => set({ buttons: form.buttons.filter((_, j) => j !== i) })}><Trash2 size={18} /></IconButton>
                            </div>
                            <Input label="Lien" type="url" inputMode="url" value={b.url} onChange={e => setButton(i, { url: e.target.value })} placeholder="https://sniperbuisnesscenter.com/connexion" />
                        </div>
                    ))}
                    {form.buttons.length < MAX_BUTTONS && (
                        <Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => set({ buttons: [...form.buttons, { label: '', url: '', color: DEFAULT_COLOR }] })}>Ajouter un bouton</Button>
                    )}
                </Card>

                {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" onClick={openPreview}>Aperçu</Button>
                    <Button onClick={onSave} loading={saving} disabled={!dirty}>Enregistrer</Button>
                </div>
            </div>

            <ConfirmSheet open={confirmOff} onClose={() => setConfirmOff(false)} tone="danger" title={`Désactiver le jour ${day} ?`}
                message={<p>Les filleuls qui arrivent au jour {day} restent bloqués dessus : ils ne reçoivent plus d’e-mail de relance, en relance des nouveaux comme dans les campagnes qui utilisent les messages SBC, tant que le jour n’est pas réactivé.</p>}
                confirmLabel="Désactiver et enregistrer" onConfirm={save} />

            <Sheet open={!!preview} onClose={() => setPreview(null)} size="lg" title="Aperçu (version française)">
                {preview?.error ? <p className="text-sm text-danger">{preview.error}</p>
                    : !preview?.html ? <Spinner className="py-16" />
                        : <iframe title="Aperçu de l’e-mail" sandbox="" srcDoc={preview.html} className="w-full h-[65vh] rounded-tile border border-border" />}
                <p className="mt-2 text-xs text-ink-3">Avec un filleul « Aïcha » et un parrain « Paul » pour l’exemple.</p>
            </Sheet>
        </Page>
    );
}
