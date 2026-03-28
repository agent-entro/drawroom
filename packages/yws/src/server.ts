// DrawRoom y-websocket server — CRDT sync with LevelDB persistence
//
// Extends the base y-websocket server with server-side presence heartbeats:
// when a client includes `participantId` in their Yjs awareness state, this
// server forwards a heartbeat to the REST API so the HTTP polling interval
// on the client can be reduced to participant-list refresh only.
//
// Env vars:
//   PORT             — WebSocket server port (default: 1234)
//   PERSISTENCE_DIR  — LevelDB data directory (default: ./data/yjs)
//   PERSISTENCE      — Set to 'leveldb' to enable persistence (default: 'leveldb')
//   API_URL          — REST API base URL for heartbeat forwarding (default: http://localhost:3000)
//   INTERNAL_SECRET  — Shared secret for server-to-server heartbeat calls (default: local-dev-secret)
import * as http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection, docs, type WSSharedDoc } from 'y-websocket/bin/utils';
import { LeveldbPersistence } from 'y-leveldb';
import * as Y from 'yjs';

const PORT = parseInt(process.env['PORT'] ?? '1234', 10);
const PERSISTENCE_DIR = process.env['PERSISTENCE_DIR'] ?? './data/yjs';
const ENABLE_PERSISTENCE = (process.env['PERSISTENCE'] ?? 'leveldb') === 'leveldb';
const API_URL = process.env['API_URL'] ?? 'http://localhost:3000';
const INTERNAL_SECRET = process.env['INTERNAL_SECRET'] ?? 'local-dev-secret';

// LevelDB persistence — survives container restarts
let persistence: LeveldbPersistence | null = null;
if (ENABLE_PERSISTENCE) {
  persistence = new LeveldbPersistence(PERSISTENCE_DIR);
  console.log(`[yws] LevelDB persistence enabled at ${PERSISTENCE_DIR}`);
}

// In-memory map of roomName → Y.Doc (managed by y-websocket)
// y-websocket's setupWSConnection manages this internally, but we track
// active docs here to drive persistence.
const localDocs = new Map<string, Y.Doc>();

function getOrCreateDoc(roomName: string): Y.Doc {
  const existing = localDocs.get(roomName);
  if (existing) return existing;

  const doc = new Y.Doc();
  localDocs.set(roomName, doc);
  return doc;
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

  const setupConnection = () => {
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
  };

  // Load persisted doc state before syncing (if persistence is enabled)
  if (persistence) {
    const doc = getOrCreateDoc(roomName);
    persistence.getYDoc(roomName).then((persistedDoc: Y.Doc | null) => {
      if (persistedDoc) {
        const update = Y.encodeStateAsUpdate(persistedDoc);
        Y.applyUpdate(doc, update);
      }
      setupConnection();
    }).catch((err: unknown) => {
      console.error(`[yws] Failed to load persisted doc for ${roomName}:`, err);
      setupConnection();
    });
  } else {
    setupConnection();
  }

  ws.on('close', () => {
    // Persist doc state on disconnect (debounce is handled externally; this is a safety flush)
    if (persistence) {
      const doc = localDocs.get(roomName);
      if (doc) {
        persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(doc)).catch((err: unknown) => {
          console.error(`[yws] Failed to persist doc for ${roomName}:`, err);
        });
      }
    }
  });
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
      persistence?.destroy().catch(() => {});
      process.exit(0);
    });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
