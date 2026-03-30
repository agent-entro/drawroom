/**
 * Room page — canvas + real-time chat sidebar.
 *
 * Chat state (useYjsChat) lives here so comment pins can flow
 * from ChatPanel → DrawCanvas without prop-drilling through lazy boundaries.
 */
import { Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom.ts';
import { useYjsChat } from '../hooks/useYjsChat.ts';
import DisplayNameModal from '../components/DisplayNameModal.tsx';
import ParticipantList from '../components/ParticipantList.tsx';
import ChatPanel from '../components/ChatPanel.tsx';

// Code-split the canvas bundle
const DrawCanvas = lazy(() => import('../components/DrawCanvas.tsx'));

// Derive WS URL from the current page host so it works from any hostname
// (e.g. agent.br-ndt.dev or localhost).  Vite's dev-server proxy forwards
// ws://<host>:<port>/r/... → ws://localhost:1234/r/... so no hardcoded port
// is needed.  VITE_YWS_URL overrides this for production deployments where
// the YWS server is on a separate host or uses TLS (wss://).
const _defaultWsUrl = () => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
};
const WS_URL = (import.meta.env['VITE_YWS_URL'] as string | undefined) ?? _defaultWsUrl();

export default function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const roomSlug = slug ?? 'default';

  const {
    participant, participants, needsDisplayName, isLoading, error,
    joinWithName, refreshParticipants,
  } = useRoom(roomSlug);

  // Chat state — lifted here so comment pins can flow to DrawCanvas
  const {
    messages,
    typingNames,
    sendMessage,
    setTyping,
    isConnected: chatConnected,
    commentPins,
  } = useYjsChat({
    roomSlug,
    wsUrl: WS_URL,
    participant: participant
      ? { id: participant.id, displayName: participant.displayName, color: participant.color }
      : null,
  });

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
              commentPins={commentPins.map((m) => ({
                id: m.id,
                content: m.content,
                displayName: m.displayName,
                color: m.color,
                x: m.canvasX!,
                y: m.canvasY!,
              }))}
              onCommentCreate={(content, x, y) => {
                sendMessage(content, { canvasX: x, canvasY: y, type: 'comment' });
              }}
            />
          </Suspense>
        </section>

        {/* Chat panel */}
        <ChatPanel
          messages={messages}
          typingNames={typingNames}
          sendMessage={sendMessage}
          setTyping={setTyping}
          isConnected={chatConnected}
          participantId={participant?.id}
        />
      </div>
    </div>
  );
}
