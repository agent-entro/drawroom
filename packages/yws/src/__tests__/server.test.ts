// Smoke tests for the y-websocket server — verifies HTTP ping and WS upgrade
import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const TEST_PORT = 19234;

// Minimal in-process server for testing (no LevelDB)
async function startTestServer(): Promise<{ wss: WebSocketServer; server: http.Server }> {
  const { setupWSConnection } = await import('y-websocket/bin/utils') as {
    setupWSConnection: (ws: WebSocket, req: http.IncomingMessage, opts?: { docName?: string }) => void;
  };

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('y-websocket ok\n');
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const roomName = (req.url ?? '/').replace(/^\//, '') || 'default';
    setupWSConnection(ws as unknown as WebSocket, req, { docName: roomName });
  });

  await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  return { wss, server };
}

describe('y-websocket server', () => {
  let serverRef: { wss: WebSocketServer; server: http.Server } | null = null;

  afterAll(async () => {
    if (serverRef) {
      await new Promise<void>((r) => serverRef!.wss.close(() => r()));
      await new Promise<void>((r) => serverRef!.server.close(() => r()));
    }
  });

  it('responds to HTTP ping', async () => {
    serverRef = await startTestServer();

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get(`http://localhost:${TEST_PORT}/`, (r) => {
        let body = '';
        r.on('data', (d: Buffer) => { body += d.toString(); });
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body }));
      }).on('error', reject);
    });

    expect(res.status).toBe(200);
    expect(res.body).toContain('y-websocket ok');
  });

  it('accepts WebSocket connection', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/test-room`);
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
  });

});
