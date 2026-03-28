// Per-room session token management backed by localStorage

export interface RoomSession {
  participantId: string;
  sessionToken: string;
  displayName: string;
  color: string;
}

const sessionKey = (roomSlug: string) => `drawroom:session:${roomSlug}`;

export function getSession(roomSlug: string): RoomSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(roomSlug));
    if (!raw) return null;
    return JSON.parse(raw) as RoomSession;
  } catch {
    return null;
  }
}

export function setSession(roomSlug: string, session: RoomSession): void {
  try {
    localStorage.setItem(sessionKey(roomSlug), JSON.stringify(session));
  } catch {
    // ignore write errors (private browsing, quota exceeded, etc.)
  }
}

export function clearSession(roomSlug: string): void {
  try {
    localStorage.removeItem(sessionKey(roomSlug));
  } catch {
    // ignore
  }
}
