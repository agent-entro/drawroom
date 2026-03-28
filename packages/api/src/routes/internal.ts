// /api/internal — server-to-server routes used by the YWS process
//
// Protected by X-Internal-Secret header (shared secret, not exposed to clients).
// These routes skip user sessionToken validation because the caller (yws) is
// trusted infrastructure running on the same host.
import { Hono } from 'hono';
import { sql } from '../db/client.js';

const internal = new Hono();

const INTERNAL_SECRET = process.env['INTERNAL_SECRET'] ?? 'local-dev-secret';

async function authMiddleware(
  c: { req: { header: (name: string) => string | undefined }; json: (body: unknown, status?: number) => Response },
  next: () => Promise<void>,
): Promise<Response | void> {
  if (c.req.header('x-internal-secret') !== INTERNAL_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return next();
}

internal.use('*', authMiddleware);

// PATCH /api/internal/rooms/:slug/participants/:id/heartbeat
// Called by the YWS server when it detects an awareness update with a participantId.
// Updates last_seen_at without requiring the user's sessionToken.
internal.patch('/rooms/:slug/participants/:id/heartbeat', async (c) => {
  const slug = c.req.param('slug');
  const participantId = c.req.param('id');

  try {
    const [room] = await sql`
      SELECT id FROM rooms WHERE slug = ${slug} AND status != 'deleted'
    `;
    if (!room) return c.json({ error: 'Room not found' }, 404);

    const roomId = room['id'] as string;

    await sql`
      UPDATE participants SET last_seen_at = now()
      WHERE id = ${participantId} AND room_id = ${roomId}
    `;

    await sql`
      UPDATE rooms SET last_active_at = now()
      WHERE id = ${roomId}
    `;

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[internal] heartbeat error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default internal;
