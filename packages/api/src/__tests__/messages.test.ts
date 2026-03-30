// Unit tests for the messages route — mocks DB
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db/client.js', () => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn() }),
}));

const ROOM_ID = 'room-uuid-1';
const PARTICIPANT_ID = 'part-uuid-1';

const MOCK_MESSAGE = {
  id: 'msg-uuid-1',
  roomId: ROOM_ID,
  participantId: PARTICIPANT_ID,
  content: 'Hello world',
  type: 'message',
  canvasX: null,
  canvasY: null,
  createdAt: '2026-01-01T10:00:00.000Z',
};

const MOCK_MESSAGE_WITH_PARTICIPANT = {
  ...MOCK_MESSAGE,
  displayName: 'Alice',
  color: '#4A90D9',
};

describe('Messages route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/rooms/:slug/messages', () => {
    it('returns 404 for unknown room', async () => {
      const { sql } = await import('../db/client.js');
      vi.mocked(sql).mockResolvedValueOnce([]); // room not found

      const { default: messages } = await import('../routes/messages.js');
      const app = new Hono();
      app.route('/:slug/messages', messages);

      const res = await app.request('/unknown-room/messages');
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Room not found');
    });

    it('returns paginated messages with participant display info', async () => {
      const { sql } = await import('../db/client.js');
      const mockSql = vi.mocked(sql);

      mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]); // room lookup
      mockSql.mockResolvedValueOnce([MOCK_MESSAGE_WITH_PARTICIPANT]); // messages JOIN participants

      const { default: messages } = await import('../routes/messages.js');
      const app = new Hono();
      app.route('/:slug/messages', messages);

      const res = await app.request('/test-room/messages');
      expect(res.status).toBe(200);

      const body = await res.json() as {
        messages: typeof MOCK_MESSAGE_WITH_PARTICIPANT[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]!.content).toBe('Hello world');
      // Verify displayName and color are included in the response
      expect(body.messages[0]!.displayName).toBe('Alice');
      expect(body.messages[0]!.color).toBe('#4A90D9');
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeNull();
    });

    it('returns empty list when room has no messages', async () => {
      const { sql } = await import('../db/client.js');
      const mockSql = vi.mocked(sql);

      mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]); // room lookup
      mockSql.mockResolvedValueOnce([]); // no messages

      const { default: messages } = await import('../routes/messages.js');
      const app = new Hono();
      app.route('/:slug/messages', messages);

      const res = await app.request('/test-room/messages');
      expect(res.status).toBe(200);
      const body = await res.json() as { messages: unknown[]; hasMore: boolean };
      expect(body.messages).toHaveLength(0);
      expect(body.hasMore).toBe(false);
    });
  });

  describe('POST /api/rooms/:slug/messages', () => {
    it('creates a new message and returns 201', async () => {
      const { sql } = await import('../db/client.js');
      const mockSql = vi.mocked(sql);

      mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]); // room lookup
      mockSql.mockResolvedValueOnce([MOCK_MESSAGE]);     // insert
      mockSql.mockResolvedValueOnce([]);                  // update room activity

      const { default: messages } = await import('../routes/messages.js');
      const app = new Hono();
      app.route('/:slug/messages', messages);

      const res = await app.request('/test-room/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: PARTICIPANT_ID, content: 'Hello world' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as typeof MOCK_MESSAGE;
      expect(body.content).toBe('Hello world');
      expect(body.type).toBe('message');
    });

    it('creates a canvas-anchored comment with coordinates', async () => {
      const { sql } = await import('../db/client.js');
      const mockSql = vi.mocked(sql);

      const commentMsg = { ...MOCK_MESSAGE, type: 'comment', canvasX: 100, canvasY: 200 };
      mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
      mockSql.mockResolvedValueOnce([commentMsg]);
      mockSql.mockResolvedValueOnce([]);

      const { default: messages } = await import('../routes/messages.js');
      const app = new Hono();
      app.route('/:slug/messages', messages);

      const res = await app.request('/test-room/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId: PARTICIPANT_ID,
          content: 'Check this spot',
          type: 'comment',
          canvasX: 100,
          canvasY: 200,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as typeof commentMsg;
      expect(body.type).toBe('comment');
      expect(body.canvasX).toBe(100);
      expect(body.canvasY).toBe(200);
    });

    it('returns 400 when participantId or content is missing', async () => {
      const { default: messages } = await import('../routes/messages.js');
      const app = new Hono();
      app.route('/:slug/messages', messages);

      const res = await app.request('/test-room/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'No participant id' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when room does not exist', async () => {
      const { sql } = await import('../db/client.js');
      vi.mocked(sql).mockResolvedValueOnce([]); // room not found

      const { default: messages } = await import('../routes/messages.js');
      const app = new Hono();
      app.route('/:slug/messages', messages);

      const res = await app.request('/unknown-room/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: 'p-1', content: 'Hello' }),
      });

      expect(res.status).toBe(404);
    });
  });
});
