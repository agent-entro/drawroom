// Slug validation utilities for room URLs
import { SLUG_MIN_LENGTH, SLUG_MAX_LENGTH } from '@drawroom/shared';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Returns true if the slug is a valid DrawRoom room identifier.
 * Valid format: lowercase alphanumerics separated by single hyphens.
 * Examples: "bright-owl-742", "abc123", "my-room"
 */
export function isValidSlug(slug: string): boolean {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) return false;
  return SLUG_PATTERN.test(slug);
}

/**
 * Normalise a user-entered slug: trim whitespace, lowercase.
 * Does not validate — call isValidSlug afterwards.
 */
export function normaliseSlug(raw: string): string {
  return raw.trim().toLowerCase();
}
