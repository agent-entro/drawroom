// Bidirectional binding between a tldraw TLStore and a Yjs Y.Map.
// Framework-agnostic — no React imports.
//
// Contract:
//   - yRecords stores every tldraw record keyed by its ID
//   - User changes flow: TLStore → ydoc.transact → Y.Map
//   - Remote changes flow: Y.Map observe → store.mergeRemoteChanges
//   - The origin token prevents echo loops

import * as Y from 'yjs';
import type { TLRecord, TLStore } from 'tldraw';

/** Opaque token used as the Yjs transaction origin to skip our own echo. */
const TLDRAW_ORIGIN = Symbol('tldraw-binding');

/**
 * Load the current Yjs document state into the tldraw store.
 * Call this once after the provider has synced.
 */
export function loadYjsStateIntoStore(
  store: TLStore,
  yRecords: Y.Map<TLRecord>,
): void {
  const records = Array.from(yRecords.values());
  if (records.length === 0) return;
  store.mergeRemoteChanges(() => {
    store.put(records);
  });
}

/**
 * Load the current tldraw store snapshot into the Yjs document.
 * Call this when creating a brand-new room (ydoc is empty).
 */
export function loadStoreStateIntoYjs(
  store: TLStore,
  yRecords: Y.Map<TLRecord>,
): void {
  const all = store.allRecords();
  yRecords.doc!.transact(() => {
    for (const record of all) {
      yRecords.set(record.id, record);
    }
  }, TLDRAW_ORIGIN);
}

export interface BindingCleanup {
  (): void;
}

/**
 * Set up ongoing bidirectional sync between tldraw store and Yjs map.
 * Returns a cleanup function — call it on unmount.
 *
 * Prerequisites:
 *   - Initial state must already be loaded before calling this.
 */
export function bindYjsToTldraw(
  store: TLStore,
  yRecords: Y.Map<TLRecord>,
): BindingCleanup {
  // ── tldraw → Yjs ──────────────────────────────────────────────────────────
  const removeTldrawListener = store.listen(
    (entry) => {
      const { changes } = entry;
      yRecords.doc!.transact(() => {
        // Added / updated records
        for (const record of Object.values(changes.added)) {
          yRecords.set(record.id, record);
        }
        for (const [, next] of Object.values(changes.updated)) {
          yRecords.set(next.id, next);
        }
        // Deleted records
        for (const record of Object.values(changes.removed)) {
          yRecords.delete(record.id);
        }
      }, TLDRAW_ORIGIN);
    },
    { source: 'user', scope: 'document' },
  );

  // ── Yjs → tldraw ──────────────────────────────────────────────────────────
  const yjsObserver = (
    event: Y.YMapEvent<TLRecord>,
    transaction: Y.Transaction,
  ) => {
    // Skip changes that originated from our own tldraw listener above
    if (transaction.origin === TLDRAW_ORIGIN) return;

    const toUpsert: TLRecord[] = [];
    const toDelete: string[] = [];

    event.changes.keys.forEach((change, id) => {
      if (change.action === 'delete') {
        toDelete.push(id);
      } else {
        const record = yRecords.get(id);
        if (record) toUpsert.push(record);
      }
    });

    if (toUpsert.length === 0 && toDelete.length === 0) return;

    store.mergeRemoteChanges(() => {
      if (toUpsert.length > 0) store.put(toUpsert);
      if (toDelete.length > 0) store.remove(toDelete as Parameters<typeof store.remove>[0]);
    });
  };

  yRecords.observe(yjsObserver);

  return () => {
    removeTldrawListener();
    yRecords.unobserve(yjsObserver);
  };
}
