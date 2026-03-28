// /api/exports — canvas export upload + download
import { Hono } from 'hono';
import { createWriteStream, createReadStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { sql } from '../db/client.js';

const exports_ = new Hono();

const EXPORT_DIR = process.env['EXPORT_DIR'] ?? './data/exports';

// POST /api/exports — store a canvas export blob, return download URL
exports_.post('/', async (c) => {
  const body = await c.req.json<{
    roomId: string;
    participantId: string;
    sessionToken: string;
    format: 'png' | 'svg';
    dataBase64: string; // base64-encoded file content
  }>().catch(() => null);

  if (!body?.roomId || !body.participantId || !body.sessionToken || !body.format || !body.dataBase64) {
    return c.json({ error: 'roomId, participantId, sessionToken, format, and dataBase64 are required' }, 400);
  }

  if (body.format !== 'png' && body.format !== 'svg') {
    return c.json({ error: 'format must be png or svg' }, 400);
  }

  try {
    // Validate roomId against the database (prevents path traversal via body.roomId)
    const [room] = await sql`
      SELECT id FROM rooms WHERE id = ${body.roomId} AND status != 'deleted'
    `;
    if (!room) return c.json({ error: 'Room not found' }, 404);
    const safeRoomId = room['id'] as string;

    // Validate sessionToken — participant must exist in this room
    const [participant] = await sql`
      SELECT id FROM participants
      WHERE session_token = ${body.sessionToken} AND room_id = ${safeRoomId}
    `;
    if (!participant) return c.json({ error: 'Unauthorized' }, 401);

    const id = randomUUID();
    const filename = `${id}.${body.format}`;
    const dirPath = join(EXPORT_DIR, safeRoomId);
    await mkdir(dirPath, { recursive: true });

    const filePath = join(dirPath, filename);
    const buffer = Buffer.from(body.dataBase64, 'base64');
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(filePath);
      ws.write(buffer);
      ws.end();
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    const fileStat = await stat(filePath);
    const relPath = join(safeRoomId, filename);

    await sql`
      INSERT INTO exports (id, room_id, format, file_path, file_size_bytes, requested_by)
      VALUES (${id}, ${safeRoomId}, ${body.format}, ${relPath}, ${fileStat.size}, ${body.participantId})
    `;

    const downloadUrl = `/api/exports/${id}/download`;
    return c.json({ id, downloadUrl }, 201);
  } catch (err) {
    console.error('[exports] POST error:', err);
    return c.json({ error: 'Failed to save export' }, 500);
  }
});

// GET /api/exports/:id/download — stream export file
exports_.get('/:id/download', async (c) => {
  const { id } = c.req.param();

  try {
    const [row] = await sql<{ filePath: string; format: 'png' | 'svg' }[]>`
      SELECT file_path AS "filePath", format
      FROM exports
      WHERE id = ${id}
    `;

    if (!row) return c.json({ error: 'Export not found' }, 404);

    const fullPath = join(EXPORT_DIR, row.filePath);
    const fileStat = await stat(fullPath).catch(() => null);
    if (!fileStat) return c.json({ error: 'Export file not found on disk' }, 404);

    const contentType = row.format === 'svg' ? 'image/svg+xml' : 'image/png';
    const filename = `drawroom-export.${row.format}`;

    const stream = createReadStream(fullPath);
    // Convert Node.js ReadStream to Web ReadableStream
    const readable = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err) => controller.error(err));
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(fileStat.size),
      },
    });
  } catch (err) {
    console.error('[exports] GET download error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default exports_;
