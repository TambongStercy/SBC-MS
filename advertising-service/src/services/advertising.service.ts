import { Types } from 'mongoose';
// import { nanoid } from 'nanoid'; // Removed static import
import { AdPackRepository, adPackRepository } from '../database/repositories/adPack.repository';
import { AdvertisementRepository, advertisementRepository } from '../database/repositories/advertisement.repository';
import { IAdPack } from '../database/models/adPack.model';
import { IAdvertisement, AdStatus } from '../database/models/advertisement.model';
import { paymentService } from './clients/payment.service.client';
import { notificationService } from './clients/notification.service.client';
import { userService } from './clients/user.service.client';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import config from '../config';

const log = logger.getLogger('AdvertisingService');

// Define the structure for the advertisement content
interface AdvertisementContent {
    title?: string;
    text: string;
    imageUrl?: string;
    callToActionUrl?: string;
}

// Interface for Targeting Criteria (copied from model for service layer use)
interface ITargetCriteria {
    regions?: string[];
    minAge?: number;
    maxAge?: number;
    sex?: 'male' | 'female' | 'other';
    interests?: string[];
    professions?: string[];
}

export class AdvertisingService {
    private adPackRepository: AdPackRepository;
    private advertisementRepository: AdvertisementRepository;

    constructor(
        adPackRepository: AdPackRepository,
        advertisementRepository: AdvertisementRepository,
    ) {
        this.adPackRepository = adPackRepository;
        this.advertisementRepository = advertisementRepository;
        log.info('AdvertisingService initialized');
    }

    /**
     * Fetches all currently active AdPacks.
     */
    async getAdPacks(): Promise<IAdPack[]> {
        log.info('Fetching active ad packs');
        try {
            const packs = await this.adPackRepository.findAllActive();
            log.info(`Found ${packs.length} active ad packs`);
            return packs;
        } catch (error: unknown) {
            log.error('Error fetching active ad packs', error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Failed to fetch ad packs', 500);
        }
    }

    /**
     * Initiates the creation and payment process for a new advertisement.
     */
    async createAdvertisement(
        userId: string,
        packId: string,
        content: AdvertisementContent,
        targetCriteria?: ITargetCriteria // Added optional targetCriteria parameter
    ): Promise<{ advertisementId: string; paymentIntentId: string; clientSecret: string | undefined }> {
        log.info(`Creating advertisement request for user ${userId}, pack ${packId}`);
        try {
            // 1. Fetch the AdPack
            const pack = await this.adPackRepository.findById(packId);
            if (!pack) {
                log.warn(`AdPack not found for ID: ${packId}`);
                throw new AppError('Ad pack not found', 404);
            }
            if (!pack.isActive) {
                log.warn(`Attempt to purchase inactive AdPack: ${packId}`);
                throw new AppError('Ad pack is not available for purchase', 400);
            }

            // Check if targeting is allowed for this pack
            if (targetCriteria && !pack.features.targetingOptions) {
                log.warn(`User ${userId} attempted to provide target criteria for pack ${packId} which does not support it.`);
                throw new AppError('The selected ad pack does not support targeting options.', 400);
            }

            // 2. Generate a unique advertisement ID using dynamic import
            const { nanoid } = await import('nanoid'); // Dynamically import nanoid
            const advertisementId = nanoid();
            log.info(`Generated advertisementId: ${advertisementId}`);

            // 3. Create Payment Intent via PaymentServiceClient
            const paymentIntentData = await paymentService.createIntent({
                userId: userId,
                amount: pack.price, // Get amount from the AdPack
                currency: config.currency, // Use configured currency
                paymentType: 'AD_PURCHASE', // Specific type
                metadata: { // Essential metadata for callback
                    userId,
                    packId,
                    advertisementId,
                    originatingService: 'advertising-service', // Identify originating service
                    callbackPath: `${config.selfBaseUrl}/api/advertising/webhooks/payment` // Use full URL
                }
            });
            log.info(`Creating payment intent for advertisement ${advertisementId}`);
            const paymentIntentResponse = paymentIntentData; // Use the returned data

            if (!paymentIntentResponse || !paymentIntentResponse.sessionId) {
                log.error('Failed to get payment session ID from payment service client');
                throw new AppError('Could not initialize payment for the advertisement.', 500);
            }

            log.info(`Payment intent created: ${paymentIntentResponse.sessionId} for advertisement ${advertisementId}`);

            // 4. Create Advertisement record in DB (pending payment)
            const newAdvertisementData: Partial<IAdvertisement> = {
                advertisementId: advertisementId,
                userId: new Types.ObjectId(userId),
                adPackId: new Types.ObjectId(packId),
                content,
                status: AdStatus.PENDING_PAYMENT,
                paymentIntentId: paymentIntentResponse.sessionId,
                isFeatured: pack.features.featuredPlacement,
                hasVerifiedBadge: pack.features.verifiedBadgeEligible,
                targetCriteria: targetCriteria, // Save target criteria if provided
            };
            await this.advertisementRepository.create(newAdvertisementData);
            log.info(`Advertisement record ${advertisementId} created with status PENDING_PAYMENT`);

            // 5. Return payment details to the controller/client
            return {
                advertisementId,
                paymentIntentId: paymentIntentResponse.sessionId,
                clientSecret: paymentIntentResponse.clientSecret,
            };

        } catch (error: unknown) {
            log.error(`Error creating advertisement for user ${userId}, pack ${packId}`, error);
            if (error instanceof AppError) {
                throw error; // Re-throw known operational errors
            }
            // Wrap unknown errors
            throw new AppError('Failed to create advertisement', 500);
        }
    }

    /**
     * Handles successful payment confirmation for an advertisement.
     * Updates Ad status, calculates start/end dates, and triggers notifications.
     */
    async confirmAdPayment(paymentSessionId: string, paymentMetadata: any): Promise<void> {
        log.info(`Confirming Ad payment for session: ${paymentSessionId}`);

        // 1. Validate Metadata and find Ad by paymentIntentId
        const { advertisementId, packId, userId } = paymentMetadata || {}; // Extract expected data
        if (!advertisementId || !packId || !userId) {
            log.error('Ad payment confirmation failed: Missing required metadata.', { paymentSessionId, paymentMetadata });
            throw new AppError('Invalid payment confirmation data.', 400); // Throw error, webhook should retry or log
        }

        const advertisement = await this.advertisementRepository.findByAdvertisementId(advertisementId);

        if (!advertisement || advertisement.status !== AdStatus.PENDING_PAYMENT) {
            log.warn(`Advertisement not found or not pending payment for confirmation.`, {
                advertisementId,
                status: advertisement?.status,
                paymentSessionId
            });
            return;
        }

        if (advertisement.paymentIntentId !== paymentSessionId) {
            log.error('Payment intent ID mismatch during confirmation.', {
                advertisementId: advertisement.advertisementId,
                storedIntentId: advertisement.paymentIntentId,
                webhookIntentId: paymentSessionId
            });
            throw new AppError('Payment confirmation mismatch.', 400);
        }

        // 2. Fetch the corresponding AdPack to get duration
        const adPack = await this.adPackRepository.findById(advertisement.adPackId);
        if (!adPack) {
            log.error(`Critical error: AdPack ${advertisement.adPackId} not found for confirmed Ad ${advertisementId}.`);
            await this.advertisementRepository.findByIdAndUpdate(advertisement._id, { status: AdStatus.PAYMENT_FAILED, rejectionReason: 'Associated AdPack not found' });
            throw new AppError('AdPack data missing for paid advertisement.', 500);
        }

        // 3. Calculate start/end dates
        const now = new Date();
        const startDate = now; // Ad starts immediately upon payment confirmation
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + adPack.features.durationDays);

        // 4. Update Advertisement Status and Dates
        const newStatus = AdStatus.ACTIVE;

        await this.advertisementRepository.findByIdAndUpdate(advertisement._id, {
            status: newStatus,
            startDate: startDate,
            endDate: endDate,
        });

        log.info(`Advertisement ${advertisementId} status updated to ${newStatus}. Start: ${startDate}, End: ${endDate}`);

        // --- 5. Trigger Notifications based on Pack --- 
        this.triggerAdNotifications(advertisement, adPack).catch(err => {
            log.error(`Error triggering notifications for Ad ${advertisementId}:`, err);
        });

        // --- 6. Trigger Affiliate Commission (if applicable) --- 
        this.processAffiliateCommission(userId, adPack).catch(err => {
            log.error(`Error processing affiliate commission for Ad ${advertisementId}:`, err);
        });

    }

    /**
     * Triggers the appropriate notifications based on the Ad and AdPack.
     */
    private async triggerAdNotifications(ad: IAdvertisement, pack: IAdPack): Promise<void> {
        log.info(`Triggering notifications for Ad ${ad.advertisementId} (Pack: ${pack.packId}, Type: ${pack.features.notificationType})`);

        const notificationPayloadBase = {
            type: 'NEW_ADVERTISEMENT',
            channel: 'PUSH', // Default channel, notification service might adjust
            data: {
                title: ad.content.title || 'New Advertisement',
                body: ad.content.text,
                imageUrl: ad.content.imageUrl,
                relatedData: {
                    advertisementId: ad.advertisementId,
                    advertiserId: ad.userId.toString(),
                    callToAction: ad.content.callToActionUrl,
                }
            }
        };

        try {
            switch (pack.features.notificationType) {
                case 'basic':
                    log.debug(`Fetching random users for Basic Ad notification.`);
                    // Fetch slightly more than needed to account for potential exclusions/errors
                    const fetchLimit = (pack.features.reachEstimate || 1000) + 100;
                    const randomUserIds = await userService.getRandomUserIds(fetchLimit);
                    if (randomUserIds && randomUserIds.length > 0) {
                        // Ensure we don't send more than the estimate
                        const finalUserIds = randomUserIds.slice(0, pack.features.reachEstimate || 1000);
                        log.info(`Sending Basic Ad notification to ${finalUserIds.length} users.`);
                        const promises = finalUserIds.map(uid =>
                            notificationService.createInternalNotification({ ...notificationPayloadBase, userId: uid })
                        );
                        await Promise.allSettled(promises);
                    } else {
                        log.warn('Could not fetch random users for Basic Ad notification.');
                    }
                    break;
                case 'all':
                    log.info(`Initiating notification to all users for Ad ${ad.advertisementId}.`);
                    // This requires a dedicated endpoint/method in the notification service
                    // or publishing a message to a topic that triggers notifications for all users.
                    // Example: Direct call to notification service (assuming it supports broadcast)
                    try {
                        await notificationService.createBroadcastNotification({
                            ...notificationPayloadBase,
                            // Remove userId if it's not needed for broadcast type
                            excludeUserId: ad.userId.toString() // Optionally exclude the advertiser
                        });
                        log.info(`Successfully requested broadcast notification for Ad ${ad.advertisementId}`);
                    } catch (broadcastError) {
                        log.error(`Failed to initiate broadcast notification for Ad ${ad.advertisementId}:`, broadcastError);
                    }
                    break;
                case 'targeted':
                    log.info(`Initiating targeted notification for Ad ${ad.advertisementId}.`);
                    if (!ad.targetCriteria) {
                        log.warn(`Targeted notification requested for Ad ${ad.advertisementId}, but no targetCriteria found. Skipping.`);
                        break;
                    }
                    try {
                        log.debug('Fetching targeted users based on criteria:', ad.targetCriteria);
                        // Query user service based on targetCriteria
                        // The userService client needs a method like findUsersByCriteria
                        const targetedUserIds = await userService.findUsersByCriteria(ad.targetCriteria);

                        if (targetedUserIds && targetedUserIds.length > 0) {
                            log.info(`Sending Targeted Ad notification to ${targetedUserIds.length} users.`);
                            const promises = targetedUserIds
                                .filter((uid: string) => uid !== ad.userId.toString()) // Exclude the advertiser
                                .map((uid: string) =>
                                    notificationService.createInternalNotification({ ...notificationPayloadBase, userId: uid })
                                );
                            await Promise.allSettled(promises);
                        } else {
                            log.info(`No users found matching target criteria for Ad ${ad.advertisementId}.`);
                        }
                    } catch (targetError) {
                        log.error(`Error fetching or notifying targeted users for Ad ${ad.advertisementId}:`, targetError);
                    }
                    break;
                default:
                    log.warn(`Unknown notification type for Ad ${ad.advertisementId}: ${pack.features.notificationType}`);
            }
        } catch (error) {
            log.error(`Error during ad notification dispatch for Ad ${ad.advertisementId}:`, error);
        }
    }

    /**
     * Checks for and processes direct affiliate commission for an ad pack purchase.
     */
    private async processAffiliateCommission(buyerUserId: string, adPack: IAdPack): Promise<void> {
        log.debug(`Checking for affiliate commission for user ${buyerUserId}, pack ${adPack.packId}`);
        try {
            // 1. Get direct referrer ID from user service
            const referrerInfo = await userService.getAffiliator(buyerUserId);

            if (referrerInfo && referrerInfo.referrerId) {
                const referrerId = referrerInfo.referrerId;
                // 2. Calculate 15% commission
                const commissionAmount = adPack.price * 0.15;
                log.info(`Referrer ${referrerId} found for buyer ${buyerUserId}. Awarding commission of ${commissionAmount} ${config.currency}.`);

                // 3. Record commission deposit via payment service
                try {
                    const description = `15% commission from AdPack (${adPack.packId}) purchase by user ${buyerUserId}`;
                    const commissionMetadata = {
                        commissionLevel: 1, // Direct referral
                        source: 'AD_PACK_PURCHASE',
                        sourceUserId: buyerUserId,
                        sourcePackId: adPack.packId,
                        sourcePackPrice: adPack.price
                    };
                    await paymentService.recordInternalDeposit({
                        userId: referrerId,
                        amount: commissionAmount,
                        currency: config.currency,
                        description: description,
                        metadata: commissionMetadata
                    });
                    log.info(`Successfully recorded commission deposit transaction for referrer ${referrerId}.`);
                } catch (depositError) {
                    log.error(`Failed to record commission deposit transaction for referrer ${referrerId}:`, depositError);
                    // Decide if this error should be critical or just logged
                }
            } else {
                log.info(`No direct referrer found for user ${buyerUserId}. No commission awarded.`);
            }
        } catch (error) {
            log.error(`Error processing affiliate commission for user ${buyerUserId}, pack ${adPack.packId}:`, error);
        }
    }

    /**
     * Updates the content of an existing advertisement.
     * Only allows updates for ads in certain statuses (e.g., ACTIVE, PAUSED).
     * Ensures the user owns the advertisement.
     */
    async updateAdvertisementContent(
        userId: string,
        advertisementId: string,
        newContent: AdvertisementContent
    ): Promise<IAdvertisement> {
        log.info(`User ${userId} attempting to update content for Ad ${advertisementId}`);

        // 1. Fetch the advertisement by its unique ID
        const advertisement = await this.advertisementRepository.findByAdvertisementId(advertisementId);

        if (!advertisement) {
            log.warn(`Update failed: Advertisement ${advertisementId} not found.`);
            throw new AppError('Advertisement not found', 404);
        }

        // 2. Authorization Check: Ensure the user owns this ad
        if (advertisement.userId.toString() !== userId) {
            log.warn(`Authorization failed: User ${userId} attempted to update Ad ${advertisementId} owned by ${advertisement.userId}.`);
            throw new AppError('You are not authorized to update this advertisement', 403);
        }

        // 3. Status Check: Only allow updates for ads in modifiable states
        const allowedUpdateStatuses = [AdStatus.ACTIVE, AdStatus.PAUSED];
        if (!allowedUpdateStatuses.includes(advertisement.status)) {
            log.warn(`Update failed: Advertisement ${advertisementId} is in status ${advertisement.status}, which cannot be updated.`);
            throw new AppError(`Advertisement cannot be updated in its current status (${advertisement.status}).`, 400);
        }

        // 4. Perform the update
        try {
            // Use the repository method that updates by the unique advertisementId
            const updatedAd = await this.advertisementRepository.findByAdvertisementIdAndUpdate(
                advertisementId,
                { $set: { content: newContent } }
            );

            if (!updatedAd) {
                // Should not happen if the findByAdvertisementId succeeded, but handle defensively
                log.error(`Update failed unexpectedly after finding Ad ${advertisementId}.`);
                throw new AppError('Failed to update advertisement after finding it.', 500);
            }

            log.info(`Successfully updated content for Ad ${advertisementId} by user ${userId}.`);
            return updatedAd;
        } catch (error) {
            log.error(`Error updating content for Ad ${advertisementId}:`, error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Failed to update advertisement content.', 500);
        }
    }

    // TODO: Add methods for getAdvertisements, updateAdvertisement, getAdsForDisplay
}

export const advertisingService = new AdvertisingService(adPackRepository, advertisementRepository); 