// Unit tests for the internal heartbeat route
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db/client.js', () => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn() }),
}));

const ROOM_ID = 'room-uuid-1';
const PARTICIPANT_ID = 'part-uuid-1';
const INTERNAL_SECRET = 'local-dev-secret';

describe('Internal route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure the INTERNAL_SECRET env var matches the test value
    process.env['INTERNAL_SECRET'] = INTERNAL_SECRET;
  });

  it('PATCH rooms/:slug/participants/:id/heartbeat with valid secret → 204', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]); // room lookup
    mockSql.mockResolvedValueOnce([]);                 // update participant
    mockSql.mockResolvedValueOnce([]);                 // update room

    const { default: internal } = await import('../routes/internal.js');
    const app = new Hono();
    app.route('/', internal);

    const res = await app.request(`/rooms/test-room/participants/${PARTICIPANT_ID}/heartbeat`, {
      method: 'PATCH',
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });

    expect(res.status).toBe(204);
  });

  it('PATCH without secret → 403', async () => {
    const { default: internal } = await import('../routes/internal.js');
    const app = new Hono();
    app.route('/', internal);

    const res = await app.request(`/rooms/test-room/participants/${PARTICIPANT_ID}/heartbeat`, {
      method: 'PATCH',
    });

    expect(res.status).toBe(403);
  });

  it('PATCH with wrong secret → 403', async () => {
    const { default: internal } = await import('../routes/internal.js');
    const app = new Hono();
    app.route('/', internal);

    const res = await app.request(`/rooms/test-room/participants/${PARTICIPANT_ID}/heartbeat`, {
      method: 'PATCH',
      headers: { 'x-internal-secret': 'wrong-secret' },
    });

    expect(res.status).toBe(403);
  });

  it('PATCH with valid secret but unknown room → 404', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    mockSql.mockResolvedValueOnce([]); // room not found

    const { default: internal } = await import('../routes/internal.js');
    const app = new Hono();
    app.route('/', internal);

    const res = await app.request(`/rooms/unknown-room/participants/${PARTICIPANT_ID}/heartbeat`, {
      method: 'PATCH',
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });

    expect(res.status).toBe(404);
  });
});
