// REST API client — thin wrapper around fetch, typed with shared domain types
import type { Room, ChatMessage, Participant, ParticipantView, Export } from '@drawroom/shared';

// VITE_API_URL is for cross-origin setups (e.g. "https://api.example.com").
// In dev the Vite proxy forwards /api/* to localhost:3000, so the default
// must be '' — not '/draw', which is the frontend asset base path, not the API.
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
  // 204 No Content — return undefined (cast to T for void endpoints)
  if (res.status === 204) return undefined as unknown as T;
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

// ─── Participant endpoints ─────────────────────────────────────────────────────

export interface JoinRoomRequest {
  displayName: string;
  sessionToken?: string;
}

export type JoinRoomResponse = Participant;

export function joinRoom(slug: string, body: JoinRoomRequest): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(slug)}/participants`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function heartbeat(slug: string, participantId: string, sessionToken: string): Promise<void> {
  return request<void>(
    `/api/rooms/${encodeURIComponent(slug)}/participants/${encodeURIComponent(participantId)}/heartbeat`,
    { method: 'PATCH', body: JSON.stringify({ sessionToken }) },
  );
}

export function getParticipants(slug: string): Promise<{ participants: ParticipantView[] }> {
  return request<{ participants: ParticipantView[] }>(
    `/api/rooms/${encodeURIComponent(slug)}/participants`,
  );
}

// ─── Export endpoints ──────────────────────────────────────────────────────────

export interface UploadExportRequest {
  roomSlug: string;
  participantId: string;
  format: 'png' | 'svg';
  blob: Blob;
}

export interface UploadExportResponse {
  id: string;
  downloadUrl: string;
}

/**
 * Upload a canvas export using multipart form data (binary — no base64 overhead).
 * The server resolves the roomId from the slug + participantId.
 */
export async function uploadExport({
  roomSlug,
  participantId,
  format,
  blob,
}: UploadExportRequest): Promise<UploadExportResponse> {
  const form = new FormData();
  form.append('roomSlug', roomSlug);
  form.append('participantId', participantId);
  form.append('format', format);
  form.append('file', blob, `export.${format}`);

  const res = await fetch(`${API_BASE}/api/exports`, {
    method: 'POST',
    body: form,
    // No Content-Type header — browser sets multipart boundary automatically
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<UploadExportResponse>;
}

export type { Export };

export { ApiError };
