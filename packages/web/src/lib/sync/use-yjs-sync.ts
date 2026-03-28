// React hook: creates a Yjs doc + WebSocket provider + tldraw store and wires them together.
// Returns a TLStoreWithStatus so tldraw can show connection state in the UI.

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { createTLStore, defaultShapeUtils, defaultBindingUtils } from 'tldraw';
import type { TLRecord, TLStore, TLStoreWithStatus } from 'tldraw';
import {
  bindYjsToTldraw,
  loadStoreStateIntoYjs,
  loadYjsStateIntoStore,
} from './yjs-tldraw-binding.js';
// Derive Awareness type from y-websocket (avoids direct y-protocols dep)
type Awareness = WebsocketProvider['awareness'];

const YWS_URL = import.meta.env['VITE_YWS_URL'] ?? 'ws://localhost:1234';

/** Key used in the Yjs document to store tldraw records. */
const RECORDS_KEY = 'tldraw:records';

export interface YjsSyncState {
  /** Pass directly to <Tldraw store={...} /> */
  storeWithStatus: TLStoreWithStatus;
  /** Yjs awareness for cursor sharing */
  awareness: Awareness | null;
  /** The raw TLStore (available once synced) */
  store: TLStore | null;
}

export function useYjsSync(roomSlug: string): YjsSyncState {
  // Create a stable TLStore once per component lifetime
  const storeRef = useRef<TLStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
  }
  const store = storeRef.current;

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: 'loading',
  });

  const awarenessRef = useRef<Awareness | null>(null);

  useEffect(() => {
    if (!roomSlug) return;

    const ydoc = new Y.Doc();
    const yRecords = ydoc.getMap<TLRecord>(RECORDS_KEY);

    const provider = new WebsocketProvider(YWS_URL, roomSlug, ydoc, {
      connect: true,
    });
    awarenessRef.current = provider.awareness;

    let bindingCleanup: (() => void) | null = null;

    // ── Initial sync ──────────────────────────────────────────────────────
    const handleSync = (synced: boolean) => {
      if (!synced) return;

      if (yRecords.size === 0) {
        // New room — push the tldraw default state into Yjs
        loadStoreStateIntoYjs(store, yRecords);
      } else {
        // Existing room — pull Yjs state into tldraw
        loadYjsStateIntoStore(store, yRecords);
      }

      // Start ongoing bidirectional sync
      bindingCleanup = bindYjsToTldraw(store, yRecords);

      setStoreWithStatus({
        status: 'synced-remote',
        connectionStatus: provider.wsconnected ? 'online' : 'offline',
        store,
      });
    };

    provider.on('sync', handleSync);

    // ── Connection status changes ─────────────────────────────────────────
    const handleStatus = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      setStoreWithStatus((prev) => {
        if (prev.status !== 'synced-remote') return prev;
        return {
          ...prev,
          connectionStatus: (status === 'connected' ? 'online' : 'offline') as 'online' | 'offline',
        };
      });
    };

    provider.on('status', handleStatus);

    return () => {
      provider.off('sync', handleSync);
      provider.off('status', handleStatus);
      bindingCleanup?.();
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
      awarenessRef.current = null;
    };
  }, [roomSlug, store]);

  return {
    storeWithStatus,
    awareness: awarenessRef.current,
    store: storeRef.current,
  };
}
