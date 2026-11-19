/**
 * Admin team and per-module access (user-service admin-access.controller).
 * - GET /users/admin/me/access: the signed-in account's own access (any admin account).
 * - /users/admin/staff*: the team, super admin only.
 */
import axios from 'axios';
import apiClient from '../api/apiClient';
import { sanitizePermissions, type AdminModule, type Permissions } from '../lib/permissions';

export interface MyAccess {
    role: string;
    permissions: Permissions;
    modules: AdminModule[];
}

export interface StaffMember {
    _id: string;
    name: string;
    email: string;
    phoneNumber?: string | number;
    avatar?: string;
    role: string;
    blocked: boolean;
    /** Effective rights (the super admin has every module in write). */
    permissions: Permissions;
    updatedAt?: string;
    /** Authenticator app (admin sign-in). */
    security?: AccountSecurity;
}

export interface AccountSecurity {
    authenticator: boolean;
    backupCodesLeft: number;
    lastLoginAt: string | null;
    locked: boolean;
}

export interface StaffList {
    staff: StaffMember[];
    /** Modules a staff account can be given. */
    modules: AdminModule[];
}

interface Envelope<T> { success: boolean; data: T; message?: string }

/** The server's French message when there is one. */
export function apiErrorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
        const message = (error.response?.data as { message?: unknown } | undefined)?.message;
        if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
}

const toMember = (raw: StaffMember): StaffMember => ({ ...raw, blocked: !!raw.blocked, permissions: sanitizePermissions(raw.permissions) });

export async function getMyAccess(): Promise<MyAccess> {
    const res = await apiClient.get<Envelope<MyAccess>>('/users/admin/me/access');
    const data = res.data.data;
    return { role: data.role, permissions: sanitizePermissions(data.permissions), modules: data.modules ?? [] };
}

export async function listStaff(): Promise<StaffList> {
    const res = await apiClient.get<Envelope<StaffList>>('/users/admin/staff');
    return { staff: (res.data.data.staff ?? []).map(toMember), modules: res.data.data.modules ?? [] };
}

/** Makes the member a `staff` account with exactly these rights (or changes them). */
export async function setStaffAccess(userId: string, permissions: Permissions): Promise<StaffMember> {
    const res = await apiClient.put<Envelope<StaffMember>>(`/users/admin/staff/${userId}`, { permissions });
    return toMember(res.data.data);
}

/** Takes every admin right away: the account becomes a member again. */
export async function revokeStaff(userId: string): Promise<void> {
    await apiClient.delete(`/users/admin/staff/${userId}`);
}

/** The signed-in account's own authenticator state. */
export async function getMySecurity(): Promise<AccountSecurity> {
    const res = await apiClient.get<Envelope<AccountSecurity>>('/users/admin/me/security');
    return res.data.data;
}

/** New backup codes (the old ones stop working); needs a current authenticator code. */
export async function regenerateBackupCodes(code: string): Promise<string[]> {
    const res = await apiClient.post<Envelope<{ backupCodes: string[] }>>('/users/admin/me/backup-codes', { code });
    return res.data.data.backupCodes;
}

/** Super admin, lost phone: removes the account's authenticator and ends its sessions. */
export async function resetAuthenticator(userId: string): Promise<{ sessionsEnded: number }> {
    const res = await apiClient.post<Envelope<{ sessionsEnded: number }>>(`/users/admin/staff/${userId}/reset-authenticator`);
    return res.data.data;
}
