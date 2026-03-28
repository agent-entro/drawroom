/**
 * Unit tests for the useYjsCanvas hook — Yjs layer only.
 *
 * Tests run in jsdom (no real WebSocket). They verify:
 *   - Y.Map stores and retrieves Stroke objects correctly
 *   - Bidirectional sync between two Y.Docs (simulated network)
 *   - Y.UndoManager reverts local stroke additions
 *   - Awareness state shape
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { Stroke } from '../useYjsCanvas.ts';

function makeStroke(id: string, userId = 'u1'): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#000000',
    lineWidth: 4,
    userId,
    points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    complete: true,
  };
}

// ── Y.Map basics ──────────────────────────────────────────────────────────────

describe('Y.Map stroke storage', () => {
  it('stores and retrieves a stroke by id', () => {
    const doc = new Y.Doc();
    const yStrokes = doc.getMap<Stroke>('strokes');
    const stroke = makeStroke('s1');

    yStrokes.set(stroke.id, stroke);

    expect(yStrokes.get('s1')).toEqual(stroke);
    expect(yStrokes.size).toBe(1);
  });

  it('deletes a stroke by id', () => {
    const doc = new Y.Doc();
    const yStrokes = doc.getMap<Stroke>('strokes');
    const stroke = makeStroke('s2');

    yStrokes.set(stroke.id, stroke);
    yStrokes.delete(stroke.id);

    expect(yStrokes.has('s2')).toBe(false);
    expect(yStrokes.size).toBe(0);
  });

  it('clears all strokes in a transaction', () => {
    const doc = new Y.Doc();
    const yStrokes = doc.getMap<Stroke>('strokes');

    yStrokes.set('a', makeStroke('a'));
    yStrokes.set('b', makeStroke('b'));
    yStrokes.set('c', makeStroke('c'));
    expect(yStrokes.size).toBe(3);

    doc.transact(() => {
      yStrokes.forEach((_, key) => yStrokes.delete(key));
    });

    expect(yStrokes.size).toBe(0);
  });
});

// ── Two-doc sync ──────────────────────────────────────────────────────────────

describe('Y.Doc bidirectional sync', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    // Instant relay — simulates the y-websocket server
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));
  });

  afterEach(() => {
    docA.destroy();
    docB.destroy();
  });

  it('stroke added on docA appears on docB', () => {
    const mapA = docA.getMap<Stroke>('strokes');
    const mapB = docB.getMap<Stroke>('strokes');

    mapA.set('s-sync', makeStroke('s-sync'));

    expect(mapB.get('s-sync')).toBeDefined();
    expect(mapB.get('s-sync')!.id).toBe('s-sync');
  });

  it('stroke deleted on docA disappears on docB', () => {
    const mapA = docA.getMap<Stroke>('strokes');
    const mapB = docB.getMap<Stroke>('strokes');

    mapA.set('s-del', makeStroke('s-del'));
    expect(mapB.has('s-del')).toBe(true);

    mapA.delete('s-del');
    expect(mapB.has('s-del')).toBe(false);
  });

  it('concurrent strokes from both sides merge without conflict', () => {
    const mapA = docA.getMap<Stroke>('strokes');
    const mapB = docB.getMap<Stroke>('strokes');

    mapA.set('from-a', makeStroke('from-a', 'userA'));
    mapB.set('from-b', makeStroke('from-b', 'userB'));

    expect(mapA.has('from-b')).toBe(true);
    expect(mapB.has('from-a')).toBe(true);
  });

  it('observer fires once per remote transaction (no echo)', () => {
    const mapA = docA.getMap<Stroke>('strokes');
    const mapB = docB.getMap<Stroke>('strokes');

    let fires = 0;
    mapB.observe(() => { fires++; });

    docA.transact(() => {
      mapA.set('echo-test', makeStroke('echo-test'));
    });

    expect(fires).toBe(1);
  });
});

// ── UndoManager ───────────────────────────────────────────────────────────────

describe('Y.UndoManager with local origin', () => {
  const LOCAL_ORIGIN = 'local-user';

  it('undoes a local stroke addition', () => {
    const doc = new Y.Doc();
    const yStrokes = doc.getMap<Stroke>('strokes');
    const um = new Y.UndoManager(yStrokes, {
      captureTimeout: 0,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    doc.transact(() => yStrokes.set('undo-me', makeStroke('undo-me')), LOCAL_ORIGIN);
    expect(yStrokes.has('undo-me')).toBe(true);

    um.undo();
    expect(yStrokes.has('undo-me')).toBe(false);

    um.destroy();
    doc.destroy();
  });

  it('redoes after undo', () => {
    const doc = new Y.Doc();
    const yStrokes = doc.getMap<Stroke>('strokes');
    const um = new Y.UndoManager(yStrokes, {
      captureTimeout: 0,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    doc.transact(() => yStrokes.set('redo-me', makeStroke('redo-me')), LOCAL_ORIGIN);
    um.undo();
    expect(yStrokes.has('redo-me')).toBe(false);

    um.redo();
    expect(yStrokes.has('redo-me')).toBe(true);

    um.destroy();
    doc.destroy();
  });

  it('does NOT undo remote (non-local-origin) operations', () => {
    const doc = new Y.Doc();
    const yStrokes = doc.getMap<Stroke>('strokes');
    const um = new Y.UndoManager(yStrokes, {
      captureTimeout: 0,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    // Remote stroke (no origin → not tracked)
    yStrokes.set('remote-stroke', makeStroke('remote-stroke'));
    expect(yStrokes.has('remote-stroke')).toBe(true);

    // Undo should be a no-op (nothing tracked)
    um.undo();
    expect(yStrokes.has('remote-stroke')).toBe(true);

    um.destroy();
    doc.destroy();
  });
});

// ── Awareness active stroke ───────────────────────────────────────────────────

describe('Awareness active stroke', () => {
  it('active stroke appears in awareness state and is visible to other clients', () => {
    // Simulate two awareness instances sharing state via a simple in-memory relay
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Wire up Y.Doc sync
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));

    // Create awareness instances using the awareness protocol directly
    const { Awareness } = require('y-protocols/awareness');
    const awarenessA = new Awareness(docA);
    const awarenessB = new Awareness(docB);

    // Relay awareness updates between A and B
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = require('y-protocols/awareness');
    awarenessA.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = added.concat(updated).concat(removed);
      const update = encodeAwarenessUpdate(awarenessA, changedClients);
      applyAwarenessUpdate(awarenessB, update, null);
    });
    awarenessB.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = added.concat(updated).concat(removed);
      const update = encodeAwarenessUpdate(awarenessB, changedClients);
      applyAwarenessUpdate(awarenessA, update, null);
    });

    const activeStroke: import('../useYjsCanvas.ts').Stroke = {
      id: 'active-1',
      tool: 'pen',
      color: '#ff0000',
      lineWidth: 4,
      userId: 'userA',
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
      complete: false,
    };

    // User A sets their active stroke in awareness
    awarenessA.setLocalStateField('user', {
      userId: 'userA',
      userName: 'Alice',
      userColor: '#ff0000',
      cursor: { x: 50, y: 50 },
      activeStroke,
    });

    // User B should now see user A's active stroke in awareness states
    const statesOnB = awarenessB.getStates() as Map<number, { user?: { activeStroke?: import('../useYjsCanvas.ts').Stroke } }>;

    let foundActiveStroke: import('../useYjsCanvas.ts').Stroke | undefined;
    statesOnB.forEach((state, clientId) => {
      if (clientId !== awarenessB.clientID && state.user?.activeStroke) {
        foundActiveStroke = state.user.activeStroke;
      }
    });

    expect(foundActiveStroke).toBeDefined();
    expect(foundActiveStroke!.id).toBe('active-1');
    expect(foundActiveStroke!.complete).toBe(false);
    expect(foundActiveStroke!.points).toHaveLength(2);

    // User A clears active stroke (stroke complete / pointer up)
    awarenessA.setLocalStateField('user', {
      userId: 'userA',
      userName: 'Alice',
      userColor: '#ff0000',
      cursor: { x: 50, y: 50 },
      activeStroke: null,
    });

    // User B should now see no active stroke for user A
    const statesAfterClear = awarenessB.getStates() as Map<number, { user?: { activeStroke?: import('../useYjsCanvas.ts').Stroke | null } }>;
    let clearedActiveStroke: import('../useYjsCanvas.ts').Stroke | null | undefined = undefined;
    statesAfterClear.forEach((state, clientId) => {
      if (clientId !== awarenessB.clientID) {
        clearedActiveStroke = state.user?.activeStroke;
      }
    });

    expect(clearedActiveStroke).toBeNull();

    awarenessA.destroy();
    awarenessB.destroy();
    docA.destroy();
    docB.destroy();
  });
});

// ── Stroke shape validation ───────────────────────────────────────────────────

describe('Stroke data shape', () => {
  it('stores stroke with all required fields', () => {
    const doc = new Y.Doc();
    const yStrokes = doc.getMap<Stroke>('strokes');

    const stroke: Stroke = {
      id: 'full-stroke',
      tool: 'pen',
      color: '#3b82f6',
      lineWidth: 6,
      userId: 'user-xyz',
      points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      complete: true,
    };
    yStrokes.set(stroke.id, stroke);

    const retrieved = yStrokes.get('full-stroke')!;
    expect(retrieved.tool).toBe('pen');
    expect(retrieved.color).toBe('#3b82f6');
    expect(retrieved.lineWidth).toBe(6);
    expect(retrieved.points).toHaveLength(2);
    expect(retrieved.complete).toBe(true);
  });
});
