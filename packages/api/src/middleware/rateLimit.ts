/**
 * In-memory rate limiter middleware for Hono.
 *
 * Uses a sliding window (token bucket per IP) stored in a plain Map.
 * Good enough for single-process local dev; replace with Redis for multi-process.
 */
import type { Context, Next } from 'hono';

interface Bucket {
  count: number;
  windowStart: number;
}

interface RateLimitOptions {
  /** Max requests per window */
  max: number;
  /** Window duration in ms */
  windowMs: number;
  /** 429 message sent to client */
  message?: string;
}

/**
 * Returns a Hono middleware that rate-limits by client IP.
 *
 * Example:
 *   app.use('/api/rooms', rateLimitMiddleware({ max: 10, windowMs: 60 * 60 * 1000 }));
 */
export function rateLimitMiddleware({ max, windowMs, message }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  // Periodic cleanup: remove stale buckets every window to prevent memory growth
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) buckets.delete(key);
    }
  }, windowMs);
  // Allow the process to exit even if the interval is still running
  cleanupInterval.unref?.();

  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = getClientIp(c);
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(ip, bucket);
    }

    bucket.count++;

    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((windowMs - (now - bucket.windowStart)) / 1000);
      c.header('Retry-After', String(retryAfterSec));
      c.header('X-RateLimit-Limit', String(max));
      c.header('X-RateLimit-Remaining', '0');
      return c.json(
        { error: message ?? 'Too many requests. Please try again later.' },
        429,
      );
    }

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));

    await next();
  };
}

/** Extract the client IP, respecting common proxy headers. */
function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'
  );
}
