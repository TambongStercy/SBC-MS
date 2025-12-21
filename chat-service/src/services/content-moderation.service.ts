import axios, { AxiosInstance } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { nsfwModerationService } from './nsfw-moderation.service';

const log = logger.getLogger('ContentModerationService');

export interface ModerationResult {
    isAppropriate: boolean;
    reason?: string;
    details?: {
        nudity?: number;
        suggestive?: number;
        violence?: number;
        drugs?: number;
        alcohol?: number;
        gore?: number;
    };
    action: 'allow' | 'warn' | 'block';
}

export interface ImageModerationOptions {
    url?: string;
    base64?: string;
    checkNudity?: boolean;
    checkViolence?: boolean;
    checkDrugs?: boolean;
}

/**
 * Content Moderation Service
 * Detects inappropriate content in images and videos
 *
 * Supported Services:
 * - Sightengine (default, cost-effective)
 * - Google Cloud Vision API (alternative)
 * - AWS Rekognition (alternative)
 */
class ContentModerationService {
    private apiClient: AxiosInstance | null = null;
    private isEnabled: boolean;

    constructor() {
        this.isEnabled = config.moderation.enabled;

        if (this.isEnabled) {
            if (config.moderation.provider === 'sightengine') {
                this.initSightengine();
            } else if (config.moderation.provider === 'google-vision') {
                this.initGoogleVision();
            } else if (config.moderation.provider === 'nsfwjs') {
                this.initNSFWJS();
            }
        } else {
            log.warn('Content moderation is DISABLED. All content will be allowed.');
        }
    }

    /**
     * Initialize Sightengine API client
     */
    private initSightengine(): void {
        if (!config.moderation.sightengine?.apiUser || !config.moderation.sightengine?.apiSecret) {
            log.error('Sightengine credentials not configured. Moderation will be disabled.');
            this.isEnabled = false;
            return;
        }

        this.apiClient = axios.create({
            baseURL: 'https://api.sightengine.com/1.0',
            timeout: 30000
        });

        log.info('Sightengine content moderation initialized');
    }

    /**
     * Initialize Google Cloud Vision API client
     */
    private initGoogleVision(): void {
        // TODO: Initialize Google Cloud Vision
        log.info('Google Cloud Vision content moderation initialized');
    }

    /**
     * Initialize NSFW.js (TensorFlow.js) for local moderation
     */
    private async initNSFWJS(): Promise<void> {
        const isAvailable = await nsfwModerationService.healthCheck();
        if (isAvailable) {
            log.info('NSFW.js content moderation initialized (local, self-hosted)');
        } else {
            log.error('NSFW.js not available. Install @tensorflow/tfjs-node or deploy as separate service.');
            this.isEnabled = false;
        }
    }

    /**
     * Moderate image content
     */
    async moderateImage(imageUrl: string): Promise<ModerationResult> {
        if (!this.isEnabled) {
            return {
                isAppropriate: true,
                action: 'allow'
            };
        }

        try {
            if (config.moderation.provider === 'sightengine') {
                return await this.moderateImageSightengine(imageUrl);
            } else if (config.moderation.provider === 'google-vision') {
                return await this.moderateImageGoogleVision(imageUrl);
            } else if (config.moderation.provider === 'nsfwjs') {
                return await nsfwModerationService.classifyImage(imageUrl);
            }

            // Fallback: allow if no provider configured
            log.warn('No moderation provider configured, allowing content');
            return {
                isAppropriate: true,
                action: 'allow'
            };
        } catch (error: any) {
            log.error('Error moderating image:', error);
            // On error, be permissive to avoid blocking legitimate content
            return {
                isAppropriate: true,
                action: 'allow',
                reason: 'Moderation service error'
            };
        }
    }

    /**
     * Moderate image using Sightengine
     */
    private async moderateImageSightengine(imageUrl: string): Promise<ModerationResult> {
        if (!this.apiClient) {
            throw new Error('Sightengine API client not initialized');
        }

        const response = await this.apiClient.get('/check.json', {
            params: {
                url: imageUrl,
                models: 'nudity-2.0,offensive,wad,scam',
                api_user: config.moderation.sightengine.apiUser,
                api_secret: config.moderation.sightengine.apiSecret
            }
        });

        const data = response.data;

        // Extract scores
        const nudityScore = data.nudity?.raw || 0;
        const suggestiveScore = data.nudity?.partial || 0;
        const offensiveScore = data.offensive?.prob || 0;
        const weaponsScore = data.weapon?.prob || 0;
        const alcoholScore = data.alcohol?.prob || 0;
        const drugsScore = data.drugs?.prob || 0;

        const details = {
            nudity: nudityScore,
            suggestive: suggestiveScore,
            violence: weaponsScore,
            drugs: drugsScore,
            alcohol: alcoholScore,
            gore: offensiveScore
        };

        // Determine action based on thresholds
        const thresholds = config.moderation.thresholds;

        // Block if explicit content
        if (nudityScore > thresholds.block) {
            return {
                isAppropriate: false,
                action: 'block',
                reason: 'Explicit nudity detected',
                details
            };
        }

        // Warn if suggestive content
        if (nudityScore > thresholds.warn || suggestiveScore > thresholds.warn) {
            return {
                isAppropriate: false,
                action: 'warn',
                reason: 'Inappropriate or suggestive content detected',
                details
            };
        }

        // Block if violent/offensive content
        if (weaponsScore > thresholds.block || offensiveScore > thresholds.block) {
            return {
                isAppropriate: false,
                action: 'block',
                reason: 'Violent or offensive content detected',
                details
            };
        }

        // Warn if drugs/alcohol
        if (drugsScore > thresholds.warn || alcoholScore > thresholds.warn) {
            return {
                isAppropriate: false,
                action: 'warn',
                reason: 'Drug or alcohol content detected',
                details
            };
        }

        // Content is appropriate
        return {
            isAppropriate: true,
            action: 'allow',
            details
        };
    }

    /**
     * Moderate image using Google Cloud Vision API
     */
    private async moderateImageGoogleVision(imageUrl: string): Promise<ModerationResult> {
        // TODO: Implement Google Cloud Vision moderation
        log.warn('Google Cloud Vision moderation not yet implemented');
        return {
            isAppropriate: true,
            action: 'allow'
        };
    }

    /**
     * Moderate video content
     * For videos, we extract frames and moderate them
     */
    async moderateVideo(videoUrl: string): Promise<ModerationResult> {
        if (!this.isEnabled) {
            return {
                isAppropriate: true,
                action: 'allow'
            };
        }

        try {
            if (config.moderation.provider === 'sightengine') {
                return await this.moderateVideoSightengine(videoUrl);
            } else if (config.moderation.provider === 'nsfwjs') {
                return await nsfwModerationService.classifyVideo(videoUrl);
            }

            // Fallback: allow if no provider configured
            return {
                isAppropriate: true,
                action: 'allow'
            };
        } catch (error: any) {
            log.error('Error moderating video:', error);
            return {
                isAppropriate: true,
                action: 'allow',
                reason: 'Moderation service error'
            };
        }
    }

    /**
     * Moderate video using Sightengine
     */
    private async moderateVideoSightengine(videoUrl: string): Promise<ModerationResult> {
        if (!this.apiClient) {
            throw new Error('Sightengine API client not initialized');
        }

        // For videos, Sightengine samples frames automatically
        const response = await this.apiClient.get('/video/check-sync.json', {
            params: {
                url: videoUrl,
                models: 'nudity-2.0,offensive,wad',
                api_user: config.moderation.sightengine.apiUser,
                api_secret: config.moderation.sightengine.apiSecret
            }
        });

        const data = response.data;

        // Get the highest scores across all frames
        let maxNudity = 0;
        let maxSuggestive = 0;
        let maxOffensive = 0;
        let maxWeapons = 0;

        if (data.data?.frames) {
            for (const frame of data.data.frames) {
                maxNudity = Math.max(maxNudity, frame.nudity?.raw || 0);
                maxSuggestive = Math.max(maxSuggestive, frame.nudity?.partial || 0);
                maxOffensive = Math.max(maxOffensive, frame.offensive?.prob || 0);
                maxWeapons = Math.max(maxWeapons, frame.weapon?.prob || 0);
            }
        }

        const details = {
            nudity: maxNudity,
            suggestive: maxSuggestive,
            violence: maxWeapons,
            gore: maxOffensive
        };

        const thresholds = config.moderation.thresholds;

        // Block if explicit content
        if (maxNudity > thresholds.block) {
            return {
                isAppropriate: false,
                action: 'block',
                reason: 'Explicit nudity detected in video',
                details
            };
        }

        // Warn if suggestive content
        if (maxNudity > thresholds.warn || maxSuggestive > thresholds.warn) {
            return {
                isAppropriate: false,
                action: 'warn',
                reason: 'Inappropriate or suggestive content detected in video',
                details
            };
        }

        // Block if violent/offensive content
        if (maxWeapons > thresholds.block || maxOffensive > thresholds.block) {
            return {
                isAppropriate: false,
                action: 'block',
                reason: 'Violent or offensive content detected in video',
                details
            };
        }

        // Content is appropriate
        return {
            isAppropriate: true,
            action: 'allow',
            details
        };
    }

    /**
     * Get moderation statistics
     */
    async getStats(): Promise<{
        isEnabled: boolean;
        provider: string;
        totalChecks: number;
    }> {
        return {
            isEnabled: this.isEnabled,
            provider: config.moderation.provider,
            totalChecks: 0 // TODO: Track this in database
        };
    }
}

export const contentModerationService = new ContentModerationService();
