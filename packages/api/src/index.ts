// DrawRoom REST API — Hono server on Node.js
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { redis } from './redis/client.js';
import { startCleanupCron } from './cron/cleanup.js';
import health from './routes/health.js';
import rooms from './routes/rooms.js';
import messages from './routes/messages.js';
import participants from './routes/participants.js';
import exports_ from './routes/exports.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: process.env['CORS_ORIGIN'] ?? '',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Routes
app.route('/api/health', health);
app.route('/api/exports', exports_);

// Mount messages under rooms — must come before rooms to avoid slug conflict
const roomsWithMessages = new Hono();
roomsWithMessages.route('/:slug/messages', messages);
roomsWithMessages.route('/:slug/participants', participants);
app.route('/api/rooms', roomsWithMessages);
app.route('/api/rooms', rooms);

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
