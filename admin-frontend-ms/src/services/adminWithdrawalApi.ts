import apiClient from '../api/apiClient';
import { AxiosError } from 'axios';

// --- Enums matching backend ---

export enum TransactionStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
    REFUNDED = 'refunded',
    PROCESSING = 'processing',
    PENDING_OTP_VERIFICATION = 'pending_otp_verification',
    PENDING_ADMIN_APPROVAL = 'pending_admin_approval',
    REJECTED_BY_ADMIN = 'rejected_by_admin'
}

export enum TransactionType {
    DEPOSIT = 'deposit',
    WITHDRAWAL = 'withdrawal',
    TRANSFER = 'transfer',
    PAYMENT = 'payment',
    REFUND = 'refund',
    FEE = 'fee',
    CONVERSION = 'conversion'
}

export enum Currency {
    XAF = 'XAF',
    XOF = 'XOF',
    USD = 'USD',
    EUR = 'EUR',
    GBP = 'GBP',
    BTC = 'BTC',
    ETH = 'ETH',
    USDT = 'USDT',
    USDC = 'USDC'
}

// --- Interfaces ---

export interface WithdrawalAccountInfo {
    fullMomoNumber: string;
    momoOperator: string;
    countryCode: string;
    recipientName?: string;
    recipientEmail?: string;
}

export interface CryptoAccountInfo {
    cryptoAddress: string;
    cryptoCurrency: string;
    usdAmount: number;
}

export interface WithdrawalMetadata {
    withdrawalType?: 'mobile_money' | 'crypto';
    accountInfo?: WithdrawalAccountInfo;
    cryptoAddress?: string;
    cryptoCurrency?: string;
    usdAmount?: number;
    statusDetails?: string;
    netAmountRequested?: number;
    payoutCurrency?: string;
    approvalStatus?: 'approved' | 'rejected';
    approvedByAdmin?: string;
    rejectedByAdmin?: string;
    refundedAmount?: number;
    [key: string]: any;
}

export interface WithdrawalTransaction {
    _id: string;
    transactionId: string;
    userId: string;
    type: TransactionType;
    amount: number;
    currency: Currency;
    fee: number;
    status: TransactionStatus;
    description: string;
    metadata?: WithdrawalMetadata;

    // Admin approval fields
    approvedBy?: string;
    approvedAt?: string;
    rejectedBy?: string;
    rejectedAt?: string;
    rejectionReason?: string;
    adminNotes?: string;

    createdAt: string;
    updatedAt: string;

    // Enriched fields (from user service)
    userName?: string;
    userEmail?: string;
    userPhoneNumber?: string;
    userBalance?: { [key: string]: number };
}

export interface WithdrawalStats {
    pendingApproval: number;
    approvedToday: number;
    rejectedToday: number;
    processing: number;
}

export interface PendingWithdrawalsResponse {
    success: boolean;
    data: {
        withdrawals: WithdrawalTransaction[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    };
}

export interface WithdrawalDetailsResponse {
    success: boolean;
    data: WithdrawalTransaction;
}

export interface WithdrawalStatsResponse {
    success: boolean;
    data: WithdrawalStats;
}

export interface ApproveWithdrawalRequest {
    adminNotes?: string;
}

export interface RejectWithdrawalRequest {
    rejectionReason: string;
    adminNotes?: string;
}

export interface BulkApproveRequest {
    transactionIds: string[];
    adminNotes?: string;
}

export interface BulkApproveResponse {
    success: boolean;
    message: string;
    data: {
        approved: number;
        failed: number;
        errors: string[];
    };
}

export interface ApiResponse<T = any> {
    success: boolean;
    message?: string;
    data?: T;
    error?: string;
}

// --- API Functions ---

/**
 * Get pending withdrawals awaiting admin approval
 */
export async function getPendingWithdrawals(
    page: number = 1,
    limit: number = 20,
    withdrawalType?: 'mobile_money' | 'crypto'
): Promise<PendingWithdrawalsResponse> {
    try {
        const params: any = { page, limit };
        if (withdrawalType) {
            params.withdrawalType = withdrawalType;
        }

        const response = await apiClient.get<PendingWithdrawalsResponse>(
            '/payments/admin/withdrawals/pending',
            { params }
        );
        return response.data;
    } catch (error) {
        console.error('Error fetching pending withdrawals:', error);
        const axiosError = error as AxiosError<ApiResponse>;
        throw new Error(
            axiosError.response?.data?.message ||
            axiosError.response?.data?.error ||
            'Failed to fetch pending withdrawals'
        );
    }
}

/**
 * Get withdrawal statistics for dashboard
 */
export async function getWithdrawalStats(): Promise<WithdrawalStatsResponse> {
    try {
        const response = await apiClient.get<WithdrawalStatsResponse>(
            '/payments/admin/withdrawals/stats'
        );
        return response.data;
    } catch (error) {
        console.error('Error fetching withdrawal stats:', error);
        const axiosError = error as AxiosError<ApiResponse>;
        throw new Error(
            axiosError.response?.data?.message ||
            axiosError.response?.data?.error ||
            'Failed to fetch withdrawal statistics'
        );
    }
}

/**
 * Get withdrawal details by transaction ID
 */
export async function getWithdrawalDetails(transactionId: string): Promise<WithdrawalDetailsResponse> {
    try {
        const response = await apiClient.get<WithdrawalDetailsResponse>(
            `/payments/admin/withdrawals/${transactionId}`
        );
        return response.data;
    } catch (error) {
        console.error('Error fetching withdrawal details:', error);
        const axiosError = error as AxiosError<ApiResponse>;
        throw new Error(
            axiosError.response?.data?.message ||
            axiosError.response?.data?.error ||
            'Failed to fetch withdrawal details'
        );
    }
}

/**
 * Approve a withdrawal
 */
export async function approveWithdrawal(
    transactionId: string,
    request: ApproveWithdrawalRequest = {}
): Promise<ApiResponse<WithdrawalTransaction>> {
    try {
        const response = await apiClient.post<ApiResponse<WithdrawalTransaction>>(
            `/payments/admin/withdrawals/${transactionId}/approve`,
            request
        );
        return response.data;
    } catch (error) {
        console.error('Error approving withdrawal:', error);
        const axiosError = error as AxiosError<ApiResponse>;
        throw new Error(
            axiosError.response?.data?.message ||
            axiosError.response?.data?.error ||
            'Failed to approve withdrawal'
        );
    }
}

/**
 * Reject a withdrawal
 */
export async function rejectWithdrawal(
    transactionId: string,
    request: RejectWithdrawalRequest
): Promise<ApiResponse<WithdrawalTransaction>> {
    try {
        const response = await apiClient.post<ApiResponse<WithdrawalTransaction>>(
            `/payments/admin/withdrawals/${transactionId}/reject`,
            request
        );
        return response.data;
    } catch (error) {
        console.error('Error rejecting withdrawal:', error);
        const axiosError = error as AxiosError<ApiResponse>;
        throw new Error(
            axiosError.response?.data?.message ||
            axiosError.response?.data?.error ||
            'Failed to reject withdrawal'
        );
    }
}

/**
 * Bulk approve multiple withdrawals
 */
export async function bulkApproveWithdrawals(
    request: BulkApproveRequest
): Promise<BulkApproveResponse> {
    try {
        const response = await apiClient.post<BulkApproveResponse>(
            '/payments/admin/withdrawals/bulk-approve',
            request
        );
        return response.data;
    } catch (error) {
        console.error('Error bulk approving withdrawals:', error);
        const axiosError = error as AxiosError<ApiResponse>;
        throw new Error(
            axiosError.response?.data?.message ||
            axiosError.response?.data?.error ||
            'Failed to bulk approve withdrawals'
        );
    }
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number, currency: Currency): string {
    const formatter = new Intl.NumberFormat('fr-FR', {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    const formatted = formatter.format(amount);

    switch (currency) {
        case Currency.XAF:
        case Currency.XOF:
            return `${formatted} FCFA`;
        case Currency.USD:
            return `$${formatted}`;
        case Currency.EUR:
            return `€${formatted}`;
        case Currency.GBP:
            return `£${formatted}`;
        default:
            return `${formatted} ${currency}`;
    }
}

/**
 * Get status badge color
 */
export function getStatusColor(status: TransactionStatus): string {
    switch (status) {
        case TransactionStatus.PENDING_ADMIN_APPROVAL:
            return 'bg-yellow-100 text-yellow-800';
        case TransactionStatus.PROCESSING:
            return 'bg-blue-100 text-blue-800';
        case TransactionStatus.COMPLETED:
            return 'bg-green-100 text-green-800';
        case TransactionStatus.FAILED:
        case TransactionStatus.REJECTED_BY_ADMIN:
            return 'bg-red-100 text-red-800';
        case TransactionStatus.PENDING:
        case TransactionStatus.PENDING_OTP_VERIFICATION:
            return 'bg-gray-100 text-gray-800';
        default:
            return 'bg-gray-100 text-gray-800';
    }
}

/**
 * Get status label
 */
export function getStatusLabel(status: TransactionStatus): string {
    switch (status) {
        case TransactionStatus.PENDING_ADMIN_APPROVAL:
            return 'Pending Approval';
        case TransactionStatus.PENDING_OTP_VERIFICATION:
            return 'Pending OTP';
        case TransactionStatus.PROCESSING:
            return 'Processing';
        case TransactionStatus.COMPLETED:
            return 'Completed';
        case TransactionStatus.FAILED:
            return 'Failed';
        case TransactionStatus.REJECTED_BY_ADMIN:
            return 'Rejected';
        case TransactionStatus.CANCELLED:
            return 'Cancelled';
        case TransactionStatus.REFUNDED:
            return 'Refunded';
        case TransactionStatus.PENDING:
            return 'Pending';
        default:
            return status;
    }
}

/**
 * Format date
 */
export function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}
