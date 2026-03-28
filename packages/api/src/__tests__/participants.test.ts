// Unit tests for the participants route — mocks DB
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db/client.js', () => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn() }),
}));

const ROOM_ID = 'room-uuid-1';
const PARTICIPANT_ID = 'part-uuid-1';
const SESSION_TOKEN = 'sess-token-abc';

const MOCK_PARTICIPANT = {
  id: PARTICIPANT_ID,
  roomId: ROOM_ID,
  displayName: 'Amber Bear',
  color: '#4A90D9',
  sessionToken: SESSION_TOKEN,
  joinedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:01:00.000Z',
  userId: null,
};

describe('Participants route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST / with no session token → creates participant, returns 201', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room lookup
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
    // count for color assignment
    mockSql.mockResolvedValueOnce([{ count: 0 }]);
    // insert participant
    mockSql.mockResolvedValueOnce([MOCK_PARTICIPANT]);
    // update room
    mockSql.mockResolvedValueOnce([]);

    const { default: participants } = await import('../routes/participants.js');
    const app = new Hono();
    app.route('/:slug/participants', participants);

    const res = await app.request('/test-room/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Amber Bear' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as typeof MOCK_PARTICIPANT;
    expect(body.displayName).toBe('Amber Bear');
    expect(body.sessionToken).toBe(SESSION_TOKEN);
  });

  it('POST / with existing sessionToken → returns existing participant, 200', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room lookup
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
    // UPDATE participants returning existing
    mockSql.mockResolvedValueOnce([MOCK_PARTICIPANT]);
    // update room
    mockSql.mockResolvedValueOnce([]);

    const { default: participants } = await import('../routes/participants.js');
    const app = new Hono();
    app.route('/:slug/participants', participants);

    const res = await app.request('/test-room/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Amber Bear', sessionToken: SESSION_TOKEN }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as typeof MOCK_PARTICIPANT;
    expect(body.id).toBe(PARTICIPANT_ID);
  });

  it('GET / → returns list of participants', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room lookup
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
    // select participants
    mockSql.mockResolvedValueOnce([
      {
        id: PARTICIPANT_ID,
        displayName: 'Amber Bear',
        color: '#4A90D9',
        joinedAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:01:00.000Z',
      },
    ]);

    const { default: participants } = await import('../routes/participants.js');
    const app = new Hono();
    app.route('/:slug/participants', participants);

    const res = await app.request('/test-room/participants');
    expect(res.status).toBe(200);

    const body = await res.json() as { participants: unknown[] };
    expect(Array.isArray(body.participants)).toBe(true);
    expect(body.participants).toHaveLength(1);
  });

  it('PATCH /:id/heartbeat → returns 204', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room lookup
    mockSql.mockResolvedValueOnce([{ id: ROOM_ID }]);
    // update participant
    mockSql.mockResolvedValueOnce([]);
    // update room
    mockSql.mockResolvedValueOnce([]);

    const { default: participants } = await import('../routes/participants.js');
    const app = new Hono();
    app.route('/:slug/participants', participants);

    const res = await app.request(`/test-room/participants/${PARTICIPANT_ID}/heartbeat`, {
      method: 'PATCH',
    });

    expect(res.status).toBe(204);
  });

  it('POST / with missing displayName → returns 400', async () => {
    const { default: participants } = await import('../routes/participants.js');
    const app = new Hono();
    app.route('/:slug/participants', participants);

    const res = await app.request('/test-room/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('GET / with unknown room → returns 404', async () => {
    const { sql } = await import('../db/client.js');
    const mockSql = vi.mocked(sql);

    // room not found
    mockSql.mockResolvedValueOnce([]);

    const { default: participants } = await import('../routes/participants.js');
    const app = new Hono();
    app.route('/:slug/participants', participants);

    const res = await app.request('/unknown-room/participants');
    expect(res.status).toBe(404);
  });
});
