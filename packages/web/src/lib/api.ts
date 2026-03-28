// REST API client — thin wrapper around fetch, typed with shared domain types
import type { Room, ChatMessage } from '@drawroom/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<T>;
}

// ─── Room endpoints ────────────────────────────────────────────────────────────

export interface CreateRoomResponse {
  slug: string;
  roomUrl: string;
}

export function createRoom(): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>('/api/rooms', { method: 'POST', body: '{}' });
}

export function getRoom(slug: string): Promise<Room> {
  return request<Room>(`/api/rooms/${encodeURIComponent(slug)}`);
}

// ─── Chat endpoints ────────────────────────────────────────────────────────────

export interface GetMessagesParams {
  cursor?: string;
  limit?: number;
}

export interface GetMessagesResponse {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}

export function getMessages(
  slug: string,
  { cursor, limit = 100 }: GetMessagesParams = {},
): Promise<GetMessagesResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  params.set('limit', String(limit));
  return request<GetMessagesResponse>(`/api/rooms/${encodeURIComponent(slug)}/messages?${params}`);
}

export { ApiError };
