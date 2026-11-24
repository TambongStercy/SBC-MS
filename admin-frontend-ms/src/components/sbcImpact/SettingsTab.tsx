import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, LockIcon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { Badge, Button, Checkbox, Field, Input, Panel, PanelBody, PanelHeader, Textarea } from '../ui';
import { Notice, formatNumber } from '../moduleKit';
import { cn } from '../../lib/cn';
import {
    RULES_MIN_LENGTH, fieldLabel, isEditionClosed, lockReason, readImpactError, updateEdition,
    type Edition, type LockableField,
} from '../../services/impactV2Api';
import { diffEdition, num, toDraft, type Draft } from './settingsDraft';

// ---------- Small pieces ----------

/** "settings.maxCandidates" / "schedule.finalAt" → the draft key. */
const draftKey = (field: string) => field.replace(/^(settings|schedule)\./, '');

function Section({ title, description, lock, children }: { title: string; description?: ReactNode; lock?: string | null; children: ReactNode }) {
    return (
        <Panel>
            <PanelHeader
                title={<span className="flex flex-wrap items-center gap-2">{title}{lock && <Badge tone="neutral"><HugeiconsIcon icon={LockIcon} size={12} aria-hidden="true" />Verrouillé</Badge>}</span>}
                description={lock ?? description}
            />
            <PanelBody className="space-y-4">{children}</PanelBody>
        </Panel>
    );
}

function ListEditor<T>({ label, help, rows, onChange, render, blank, max, min = 0, disabled, error }: {
    label: string;
    help?: ReactNode;
    rows: T[];
    onChange: (rows: T[]) => void;
    render: (row: T, set: (patch: Partial<T>) => void, index: number) => ReactNode;
    blank: () => T;
    max: number;
    min?: number;
    disabled?: boolean;
    error?: string;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-fg">{label}</p>
                {!disabled && (
                    <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => onChange([...rows, blank()])} disabled={rows.length >= max}>
                        <HugeiconsIcon icon={PlusSignIcon} size={14} aria-hidden="true" />Ajouter
                    </Button>
                )}
            </div>
            {rows.length === 0 ? (
                <p className="text-sm text-fg-muted">Aucun.</p>
            ) : (
                <ul className="space-y-2">
                    {rows.map((row, i) => (
                        <li key={i} className="flex items-end gap-2 rounded-panel border border-line p-3">
                            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                                {render(row, patch => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))), i)}
                            </div>
                            {!disabled && (
                                <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" aria-label="Retirer"
                                    disabled={rows.length <= min} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                                    <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {error ? <p className="text-xs text-danger">{error}</p> : help ? <p className="text-xs text-fg-muted">{help}</p> : null}
        </div>
    );
}

/** A compact labelled input for list rows. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex min-w-0 flex-col gap-1 text-xs text-fg-muted">
            {label}
            {children}
        </label>
    );
}

const ctl = 'h-11 sm:h-9';

// ---------- The tab ----------

/**
 * Name, rules, schedule and every setting of the edition. Fields frozen for
 * the edition's status are disabled with the reason (PHASE1.md « Locks »);
 * the save sends only what changed. Read-only without write access.
 */
export default function SettingsTab({ edition, canWrite, onSaved }: { edition: Edition; canWrite: boolean; onSaved: (e: Edition) => void }) {
    // Keyed on the editable content only: during qualification the job writes the
    // edition every 10 s (its cursor is no longer sent, but `updatedAt` still moves),
    // so a refetch gives a new object, and it must not wipe what the admin is typing.
    const originalKey = JSON.stringify(toDraft(edition));
    const original = useMemo<Draft>(() => JSON.parse(originalKey), [originalKey]);
    const [draft, setDraft] = useState<Draft>(original);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorFields, setErrorFields] = useState<string[]>([]);
    // A reload of the edition (save, refresh) restarts the form from it.
    useEffect(() => { setDraft(original); setError(null); setErrorFields([]); }, [original]);

    const closed = isEditionClosed(edition.status);
    const readOnly = !canWrite || closed;
    const lock = (f: LockableField) => lockReason(edition.status, f);
    const off = (f?: LockableField) => readOnly || (f ? !!lock(f) : false);
    const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
    const err = (key: string) => (errorFields.map(draftKey).includes(key) ? error ?? undefined : undefined);

    const changes = useMemo(() => diffEdition(original, draft), [original, draft]);
    const dirty = Object.keys(changes).length > 0;
    const total = [draft.paidVotes, draft.publicVote, draft.jury].reduce((sum, v) => sum + (Number.isFinite(num(v)) ? num(v) : 0), 0);

    const save = async () => {
        if (!dirty) return;
        setSaving(true);
        setError(null);
        setErrorFields([]);
        try {
            const saved = await updateEdition(edition._id, changes);
            toast.success('Édition enregistrée.');
            onSaved(saved);
        } catch (e) {
            const x = readImpactError(e, 'L’édition n’a pas pu être enregistrée.');
            setErrorFields(x.fields);
            setError(x.code === 'RULES_LOCKED' && x.fields.length
                ? `${x.message} Champs refusés : ${x.fields.map(fieldLabel).join(', ')}.`
                : x.message);
        } finally {
            setSaving(false);
        }
    };

    const qualificationLock = lock('maxCandidates');
    const competitionLock = lock('votePrice');
    const rulesLength = draft.rulesText.trim().length;

    return (
        <div className="space-y-4">
            {!canWrite && <Notice>Lecture seule : votre compte peut consulter l’Impact Challenge, pas le modifier.</Notice>}
            {closed && <Notice tone="warning">Cette édition est terminée : plus rien n’est modifiable.</Notice>}

            <Section title="Présentation" description="Ce que les membres lisent. Le nom et la description restent modifiables.">
                <Field label="Nom de l’édition" required error={err('name')}>
                    <Input className={ctl} value={draft.name} onChange={e => set({ name: e.target.value })} disabled={readOnly} maxLength={120} />
                </Field>
                <Field label="Description" error={err('description')}>
                    <Textarea rows={3} value={draft.description} onChange={e => set({ description: e.target.value })} disabled={readOnly} maxLength={4000} />
                </Field>
                <Field
                    label="Règlement"
                    error={err('rulesText')}
                    help={lock('rulesText') ?? `${formatNumber(rulesLength)} caractères. ${RULES_MIN_LENGTH} au moins pour ouvrir la qualification : il est alors publié et ne change plus.`}
                >
                    <Textarea rows={14} value={draft.rulesText} onChange={e => set({ rulesText: e.target.value })} disabled={off('rulesText')} maxLength={30000} />
                </Field>
            </Section>

            <Section title="Calendrier" description="Heures de votre appareil.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Ouverture de la qualification" required error={err('qualificationOpensAt')} help={lock('qualificationOpensAt') ?? undefined}>
                        <Input type="datetime-local" className={ctl} value={draft.qualificationOpensAt} onChange={e => set({ qualificationOpensAt: e.target.value })} disabled={off('qualificationOpensAt')} />
                    </Field>
                    <Field label="Fin de la qualification" required error={err('qualificationClosesAt')} help={lock('qualificationClosesAt') ?? undefined}>
                        <Input type="datetime-local" className={ctl} value={draft.qualificationClosesAt} onChange={e => set({ qualificationClosesAt: e.target.value })} disabled={off('qualificationClosesAt')} />
                    </Field>
                    <Field label="Début de la compétition" error={err('competitionStartsAt')} help={lock('competitionStartsAt') ?? 'Facultatif.'}>
                        <Input type="datetime-local" className={ctl} value={draft.competitionStartsAt} onChange={e => set({ competitionStartsAt: e.target.value })} disabled={off('competitionStartsAt')} />
                    </Field>
                    <Field label="Finale" error={err('finalAt')} help="Facultatif.">
                        <Input type="datetime-local" className={ctl} value={draft.finalAt} onChange={e => set({ finalAt: e.target.value })} disabled={readOnly} />
                    </Field>
                </div>
            </Section>

            <Section title="Qualification" description="Règles des places. Elles sont publiées et verrouillées à l’ouverture de la qualification." lock={qualificationLock}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Nombre de candidats" required error={err('maxCandidates')} help="Places officielles (2 à 200).">
                        <Input type="number" inputMode="numeric" className={ctl} value={draft.maxCandidates} onChange={e => set({ maxCandidates: e.target.value })} disabled={off('maxCandidates')} />
                    </Field>
                    <Field label="Invitations requises" required error={err('invitationsRequired')} help="Filleuls qui paient leur pack pendant la qualification.">
                        <Input type="number" inputMode="numeric" className={ctl} value={draft.invitationsRequired} onChange={e => set({ invitationsRequired: e.target.value })} disabled={off('invitationsRequired')} />
                    </Field>
                    <Field label="Liste d’attente" required error={err('waitlistSize')} help="Places d’attente une fois les places prises (0 à 50).">
                        <Input type="number" inputMode="numeric" className={ctl} value={draft.waitlistSize} onChange={e => set({ waitlistSize: e.target.value })} disabled={off('waitlistSize')} />
                    </Field>
                </div>
                <Field label="Catégories d’activité" error={err('categories')} help="Une par ligne (40 au plus). Vide : le candidat écrit sa catégorie librement.">
                    <Textarea rows={6} value={draft.categories} onChange={e => set({ categories: e.target.value })} disabled={off('categories')} />
                </Field>
                <ListEditor
                    label="Questions supplémentaires du profil"
                    help="10 au plus. La clé (lettres, chiffres, - ou _) identifie la réponse ; ne la changez pas une fois des réponses reçues."
                    error={err('profileFields')}
                    rows={draft.profileFields}
                    onChange={rows => set({ profileFields: rows })}
                    blank={() => ({ key: '', label: '', required: false, maxLength: '500' })}
                    max={10}
                    disabled={off('profileFields')}
                    render={(f, patch) => (
                        <>
                            <Cell label="Clé"><Input className={ctl} value={f.key} onChange={e => patch({ key: e.target.value })} disabled={off('profileFields')} /></Cell>
                            <Cell label="Question"><Input className={ctl} value={f.label} onChange={e => patch({ label: e.target.value })} disabled={off('profileFields')} /></Cell>
                            <div className="grid grid-cols-2 gap-2">
                                <Cell label="Longueur max."><Input type="number" inputMode="numeric" className={ctl} value={f.maxLength} onChange={e => patch({ maxLength: e.target.value })} disabled={off('profileFields')} /></Cell>
                                <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-fg">
                                    <Checkbox checked={f.required} onCheckedChange={v => patch({ required: v === true })} disabled={off('profileFields')} />Obligatoire
                                </label>
                            </div>
                        </>
                    )}
                />
            </Section>

            <Section title="Compétition et votes" description="Verrouillé au début de la compétition." lock={competitionLock}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Nombre de finalistes" required error={err('finalistsCount')} help="Au plus le nombre de candidats.">
                        <Input type="number" inputMode="numeric" className={ctl} value={draft.finalistsCount} onChange={e => set({ finalistsCount: e.target.value })} disabled={off('finalistsCount')} />
                    </Field>
                    <Field label="Prix d’un vote (F)" required error={err('votePrice')} help="Multiple de 5, de 50 à 100 000.">
                        <Input type="number" inputMode="numeric" className={ctl} value={draft.votePrice} onChange={e => set({ votePrice: e.target.value })} disabled={off('votePrice')} />
                    </Field>
                </div>
                <ListEditor
                    label="Packs de votes"
                    help="1 à 6 packs. Prix en F, multiple de 5."
                    error={err('votePacks')}
                    rows={draft.votePacks}
                    onChange={rows => set({ votePacks: rows })}
                    blank={() => ({ votes: '', price: '' })}
                    max={6}
                    min={1}
                    disabled={off('votePacks')}
                    render={(p, patch) => (
                        <>
                            <Cell label="Votes"><Input type="number" inputMode="numeric" className={ctl} value={p.votes} onChange={e => patch({ votes: e.target.value })} disabled={off('votePacks')} /></Cell>
                            <Cell label="Prix (F)"><Input type="number" inputMode="numeric" className={ctl} value={p.price} onChange={e => patch({ price: e.target.value })} disabled={off('votePacks')} /></Cell>
                        </>
                    )}
                />
                <div className="space-y-2">
                    <p className="text-sm font-medium text-fg">Pondération de la note finale (%)</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <Field label="Votes payants">
                            <Input type="number" inputMode="numeric" className={ctl} value={draft.paidVotes} onChange={e => set({ paidVotes: e.target.value })} disabled={off('weights')} />
                        </Field>
                        <Field label="Vote public">
                            <Input type="number" inputMode="numeric" className={ctl} value={draft.publicVote} onChange={e => set({ publicVote: e.target.value })} disabled={off('weights')} />
                        </Field>
                        <Field label="Jury">
                            <Input type="number" inputMode="numeric" className={ctl} value={draft.jury} onChange={e => set({ jury: e.target.value })} disabled={off('weights')} />
                        </Field>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-fg">Total</span>
                            <span className={cn('flex h-11 items-center text-lg font-semibold tabular-nums sm:h-9', total === 100 ? 'text-success' : 'text-danger')} aria-live="polite">
                                {formatNumber(total)} %
                            </span>
                        </div>
                    </div>
                    {err('weights')
                        ? <p className="text-xs text-danger">{err('weights')}</p>
                        : total !== 100 && <p className="text-xs text-danger">Le total doit faire 100 %.</p>}
                </div>
                <ListEditor
                    label="Critères du jury"
                    help="1 à 10 critères, chacun noté sur un maximum de 1 à 100."
                    error={err('juryCriteria')}
                    rows={draft.juryCriteria}
                    onChange={rows => set({ juryCriteria: rows })}
                    blank={() => ({ key: '', label: '', max: '10' })}
                    max={10}
                    min={1}
                    disabled={off('juryCriteria')}
                    render={(c, patch) => (
                        <>
                            <Cell label="Clé"><Input className={ctl} value={c.key} onChange={e => patch({ key: e.target.value })} disabled={off('juryCriteria')} /></Cell>
                            <Cell label="Critère"><Input className={ctl} value={c.label} onChange={e => patch({ label: e.target.value })} disabled={off('juryCriteria')} /></Cell>
                            <Cell label="Note max."><Input type="number" inputMode="numeric" className={ctl} value={c.max} onChange={e => patch({ max: e.target.value })} disabled={off('juryCriteria')} /></Cell>
                        </>
                    )}
                />
            </Section>

            <Section title="Tombola et lots" description="Les lots restent modifiables ; les paliers et le délai se verrouillent au début de la compétition.">
                <ListEditor
                    label="Paliers de tickets"
                    help={lock('ticketTiers') ?? 'Poids de chaque ticket d’un membre selon son rang (ex. 1 jusqu’au 10e, 0,5 jusqu’au 50e, 0,25 au-delà). Le dernier palier est sans limite.'}
                    error={err('ticketTiers')}
                    rows={draft.ticketTiers}
                    onChange={rows => set({ ticketTiers: rows })}
                    blank={() => ({ upTo: '', weight: '' })}
                    max={6}
                    min={1}
                    disabled={off('ticketTiers')}
                    render={(t, patch, i) => (
                        <>
                            <Cell label="Jusqu’au ticket n°">
                                {i === draft.ticketTiers.length - 1
                                    ? <Input className={ctl} value="Sans limite" disabled readOnly />
                                    : <Input type="number" inputMode="numeric" className={ctl} value={t.upTo} onChange={e => patch({ upTo: e.target.value })} disabled={off('ticketTiers')} />}
                            </Cell>
                            <Cell label="Poids (0 à 1)"><Input type="number" inputMode="decimal" step="0.05" className={ctl} value={t.weight} onChange={e => patch({ weight: e.target.value })} disabled={off('ticketTiers')} /></Cell>
                        </>
                    )}
                />
                <ListEditor
                    label="Lots"
                    help="1 à 10 lots. Un membre ne gagne pas deux fois la même catégorie de lot pendant le délai ci-dessous."
                    error={err('prizes')}
                    rows={draft.prizes}
                    onChange={rows => set({ prizes: rows })}
                    blank={() => ({ key: '', label: '', category: '' })}
                    max={10}
                    min={1}
                    disabled={readOnly}
                    render={(p, patch) => (
                        <>
                            <Cell label="Clé"><Input className={ctl} value={p.key} onChange={e => patch({ key: e.target.value })} disabled={readOnly} /></Cell>
                            <Cell label="Lot"><Input className={ctl} value={p.label} onChange={e => patch({ label: e.target.value })} disabled={readOnly} /></Cell>
                            <Cell label="Catégorie"><Input className={ctl} value={p.category} onChange={e => patch({ category: e.target.value })} disabled={readOnly} /></Cell>
                        </>
                    )}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Délai entre deux gains du même lot (jours)" required error={err('prizeCooldownDays')} help={lock('prizeCooldownDays') ?? '0 à 3 650.'}>
                        <Input type="number" inputMode="numeric" className={ctl} value={draft.prizeCooldownDays} onChange={e => set({ prizeCooldownDays: e.target.value })} disabled={off('prizeCooldownDays')} />
                    </Field>
                    <Field label="Durée dans SBC Impact (mois)" required error={err('showcaseMonths')} help={lock('showcaseMonths') ?? 'Temps pendant lequel les projets restent présentés après le Challenge (12 à 120).'}>
                        <Input type="number" inputMode="numeric" className={ctl} value={draft.showcaseMonths} onChange={e => set({ showcaseMonths: e.target.value })} disabled={off('showcaseMonths')} />
                    </Field>
                </div>
            </Section>

            {!readOnly && (
                <Panel className="sticky bottom-3 z-10 flex flex-col gap-3 p-4 shadow-overlay sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                        {error
                            ? <p className="text-sm text-danger" role="alert">{error}</p>
                            : <p className="text-sm text-fg-muted">{dirty ? 'Modifications non enregistrées.' : 'Aucune modification.'}</p>}
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                        <Button variant="outline" size="lg" disabled={!dirty || saving} onClick={() => { setDraft(original); setError(null); setErrorFields([]); }}>
                            Annuler les modifications
                        </Button>
                        <Button variant="primary" size="lg" disabled={!dirty} loading={saving} onClick={() => void save()}>Enregistrer</Button>
                    </div>
                </Panel>
            )}
        </div>
    );
}
