import { GatewayBalanceModel, GatewayBalanceHistoryModel, IGatewayBalance, IGatewayBalanceHistory } from '../database/models/gateway-balance.model';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';

const log = logger.getLogger('GatewayBalanceService');

export interface GatewayBalanceInput {
    nowpaymentsBalanceUSD: number;
    feexpayBalanceXAF: number;
    cinetpayBalanceXAF: number;
    notes?: string;
}

export interface GatewayBalanceResponse {
    nowpaymentsBalanceUSD: number;
    feexpayBalanceXAF: number;
    cinetpayBalanceXAF: number;
    totalExternalBalanceXAF: number;  // Converted total in XAF
    lastUpdatedBy?: string;
    lastUpdatedAt?: Date;
    notes?: string;
}

// USD to XAF conversion rate (approximate - should be configurable)
const USD_TO_XAF_RATE = 600;

class GatewayBalanceService {

    /**
     * Get current gateway balances
     */
    async getGatewayBalances(): Promise<GatewayBalanceResponse> {
        try {
            // There should be only one document (singleton pattern)
            let balance = await GatewayBalanceModel.findOne().lean().exec();

            if (!balance) {
                // Return default values if no balance has been set
                return {
                    nowpaymentsBalanceUSD: 0,
                    feexpayBalanceXAF: 0,
                    cinetpayBalanceXAF: 0,
                    totalExternalBalanceXAF: 0,
                };
            }

            // Calculate total in XAF
            const usdInXAF = balance.nowpaymentsBalanceUSD * USD_TO_XAF_RATE;
            const totalExternalBalanceXAF = usdInXAF + balance.feexpayBalanceXAF + balance.cinetpayBalanceXAF;

            return {
                nowpaymentsBalanceUSD: balance.nowpaymentsBalanceUSD,
                feexpayBalanceXAF: balance.feexpayBalanceXAF,
                cinetpayBalanceXAF: balance.cinetpayBalanceXAF,
                totalExternalBalanceXAF,
                lastUpdatedBy: balance.lastUpdatedBy?.toString(),
                lastUpdatedAt: balance.updatedAt,
                notes: balance.notes,
            };
        } catch (error) {
            log.error('Error fetching gateway balances:', error);
            throw new AppError('Failed to fetch gateway balances', 500);
        }
    }

    /**
     * Update gateway balances (upsert - creates if not exists)
     */
    async updateGatewayBalances(input: GatewayBalanceInput, adminUserId: string): Promise<GatewayBalanceResponse> {
        try {
            // Validate input
            if (input.nowpaymentsBalanceUSD < 0 || input.feexpayBalanceXAF < 0 || input.cinetpayBalanceXAF < 0) {
                throw new AppError('Balance values cannot be negative', 400);
            }

            // Get current balance for history
            const currentBalance = await GatewayBalanceModel.findOne().lean().exec();

            // Save to history if there was a previous balance
            if (currentBalance) {
                await GatewayBalanceHistoryModel.create({
                    nowpaymentsBalanceUSD: currentBalance.nowpaymentsBalanceUSD,
                    feexpayBalanceXAF: currentBalance.feexpayBalanceXAF,
                    cinetpayBalanceXAF: currentBalance.cinetpayBalanceXAF,
                    updatedBy: currentBalance.lastUpdatedBy,
                    notes: currentBalance.notes,
                });
                log.info('Saved previous gateway balance to history');
            }

            // Upsert the balance
            const updatedBalance = await GatewayBalanceModel.findOneAndUpdate(
                {},
                {
                    nowpaymentsBalanceUSD: input.nowpaymentsBalanceUSD,
                    feexpayBalanceXAF: input.feexpayBalanceXAF,
                    cinetpayBalanceXAF: input.cinetpayBalanceXAF,
                    lastUpdatedBy: adminUserId,
                    notes: input.notes,
                },
                {
                    new: true,
                    upsert: true,
                    runValidators: true,
                }
            ).lean().exec();

            if (!updatedBalance) {
                throw new AppError('Failed to update gateway balances', 500);
            }

            // Calculate total in XAF
            const usdInXAF = updatedBalance.nowpaymentsBalanceUSD * USD_TO_XAF_RATE;
            const totalExternalBalanceXAF = usdInXAF + updatedBalance.feexpayBalanceXAF + updatedBalance.cinetpayBalanceXAF;

            log.info(`Gateway balances updated by admin ${adminUserId}: NOWPayments=$${input.nowpaymentsBalanceUSD}, FeexPay=${input.feexpayBalanceXAF} XAF, CinetPay=${input.cinetpayBalanceXAF} XAF`);

            return {
                nowpaymentsBalanceUSD: updatedBalance.nowpaymentsBalanceUSD,
                feexpayBalanceXAF: updatedBalance.feexpayBalanceXAF,
                cinetpayBalanceXAF: updatedBalance.cinetpayBalanceXAF,
                totalExternalBalanceXAF,
                lastUpdatedBy: updatedBalance.lastUpdatedBy?.toString(),
                lastUpdatedAt: updatedBalance.updatedAt,
                notes: updatedBalance.notes,
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            log.error('Error updating gateway balances:', error);
            throw new AppError('Failed to update gateway balances', 500);
        }
    }

    /**
     * Get gateway balance history for auditing
     */
    async getBalanceHistory(limit: number = 50): Promise<IGatewayBalanceHistory[]> {
        try {
            const history = await GatewayBalanceHistoryModel
                .find()
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean()
                .exec();

            return history;
        } catch (error) {
            log.error('Error fetching gateway balance history:', error);
            throw new AppError('Failed to fetch balance history', 500);
        }
    }

    /**
     * Calculate app revenue
     * Revenue = External Gateway Balances - User Liabilities (what we owe users)
     */
    async calculateAppRevenue(totalUserBalanceXAF: number, totalUserBalanceUSD: number): Promise<{
        externalBalances: GatewayBalanceResponse;
        userLiabilities: {
            totalUserBalanceXAF: number;
            totalUserBalanceUSD: number;
            totalLiabilitiesXAF: number;
        };
        appRevenue: {
            revenueXAF: number;
            revenueUSD: number;  // Approximate
        };
    }> {
        const externalBalances = await this.getGatewayBalances();

        // Convert user USD balance to XAF for comparison
        const userUsdInXAF = totalUserBalanceUSD * USD_TO_XAF_RATE;
        const totalLiabilitiesXAF = totalUserBalanceXAF + userUsdInXAF;

        // Revenue = What we have - What we owe
        const revenueXAF = externalBalances.totalExternalBalanceXAF - totalLiabilitiesXAF;
        const revenueUSD = revenueXAF / USD_TO_XAF_RATE;

        return {
            externalBalances,
            userLiabilities: {
                totalUserBalanceXAF,
                totalUserBalanceUSD,
                totalLiabilitiesXAF,
            },
            appRevenue: {
                revenueXAF,
                revenueUSD,
            },
        };
    }
}

export const gatewayBalanceService = new GatewayBalanceService();
