// DrawRoom y-websocket server — CRDT sync with LevelDB persistence
// Handles Yjs document sync for all rooms. Each room is isolated by its slug.
import * as http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import { LeveldbPersistence } from 'y-leveldb';
import * as Y from 'yjs';

const PORT = parseInt(process.env['PORT'] ?? '1234', 10);
const PERSISTENCE_DIR = process.env['PERSISTENCE_DIR'] ?? './data/yjs';
const ENABLE_PERSISTENCE = (process.env['PERSISTENCE'] ?? 'leveldb') === 'leveldb';

// LevelDB persistence — survives container restarts
let persistence: LeveldbPersistence | null = null;
if (ENABLE_PERSISTENCE) {
  persistence = new LeveldbPersistence(PERSISTENCE_DIR);
  console.log(`[yws] LevelDB persistence enabled at ${PERSISTENCE_DIR}`);
}

// In-memory map of roomName → Y.Doc (managed by y-websocket)
// y-websocket's setupWSConnection manages this internally, but we track
// active docs here to drive persistence.
const docs = new Map<string, Y.Doc>();

function getOrCreateDoc(roomName: string): Y.Doc {
  const existing = docs.get(roomName);
  if (existing) return existing;

  const doc = new Y.Doc();
  docs.set(roomName, doc);
  return doc;
}

const server = http.createServer((_req, res) => {
  // HTTP ping endpoint — used by Docker health check
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('y-websocket ok\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Extract room name from URL path: /r/my-room-slug → "my-room-slug"
  const url = req.url ?? '/';
  const roomName = url.replace(/^\//, '') || 'default';

  // Load persisted doc state before syncing (if persistence is enabled)
  if (persistence) {
    const doc = getOrCreateDoc(roomName);
    persistence.getYDoc(roomName).then((persistedDoc: Y.Doc | null) => {
      if (persistedDoc) {
        const update = Y.encodeStateAsUpdate(persistedDoc);
        Y.applyUpdate(doc, update);
      }
      // setupWSConnection handles all protocol details
      setupWSConnection(ws, req, { docName: roomName });
    }).catch((err: unknown) => {
      console.error(`[yws] Failed to load persisted doc for ${roomName}:`, err);
      setupWSConnection(ws, req, { docName: roomName });
    });
  } else {
    setupWSConnection(ws, req, { docName: roomName });
  }

  ws.on('close', () => {
    // Persist doc state on disconnect (debounce is handled externally; this is a safety flush)
    if (persistence) {
      const doc = docs.get(roomName);
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
  wss.close(() => {
    server.close(() => {
      persistence?.destroy().catch(() => {});
      process.exit(0);
    });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
