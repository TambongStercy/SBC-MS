import axios from 'axios';
import apiClient from '../api/apiClient'; // Corrected import path
import { Product, FlashSale } from '../pages/ProductsManagementPage'; // <-- Import interfaces

// Simple console logger replacement
const log = {
    info: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
    debug: (...args: any[]) => console.debug(...args),
};

// Re-define or import Product and FlashSale interfaces (should match backend models)
// Use interfaces defined in ProductsManagementPage for consistency initially
/* --- REMOVED LOCAL INTERFACE DEFINITIONS --- 
interface Product { ... } 
interface FlashSale { ... }
*/

// --- API Response Interfaces (adjust as needed) ---
interface ProductListResponse {
    data: Product[]; // Now uses imported Product type
    pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
    };
    // Add success/message if backend includes them
}

interface SingleProductResponse {
    data: Product; // Now uses imported Product type
    // Add success/message if backend includes them
}

interface GenericSuccessResponse {
    success: boolean;
    message: string;
    data?: any; // Optional data field
}

// --- Filter Type Definition ---
interface ProductFilters {
    page?: number;
    limit?: number;
    searchTerm?: string;
    status?: string;
    hasActiveFlashSale?: boolean;
    // Add other potential filters like category, subcategory etc.
}

// --- API Function Types ---

type ProductCreatePayload = Omit<Product, '_id' | 'createdAt' | 'updatedAt' | 'flashSale'>; // Uses imported Product
type ProductUpdatePayload = Partial<ProductCreatePayload>;
type FlashSalePayload = Omit<FlashSale, '_id' | 'productId'>; // Uses imported FlashSale

// --- API Functions ---

// Fetch all products based on filters
export const getProducts = async (filters: ProductFilters = {}): Promise<ProductListResponse> => {
    // Default page and limit if not provided in filters
    const params = {
        page: filters.page || 1,
        limit: filters.limit || 10,
        searchTerm: filters.searchTerm,
        status: filters.status,
        // Convert boolean to string 'true'/'false' or undefined for API query param
        hasActiveFlashSale: filters.hasActiveFlashSale === undefined ? undefined : String(filters.hasActiveFlashSale)
    };

    // Remove undefined properties so they aren't sent as empty query params
    Object.keys(params).forEach(key => params[key as keyof typeof params] === undefined && delete params[key as keyof typeof params]);

    try {
        console.log("API Call - getProducts with params:", params);
        const response = await apiClient.get<ProductListResponse>('/products/admin', { params });
        // Assuming backend wraps data/pagination
        return response.data;
    } catch (error) {
        console.error('API Error getting products:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to fetch products');
        }
        throw new Error('Failed to fetch products due to an unknown error.');
    }
};

// Fetch single product details
export const getProductDetails = async (productId: string): Promise<Product> => {
    try {
        const response = await apiClient.get<SingleProductResponse>(`/products/${productId}`);
        // Assuming backend wraps data
        return response.data.data;
    } catch (error) {
        console.error(`API Error getting product ${productId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to fetch product details');
        }
        throw new Error('Failed to fetch product details due to an unknown error.');
    }
};

// Create a new product
export const createProduct = async (productData: ProductCreatePayload): Promise<Product> => {
    try {
        const response = await apiClient.post<SingleProductResponse>('/products', productData);
        // Assuming backend returns the created product wrapped in data
        return response.data.data;
    } catch (error) {
        console.error('API Error creating product:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to create product');
        }
        throw new Error('Failed to create product due to an unknown error.');
    }
};

// Update an existing product
export const updateProduct = async (productId: string, productData: ProductUpdatePayload): Promise<Product> => {
    try {
        const response = await apiClient.put<SingleProductResponse>(`/products/${productId}`, productData);
        // Assuming backend returns the updated product wrapped in data
        return response.data.data;
    } catch (error) {
        console.error(`API Error updating product ${productId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to update product');
        }
        throw new Error('Failed to update product due to an unknown error.');
    }
};

// Delete a product
export const deleteProduct = async (productId: string): Promise<GenericSuccessResponse> => {
    try {
        const response = await apiClient.delete<GenericSuccessResponse>(`/products/${productId}`);
        return response.data;
    } catch (error) {
        console.error(`API Error deleting product ${productId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to delete product');
        }
        throw new Error('Failed to delete product due to an unknown error.');
    }
};

// --- Flash Sale API Calls ---

// Interface for the payload expected by the backend createFlashSale service
interface BackendFlashSaleCreatePayload {
    productId: string;
    discountedPrice: number;
    startTime: string | Date; // Use ISO string for API
    endTime: string | Date;   // Use ISO string for API
}

// Interface for the expected response structure from POST /flash-sales
interface CreateFlashSaleResponse {
    success: boolean;
    message: string;
    data: FlashSale; // Now uses imported FlashSale type
}

// Create a new flash sale (targets POST /api/flash-sales)
export const createFlashSale = async (payload: BackendFlashSaleCreatePayload): Promise<FlashSale> => { // Uses imported FlashSale
    log.info(`[API] POST /api/flash-sales called with payload:`, payload);
    try {
        // Ensure dates are ISO strings for backend compatibility
        const apiPayload = {
            ...payload,
            startTime: typeof payload.startTime === 'string' ? payload.startTime : payload.startTime.toISOString(),
            endTime: typeof payload.endTime === 'string' ? payload.endTime : payload.endTime.toISOString(),
        };
        log.debug("[API] Sending payload to POST /flash-sales:", apiPayload);

        const response = await apiClient.post<CreateFlashSaleResponse>('/flash-sales', apiPayload);
        log.info("[API] Response from POST /flash-sales:", response.data);

        // Assuming backend response is { success: true, data: {...createdSale} }
        if (response.data && response.data.success && response.data.data) {
            return response.data.data;
        } else {
            // Handle cases where the backend might not return data as expected
            log.error("[API] Unexpected response structure from POST /flash-sales:", response.data);
            throw new Error(response.data?.message || 'Failed to create flash sale: Unexpected response structure.');
        }
    } catch (error) {
        console.error('[API] Error creating flash sale:', error);
        if (axios.isAxiosError(error) && error.response) {
            log.error("[API] Axios error response data:", error.response.data);
            throw new Error(error.response.data?.message || 'Failed to create flash sale');
        }
        throw new Error('Failed to create flash sale due to an unknown error.');
    }
};

// Delete/Cancel a specific flash sale (targets DELETE /api/flash-sales/admin/:flashSaleId - assuming admin context)
export const deleteFlashSaleById = async (flashSaleId: string): Promise<GenericSuccessResponse> => {
    log.info(`[API] DELETE /api/flash-sales/admin/${flashSaleId} called`);
    try {
        // Using the admin endpoint for deletion
        const response = await apiClient.delete<GenericSuccessResponse>(`/flash-sales/admin/${flashSaleId}`);
        log.info(`[API] Response for deleteFlashSaleById (${flashSaleId}):`, response.data);
        // Assuming backend returns { success: true, message: '...' }
        return response.data;
    } catch (error) {
        console.error(`API Error deleting flash sale ${flashSaleId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || `Failed to delete flash sale ${flashSaleId}`);
        }
        throw new Error(`Failed to delete flash sale ${flashSaleId} due to an unknown error.`);
    }
};

// Fetch flash sales specifically for one product using the admin endpoint
export const getProductFlashSales = async (productId: string): Promise<FlashSale[]> => { // Uses imported FlashSale
    log.info(`[API] Fetching flash sales for product ${productId}`);
    try {
        // Define the expected API response structure for this specific endpoint
        interface GetFlashSalesResponse {
            success: boolean;
            data?: {
                sales: FlashSale[]; // Uses imported FlashSale
                // ... pagination fields if present ...
            };
            message?: string;
        }

        // Use the admin endpoint with a filter for the specific product ID
        const response = await apiClient.get<GetFlashSalesResponse>('/flash-sales/admin', {
            params: { productId: productId, limit: 5 } // Fetch limited results, assume backend supports productId filter
        });
        log.info(`[API] Response for getProductFlashSales (${productId}):`, response.data);

        if (response.data && response.data.success && response.data.data?.sales) {
            return response.data.data.sales; // Return the array of sales (correctly typed)
        } else {
            log.warn(`[API] Unexpected response structure for getProductFlashSales (${productId}):`, response.data);
            return []; // Return empty array if structure is unexpected or no sales found
        }
    } catch (error) {
        console.error(`API Error getting flash sales for product ${productId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || `Failed to fetch flash sales for product ${productId}`);
        }
        throw new Error(`Failed to fetch flash sales for product ${productId} due to an unknown error.`);
    }
};

// Placeholder for getting flash sales for a product (might not be needed if included in getProducts)
// export const getProductFlashSales = async (productId: string): Promise<any> => {
//   console.log(`[API Placeholder] getProductFlashSales called for productId: ${productId}`);
//   await new Promise(resolve => setTimeout(resolve, 500));
//   // Simulate returning an array of flash sales
//   return { success: true, data: [] };
// }; 