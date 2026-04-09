// Unit tests for the rate limit middleware
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';

// Helper: build a minimal app with the rate limiter
function buildApp(max: number, windowMs: number) {
  const app = new Hono();
  app.use('/', rateLimitMiddleware({ max, windowMs }));
  app.get('/', (c) => c.json({ ok: true }));
  app.post('/', (c) => c.json({ ok: true }));
  return app;
}

// Helper: make N requests from the same IP
async function makeRequests(
  app: ReturnType<typeof buildApp>,
  n: number,
  method = 'GET',
  ip = '1.2.3.4',
): Promise<Response[]> {
  const results: Response[] = [];
  for (let i = 0; i < n; i++) {
    results.push(
      await app.request('/', {
        method,
        headers: { 'x-forwarded-for': ip },
      }),
    );
  }
  return results;
}

describe('rateLimitMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit', async () => {
    const app = buildApp(5, 60_000);
    const responses = await makeRequests(app, 5);
    expect(responses.every((r) => r.status === 200)).toBe(true);
  });

  it('returns 429 when limit is exceeded', async () => {
    const app = buildApp(3, 60_000);
    const responses = await makeRequests(app, 5);

    expect(responses[0]!.status).toBe(200);
    expect(responses[1]!.status).toBe(200);
    expect(responses[2]!.status).toBe(200);
    expect(responses[3]!.status).toBe(429);
    expect(responses[4]!.status).toBe(429);
  });

  it('sets X-RateLimit-Remaining header', async () => {
    const app = buildApp(5, 60_000);
    const [r1, r2] = await makeRequests(app, 2);
    expect(r1!.headers.get('X-RateLimit-Remaining')).toBe('4');
    expect(r2!.headers.get('X-RateLimit-Remaining')).toBe('3');
  });

  it('sets Retry-After header on 429', async () => {
    const app = buildApp(1, 60_000);
    const [, r2] = await makeRequests(app, 2);
    expect(r2!.status).toBe(429);
    const retryAfter = r2!.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('isolates buckets per IP', async () => {
    const app = buildApp(2, 60_000);

    const r1 = await app.request('/', { method: 'GET', headers: { 'x-forwarded-for': '10.0.0.1' } });
    const r2 = await app.request('/', { method: 'GET', headers: { 'x-forwarded-for': '10.0.0.1' } });
    const r3 = await app.request('/', { method: 'GET', headers: { 'x-forwarded-for': '10.0.0.1' } });
    const r4 = await app.request('/', { method: 'GET', headers: { 'x-forwarded-for': '10.0.0.2' } });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429); // IP 1 is over limit
    expect(r4.status).toBe(200); // IP 2 is a fresh bucket
  });

  it('resets bucket after window expires', async () => {
    const WINDOW = 10_000;
    const app = buildApp(2, WINDOW);

    // Use up the limit
    await makeRequests(app, 2, 'GET', '5.5.5.5');
    const overLimit = await app.request('/', { method: 'GET', headers: { 'x-forwarded-for': '5.5.5.5' } });
    expect(overLimit.status).toBe(429);

    // Advance past the window
    vi.advanceTimersByTime(WINDOW + 1);

    // New window — should be allowed again
    const afterReset = await app.request('/', { method: 'GET', headers: { 'x-forwarded-for': '5.5.5.5' } });
    expect(afterReset.status).toBe(200);
  });

  it('returns a custom error message', async () => {
    const app = new Hono();
    app.use('/', rateLimitMiddleware({ max: 0, windowMs: 60_000, message: 'Custom limit reached' }));
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Custom limit reached');
  });
});
