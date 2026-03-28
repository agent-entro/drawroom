/**
 * Room page — plain Canvas drawing board with real-time Yjs sync.
 * Chat panel is a placeholder until Phase 3.
 */
import { Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom.ts';
import DisplayNameModal from '../components/DisplayNameModal.tsx';
import ParticipantList from '../components/ParticipantList.tsx';

// Code-split the canvas bundle
const DrawCanvas = lazy(() => import('../components/DrawCanvas.tsx'));

const WS_URL = (import.meta.env['VITE_YWS_URL'] as string | undefined) ?? 'ws://localhost:1234';

export default function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const roomSlug = slug ?? 'default';

  const {
    participant, participants, needsDisplayName, isLoading, error,
    joinWithName, refreshParticipants,
  } = useRoom(roomSlug);

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Display name modal — shown until user has joined */}
      {needsDisplayName && !isLoading && (
        <DisplayNameModal onJoin={joinWithName} error={error} isLoading={isLoading} />
      )}

      {/* Loading spinner */}
      {isLoading && !participant && !needsDisplayName && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-40">
          <span className="text-gray-400 animate-pulse">Connecting…</span>
        </div>
      )}

      {/* Error state (non-join errors) */}
      {error && !needsDisplayName && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2 shadow">
          {error}
        </div>
      )}

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shadow-sm z-10 relative">
        <span className="font-bold text-gray-900 text-lg">
          Draw<span className="text-blue-600">Room</span>
        </span>

        <div className="flex items-center gap-3">
          <ParticipantList
            participants={participants}
            currentParticipantId={participant?.id}
          />
          <span className="text-sm text-gray-500 font-mono">{roomSlug}</span>
        </div>

        <button
          onClick={() => void navigator.clipboard.writeText(window.location.href)}
          className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
          title="Copy room link to clipboard"
          aria-label="Copy room link to clipboard"
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
            <DrawCanvas
              roomSlug={roomSlug}
              wsUrl={WS_URL}
              userName={participant?.displayName}
              userColor={participant?.color}
              participantId={participant?.id}
              onParticipantsRefresh={refreshParticipants}
            />
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
