import type { Agent, EnrollStart } from '../api/types';

/**
 * Sign-in as a small state machine, kept pure so it can be tested on its own:
 *
 *   checking ──session──▶ authenticated
 *      │ no session
 *      ▼
 *   anonymous ──password ok──▶ totp ──code ok──▶ authenticated
 *                    │
 *                    └──first login──▶ enroll ──confirmed──▶ backupCodes ──ack──▶ authenticated
 *
 * Logout or an expired session goes back to anonymous from anywhere.
 */
export type AuthState =
  | { status: 'checking' }
  | { status: 'anonymous'; notice?: string }
  | { status: 'totp'; challengeId: string }
  | { status: 'enroll'; challengeId: string; enrollment?: EnrollStart }
  | { status: 'backupCodes'; agent: Agent; backupCodes: string[] }
  | { status: 'authenticated'; agent: Agent };

export type AuthEvent =
  | { type: 'SESSION_FOUND'; agent: Agent }
  | { type: 'NO_SESSION' }
  | { type: 'PASSWORD_ACCEPTED'; step: 'totp' | 'enroll'; challengeId: string }
  | { type: 'ENROLL_STARTED'; enrollment: EnrollStart }
  | { type: 'TOTP_ACCEPTED'; agent: Agent }
  | { type: 'ENROLL_CONFIRMED'; agent: Agent; backupCodes: string[] }
  | { type: 'BACKUP_CODES_SAVED' }
  | { type: 'RESTART' }
  | { type: 'LOGGED_OUT' }
  | { type: 'SESSION_EXPIRED' };

export const initialAuthState: AuthState = { status: 'checking' };

export function authReducer(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case 'SESSION_FOUND':
      return state.status === 'checking' ? { status: 'authenticated', agent: event.agent } : state;
    case 'NO_SESSION':
      return state.status === 'checking' ? { status: 'anonymous' } : state;
    case 'PASSWORD_ACCEPTED':
      if (state.status !== 'anonymous') return state;
      return event.step === 'enroll'
        ? { status: 'enroll', challengeId: event.challengeId }
        : { status: 'totp', challengeId: event.challengeId };
    case 'ENROLL_STARTED':
      return state.status === 'enroll' ? { ...state, enrollment: event.enrollment } : state;
    case 'TOTP_ACCEPTED':
      return state.status === 'totp' ? { status: 'authenticated', agent: event.agent } : state;
    case 'ENROLL_CONFIRMED':
      return state.status === 'enroll' ? { status: 'backupCodes', agent: event.agent, backupCodes: event.backupCodes } : state;
    case 'BACKUP_CODES_SAVED':
      // The codes leave memory here: they are shown once, never again.
      return state.status === 'backupCodes' ? { status: 'authenticated', agent: state.agent } : state;
    case 'RESTART':
      return state.status === 'totp' || state.status === 'enroll' ? { status: 'anonymous' } : state;
    case 'LOGGED_OUT':
      return { status: 'anonymous' };
    case 'SESSION_EXPIRED':
      return state.status === 'authenticated' || state.status === 'backupCodes'
        ? { status: 'anonymous', notice: 'Votre session a expiré. Reconnectez-vous.' }
        : state;
    default:
      return state;
  }
}
