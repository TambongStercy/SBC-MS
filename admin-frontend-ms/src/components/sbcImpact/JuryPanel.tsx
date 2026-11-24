import { useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { LockIcon, Search01Icon, UserAdd01Icon } from '@hugeicons/core-free-icons';
import { Avatar, Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Panel, PanelBody, PanelHeader, Skeleton } from '../ui';
import { ConfirmDialog, DateText, ErrorState, Notice, formatNumber, plural, type ConfirmOptions } from '../moduleKit';
import { cn } from '../../lib/cn';
import { getFileUrl } from '../../utils/fileUtils';
import {
    addJuror, impactErrorMessage, lookupMember, readImpactError, removeJuror, type Edition, type JurorRow, type MemberLookup,
} from '../../services/impactV2Api';
import { useJury } from './finaleQueries';

/**
 * « Ajouter un juré »: find the account by e-mail or phone (the answer shows
 * the name and a masked contact), then confirm. The server refuses a finalist
 * (conflict of interest), a juror already in, and a 16th juror.
 */
function AddJurorDialog({ editionId, onClose, onAdded }: { editionId: string; onClose: () => void; onAdded: () => void }) {
    const [contact, setContact] = useState('');
    const [found, setFound] = useState<MemberLookup | null>(null);
    const [searching, setSearching] = useState(false);
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const search = async () => {
        const c = contact.trim();
        if (c.length < 5) { setError('Saisissez l’e-mail ou le numéro du membre.'); return; }
        setSearching(true);
        setError(null);
        setFound(null);
        try {
            const res = await lookupMember(c);
            if (!res.found) {
                setError(res.ambiguous
                    ? 'Plusieurs comptes correspondent à ce numéro : cherchez plutôt par e-mail.'
                    : 'Aucun compte SBC ne correspond à cet e-mail ou ce numéro.');
            } else {
                setFound(res);
            }
        } catch (err) {
            setError(impactErrorMessage(err, 'La recherche du membre a échoué.'));
        } finally {
            setSearching(false);
        }
    };

    const add = async () => {
        if (!found?.userId) return;
        setAdding(true);
        setError(null);
        try {
            await addJuror(editionId, found.userId);
            toast.success(`${found.name ?? 'Le membre'} fait partie du jury. Il est prévenu par notification et e-mail.`);
            onAdded();
        } catch (err) {
            // CONFLICT_OF_INTEREST, ALREADY_JUROR, TOO_MANY_JURORS, ACCOUNT_UNAVAILABLE, JURY_LOCKED…: the server says why.
            setError(readImpactError(err, 'Le juré n’a pas pu être ajouté.').message);
        } finally {
            setAdding(false);
        }
    };

    return (
        <Dialog open onOpenChange={o => { if (!o && !adding) onClose(); }}>
            <DialogContent
                title="Ajouter un juré"
                description="Un compte SBC, jamais un finaliste. 15 jurés au plus."
                footer={(
                    <>
                        <Button variant="outline" size="lg" onClick={onClose} disabled={adding}>Annuler</Button>
                        <Button variant="primary" size="lg" onClick={() => void add()} loading={adding} disabled={!found?.userId}>Ajouter au jury</Button>
                    </>
                )}
            >
                <div className="space-y-4">
                    <form className="flex items-end gap-2" onSubmit={ev => { ev.preventDefault(); void search(); }}>
                        <Field label="E-mail ou numéro du membre" className="min-w-0 flex-1">
                            <Input className="h-11 sm:h-9" value={contact} onChange={ev => { setContact(ev.target.value); setFound(null); }} autoComplete="off" />
                        </Field>
                        <Button type="submit" variant="outline" size="lg" className="sm:h-9" loading={searching}>
                            <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />Rechercher
                        </Button>
                    </form>
                    {found?.found && (
                        <div className="flex items-center gap-3 rounded-panel border border-line p-3" data-testid="juror-candidate">
                            <Avatar src={found.avatar ? getFileUrl(found.avatar) : null} name={found.name ?? '?'} size="md" />
                            <div className="min-w-0">
                                <p className="truncate font-medium text-fg">{found.name}</p>
                                <p className="truncate text-xs text-fg-muted">{found.contactHint}</p>
                            </div>
                        </div>
                    )}
                    {error && <Notice tone="danger">{error}</Notice>}
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** The jurors, how far each has marked, add and remove (until the marks are locked). */
export default function JuryPanel({ edition, canWrite, onChanged }: { edition: Edition; canWrite: boolean; onChanged: () => void }) {
    const jury = useJury(edition);
    const [adding, setAdding] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const locked = !!(jury.data?.lockedAt ?? edition.jury?.lockedAt);
    const editable = canWrite && !locked && edition.status === 'FINAL' && (edition.stage === 'TOP3' || edition.stage === 'LIVE');
    const active = (jury.data?.jurors ?? []).filter(j => !j.removedAt);
    const finalistsCount = jury.data?.finalists.length ?? 0;

    const askRemove = (j: JurorRow) => setConfirm({
        title: `Retirer ${j.name} du jury ?`,
        confirmLabel: 'Retirer du jury',
        description: 'Ses notes ne compteront plus dans le résultat (elles restent visibles, barrées). Vous pourrez l’ajouter de nouveau tant que les notes ne sont pas verrouillées.',
        reason: { label: 'Raison', required: true, minLength: 5 },
        onConfirm: async (reason: string) => {
            try {
                await removeJuror(edition._id, j._id, reason);
                toast.success(`${j.name} est retiré du jury.`);
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'Le juré n’a pas pu être retiré.'));
            } finally {
                void jury.refetch();
                onChanged();
            }
        },
    });

    return (
        <Panel>
            <PanelHeader
                title={<span className="flex flex-wrap items-center gap-2">Jury{locked && <Badge tone="neutral"><HugeiconsIcon icon={LockIcon} size={12} aria-hidden="true" />Notes verrouillées</Badge>}</span>}
                description={jury.data ? `${formatNumber(active.length)} ${plural(active.length, 'juré actif', 'jurés actifs')} · 15 au plus. Chaque juré note avec le code de son application d’authentification.` : undefined}
                actions={editable ? (
                    <Button variant="outline" size="lg" className="sm:h-9" onClick={() => setAdding(true)} disabled={active.length >= 15}>
                        <HugeiconsIcon icon={UserAdd01Icon} size={16} aria-hidden="true" />Ajouter un juré
                    </Button>
                ) : undefined}
            />
            <PanelBody>
                {jury.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                ) : !jury.data ? (
                    <ErrorState error={new Error(impactErrorMessage(jury.error, 'Impossible de charger le jury.'))} onRetry={() => void jury.refetch()} retrying={jury.isFetching} />
                ) : jury.data.jurors.length === 0 ? (
                    <EmptyState icon={UserAdd01Icon} title="Aucun juré pour l’instant" description="Ajoutez au moins un juré pour démarrer la finale." />
                ) : (
                    <ul className="divide-y divide-line rounded-panel border border-line">
                        {jury.data.jurors.map(j => (
                            <li key={j._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid={`juror-${j._id}`}>
                                <div className="min-w-0">
                                    <p className={cn('truncate font-medium', j.removedAt ? 'text-fg-muted line-through' : 'text-fg')}>{j.name || 'Juré'}</p>
                                    <p className="text-xs text-fg-muted">
                                        {j.removedAt
                                            ? <>Retiré <DateText value={j.removedAt} /> : ses notes ne comptent plus</>
                                            : <>Ajouté <DateText value={j.addedAt} /></>}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!j.removedAt && (
                                        <Badge tone={finalistsCount > 0 && j.scored >= finalistsCount ? 'success' : 'neutral'}>
                                            {formatNumber(j.scored)}/{formatNumber(finalistsCount)} finalistes notés
                                        </Badge>
                                    )}
                                    {editable && !j.removedAt && (
                                        <Button variant="danger-ghost" size="sm" className="h-11 sm:h-8" onClick={() => askRemove(j)}>Retirer</Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </PanelBody>
            {adding && (
                <AddJurorDialog
                    editionId={edition._id}
                    onClose={() => setAdding(false)}
                    onAdded={() => { setAdding(false); void jury.refetch(); onChanged(); }}
                />
            )}
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </Panel>
    );
}
