// /api/exports — canvas export upload + download
//
// POST /api/exports
//   Accepts multipart/form-data (preferred — binary, no base64 overhead) or
//   application/json with base64 (legacy fallback).
//
//   Multipart fields:
//     roomSlug      string  — room slug (server resolves → roomId)
//     participantId string  — participant performing the export (auth)
//     format        'png' | 'svg'
//     file          Blob    — raw binary file content
//
//   JSON body (legacy):
//     roomId, participantId, sessionToken, format, dataBase64
//
// GET /api/exports/:id/download  — stream stored export file
import { Hono } from 'hono';
import { createWriteStream, createReadStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { sql } from '../db/client.js';

const exports_ = new Hono();

const EXPORT_DIR = process.env['EXPORT_DIR'] ?? './data/exports';

// POST /api/exports
exports_.post('/', async (c) => {
  const contentType = c.req.header('content-type') ?? '';

  let roomId: string | undefined;
  let participantId: string | undefined;
  let format: 'png' | 'svg' | undefined;
  let fileBuffer: Buffer | undefined;

  try {
    if (contentType.includes('multipart/form-data')) {
      // ── Multipart binary upload (preferred) ────────────────────────────────
      const form = await c.req.formData();
      const roomSlug = form.get('roomSlug')?.toString();
      participantId = form.get('participantId')?.toString();
      format = form.get('format')?.toString() as 'png' | 'svg' | undefined;
      const file = form.get('file') as File | null;

      if (!roomSlug || !participantId || !format || !file) {
        return c.json({ error: 'roomSlug, participantId, format, and file are required' }, 400);
      }

      // Resolve roomId from slug
      const [room] = await sql`
        SELECT id FROM rooms WHERE slug = ${roomSlug} AND status != 'deleted'
      `;
      if (!room) return c.json({ error: 'Room not found' }, 404);
      roomId = room['id'] as string;

      // Auth: participant must belong to this room
      const [p] = await sql`
        SELECT id FROM participants WHERE id = ${participantId} AND room_id = ${roomId}
      `;
      if (!p) return c.json({ error: 'Unauthorized' }, 401);

      fileBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      // ── Legacy JSON + base64 ───────────────────────────────────────────────
      const body = await c.req.json<{
        roomId: string;
        participantId: string;
        sessionToken: string;
        format: 'png' | 'svg';
        dataBase64: string;
      }>().catch(() => null);

      if (!body?.roomId || !body.participantId || !body.sessionToken || !body.format || !body.dataBase64) {
        return c.json(
          { error: 'roomId, participantId, sessionToken, format, and dataBase64 are required' },
          400,
        );
      }

      format = body.format;
      participantId = body.participantId;

      // Validate roomId against the database (prevents path traversal)
      const [room] = await sql`
        SELECT id FROM rooms WHERE id = ${body.roomId} AND status != 'deleted'
      `;
      if (!room) return c.json({ error: 'Room not found' }, 404);
      roomId = room['id'] as string;

      // Validate sessionToken — participant must exist in this room
      const [participant] = await sql`
        SELECT id FROM participants
        WHERE session_token = ${body.sessionToken} AND room_id = ${roomId}
      `;
      if (!participant) return c.json({ error: 'Unauthorized' }, 401);

      fileBuffer = Buffer.from(body.dataBase64, 'base64');
    }

    if (format !== 'png' && format !== 'svg') {
      return c.json({ error: 'format must be png or svg' }, 400);
    }

    const id = randomUUID();
    const filename = `${id}.${format}`;
    const dirPath = join(EXPORT_DIR, roomId);
    await mkdir(dirPath, { recursive: true });

    const filePath = join(dirPath, filename);
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(filePath);
      ws.write(fileBuffer!);
      ws.end();
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    const fileStat = await stat(filePath);
    const relPath = join(roomId, filename);

    await sql`
      INSERT INTO exports (id, room_id, format, file_path, file_size_bytes, requested_by)
      VALUES (${id}, ${roomId}, ${format}, ${relPath}, ${fileStat.size}, ${participantId})
    `;

    return c.json({ id, downloadUrl: `/api/exports/${id}/download` }, 201);
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
