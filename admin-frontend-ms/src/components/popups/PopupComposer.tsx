import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, ImageAdd01Icon } from '@hugeicons/core-free-icons';
import { Button, Dialog, DialogClose, Field, Input, Segmented, Select, SheetContent, Switch, Textarea } from '../ui';
import { apiError, fmtInt } from '../display/format';
import { CountryPicker } from '../notifications/CountryPicker';
import { APP_PAGES } from '../notifications/pushShared';
import { OptionPicker } from './OptionPicker';
import { PopupPreview } from './PopupPreview';
import {
    describeTargeting, membres, popupApi, SEX_LABEL, SUBSCRIPTION_LABEL,
    type PopupAnnouncement, type PopupInput, type Targeting,
} from './api';

const TITLE_MAX = 120;
const MESSAGE_MAX = 1500;
const BUTTON_MAX = 40;
const IMAGE_MAX_MB = 5;
const OTHER_LINK = '__autre__';

const PAGE_OPTIONS = [
    ...APP_PAGES.flatMap(g => g.pages.map(p => ({ value: p.url, label: `${p.label} · ${g.group}` }))),
    { value: OTHER_LINK, label: 'Autre lien (https)' },
];
const isAppPage = (url: string) => APP_PAGES.some(g => g.pages.some(p => p.url === url));

/** yyyy-MM-ddTHH:mm in local time, for <input type="datetime-local">. */
const toLocalInput = (d?: string | Date | null) => {
    if (!d) return '';
    const x = new Date(d);
    if (isNaN(x.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);

const ageValue = (v: string): number | undefined => {
    if (v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
};

/**
 * Write or edit a pop-up announcement: content, optional image and button,
 * dates, and who it is for, with the live number of members it reaches.
 * `editing` = the announcement to edit; null = a new one.
 */
export function PopupComposer({ open, editing, onClose }: { open: boolean; editing: PopupAnnouncement | null; onClose: () => void }) {
    const queryClient = useQueryClient();
    const options = useQuery({ queryKey: ['popups', 'options'], queryFn: popupApi.options, staleTime: 10 * 60_000, enabled: open });

    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [uploading, setUploading] = useState<number | null>(null);
    const [withButton, setWithButton] = useState(false);
    const [buttonLabel, setButtonLabel] = useState('');
    const [buttonPage, setButtonPage] = useState('/abonnement');
    const [buttonLink, setButtonLink] = useState('');
    const [startMode, setStartMode] = useState<'now' | 'later'>('now');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
    const [targeted, setTargeted] = useState<'all' | 'filter'>('all');
    const [countries, setCountries] = useState<string[]>([]);
    const [ageMin, setAgeMin] = useState('');
    const [ageMax, setAgeMax] = useState('');
    const [sex, setSex] = useState('all');
    const [subscription, setSubscription] = useState('all');
    const [interests, setInterests] = useState<string[]>([]);
    const [professions, setProfessions] = useState<string[]>([]);
    const [count, setCount] = useState<number | null>(null);
    const [counting, setCounting] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    // Fill the form each time it opens (empty, or with the announcement being edited).
    useEffect(() => {
        if (!open) return;
        const a = editing;
        const f = a?.filter ?? {};
        setTitle(a?.title ?? '');
        setMessage(a?.message ?? '');
        setImageUrl(a?.imageUrl ?? '');
        setUploading(null);
        setWithButton(!!a?.buttonUrl);
        setButtonLabel(a?.buttonLabel ?? '');
        setButtonPage(a?.buttonUrl ? (isAppPage(a.buttonUrl) ? a.buttonUrl : OTHER_LINK) : '/abonnement');
        setButtonLink(a?.buttonUrl && !isAppPage(a.buttonUrl) ? a.buttonUrl : '');
        const scheduled = !!a && new Date(a.startsAt) > new Date();
        setStartMode(scheduled ? 'later' : 'now');
        setStartsAt(a ? toLocalInput(a.startsAt) : '');
        setEndsAt(toLocalInput(a?.endsAt));
        setTargeted(a?.filter && Object.keys(a.filter).length ? 'filter' : 'all');
        setCountries(f.countries ?? []);
        setAgeMin(f.ageMin !== undefined ? String(f.ageMin) : '');
        setAgeMax(f.ageMax !== undefined ? String(f.ageMax) : '');
        setSex(f.sex ?? 'all');
        setSubscription(f.subscription ?? 'all');
        setInterests(f.interests ?? []);
        setProfessions(f.professions ?? []);
    }, [open, editing]);

    const min = ageValue(ageMin);
    const max = ageValue(ageMax);
    const ageError = Number.isNaN(min) || Number.isNaN(max) ? 'Un âge est un nombre entier.'
        : (min !== undefined && (min < 13 || min > 100)) || (max !== undefined && (max < 13 || max > 100)) ? 'Âge entre 13 et 100 ans.'
            : min !== undefined && max !== undefined && min > max ? 'L’âge minimum dépasse l’âge maximum.' : null;

    // "Cibler" with nothing chosen is everyone, exactly as the server reads it.
    const filter: Targeting = useMemo(() => {
        if (targeted !== 'filter') return {};
        return {
            ...(countries.length ? { countries } : {}),
            ...(min !== undefined && !Number.isNaN(min) ? { ageMin: min } : {}),
            ...(max !== undefined && !Number.isNaN(max) ? { ageMax: max } : {}),
            ...(sex !== 'all' ? { sex: sex as Targeting['sex'] } : {}),
            ...(subscription !== 'all' ? { subscription: subscription as Targeting['subscription'] } : {}),
            ...(interests.length ? { interests } : {}),
            ...(professions.length ? { professions } : {}),
        };
    }, [targeted, countries, min, max, sex, subscription, interests, professions]);
    const filterKey = JSON.stringify(filter);

    // Live count while the targeting is shaped (read-only call).
    useEffect(() => {
        if (!open || ageError) { setCount(null); setCounting(false); return; }
        let cancelled = false;
        setCounting(true);
        const timer = setTimeout(async () => {
            try {
                const n = await popupApi.audience(JSON.parse(filterKey));
                if (!cancelled) setCount(n);
            } catch {
                if (!cancelled) setCount(null);
            } finally {
                if (!cancelled) setCounting(false);
            }
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [open, filterKey, ageError]);

    const buttonUrl = !withButton ? '' : buttonPage === OTHER_LINK ? buttonLink.trim() : buttonPage;
    const buttonError = withButton && !buttonLabel.trim() ? 'Écrivez le texte du bouton.'
        : withButton && buttonPage === OTHER_LINK && !/^https:\/\/\S+$/i.test(buttonUrl) ? 'Le lien doit commencer par https://' : null;
    const startIso = startMode === 'later' ? fromLocalInput(startsAt) : undefined;
    const endIso = fromLocalInput(endsAt);
    const startRef = startIso ? new Date(startIso) : new Date();
    const dateError = startMode === 'later' && !startsAt ? 'Choisissez la date de début.'
        : endIso && new Date(endIso) <= startRef ? 'La fin doit être après le début.' : null;
    const missing = !title.trim() || !message.trim();
    const canSave = !missing && !ageError && !buttonError && !dateError && uploading === null && !counting && !!count;

    const save = useMutation({
        mutationFn: async () => {
            const input: PopupInput = {
                title: title.trim(),
                message: message.trim(),
                imageUrl: imageUrl || undefined,
                buttonLabel: withButton ? buttonLabel.trim() : undefined,
                buttonUrl: withButton ? buttonUrl : undefined,
                // A new one starts now unless scheduled; an edit keeps its start unless rescheduled.
                startsAt: startIso ?? (editing ? (new Date(editing.startsAt) > new Date() ? new Date().toISOString() : editing.startsAt) : undefined),
                endsAt: endIso ?? null,
                filter,
            };
            return editing
                ? popupApi.update(editing.id, { ...input, imageUrl: imageUrl || '', buttonLabel: input.buttonLabel ?? '', buttonUrl: input.buttonUrl ?? '', endsAt: endIso ?? '' } as Partial<PopupInput>)
                : popupApi.create(input);
        },
        onSuccess: a => {
            toast.success(editing ? 'Annonce modifiée.' : a.state === 'scheduled'
                ? `Annonce programmée pour ${membres(a.audience)}.`
                : `Annonce en ligne : ${membres(a.audience)} la verront à leur prochaine ouverture de l’app.`);
            void queryClient.invalidateQueries({ queryKey: ['popups'] });
            onClose();
        },
        onError: err => toast.error(apiError(err, 'L’annonce n’a pas pu être enregistrée.')),
    });

    const pickImage = async (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.error('Choisissez une image (JPG, PNG, WebP).'); return; }
        if (file.size > IMAGE_MAX_MB * 1024 * 1024) { toast.error(`Image trop lourde : ${IMAGE_MAX_MB} Mo au maximum.`); return; }
        setUploading(0);
        try {
            setImageUrl(await popupApi.uploadImage(file, setUploading));
        } catch (err) {
            toast.error(apiError(err, 'L’image n’a pas pu être envoyée.'));
        } finally {
            setUploading(null);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const saveLabel = missing ? 'Saisissez un titre et un message'
        : counting || count === null ? 'Comptage des membres…'
            : count === 0 ? 'Aucun membre ne correspond'
                : editing ? `Enregistrer (${membres(count)})`
                    : startMode === 'later' ? `Programmer pour ${membres(count)}` : `Publier pour ${membres(count)}`;

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !save.isPending) onClose(); }}>
            {open && (
                <SheetContent
                    width="xl"
                    title={editing ? 'Modifier l’annonce' : 'Nouvelle annonce pop-up'}
                    description="Elle s’ouvre dans l’app des membres ciblés, une seule fois chacun."
                    footer={(
                        <>
                            <DialogClose asChild><Button variant="outline" size="lg" disabled={save.isPending}>Annuler</Button></DialogClose>
                            <Button variant="primary" size="lg" disabled={!canSave} loading={save.isPending} onClick={() => save.mutate()}>{saveLabel}</Button>
                        </>
                    )}
                >
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                        <div className="space-y-5">
                            <Field label="Titre" required help={`${title.length}/${TITLE_MAX}`}>
                                <Input className="h-11" value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} placeholder="Nouvelle formation disponible" />
                            </Field>
                            <Field label="Message" required help={`${message.length}/${MESSAGE_MAX} · les retours à la ligne sont gardés`}>
                                <Textarea rows={5} value={message} maxLength={MESSAGE_MAX} onChange={e => setMessage(e.target.value)} placeholder="Découvrez la formation « Vendre sur WhatsApp » dès maintenant." />
                            </Field>

                            <div className="space-y-2">
                                <p className="text-sm font-medium text-fg">Image <span className="font-normal text-fg-muted">(facultative)</span></p>
                                {imageUrl ? (
                                    <div className="flex items-center gap-3">
                                        <img src={imageUrl} alt="" className="h-16 w-24 rounded-control border border-line object-cover" />
                                        <Button variant="outline" size="sm" onClick={() => setImageUrl('')}>
                                            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /> Retirer
                                        </Button>
                                    </div>
                                ) : (
                                    <Button variant="outline" size="lg" disabled={uploading !== null} onClick={() => fileRef.current?.click()}>
                                        <HugeiconsIcon icon={ImageAdd01Icon} size={16} aria-hidden="true" />
                                        {uploading !== null ? `Envoi… ${uploading} %` : 'Ajouter une image'}
                                    </Button>
                                )}
                                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => void pickImage(e.target.files?.[0])} />
                                <p className="text-xs text-fg-muted">JPG, PNG ou WebP, {IMAGE_MAX_MB} Mo au maximum. Format paysage conseillé.</p>
                            </div>

                            <div className="space-y-3">
                                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-fg">
                                    <Switch checked={withButton} onCheckedChange={setWithButton} />
                                    Ajouter un bouton
                                </label>
                                {withButton && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label="Texte du bouton" help={`${buttonLabel.length}/${BUTTON_MAX}`}>
                                            <Input className="h-11" value={buttonLabel} maxLength={BUTTON_MAX} onChange={e => setButtonLabel(e.target.value)} placeholder="Voir la formation" />
                                        </Field>
                                        <Field label="Ouvre">
                                            <Select className="h-11" value={buttonPage} onValueChange={setButtonPage} options={PAGE_OPTIONS} />
                                        </Field>
                                        {buttonPage === OTHER_LINK && (
                                            <Field label="Lien" className="sm:col-span-2">
                                                <Input className="h-11" type="url" inputMode="url" value={buttonLink} onChange={e => setButtonLink(e.target.value)} placeholder="https://…" />
                                            </Field>
                                        )}
                                        {buttonError && <p className="text-sm text-danger sm:col-span-2" role="alert">{buttonError}</p>}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3">
                                <p className="text-sm font-medium text-fg">Diffusion</p>
                                <Segmented fill size="lg" label="Début" value={startMode} onValueChange={setStartMode}
                                    options={[{ value: 'now', label: editing ? 'Garder le début' : 'Tout de suite' }, { value: 'later', label: 'Programmer' }]} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {startMode === 'later' && (
                                        <Field label="Début">
                                            <Input className="h-11" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
                                        </Field>
                                    )}
                                    <Field label="Fin (facultative)" help="Après cette date, plus personne ne la voit.">
                                        <Input className="h-11" type="datetime-local" value={endsAt} min={startsAt || undefined} onChange={e => setEndsAt(e.target.value)} />
                                    </Field>
                                </div>
                                {dateError && <p className="text-sm text-danger" role="alert">{dateError}</p>}
                            </div>

                            <div className="space-y-3">
                                <p className="text-sm font-medium text-fg">Destinataires</p>
                                <Segmented fill size="lg" label="Destinataires" value={targeted} onValueChange={setTargeted}
                                    options={[{ value: 'all', label: 'Tous les membres' }, { value: 'filter', label: 'Cibler' }]} />
                                {targeted === 'filter' && (
                                    <div className="space-y-5 rounded-panel border border-line bg-surface-2 p-4">
                                        <CountryPicker value={countries} onChange={setCountries} />
                                        <div className="grid grid-cols-2 gap-3">
                                            <Field label="Âge minimum">
                                                <Input className="h-11" type="number" inputMode="numeric" min={13} max={100} value={ageMin} onChange={e => setAgeMin(e.target.value)} placeholder="Ex. 18" />
                                            </Field>
                                            <Field label="Âge maximum">
                                                <Input className="h-11" type="number" inputMode="numeric" min={13} max={100} value={ageMax} onChange={e => setAgeMax(e.target.value)} placeholder="Ex. 35" />
                                            </Field>
                                            {ageError && <p className="col-span-2 text-sm text-danger" role="alert">{ageError}</p>}
                                            <Field label="Sexe">
                                                <Select className="h-11" value={sex} onValueChange={setSex}
                                                    options={[{ value: 'all', label: 'Tous' }, { value: 'male', label: SEX_LABEL.male }, { value: 'female', label: SEX_LABEL.female }]} />
                                            </Field>
                                            <Field label="Abonnement">
                                                <Select className="h-11" value={subscription} onValueChange={setSubscription}
                                                    options={[{ value: 'all', label: 'Tous' }, { value: 'subscribed', label: SUBSCRIPTION_LABEL.subscribed }, { value: 'unsubscribed', label: SUBSCRIPTION_LABEL.unsubscribed }]} />
                                            </Field>
                                        </div>
                                        <OptionPicker
                                            label="Centres d’intérêt"
                                            options={options.data?.interests ?? []}
                                            value={interests}
                                            onChange={setInterests}
                                            loading={options.isLoading}
                                            error={options.isError}
                                            emptyHint="Aucun choisi = tous. Plusieurs choisis = les membres qui ont au moins l’un d’eux."
                                        />
                                        <OptionPicker
                                            label="Métiers"
                                            options={options.data?.professions ?? []}
                                            value={professions}
                                            onChange={setProfessions}
                                            loading={options.isLoading}
                                            error={options.isError}
                                            emptyHint="Aucun choisi = tous. Pensez aux variantes (« Etudiant(e) », « Étudiant/Élève »…)."
                                        />
                                        <p className="text-xs text-fg-muted">
                                            Les membres qui n’ont pas renseigné leur âge, leurs intérêts ou leur métier ne sont pas touchés par ces critères.
                                        </p>
                                    </div>
                                )}
                                <p className="text-sm" aria-live="polite">
                                    {ageError ? null
                                        : counting ? <span className="text-fg-muted">Comptage…</span>
                                            : count === null ? <span className="text-danger">Impossible de compter les membres pour le moment.</span>
                                                : count === 0 ? <span className="text-danger">Aucun membre ne correspond : élargissez le ciblage.</span>
                                                    : <span className="text-fg">{describeTargeting(Object.keys(filter).length ? filter : null)} : <strong className="tabular-nums">{fmtInt(count)}</strong> membre{count > 1 ? 's' : ''}.</span>}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2 lg:sticky lg:top-0 lg:self-start">
                            <p className="text-sm font-medium text-fg">Aperçu</p>
                            <PopupPreview title={title} message={message} imageUrl={imageUrl || undefined} buttonLabel={withButton ? buttonLabel || 'Bouton' : undefined} />
                        </div>
                    </div>
                </SheetContent>
            )}
        </Dialog>
    );
}
