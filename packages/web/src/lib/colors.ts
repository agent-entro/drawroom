// Deterministically assign participant colors from the shared palette
import { PARTICIPANT_COLORS } from '@drawroom/shared';

/**
 * Pick a color for a participant index (cycles if more participants than colors).
 */
export function getParticipantColor(index: number): string {
  const color = PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length];
  // PARTICIPANT_COLORS is a non-empty readonly array; index is always valid
  return color!;
}

/**
 * Pick a random color from the palette (used for new participants before the server assigns one).
 */
export function getRandomParticipantColor(): string {
  const index = Math.floor(Math.random() * PARTICIPANT_COLORS.length);
  return getParticipantColor(index);
}
