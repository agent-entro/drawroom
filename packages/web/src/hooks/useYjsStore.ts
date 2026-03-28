/**
 * useYjsStore — connects a tldraw TLStore to a Yjs document via y-websocket.
 *
 * Syncs:
 *   - document-scope records  →  Y.Map("tldraw")
 *   - awareness (cursors)     →  TLInstancePresence records in the store
 *
 * Returns a TLStoreWithStatus so <Tldraw store={...}> can show offline indicators.
 */

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  createTLStore,
  type TLStoreWithStatus,
  type TLRecord,
  type TLInstancePresence,
  type TLPageId,
  setUserPreferences,
  InstancePresenceRecordType,
} from 'tldraw';

export interface YjsStoreOptions {
  roomSlug: string;
  /** y-websocket server base URL (no trailing slash) */
  wsUrl?: string;
  userId: string;
  userName: string;
  userColor: string;
}

export function useYjsStore({
  roomSlug,
  wsUrl = 'ws://localhost:1234',
  userId,
  userName,
  userColor,
}: YjsStoreOptions): TLStoreWithStatus {
  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: 'loading',
  });

  useEffect(() => {
    // Tell tldraw our user identity
    setUserPreferences({ id: userId, name: userName, color: userColor });

    const doc = new Y.Doc();
    // All document-scope records live in this map (keyed by record id)
    const yRecords = doc.getMap<TLRecord>('tldraw');

    const store = createTLStore();

    // Connect to the room at ws://<host>/<slug>
    const provider = new WebsocketProvider(wsUrl, `r/${roomSlug}`, doc, {
      connect: true,
      disableBc: false,
    });

    // ── Status tracking ───────────────────────────────────────────────────────

    const handleStatus = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      setStoreWithStatus((prev) => {
        if (prev.status === 'loading') return prev;
        const s = prev as Extract<TLStoreWithStatus, { store: typeof store }>;
        return {
          ...s,
          connectionStatus: status === 'connected' ? 'online' : 'offline',
        } as TLStoreWithStatus;
      });
    };
    provider.on('status', handleStatus);

    // ── Initial load on sync ──────────────────────────────────────────────────

    const handleSync = (synced: boolean) => {
      if (!synced) return;

      // Bulk-load persisted records from Y.Map into the store
      store.mergeRemoteChanges(() => {
        const records = Array.from(yRecords.values());
        if (records.length > 0) {
          store.put(records);
        }
      });

      setStoreWithStatus({
        status: 'synced-remote',
        connectionStatus: 'online',
        store,
      });
    };
    provider.on('sync', handleSync);

    // ── Local → Yjs: forward user changes to the Y.Map ───────────────────────

    const removeStoreListener = store.listen(
      ({ changes }) => {
        doc.transact(() => {
          // added
          for (const record of Object.values(changes.added)) {
            yRecords.set(record.id, record as TLRecord);
          }
          // updated: [from, to]
          for (const [, [, to]] of Object.entries(changes.updated)) {
            yRecords.set((to as TLRecord).id, to as TLRecord);
          }
          // removed
          for (const record of Object.values(changes.removed)) {
            yRecords.delete((record as TLRecord).id);
          }
        }, 'local-store-listener');
      },
      { source: 'user', scope: 'document' },
    );

    // ── Yjs → Local: apply remote Y.Map changes to the store ─────────────────

    const handleYMapChange = (
      event: Y.YMapEvent<TLRecord>,
      transaction: Y.Transaction,
    ) => {
      // Skip updates that originated from this client
      if (transaction.local) return;

      store.mergeRemoteChanges(() => {
        const puts: TLRecord[] = [];
        const removes: string[] = [];

        event.changes.keys.forEach((change, key) => {
          if (change.action === 'add' || change.action === 'update') {
            const record = yRecords.get(key);
            if (record !== undefined) puts.push(record);
          } else if (change.action === 'delete') {
            removes.push(key);
          }
        });

        if (puts.length > 0) store.put(puts);
        if (removes.length > 0) store.remove(removes as ReturnType<typeof store.allRecords>[number]['id'][]);
      });
    };
    yRecords.observe(handleYMapChange);

    // ── Awareness → store: render remote cursors as TLInstancePresence ────────

    const awareness = provider.awareness;

    // Set our own awareness state so peers can see us
    awareness.setLocalStateField('presence', {
      userId,
      userName,
      userColor,
      cursor: null as { x: number; y: number } | null,
    });

    const syncAwareness = () => {
      const states = awareness.getStates() as Map<number, {
        presence?: {
          userId: string;
          userName: string;
          userColor: string;
          cursor: { x: number; y: number } | null;
        };
      }>;

      const incomingPresences: TLInstancePresence[] = [];

      states.forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // skip self
        const p = state.presence;
        if (!p?.userId) return;

        const presenceId = InstancePresenceRecordType.createId(p.userId);
        incomingPresences.push(
          InstancePresenceRecordType.create({
            id: presenceId,
            userId: p.userId,
            userName: p.userName ?? 'Anonymous',
            color: p.userColor ?? '#cccccc',
            currentPageId: 'page:page' as TLPageId,
            lastActivityTimestamp: Date.now(),
            cursor: p.cursor
              ? { x: p.cursor.x, y: p.cursor.y, type: 'default', rotation: 0 }
              : null,
            camera: null,
            brush: null,
            scribbles: [],
            screenBounds: null,
            selectedShapeIds: [],
            followingUserId: null,
            chatMessage: '',
            meta: {},
          }),
        );
      });

      store.mergeRemoteChanges(() => {
        // Remove stale presence records (peers who left)
        const existingPresence = store
          .allRecords()
          .filter((r): r is TLInstancePresence => r.typeName === 'instance_presence');
        const activeIds = new Set(incomingPresences.map((r) => r.id));
        const stale = existingPresence.filter((r) => !activeIds.has(r.id)).map((r) => r.id);
        if (stale.length > 0) store.remove(stale);
        if (incomingPresences.length > 0) store.put(incomingPresences);
      });
    };

    awareness.on('change', syncAwareness);

    return () => {
      removeStoreListener();
      yRecords.unobserve(handleYMapChange);
      awareness.off('change', syncAwareness);
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.disconnect();
      doc.destroy();
    };
  }, [roomSlug, wsUrl, userId, userName, userColor]);

  return storeWithStatus;
}

