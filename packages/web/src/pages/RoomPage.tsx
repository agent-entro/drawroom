/**
 * Room page — tldraw canvas with real-time Yjs sync.
 * Chat panel is a placeholder until Phase 3.
 */
import { Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';

// Code-split the heavy tldraw bundle
const DrawCanvas = lazy(() => import('../components/DrawCanvas.tsx'));

const WS_URL = (import.meta.env['VITE_YWS_URL'] as string | undefined) ?? 'ws://localhost:1234';

export default function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const roomSlug = slug ?? 'default';

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shadow-sm z-10 relative">
        <span className="font-bold text-gray-900 text-lg">
          Draw<span className="text-blue-600">Room</span>
        </span>
        <span className="text-sm text-gray-500 font-mono">{roomSlug}</span>
        <button
          onClick={() => void navigator.clipboard.writeText(window.location.href)}
          className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
          title="Copy room link to clipboard"
        >
          Share
        </button>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <section className="flex-1 relative" aria-label="Drawing canvas">
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                <span className="text-gray-400 animate-pulse">Loading canvas…</span>
              </div>
            }
          >
            <DrawCanvas roomSlug={roomSlug} wsUrl={WS_URL} />
          </Suspense>
        </section>

        {/* Chat placeholder — Phase 3 */}
        <aside className="w-72 flex flex-col bg-white border-l border-gray-200" aria-label="Chat panel">
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 text-sm">Chat coming in Phase 3</p>
          </div>
          <div className="border-t border-gray-200 p-3">
            <input
              disabled
              placeholder="Type a message…"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-400 text-sm"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
