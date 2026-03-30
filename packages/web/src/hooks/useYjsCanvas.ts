/**
 * useYjsCanvas — connects a plain Canvas drawing session to a Yjs document
 * via y-websocket.
 *
 * Data model:
 *   Y.Map<DrawOp>('strokes')  — all committed draw ops, keyed by op.id
 *   Awareness                 — remote cursor positions + user metadata
 *                             — active in-progress op for real-time sync
 *
 * Design decisions:
 *   - Ops are committed only on pointerup (not streamed mid-draw).
 *     This keeps Yjs updates cheap and undo semantics clean.
 *   - Fill ops store the *result* (pixel spans) not the seed point, so they
 *     replay identically across all clients regardless of merge order.
 *   - Active in-progress ops are streamed via awareness for real-time sync.
 *   - Y.UndoManager tracks only 'local' origin transactions, so undo/redo
 *     only affects the local user's ops.
 *   - Awareness holds cursor + user info; no separate REST polling needed
 *     for the canvas layer.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrokePoint {
  x: number;
  y: number;
}

/** One horizontal run of filled pixels produced by the flood-fill algorithm. */
export interface FillSpan {
  y: number;
  x1: number;
  x2: number;
}

export type DrawOpTool = 'pen' | 'eraser' | 'fill' | 'rect' | 'ellipse';

/**
 * A single drawing operation committed to the Yjs document.
 * The tool field discriminates which optional fields are populated:
 *   pen/eraser   => points[]
 *   fill         => spans[]
 *   rect/ellipse => x1, y1, x2, y2, filled
 */
export interface DrawOp {
  id: string;
  tool: DrawOpTool;
  color: string;
  lineWidth: number;
  userId: string;
  complete: boolean;
  // pen / eraser
  points?: StrokePoint[];
  // fill
  spans?: FillSpan[];
  // rect / ellipse
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  filled?: boolean;
}

/** Backward-compat alias. */
export type Stroke = DrawOp;

export interface RemoteCursor {
  clientId: number;
  userId: string;
  userName: string;
  userColor: string;
  cursor: { x: number; y: number } | null;
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

interface AwarenessUser {
  userId: string;
  userName: string;
  userColor: string;
  cursor: { x: number; y: number } | null;
  /** Participant DB id — used by the YWS server to drive server-side presence heartbeats */
  participantId?: string;
  /** Active in-progress op for real-time drawing sync */
  activeStroke?: DrawOp | null;
}

export interface YjsCanvasOptions {
  roomSlug: string;
  wsUrl?: string;
  userId: string;
  userName: string;
  userColor: string;
  /** When provided, included in awareness so the YWS server can keep DB presence fresh */
  participantId?: string;
  /**
   * Called whenever any peer's awareness state changes (join/leave/cursor move).
   * Use this to drive event-driven participant list refreshes rather than polling.
   */
  onAwarenessChange?: () => void;
}

export interface YjsCanvasState {
  strokes: DrawOp[];
  addStroke: (op: DrawOp) => void;
  deleteStroke: (id: string) => void;
  clearAll: () => void;
  setMyCursor: (cursor: { x: number; y: number } | null) => void;
  setMyActiveStroke: (op: DrawOp | null) => void;
  remoteCursors: RemoteCursor[];
  remoteActiveStrokes: DrawOp[];
  status: ConnectionStatus;
  undo: () => void;
  redo: () => void;
  /** The live Yjs document — share with useChat to add chat to the same CRDT doc. */
  yjsDoc: Y.Doc | null;
  /** The live WebsocketProvider — share with useChat for awareness (typing indicators). */
  yjsProvider: WebsocketProvider | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const LOCAL_ORIGIN = 'local-user';

export function useYjsCanvas({
  roomSlug,
  wsUrl = 'ws://localhost:1234',
  userId,
  userName,
  userColor,
  participantId,
  onAwarenessChange,
}: YjsCanvasOptions): YjsCanvasState {
  const [strokes, setStrokes] = useState<DrawOp[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [remoteActiveStrokes, setRemoteActiveStrokes] = useState<DrawOp[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  // Exposed so useChat can share the same Yjs doc + WS connection
  const [yjsDoc, setYjsDoc] = useState<Y.Doc | null>(null);
  const [yjsProvider, setYjsProvider] = useState<WebsocketProvider | null>(null);

  // Stable refs to mutable Yjs objects — safe to call from callbacks without
  // stale-closure issues.
  const yStrokesRef = useRef<Y.Map<DrawOp> | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<WebsocketProvider['awareness'] | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  // Keep a snapshot of awareness user fields to avoid re-setting them on every
  // cursor move (they only change when the component re-mounts with new props).
  const myUserRef = useRef<AwarenessUser>({ userId, userName, userColor, cursor: null, participantId });
  // Stable ref for the awareness-change callback — avoids re-running the effect.
  const onAwarenessChangeRef = useRef(onAwarenessChange);

  useEffect(() => {
    myUserRef.current = { ...myUserRef.current, userId, userName, userColor, participantId };
  }, [userId, userName, userColor, participantId]);

  useEffect(() => {
    onAwarenessChangeRef.current = onAwarenessChange;
  }, [onAwarenessChange]);

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;

    const yStrokes = doc.getMap<DrawOp>('strokes');
    yStrokesRef.current = yStrokes;

    const undoManager = new Y.UndoManager(yStrokes, {
      captureTimeout: 300,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    undoManagerRef.current = undoManager;

    const provider = new WebsocketProvider(wsUrl, `r/${roomSlug}`, doc, {
      connect: true,
      disableBc: false,
    });
    awarenessRef.current = provider.awareness;
    setYjsDoc(doc);
    setYjsProvider(provider);

    // ── Connection status ──────────────────────────────────────────────────

    const handleStatus = ({ status: s }: { status: string }) => {
      console.debug(`[yjs] status => ${s} (room=${roomSlug})`);
      if (s === 'connected') setStatus('online');
      else if (s === 'connecting') setStatus('connecting');
      else setStatus('offline');
    };
    provider.on('status', handleStatus);

    // ── Initial load ───────────────────────────────────────────────────────

    const handleSync = (synced: boolean) => {
      if (!synced) return;
      const loaded = Array.from(yStrokes.values());
      console.debug(`[yjs] initial sync complete — ${loaded.length} op(s) loaded (room=${roomSlug})`);
      setStrokes(loaded);
      setStatus('online');
    };
    provider.on('sync', handleSync);

    // ── Remote changes => state ─────────────────────────────────────────────

    const handleObserve = () => {
      const all = Array.from(yStrokes.values());
      console.debug(`[yjs] Y.Map observe fired — ${all.length} op(s) total`);
      setStrokes(all);
    };
    yStrokes.observe(handleObserve);

    // ── Awareness setup ────────────────────────────────────────────────────

    provider.awareness.setLocalStateField('user', myUserRef.current);

    const syncAwareness = () => {
      const states = provider.awareness.getStates() as Map<number, { user?: AwarenessUser }>;
      const cursors: RemoteCursor[] = [];
      const activeStrokes: DrawOp[] = [];
      states.forEach((state, clientId) => {
        if (clientId === provider.awareness.clientID) return;
        const u = state.user;
        if (!u?.userId) return;
        cursors.push({
          clientId,
          userId: u.userId,
          userName: u.userName ?? 'Anonymous',
          userColor: u.userColor ?? '#888888',
          cursor: u.cursor ?? null,
        });
        if (u.activeStroke) {
          activeStrokes.push(u.activeStroke);
        }
      });
      setRemoteCursors(cursors);
      setRemoteActiveStrokes(activeStrokes);
      // Notify caller so they can refresh the REST participant list immediately
      // rather than waiting for the next polling tick.
      onAwarenessChangeRef.current?.();
    };
    provider.awareness.on('change', syncAwareness);

    return () => {
      provider.awareness.off('change', syncAwareness);
      yStrokes.unobserve(handleObserve);
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.disconnect();
      undoManager.destroy();
      doc.destroy();
      yStrokesRef.current = null;
      docRef.current = null;
      awarenessRef.current = null;
      undoManagerRef.current = null;
      setYjsDoc(null);
      setYjsProvider(null);
    };
  }, [roomSlug, wsUrl]); // userId/userName/userColor handled via refs

  // ── Stable action callbacks ────────────────────────────────────────────────

  const addStroke = useCallback((op: DrawOp) => {
    const ys = yStrokesRef.current;
    const doc = docRef.current;
    if (!ys || !doc) return;
    console.debug(`[yjs] addOp ${op.id} tool=${op.tool} — map will have ${ys.size + 1} op(s)`);
    doc.transact(() => ys.set(op.id, op), LOCAL_ORIGIN);
  }, []);

  const deleteStroke = useCallback((id: string) => {
    const ys = yStrokesRef.current;
    const doc = docRef.current;
    if (!ys || !doc) return;
    doc.transact(() => ys.delete(id), LOCAL_ORIGIN);
  }, []);

  const clearAll = useCallback(() => {
    const ys = yStrokesRef.current;
    const doc = docRef.current;
    if (!ys || !doc) return;
    doc.transact(() => {
      ys.forEach((_, key) => ys.delete(key));
    }, LOCAL_ORIGIN);
  }, []);

  const setMyCursor = useCallback((cursor: { x: number; y: number } | null) => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    myUserRef.current = { ...myUserRef.current, cursor };
    awareness.setLocalStateField('user', myUserRef.current);
  }, []);

  const setMyActiveStroke = useCallback((op: DrawOp | null) => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    myUserRef.current.activeStroke = op;
    awareness.setLocalStateField('user', myUserRef.current);
  }, []);

  const undo = useCallback(() => {
    undoManagerRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoManagerRef.current?.redo();
  }, []);

  return {
    strokes, addStroke, deleteStroke, clearAll,
    setMyCursor, setMyActiveStroke,
    remoteCursors, remoteActiveStrokes,
    status, undo, redo,
    yjsDoc, yjsProvider,
  };
}
