/**
 * Stable user identity backed by localStorage.
 * In Phase 2 this will be replaced by the room-join flow that assigns a server-side
 * participant ID and display name. For Phase 1, we use localStorage to persist identity
 * across page refreshes so undo/redo state remains consistent per user.
 */

const USER_ID_KEY = 'drawroom:userId';
const USER_NAME_KEY = 'drawroom:userName';

/** Adjectives and nouns for random name generation */
const ADJECTIVES = [
  'Amber', 'Blue', 'Coral', 'Dune', 'Ember', 'Frost', 'Golden',
  'Hazy', 'Indigo', 'Jade', 'Keen', 'Lunar', 'Misty', 'Nova',
] as const;

const NOUNS = [
  'Bear', 'Cloud', 'Dove', 'Eagle', 'Falcon', 'Ghost', 'Hawk',
  'Iris', 'Jaguar', 'Kite', 'Lynx', 'Moon', 'Otter', 'Panda',
] as const;

function generateId(): string {
  return `user_${Math.random().toString(36).slice(2, 10)}`;
}

function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adj} ${noun}`;
}

/** Returns a stable, persistent user ID (creates one if missing). */
export function getUserId(): string {
  try {
    const stored = localStorage.getItem(USER_ID_KEY);
    if (stored) return stored;
    const id = generateId();
    localStorage.setItem(USER_ID_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private browsing, etc.) — use ephemeral ID
    return generateId();
  }
}

/** Returns a stable, persistent display name (creates one if missing). */
export function getUserName(): string {
  try {
    const stored = localStorage.getItem(USER_NAME_KEY);
    if (stored) return stored;
    const name = generateName();
    localStorage.setItem(USER_NAME_KEY, name);
    return name;
  } catch {
    return generateName();
  }
}

/** Persist a user-chosen display name. */
export function setUserName(name: string): void {
  try {
    localStorage.setItem(USER_NAME_KEY, name.trim().slice(0, 30) || generateName());
  } catch {
    // ignore
  }
}
