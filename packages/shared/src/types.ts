// Core domain types shared between frontend (web) and backend (party)

export type RoomStatus = 'active' | 'archived' | 'deleted';

export type MessageType = 'message' | 'comment' | 'system';

export type ExportFormat = 'png' | 'svg';

export interface Room {
  id: string;
  slug: string;
  title: string;
  createdAt: string; // ISO 8601
  lastActiveAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  isPersistent: boolean;
  ownerId: string | null;
  maxParticipants: number;
  status: RoomStatus;
}

export interface Participant {
  id: string;
  roomId: string;
  displayName: string;
  color: string; // Hex, e.g. "#4A90D9"
  sessionToken: string;
  joinedAt: string; // ISO 8601
  lastSeenAt: string; // ISO 8601
  userId: string | null;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  participantId: string;
  content: string;
  type: MessageType;
  canvasX: number | null;
  canvasY: number | null;
  /** For comment replies: ID of the root comment pin. Null for root comments. */
  parentId: string | null;
  createdAt: string; // ISO 8601
}

export interface Export {
  id: string;
  roomId: string;
  format: ExportFormat;
  fileUrl: string;
  fileSizeBytes: number;
  createdAt: string; // ISO 8601
  requestedBy: string; // participantId
}

// Lightweight view model used in WebSocket events (no sensitive fields)
export interface ParticipantView {
  id: string;
  displayName: string;
  color: string;
  joinedAt: string;
  lastSeenAt: string;
}
