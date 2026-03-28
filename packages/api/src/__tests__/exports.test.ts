// Unit tests for the exports route — mocks DB and fs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db/client.js', () => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn() }),
}));

vi.mock('fs', () => ({
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => { if (event === 'finish') cb(); }),
  })),
  createReadStream: vi.fn(() => ({
    on: vi.fn((event: string, cb: (data?: unknown) => void) => {
      if (event === 'end') cb();
    }),
  })),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1234 }),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-export-uuid'),
}));

const ROOM_ID = 'room-uuid-1';
const ROOM_SLUG = 'test-room';
const PARTICIPANT_ID = 'part-uuid-1';
const SESSION_TOKEN = 'sess-token-abc';

describe('Exports route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST / with multipart form data → stores export, returns 201 with downloadUrl', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room lookup by slug
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
    // participant auth (no sessionToken needed for multipart)
    mockSql.mockResolvedValueOnce([{ id: PARTICIPANT_ID }]);
    // insert export
    mockSql.mockResolvedValueOnce([]);

    const { default: exports_ } = await import('../routes/exports.js');
    const app = new Hono();
    app.route('/', exports_);

    const form = new FormData();
    form.append('roomSlug', ROOM_SLUG);
    form.append('participantId', PARTICIPANT_ID);
    form.append('format', 'png');
    form.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'export.png');

    const res = await app.request('/', { method: 'POST', body: form });

    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; downloadUrl: string };
    expect(body.id).toBe('test-export-uuid');
    expect(body.downloadUrl).toBe('/api/exports/test-export-uuid/download');
  });

  it('POST / with multipart, missing fields → returns 400', async () => {
    const { default: exports_ } = await import('../routes/exports.js');
    const app = new Hono();
    app.route('/', exports_);

    const form = new FormData();
    form.append('roomSlug', ROOM_SLUG);
    // missing participantId, format, file

    const res = await app.request('/', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('POST / with multipart, unknown room → returns 404', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room not found
    mockSql.mockResolvedValueOnce([]);

    const { default: exports_ } = await import('../routes/exports.js');
    const app = new Hono();
    app.route('/', exports_);

    const form = new FormData();
    form.append('roomSlug', 'unknown-room');
    form.append('participantId', PARTICIPANT_ID);
    form.append('format', 'png');
    form.append('file', new Blob([]), 'export.png');

    const res = await app.request('/', { method: 'POST', body: form });
    expect(res.status).toBe(404);
  });

  it('POST / with multipart, unauthorized participant → returns 401', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room found
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
    // participant not found in this room
    mockSql.mockResolvedValueOnce([]);

    const { default: exports_ } = await import('../routes/exports.js');
    const app = new Hono();
    app.route('/', exports_);

    const form = new FormData();
    form.append('roomSlug', ROOM_SLUG);
    form.append('participantId', 'wrong-participant');
    form.append('format', 'png');
    form.append('file', new Blob([]), 'export.png');

    const res = await app.request('/', { method: 'POST', body: form });
    expect(res.status).toBe(401);
  });

  it('POST / with JSON base64 (legacy) → stores export, returns 201', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room lookup by id
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
    // session token validation
    mockSql.mockResolvedValueOnce([{ id: PARTICIPANT_ID }]);
    // insert export
    mockSql.mockResolvedValueOnce([]);

    const { default: exports_ } = await import('../routes/exports.js');
    const app = new Hono();
    app.route('/', exports_);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: ROOM_ID,
        participantId: PARTICIPANT_ID,
        sessionToken: SESSION_TOKEN,
        format: 'png',
        dataBase64: Buffer.from('fake-png-data').toString('base64'),
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; downloadUrl: string };
    expect(body.downloadUrl).toContain('/api/exports/');
  });
});
