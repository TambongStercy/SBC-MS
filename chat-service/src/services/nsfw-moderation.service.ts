import axios from 'axios';
import logger from '../utils/logger';
import config from '../config';
import { ModerationResult } from './content-moderation.service';

const log = logger.getLogger('NSFWModerationService');

/**
 * NSFW.js Content Moderation Service
 *
 * This service uses NSFW.js (TensorFlow.js) for local, self-hosted content moderation.
 *
 * Classification categories:
 * - Drawing: Drawings, paintings, sketches
 * - Hentai: Hentai and pornographic drawings
 * - Neutral: Safe for work neutral images
 * - Porn: Pornographic images, sexual acts
 * - Sexy: Sexually explicit images, not pornography
 */

interface NSFWPrediction {
    className: string;
    probability: number;
}

class NSFWModerationService {
    /**
     * Classify an image using NSFW.js
     *
     * Note: This requires @tensorflow/tfjs-node to be installed and working.
     * On production Linux servers, this works out of the box.
     * On Windows development machines, Visual Studio build tools are required.
     *
     * Alternative: Deploy as a separate Docker container (see docker-compose.nsfw.yml)
     */
    async classifyImage(imageUrl: string): Promise<ModerationResult> {
        try {
            // Dynamic import to handle cases where tfjs-node isn't available
            const tf = await import('@tensorflow/tfjs-node');
            const nsfw = await import('nsfwjs');

            // Load the model (cached after first load)
            const model = await nsfw.load();

            // Fetch the image
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 10000
            });

            const imageBuffer = Buffer.from(response.data);

            // Decode and classify
            const image = await tf.node.decodeImage(imageBuffer, 3);
            const predictions: NSFWPrediction[] = await model.classify(image);

            // Clean up tensor to prevent memory leaks
            image.dispose();

            // Analyze predictions
            return this.analyzePredictions(predictions);

        } catch (error: any) {
            // If TensorFlow is not available, log warning and fall back
            if (error.code === 'MODULE_NOT_FOUND' || error.message?.includes('tfjs-node')) {
                log.warn('NSFW.js/TensorFlow not available. Falling back to allow. Deploy NSFW service separately.');
                return {
                    isAppropriate: true,
                    action: 'allow',
                    reason: 'NSFW.js not available'
                };
            }

            log.error('Error classifying image with NSFW.js:', error);
            // Fail open - allow content if service errors
            return {
                isAppropriate: true,
                action: 'allow',
                reason: 'Classification error'
            };
        }
    }

    /**
     * Analyze NSFW.js predictions and determine action
     */
    private analyzePredictions(predictions: NSFWPrediction[]): ModerationResult {
        // Get scores for each category
        const scores: { [key: string]: number } = {};
        predictions.forEach(pred => {
            scores[pred.className.toLowerCase()] = pred.probability;
        });

        const pornScore = scores['porn'] || 0;
        const hentaiScore = scores['hentai'] || 0;
        const sexyScore = scores['sexy'] || 0;

        const explicitScore = Math.max(pornScore, hentaiScore);
        const suggestiveScore = sexyScore;

        const details = {
            nudity: pornScore,
            suggestive: sexyScore,
            hentai: hentaiScore
        };

        // Block if explicit content (porn/hentai)
        if (explicitScore > config.moderation.thresholds.block) {
            return {
                isAppropriate: false,
                action: 'block',
                reason: explicitScore === pornScore
                    ? 'Explicit pornographic content detected'
                    : 'Explicit hentai content detected',
                details
            };
        }

        // Warn if suggestive content
        if (suggestiveScore > config.moderation.thresholds.warn || explicitScore > config.moderation.thresholds.warn) {
            return {
                isAppropriate: false,
                action: 'warn',
                reason: 'Sexually suggestive content detected',
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
     * Classify video by sampling frames
     *
     * For videos, extract frames at regular intervals and classify each frame.
     * Use the highest NSFW score across all frames.
     *
     * Note: Requires ffmpeg for frame extraction
     */
    async classifyVideo(videoUrl: string): Promise<ModerationResult> {
        try {
            log.warn('Video classification not yet implemented. Use frame extraction or external service.');
            // TODO: Implement video frame extraction and classification
            // Options:
            // 1. Use ffmpeg to extract frames
            // 2. Use video-thumbnail library
            // 3. Extract at 0%, 25%, 50%, 75%, 100% of video duration
            // 4. Classify each frame and use max NSFW score

            // For now, allow videos (or use Sightengine fallback)
            return {
                isAppropriate: true,
                action: 'allow',
                reason: 'Video classification not implemented'
            };
        } catch (error: any) {
            log.error('Error classifying video:', error);
            return {
                isAppropriate: true,
                action: 'allow',
                reason: 'Video classification error'
            };
        }
    }

    /**
     * Check if NSFW.js is available and working
     */
    async healthCheck(): Promise<boolean> {
        try {
            await import('@tensorflow/tfjs-node');
            await import('nsfwjs');
            return true;
        } catch (error) {
            log.warn('NSFW.js health check failed:', error);
            return false;
        }
    }
}

export const nsfwModerationService = new NSFWModerationService();
