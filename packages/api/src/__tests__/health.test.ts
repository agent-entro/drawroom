// Unit tests for the health route — mocks DB and Redis
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock db and redis clients before importing the route
vi.mock('../db/client.js', () => ({
  sql: Object.assign(
    vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    { unsafe: vi.fn() }
  ),
}));

vi.mock('../redis/client.js', () => ({
  redis: {
    ping: vi.fn().mockResolvedValue('PONG'),
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 healthy when both services respond', async () => {
    const { default: health } = await import('../routes/health.js');
    const app = new Hono();
    app.route('/', health);

    const res = await app.request('/');
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; checks: Record<string, string> };
    expect(body.status).toBe('healthy');
    expect(body.checks['postgres']).toBe('ok');
    expect(body.checks['redis']).toBe('ok');
  });

  it('returns 503 degraded when postgres fails', async () => {
    const { sql } = await import('../db/client.js');
    vi.mocked(sql).mockRejectedValueOnce(new Error('connection refused'));

    const { default: health } = await import('../routes/health.js');
    const app = new Hono();
    app.route('/', health);

    const res = await app.request('/');
    expect(res.status).toBe(503);

    const body = await res.json() as { status: string; checks: Record<string, string> };
    expect(body.status).toBe('degraded');
    expect(body.checks['postgres']).toContain('error');
  });
});
