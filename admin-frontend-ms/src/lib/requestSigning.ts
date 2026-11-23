/**
 * Security plan Phase 9 (admin, same rules as the member app — SBC-WEB-UI
 * `utils/requestSigning.ts`, which this copies): every call to the API is signed
 * with a key this browser made at sign-in.
 *
 * - ECDSA P-256 (WebCrypto); the private key is NON-EXTRACTABLE, kept in IndexedDB.
 *   A token copied out of localStorage is useless without this browser.
 * - The public key goes with the authenticator step (`devicePublicKey`); user-service
 *   binds it to the admin token it issues.
 * - X-SBC-Signature: v1;t=<ms>;n=<nonce>;b=<sha256 hex of the body | UNSIGNED>;s=<sig>
 *   over "v1\n<METHOD>\n<path?query>\n<t>\n<n>\n<b>".
 *
 * The gateway only records the result (BROWSER_CHECKS=log); nothing is refused, and
 * signing never blocks a request: any failure sends it unsigned.
 */

const DB_NAME = 'sbc-admin-keys';
const STORE = 'keys';
const SLOT = 'session';

interface Stored { pair: CryptoKeyPair | null; spki: string | null; tokenTag: string | null; createdAt: number }

const subtle = (): SubtleCrypto | null => {
  try { return typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null; } catch { return null; }
};
export const signingSupported = (): boolean => !!subtle() && typeof indexedDB !== 'undefined';

// ---------- IndexedDB ----------
let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(key: string, value: unknown): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- helpers ----------
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf: ArrayBuffer) => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const b64url = (buf: ArrayBuffer) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256Hex = async (data: BufferSource | string) =>
  hex(await subtle()!.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));

const tagCache = new Map<string, string>();
async function tokenTag(token: string): Promise<string> {
  const hit = tagCache.get(token);
  if (hit) return hit;
  const t = (await sha256Hex(token)).slice(0, 16);
  tagCache.clear();
  tagCache.set(token, t);
  return t;
}

let current: Stored | null = null; // in-memory copy of the IndexedDB slot
let pending: { pair: CryptoKeyPair; spki: string } | null = null; // made for a sign-in in progress

async function newPair(): Promise<{ pair: CryptoKeyPair; spki: string }> {
  const pair = await subtle()!.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;
  const spki = b64(await subtle()!.exportKey('spki', pair.publicKey));
  return { pair, spki };
}

async function load(): Promise<Stored | null> {
  if (current) return current;
  try { current = (await idbGet<Stored>(SLOT)) ?? null; } catch { current = null; }
  return current;
}
async function save(s: Stored): Promise<void> {
  current = s;
  try { await idbPut(SLOT, s); } catch { /* memory copy still signs this page's requests */ }
}

// ---------- clock: the server's Date header, so a phone with a wrong clock still signs on time ----------
let clockOffsetMs = 0;
export function noteServerDate(dateHeader: string | null): void {
  if (!dateHeader) return;
  const server = Date.parse(dateHeader);
  if (Number.isFinite(server)) clockOffsetMs = server + 500 - Date.now();
}

// ---------- sign-in ----------
/** Before sending the sign-in code: a fresh key pair; its public key goes with the code. Null if unsupported. */
export async function prepareSignInKey(): Promise<string | null> {
  if (!signingSupported()) return null;
  try { pending = await newPair(); return pending.spki; } catch { pending = null; return null; }
}

/** After the sign-in code was accepted: the pending key becomes this token's key. */
export async function adoptSignInKey(token: string): Promise<void> {
  if (!pending || !token) return;
  try { await save({ pair: pending.pair, spki: pending.spki, tokenTag: await tokenTag(token), createdAt: Date.now() }); } catch { /* unsigned */ }
  pending = null;
}

/** Logout: this browser's key is forgotten (the server revokes it too). */
export async function clearSessionKey(): Promise<void> {
  current = null;
  try { await idbPut(SLOT, { pair: null, spki: null, tokenTag: null, createdAt: Date.now() }); } catch { /* ignore */ }
}

// ---------- per request ----------
async function bodyHash(body: BodyInit | null | undefined): Promise<string> {
  if (body === undefined || body === null) return sha256Hex('');
  if (typeof body === 'string') return sha256Hex(body);
  if (body instanceof URLSearchParams) return sha256Hex(body.toString());
  if (body instanceof ArrayBuffer) return sha256Hex(body);
  if (ArrayBuffer.isView(body)) return sha256Hex(body as ArrayBufferView);
  return 'UNSIGNED'; // FormData, Blob, streams: uploads, signed without their body
}

const randomNonce = () => { const b = new Uint8Array(18); crypto.getRandomValues(b); return b64url(b.buffer); };

/**
 * The X-SBC-Signature value for one request, or null when it cannot be signed
 * (no member token, no key for this token). Never throws.
 */
export async function signatureFor(method: string, url: string, authorization: string | null, body: BodyInit | null | undefined): Promise<string | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  if (!signingSupported()) return `none;r=${!subtle() ? 'nocrypto' : 'noidb'}`;
  try {
    const s = await load();
    if (!s?.pair || s.tokenTag !== await tokenTag(authorization.slice(7))) return null;
    const u = new URL(url, window.location.origin);
    const t = String(Date.now() + clockOffsetMs);
    const n = randomNonce();
    const b = await bodyHash(body);
    const text = `v1\n${method.toUpperCase()}\n${u.pathname}${u.search}\n${t}\n${n}\n${b}`;
    const sig = await subtle()!.sign({ name: 'ECDSA', hash: 'SHA-256' }, s.pair.privateKey, new TextEncoder().encode(text));
    return `v1;t=${t};n=${n};b=${b};s=${b64url(sig)}`;
  } catch {
    return null;
  }
}

/** For tests. */
export const _resetSigning = () => { current = null; pending = null; clockOffsetMs = 0; tagCache.clear(); dbPromise = null; };
