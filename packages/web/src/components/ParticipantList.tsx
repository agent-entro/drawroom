// Component showing active participants in a room with presence indicators
import type { ParticipantView } from '@drawroom/shared';
import { PRESENCE_AWAY_THRESHOLD_MS } from '@drawroom/shared';

interface ParticipantListProps {
  participants: ParticipantView[];
  currentParticipantId?: string;
}

function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < PRESENCE_AWAY_THRESHOLD_MS;
}

export default function ParticipantList({ participants, currentParticipantId }: ParticipantListProps) {
  if (participants.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5" aria-label="Participants">
      {participants.map((p) => {
        const online = isOnline(p.lastSeenAt);
        const isMe = p.id === currentParticipantId;

        return (
          <div key={p.id} className="relative group" title={`${p.displayName}${isMe ? ' (you)' : ''}`}>
            {/* Color avatar circle */}
            <div
              role="img"
              aria-label={`${p.displayName}${isMe ? ' (you)' : ''}, ${online ? 'online' : 'away'}`}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold select-none border-2 border-white shadow"
              style={{ backgroundColor: p.color }}
            >
              {p.displayName.charAt(0).toUpperCase()}
            </div>

            {/* Presence dot */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                online ? 'bg-green-500' : 'bg-gray-400'
              }`}
              aria-label={online ? 'online' : 'away'}
            />
          </div>
        );
      })}
    </div>
  );
}
