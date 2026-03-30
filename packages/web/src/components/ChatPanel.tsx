/**
 * ChatPanel — right sidebar with real-time chat.
 * Presentational component; state managed by useYjsChat in RoomPage.
 *
 * Features:
 *   - Message list with name + color indicator + timestamp
 *   - Auto-scroll to newest message
 *   - Enter-to-send input (Shift+Enter for newline)
 *   - Inline emoji picker (lazy-mounted)
 *   - "X is typing..." via Yjs awareness
 *   - Collapsible panel
 */
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import type { ChatMsgView, SendMessageOptions } from '../hooks/useYjsChat.ts';

const EmojiPicker = lazy(() => import('./EmojiPicker.tsx'));

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatTypingText(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface MessageItemProps {
  msg: ChatMsgView;
  isOwn: boolean;
}

function MessageItem({ msg, isOwn }: MessageItemProps) {
  if (msg.type === 'system') {
    return (
      <div className="flex justify-center my-1">
        <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
          {msg.content}
        </span>
      </div>
    );
  }

  const isComment = msg.type === 'comment';

  return (
    <div className={`flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
      {/* Sender line */}
      <div className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: msg.color }}
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-gray-700 truncate max-w-[120px]">
          {isOwn ? 'You' : msg.displayName}
        </span>
        {isComment && (
          <span className="text-xs text-blue-500" title="Canvas-anchored comment">
            📍
          </span>
        )}
      </div>
      {/* Bubble */}
      <div
        className={[
          'max-w-[75%] w-fit text-sm break-words leading-[1.4]',
          'rounded-[18px]',
          isOwn
            ? 'rounded-br-[4px] text-white'
            : 'rounded-bl-[4px]',
          isComment ? 'border-l-2' : '',
        ].join(' ')}
        style={{
          padding: '10px 14px',
          backgroundColor: isOwn ? '#007bff' : '#f1f0f0',
          color: isOwn ? 'white' : '#333',
          wordWrap: 'break-word',
          ...(isComment && !isOwn ? { borderLeftColor: msg.color } : {}),
        }}
      >
        {msg.content}
      </div>
      {/* Timestamp below bubble */}
      <span style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
        {formatTime(msg.createdAt)}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ChatPanelProps {
  messages: ChatMsgView[];
  typingNames: string[];
  sendMessage: (content: string, opts?: SendMessageOptions) => void;
  setTyping: (isTyping: boolean) => void;
  isConnected: boolean;
  participantId?: string;
  /** Whether the panel starts collapsed */
  defaultCollapsed?: boolean;
}

export default function ChatPanel({
  messages,
  typingNames,
  sendMessage,
  setTyping,
  isConnected,
  participantId,
  defaultCollapsed = false,
}: ChatPanelProps) {
  const [text, setText] = useState('');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll when messages change
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      setTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setTyping(false), 3_000);
    },
    [setTyping],
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setText('');
    setTyping(false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    inputRef.current?.focus();
  }, [text, sendMessage, setTyping]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  useEffect(
    () => () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    },
    [],
  );

  if (collapsed) {
    return (
      <aside
        className="flex flex-col items-center bg-white border-l border-gray-200 py-3 gap-3"
        style={{ width: 40 }}
        aria-label="Chat panel (collapsed)"
      >
        <button
          onClick={() => setCollapsed(false)}
          title="Open chat"
          aria-label="Open chat panel"
          className="text-gray-500 hover:text-gray-800 transition-colors"
        >
          <svg
            width="18"
            height="18"
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
        </button>
        {messages.length > 0 && (
          <span className="text-xs bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center font-medium">
            {messages.length > 99 ? '99' : messages.length}
          </span>
        )}
      </aside>
    );
  }

  const typingText = formatTypingText(typingNames);

  return (
    <aside
      className="w-72 flex flex-col bg-white border-l border-gray-200"
      aria-label="Chat panel"
      style={{ fontFamily: "'Inter', 'Segoe UI', Roboto, sans-serif" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800 text-sm">Chat</span>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: isConnected ? '#22c55e' : '#f59e0b' }}
            title={isConnected ? 'Connected' : 'Connecting…'}
            aria-label={isConnected ? 'Chat connected' : 'Chat connecting'}
          />
        </div>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse chat"
          aria-label="Collapse chat panel"
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto flex flex-col"
        style={{ padding: 16, gap: 8 }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && (
          <p className="text-center text-xs text-gray-400 mt-8">No messages yet. Say hi!</p>
        )}
        {messages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} isOwn={msg.participantId === participantId} />
        ))}
      </div>

      {/* Typing indicator */}
      {typingText && <div className="px-3 py-1 text-xs text-gray-400 italic">{typingText}</div>}

      {/* Input area */}
      <div className="border-t border-gray-200 bg-gray-50 p-2">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send)"
              rows={1}
              maxLength={2000}
              disabled={!isConnected}
              aria-label="Chat message input"
              className={[
                'w-full resize-none rounded-xl text-sm',
                'focus:outline-none focus:ring-2 focus:ring-blue-300',
                'max-h-24 overflow-y-auto',
                isConnected
                  ? 'bg-white text-gray-900'
                  : 'bg-gray-50 text-gray-400',
              ].join(' ')}
              style={{
                minHeight: 38,
                padding: '10px 15px',
                border: '1px solid #ddd',
              }}
            />
          </div>

          {/* Emoji button */}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              title="Emoji"
              aria-label="Open emoji picker"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((o) => !o)}
              className="h-9 w-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span aria-hidden="true" className="text-lg leading-none">
                😊
              </span>
            </button>
            {emojiOpen && (
              <Suspense fallback={null}>
                <EmojiPicker
                  onSelect={(emoji) => setText((t) => t + emoji)}
                  onClose={() => setEmojiOpen(false)}
                />
              </Suspense>
            )}
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || !isConnected}
            aria-label="Send message"
            title="Send (Enter)"
            className={[
              'h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-xl transition-colors',
              text.trim() && isConnected
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed',
            ].join(' ')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
