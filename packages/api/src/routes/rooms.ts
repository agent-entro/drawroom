// /api/rooms — room CRUD endpoints
import { Hono } from 'hono';
import { humanId } from 'human-id';
import { sql } from '../db/client.js';
import type { Room } from '@drawroom/shared';

const rooms = new Hono();

// POST /api/rooms — create a new room
rooms.post('/', async (c) => {
  const slug = humanId({ separator: '-', capitalize: false });
  const body = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined as string | undefined }));
  const title = body.title?.trim() || 'Untitled Room';

  try {
    const [room] = await sql<Room[]>`
      INSERT INTO rooms (slug, title)
      VALUES (${slug}, ${title})
      RETURNING
        id,
        slug,
        title,
        created_at   AS "createdAt",
        last_active_at AS "lastActiveAt",
        expires_at   AS "expiresAt",
        is_persistent AS "isPersistent",
        owner_id     AS "ownerId",
        max_participants AS "maxParticipants",
        status
    `;

    const roomUrl = `${c.req.url.replace(/\/api\/rooms.*$/, '')}/r/${slug}`;
    return c.json({ slug, roomUrl, room }, 201);
  } catch (err) {
    console.error('[rooms] POST /api/rooms error:', err);
    return c.json({ error: 'Failed to create room' }, 500);
  }
});

// GET /api/rooms/:slug — room metadata
rooms.get('/:slug', async (c) => {
  const { slug } = c.req.param();

  try {
    const [room] = await sql<Room[]>`
      SELECT
        id,
        slug,
        title,
        created_at   AS "createdAt",
        last_active_at AS "lastActiveAt",
        expires_at   AS "expiresAt",
        is_persistent AS "isPersistent",
        owner_id     AS "ownerId",
        max_participants AS "maxParticipants",
        status
      FROM rooms
      WHERE slug = ${slug} AND status != 'deleted'
    `;

    if (!room) return c.json({ error: 'Room not found' }, 404);
    return c.json(room);
  } catch (err) {
    console.error('[rooms] GET /api/rooms/:slug error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PATCH /api/rooms/:slug — update room title
rooms.patch('/:slug', async (c) => {
  const { slug } = c.req.param();
  const body = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined as string | undefined }));
  const title = body.title?.trim();
  if (!title) return c.json({ error: 'title is required' }, 400);

  try {
    const [room] = await sql<Room[]>`
      UPDATE rooms
      SET title = ${title}, last_active_at = now(), expires_at = now() + INTERVAL '7 days'
      WHERE slug = ${slug} AND status != 'deleted'
      RETURNING
        id,
        slug,
        title,
        created_at   AS "createdAt",
        last_active_at AS "lastActiveAt",
        expires_at   AS "expiresAt",
        is_persistent AS "isPersistent",
        owner_id     AS "ownerId",
        max_participants AS "maxParticipants",
        status
    `;

    if (!room) return c.json({ error: 'Room not found' }, 404);
    return c.json(room);
  } catch (err) {
    console.error('[rooms] PATCH /api/rooms/:slug error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default rooms;
