/**
 * DrawRoom PartyKit server — main room party.
 *
 * Each room slug maps to one instance of this class (Durable Object).
 * Responsibilities:
 *   - Relay Yjs CRDT updates between clients (via y-partykit)
 *   - Broadcast chat messages
 *   - Track participants via awareness protocol
 *   - Persist Yjs document to Durable Object storage
 *
 * Phase 0: Scaffold only — type-checks and exports the class.
 * Real logic wired in Phase 1–3.
 */
import type * as Party from 'partykit/server';
import {
  MAX_MESSAGE_LENGTH,
  HEARTBEAT_INTERVAL_MS,
} from '@drawroom/shared';
import type { ClientEvent, ServerEvent } from '@drawroom/shared';

export default class DrawRoomParty implements Party.Server {
  readonly room: Party.Room;

  constructor(room: Party.Room) {
    this.room = room;
  }

  // Called when a WebSocket connection opens
  onConnect(conn: Party.Connection, _ctx: Party.ConnectionContext): void {
    console.log(`[room:${this.room.id}] connect ${conn.id}`);
    // Phase 1: send Yjs full document state + participant list
  }

  // Called when a WebSocket message arrives
  onMessage(message: string | ArrayBuffer, sender: Party.Connection): void {
    // Binary messages are Yjs CRDT updates — relay to all (Phase 1)
    if (message instanceof ArrayBuffer) {
      this.room.broadcast(message, [sender.id]);
      return;
    }

    let event: ClientEvent;
    try {
      event = JSON.parse(message) as ClientEvent;
    } catch {
      this.sendError(sender, 'PARSE_ERROR', 'Invalid JSON');
      return;
    }

    this.handleEvent(event, sender);
  }

  // Called when a WebSocket connection closes
  onClose(conn: Party.Connection): void {
    console.log(`[room:${this.room.id}] disconnect ${conn.id}`);
    const leaveEvent: ServerEvent = {
      type: 'PARTICIPANT_LEFT',
      participantId: conn.id,
    };
    this.room.broadcast(JSON.stringify(leaveEvent), [conn.id]);
  }

  // Called when the HTTP request is made to this party (Hono REST routes in Phase 2)
  onRequest(req: Party.Request): Response | Promise<Response> {
    if (new URL(req.url).pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', roomId: this.room.id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private handleEvent(event: ClientEvent, sender: Party.Connection): void {
    switch (event.type) {
      case 'JOIN':
        // Phase 2: create/lookup Participant, broadcast PARTICIPANT_JOINED
        console.log(`[room:${this.room.id}] JOIN from ${sender.id}: ${event.displayName}`);
        break;

      case 'CHAT_SEND': {
        if (event.content.length > MAX_MESSAGE_LENGTH) {
          this.sendError(sender, 'MESSAGE_TOO_LONG', `Max ${MAX_MESSAGE_LENGTH} chars`);
          return;
        }
        // Phase 3: persist to Supabase + broadcast CHAT_MESSAGE
        console.log(`[room:${this.room.id}] CHAT_SEND: ${event.content.slice(0, 50)}`);
        break;
      }

      case 'HEARTBEAT':
        // Phase 2: update participant.lastSeenAt
        break;

      case 'LEAVE':
        sender.close();
        break;

      default:
        this.sendError(sender, 'UNKNOWN_EVENT', 'Unrecognised event type');
    }
  }

  private sendError(conn: Party.Connection, code: string, message: string): void {
    const event: ServerEvent = { type: 'ERROR', code, message };
    conn.send(JSON.stringify(event));
  }
}

// Exported for y-partykit provider — HEARTBEAT_INTERVAL_MS used by the client
export { HEARTBEAT_INTERVAL_MS };
