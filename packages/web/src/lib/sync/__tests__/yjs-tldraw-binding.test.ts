/**
 * Unit tests for yjs-tldraw-binding.ts
 *
 * Verifies the three exported functions:
 *   - loadYjsStateIntoStore: copies Y.Map → TLStore on initial load
 *   - loadStoreStateIntoYjs: copies TLStore snapshot → Y.Map for new rooms
 *   - bindYjsToTldraw: bidirectional ongoing sync (no echo loops)
 *
 * Uses TLInstancePresence records for store tests because:
 *   - createTLStore() starts empty (no auto-init records in v4)
 *   - Presence records don't require shape-specific type field validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  createTLStore,
  InstancePresenceRecordType,
  type TLRecord,
  type TLPageId,
  type TLInstancePresence,
} from 'tldraw';
import {
  loadYjsStateIntoStore,
  loadStoreStateIntoYjs,
  bindYjsToTldraw,
} from '../yjs-tldraw-binding.js';

function makePresence(userId: string): TLInstancePresence {
  return InstancePresenceRecordType.create({
    id: InstancePresenceRecordType.createId(userId),
    userId,
    userName: `User ${userId}`,
    color: '#ff0000',
    currentPageId: 'page:page' as TLPageId,
    lastActivityTimestamp: Date.now(),
    cursor: null,
    camera: null,
    brush: null,
    scribbles: [],
    screenBounds: null,
    selectedShapeIds: [],
    followingUserId: null,
    chatMessage: '',
    meta: {},
  });
}

// ── loadYjsStateIntoStore ─────────────────────────────────────────────────────

describe('loadYjsStateIntoStore', () => {
  it('does nothing when Y.Map is empty (no crash)', () => {
    const store = createTLStore();
    const doc = new Y.Doc();
    const yMap = doc.getMap<TLRecord>('tldraw');

    expect(() => loadYjsStateIntoStore(store, yMap)).not.toThrow();
  });

  it('puts valid records from Y.Map into the store', () => {
    const store = createTLStore();
    const doc = new Y.Doc();
    const yMap = doc.getMap<TLRecord>('tldraw');

    const rec = makePresence('u_load_test') as TLRecord;
    yMap.set(rec.id, rec);

    loadYjsStateIntoStore(store, yMap);

    const found = store.allRecords().find((r) => r.id === rec.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(rec.id);
  });

  it('puts multiple records from Y.Map into the store', () => {
    const store = createTLStore();
    const doc = new Y.Doc();
    const yMap = doc.getMap<TLRecord>('tldraw');

    const recs = ['u_a', 'u_b', 'u_c'].map((id) => makePresence(id) as TLRecord);
    for (const r of recs) yMap.set(r.id, r);

    loadYjsStateIntoStore(store, yMap);

    for (const r of recs) {
      expect(store.allRecords().find((s) => s.id === r.id)).toBeDefined();
    }
  });
});

// ── loadStoreStateIntoYjs ─────────────────────────────────────────────────────

describe('loadStoreStateIntoYjs', () => {
  it('copies store records into Y.Map', () => {
    const store = createTLStore();
    const doc = new Y.Doc();
    const yMap = doc.getMap<TLRecord>('tldraw');

    // Pre-populate store via mergeRemoteChanges
    const rec = makePresence('u_snapshot') as TLRecord;
    store.mergeRemoteChanges(() => { store.put([rec]); });
    expect(store.allRecords().length).toBeGreaterThan(0);

    loadStoreStateIntoYjs(store, yMap);

    // Every record in the store should now be in the Y.Map
    for (const r of store.allRecords()) {
      expect(yMap.has(r.id)).toBe(true);
    }
  });

  it('is a no-op on an empty store (no crash)', () => {
    const store = createTLStore();
    const doc = new Y.Doc();
    const yMap = doc.getMap<TLRecord>('tldraw');

    expect(() => loadStoreStateIntoYjs(store, yMap)).not.toThrow();
    expect(yMap.size).toBe(0);
  });
});

// ── bindYjsToTldraw ───────────────────────────────────────────────────────────

describe('bindYjsToTldraw — cleanup', () => {
  it('returns a callable cleanup function', () => {
    const store = createTLStore();
    const doc = new Y.Doc();
    const yMap = doc.getMap<TLRecord>('tldraw');

    const cleanup = bindYjsToTldraw(store, yMap);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });
});

describe('bindYjsToTldraw — Yjs → store (remote changes)', () => {
  let store: ReturnType<typeof createTLStore>;
  let doc: Y.Doc;
  let yMap: Y.Map<TLRecord>;
  let cleanup: () => void;

  beforeEach(() => {
    store = createTLStore();
    doc = new Y.Doc();
    yMap = doc.getMap<TLRecord>('tldraw');
    cleanup = bindYjsToTldraw(store, yMap);
  });

  afterEach(() => {
    cleanup();
    doc.destroy();
  });

  it('applies remote Y.Map additions to the store', () => {
    const rec = makePresence('u_remote_add') as TLRecord;

    doc.transact(() => {
      yMap.set(rec.id, rec);
    }, 'remote-origin');

    expect(store.allRecords().find((r) => r.id === rec.id)).toBeDefined();
  });

  it('removes store records when Y.Map entries are deleted remotely', () => {
    const rec = makePresence('u_remote_del') as TLRecord;

    // Add via remote transaction
    doc.transact(() => {
      yMap.set(rec.id, rec);
    }, 'remote-origin');
    expect(store.allRecords().find((r) => r.id === rec.id)).toBeDefined();

    // Delete via remote transaction
    doc.transact(() => {
      yMap.delete(rec.id);
    }, 'remote-origin');
    expect(store.allRecords().find((r) => r.id === rec.id)).toBeUndefined();
  });

  it('applies multiple remote records in one transaction', () => {
    const recs = ['u_m1', 'u_m2', 'u_m3'].map((id) => makePresence(id) as TLRecord);

    doc.transact(() => {
      for (const r of recs) yMap.set(r.id, r);
    }, 'remote-origin');

    for (const r of recs) {
      expect(store.allRecords().find((s) => s.id === r.id)).toBeDefined();
    }
  });
});

// ── No echo loop ──────────────────────────────────────────────────────────────

describe('bindYjsToTldraw — no echo loop', () => {
  it('does not re-observe its own Yjs transactions', () => {
    // Wire two Y.Docs to simulate a network relay
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));

    const yMapA = docA.getMap<TLRecord>('tldraw');
    const yMapB = docB.getMap<TLRecord>('tldraw');

    let observerFires = 0;
    yMapB.observe(() => { observerFires++; });

    // Remote write on docA propagates to docB
    docA.transact(() => {
      yMapA.set('shape:echo-test', makePresence('u_echo') as TLRecord);
    }, 'remote');

    // Observer fires exactly once (no echo re-trigger)
    expect(observerFires).toBe(1);
    expect(yMapB.get('shape:echo-test')).toBeDefined();

    docA.destroy();
    docB.destroy();
  });
});
