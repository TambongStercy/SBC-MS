import apiClient from './apiClient';

// Fetch All Products (Admin)
export const fetchAllProducts = async (page: number = 1, limit: number = 10, filters?: any) => {
    const response = await apiClient.get('/products', {
        params: {
            page,
            limit,
            ...filters
        }
    });
    return response.data;
};

// Fetch Products for a User
export const fetchUserProducts = async (userId: string, page: number = 1, limit: number = 10) => {
    const response = await apiClient.get(`/users/${userId}/products`, {
        params: { page, limit }
    });
    return response.data;
};

// Get Product Details
export const getProductDetails = async (productId: string) => {
    const response = await apiClient.get(`/products/${productId}`);
    return response.data;
};

// Add Product
export const addProduct = async (userId: string, productData: any, images: File[]) => {
    const formData = new FormData();
    formData.append('name', productData.name);
    formData.append('category', productData.category);
    formData.append('price', productData.price.toString());
    if (productData.description) {
        formData.append('description', productData.description);
    }

    images.forEach(image => formData.append('images', image));

    const response = await apiClient.post(`/users/${userId}/products`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

// Modify Product
export const modifyProduct = async (userId: string, productId: string, productData: any, images?: File[]) => {
    const formData = new FormData();
    formData.append('name', productData.name);
    if (productData.category) {
        formData.append('category', productData.category);
    }
    if (productData.price) {
        formData.append('price', productData.price.toString());
    }
    if (productData.description) {
        formData.append('description', productData.description);
    }

    if (images && images.length > 0) {
        images.forEach(image => formData.append('images', image));
    }

    const response = await apiClient.put(`/products/${productId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

// Delete Product
export const deleteProduct = async (productId: string) => {
    const response = await apiClient.delete(`/products/${productId}`);
    return response.data;
};

// Approve Product
export const approveProduct = async (productId: string) => {
    const response = await apiClient.patch(`/products/${productId}/approve`);
    return response.data;
};

// Reject Product
export const rejectProduct = async (productId: string, reason: string) => {
    const response = await apiClient.patch(`/products/${productId}/reject`, { reason });
    return response.data;
};

// Fetch Flash Sales
export const fetchFlashSales = async (page: number = 1, limit: number = 10, status?: string) => {
    const params: any = { page, limit };
    if (status) {
        params.status = status;
    }
    const response = await apiClient.get('/flash-sales', { params });
    return response.data;
};

// Get Flash Sale Details
export const getFlashSaleDetails = async (flashSaleId: string) => {
    const response = await apiClient.get(`/flash-sales/${flashSaleId}`);
    return response.data;
};

// Approve Flash Sale
export const approveFlashSale = async (flashSaleId: string) => {
    const response = await apiClient.patch(`/flash-sales/${flashSaleId}/approve`);
    return response.data;
};

// Reject Flash Sale
export const rejectFlashSale = async (flashSaleId: string, reason: string) => {
    const response = await apiClient.patch(`/flash-sales/${flashSaleId}/reject`, { reason });
    return response.data;
};
