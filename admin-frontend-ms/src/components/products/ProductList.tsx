import React from 'react';
import { Product } from '../../pages/ProductsManagementPage'; // Import Product interface only
import { Edit, Trash2, Zap } from 'lucide-react'; // Icons for actions
import { ImageDisplay } from '../common/ImageDisplay';
import { getFileUrl } from '../../utils/fileUtils';

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
        return <div className="text-center p-4">Loading products...</div>;
    }

    if (!products || products.length === 0) {
        return <div className="text-center p-4 text-gray-500">No products found.</div>;
    }

    return (
        <div className="overflow-x-auto shadow-md rounded-lg">
            <table className="w-full text-sm text-left text-gray-400">
                <thead className="text-xs uppercase bg-gray-700 text-gray-300">
                    <tr>
                        <th scope="col" className="px-6 py-3">Image</th>
                        <th scope="col" className="px-6 py-3">Name</th>
                        <th scope="col" className="px-6 py-3">Category</th>
                        <th scope="col" className="px-6 py-3">Price</th>
                        <th scope="col" className="px-6 py-3">Status</th>
                        <th scope="col" className="px-6 py-3">Active Flash Sale</th>
                        <th scope="col" className="px-6 py-3">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {products.map((product) => {
                        // Use product.status from backend if available, otherwise fallback
                        const statusText = product.status ? product.status.charAt(0).toUpperCase() + product.status.slice(1) : 'Unknown';
                        const statusColor = product.status === 'approved' ? 'bg-green-900 text-green-300' : product.status === 'pending' ? 'bg-yellow-900 text-yellow-300' : product.status === 'rejected' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300';

                        return (
                            <tr key={product._id} className="border-b bg-gray-800 border-gray-700 hover:bg-gray-600">
                                <td className="px-6 py-4">
                                    {product.imagesUrl && product.imagesUrl.length > 0 ? (
                                        // Check if it's already a full URL or needs processing
                                        product.imagesUrl[0].startsWith('http') ? (
                                            <img
                                                src={product.imagesUrl[0]}
                                                alt={product.name}
                                                className="w-16 h-16 object-cover rounded"
                                            />
                                        ) : (
                                            <ImageDisplay
                                                fileId={product.imagesUrl[0]}
                                                alt={product.name}
                                                className="w-16 h-16 object-cover rounded"
                                            />
                                        )
                                    ) : (
                                        <div className="w-16 h-16 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-500">
                                            No Image
                                        </div>
                                    )}
                                </td>
                                <th scope="row" className="px-6 py-4 font-medium whitespace-nowrap text-white">
                                    {product.name}
                                </th>
                                <td className="px-6 py-4">
                                    {product.category}{product.subcategory ? ` > ${product.subcategory}` : ''}
                                </td>
                                <td className="px-6 py-4">
                                    {formatCurrency(product.price)}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor}`}>
                                        {statusText}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${product.hasActiveFlashSale ? 'bg-yellow-700 text-yellow-200' : 'bg-gray-700 text-gray-300'}`}>
                                        {product.hasActiveFlashSale ? 'Yes' : 'No'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 space-x-2 whitespace-nowrap">
                                    <button onClick={() => onEdit(product)} className="p-1 rounded text-blue-400 hover:bg-gray-700" title="Edit Product"><Edit size={16} /></button>
                                    <button onClick={() => onManageFlashSale(product)} className="p-1 rounded text-yellow-400 hover:bg-gray-700" title="Manage Flash Sale"><Zap size={16} /></button>
                                    <button onClick={() => onDelete(product._id)} className="p-1 rounded text-red-500 hover:bg-gray-700" title="Delete Product"><Trash2 size={16} /></button>
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