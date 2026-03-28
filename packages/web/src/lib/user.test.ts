/**
 * Tests for the persistent user identity utilities.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to reset module state between tests so localStorage stubs work
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('getUserId', () => {
  it('generates a new id when localStorage is empty', async () => {
    const { getUserId } = await import('./user.ts');
    const id = getUserId();
    expect(id).toMatch(/^user_[a-z0-9]+$/);
  });

  it('returns the same id on repeated calls', async () => {
    const { getUserId } = await import('./user.ts');
    const id1 = getUserId();
    const id2 = getUserId();
    expect(id1).toBe(id2);
  });

  it('persists across module reloads (localStorage)', async () => {
    const { getUserId: getUserId1 } = await import('./user.ts');
    const id1 = getUserId1();

    vi.resetModules();
    const { getUserId: getUserId2 } = await import('./user.ts');
    const id2 = getUserId2();

    expect(id1).toBe(id2);
  });
});

describe('getUserName', () => {
  it('generates a name with Adjective + Noun format', async () => {
    const { getUserName } = await import('./user.ts');
    const name = getUserName();
    // Should be two words: "Amber Bear", "Blue Cloud", etc.
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('returns the same name on repeated calls', async () => {
    const { getUserName } = await import('./user.ts');
    const n1 = getUserName();
    const n2 = getUserName();
    expect(n1).toBe(n2);
  });
});

describe('setUserName', () => {
  it('updates the stored name', async () => {
    const { getUserName, setUserName } = await import('./user.ts');
    getUserName(); // initialise
    setUserName('Custom Name');
    // After setUserName, getUserName should reflect the new value
    vi.resetModules();
    const { getUserName: getName2 } = await import('./user.ts');
    expect(getName2()).toBe('Custom Name');
  });

  it('trims and truncates long names to 30 chars', async () => {
    const { setUserName, getUserName } = await import('./user.ts');
    getUserName(); // initialise
    setUserName('  ' + 'A'.repeat(50) + '  ');
    vi.resetModules();
    const { getUserName: getName2 } = await import('./user.ts');
    const stored = getName2();
    expect(stored.length).toBeLessThanOrEqual(30);
  });
});
