import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Crown02Icon } from '@hugeicons/core-free-icons';
import { updateSettings, type ISettings } from '../../services/adminSettingsApi';
import { Can } from '../Can';
import { usePermission } from '../../hooks/usePermission';
import { Badge, Button, Field, Input, Panel, PanelBody, PanelHeader } from '../ui';
import { apiError } from '../display/format';

/** Same rule as settings-service PUT /settings: WhatsApp links only, empty clears. */
const WHATSAPP_LINK = /^https:\/\/(chat\.whatsapp\.com|wa\.me|(www\.)?whatsapp\.com)\//i;

/**
 * Pack Winner VIP WhatsApp group (Rufus, 2026-11-15). Winner members see a
 * « Rejoindre le groupe VIP » button on their pack card and their profile as
 * soon as this link is set; clearing it hides the button (unless the server's
 * fallback WINNER_VIP_GROUP_LINK is set).
 */
export function WinnerVipLinkCard({ value, onSaved }: { value?: string; onSaved: (settings: ISettings) => void }) {
    const [link, setLink] = useState(value ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canWrite = usePermission('settings') === 'write';

    useEffect(() => { setLink(value ?? ''); }, [value]);

    const trimmed = link.trim();
    const unchanged = trimmed === (value ?? '');

    const save = async (e: FormEvent) => {
        e.preventDefault();
        if (trimmed && !WHATSAPP_LINK.test(trimmed)) {
            setError('Collez un lien WhatsApp : https://chat.whatsapp.com/…');
            return;
        }
        setError(null);
        setSaving(true);
        try {
            const updated = await updateSettings({ winnerVipGroupUrl: trimmed });
            onSaved(updated);
            toast.success(trimmed ? 'Lien du groupe VIP enregistré.' : 'Lien du groupe VIP retiré.');
        } catch (err) {
            const message = apiError(err, 'Le lien n’a pas pu être enregistré.');
            setError(message);
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Panel>
            <PanelHeader
                title={<span className="flex items-center gap-2"><HugeiconsIcon icon={Crown02Icon} size={16} className="text-fg-muted" aria-hidden="true" />Groupe WhatsApp VIP du Pack Winner</span>}
                description="Les abonnés Winner voient « Rejoindre le groupe VIP » sur leur pack et dans leur profil dès que ce lien est enregistré."
                actions={value ? <Badge tone="success">Bouton visible</Badge> : <Badge tone="neutral">Aucun lien</Badge>}
            />
            <PanelBody>
                <form onSubmit={save} className="space-y-4">
                    <Field
                        label="Lien d’invitation du groupe"
                        error={error ?? undefined}
                        help="Lien WhatsApp uniquement. Videz le champ et enregistrez pour retirer le bouton (le lien de secours du serveur s’applique alors s’il existe)."
                    >
                        <Input
                            className="h-11"
                            type="url"
                            inputMode="url"
                            readOnly={!canWrite}
                            value={link}
                            onChange={e => { setLink(e.target.value); setError(null); }}
                            placeholder="https://chat.whatsapp.com/…"
                        />
                    </Field>
                    <Can module="settings" write>
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            {!unchanged && <Button type="button" variant="ghost" size="lg" onClick={() => { setLink(value ?? ''); setError(null); }} disabled={saving}>Annuler</Button>}
                            <Button type="submit" variant="primary" size="lg" loading={saving} disabled={unchanged}>
                                {trimmed || !value ? 'Enregistrer le lien' : 'Retirer le lien'}
                            </Button>
                        </div>
                    </Can>
                </form>
            </PanelBody>
        </Panel>
    );
}

export default WinnerVipLinkCard;
