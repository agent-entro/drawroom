/**
 * useYjsCanvas — connects a plain Canvas drawing session to a Yjs document
 * via y-websocket.
 *
 * Data model:
 *   Y.Map<Stroke>('strokes')  — all committed strokes, keyed by stroke.id
 *   Awareness                 — remote cursor positions + user metadata
 *
 * Design decisions:
 *   - Strokes are committed only on pointerup (not streamed mid-draw).
 *     This keeps Yjs updates cheap and undo semantics clean.
 *   - Y.UndoManager tracks only 'local' origin transactions, so undo/redo
 *     only affects the local user's strokes.
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

export interface Stroke {
  id: string;
  tool: 'pen' | 'eraser';
  color: string;
  lineWidth: number;
  userId: string;
  points: StrokePoint[];
  complete: boolean;
}

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
  strokes: Stroke[];
  addStroke: (stroke: Stroke) => void;
  deleteStroke: (id: string) => void;
  clearAll: () => void;
  setMyCursor: (cursor: { x: number; y: number } | null) => void;
  remoteCursors: RemoteCursor[];
  status: ConnectionStatus;
  undo: () => void;
  redo: () => void;
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
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  // Stable refs to mutable Yjs objects — safe to call from callbacks without
  // stale-closure issues.
  const yStrokesRef = useRef<Y.Map<Stroke> | null>(null);
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

    const yStrokes = doc.getMap<Stroke>('strokes');
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

    // ── Connection status ──────────────────────────────────────────────────

    const handleStatus = ({ status: s }: { status: string }) => {
      if (s === 'connected') setStatus('online');
      else if (s === 'connecting') setStatus('connecting');
      else setStatus('offline');
    };
    provider.on('status', handleStatus);

    // ── Initial load ───────────────────────────────────────────────────────

    const handleSync = (synced: boolean) => {
      if (!synced) return;
      setStrokes(Array.from(yStrokes.values()));
      setStatus('online');
    };
    provider.on('sync', handleSync);

    // ── Remote changes → state ─────────────────────────────────────────────

    const handleObserve = () => {
      setStrokes(Array.from(yStrokes.values()));
    };
    yStrokes.observe(handleObserve);

    // ── Awareness setup ────────────────────────────────────────────────────

    provider.awareness.setLocalStateField('user', myUserRef.current);

    const syncAwareness = () => {
      const states = provider.awareness.getStates() as Map<number, { user?: AwarenessUser }>;
      const cursors: RemoteCursor[] = [];
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
      });
      setRemoteCursors(cursors);
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
    };
  }, [roomSlug, wsUrl]); // userId/userName/userColor handled via refs

  // ── Stable action callbacks ────────────────────────────────────────────────

  const addStroke = useCallback((stroke: Stroke) => {
    const ys = yStrokesRef.current;
    const doc = docRef.current;
    if (!ys || !doc) return;
    doc.transact(() => ys.set(stroke.id, stroke), LOCAL_ORIGIN);
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

  const undo = useCallback(() => {
    undoManagerRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoManagerRef.current?.redo();
  }, []);

  return { strokes, addStroke, deleteStroke, clearAll, setMyCursor, remoteCursors, status, undo, redo };
}
