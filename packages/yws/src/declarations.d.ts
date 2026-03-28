// Type declarations for packages that ship without TypeScript definitions

declare module 'y-websocket/bin/utils' {
  import type * as http from 'http';
  import type * as Y from 'yjs';

  export interface SetupWSConnectionOptions {
    docName?: string;
    gc?: boolean;
  }

  /** Subset of the y-protocols Awareness API needed for presence heartbeats */
  export interface WSAwareness {
    clientID: number;
    getStates(): Map<number, Record<string, unknown>>;
    on(event: 'change', handler: (changes: { added: number[]; updated: number[]; removed: number[] }) => void): void;
    off(event: 'change', handler: (changes: { added: number[]; updated: number[]; removed: number[] }) => void): void;
  }

  /** y-websocket's internal shared doc — Y.Doc extended with awareness */
  export interface WSSharedDoc extends Y.Doc {
    awareness: WSAwareness;
  }

  export function setupWSConnection(
    conn: unknown,
    req: http.IncomingMessage,
    options?: SetupWSConnectionOptions,
  ): void;

  export const docs: Map<string, WSSharedDoc>;
}

declare module 'y-leveldb' {
  import type * as Y from 'yjs';

  export class LeveldbPersistence {
    constructor(location: string);
    getYDoc(docName: string): Promise<Y.Doc>;
    storeUpdate(docName: string, update: Uint8Array): Promise<void>;
    destroy(): Promise<void>;
  }
}
