// GET /api/health — liveness + readiness check
import { Hono } from 'hono';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';

const health = new Hono();

health.get('/', async (c) => {
  const checks: Record<string, string> = {};
  let ok = true;

  // PostgreSQL
  try {
    await sql`SELECT 1`;
    checks['postgres'] = 'ok';
  } catch (err) {
    checks['postgres'] = `error: ${String(err)}`;
    ok = false;
  }

  // Redis
  try {
    await redis.ping();
    checks['redis'] = 'ok';
  } catch (err) {
    checks['redis'] = `error: ${String(err)}`;
    ok = false;
  }

  return c.json({ status: ok ? 'healthy' : 'degraded', checks }, ok ? 200 : 503);
});

export default health;
