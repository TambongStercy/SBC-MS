import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, Edit02Icon, LinkSquare02Icon, Mortarboard01Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons';
import {
    addFormation, getFormations, removeFormation, updateFormation, type FormationSubscriptionGate, type IFormation,
} from '../../services/adminSettingsApi';
import { Can } from '../Can';
import {
    Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger,
    Panel, PanelHeader, ResponsiveList, Select, SheetContent, type ListColumn,
} from '../ui';
import { ErrorState } from '../display/ErrorState';
import { apiError } from '../display/format';

const FORMATIONS_KEY = ['admin-settings', 'formations'] as const;

const TIER_OPTIONS = [
    { value: 'ALL', label: 'Tous les abonnés actifs' },
    { value: 'CLASSIQUE', label: 'Classique et plus (2 150 F)' },
    { value: 'CIBLE', label: 'Ciblé uniquement (5 000 F)' },
];
const DECORATION_OPTIONS = [
    { value: 'none', label: 'Aucune' },
    { value: 'orange', label: 'Mise en avant orange' },
    { value: 'gold', label: 'Mise en avant dorée' },
    { value: 'new', label: 'Badge « Nouveau »' },
];
const DECORATION_LABEL: Record<string, string> = { orange: 'Orange', gold: 'Dorée', new: 'Nouveau' };

function TierBadge({ tier }: { tier?: FormationSubscriptionGate }) {
    if (tier === 'CIBLE') return <Badge tone="primary">Ciblé uniquement</Badge>;
    if (tier === 'CLASSIQUE') return <Badge tone="info">Classique et plus</Badge>;
    return <Badge tone="neutral">Tous les abonnés</Badge>;
}

type Draft = { title: string; link: string; tier: string; decoration: string };
const EMPTY: Draft = { title: '', link: '', tier: 'ALL', decoration: 'none' };

/** Create or edit one formation, in a side sheet (full screen on phones). */
function FormationSheet({ editing, onDone }: { editing: IFormation | null; onDone: () => void }) {
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState<Draft>(EMPTY);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setDraft(editing ? {
            title: editing.title,
            link: editing.link,
            tier: editing.requiredSubscriptionType || 'ALL',
            decoration: editing.decoration || 'none',
        } : EMPTY);
        setError(null);
    }, [editing]);

    const save = useMutation({
        mutationFn: async () => {
            const data = {
                title: draft.title.trim(),
                link: draft.link.trim(),
                requiredSubscriptionType: (draft.tier === 'ALL' ? '' : draft.tier) as FormationSubscriptionGate | '',
                decoration: draft.decoration === 'none' ? '' : draft.decoration,
            };
            return editing ? updateFormation(editing._id, data) : addFormation(data);
        },
        onSuccess: () => {
            toast.success(editing ? 'Formation mise à jour.' : 'Formation ajoutée.');
            void queryClient.invalidateQueries({ queryKey: FORMATIONS_KEY });
            onDone();
        },
        onError: err => {
            const message = apiError(err, editing ? 'La formation n’a pas pu être mise à jour.' : 'La formation n’a pas pu être ajoutée.');
            setError(message);
            toast.error(message);
        },
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!draft.title.trim() || !draft.link.trim()) {
            setError('Le titre et le lien sont obligatoires.');
            return;
        }
        save.mutate();
    };

    return (
        <SheetContent
            title={editing ? 'Modifier la formation' : 'Ajouter une formation'}
            description="Elle apparaît dans la page Formations de l’application membre."
            footer={(
                <>
                    <DialogClose asChild><Button variant="outline" size="lg" disabled={save.isPending}>Annuler</Button></DialogClose>
                    <Button type="submit" form="formation-form" variant="primary" size="lg" loading={save.isPending}>
                        {editing ? 'Enregistrer' : 'Ajouter la formation'}
                    </Button>
                </>
            )}
        >
            <form id="formation-form" onSubmit={submit} className="space-y-4">
                <Field label="Titre" required>
                    <Input className="h-11" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Vendre sur WhatsApp" />
                </Field>
                <Field label="Lien" required help="Le lien que le membre ouvre (vidéo, document, groupe…).">
                    <Input className="h-11" type="url" value={draft.link} onChange={e => setDraft(d => ({ ...d, link: e.target.value }))} placeholder="https://…" />
                </Field>
                <Field label="Qui la voit" help="Les membres sans l’abonnement demandé la voient verrouillée.">
                    <Select className="h-11" value={draft.tier} onValueChange={v => setDraft(d => ({ ...d, tier: v }))} options={TIER_OPTIONS} />
                </Field>
                <Field label="Mise en avant" help="Change l’apparence de la carte dans l’application membre.">
                    <Select className="h-11" value={draft.decoration} onValueChange={v => setDraft(d => ({ ...d, decoration: v }))} options={DECORATION_OPTIONS} />
                </Field>
                {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            </form>
        </SheetContent>
    );
}

/**
 * Formations offered to members. Server: settings-service
 * GET/POST/PUT/DELETE /settings/formations.
 */
export function FormationsSection({ createOpen, onCreateOpenChange }: { createOpen: boolean; onCreateOpenChange: (open: boolean) => void }) {
    const queryClient = useQueryClient();
    const formations = useQuery({ queryKey: FORMATIONS_KEY, queryFn: getFormations });
    const [editing, setEditing] = useState<IFormation | null>(null);
    const [removing, setRemoving] = useState<IFormation | null>(null);

    const remove = useMutation({
        mutationFn: (f: IFormation) => removeFormation(f._id),
        onSuccess: (_, f) => {
            toast.success(`« ${f.title} » a été retirée.`);
            queryClient.setQueryData<IFormation[]>(FORMATIONS_KEY, prev => prev?.filter(x => x._id !== f._id));
            setRemoving(null);
        },
        onError: err => toast.error(apiError(err, 'La formation n’a pas pu être supprimée.')),
    });

    const sheetOpen = createOpen || !!editing;
    const closeSheet = () => { setEditing(null); onCreateOpenChange(false); };

    const rowActions = (f: IFormation, phone = false) => (
        <Can module="settings" write>
            <div className={phone ? 'flex gap-2' : 'flex justify-end gap-1'} onClick={e => e.stopPropagation()}>
                <Button variant={phone ? 'outline' : 'ghost'} size={phone ? 'lg' : 'sm'} className={phone ? 'flex-1' : undefined} onClick={() => setEditing(f)}>
                    <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />
                    Modifier
                </Button>
                <Menu>
                    <MenuTrigger asChild>
                        <Button variant="ghost" size={phone ? 'lg' : 'icon-sm'} className={phone ? 'w-11 px-0' : undefined} aria-label={`Plus d’actions pour ${f.title}`}>
                            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} aria-hidden="true" />
                        </Button>
                    </MenuTrigger>
                    <MenuContent>
                        <MenuItem destructive onSelect={() => setRemoving(f)}>
                            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                            Supprimer
                        </MenuItem>
                    </MenuContent>
                </Menu>
            </div>
        </Can>
    );

    const link = (f: IFormation) => (
        <a href={f.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 text-xs text-fg-muted hover:text-primary">
            <span className="truncate">{f.link}</span>
            <HugeiconsIcon icon={LinkSquare02Icon} size={12} className="shrink-0" aria-hidden="true" />
        </a>
    );

    const columns: ListColumn<IFormation>[] = [
        {
            key: 'title', header: 'Formation', className: 'max-w-0 w-1/2',
            cell: f => <div className="min-w-0"><p className="truncate font-medium text-fg">{f.title}</p>{link(f)}</div>,
        },
        { key: 'tier', header: 'Qui la voit', cell: f => <TierBadge tier={f.requiredSubscriptionType} /> },
        { key: 'deco', header: 'Mise en avant', cell: f => (f.decoration ? <Badge tone="warning">{DECORATION_LABEL[f.decoration] ?? f.decoration}</Badge> : <span className="text-fg-subtle">—</span>) },
        { key: 'actions', header: <span className="sr-only">Actions</span>, cell: f => rowActions(f), className: 'text-right', hideOnCard: true },
    ];

    const card = (f: IFormation) => (
        <div className="space-y-2">
            <div className="min-w-0">
                <p className="font-medium text-fg">{f.title}</p>
                {link(f)}
            </div>
            <div className="flex flex-wrap gap-2">
                <TierBadge tier={f.requiredSubscriptionType} />
                {f.decoration && <Badge tone="warning">{DECORATION_LABEL[f.decoration] ?? f.decoration}</Badge>}
            </div>
            {rowActions(f, true)}
        </div>
    );

    const list = formations.data ?? [];

    return (
        <Panel>
            <PanelHeader
                title="Formations"
                description={formations.data && list.length > 0 ? `${list.length} formation${list.length > 1 ? 's' : ''} dans l’application membre` : 'Ce que les membres trouvent dans la page Formations.'}
            />
            <ResponsiveList
                rows={list}
                columns={columns}
                rowKey={f => f._id}
                card={card}
                loading={formations.isLoading}
                empty={formations.isError ? (
                    <ErrorState message={apiError(formations.error, 'Les formations n’ont pas pu être chargées.')} onRetry={() => void formations.refetch()} retrying={formations.isFetching} />
                ) : (
                    <EmptyState
                        icon={Mortarboard01Icon}
                        title="Aucune formation"
                        description="Ajoutez la première : elle apparaîtra aussitôt dans l’application membre."
                        action={<Can module="settings" write><Button variant="primary" size="lg" onClick={() => onCreateOpenChange(true)}>Ajouter une formation</Button></Can>}
                    />
                )}
            />

            <Dialog open={sheetOpen} onOpenChange={open => { if (!open) closeSheet(); }}>
                {sheetOpen && <FormationSheet editing={editing} onDone={closeSheet} />}
            </Dialog>

            <Dialog open={!!removing} onOpenChange={open => { if (!open && !remove.isPending) setRemoving(null); }}>
                {removing && (
                    <DialogContent
                        size="sm"
                        title="Supprimer cette formation ?"
                        description={`« ${removing.title} » disparaît de l’application membre. C’est définitif.`}
                        footer={(
                            <>
                                <DialogClose asChild><Button variant="outline" size="lg" disabled={remove.isPending}>Annuler</Button></DialogClose>
                                <Button variant="danger" size="lg" loading={remove.isPending} onClick={() => remove.mutate(removing)}>Supprimer</Button>
                            </>
                        )}
                    />
                )}
            </Dialog>
        </Panel>
    );
}
