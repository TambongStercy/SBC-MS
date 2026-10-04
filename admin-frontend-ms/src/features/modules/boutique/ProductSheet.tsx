import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MemberById } from '../../members/MemberById';
import { Img } from './Img';
import { Badge, Button, ConfirmSheet, Input, KeyValue, SectionTitle, Sheet, Spinner, StatusBadge, Textarea, notify } from '../../../ui';
import { formatDate, formatDateTime, formatMoney, thumbnailUrl } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import {
    FLASH_STATUS, LIVE_FLASH, cancelFlashSale, categoryLabel, createFlashSale, listFlashSales, removeProduct, restoreProduct, updateProduct,
    type FlashSale, type Product,
} from './api';

/** "2026-10-04T18:30" for a datetime-local input, in the admin's own time. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function EditSheet({ p, onClose }: { p: Product; onClose: () => void }) {
    const qc = useQueryClient();
    const [f, setF] = useState({ name: p.name, price: String(p.price), category: p.category, subcategory: p.subcategory ?? '', description: p.description });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const price = Number(f.price);
    const save = async () => {
        if (!f.name.trim() || !f.category.trim()) { setError('Le nom et la catégorie sont obligatoires.'); return; }
        if (!Number.isFinite(price) || price <= 0) { setError('Le prix doit être un montant positif.'); return; }
        setBusy(true); setError(null);
        try {
            await updateProduct(p._id, { name: f.name.trim(), price, category: f.category.trim(), subcategory: f.subcategory.trim(), description: f.description });
            await qc.invalidateQueries({ queryKey: ['boutique'] });
            notify.success('Produit modifié.');
            onClose();
        } catch (e) { setError(errorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <Sheet open onClose={onClose} busy={busy} title="Modifier le produit"
            footer={<div className="flex justify-end"><Button onClick={save} loading={busy}>Enregistrer</Button></div>}>
            <div className="space-y-3">
                <Input label="Nom" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
                <Input label="Prix (FCFA)" type="number" inputMode="numeric" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                    <Input label="Catégorie" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} />
                    <Input label="Sous-catégorie" value={f.subcategory} onChange={e => setF({ ...f, subcategory: e.target.value })} />
                </div>
                <Textarea label="Description" rows={5} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
                <p className="text-xs text-ink-3">Visible tout de suite dans la boutique. Le vendeur n’est pas prévenu.</p>
                {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
            </div>
        </Sheet>
    );
}

function FlashSheet({ p, onClose }: { p: Product; onClose: () => void }) {
    const qc = useQueryClient();
    const now = Date.now();
    const [price, setPrice] = useState('');
    const [start, setStart] = useState(localInput(new Date(now + 10 * 60000)));
    const [end, setEnd] = useState(localInput(new Date(now + 24 * 3600000)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const n = Number(price);
    const save = async () => {
        const s = new Date(start), e = new Date(end);
        if (!Number.isFinite(n) || n <= 0 || n >= p.price) { setError(`Le prix soldé doit être inférieur à ${formatMoney(p.price)}.`); return; }
        if (s.getTime() <= Date.now()) { setError('Le début doit être dans le futur.'); return; }
        if (e <= s) { setError('La fin doit venir après le début.'); return; }
        setBusy(true); setError(null);
        try {
            await createFlashSale({ productId: p._id, discountedPrice: n, startTime: s.toISOString(), endTime: e.toISOString() });
            await qc.invalidateQueries({ queryKey: ['boutique'] });
            notify.success('Vente flash programmée.');
            onClose();
        } catch (err) { setError(errorMessage(err)); }
        finally { setBusy(false); }
    };
    return (
        <Sheet open onClose={onClose} busy={busy} title="Nouvelle vente flash"
            footer={<div className="flex justify-end"><Button onClick={save} loading={busy}>Programmer</Button></div>}>
            <div className="space-y-3">
                <p className="text-sm text-ink-2">{p.name} · prix normal {formatMoney(p.price)}</p>
                <Input label="Prix soldé (FCFA)" type="number" inputMode="numeric" value={price} onChange={e => { setPrice(e.target.value); setError(null); }}
                    hint={n > 0 && n < p.price ? `−${Math.round((1 - n / p.price) * 100)} %` : undefined} />
                <div className="grid sm:grid-cols-2 gap-3">
                    <Input label="Début" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
                    <Input label="Fin" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
                </div>
                <p className="text-xs text-ink-3">Créée par l’admin, elle ne coûte rien au vendeur : pas de frais à payer.</p>
                {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
            </div>
        </Sheet>
    );
}

function Sales({ p, onCancel }: { p: Product; onCancel: (s: FlashSale) => void }) {
    const q = useQuery({ queryKey: ['boutique', 'flash', 'product', p._id], queryFn: () => listFlashSales({ page: 1, limit: 10, productId: p._id }) });
    if (q.isLoading) return <Spinner className="py-4" />;
    if (!q.data?.sales.length) return <p className="text-sm text-ink-3">Aucune vente flash.</p>;
    return (
        <ul className="divide-y divide-border border border-border rounded-tile">
            {q.data.sales.map(s => (
                <li key={s._id} className="px-3 py-2.5 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold tabular whitespace-nowrap">{formatMoney(s.discountedPrice)} <span className="text-xs text-ink-3 line-through font-normal">{formatMoney(s.originalPrice)}</span></p>
                        <p className="text-xs text-ink-2">du {formatDateTime(s.startTime)} au {formatDateTime(s.endTime)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                        <StatusBadge status={s.status} labels={FLASH_STATUS} />
                        {LIVE_FLASH.includes(s.status) && <button type="button" className="text-xs font-semibold text-danger hover:underline py-1" onClick={() => onCancel(s)}>Annuler…</button>}
                    </div>
                </li>
            ))}
        </ul>
    );
}

/** One product: what the seller listed, and what an admin can do about it. */
export function ProductSheet({ p, onClose }: { p: Product; onClose: () => void }) {
    const qc = useQueryClient();
    const [sub, setSub] = useState<'edit' | 'flash' | 'remove' | 'restore' | null>(null);
    const [cancelling, setCancelling] = useState<FlashSale | null>(null);
    const [image, setImage] = useState(0);
    useEffect(() => setImage(0), [p._id]);
    const refresh = () => qc.invalidateQueries({ queryKey: ['boutique'] });
    const img = p.images[image];

    return (
        <Sheet open onClose={onClose} size="lg" title={p.name}
            footer={p.deleted
                ? <Button full onClick={() => setSub('restore')}>Remettre en ligne</Button>
                : (
                    <div className="grid grid-cols-3 gap-2">
                        <Button variant="danger-soft" onClick={() => setSub('remove')}>Retirer…</Button>
                        <Button variant="secondary" onClick={() => setSub('edit')}>Modifier</Button>
                        <Button variant="secondary" onClick={() => setSub('flash')}>Vente flash</Button>
                    </div>
                )}>
            <div className="space-y-5">
                {img && (
                    <div className="space-y-2">
                        <Img key={img.fileId} src={thumbnailUrl(img.fileId, 800)} className="w-full h-[min(45vh,360px)] object-contain rounded-tile" />
                        {p.images.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto">
                                {p.images.map((im, i) => (
                                    <button key={im.fileId} type="button" onClick={() => setImage(i)} aria-label={`Image ${i + 1}`}
                                        className={`shrink-0 rounded-tile border-2 ${i === image ? 'border-primary' : 'border-transparent'}`}>
                                        <Img src={thumbnailUrl(im.fileId, 96)} className="size-14 object-cover rounded-tile" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                    {p.deleted ? <Badge tone="danger">Retiré {p.deletedAt ? formatDate(p.deletedAt) : ''}</Badge> : <Badge tone="success">En ligne</Badge>}
                    {p.hasActiveFlashSale && <Badge tone="accent">Vente flash en cours</Badge>}
                </div>
                <KeyValue items={[
                    ['Prix', formatMoney(p.price)],
                    ['Catégorie', [categoryLabel(p.category), p.subcategory ? categoryLabel(p.subcategory) : null].filter(Boolean).join(' · ')],
                    p.ratings?.length ? ['Note', `${(p.overallRating ?? 0).toFixed(1)} / 5 (${p.ratings.length} avis)`] : null,
                    ['Publié le', formatDate(p.createdAt)],
                ]} />
                <div><SectionTitle>Vendeur</SectionTitle><MemberById id={p.userId} fallback="Vendeur introuvable" /></div>
                <div><SectionTitle>Description</SectionTitle><p className="text-sm text-ink-2 whitespace-pre-line break-words">{p.description || '—'}</p></div>
                <div><SectionTitle>Ventes flash</SectionTitle><Sales p={p} onCancel={setCancelling} /></div>
            </div>

            {sub === 'edit' && <EditSheet p={p} onClose={() => setSub(null)} />}
            {sub === 'flash' && <FlashSheet p={p} onClose={() => setSub(null)} />}
            <ConfirmSheet open={sub === 'remove'} onClose={() => setSub(null)} tone="danger" title={`Retirer « ${p.name} » ?`}
                message={<p>Le produit disparaît de la boutique et ses ventes flash en cours ou à venir sont annulées. Tu pourras le remettre en ligne depuis « Retirés ». Le vendeur n’est pas prévenu.</p>}
                confirmLabel="Retirer"
                onConfirm={async () => { const r = await removeProduct(p._id); const n = r.flashSalesCancelled; notify.success(n ? `Produit retiré, ${n} vente${n > 1 ? 's' : ''} flash annulée${n > 1 ? 's' : ''}.` : 'Produit retiré.'); refresh(); onClose(); }} />
            <ConfirmSheet open={sub === 'restore'} onClose={() => setSub(null)} tone="success" title={`Remettre « ${p.name} » en ligne ?`}
                message={<p>Il réapparaît dans la boutique. Les ventes flash annulées ne reviennent pas.</p>}
                confirmLabel="Remettre en ligne"
                onConfirm={async () => { await restoreProduct(p._id); notify.success('Produit remis en ligne.'); refresh(); onClose(); }} />
            <ConfirmSheet open={!!cancelling} onClose={() => setCancelling(null)} tone="danger" title="Annuler cette vente flash ?"
                message={cancelling ? <p>Le prix soldé de {formatMoney(cancelling.discountedPrice)} n’est plus proposé. C’est définitif.</p> : null}
                confirmLabel="Annuler la vente"
                onConfirm={async () => { await cancelFlashSale(cancelling!._id); notify.success('Vente flash annulée.'); refresh(); }} />
        </Sheet>
    );
}
