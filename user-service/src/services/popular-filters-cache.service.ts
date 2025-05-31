import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ContactSearchFilters } from '../types/contact.types';
import { userService } from './user.service';
import logger from '../utils/logger';

const log = logger.getLogger('PopularFiltersCache');

interface CachedFilter {
    filterHash: string;
    filters: ContactSearchFilters;
    vcfContent: string;
    contactCount: number;
    lastGenerated: Date;
    accessCount: number;
}

export class PopularFiltersCacheService {
    private readonly cacheDir: string;
    private readonly maxCacheFiles: number = 10; // Cache top 10 popular filters
    private readonly maxAgeHours: number = 24; // Cache for 24 hours

    constructor() {
        this.cacheDir = path.join(process.cwd(), 'storage', 'filter-cache');
    }

    /**
     * Generate a hash for filter combination
     */
    private generateFilterHash(filters: ContactSearchFilters): string {
        // Create a normalized string representation of filters
        const normalizedFilters = { ...filters };
        delete normalizedFilters.page;
        delete normalizedFilters.limit;
        
        const filterString = JSON.stringify(normalizedFilters, Object.keys(normalizedFilters).sort());
        return crypto.createHash('md5').update(filterString).digest('hex');
    }

    /**
     * Get cache file path for a filter hash
     */
    private getCacheFilePath(filterHash: string): string {
        return path.join(this.cacheDir, `${filterHash}.json`);
    }

    /**
     * Check if we should cache this filter combination
     */
    private shouldCacheFilter(filters: ContactSearchFilters): boolean {
        // Cache filters that are likely to be reused
        const hasCountry = !!filters.country;
        const hasDateRange = !!(filters.registrationDateStart || filters.registrationDateEnd);
        const hasBasicDemographics = !!(filters.sex || filters.minAge || filters.maxAge);
        
        // Cache if it has country filter (most common) or basic demographics
        return hasCountry || hasBasicDemographics || hasDateRange;
    }

    /**
     * Try to get cached result for filters
     */
    async getCachedResult(filters: ContactSearchFilters): Promise<string | null> {
        if (!this.shouldCacheFilter(filters)) {
            return null;
        }

        try {
            await this.ensureCacheDirectory();
            
            const filterHash = this.generateFilterHash(filters);
            const cacheFilePath = this.getCacheFilePath(filterHash);
            
            const cacheData = await fs.readFile(cacheFilePath, 'utf8');
            const cached: CachedFilter = JSON.parse(cacheData);
            
            // Check if cache is still valid
            const ageHours = (Date.now() - new Date(cached.lastGenerated).getTime()) / (1000 * 60 * 60);
            if (ageHours > this.maxAgeHours) {
                log.info(`Cache expired for filter ${filterHash} (age: ${ageHours.toFixed(1)}h)`);
                await fs.unlink(cacheFilePath);
                return null;
            }
            
            // Update access count
            cached.accessCount++;
            await fs.writeFile(cacheFilePath, JSON.stringify(cached, null, 2));
            
            log.info(`Cache hit for filter ${filterHash}. Contacts: ${cached.contactCount}, Access count: ${cached.accessCount}`);
            return cached.vcfContent;
            
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                log.error('Error reading filter cache:', error);
            }
            return null;
        }
    }

    /**
     * Cache the result of a filter combination
     */
    async cacheResult(filters: ContactSearchFilters, vcfContent: string, contactCount: number): Promise<void> {
        if (!this.shouldCacheFilter(filters)) {
            return;
        }

        try {
            await this.ensureCacheDirectory();
            
            const filterHash = this.generateFilterHash(filters);
            const cacheFilePath = this.getCacheFilePath(filterHash);
            
            const cached: CachedFilter = {
                filterHash,
                filters,
                vcfContent,
                contactCount,
                lastGenerated: new Date(),
                accessCount: 1
            };
            
            await fs.writeFile(cacheFilePath, JSON.stringify(cached, null, 2));
            log.info(`Cached filter result ${filterHash}. Contacts: ${contactCount}, Size: ${vcfContent.length} bytes`);
            
            // Clean up old cache files if we exceed the limit
            await this.cleanupOldCacheFiles();
            
        } catch (error: any) {
            log.error('Error caching filter result:', error);
        }
    }

    /**
     * Ensure cache directory exists
     */
    private async ensureCacheDirectory(): Promise<void> {
        try {
            await fs.access(this.cacheDir);
        } catch {
            await fs.mkdir(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Clean up old cache files to maintain the limit
     */
    private async cleanupOldCacheFiles(): Promise<void> {
        try {
            const files = await fs.readdir(this.cacheDir);
            const cacheFiles = files.filter(f => f.endsWith('.json'));
            
            if (cacheFiles.length <= this.maxCacheFiles) {
                return;
            }
            
            // Read all cache files and sort by access count and age
            const cacheData: Array<{ file: string; data: CachedFilter }> = [];
            
            for (const file of cacheFiles) {
                try {
                    const content = await fs.readFile(path.join(this.cacheDir, file), 'utf8');
                    const data: CachedFilter = JSON.parse(content);
                    cacheData.push({ file, data });
                } catch (error) {
                    // Remove corrupted cache files
                    await fs.unlink(path.join(this.cacheDir, file));
                }
            }
            
            // Sort by access count (descending) and then by age (newest first)
            cacheData.sort((a, b) => {
                if (a.data.accessCount !== b.data.accessCount) {
                    return b.data.accessCount - a.data.accessCount;
                }
                return new Date(b.data.lastGenerated).getTime() - new Date(a.data.lastGenerated).getTime();
            });
            
            // Remove excess files
            const filesToRemove = cacheData.slice(this.maxCacheFiles);
            for (const { file } of filesToRemove) {
                await fs.unlink(path.join(this.cacheDir, file));
                log.info(`Removed old cache file: ${file}`);
            }
            
        } catch (error: any) {
            log.error('Error cleaning up cache files:', error);
        }
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{
        totalCacheFiles: number;
        totalSize: number;
        popularFilters: Array<{ filters: ContactSearchFilters; accessCount: number; contactCount: number; age: string }>;
    }> {
        try {
            await this.ensureCacheDirectory();
            
            const files = await fs.readdir(this.cacheDir);
            const cacheFiles = files.filter(f => f.endsWith('.json'));
            
            let totalSize = 0;
            const popularFilters: Array<{ filters: ContactSearchFilters; accessCount: number; contactCount: number; age: string }> = [];
            
            for (const file of cacheFiles) {
                try {
                    const filePath = path.join(this.cacheDir, file);
                    const stats = await fs.stat(filePath);
                    totalSize += stats.size;
                    
                    const content = await fs.readFile(filePath, 'utf8');
                    const data: CachedFilter = JSON.parse(content);
                    
                    const ageHours = (Date.now() - new Date(data.lastGenerated).getTime()) / (1000 * 60 * 60);
                    popularFilters.push({
                        filters: data.filters,
                        accessCount: data.accessCount,
                        contactCount: data.contactCount,
                        age: `${ageHours.toFixed(1)}h`
                    });
                } catch (error) {
                    // Skip corrupted files
                }
            }
            
            // Sort by access count
            popularFilters.sort((a, b) => b.accessCount - a.accessCount);
            
            return {
                totalCacheFiles: cacheFiles.length,
                totalSize,
                popularFilters
            };
            
        } catch (error: any) {
            log.error('Error getting cache stats:', error);
            return { totalCacheFiles: 0, totalSize: 0, popularFilters: [] };
        }
    }

    /**
     * Clear all cached filters
     */
    async clearAllCache(): Promise<void> {
        try {
            const files = await fs.readdir(this.cacheDir);
            const cacheFiles = files.filter(f => f.endsWith('.json'));
            
            for (const file of cacheFiles) {
                await fs.unlink(path.join(this.cacheDir, file));
            }
            
            log.info(`Cleared ${cacheFiles.length} cached filter files`);
        } catch (error: any) {
            log.error('Error clearing cache:', error);
        }
    }
}

// Export singleton instance
export const popularFiltersCacheService = new PopularFiltersCacheService();
