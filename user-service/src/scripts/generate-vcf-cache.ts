#!/usr/bin/env ts-node

/**
 * Script to manually generate the VCF cache file
 * This can be run manually or scheduled as a cron job
 */

import connectToDatabase from '../database/connection';
import { vcfCacheService } from '../services/vcf-cache.service';
import logger from '../utils/logger';

const log = logger.getLogger('VCFCacheGenerator');

async function generateVCFCache(): Promise<void> {
    try {
        log.info('Starting VCF cache generation script...');

        // Connect to database
        await connectToDatabase();
        log.info('Database connected successfully');

        // Check if file exists and get stats
        const fileExists = await vcfCacheService.fileExists();
        if (fileExists) {
            const stats = await vcfCacheService.getFileStats();
            log.info(`Current VCF file stats: ${stats.contactCount} contacts, ${stats.size} bytes, last modified: ${stats.mtime}`);
        } else {
            log.info('No existing VCF cache file found');
        }

        // Generate new VCF file
        const startTime = Date.now();
        await vcfCacheService.generateVCFFile();
        const endTime = Date.now();

        // Get new file stats
        const newStats = await vcfCacheService.getFileStats();
        log.info(`VCF cache generation completed successfully!`);
        log.info(`Generated file contains ${newStats.contactCount} contacts`);
        log.info(`File size: ${newStats.size} bytes`);
        log.info(`Generation time: ${endTime - startTime}ms`);

    } catch (error: any) {
        log.error('Error generating VCF cache:', error);
        process.exit(1);
    }
}

// Run the script if called directly
if (require.main === module) {
    generateVCFCache()
        .then(() => {
            log.info('VCF cache generation script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            log.error('VCF cache generation script failed:', error);
            process.exit(1);
        });
}

export { generateVCFCache };
