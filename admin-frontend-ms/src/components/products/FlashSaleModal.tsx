import React, { useState, useEffect } from 'react';
import { Product, FlashSale } from '../../pages/ProductsManagementPage'; // Assuming interfaces are here

const SALE_STATUS_LABELS: Record<string, string> = {
    active: 'Active',
    scheduled: 'Programmée',
    expired: 'Terminée',
    cancelled: 'Annulée',
    pending_payment: 'Paiement en attente',
};

interface FlashSaleModalProps {
    isOpen: boolean;
    product: Product | null;
    existingSales?: FlashSale[]; // <-- Added prop (optional)
    isLoading: boolean;
    onSave: (flashSaleData: { discountedPrice: number; startTime: Date; endTime: Date }) => void;
    onDelete: (flashSaleId: string) => void; // Changed from productId to flashSaleId
    onClose: () => void;
}

const FlashSaleModal: React.FC<FlashSaleModalProps> = ({
    isOpen,
    product,
    existingSales = [], // <-- Destructure with default value
    isLoading,
    onSave,
    onDelete,
    onClose,
}) => {
    const [discountedPrice, setDiscountedPrice] = useState<string>('');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    useEffect(() => {
        // Reset form when modal opens or product changes
        if (isOpen && product) {
            // Optionally, pre-fill form if there's an active/relevant sale in existingSales
            // For now, just reset
                setDiscountedPrice('');
                setStartDate('');
                setEndDate('');
        } else {
            // Clear fields when modal is closed
            setDiscountedPrice('');
            setStartDate('');
            setEndDate('');
        }
    }, [isOpen, product]); // Removed existingSales dependency for now to avoid complexity

    const handleSaveClick = () => {
        // Basic validation
        if (discountedPrice === '' || !startDate || !endDate) {
            alert('Renseigne tous les champs de la vente flash.');
            return;
        }
        const finalPrice = Number(discountedPrice);
        if (isNaN(finalPrice) || finalPrice < 0) {
            alert('Indique un prix réduit valide (0 ou plus).');
            return;
        }
        if (product && finalPrice >= product.price) {
            alert(`Le prix réduit doit être inférieur au prix d’origine (${formatCurrency(product.price)}).`);
            return;
        }
        if (new Date(startDate) >= new Date(endDate)) {
            alert('La date de fin doit venir après la date de début.');
            return;
        }

        onSave({
            discountedPrice: finalPrice,
            startTime: new Date(startDate),
            endTime: new Date(endDate)
        });
    };

    const handleDeleteClick = () => {
        // Use existingSales prop to find the sale to delete
        // Find the first active or scheduled sale (logic might need refinement)
        const saleToDelete = existingSales.find(fs => fs.status === 'active' || fs.status === 'scheduled');

        if (saleToDelete?._id) {
            onDelete(saleToDelete._id);
        } else {
            console.warn('No active or scheduled flash sale found to delete in existingSales:', existingSales);
            alert('Aucune vente flash active ou programmée à retirer.');
        }
    };

    // Helper for currency formatting (can be moved to utils)
    const formatCurrency = (amount: number): string => {
        // Consider locale and currency based on user/app settings if needed
        return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF' }).format(amount);
    };

    // Helper to format dates for display
    const formatDate = (dateInput: Date | string | undefined): string => {
        if (!dateInput) return '—';
        try {
            return new Date(dateInput).toLocaleString('fr-FR');
        } catch (e) {
            return 'Date invalide';
        }
    };

    if (!isOpen || !product) {
        return null; // Don't render the modal if it's not open or no product
    }

    // Determine if there's a current relevant sale (active or scheduled)
    const currentSale = existingSales.find(fs => fs.status === 'active' || fs.status === 'scheduled');

    return (
        <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-30 p-4">
            {/* Make modal content scrollable */}
            <div className="bg-surface p-6 rounded-lg w-full max-w-xl max-h-[90vh] overflow-y-auto border border-line">
                <h2 className="text-xl font-semibold text-fg mb-4">Vente flash : <span className="text-indigo-600 dark:text-indigo-400">{product.name}</span></h2>

                {/* --- Form for New/Editing Sale --- */}
                {/* Conditionally show form - maybe only if no active/scheduled sale exists? Or always show? */}
                {/* For now, always show the form to create a new one */}
                <h3 className="text-lg font-medium text-fg-muted mb-3 border-t border-line-strong pt-3 mt-4">
                    {currentSale ? 'Remplacer la vente en cours' : 'Nouvelle vente flash'}
                    <span className="text-sm text-fg-muted ml-2">(prix d’origine : {formatCurrency(product.price)})</span>
                </h3>
                <div className="mb-4">
                    <label htmlFor="discountedPrice" className="block text-sm font-medium text-fg-muted mb-1">Prix réduit (XAF)</label>
                        <input
                            type="number"
                            id="discountedPrice"
                            value={discountedPrice}
                            onChange={(e) => setDiscountedPrice(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md text-fg focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="ex. 4500"
                            min="0"
                        step="any"
                            required
                        disabled={isLoading}
                        />
                    </div>
                <div className="mb-4">
                    <label htmlFor="startDate" className="block text-sm font-medium text-fg-muted mb-1">Début (date et heure)</label>
                        <input
                            type="datetime-local"
                            id="startDate"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md text-fg focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500"
                        required
                            disabled={isLoading}
                        />
                    </div>
                <div className="mb-4">
                    <label htmlFor="endDate" className="block text-sm font-medium text-fg-muted mb-1">Fin (date et heure)</label>
                        <input
                            type="datetime-local"
                            id="endDate"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md text-fg focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500"
                        required
                            disabled={isLoading}
                        />
                </div>

                {/* --- Existing Sales / History Section --- */}
                <div className="mt-6 pt-4 border-t border-line">
                    <h3 className="text-lg font-medium text-fg-muted mb-3">Historique et statut</h3>
                    {isLoading && <p className="text-center text-fg-muted my-2">Chargement des ventes…</p>} {/* Use specific loading state */}
                    {!isLoading && existingSales.length === 0 && (
                        <p className="text-sm text-fg-muted italic text-center">Aucune vente flash pour ce produit.</p>
                    )}
                    {!isLoading && existingSales.length > 0 && (
                        <div className="flex space-x-4 overflow-x-auto pb-4 pr-4 [&::-webkit-scrollbar]:hidden"> {/* Horizontal scroll, hidden scrollbar, increased right padding */}
                            {existingSales
                                .sort((a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime()) // Sort newest first using startTime
                                .map((sale) => {
                                    const isActive = sale.status === 'active';
                                    const isScheduled = sale.status === 'scheduled';
                                    const isPast = !isActive && !isScheduled; // Simple check for past/other statuses
                                    let statusColor = 'text-fg-muted';
                                    if (isActive) statusColor = 'text-green-600 dark:text-green-400';
                                    if (isScheduled) statusColor = 'text-yellow-700 dark:text-yellow-400';

                                    console.log(`Rendering Sale ID: ${sale._id}, Start: ${sale.startTime}, End: ${sale.endTime}, Typeof Start: ${typeof sale.startTime}`); // Use startTime/endTime in log

                                    return (
                                        <div key={sale._id} className="text-sm p-3 rounded-lg bg-surface-2 border border-line-strong w-64 shrink-0">
                                            <p><span className="font-semibold">Statut :</span> <span className={`font-bold ${statusColor}`}>{sale.status ? (SALE_STATUS_LABELS[sale.status] ?? sale.status.replace('_', ' ')) : '—'}</span></p>
                                            {sale.discountedPrice && <p><span className="font-semibold">Prix réduit :</span> {formatCurrency(sale.discountedPrice)}</p>}
                                            <p><span className="font-semibold">Début :</span> {formatDate(sale.startTime)}</p> {/* Use startTime */}
                                            <p><span className="font-semibold">Fin :</span> {formatDate(sale.endTime)}</p>   {/* Use endTime */}
                                            {sale.viewCount !== undefined && <p><span className="font-semibold">Vues :</span> {sale.viewCount}</p>}
                                            {sale.whatsappClickCount !== undefined && <p><span className="font-semibold">Clics WhatsApp :</span> {sale.whatsappClickCount}</p>}
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </div>

                {/* --- Action Buttons --- */}
                <div className="flex justify-between items-center border-t border-line pt-4 mt-4">
                    {/* Delete Button (only show if there's an active/scheduled sale to remove) */}
                    <div>
                        {currentSale && (
                            <button
                                type="button"
                                onClick={handleDeleteClick}
                                disabled={isLoading}
                                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                            >
                                {isLoading ? 'Retrait…' : 'Retirer la vente en cours'}
                            </button>
                        )}
                    </div>

                    {/* Cancel & Save Buttons */}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isLoading}
                            className="px-4 py-2 bg-surface-3 text-fg text-sm font-medium rounded-md hover:bg-surface-2 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-fg-subtle disabled:opacity-50"
                        >
                            Annuler
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveClick}
                            disabled={isLoading}
                            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                        >
                            {isLoading ? 'Enregistrement…' : (currentSale ? 'Remplacer la vente' : 'Créer la vente')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FlashSaleModal; 