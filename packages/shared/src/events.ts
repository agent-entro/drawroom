// WebSocket event type definitions — all messages between client and server

import type { ChatMessage, ParticipantView } from './types.js';

// ─── Client → Server ──────────────────────────────────────────────────────────

export interface JoinEvent {
  type: 'JOIN';
  displayName: string;
  sessionToken: string;
}

export interface ChatSendEvent {
  type: 'CHAT_SEND';
  content: string;
  messageType: 'message' | 'comment';
  canvasX?: number;
  canvasY?: number;
}

export interface HeartbeatEvent {
  type: 'HEARTBEAT';
}

export interface LeaveEvent {
  type: 'LEAVE';
}

export type ClientEvent = JoinEvent | ChatSendEvent | HeartbeatEvent | LeaveEvent;

// ─── Server → Client ──────────────────────────────────────────────────────────

export interface ParticipantJoinedEvent {
  type: 'PARTICIPANT_JOINED';
  participant: ParticipantView;
}

export interface ParticipantLeftEvent {
  type: 'PARTICIPANT_LEFT';
  participantId: string;
}

export interface ParticipantListEvent {
  type: 'PARTICIPANT_LIST';
  participants: ParticipantView[];
}

export interface ChatMessageEvent {
  type: 'CHAT_MESSAGE';
  message: ChatMessage;
}

export interface ChatHistoryEvent {
  type: 'CHAT_HISTORY';
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface ErrorEvent {
  type: 'ERROR';
  code: string;
  message: string;
}

export type ServerEvent =
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | ParticipantListEvent
  | ChatMessageEvent
  | ChatHistoryEvent
  | ErrorEvent;
