import apiClient from '../../../api/apiClient';
import type { Tone } from '../../../ui';

/**
 * product-service, admin side. Members list their products in the Boutique;
 * a flash sale is a time-boxed lower price on one product.
 *
 * Product `status` (pending / approved / rejected) is not shown: the member app
 * lists products whatever their status, so it changes nothing for anyone.
 */

export interface Product {
    _id: string;
    userId: string;
    name: string;
    category: string;
    subcategory?: string;
    description: string;
    images: Array<{ url: string; fileId: string }>;
    price: number;
    overallRating?: number;
    ratings?: string[];
    deleted?: boolean;
    deletedAt?: string;
    hasActiveFlashSale?: boolean;
    createdAt: string;
}
export type View = 'online' | 'removed' | 'all';
export const listProducts = async (p: { page: number; limit: number; searchTerm?: string; userId?: string; view: View; flash?: boolean }):
    Promise<{ data: Product[]; pagination: { totalCount: number; totalPages: number; currentPage: number } }> =>
    (await apiClient.get('/products/admin', {
        params: {
            page: p.page, limit: p.limit, searchTerm: p.searchTerm || undefined, userId: p.userId || undefined,
            // The service lists live products when no status is given; 'deleted' and 'all' are its own words.
            status: p.view === 'removed' ? 'deleted' : p.view === 'all' ? 'all' : undefined,
            hasActiveFlashSale: p.flash ? 'true' : undefined,
        },
    })).data;
export const getProduct = async (id: string): Promise<Product> => (await apiClient.get(`/products/${id}`)).data.data;
export const updateProduct = (id: string, data: Pick<Product, 'name' | 'price' | 'category' | 'subcategory' | 'description'>) => apiClient.put(`/products/${id}`, data);
export const removeProduct = async (id: string): Promise<{ flashSalesCancelled: number }> => (await apiClient.delete(`/products/admin/${id}`)).data;
export const restoreProduct = (id: string) => apiClient.patch(`/products/admin/${id}/restore`);

export type FlashStatus = 'pending_payment' | 'scheduled' | 'active' | 'expired' | 'cancelled' | 'payment_failed';
export interface FlashSale {
    _id: string;
    productId: string;
    sellerUserId: string;
    originalPrice: number;
    discountedPrice: number;
    startTime: string;
    endTime: string;
    status: FlashStatus;
    viewCount?: number;
    whatsappClickCount?: number;
    createdAt: string;
}
export const listFlashSales = async (p: { page: number; limit: number; status?: FlashStatus | ''; productId?: string }):
    Promise<{ sales: FlashSale[]; totalCount: number; totalPages: number; page: number }> =>
    (await apiClient.get('/flash-sales/admin', { params: { page: p.page, limit: p.limit, ...(p.status ? { status: p.status } : {}), ...(p.productId ? { productId: p.productId } : {}) } })).data.data;
export const createFlashSale = (d: { productId: string; discountedPrice: number; startTime: string; endTime: string }) => apiClient.post('/flash-sales', d);
export const cancelFlashSale = (id: string) => apiClient.delete(`/flash-sales/admin/${id}`);

export const FLASH_STATUS: Record<FlashStatus, [string, Tone]> = {
    pending_payment: ['Frais non payés', 'warning'],
    scheduled: ['Programmée', 'primary'],
    active: ['En cours', 'success'],
    expired: ['Terminée', 'neutral'],
    cancelled: ['Annulée', 'neutral'],
    payment_failed: ['Paiement échoué', 'danger'],
};
export const LIVE_FLASH: FlashStatus[] = ['pending_payment', 'scheduled', 'active'];

/** A capitalised category for display; the service stores them lowercase. */
export const categoryLabel = (c?: string) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : '—');
