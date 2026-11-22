/**
 * Security plan Phase 3 item 6: money actions (approving withdrawals, « Marquer comme payé »,
 * payouts) need the admin's own authenticator code. When payment-service answers
 * ADMIN_CODE_REQUIRED / ADMIN_CODE_INVALID, the API client asks for it here (the
 * <AdminCodePrompt/> modal answers) and sends the same request again with the code. One code
 * opens a 10-minute window on the session, so a batch of approvals asks once.
 */
export type AdminCodeAnswer = { adminCode: string } | { adminBackupCode: string };
type Pending = { error?: string; resolve: (a: AdminCodeAnswer | null) => void };

let listener: ((p: Pending | null) => void) | null = null;
let current: Pending | null = null;

/** The modal registers here; returns the unsubscribe. */
export function onAdminCodeRequest(fn: (p: Pending | null) => void): () => void {
  listener = fn;
  if (current) fn(current);
  return () => { if (listener === fn) listener = null; };
}

/** Asks the admin for a code; null when cancelled (or no modal is mounted). */
export function requestAdminCode(error?: string): Promise<AdminCodeAnswer | null> {
  if (!listener) return Promise.resolve(null);
  if (current) current.resolve(null); // one prompt at a time
  return new Promise(resolve => {
    current = { error, resolve: (a) => { current = null; listener?.(null); resolve(a); } };
    listener?.(current);
  });
}

export const ADMIN_CODE_ERRORS = ['ADMIN_CODE_REQUIRED', 'ADMIN_CODE_INVALID'] as const;
export const isAdminCodeError = (status: number | undefined, body: unknown): boolean =>
  status === 403 && !!body && typeof body === 'object' && ADMIN_CODE_ERRORS.includes((body as { code?: string }).code as never);
