import axios from 'axios';
import apiClient from '../../api/apiClient';
import type { Product } from '../../pages/ProductsManagementPage';

/**
 * Boutique product list with the admin country + period filters (see
 * usePageFilters); services/adminProductApi.ts getProducts doesn't forward
 * them. product-service semantics: country = the SELLER's, from/to on the
 * product's createdAt. Writes are still called from adminProductApi.
 */
export interface AdminFilterParams { country?: string; from?: string; to?: string }

export interface ProductQuery {
    page?: number;
    limit?: number;
    searchTerm?: string;
    status?: string;
    hasActiveFlashSale?: boolean;
}

export interface ProductPage {
    data: Product[];
    pagination: { currentPage: number; totalPages: number; totalCount: number; limit: number };
}

export async function fetchProducts(q: ProductQuery, f: AdminFilterParams): Promise<ProductPage> {
    const params: Record<string, string | number> = { page: q.page || 1, limit: q.limit || 10 };
    if (q.searchTerm) params.searchTerm = q.searchTerm;
    if (q.status) params.status = q.status;
    if (q.hasActiveFlashSale !== undefined) params.hasActiveFlashSale = String(q.hasActiveFlashSale);
    Object.assign(params, f);
    try {
        const res = await apiClient.get<ProductPage>('/products/admin', { params });
        return res.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) throw new Error(error.response.data?.message || 'Impossible de charger les produits.');
        throw new Error('Impossible de charger les produits.');
    }
}

export const countryOnly = (f: AdminFilterParams): AdminFilterParams => (f.country ? { country: f.country } : {});
