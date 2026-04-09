// Structural / runtime smoke tests for shared types
// (TypeScript types are compile-time, but we can verify object shapes at runtime)
import { describe, it, expect } from 'vitest';
import type { Room, Participant, ChatMessage, ParticipantView } from './types.js';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'uuid-room-1',
    slug: 'bright-owl-742',
    title: 'Test Room',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    isPersistent: false,
    ownerId: null,
    maxParticipants: 5,
    status: 'active',
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'uuid-p-1',
    roomId: 'uuid-room-1',
    displayName: 'Alice',
    color: '#4A90D9',
    sessionToken: 'tok_abc123',
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    userId: null,
    ...overrides,
  };
}

describe('Room type', () => {
  it('constructs a valid room object', () => {
    const room = makeRoom();
    expect(room.slug).toBe('bright-owl-742');
    expect(room.status).toBe('active');
    expect(room.isPersistent).toBe(false);
    expect(room.ownerId).toBeNull();
  });

  it('accepts archived status', () => {
    const room = makeRoom({ status: 'archived' });
    expect(room.status).toBe('archived');
  });
});

describe('Participant type', () => {
  it('constructs a valid participant', () => {
    const p = makeParticipant();
    expect(p.displayName).toBe('Alice');
    expect(p.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('can be converted to ParticipantView (no session_token)', () => {
    const p = makeParticipant();
    const view: ParticipantView = {
      id: p.id,
      displayName: p.displayName,
      color: p.color,
      joinedAt: p.joinedAt,
      lastSeenAt: p.lastSeenAt,
    };
    expect(view).not.toHaveProperty('sessionToken');
    expect(view.displayName).toBe('Alice');
  });
});

describe('ChatMessage type', () => {
  it('constructs a regular chat message', () => {
    const msg: ChatMessage = {
      id: 'uuid-msg-1',
      roomId: 'uuid-room-1',
      participantId: 'uuid-p-1',
      content: 'Hello world',
      type: 'message',
      canvasX: null,
      canvasY: null,
      parentId: null,
      createdAt: new Date().toISOString(),
    };
    expect(msg.content).toBe('Hello world');
    expect(msg.canvasX).toBeNull();
  });

  it('constructs a comment-pin message with canvas coords', () => {
    const msg: ChatMessage = {
      id: 'uuid-msg-2',
      roomId: 'uuid-room-1',
      participantId: 'uuid-p-1',
      content: 'Look here!',
      type: 'comment',
      canvasX: 450,
      canvasY: 320,
      parentId: null,
      createdAt: new Date().toISOString(),
    };
    expect(msg.canvasX).toBe(450);
    expect(msg.canvasY).toBe(320);
  });
});
