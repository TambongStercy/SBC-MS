import { describe, expect, it } from 'vitest';
import { authReducer, initialAuthState, type AuthState } from './machine';
import { makeAgent } from '../test/render';

const agent = makeAgent(['support_agent']);

describe('auth state machine', () => {
  it('checking → authenticated when a session exists', () => {
    expect(authReducer(initialAuthState, { type: 'SESSION_FOUND', agent })).toEqual({ status: 'authenticated', agent });
  });

  it('login → totp → app', () => {
    let s: AuthState = authReducer(initialAuthState, { type: 'NO_SESSION' });
    expect(s.status).toBe('anonymous');
    s = authReducer(s, { type: 'PASSWORD_ACCEPTED', step: 'totp', challengeId: 'c1' });
    expect(s).toEqual({ status: 'totp', challengeId: 'c1' });
    s = authReducer(s, { type: 'TOTP_ACCEPTED', agent });
    expect(s).toEqual({ status: 'authenticated', agent });
  });

  it('first login: enroll → backup codes shown once → app', () => {
    let s: AuthState = { status: 'anonymous' };
    s = authReducer(s, { type: 'PASSWORD_ACCEPTED', step: 'enroll', challengeId: 'c2' });
    expect(s).toEqual({ status: 'enroll', challengeId: 'c2' });
    s = authReducer(s, { type: 'ENROLL_STARTED', enrollment: { otpauthUrl: 'otpauth://totp/x?secret=ABC', qrDataUrl: 'data:image/png;base64,AA' } });
    expect(s.status === 'enroll' && s.enrollment?.qrDataUrl).toBeTruthy();
    s = authReducer(s, { type: 'ENROLL_CONFIRMED', agent, backupCodes: ['a', 'b'] });
    expect(s).toEqual({ status: 'backupCodes', agent, backupCodes: ['a', 'b'] });
    s = authReducer(s, { type: 'BACKUP_CODES_SAVED' });
    // The codes are gone from state once acknowledged.
    expect(s).toEqual({ status: 'authenticated', agent });
  });

  it('ignores out-of-order events', () => {
    const anon: AuthState = { status: 'anonymous' };
    expect(authReducer(anon, { type: 'TOTP_ACCEPTED', agent })).toBe(anon);
    const totp: AuthState = { status: 'totp', challengeId: 'c' };
    expect(authReducer(totp, { type: 'ENROLL_CONFIRMED', agent, backupCodes: [] })).toBe(totp);
    expect(authReducer(totp, { type: 'PASSWORD_ACCEPTED', step: 'enroll', challengeId: 'x' })).toBe(totp);
  });

  it('restart goes back to the password step; expiry and logout end the session', () => {
    expect(authReducer({ status: 'totp', challengeId: 'c' }, { type: 'RESTART' })).toEqual({ status: 'anonymous' });
    expect(authReducer({ status: 'authenticated', agent }, { type: 'SESSION_EXPIRED' })).toMatchObject({ status: 'anonymous', notice: expect.any(String) });
    expect(authReducer({ status: 'authenticated', agent }, { type: 'LOGGED_OUT' })).toEqual({ status: 'anonymous' });
  });
});
