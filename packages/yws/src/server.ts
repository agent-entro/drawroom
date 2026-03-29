// DrawRoom y-websocket server — CRDT sync with LevelDB persistence
//
// Persistence is handled by y-websocket's native YPERSISTENCE env var —
// this avoids importing yjs directly (which would create a second Yjs instance
// and break constructor identity checks between server.ts and y-websocket/bin/utils.cjs).
//
// Awareness is tapped after setupWSConnection to drive server-side presence
// heartbeats to the REST API.
//
// Env vars:
//   PORT             — WebSocket server port (default: 1234)
//   YPERSISTENCE     — LevelDB data directory; enables persistence when set
//   API_URL          — REST API base URL for heartbeat forwarding (default: http://localhost:3000)
//   INTERNAL_SECRET  — Shared secret for server-to-server heartbeat calls (default: local-dev-secret)
import * as http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection, docs, type WSSharedDoc } from 'y-websocket/bin/utils';

const PORT = parseInt(process.env['PORT'] ?? '1234', 10);
const API_URL = process.env['API_URL'] ?? 'http://localhost:3000';
const INTERNAL_SECRET = process.env['INTERNAL_SECRET'] ?? 'local-dev-secret';

// y-websocket reads YPERSISTENCE itself from the environment; log so it's visible.
if (process.env['YPERSISTENCE']) {
  console.log(`[yws] LevelDB persistence enabled at ${process.env['YPERSISTENCE']}`);
} else {
  console.log('[yws] Persistence disabled (set YPERSISTENCE to enable)');
}

// ── Presence heartbeat forwarding ─────────────────────────────────────────────

// Debounce map: participantKey → timeout handle
// Fires once immediately on first awareness update, then suppresses for 25s.
const heartbeatCooldown = new Map<string, ReturnType<typeof setTimeout>>();
const HEARTBEAT_COOLDOWN_MS = 25_000; // slightly under server's 30s expiry threshold

async function sendPresenceHeartbeat(roomSlug: string, participantId: string): Promise<void> {
  try {
    const url = `${API_URL}/api/internal/rooms/${encodeURIComponent(roomSlug)}/participants/${encodeURIComponent(participantId)}/heartbeat`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'X-Internal-Secret': INTERNAL_SECRET },
    });
    if (!res.ok) {
      console.warn(`[yws] heartbeat forward failed for ${participantId}: HTTP ${res.status}`);
    }
  } catch (err) {
    // Non-fatal: client will fall back to HTTP polling
    console.warn('[yws] heartbeat forward error:', err);
  }
}

function scheduleHeartbeat(roomSlug: string, participantId: string): void {
  const key = `${roomSlug}:${participantId}`;
  if (heartbeatCooldown.has(key)) return; // still in cooldown — skip

  // Fire immediately, then block further calls for HEARTBEAT_COOLDOWN_MS
  void sendPresenceHeartbeat(roomSlug, participantId);
  heartbeatCooldown.set(
    key,
    setTimeout(() => heartbeatCooldown.delete(key), HEARTBEAT_COOLDOWN_MS),
  );
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((_req, res) => {
  // HTTP ping endpoint — used by Docker health check
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('y-websocket ok\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Extract room name from URL path: /r/my-room-slug → "r/my-room-slug"
  const url = req.url ?? '/';
  const roomName = url.replace(/^\//, '') || 'default';
  // Strip the "r/" prefix to get the slug used by the REST API
  const roomSlug = roomName.replace(/^r\//, '');

  // y-websocket handles doc creation, sync protocol, and persistence (YPERSISTENCE).
  setupWSConnection(ws, req, { docName: roomName });

  // Hook into the y-websocket managed doc's awareness after connection setup.
  // `docs` is the module-level map exported by y-websocket/bin/utils.
  const sharedDoc: WSSharedDoc | undefined = docs.get(roomName);
  if (sharedDoc?.awareness) {
    const onAwarenessChange = ({ added, updated }: { added: number[]; updated: number[]; removed: number[] }) => {
      const states = sharedDoc.awareness.getStates();
      for (const clientId of [...added, ...updated]) {
        const state = states.get(clientId) as { user?: { participantId?: string } } | undefined;
        if (state?.user?.participantId) {
          scheduleHeartbeat(roomSlug, state.user.participantId);
        }
      }
    };
    sharedDoc.awareness.on('change', onAwarenessChange);
    // Clean up listener when this specific client disconnects
    ws.on('close', () => sharedDoc.awareness.off('change', onAwarenessChange));
  }
});

server.listen(PORT, () => {
  console.log(`[yws] y-websocket server listening on ws://localhost:${PORT}`);
});

// Graceful shutdown
function shutdown(): void {
  console.log('[yws] Shutting down...');
  // Clear all cooldown timers
  for (const handle of heartbeatCooldown.values()) clearTimeout(handle);
  heartbeatCooldown.clear();

  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
