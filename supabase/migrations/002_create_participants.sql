-- Migration 002: Create the participants table
-- A participant is one session in one room. Anonymous users are identified by session_token.

CREATE TABLE participants (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        UUID         NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  display_name   VARCHAR(30)  NOT NULL,
  color          VARCHAR(7)   NOT NULL,  -- hex e.g. '#4A90D9'
  session_token  VARCHAR(64)  NOT NULL UNIQUE,
  joined_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  user_id        UUID         NULL      -- FK to users.id added in Phase 2
);

CREATE INDEX idx_participants_room_id             ON participants (room_id);
CREATE UNIQUE INDEX idx_participants_room_session ON participants (room_id, session_token);
CREATE INDEX idx_participants_last_seen           ON participants (last_seen_at);

COMMENT ON TABLE  participants               IS 'One row per participant session per room.';
COMMENT ON COLUMN participants.session_token IS 'Stored in browser localStorage. Used to rejoin a room with the same identity.';
COMMENT ON COLUMN participants.color         IS 'Hex color assigned by the server for cursors and chat name tags.';
