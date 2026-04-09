// Tests for message length validation and input sanitization in the messages route
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db/client.js', () => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn() }),
}));

const ROOM_ID = 'room-uuid-msg-test';
const ROOM_SLUG = 'test-room-msg';
const PARTICIPANT_ID = 'part-uuid-msg';

describe('Message POST validation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function buildApp() {
    const { default: messages } = await import('../routes/messages.js');
    const app = new Hono();
    // Mount as if under /api/rooms/:slug/messages, but for unit tests use a fixed slug
    app.route('/:slug/messages', messages);
    return app;
  }

  it('rejects message exceeding 2000 characters with 400', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]); // room lookup

    const app = await buildApp();
    const longContent = 'a'.repeat(2001);

    const res = await app.request(`/${ROOM_SLUG}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: PARTICIPANT_ID, content: longContent }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('2000');
  });

  it('accepts message at exactly 2000 characters', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);   // room lookup
    mockSql.mockResolvedValueOnce([{                     // insert returns message
      id: 'msg-id',
      roomId: ROOM_ID,
      participantId: PARTICIPANT_ID,
      content: 'a'.repeat(2000),
      type: 'message',
      canvasX: null,
      canvasY: null,
      parentId: null,
      createdAt: new Date().toISOString(),
    }]);
    mockSql.mockResolvedValueOnce([]); // update room activity

    const app = await buildApp();
    const res = await app.request(`/${ROOM_SLUG}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: PARTICIPANT_ID, content: 'a'.repeat(2000) }),
    });

    expect(res.status).toBe(201);
  });

  it('strips HTML tags from message content — response is 201 and no HTML in content', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);  // room lookup
    // INSERT: return a message whose content is what the route passed in (simulate DB echo)
    mockSql.mockImplementationOnce(async (...args: unknown[]) => {
      // Tagged template literal: args = [templateStrings, ...values]
      // Non-clientId INSERT values: roomId(1), participantId(2), content(3), type(4), ...
      const content = args[3] as string; // 4th arg (index 3) = content
      return [{
        id: 'msg-id', roomId: ROOM_ID, participantId: PARTICIPANT_ID,
        content, type: 'message', canvasX: null, canvasY: null,
        parentId: null, createdAt: new Date().toISOString(),
      }];
    });
    mockSql.mockResolvedValueOnce([]); // update room activity

    const app = await buildApp();
    const res = await app.request(`/${ROOM_SLUG}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        content: '<script>alert("xss")</script>Hello',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { content: string };
    // The stored content must not include any HTML tags
    expect(body.content).not.toContain('<script>');
    // Non-tag text is preserved
    expect(body.content).toContain('Hello');
  });

  it('rejects empty content after sanitization', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);

    const app = await buildApp();
    const res = await app.request(`/${ROOM_SLUG}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        content: '<p></p>', // becomes empty after stripping tags
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects missing content with 400', async () => {
    const app = await buildApp();
    const res = await app.request(`/${ROOM_SLUG}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: PARTICIPANT_ID }),
    });
    expect(res.status).toBe(400);
  });
});
