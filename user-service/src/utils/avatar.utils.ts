import config from '../config';

/**
 * Normalize a user's stored `avatar` value into a public URL clients can render.
 *
 * The User model has accumulated three shapes over migrations:
 *   1. null / empty → return null (caller shows initials)
 *   2. Already an absolute URL (`https://storage.googleapis.com/...`, older
 *      Google-Drive-backed migrations) → return as-is
 *   3. Bare file identifier → wrap with the avatar proxy endpoint
 *
 * Callers used to inline this three-way check; that produced broken nested URLs
 * like `http://localhost:6001/api/users/avatar/https://storage.googleapis.com/...`
 * whenever they forgot case #2. Route every new caller through this helper so
 * they can't drift.
 */
export function buildAvatarUrl(avatar: string | null | undefined): string | null {
    if (!avatar) return null;
    if (/^https?:\/\//i.test(avatar)) return avatar;
    return `${config.selfBaseUrl}/api/users/avatar/${avatar}`;
}
