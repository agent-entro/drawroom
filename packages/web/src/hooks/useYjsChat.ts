/**
 * useYjsChat — real-time chat using Y.Map on a shared Yjs doc.
 *
 * Transport: separate y-websocket connection to the same room
 *   (y-websocket merges docs server-side, so both canvas and chat
 *   operate on the same CRDT document via independent connections).
 *
 * Message storage: Y.Map<StoredChatMsg>('chat') keyed by message ID.
 *   Keyed storage ensures no duplicates when history is merged.
 *
 * History: fetched from REST API on sync and merged into Y.Map.
 *
 * Typing indicators: Yjs awareness field `chat.typing`.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { getMessages, postMessage } from '../lib/api.ts';
import { MAX_MESSAGE_LENGTH } from '@drawroom/shared';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Full message view with display info */
export interface ChatMsgView {
  id: string;
  content: string;
  type: 'message' | 'comment' | 'system';
  participantId: string;
  displayName: string;
  color: string;
  canvasX: number | null;
  canvasY: number | null;
  createdAt: string;
}

/** Serialized form stored in Y.Map — must be plain JSON */
type StoredChatMsg = ChatMsgView;

/** Awareness state for typing indicators */
interface AwarenessChat {
  typing: boolean;
  displayName: string;
  color: string;
}

export interface ChatParticipant {
  id: string;
  displayName: string;
  color: string;
}

export interface SendMessageOptions {
  canvasX?: number;
  canvasY?: number;
  type?: 'message' | 'comment' | 'system';
}

export interface YjsChatState {
  messages: ChatMsgView[];
  typingNames: string[];
  sendMessage: (content: string, opts?: SendMessageOptions) => void;
  setTyping: (isTyping: boolean) => void;
  isConnected: boolean;
  /** messages with canvas coordinates — used for comment pin rendering */
  commentPins: ChatMsgView[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useYjsChat({
  roomSlug,
  wsUrl = 'ws://localhost:1234',
  participant,
}: {
  roomSlug: string;
  wsUrl?: string;
  participant: ChatParticipant | null;
}): YjsChatState {
  const [messages, setMessages] = useState<ChatMsgView[]>([]);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const yChatRef = useRef<Y.Map<StoredChatMsg> | null>(null);
  const awarenessRef = useRef<WebsocketProvider['awareness'] | null>(null);
  const participantRef = useRef(participant);
  // IDs we've persisted to avoid re-posting on reconnect
  const persistedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    participantRef.current = participant;
    // Update awareness when participant changes
    if (awarenessRef.current && participant) {
      awarenessRef.current.setLocalStateField('chat', {
        typing: false,
        displayName: participant.displayName,
        color: participant.color,
      });
    }
  }, [participant]);

  // Persist a message to the REST API — fire and forget
  const persistToApi = useCallback(
    async (msg: StoredChatMsg): Promise<void> => {
      if (persistedIdsRef.current.has(msg.id)) return;
      persistedIdsRef.current.add(msg.id);
      try {
        await postMessage(roomSlug, {
          participantId: msg.participantId,
          content: msg.content,
          type: msg.type === 'comment' ? 'comment' : 'message',
          canvasX: msg.canvasX ?? undefined,
          canvasY: msg.canvasY ?? undefined,
        });
      } catch {
        // Non-fatal — message already synced via Yjs
      }
    },
    [roomSlug],
  );

  useEffect(() => {
    const doc = new Y.Doc();
    const yChat = doc.getMap<StoredChatMsg>('chat');
    yChatRef.current = yChat;

    const provider = new WebsocketProvider(wsUrl, `r/${roomSlug}`, doc, {
      connect: true,
      disableBc: false,
    });
    awarenessRef.current = provider.awareness;

    // Set initial awareness
    if (participantRef.current) {
      provider.awareness.setLocalStateField('chat', {
        typing: false,
        displayName: participantRef.current.displayName,
        color: participantRef.current.color,
      });
    }

    // Connection status
    const handleStatus = ({ status: s }: { status: string }) => {
      setIsConnected(s === 'connected');
    };
    provider.on('status', handleStatus);

    // Observe Y.Map changes → rebuild sorted message list
    const handleObserve = () => {
      const all = Array.from(yChat.values());
      const sorted = all.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setMessages(sorted);
    };
    yChat.observe(handleObserve);

    // Load history from REST API once Yjs syncs
    let historyLoaded = false;
    const handleSync = (synced: boolean) => {
      if (!synced || historyLoaded) return;
      historyLoaded = true;

      void (async () => {
        try {
          const existingIds = new Set(Array.from(yChat.keys()));
          // Messages API now JOINs participants, so displayName + color are included
          const msgRes = await getMessages(roomSlug, { limit: 100 });
          const toInsert = msgRes.messages.filter((m) => !existingIds.has(m.id));

          if (toInsert.length > 0) {
            doc.transact(() => {
              for (const m of toInsert) {
                yChat.set(m.id, {
                  id: m.id,
                  content: m.content,
                  type: m.type as StoredChatMsg['type'],
                  participantId: m.participantId,
                  displayName: m.displayName,
                  color: m.color,
                  canvasX: m.canvasX,
                  canvasY: m.canvasY,
                  createdAt: m.createdAt,
                });
              }
            });
          }
        } catch {
          // Non-fatal — just no history
        }
      })();
    };
    provider.on('sync', handleSync);

    // Typing indicators via awareness
    const handleAwareness = () => {
      const states = provider.awareness.getStates() as Map<number, { chat?: AwarenessChat }>;
      const typing: string[] = [];
      states.forEach((state, clientId) => {
        if (clientId === provider.awareness.clientID) return;
        const chatState = state.chat;
        if (chatState?.typing && chatState.displayName) {
          typing.push(chatState.displayName);
        }
      });
      setTypingNames(typing);
    };
    provider.awareness.on('change', handleAwareness);

    return () => {
      yChat.unobserve(handleObserve);
      provider.awareness.off('change', handleAwareness);
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.disconnect();
      doc.destroy();
      yChatRef.current = null;
      awarenessRef.current = null;
    };
  }, [roomSlug, wsUrl]);

  const sendMessage = useCallback(
    (content: string, opts?: SendMessageOptions) => {
      const p = participantRef.current;
      const yChat = yChatRef.current;
      if (!p || !yChat) return;

      const trimmed = content.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!trimmed) return;

      const msg: StoredChatMsg = {
        id: `${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        content: trimmed,
        type: opts?.type ?? 'message',
        participantId: p.id,
        displayName: p.displayName,
        color: p.color,
        canvasX: opts?.canvasX ?? null,
        canvasY: opts?.canvasY ?? null,
        createdAt: new Date().toISOString(),
      };

      yChat.set(msg.id, msg);
      void persistToApi(msg);
    },
    [persistToApi],
  );

  const setTyping = useCallback((isTyping: boolean) => {
    const awareness = awarenessRef.current;
    const p = participantRef.current;
    if (!awareness || !p) return;
    awareness.setLocalStateField('chat', {
      typing: isTyping,
      displayName: p.displayName,
      color: p.color,
    });
  }, []);

  const commentPins = messages.filter(
    (m) => m.type === 'comment' && m.canvasX !== null && m.canvasY !== null,
  );

  return { messages, typingNames, sendMessage, setTyping, isConnected, commentPins };
}
