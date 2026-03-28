// Type declarations for packages that ship without TypeScript definitions

declare module 'y-websocket/bin/utils' {
  import type * as http from 'http';
  import type * as Y from 'yjs';

  export interface SetupWSConnectionOptions {
    docName?: string;
    gc?: boolean;
  }

  export function setupWSConnection(
    conn: unknown,
    req: http.IncomingMessage,
    options?: SetupWSConnectionOptions,
  ): void;

  export const docs: Map<string, Y.Doc>;
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
