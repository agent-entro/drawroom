// Tests for shared constants — verify values are within expected ranges
import { describe, it, expect } from 'vitest';
import {
  MAX_MESSAGE_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  DEFAULT_MAX_PARTICIPANTS,
  ROOM_TTL_DAYS,
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_AWAY_THRESHOLD_MS,
  PARTICIPANT_COLORS,
  ROOM_CREATE_RATE_LIMIT,
  CHAT_HISTORY_PAGE_SIZE,
} from './constants.js';

describe('constants', () => {
  it('MAX_MESSAGE_LENGTH is 2000', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(2_000);
  });

  it('MAX_DISPLAY_NAME_LENGTH is 30', () => {
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(30);
  });

  it('DEFAULT_MAX_PARTICIPANTS is 5 (free tier)', () => {
    expect(DEFAULT_MAX_PARTICIPANTS).toBe(5);
  });

  it('ROOM_TTL_DAYS is 7', () => {
    expect(ROOM_TTL_DAYS).toBe(7);
  });

  it('HEARTBEAT_INTERVAL_MS is 30 seconds', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it('PRESENCE_AWAY_THRESHOLD_MS is greater than HEARTBEAT_INTERVAL_MS', () => {
    expect(PRESENCE_AWAY_THRESHOLD_MS).toBeGreaterThan(HEARTBEAT_INTERVAL_MS);
  });

  it('PARTICIPANT_COLORS has at least 5 entries and all are valid hex', () => {
    expect(PARTICIPANT_COLORS.length).toBeGreaterThanOrEqual(5);
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const color of PARTICIPANT_COLORS) {
      expect(color).toMatch(hexPattern);
    }
  });

  it('ROOM_CREATE_RATE_LIMIT is positive', () => {
    expect(ROOM_CREATE_RATE_LIMIT).toBeGreaterThan(0);
  });

  it('CHAT_HISTORY_PAGE_SIZE is at least 50', () => {
    expect(CHAT_HISTORY_PAGE_SIZE).toBeGreaterThanOrEqual(50);
  });
});
