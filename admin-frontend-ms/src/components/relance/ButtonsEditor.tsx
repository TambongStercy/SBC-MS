import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import type { RelanceButton } from '../../services/adminRelanceApi';
import { Button, Field, Input } from '../ui';

const DEFAULT_COLOR = '#F59E0B';

/** The e-mail's call-to-action buttons: label, link, colour, with a live sample. */
export function ButtonsEditor({ buttons, onChange, disabled }: {
    buttons: RelanceButton[];
    onChange: (buttons: RelanceButton[]) => void;
    disabled?: boolean;
}) {
    const update = (i: number, patch: Partial<RelanceButton>) => onChange(buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
    return (
        <div className="space-y-3">
            {buttons.map((btn, i) => (
                <div key={i} className="space-y-3 rounded-panel border border-line bg-surface-2/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-fg-muted">Bouton {i + 1}</span>
                        {!disabled && (
                            <Button variant="danger-ghost" size="sm" className="h-11 md:h-8" onClick={() => onChange(buttons.filter((_, j) => j !== i))}>
                                <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                                Retirer
                            </Button>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.5fr_10rem]">
                        <Field label="Texte du bouton">
                            <Input value={btn.label} onChange={e => update(i, { label: e.target.value })} placeholder="Payer maintenant" className="h-11 md:h-9" />
                        </Field>
                        <Field label="Lien">
                            <Input type="url" value={btn.url} onChange={e => update(i, { url: e.target.value })} placeholder="https://…" className="h-11 md:h-9" />
                        </Field>
                        <Field label="Couleur">
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={btn.color || DEFAULT_COLOR}
                                    onChange={e => update(i, { color: e.target.value })}
                                    aria-label="Choisir la couleur"
                                    className="h-11 w-11 shrink-0 cursor-pointer rounded-control border border-line-strong bg-surface p-1 md:h-9 md:w-9"
                                />
                                <Input value={btn.color || DEFAULT_COLOR} onChange={e => update(i, { color: e.target.value })} className="h-11 font-mono md:h-9" aria-label="Code couleur" />
                            </div>
                        </Field>
                    </div>
                    {btn.label && (
                        <div className="flex items-center gap-2 text-xs text-fg-muted">
                            Aperçu :
                            <span className="inline-block rounded-full px-4 py-1 text-xs font-semibold text-white" style={{ backgroundColor: btn.color || DEFAULT_COLOR }}>{btn.label}</span>
                        </div>
                    )}
                </div>
            ))}
            {!disabled && (
                <Button size="lg" onClick={() => onChange([...buttons, { label: '', url: '', color: DEFAULT_COLOR }])}>
                    <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
                    Ajouter un bouton
                </Button>
            )}
        </div>
    );
}
