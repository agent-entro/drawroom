/**
 * useYjsChat unit tests.
 * Tests the Y.Map storage, send, and comment-pin filtering.
 * WebsocketProvider is mocked — only the Yjs document logic is tested.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

// ── Mock y-websocket ───────────────────────────────────────────────────────────

// We replace WebsocketProvider with a lightweight fake that exposes
// the Y.Doc immediately (no real network connection).
vi.mock('y-websocket', () => {
  const EventEmitter = class {
    private _listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    on(event: string, fn: (...args: unknown[]) => void) {
      (this._listeners[event] ??= []).push(fn);
    }
    off(event: string, fn: (...args: unknown[]) => void) {
      this._listeners[event] = (this._listeners[event] ?? []).filter((l) => l !== fn);
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this._listeners[event] ?? []) fn(...args);
    }
  };

  class FakeAwareness extends EventEmitter {
    clientID = 1;
    private _states = new Map<number, unknown>();
    getStates() { return this._states; }
    setLocalStateField(_field: string, _value: unknown) { /* no-op */ }
  }

  class FakeProvider extends EventEmitter {
    awareness = new FakeAwareness();
    constructor(_url: string, _room: string, _doc: Y.Doc) {
      super();
      // Emit 'connected' status immediately
      setTimeout(() => this.emit('status', { status: 'connected' }), 0);
      // Emit 'sync' true immediately
      setTimeout(() => this.emit('sync', true), 0);
    }
    disconnect() { /* no-op */ }
  }

  return { WebsocketProvider: FakeProvider };
});

// ── Mock REST API ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.ts', () => ({
  getMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false, nextCursor: null }),
  getParticipants: vi.fn().mockResolvedValue({ participants: [] }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

import { useYjsChat } from '../useYjsChat.ts';

const TEST_PARTICIPANT = {
  id: 'p-1',
  displayName: 'Alice',
  color: '#4A90D9',
};

describe('useYjsChat', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('initialises with empty messages', () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: TEST_PARTICIPANT }),
    );
    expect(result.current.messages).toEqual([]);
    expect(result.current.commentPins).toEqual([]);
  });

  it('sendMessage adds a message to the local Y.Map and is visible immediately', async () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: TEST_PARTICIPANT }),
    );

    act(() => {
      result.current.sendMessage('Hello world');
    });

    expect(result.current.messages).toHaveLength(1);
    const msg = result.current.messages[0]!;
    expect(msg.content).toBe('Hello world');
    expect(msg.type).toBe('message');
    expect(msg.participantId).toBe('p-1');
    expect(msg.displayName).toBe('Alice');
    expect(msg.color).toBe('#4A90D9');
    expect(msg.canvasX).toBeNull();
    expect(msg.canvasY).toBeNull();
  });

  it('sendMessage with canvas coords creates a comment', () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: TEST_PARTICIPANT }),
    );

    act(() => {
      result.current.sendMessage('Look here', { canvasX: 100, canvasY: 200, type: 'comment' });
    });

    expect(result.current.messages).toHaveLength(1);
    const msg = result.current.messages[0]!;
    expect(msg.type).toBe('comment');
    expect(msg.canvasX).toBe(100);
    expect(msg.canvasY).toBe(200);
  });

  it('commentPins only includes comment-type messages with canvas coords', () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: TEST_PARTICIPANT }),
    );

    act(() => {
      result.current.sendMessage('Regular message');
      result.current.sendMessage('Pinned comment', { canvasX: 50, canvasY: 75, type: 'comment' });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.commentPins).toHaveLength(1);
    expect(result.current.commentPins[0]!.content).toBe('Pinned comment');
  });

  it('ignores empty messages', () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: TEST_PARTICIPANT }),
    );

    act(() => {
      result.current.sendMessage('   '); // only whitespace
    });

    expect(result.current.messages).toHaveLength(0);
  });

  it('truncates messages over MAX_MESSAGE_LENGTH', () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: TEST_PARTICIPANT }),
    );

    const longMsg = 'x'.repeat(3000);
    act(() => {
      result.current.sendMessage(longMsg);
    });

    expect(result.current.messages[0]!.content.length).toBe(2000);
  });

  it('does not send when participant is null', () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: null }),
    );

    act(() => {
      result.current.sendMessage('Hello');
    });

    expect(result.current.messages).toHaveLength(0);
  });

  it('messages are sorted by createdAt', () => {
    const { result } = renderHook(() =>
      useYjsChat({ roomSlug: 'test-room', participant: TEST_PARTICIPANT }),
    );

    // Send two messages; they should be in chronological order
    act(() => {
      result.current.sendMessage('first');
    });
    // Advance time to ensure different timestamps
    act(() => {
      vi.advanceTimersByTime(10);
      result.current.sendMessage('second');
    });

    expect(result.current.messages[0]!.content).toBe('first');
    expect(result.current.messages[1]!.content).toBe('second');
  });
});
