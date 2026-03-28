// Verify event type discriminants are correct strings
import { describe, it, expect } from 'vitest';
import type { ClientEvent, ServerEvent, JoinEvent, ChatSendEvent } from './events.js';

describe('ClientEvent discriminants', () => {
  it('JOIN event has correct type literal', () => {
    const event: JoinEvent = {
      type: 'JOIN',
      displayName: 'Alice',
      sessionToken: 'tok_abc123',
    };
    expect(event.type).toBe('JOIN');
  });

  it('CHAT_SEND event has correct type literal', () => {
    const event: ChatSendEvent = {
      type: 'CHAT_SEND',
      content: 'Hello!',
      messageType: 'message',
    };
    expect(event.type).toBe('CHAT_SEND');
    expect(event.canvasX).toBeUndefined();
  });

  it('CHAT_SEND with canvas coords is a comment', () => {
    const event: ChatSendEvent = {
      type: 'CHAT_SEND',
      content: 'Over here!',
      messageType: 'comment',
      canvasX: 100,
      canvasY: 200,
    };
    expect(event.messageType).toBe('comment');
    expect(event.canvasX).toBe(100);
  });

  it('discriminated union narrows type correctly', () => {
    const events: ClientEvent[] = [
      { type: 'JOIN', displayName: 'Bob', sessionToken: 'tok_xyz' },
      { type: 'HEARTBEAT' },
      { type: 'LEAVE' },
    ];
    const types = events.map((e) => e.type);
    expect(types).toEqual(['JOIN', 'HEARTBEAT', 'LEAVE']);
  });
});

describe('ServerEvent discriminants', () => {
  it('ERROR event has code and message', () => {
    const event: ServerEvent = {
      type: 'ERROR',
      code: 'PARSE_ERROR',
      message: 'Invalid JSON',
    };
    expect(event.type).toBe('ERROR');
    if (event.type === 'ERROR') {
      expect(event.code).toBe('PARSE_ERROR');
    }
  });

  it('PARTICIPANT_LEFT event has participantId', () => {
    const event: ServerEvent = {
      type: 'PARTICIPANT_LEFT',
      participantId: 'uuid-p-1',
    };
    expect(event.type).toBe('PARTICIPANT_LEFT');
    if (event.type === 'PARTICIPANT_LEFT') {
      expect(event.participantId).toBe('uuid-p-1');
    }
  });
});
