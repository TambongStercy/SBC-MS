import React, { useEffect, useState } from 'react';
import type { Product, FlashSale } from '../../pages/ProductsManagementPage';
import { Button, Dialog, Field, Input, SheetContent, Skeleton } from '../ui';
import { Can } from '../Can';
import { Money, SheetSection, StatusBadge, formatDateTime, formatMoney, formatNumber, type StatusMap } from '../moduleKit';

const SALE_STATUS: StatusMap = {
    active: ['Active', 'success'],
    scheduled: ['Programmée', 'info'],
    expired: ['Terminée', 'neutral'],
    cancelled: ['Annulée', 'neutral'],
    pending_payment: ['Paiement en attente', 'warning'],
};

interface FlashSaleModalProps {
    isOpen: boolean;
    product: Product | null;
    existingSales?: FlashSale[];
    isLoading: boolean;
    onSave: (flashSaleData: { discountedPrice: number; startTime: Date; endTime: Date }) => void;
    onDelete: (flashSaleId: string) => void;
    onClose: () => void;
}

type Errors = Partial<Record<'price' | 'start' | 'end', string>>;

/** A product's flash sales: the one running or scheduled (with "Retirer"), a form to create / replace it, and the history. */
const FlashSaleModal: React.FC<FlashSaleModalProps> = ({ isOpen, product, existingSales = [], isLoading, onSave, onDelete, onClose }) => {
    const [discountedPrice, setDiscountedPrice] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [errors, setErrors] = useState<Errors>({});

    useEffect(() => {
        setDiscountedPrice('');
        setStartDate('');
        setEndDate('');
        setErrors({});
    }, [isOpen, product]);

    const currentSale = existingSales.find(fs => fs.status === 'active' || fs.status === 'scheduled');
    const history = [...existingSales].sort((a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());

    const handleSave = () => {
        if (!product) return;
        const next: Errors = {};
        const finalPrice = Number(discountedPrice);
        if (discountedPrice === '' || isNaN(finalPrice) || finalPrice < 0) next.price = 'Indique un prix réduit valide (0 ou plus).';
        else if (finalPrice >= product.price) next.price = `Le prix réduit doit être inférieur au prix d’origine (${formatMoney(product.price)}).`;
        if (!startDate) next.start = 'Indique le début.';
        if (!endDate) next.end = 'Indique la fin.';
        else if (startDate && new Date(startDate) >= new Date(endDate)) next.end = 'La fin doit venir après le début.';
        setErrors(next);
        if (Object.keys(next).length) return;
        onSave({ discountedPrice: finalPrice, startTime: new Date(startDate), endTime: new Date(endDate) });
    };

    return (
        <Dialog open={isOpen && !!product} onOpenChange={open => { if (!open && !isLoading) onClose(); }}>
            {product && (
                <SheetContent
                    title="Vente flash"
                    description={`${product.name} · prix d’origine ${formatMoney(product.price)}`}
                    width="lg"
                    footer={(
                        <>
                            <Button variant="outline" size="lg" onClick={onClose} disabled={isLoading}>Fermer</Button>
                            <Can module="boutique" write>
                                <Button variant="primary" size="lg" onClick={handleSave} loading={isLoading}>
                                    {currentSale ? 'Remplacer la vente' : 'Créer la vente'}
                                </Button>
                            </Can>
                        </>
                    )}
                >
                    <div className="space-y-6">
                        {currentSale && (
                            <SheetSection title="Vente en cours">
                                <div className="flex flex-col gap-3 rounded-panel border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="space-y-1 text-sm">
                                        <div className="flex items-center gap-2">
                                            <StatusBadge status={currentSale.status} map={SALE_STATUS} />
                                            {currentSale.discountedPrice != null && <Money value={currentSale.discountedPrice} className="font-medium text-fg" />}
                                        </div>
                                        <p className="text-fg-muted">{formatDateTime(currentSale.startTime)} → {formatDateTime(currentSale.endTime)}</p>
                                    </div>
                                    <Can module="boutique" write>
                                        <Button variant="danger-ghost" size="lg" className="sm:h-9" onClick={() => onDelete(currentSale._id)} disabled={isLoading}>
                                            Retirer la vente en cours
                                        </Button>
                                    </Can>
                                </div>
                            </SheetSection>
                        )}

                        <Can module="boutique" write>
                            <SheetSection title={currentSale ? 'Remplacer la vente en cours' : 'Nouvelle vente flash'}>
                                <div className="space-y-4">
                                    <Field label="Prix réduit (F CFA)" required error={errors.price}>
                                        <Input className="h-11 sm:h-9" type="number" inputMode="numeric" min="0" step="any" placeholder="ex. 4500"
                                            value={discountedPrice} onChange={e => setDiscountedPrice(e.target.value)} disabled={isLoading} />
                                    </Field>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <Field label="Début (date et heure)" required error={errors.start}>
                                            <Input className="h-11 sm:h-9" type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={isLoading} />
                                        </Field>
                                        <Field label="Fin (date et heure)" required error={errors.end}>
                                            <Input className="h-11 sm:h-9" type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={isLoading} />
                                        </Field>
                                    </div>
                                </div>
                            </SheetSection>
                        </Can>

                        <SheetSection title="Historique">
                            {isLoading && existingSales.length === 0 ? (
                                <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                            ) : history.length === 0 ? (
                                <p className="text-sm text-fg-muted">Aucune vente flash pour ce produit.</p>
                            ) : (
                                <ul className="divide-y divide-line rounded-panel border border-line">
                                    {history.map(sale => (
                                        <li key={sale._id} className="space-y-1 px-4 py-3 text-sm">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <StatusBadge status={sale.status} map={SALE_STATUS} />
                                                {sale.discountedPrice != null && <Money value={sale.discountedPrice} className="text-fg" />}
                                            </div>
                                            <p className="text-fg-muted">{formatDateTime(sale.startTime)} → {formatDateTime(sale.endTime)}</p>
                                            {(sale.viewCount !== undefined || sale.whatsappClickCount !== undefined) && (
                                                <p className="text-xs text-fg-muted">
                                                    {sale.viewCount !== undefined && `${formatNumber(sale.viewCount)} vues`}
                                                    {sale.viewCount !== undefined && sale.whatsappClickCount !== undefined && ' · '}
                                                    {sale.whatsappClickCount !== undefined && `${formatNumber(sale.whatsappClickCount)} clics WhatsApp`}
                                                </p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SheetSection>
                    </div>
                </SheetContent>
            )}
        </Dialog>
    );
};

export default FlashSaleModal;
