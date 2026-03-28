// /api/rooms/:slug/messages — chat history endpoint
import { Hono } from 'hono';
import { sql } from '../db/client.js';
import type { ChatMessage } from '@drawroom/shared';
import { CHAT_HISTORY_PAGE_SIZE } from '@drawroom/shared';

const messages = new Hono();

// GET /api/rooms/:slug/messages?cursor=<id>&limit=<n>
messages.get('/', async (c) => {
  const slug = c.req.param('slug') as string;
  const limitStr = c.req.query('limit');
  const cursor = c.req.query('cursor');
  const limit = Math.min(parseInt(limitStr ?? String(CHAT_HISTORY_PAGE_SIZE), 10), 200);

  try {
    // Verify room exists
    const [room] = await sql`
      SELECT id FROM rooms WHERE slug = ${slug} AND status != 'deleted'
    `;
    if (!room) return c.json({ error: 'Room not found' }, 404);

    const roomId = room['id'] as string;

    let rows: ChatMessage[];
    if (cursor) {
      // Keyset pagination: messages older than the cursor message
      rows = await sql<ChatMessage[]>`
        SELECT
          m.id,
          m.room_id      AS "roomId",
          m.participant_id AS "participantId",
          m.content,
          m.type,
          m.canvas_x     AS "canvasX",
          m.canvas_y     AS "canvasY",
          m.created_at   AS "createdAt"
        FROM chat_messages m
        WHERE m.room_id = ${roomId}
          AND m.created_at < (SELECT created_at FROM chat_messages WHERE id = ${cursor})
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql<ChatMessage[]>`
        SELECT
          m.id,
          m.room_id      AS "roomId",
          m.participant_id AS "participantId",
          m.content,
          m.type,
          m.canvas_x     AS "canvasX",
          m.canvas_y     AS "canvasY",
          m.created_at   AS "createdAt"
        FROM chat_messages m
        WHERE m.room_id = ${roomId}
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `;
    }

    // Results are newest-first; reverse for chronological display
    const messages = rows.reverse();
    const hasMore = rows.length === limit;
    const nextCursor = hasMore && messages.length > 0 ? (messages[0]?.id ?? null) : null;

    return c.json({ messages, hasMore, nextCursor });
  } catch (err) {
    console.error('[messages] GET error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /api/rooms/:slug/messages — WebSocket fallback (Phase 3 primary path)
messages.post('/', async (c) => {
  const slug = c.req.param('slug') as string;

  try {
    const body = await c.req.json<{
      participantId: string;
      content: string;
      type?: string;
      canvasX?: number;
      canvasY?: number;
    }>();

    if (!body.participantId || !body.content?.trim()) {
      return c.json({ error: 'participantId and content are required' }, 400);
    }

    const [room] = await sql`
      SELECT id FROM rooms WHERE slug = ${slug} AND status != 'deleted'
    `;
    if (!room) return c.json({ error: 'Room not found' }, 404);

    const roomId = room['id'] as string;
    const type = body.type ?? 'message';

    const [msg] = await sql<ChatMessage[]>`
      INSERT INTO chat_messages (room_id, participant_id, content, type, canvas_x, canvas_y)
      VALUES (
        ${roomId},
        ${body.participantId},
        ${body.content.trim()},
        ${type},
        ${body.canvasX ?? null},
        ${body.canvasY ?? null}
      )
      RETURNING
        id,
        room_id        AS "roomId",
        participant_id AS "participantId",
        content,
        type,
        canvas_x       AS "canvasX",
        canvas_y       AS "canvasY",
        created_at     AS "createdAt"
    `;

    // Update room activity
    await sql`
      UPDATE rooms
      SET last_active_at = now(), expires_at = now() + INTERVAL '7 days'
      WHERE id = ${roomId}
    `;

    return c.json(msg, 201);
  } catch (err) {
    console.error('[messages] POST error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default messages;
