// Tests for session.ts — localStorage-backed per-room session management
import { describe, it, expect, beforeEach } from 'vitest';
import { getSession, setSession, clearSession } from './session.ts';
import type { RoomSession } from './session.ts';

const SLUG = 'test-room-abc';

const MOCK_SESSION: RoomSession = {
  participantId: 'part-123',
  sessionToken: 'tok-abc',
  displayName: 'Amber Bear',
  color: '#4A90D9',
};

describe('session.ts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getSession returns null when nothing is stored', () => {
    expect(getSession(SLUG)).toBeNull();
  });

  it('setSession + getSession round-trips correctly', () => {
    setSession(SLUG, MOCK_SESSION);
    const result = getSession(SLUG);
    expect(result).toEqual(MOCK_SESSION);
  });

  it('clearSession removes the session', () => {
    setSession(SLUG, MOCK_SESSION);
    clearSession(SLUG);
    expect(getSession(SLUG)).toBeNull();
  });

  it('sessions are keyed per room slug', () => {
    const OTHER_SLUG = 'other-room-xyz';
    const otherSession: RoomSession = { ...MOCK_SESSION, displayName: 'Blue Cloud' };

    setSession(SLUG, MOCK_SESSION);
    setSession(OTHER_SLUG, otherSession);

    expect(getSession(SLUG)).toEqual(MOCK_SESSION);
    expect(getSession(OTHER_SLUG)).toEqual(otherSession);

    clearSession(SLUG);
    expect(getSession(SLUG)).toBeNull();
    expect(getSession(OTHER_SLUG)).toEqual(otherSession);
  });

  it('getSession returns null for malformed JSON', () => {
    localStorage.setItem(`drawroom:session:${SLUG}`, 'not-valid-json{');
    expect(getSession(SLUG)).toBeNull();
  });
});
