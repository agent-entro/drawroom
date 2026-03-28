import { describe, it, expect } from 'vitest';
import { isValidSlug, normaliseSlug } from './slugs.js';

describe('isValidSlug', () => {
  it('accepts a typical DrawRoom slug', () => {
    expect(isValidSlug('bright-owl-742')).toBe(true);
  });

  it('accepts a simple alphanumeric slug', () => {
    expect(isValidSlug('abc123')).toBe(true);
  });

  it('accepts a multi-segment slug', () => {
    expect(isValidSlug('cheerful-panda-491')).toBe(true);
  });

  it('rejects a slug that is too short', () => {
    expect(isValidSlug('ab')).toBe(false);
  });

  it('rejects a slug that is too long (>20 chars)', () => {
    expect(isValidSlug('this-slug-is-way-too-long')).toBe(false);
  });

  it('rejects slugs with uppercase letters', () => {
    expect(isValidSlug('Bright-Owl')).toBe(false);
  });

  it('rejects slugs with leading hyphen', () => {
    expect(isValidSlug('-bright-owl')).toBe(false);
  });

  it('rejects slugs with trailing hyphen', () => {
    expect(isValidSlug('bright-owl-')).toBe(false);
  });

  it('rejects slugs with consecutive hyphens', () => {
    expect(isValidSlug('bright--owl')).toBe(false);
  });

  it('rejects slugs with spaces', () => {
    expect(isValidSlug('bright owl')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });
});

describe('normaliseSlug', () => {
  it('trims whitespace', () => {
    expect(normaliseSlug('  bright-owl  ')).toBe('bright-owl');
  });

  it('lowercases the slug', () => {
    expect(normaliseSlug('BRIGHT-OWL')).toBe('bright-owl');
  });

  it('handles empty string', () => {
    expect(normaliseSlug('')).toBe('');
  });
});
