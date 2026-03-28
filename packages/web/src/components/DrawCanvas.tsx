/**
 * DrawCanvas — tldraw canvas wired to a Yjs document for real-time sync.
 *
 * Features:
 *   - Full tldraw toolbar (draw, shapes, text, eraser — built-in)
 *   - Color picker (built-in tldraw style panel)
 *   - Infinite canvas: pan/zoom (built-in)
 *   - Per-user undo/redo (built-in)
 *   - Live cursors via Yjs awareness
 *   - Real-time sync via y-websocket + TLStore
 */

import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useYjsStore } from '../hooks/useYjsStore.ts';
import { getRandomParticipantColor } from '../lib/colors.ts';
import { getUserId, getUserName } from '../lib/user.ts';

interface DrawCanvasProps {
  roomSlug: string;
  /** y-websocket URL — defaults to ws://localhost:1234 */
  wsUrl?: string;
  /** Override display name (from server-assigned participant). Falls back to localStorage. */
  userName?: string;
  /** Override color (from server-assigned participant). Falls back to random color. */
  userColor?: string;
}

type TldrawProps = ComponentPropsWithoutRef<typeof Tldraw>;

export default function DrawCanvas({
  roomSlug,
  wsUrl = 'ws://localhost:1234',
  userName: userNameProp,
  userColor: userColorProp,
}: DrawCanvasProps) {
  // Stable user identity across renders (stored in localStorage)
  const userId = getUserId();
  const userName = userNameProp ?? getUserName();
  const userColor = useRef(userColorProp ?? getRandomParticipantColor()).current;

  const storeWithStatus = useYjsStore({
    roomSlug,
    wsUrl,
    userId,
    userName,
    userColor,
  });

  // Keep a ref to provider.awareness so we can sync cursor from onMount
  // We attach the awareness updater when the editor mounts.
  const cleanupCursorRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupCursorRef.current?.();
    };
  }, []);

  const handleMount: TldrawProps['onMount'] = (editor: Editor) => {
    // Remove any previous cleanup
    cleanupCursorRef.current?.();

    // Throttle cursor updates — send at most every 50ms
    let lastSent = 0;
    const onEditorChange = () => {
      const now = Date.now();
      if (now - lastSent < 50) return;
      lastSent = now;

      // y-websocket's awareness is embedded in the provider which lives inside
      // the useYjsStore hook. We can't access it directly here, so we emit a
      // custom event that the hook can pick up. For MVP simplicity, cursor
      // position is updated via the standard tldraw collaborator mechanism:
      // TLInstancePresence is synced automatically by the store/awareness bridge
      // when tldraw writes the local presence record.
      //
      // Note: tldraw writes its own presence to the store under the 'presence'
      // scope. We piggyback on the awareness observer in useYjsStore to read
      // remote presence, and tldraw renders remote TLInstancePresence records
      // automatically as collaborator cursors.
    };

    editor.on('change', onEditorChange);
    cleanupCursorRef.current = () => editor.off('change', onEditorChange);
  };

  return (
    <div className="absolute inset-0">
      <Tldraw
        store={storeWithStatus}
        onMount={handleMount}
        inferDarkMode
      />
    </div>
  );
}
