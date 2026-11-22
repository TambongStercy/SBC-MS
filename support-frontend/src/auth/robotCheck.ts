/**
 * Anti-robot check on the agent login (Security plan Phase 9 rule 3). Self-hosted ALTCHA
 * (proof of work, no third party): the gateway hands out a signed challenge
 * (`/api/altcha/challenge`), the browser solves it with Web Crypto, the answer goes with
 * the login in `X-SBC-Altcha`, and the gateway checks it (ROBOT_CHECK=log counts it,
 * enforce refuses). It replaced Cloudflare Turnstile on 2026-11-22 (no keyed services).
 * Nothing is shown: the answer is solved while the agent types (`prepareRobotAnswer`).
 */
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/sha';

const FRESH_MS = 8 * 60_000;
let ready: { header: string; at: number } | null = null;
let solving: Promise<string | null> | null = null;
let off = false;

async function solveOne(): Promise<string | null> {
  if (off || typeof crypto === 'undefined' || !crypto.subtle) return null;
  const res = await fetch('/api/altcha/challenge', { cache: 'no-store', credentials: 'same-origin' });
  if (res.status === 204) { off = true; return null; } // check off on the server
  if (!res.ok) return null;
  const challenge = await res.json();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const solution = await solveChallenge({ challenge, deriveKey, controller });
    return solution ? btoa(JSON.stringify({ challenge, solution })) : null;
  } finally {
    clearTimeout(timer);
  }
}

export function prepareRobotAnswer(): void {
  if (solving || (ready && Date.now() - ready.at < FRESH_MS)) return;
  solving = solveOne()
    .then(h => { if (h) ready = { header: h, at: Date.now() }; return h; })
    .catch(() => null)
    .finally(() => { solving = null; });
}

/** One answer for one login (used once), or null when the check is off or too slow. */
export async function takeRobotAnswer(waitMs = 10_000): Promise<string | null> {
  if (ready && Date.now() - ready.at < FRESH_MS) { const h = ready.header; ready = null; return h; }
  ready = null;
  prepareRobotAnswer();
  const pending = solving;
  if (!pending) return null;
  const h = await Promise.race([pending, new Promise<null>(r => setTimeout(() => r(null), waitMs))]);
  const stored = ready as { header: string; at: number } | null;
  if (h && stored?.header === h) ready = null;
  return h;
}

export function _resetRobotCheck() { ready = null; solving = null; off = false; }
