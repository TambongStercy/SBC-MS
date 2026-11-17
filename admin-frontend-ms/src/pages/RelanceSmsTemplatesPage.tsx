import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Edit02Icon, FloppyDiskIcon, MessageMultiple01Icon, PencilEdit01Icon, Robot01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { getSmsTemplates, previewSmsTemplate, updateSmsTemplate, type SmsTemplate } from '../services/adminRelanceApi';
import { usePermission } from '../hooks/usePermission';
import { Can } from '../components/Can';
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Segmented, Skeleton, Switch, Textarea } from '../components/ui';
import { cn } from '../lib/cn';
import { ErrorState } from '../components/display/ErrorState';
import { apiError, fmtInt } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';

const SMS_LEN = 160;
// GSM 03.38 basic set (+ extension chars). Anything else (emoji, œ, ’…) makes the SMS Unicode: 70 characters, 67 per part.
const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
function smsParts(text: string): { parts: number; unicode: boolean; limit: number } {
    const unicode = !GSM.test(text);
    const single = unicode ? 70 : SMS_LEN;
    const multi = unicode ? 67 : 153;
    const n = [...text].length;
    return { parts: n <= single ? 1 : Math.ceil(n / multi), unicode, limit: single };
}
const dayLabel = (t: SmsTemplate) => (t.type === 'auto' ? (t.dayNumber === 0 ? 'J0 · 15 min après l’inscription' : `J${t.dayNumber}`) : `Jour ${t.dayNumber}`);

/**
 * Fixed relance SMS (Cameroonian parrains only, sent to +237 numbers): the
 * parrain only adds his link through {{link}}. "Automatique" follows the
 * 7-day journey (J0–J7); "Manuel" is what a parrain sends by hand.
 */
export default function RelanceSmsTemplatesPage() {
    const queryClient = useQueryClient();
    const canWrite = usePermission('relance') === 'write';
    const url = useUrlParams({ type: 'auto' });
    const type = (url.get('type') === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual';
    const [link, setLink] = useState('https://sniperbuisnesscenter.com/p/MONCODE');
    const [editing, setEditing] = useState<string | null>(null);
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const [toggling, setToggling] = useState<string | null>(null);
    const [previews, setPreviews] = useState<Record<string, { rendered: string; characterCount: number }>>({});
    const [previewing, setPreviewing] = useState<string | null>(null);

    const templates = useQuery({ queryKey: ['relance-sms-templates'], queryFn: getSmsTemplates });
    const rows = (templates.data ?? []).filter(t => t.type === type).sort((a, b) => a.dayNumber - b.dayNumber);
    const counts = { auto: (templates.data ?? []).filter(t => t.type === 'auto').length, manual: (templates.data ?? []).filter(t => t.type === 'manual').length };

    const replace = (u: SmsTemplate) => queryClient.setQueryData<SmsTemplate[]>(['relance-sms-templates'], prev => prev?.map(t => (t._id === u._id ? u : t)));
    const length = (s: string) => s.replace(/\{\{link\}\}/g, link).length;

    const save = async (t: SmsTemplate) => {
        if (!text.trim()) { toast.error('Le texte ne peut pas être vide.'); return; }
        setSaving(true);
        try {
            replace(await updateSmsTemplate(t.type, t.dayNumber, { templateText: text }));
            setEditing(null);
            setPreviews(p => { const n = { ...p }; delete n[t._id]; return n; });
            toast.success(`SMS ${dayLabel(t)} enregistré.`);
        } catch (error) {
            toast.error(apiError(error, 'Le SMS n’a pas pu être enregistré.'));
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (t: SmsTemplate) => {
        setToggling(t._id);
        try {
            const u = await updateSmsTemplate(t.type, t.dayNumber, { active: !t.active });
            replace(u);
            toast.success(u.active ? 'SMS activé.' : 'SMS coupé : il ne part plus.');
        } catch (error) {
            toast.error(apiError(error, 'Le changement n’a pas pu être enregistré.'));
        } finally {
            setToggling(null);
        }
    };

    const preview = async (t: SmsTemplate) => {
        setPreviewing(t._id);
        try {
            const p = await previewSmsTemplate(t.type, t.dayNumber, link);
            setPreviews(prev => ({ ...prev, [t._id]: p }));
        } catch (error) {
            toast.error(apiError(error, 'L’aperçu n’a pas pu être créé.'));
        } finally {
            setPreviewing(null);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="SMS de relance"
                description="Les SMS tout prêts des parrains du Cameroun (numéros +237 uniquement) : le parrain n’ajoute que son lien, à la place de {{link}}."
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <Segmented
                    size="lg"
                    label="Type de SMS"
                    value={type}
                    onValueChange={v => { url.set({ type: v }); setEditing(null); }}
                    options={[
                        { value: 'auto', label: `Automatiques (J0–J7)${counts.auto ? ` · ${counts.auto}` : ''}`, icon: Robot01Icon },
                        { value: 'manual', label: `Manuels${counts.manual ? ` · ${counts.manual}` : ''}`, icon: PencilEdit01Icon },
                    ]}
                />
                <Field label="Lien d’exemple pour les aperçus" className="w-full sm:max-w-sm">
                    <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" className="h-11 md:h-9" />
                </Field>
            </div>

            {templates.isLoading ? (
                <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>
            ) : templates.isError ? (
                <Panel><ErrorState message={apiError(templates.error, 'Les SMS n’ont pas pu être chargés.')} onRetry={() => void templates.refetch()} retrying={templates.isFetching} /></Panel>
            ) : rows.length === 0 ? (
                <Panel><EmptyState icon={MessageMultiple01Icon} title="Aucun SMS de ce type" description="Les modèles sont créés par le service de relance." /></Panel>
            ) : (
                <ul className="space-y-3">
                    {rows.map(t => {
                        const isEditing = editing === t._id;
                        const body = (isEditing ? text : t.templateText).replace(/\{\{link\}\}/g, link);
                        const n = length(isEditing ? text : t.templateText);
                        const { parts, unicode, limit } = smsParts(body);
                        const p = previews[t._id];
                        return (
                            <li key={t._id}>
                                <Panel className={cn(!t.active && 'bg-surface-2/60')}>
                                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-semibold text-fg">{dayLabel(t)}</span>
                                            {t.active ? <Badge tone="success">Envoyé</Badge> : <Badge tone="neutral">Coupé</Badge>}
                                            <span className={cn('text-xs tabular-nums', n > limit ? 'text-warning' : 'text-fg-muted')} title={unicode ? 'Emoji ou caractère spécial : 70 caractères par SMS au lieu de 160.' : undefined}>
                                                {fmtInt(n)} caractères · {parts} SMS{unicode ? ' (Unicode)' : ''}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="sm" className="h-11 md:h-8" loading={previewing === t._id} onClick={() => void preview(t)}>
                                                {previewing !== t._id && <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />}
                                                Aperçu
                                            </Button>
                                            {!isEditing && (
                                                <Can module="relance" write>
                                                    <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => { setEditing(t._id); setText(t.templateText); }}>
                                                        <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />
                                                        Modifier
                                                    </Button>
                                                </Can>
                                            )}
                                            <label className="ml-1 flex min-h-11 items-center gap-2 text-sm text-fg-muted md:min-h-0">
                                                <Switch
                                                    checked={t.active}
                                                    disabled={!canWrite || toggling === t._id}
                                                    onCheckedChange={() => void toggle(t)}
                                                    aria-label={`${t.active ? 'Couper' : 'Activer'} le SMS ${dayLabel(t)}`}
                                                />
                                                <span className="sr-only sm:not-sr-only">Actif</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5">
                                        {isEditing ? (
                                            <>
                                                <Field label="Texte du SMS" help="Gardez {{link}} : il est remplacé par le lien du parrain. Au-delà de 160 caractères (70 avec un emoji ou un caractère spécial), le message part en plusieurs SMS.">
                                                    <Textarea value={text} onChange={e => setText(e.target.value)} rows={5} className="font-mono text-sm" autoFocus />
                                                </Field>
                                                {!text.includes('{{link}}') && <p className="text-xs text-warning">Ce texte ne contient pas {'{{link}}'} : le parrain ne pourra pas y mettre son lien.</p>}
                                                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                                    <Button size="lg" onClick={() => setEditing(null)} disabled={saving}>Annuler</Button>
                                                    <Button variant="primary" size="lg" loading={saving} onClick={() => void save(t)}>
                                                        {!saving && <HugeiconsIcon icon={FloppyDiskIcon} size={16} aria-hidden="true" />}
                                                        Enregistrer
                                                    </Button>
                                                </div>
                                            </>
                                        ) : (
                                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{t.templateText}</p>
                                        )}
                                        {p && (
                                            <div className="rounded-md border border-line bg-surface-2 p-3">
                                                <p className="mb-1 text-xs text-fg-muted">Ce que reçoit le filleul ({fmtInt(p.characterCount)} caractères) :</p>
                                                <p className="whitespace-pre-wrap text-sm text-fg">{p.rendered}</p>
                                            </div>
                                        )}
                                    </div>
                                </Panel>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
