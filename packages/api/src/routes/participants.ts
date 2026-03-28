// /api/rooms/:slug/participants — participant management endpoints
import { Hono } from 'hono';
import { sql } from '../db/client.js';
import type { Participant, ParticipantView } from '@drawroom/shared';
import { PARTICIPANT_COLORS } from '@drawroom/shared';

const participants = new Hono();

// POST /api/rooms/:slug/participants — join room (create or rejoin)
participants.post('/', async (c) => {
  const slug = c.req.param('slug') as string;

  try {
    const body = await c.req.json<{
      displayName: string;
      sessionToken?: string;
      color?: string;
    }>();

    if (!body.displayName?.trim()) {
      return c.json({ error: 'displayName is required' }, 400);
    }

    const [room] = await sql`
      SELECT id FROM rooms WHERE slug = ${slug} AND status != 'deleted'
    `;
    if (!room) return c.json({ error: 'Room not found' }, 404);

    const roomId = room['id'] as string;

    // Try to rejoin with existing session token
    if (body.sessionToken) {
      const [existing] = await sql<Participant[]>`
        UPDATE participants
        SET last_seen_at = now()
        WHERE session_token = ${body.sessionToken} AND room_id = ${roomId}
        RETURNING
          id,
          room_id        AS "roomId",
          display_name   AS "displayName",
          color,
          session_token  AS "sessionToken",
          joined_at      AS "joinedAt",
          last_seen_at   AS "lastSeenAt",
          user_id        AS "userId"
      `;

      if (existing) {
        await sql`
          UPDATE rooms
          SET last_active_at = now(), expires_at = now() + INTERVAL '7 days'
          WHERE id = ${roomId}
        `;
        return c.json(existing, 200);
      }
    }

    // Create new participant
    const [countRow] = await sql`
      SELECT COUNT(*)::int AS count FROM participants WHERE room_id = ${roomId}
    `;
    const colorIndex = ((countRow?.['count'] as number) ?? 0) % PARTICIPANT_COLORS.length;
    const color = body.color ?? PARTICIPANT_COLORS[colorIndex] ?? PARTICIPANT_COLORS[0]!;
    const displayName = body.displayName.trim().slice(0, 30);

    const [participant] = await sql<Participant[]>`
      INSERT INTO participants (room_id, display_name, color, session_token)
      VALUES (${roomId}, ${displayName}, ${color}, gen_random_uuid())
      RETURNING
        id,
        room_id        AS "roomId",
        display_name   AS "displayName",
        color,
        session_token  AS "sessionToken",
        joined_at      AS "joinedAt",
        last_seen_at   AS "lastSeenAt",
        user_id        AS "userId"
    `;

    await sql`
      UPDATE rooms
      SET last_active_at = now(), expires_at = now() + INTERVAL '7 days'
      WHERE id = ${roomId}
    `;

    return c.json(participant, 201);
  } catch (err) {
    console.error('[participants] POST error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/rooms/:slug/participants — list active participants (last 5 min)
participants.get('/', async (c) => {
  const slug = c.req.param('slug') as string;

  try {
    const [room] = await sql`
      SELECT id FROM rooms WHERE slug = ${slug} AND status != 'deleted'
    `;
    if (!room) return c.json({ error: 'Room not found' }, 404);

    const roomId = room['id'] as string;

    const rows = await sql<ParticipantView[]>`
      SELECT
        id,
        display_name AS "displayName",
        color,
        joined_at    AS "joinedAt",
        last_seen_at AS "lastSeenAt"
      FROM participants
      WHERE room_id = ${roomId}
        AND last_seen_at > now() - INTERVAL '5 minutes'
      ORDER BY joined_at ASC
    `;

    return c.json({ participants: rows });
  } catch (err) {
    console.error('[participants] GET error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PATCH /api/rooms/:slug/participants/:id/heartbeat — update last_seen_at
participants.patch('/:id/heartbeat', async (c) => {
  const slug = c.req.param('slug') as string;
  const id = c.req.param('id') as string;

  try {
    const body = await c.req.json<{ sessionToken?: string }>().catch(() => null);
    if (!body?.sessionToken) {
      return c.json({ error: 'sessionToken is required' }, 400);
    }
    const { sessionToken } = body;

    const [room] = await sql`
      SELECT id FROM rooms WHERE slug = ${slug} AND status != 'deleted'
    `;
    if (!room) return c.json({ error: 'Room not found' }, 404);

    const roomId = room['id'] as string;

    await sql`
      UPDATE participants SET last_seen_at = now()
      WHERE id = ${id} AND room_id = ${roomId} AND session_token = ${sessionToken}
    `;

    await sql`
      UPDATE rooms SET last_active_at = now()
      WHERE id = ${roomId}
    `;

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[participants] PATCH heartbeat error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default participants;
