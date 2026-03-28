// Renders remote participant cursors inside the tldraw canvas.
// Mounted via tldraw's components={{ InFrontOfTheCanvas: CollabCursors }} so
// useEditor() is available.

import { useEffect, useRef, useState } from 'react';
import { useEditor } from 'tldraw';
import { useCollab } from '../lib/sync/collab-context.js';

interface RemoteCursorState {
  clientId: number;
  name: string;
  color: string;
  x: number; // page coordinates
  y: number;
}

/**
 * Converts page (canvas) coordinates to CSS pixel positions relative to the
 * tldraw viewport.  Called on every tick so cursors follow pan/zoom.
 */
function pageToViewport(
  editor: ReturnType<typeof useEditor>,
  pageX: number,
  pageY: number,
): { x: number; y: number } {
  const screen = editor.pageToScreen({ x: pageX, y: pageY });
  return { x: screen.x, y: screen.y };
}

export function CollabCursors() {
  const editor = useEditor();
  const { awareness } = useCollab();
  const [cursors, setCursors] = useState<RemoteCursorState[]>([]);
  const myClientId = awareness?.clientID;

  useEffect(() => {
    if (!awareness) return;

    const update = () => {
      const states = awareness.getStates() as Map<number, Record<string, unknown>>;
      const remote: RemoteCursorState[] = [];
      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId === myClientId) return;
        const cursor = state['cursor'] as { x: number; y: number } | undefined;
        if (!cursor) return;
        remote.push({
          clientId,
          name: (state['name'] as string | undefined) ?? 'Anonymous',
          color: (state['color'] as string | undefined) ?? '#94a3b8',
          x: cursor.x,
          y: cursor.y,
        });
      });
      setCursors(remote);
    };

    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness, myClientId]);

  // Re-render cursors when viewport changes (pan/zoom)
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const handler = () => forceUpdate((n) => n + 1);
    editor.on('tick', handler);
    return () => void editor.off('tick', handler);
  }, [editor]);

  return (
    <>
      {cursors.map((cursor) => {
        const { x, y } = pageToViewport(editor, cursor.x, cursor.y);
        return (
          <div
            key={cursor.clientId}
            className="pointer-events-none absolute z-50 select-none"
            style={{ left: x, top: y, transform: 'translate(-2px, -2px)' }}
          >
            {/* Cursor arrow */}
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
              <path
                d="M0 0L0 14L4 10L7 18L9 17L6 9L12 9Z"
                fill={cursor.color}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>
            {/* Name tag */}
            <div
              className="absolute left-4 top-0 rounded px-1.5 py-0.5 text-xs text-white whitespace-nowrap shadow"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.name}
            </div>
          </div>
        );
      })}
    </>
  );
}
