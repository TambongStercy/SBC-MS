import React from 'react';
import { Product } from '../../pages/ProductsManagementPage'; // Import Product interface only
import { Edit, Trash2, Zap } from 'lucide-react'; // Icons for actions
import { ImageDisplay } from '../common/ImageDisplay';
import { getFileUrl } from '../../utils/fileUtils';

const STATUS_LABELS: Record<string, string> = {
    pending: 'En attente',
    approved: 'Approuvé',
    rejected: 'Rejeté',
    deleted: 'Supprimé',
};

interface ProductListProps {
    products: Product[];
    isLoading: boolean;
    onEdit: (product: Product) => void;
    onDelete: (productId: string) => void;
    onManageFlashSale: (product: Product) => void;
}

const ProductList: React.FC<ProductListProps> = ({
    products,
    isLoading,
    onEdit,
    onDelete,
    onManageFlashSale,
}) => {

    // Define utility functions directly within the component
    const formatCurrency = (amount: number): string => {
        // Basic XAF formatting, adjust as needed
        return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF' }).format(amount);
    };

    console.log("Rendering product in list:", products); // Keep this log for now

    if (isLoading) {
        return <div className="text-center p-4">Chargement des produits…</div>;
    }

    if (!products || products.length === 0) {
        return <div className="text-center p-4 text-fg-subtle">Aucun produit trouvé.</div>;
    }

    return (
        <div className="overflow-x-auto rounded-lg">
            <table className="w-full text-sm text-left text-fg-muted">
                <thead className="text-xs uppercase bg-surface-2 text-fg-muted">
                    <tr>
                        <th scope="col" className="px-6 py-3">Image</th>
                        <th scope="col" className="px-6 py-3">Nom</th>
                        <th scope="col" className="px-6 py-3">Catégorie</th>
                        <th scope="col" className="px-6 py-3">Prix</th>
                        <th scope="col" className="px-6 py-3">Statut</th>
                        <th scope="col" className="px-6 py-3">Vente flash active</th>
                        <th scope="col" className="px-6 py-3">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {products.map((product) => {
                        // Use product.status from backend if available, otherwise fallback
                        const statusText = product.status ? (STATUS_LABELS[product.status] ?? product.status) : 'Inconnu';
                        const statusColor = product.status === 'approved' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : product.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300' : product.status === 'rejected' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300' : 'bg-surface-2 text-fg-muted';

                        return (
                            <tr key={product._id} className="border-b bg-surface border-line hover:bg-surface-3">
                                <td className="px-6 py-4">
                                    {product.imagesUrl && product.imagesUrl.length > 0 ? (
                                        // Check if it's already a full URL or needs processing
                                        product.imagesUrl[0].startsWith('http') ? (
                                            <img
                                                src={product.imagesUrl[0]}
                                                alt={product.name}
                                                className="w-16 h-16 object-cover rounded-sm"
                                            />
                                        ) : (
                                            <ImageDisplay
                                                fileId={product.imagesUrl[0]}
                                                alt={product.name}
                                                className="w-16 h-16 object-cover rounded-sm"
                                            />
                                        )
                                    ) : (
                                        <div className="w-16 h-16 bg-surface-2 rounded-sm flex items-center justify-center text-xs text-fg-subtle">
                                            Pas d’image
                                        </div>
                                    )}
                                </td>
                                <th scope="row" className="px-6 py-4 font-medium whitespace-nowrap text-fg">
                                    {product.name}
                                </th>
                                <td className="px-6 py-4">
                                    {product.category}{product.subcategory ? ` > ${product.subcategory}` : ''}
                                </td>
                                <td className="px-6 py-4">
                                    {formatCurrency(product.price)}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-sm text-xs font-medium ${statusColor}`}>
                                        {statusText}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-sm text-xs font-medium ${product.hasActiveFlashSale ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-200' : 'bg-surface-2 text-fg-muted'}`}>
                                        {product.hasActiveFlashSale ? 'Oui' : 'Non'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 space-x-2 whitespace-nowrap">
                                    <button onClick={() => onEdit(product)} className="p-1 rounded-sm text-blue-600 dark:text-blue-400 hover:bg-surface-2" title="Modifier le produit"><Edit size={16} /></button>
                                    <button onClick={() => onManageFlashSale(product)} className="p-1 rounded-sm text-yellow-700 dark:text-yellow-400 hover:bg-surface-2" title="Gérer la vente flash"><Zap size={16} /></button>
                                    <button onClick={() => onDelete(product._id)} className="p-1 rounded-sm text-red-500 hover:bg-surface-2" title="Supprimer le produit"><Trash2 size={16} /></button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default ProductList; 