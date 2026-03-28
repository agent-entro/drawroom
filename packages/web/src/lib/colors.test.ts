import { describe, it, expect } from 'vitest';
import { getParticipantColor, getRandomParticipantColor } from './colors.js';
import { PARTICIPANT_COLORS } from '@drawroom/shared';

describe('getParticipantColor', () => {
  it('returns the first color for index 0', () => {
    expect(getParticipantColor(0)).toBe(PARTICIPANT_COLORS[0]);
  });

  it('returns the correct color for each index within palette', () => {
    for (let i = 0; i < PARTICIPANT_COLORS.length; i++) {
      expect(getParticipantColor(i)).toBe(PARTICIPANT_COLORS[i]);
    }
  });

  it('cycles back to the start when index exceeds palette length', () => {
    const len = PARTICIPANT_COLORS.length;
    expect(getParticipantColor(len)).toBe(PARTICIPANT_COLORS[0]);
    expect(getParticipantColor(len + 1)).toBe(PARTICIPANT_COLORS[1]);
  });

  it('always returns a valid hex color', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (let i = 0; i < 20; i++) {
      expect(getParticipantColor(i)).toMatch(hexPattern);
    }
  });
});

describe('getRandomParticipantColor', () => {
  it('returns a value from the palette', () => {
    for (let i = 0; i < 20; i++) {
      expect(PARTICIPANT_COLORS).toContain(getRandomParticipantColor());
    }
  });
});
