// DrawRoom REST API — Hono server on Node.js
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { redis } from './redis/client.js';
import { startCleanupCron } from './cron/cleanup.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import health from './routes/health.js';
import rooms from './routes/rooms.js';
import messages from './routes/messages.js';
import participants from './routes/participants.js';
import exports_ from './routes/exports.js';
import internal from './routes/internal.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

const app = new Hono();

// ── Security headers ─────────────────────────────────────────────────────────

const CSP = [
  "default-src 'self'",
  // Allow inline scripts for Vite dev HMR and tldraw's canvas rendering
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // WebSocket connections for y-websocket (same host, any port on localhost)
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
].join('; ');

app.use('*', async (c, next) => {
  await next();
  c.header('Content-Security-Policy', CSP);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// ── Standard middleware ───────────────────────────────────────────────────────

app.use('*', logger());
app.use('*', cors({
  origin: process.env['CORS_ORIGIN'] ?? '',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// ── Routes ───────────────────────────────────────────────────────────────────

app.route('/api/health', health);
app.route('/api/exports', exports_);
app.route('/api/internal', internal);

// Mount messages under rooms — must come before rooms to avoid slug conflict
const roomsWithMessages = new Hono();
roomsWithMessages.route('/:slug/messages', messages);
roomsWithMessages.route('/:slug/participants', participants);
app.route('/api/rooms', roomsWithMessages);

// Rate-limit room creation: 10 rooms per hour per IP
app.post('/api/rooms', rateLimitMiddleware({
  max: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Room creation limit reached (10/hour). Please try again later.',
}));
app.route('/api/rooms', rooms);

// ── Infra ─────────────────────────────────────────────────────────────────────

// Connect Redis
redis.connect().catch((err: Error) => {
  console.warn('[api] Redis connection warning:', err.message);
});

// Start cleanup cron
startCleanupCron();

// Start HTTP server
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[api] DrawRoom API listening on http://localhost:${info.port}`);
});
