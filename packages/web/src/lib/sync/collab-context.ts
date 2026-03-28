// Context that provides Yjs awareness to components inside the tldraw tree.
import { createContext, useContext } from 'react';
import type { WebsocketProvider } from 'y-websocket';

// Derive the Awareness type from y-websocket's provider so we don't need
// y-protocols as a direct dependency (it's a transitive dep of y-websocket).
type Awareness = WebsocketProvider['awareness'];

export interface CollabContextValue {
  awareness: Awareness | null;
  /** This user's display name */
  userName: string;
  /** This user's assigned color (hex) */
  userColor: string;
}

export const CollabContext = createContext<CollabContextValue>({
  awareness: null,
  userName: 'Anonymous',
  userColor: '#3b82f6',
});

export function useCollab(): CollabContextValue {
  return useContext(CollabContext);
}
