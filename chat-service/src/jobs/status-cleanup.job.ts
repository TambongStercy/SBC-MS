import { statusRepository } from '../database/repositories/status.repository';
import { settingsServiceClient } from '../services/clients/settings.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('StatusCleanupJob');

/** How often expired statuses are swept. */
const INTERVAL_MS = Number(process.env.STATUS_CLEANUP_INTERVAL_MS || 60 * 60 * 1000);
/** Statuses per sweep. Keeps one pass bounded on a backlog. */
const BATCH = Number(process.env.STATUS_CLEANUP_BATCH || 200);

/**
 * `gs://bucket/statuses/images/x.jpeg` -> `statuses/images/x.jpeg`.
 *
 * The delete endpoint wants the object path, not the full gs:// URI, and a
 * status stores the URI.
 */
const objectPath = (mediaUrl: string): string | null => {
    if (!mediaUrl) return null;
    const withoutScheme = mediaUrl.replace(/^gs:\/\//, '');
    const firstSlash = withoutScheme.indexOf('/');
    return firstSlash === -1 ? null : withoutScheme.slice(firstSlash + 1);
};

/**
 * Deletes the media of expired statuses, then marks them deleted.
 *
 * A status is only meant to live 24 hours, but nothing ever removed the file it
 * left in the private bucket: 983 expired statuses had accumulated since January,
 * their images and videos still stored and still billed. The repository already
 * had both halves of this — they were simply never called.
 *
 * Order matters: the file goes first, and the document is only marked deleted
 * once that succeeded. Marking first would lose the pointer to a file that is
 * still there, making it unreachable AND permanent.
 */
export const cleanupExpiredStatuses = async (): Promise<{ filesDeleted: number; statusesMarked: number }> => {
    const expired = await statusRepository.getExpiredStatuses(BATCH);
    if (!expired.length) return { filesDeleted: 0, statusesMarked: 0 };

    let filesDeleted = 0;
    let statusesMarked = 0;

    for (const status of expired) {
        const path = objectPath((status as unknown as { mediaUrl?: string }).mediaUrl ?? '');

        if (path) {
            try {
                await settingsServiceClient.deleteFilePrivate(path);
                filesDeleted++;
            } catch (err) {
                // Leave the status alone so the next sweep retries it; a file we
                // failed to delete must not be forgotten about.
                log.warn(`Could not delete media for status ${status._id}: ${(err as Error).message}`);
                continue;
            }
        }

        try {
            await statusRepository.softDelete(String(status._id), String(status.authorId));
            statusesMarked++;
        } catch (err) {
            log.warn(`Could not mark status ${status._id} deleted: ${(err as Error).message}`);
        }
    }

    log.info(`Status cleanup: ${filesDeleted} file(s) deleted, ${statusesMarked} status(es) marked deleted`);
    return { filesDeleted, statusesMarked };
};

/** Starts the hourly sweep. Returns a stop function. */
export const startStatusCleanup = (): (() => void) => {
    const run = () => {
        cleanupExpiredStatuses().catch(err => log.error('Status cleanup failed:', err));
    };

    // Not on boot: a deploy restarts every service at once, and a sweep competing
    // with startup traffic buys nothing when statuses expire on a 24h clock.
    const timer = setInterval(run, INTERVAL_MS);
    log.info(`Status cleanup scheduled every ${Math.round(INTERVAL_MS / 60000)} min (batch ${BATCH})`);
    return () => clearInterval(timer);
};
