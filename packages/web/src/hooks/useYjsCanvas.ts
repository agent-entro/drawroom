/**
 * useYjsCanvas — connects a plain Canvas drawing session to a Yjs document
 * via y-websocket.
 *
 * Data model:
 *   Y.Map<DrawOp>('strokes')  — all committed draw ops, keyed by op.id
 *   Awareness                 — remote cursor positions + user metadata
 *                             — active in-progress op for real-time sync
 *
 * Op types: pen | eraser | fill | rect | ellipse
 * All ops include `createdAt` for deterministic replay ordering across clients.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrokePoint {
  x: number;
  y: number;
}

/**
 * A single draw operation. Discriminated by `tool`.
 *
 * pen/eraser : freehand path — use `points`
 * fill       : flood fill   — use `fillX`, `fillY`
 * rect       : rectangle    — use `shapeX`, `shapeY`, `shapeW`, `shapeH`, `shapeFilled`
 * ellipse    : ellipse      — use `shapeX`, `shapeY`, `shapeW`, `shapeH`, `shapeFilled`
 */
export interface Stroke {
  id: string;
  tool: 'pen' | 'eraser' | 'fill' | 'rect' | 'ellipse';
  color: string;
  lineWidth: number;
  userId: string;
  complete: boolean;
  /** ms timestamp — used to sort ops for deterministic replay ordering */
  createdAt: number;

  // pen / eraser
  points: StrokePoint[];

  // fill
  fillX?: number;
  fillY?: number;

  // rect / ellipse
  shapeX?: number;
  shapeY?: number;
  shapeW?: number;
  shapeH?: number;
  /** true = filled interior; false = outline only */
  shapeFilled?: boolean;
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
  participantId?: string;
  activeStroke?: Stroke | null;
}

export interface YjsCanvasOptions {
  roomSlug: string;
  wsUrl?: string;
  userId: string;
  userName: string;
  userColor: string;
  participantId?: string;
  onAwarenessChange?: () => void;
}

export interface YjsCanvasState {
  strokes: Stroke[];
  addStroke: (stroke: Stroke) => void;
  deleteStroke: (id: string) => void;
  clearAll: () => void;
  setMyCursor: (cursor: { x: number; y: number } | null) => void;
  setMyActiveStroke: (stroke: Stroke | null) => void;
  remoteCursors: RemoteCursor[];
  remoteActiveStrokes: Stroke[];
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
  const [remoteActiveStrokes, setRemoteActiveStrokes] = useState<Stroke[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  const yStrokesRef = useRef<Y.Map<Stroke> | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<WebsocketProvider['awareness'] | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const myUserRef = useRef<AwarenessUser>({ userId, userName, userColor, cursor: null, participantId });
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

    const handleStatus = ({ status: s }: { status: string }) => {
      if (s === 'connected') setStatus('online');
      else if (s === 'connecting') setStatus('connecting');
      else setStatus('offline');
    };
    provider.on('status', handleStatus);

    const handleSync = (synced: boolean) => {
      if (!synced) return;
      setStrokes(Array.from(yStrokes.values()));
      setStatus('online');
    };
    provider.on('sync', handleSync);

    const handleObserve = () => {
      setStrokes(Array.from(yStrokes.values()));
    };
    yStrokes.observe(handleObserve);

    provider.awareness.setLocalStateField('user', myUserRef.current);

    const syncAwareness = () => {
      const states = provider.awareness.getStates() as Map<number, { user?: AwarenessUser }>;
      const cursors: RemoteCursor[] = [];
      const activeStrokes: Stroke[] = [];
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
        if (u.activeStroke) activeStrokes.push(u.activeStroke);
      });
      setRemoteCursors(cursors);
      setRemoteActiveStrokes(activeStrokes);
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
  }, [roomSlug, wsUrl]);

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

  const setMyActiveStroke = useCallback((stroke: Stroke | null) => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    myUserRef.current.activeStroke = stroke;
    awareness.setLocalStateField('user', myUserRef.current);
  }, []);

  const undo = useCallback(() => { undoManagerRef.current?.undo(); }, []);
  const redo = useCallback(() => { undoManagerRef.current?.redo(); }, []);

  return {
    strokes, addStroke, deleteStroke, clearAll,
    setMyCursor, setMyActiveStroke,
    remoteCursors, remoteActiveStrokes,
    status, undo, redo,
  };
}
