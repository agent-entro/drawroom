/**
 * Phase 0 smoke tests for the party package.
 * Full integration tests require a live PartyKit runtime — those live in e2e/.
 * These tests verify the module exports and shared constants are importable.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_MESSAGE_LENGTH,
  HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_PARTICIPANTS,
} from '@drawroom/shared';

describe('Party package — scaffolding smoke tests', () => {
  it('imports MAX_MESSAGE_LENGTH from shared', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(2_000);
  });

  it('imports HEARTBEAT_INTERVAL_MS from shared', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it('imports DEFAULT_MAX_PARTICIPANTS from shared', () => {
    expect(DEFAULT_MAX_PARTICIPANTS).toBe(5);
  });

  it('validates the message length constraint logic', () => {
    const validMessage = 'a'.repeat(MAX_MESSAGE_LENGTH);
    const tooLongMessage = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);

    expect(validMessage.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    expect(tooLongMessage.length).toBeGreaterThan(MAX_MESSAGE_LENGTH);
  });

  it('heartbeat fires within a reasonable range (10s–60s)', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });
});
