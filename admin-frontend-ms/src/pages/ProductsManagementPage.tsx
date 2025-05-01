import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
// Import sub-components
import ProductList from '../components/products/ProductList';
import ProductEditForm from '../components/products/ProductEditForm';
import FlashSaleModal from '../components/products/FlashSaleModal';
import Pagination from '../components/common/Pagination';
import ConfirmationModal from '../components/common/ConfirmationModal';

// Import API functions
import {
    getProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    createFlashSale,      // Import new API function
    deleteFlashSaleById, // <-- Import renamed function
    getProductFlashSales // <-- Import the new function
} from '../services/adminProductApi';

// Define interfaces for Product and FlashSale (move to types file later?)
export interface FlashSale {
    _id: string; // Add ID for specific flash sales
    productId: string; // Keep reference to product
    discountPercentage?: number; // Made optional as backend might use discountedPrice
    discountedPrice?: number; // Added based on backend likely structure
    startTime: Date | string; // <-- Corrected from startDate
    endTime: Date | string;   // <-- Corrected from endDate
    isActive?: boolean; // Status of this specific sale (consider backend enum)
    status?: string; // Added based on backend enum (e.g., 'scheduled', 'active')
    createdAt?: Date | string; // Optional timestamp
    // Add other fields from backend if needed for display/logic
    sellerUserId?: string;
    originalPrice?: number;
    feePaymentStatus?: string;
    viewCount?: number;
    whatsappClickCount?: number;
}

export interface Product {
    _id: string;
    name: string;
    description: string;
    price: number;
    category: string;
    subcategory?: string;
    imagesUrl?: string[];
    stock?: number;
    // flashSales?: FlashSale[]; // Array of flash sales (Potentially replaced by hasActiveFlashSale)
    // isActive?: boolean; // (Potentially replaced by hasActiveFlashSale or backend status)
    hasActiveFlashSale?: boolean; // <-- Added: Indicates if product has an active flash sale
    createdAt?: string;
    updatedAt?: string;
    // Add other fields returned by the backend if needed, e.g., status
    status?: string; // Example: Assuming backend returns status
    userId?: string; // Example: Assuming backend returns userId
}

// Define the payload type for the backend API call
interface BackendFlashSaleCreatePayload {
    productId: string;
    discountedPrice: number;
    startTime: string | Date;
    endTime: string | Date;
}

const ProductsManagementPage: React.FC = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [currentFlashSales, setCurrentFlashSales] = useState<FlashSale[]>([]); // Explicitly use imported FlashSale type
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isFetchingSales, setIsFetchingSales] = useState(false); // <-- Loading state for flash sales fetch
    const [error, setError] = useState<string | null>(null);
    const [isEditFormVisible, setIsEditFormVisible] = useState<boolean>(false);
    const [isFlashSaleModalVisible, setIsFlashSaleModalVisible] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [flashSaleFilter, setFlashSaleFilter] = useState<string>('all');
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [limit, setLimit] = useState<number>(10);
    const [fetchTrigger, setFetchTrigger] = useState<number>(0);
    // --- State for Confirmation Modal ---
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
    const [confirmAction, setConfirmAction] = useState<'deleteProduct' | 'deleteFlashSale' | null>(null);
    const [itemIdToDelete, setItemIdToDelete] = useState<string | null>(null);
    const [confirmTitle, setConfirmTitle] = useState<string>('');
    const [confirmMessage, setConfirmMessage] = useState<string>('');
    // --- End State for Confirmation Modal ---

    // fetchProducts now depends only on variables needed for the API call itself
    // It reads the latest filter values directly from state when called.
    const fetchProducts = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        console.log(`Fetching page: ${currentPage}, Limit: ${limit}, Search: '${searchTerm}', Status: ${statusFilter}, FlashSale: ${flashSaleFilter}`);
        try {
            const filters = {
                page: currentPage,
                limit: limit,
                searchTerm: searchTerm || undefined,
                status: statusFilter === 'all' ? undefined : statusFilter,
                hasActiveFlashSale: flashSaleFilter === 'all' ? undefined : flashSaleFilter === 'yes',
            };
            console.log("Fetching products with filters:", filters);
            const response = await getProducts(filters);
            setProducts(response.data);
            setTotalPages(response.pagination.totalPages);
            setCurrentPage(response.pagination.currentPage);
            console.log("Products fetched:", response.data, "Pagination:", response.pagination);
        } catch (err) {
            console.error("Failed to fetch products:", err);
            setError(err instanceof Error ? err.message : 'Failed to load products');
            setProducts([]);
            setTotalPages(1);
        } finally {
            setIsLoading(false);
        }
    }, [currentPage, limit, searchTerm, statusFilter, flashSaleFilter]);

    // useEffect now only runs on initial load and when currentPage/limit changes
    useEffect(() => {
        console.log("useEffect triggered by page/limit/trigger change");
        fetchProducts();
    }, [currentPage, limit, fetchTrigger]);

    // Filter input handlers ONLY update state, don't trigger fetch or reset page
    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
    };

    const handleStatusFilterChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setStatusFilter(event.target.value);
    };

    const handleFlashSaleFilterChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setFlashSaleFilter(event.target.value);
    };

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    // --- Handler for Apply Filters button ---
    const handleApplyFilters = () => {
        console.log("Apply Filters button clicked");
        setCurrentPage(1); // Reset page to 1
        setFetchTrigger(prev => prev + 1); // Increment trigger to force useEffect execution
    };
    // --- End Apply Filters Handler ---

    // Handlers for CRUD operations
    const handleCreateProduct = () => {
        setSelectedProduct(null);
        setIsEditFormVisible(true);
    };

    const handleEditProduct = (product: Product) => {
        setSelectedProduct(product);
        setIsEditFormVisible(true);
    };

    // Updated handleDeleteProduct
    const handleDeleteProduct = (productId: string, productName?: string) => {
        setItemIdToDelete(productId);
        setConfirmAction('deleteProduct');
        setConfirmTitle('Delete Product?');
        setConfirmMessage(`Are you sure you want to delete the product "${productName || 'this product'}"? This action cannot be undone if it proceeds.`);
        setIsConfirmModalOpen(true);
        // Original logic moved to confirmProductDelete
    };

    // New handler for confirming product deletion
    const confirmProductDelete = async () => {
        if (!itemIdToDelete) return;
        setIsLoading(true); // Use main loading state or a dedicated one
        setError(null);
        try {
            await deleteProduct(itemIdToDelete);
                fetchProducts(); // Refresh list
            toast.success('Product deleted successfully.'); // Use toast for feedback
        } catch (err) { // Type assertion for err
                console.error("Failed to delete product:", err);
                setError(err instanceof Error ? err.message : 'Failed to delete product');
            toast.error(err instanceof Error ? err.message : 'Failed to delete product');
            } finally {
                setIsLoading(false);
            closeConfirmationModal();
        }
    };

    // Modified handleSaveProduct to use API functions
    const handleSaveProduct = async (productData: Partial<Product>) => {
        setIsLoading(true);
        setError(null);
        try {
            let savedProduct;
            if (productData._id) { // Check if it has an ID (means editing)
                // Update
                console.log("Calling updateProduct with:", productData._id, productData);
                savedProduct = await updateProduct(productData._id, productData);
            } else {
                // Create
                console.log("Calling createProduct with:", productData);
                // Ensure required fields for create are present or handle error
                savedProduct = await createProduct(productData as Required<Omit<Product, '_id' | 'createdAt' | 'updatedAt' | 'flashSales' | 'isActive'>>); // Type assertion might be needed
            }
            console.log("Product saved successfully:", savedProduct);
            setIsEditFormVisible(false);
            fetchProducts(); // Refresh list
            // Optionally show success toast/message
        } catch (err) {
            console.error("Failed to save product:", err);
            setError(err instanceof Error ? err.message : 'Failed to save product');
            // Keep form open on error for correction?
            // setIsEditFormVisible(true); 
        } finally {
            setIsLoading(false);
        }
    };

    // Handlers for Flash Sale
    const handleManageFlashSale = async (product: Product) => {
        setSelectedProduct(product);
        setCurrentFlashSales([]); // Clear previous sales
        setIsFetchingSales(true); // Start loading indicator for sales
        setIsFlashSaleModalVisible(true);
        console.log("Opening flash sale modal for:", product._id);
        try {
            const sales = await getProductFlashSales(product._id); // <-- Fetch sales for this product
            console.log("Fetched flash sales for modal:", sales);
            setCurrentFlashSales(sales || []); // Update state with fetched sales (ensure array)
        } catch (err) {
            console.error("Failed to fetch flash sales for modal:", err);
            setError(err instanceof Error ? err.message : 'Failed to load existing flash sales for this product.');
            // Optionally close modal or show error within modal?
            // setIsFlashSaleModalVisible(false);
        } finally {
            setIsFetchingSales(false); // Stop loading indicator for sales
        }
    };

    const handleSaveFlashSale = async (flashSaleData: { discountedPrice: number; startTime: Date; endTime: Date }) => {
        if (!selectedProduct) return;
        setIsLoading(true);
        setError(null);
        try {
            // Construct payload for the API
            const payload: BackendFlashSaleCreatePayload = {
                productId: selectedProduct._id,
                discountedPrice: flashSaleData.discountedPrice,
                startTime: flashSaleData.startTime, // Already Date objects from modal
                endTime: flashSaleData.endTime
            };

            // Use the imported API function
            const response = await createFlashSale(payload);
            console.log("Create flash sale response (placeholder):", response);

            fetchProducts(); // Refresh the entire product list
            setIsFlashSaleModalVisible(false);

        } catch (err) {
            console.error("Failed to save flash sale:", err);
            setError(err instanceof Error ? err.message : 'Failed to save flash sale');
        } finally {
            setIsLoading(false);
        }
    };

    // Updated handleDeleteFlashSale
    const handleDeleteFlashSale = (flashSaleId: string) => {
        if (!flashSaleId) {
            console.error("handleDeleteFlashSale called without flashSaleId");
            setError('Cannot delete sale: Missing Flash Sale ID.');
            toast.error('Cannot delete sale: Missing Flash Sale ID.'); // Toast feedback
            return;
        }
        setItemIdToDelete(flashSaleId);
        setConfirmAction('deleteFlashSale');
        setConfirmTitle('Remove Flash Sale?');
        setConfirmMessage(`Are you sure you want to remove this flash sale (ID: ${flashSaleId})? This will cancel or deactivate it.`);
        setIsConfirmModalOpen(true);
        // Original logic moved to confirmFlashSaleDelete
    };

    // New handler for confirming flash sale deletion
    const confirmFlashSaleDelete = async () => {
        if (!itemIdToDelete) return;
        setIsLoading(true); // Use main loading state or a dedicated one
            setError(null);
            try {
            const response = await deleteFlashSaleById(itemIdToDelete);
            console.log("Delete flash sale response:", response);
                fetchProducts(); // Refresh list to see changes
            setIsFlashSaleModalVisible(false); // Close the main flash sale modal too
            toast.success(response.message || 'Flash sale removed successfully.'); // Toast feedback
        } catch (err) { // Type assertion for err
                console.error("Failed to delete flash sale:", err);
                setError(err instanceof Error ? err.message : 'Failed to delete flash sale');
            toast.error(err instanceof Error ? err.message : 'Failed to delete flash sale');
            } finally {
                setIsLoading(false);
            closeConfirmationModal();
        }
    };

    // --- Confirmation Modal Handlers ---
    const handleConfirm = () => {
        if (confirmAction === 'deleteProduct') {
            confirmProductDelete();
        } else if (confirmAction === 'deleteFlashSale') {
            confirmFlashSaleDelete();
        }
    };

    const closeConfirmationModal = () => {
        setIsConfirmModalOpen(false);
        setItemIdToDelete(null);
        setConfirmAction(null);
        setConfirmTitle('');
        setConfirmMessage('');
    };
    // --- End Confirmation Modal Handlers ---

    console.log("Products state before render:", products);

    /* // Simplified return for testing commented out
    return (
        <div className="p-10 bg-red-500 text-white text-4xl relative z-10">
            PRODUCT PAGE TEST - VISIBLE?
            <p>Products count: {products.length}</p>
        </div>
    );
    */

    // Restore original return, but omit container and mx-auto
    return (
        <div className="relative z-10 p-6 bg-gray-800 text-white rounded-lg shadow-lg w-full"> {/* Removed container, mx-auto. Kept w-full for now */}
            <h1 className="text-2xl font-bold mb-6">Product Management</h1>

            {error && <div className="bg-red-500 text-white p-3 rounded mb-4">Error: {error}</div>}

            {/* --- Filter Controls --- */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6 items-end">
                {/* Search Input */}
                <div className="md:col-span-2">
                    <label htmlFor="search" className="block text-sm font-medium text-gray-300 mb-1">Search Products</label>
                    <input
                        type="text"
                        id="search"
                        value={searchTerm}
                        onChange={handleSearchChange}
                        placeholder="Search by name, category..."
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>
                {/* Status Filter */}
                <div>
                    <label htmlFor="statusFilter" className="block text-sm font-medium text-gray-300 mb-1">Status</label>
                    <select
                        id="statusFilter"
                        value={statusFilter}
                        onChange={handleStatusFilterChange}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="all">All Statuses</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        {/* Add 'deleted' if backend supports it for admin view */}
                        {/* <option value="deleted">Deleted</option> */}
                    </select>
                </div>
                {/* Flash Sale Filter */}
                <div>
                    <label htmlFor="flashSaleFilter" className="block text-sm font-medium text-gray-300 mb-1">Active Flash Sale</label>
                    <select
                        id="flashSaleFilter"
                        value={flashSaleFilter}
                        onChange={handleFlashSaleFilterChange}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="all">All</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                    </select>
                </div>
                {/* Apply Filters Button */}
                <div>
                    <button
                        onClick={handleApplyFilters}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                        disabled={isLoading}
                    >
                        Apply Filters
                    </button>
                </div>
            </div>
            {/* --- End Filter Controls --- */}

            <div className="mb-4">
                <button
                    onClick={handleCreateProduct}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    disabled={isLoading}
                >
                    Add New Product
                </button>
            </div>

            <ProductList
                products={products}
                isLoading={isLoading}
                onEdit={handleEditProduct}
                onDelete={handleDeleteProduct}
                onManageFlashSale={handleManageFlashSale}
            />

            {/* --- Pagination Controls --- */}
            <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
            />
            {/* --- End Pagination Controls --- */}

            {/* Modals */}
            {isEditFormVisible && (
                <ProductEditForm
                    product={selectedProduct}
                    onSave={handleSaveProduct}
                    onCancel={() => setIsEditFormVisible(false)}
                    isLoading={isLoading}
                />
            )}

            <FlashSaleModal
                isOpen={isFlashSaleModalVisible}
                product={selectedProduct}
                existingSales={currentFlashSales} // <-- Pass fetched sales
                isLoading={isLoading || isFetchingSales} // <-- Combine loading states
                onSave={handleSaveFlashSale}
                onDelete={handleDeleteFlashSale}
                onClose={() => setIsFlashSaleModalVisible(false)}
            />

            {/* Confirmation Modal */}
            <ConfirmationModal
                isOpen={isConfirmModalOpen}
                title={confirmTitle}
                message={confirmMessage}
                onConfirm={handleConfirm}
                onCancel={closeConfirmationModal}
                isLoading={isLoading} // Use main loading state for now
                confirmText={confirmAction === 'deleteProduct' ? 'Delete Product' : 'Remove Sale'}
            />
        </div>
    );
};

export default ProductsManagementPage; 