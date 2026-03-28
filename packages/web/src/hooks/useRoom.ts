// React hook for the full room join flow — session management + participant tracking
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Participant, ParticipantView } from '@drawroom/shared';
import { HEARTBEAT_INTERVAL_MS } from '@drawroom/shared';
import { getSession, setSession, clearSession } from '../lib/session.ts';
import { joinRoom, heartbeat, getParticipants, ApiError } from '../lib/api.ts';

export interface UseRoomResult {
  participant: Participant | null;
  participants: ParticipantView[];
  needsDisplayName: boolean;
  isLoading: boolean;
  error: string | null;
  joinWithName: (displayName: string) => Promise<void>;
  refreshParticipants: () => Promise<void>;
}

export function useRoom(roomSlug: string): UseRoomResult {
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshParticipants = useCallback(async () => {
    try {
      const data = await getParticipants(roomSlug);
      setParticipants(data.participants);
    } catch {
      // non-fatal: silently ignore participant refresh errors
    }
  }, [roomSlug]);

  const startPolling = useCallback(
    (p: Participant) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(async () => {
        // Always send HTTP heartbeat to keep last_seen_at fresh in the DB.
        // Participant-list refresh is also event-driven via Yjs awareness in
        // DrawCanvas (onAwarenessChange → refreshParticipants), so this poll
        // acts as a fallback catch-all rather than the primary update path.
        await Promise.allSettled([
          heartbeat(roomSlug, p.id, p.sessionToken),
          refreshParticipants(),
        ]);
      }, HEARTBEAT_INTERVAL_MS);
    },
    [roomSlug, refreshParticipants],
  );

  const handleJoined = useCallback(
    (p: Participant) => {
      setSession(roomSlug, {
        participantId: p.id,
        sessionToken: p.sessionToken,
        displayName: p.displayName,
        color: p.color,
      });
      setParticipant(p);
      setNeedsDisplayName(false);
      setError(null);
      startPolling(p);
      void refreshParticipants();
    },
    [roomSlug, startPolling, refreshParticipants],
  );

  const joinWithName = useCallback(
    async (displayName: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const p = await joinRoom(roomSlug, { displayName });
        handleJoined(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to join room');
      } finally {
        setIsLoading(false);
      }
    },
    [roomSlug, handleJoined],
  );

  // On mount: attempt rejoin with stored session token
  useEffect(() => {
    let cancelled = false;

    async function init() {
      setIsLoading(true);
      const session = getSession(roomSlug);

      if (session) {
        try {
          const p = await joinRoom(roomSlug, {
            displayName: session.displayName,
            sessionToken: session.sessionToken,
          });
          if (!cancelled) handleJoined(p);
        } catch (err) {
          if (!cancelled) {
            if (err instanceof ApiError && err.status === 404) {
              clearSession(roomSlug);
            }
            setNeedsDisplayName(true);
          }
        }
      } else {
        if (!cancelled) setNeedsDisplayName(true);
      }

      if (!cancelled) setIsLoading(false);
    }

    void init();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [roomSlug, handleJoined]);

  return { participant, participants, needsDisplayName, isLoading, error, joinWithName, refreshParticipants };
}
