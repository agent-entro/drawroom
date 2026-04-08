/**
 * Room page — canvas + real-time chat sidebar.
 *
 * Chat state (useYjsChat) lives here so comment pins can flow
 * from ChatPanel → DrawCanvas without prop-drilling through lazy boundaries.
 */
import { Suspense, lazy, useState } from 'react';
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

  // Mobile chat panel toggle — hidden by default on small screens
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

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
    <div className="h-[100dvh] flex flex-col bg-white">
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
        <span className="font-bold text-gray-900 text-lg shrink-0">
          Draw<span className="text-blue-600">Room</span>
        </span>

        <div className="flex items-center gap-2 min-w-0 mx-2">
          <ParticipantList
            participants={participants}
            currentParticipantId={participant?.id}
          />
          <span className="text-sm text-gray-500 font-mono truncate max-w-[100px] sm:max-w-none hidden xs:block sm:block">
            {roomSlug}
          </span>
        </div>

        <button
          onClick={() => void navigator.clipboard.writeText(window.location.href)}
          className="shrink-0 text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 rounded-lg text-gray-700 font-medium transition-colors min-h-[36px]"
          title="Copy room link to clipboard"
          aria-label="Copy room link to clipboard"
        >
          Share
        </button>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Canvas */}
        <section className="flex-1 min-h-0 relative" aria-label="Drawing canvas">
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

        {/* Mobile backdrop — tap to close chat */}
        {mobileChatOpen && (
          <div
            className="md:hidden absolute inset-0 z-10 bg-black/20"
            onClick={() => setMobileChatOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Chat panel
            Desktop (md+): always visible as a sidebar
            Mobile: hidden by default; slides in as an absolute overlay when open */}
        <div
          className={[
            'md:flex',
            mobileChatOpen
              ? 'flex absolute inset-y-0 right-0 z-20 md:relative md:z-auto md:shadow-none shadow-2xl'
              : 'hidden',
          ].join(' ')}
        >
          <ChatPanel
            messages={messages}
            typingNames={typingNames}
            sendMessage={sendMessage}
            setTyping={setTyping}
            isConnected={chatConnected}
            participantId={participant?.id}
            onClose={() => setMobileChatOpen(false)}
          />
        </div>

        {/* Floating chat toggle — mobile only, shown when chat is closed */}
        {!mobileChatOpen && (
          <button
            className="md:hidden absolute bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))] right-4 z-20 h-12 w-12 flex items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 active:scale-95 transition-all"
            onClick={() => setMobileChatOpen(true)}
            aria-label="Open chat"
            title="Open chat"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {/* Unread badge */}
            {messages.filter((m) => m.type !== 'system').length > 0 && (
              <span
                className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none"
                aria-label={`${messages.filter((m) => m.type !== 'system').length} messages`}
              >
                {messages.filter((m) => m.type !== 'system').length > 9
                  ? '9+'
                  : messages.filter((m) => m.type !== 'system').length}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
