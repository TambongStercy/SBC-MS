/**
 * API service for managing withdrawal sub-admins
 */

import apiClient from '../api/apiClient';

export interface SubAdmin {
    _id: string;
    name: string;
    email: string;
    phoneNumber: string;
    role: string;
    blocked: boolean;
    createdAt: string;
}

export interface CreateSubAdminData {
    name: string;
    email: string;
    password: string;
    phoneNumber: string;
    region?: string;
    country?: string;
}

export interface UpdateSubAdminData {
    name?: string;
    email?: string;
    phoneNumber?: string;
    password?: string;
}

/**
 * Get all withdrawal sub-admins
 */
export async function getSubAdmins(page: number = 1, limit: number = 20): Promise<{
    subAdmins: SubAdmin[];
    pagination: {
        currentPage: number;
        totalPages: number;
        totalItems: number;
        itemsPerPage: number;
    };
}> {
    try {
        const response = await apiClient.get('/users/sub-admins', {
            params: { page, limit }
        });

        return response.data.data;
    } catch (error: any) {
        console.error('Error fetching sub-admins:', error);
        throw new Error(error.response?.data?.message || 'Failed to fetch sub-admins');
    }
}

/**
 * Create a new withdrawal sub-admin
 */
export async function createSubAdmin(data: CreateSubAdminData): Promise<SubAdmin> {
    try {
        const response = await apiClient.post('/users/sub-admins', data);
        return response.data.data;
    } catch (error: any) {
        console.error('Error creating sub-admin:', error);
        throw new Error(error.response?.data?.message || 'Failed to create sub-admin');
    }
}

/**
 * Update sub-admin details
 */
export async function updateSubAdmin(id: string, data: UpdateSubAdminData): Promise<SubAdmin> {
    try {
        const response = await apiClient.put(`/users/sub-admins/${id}`, data);
        return response.data.data;
    } catch (error: any) {
        console.error('Error updating sub-admin:', error);
        throw new Error(error.response?.data?.message || 'Failed to update sub-admin');
    }
}

/**
 * Block/Unblock sub-admin
 */
export async function toggleSubAdminBlock(id: string, blocked: boolean): Promise<void> {
    try {
        await apiClient.patch(`/users/sub-admins/${id}/block`, { blocked });
    } catch (error: any) {
        console.error('Error toggling sub-admin block status:', error);
        throw new Error(error.response?.data?.message || 'Failed to update sub-admin status');
    }
}

/**
 * Delete sub-admin
 */
export async function deleteSubAdmin(id: string): Promise<void> {
    try {
        await apiClient.delete(`/users/sub-admins/${id}`);
    } catch (error: any) {
        console.error('Error deleting sub-admin:', error);
        throw new Error(error.response?.data?.message || 'Failed to delete sub-admin');
    }
}
