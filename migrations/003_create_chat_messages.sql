-- Migration 003: Create the chat_messages table
-- Stores all chat, comment-pin, and system messages for a room.

CREATE TYPE message_type AS ENUM ('message', 'comment', 'system');

CREATE TABLE chat_messages (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        UUID          NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  participant_id UUID          NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  content        TEXT          NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  type           message_type  NOT NULL DEFAULT 'message',
  canvas_x       DOUBLE PRECISION NULL,
  canvas_y       DOUBLE PRECISION NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- canvas_x and canvas_y must both be set (or both null) for comment pins
  CONSTRAINT comment_coords_consistent
    CHECK (
      (type = 'comment' AND canvas_x IS NOT NULL AND canvas_y IS NOT NULL)
      OR (type != 'comment')
    )
);

CREATE INDEX idx_chat_messages_room_created ON chat_messages (room_id, created_at DESC);
CREATE INDEX idx_chat_messages_type         ON chat_messages (room_id, type) WHERE type = 'comment';

COMMENT ON TABLE  chat_messages         IS 'All messages (chat, canvas comments, system events) for a room.';
COMMENT ON COLUMN chat_messages.type    IS 'message=regular chat, comment=canvas-anchored pin, system=join/leave events.';
COMMENT ON COLUMN chat_messages.canvas_x IS 'Canvas X coordinate; only non-null when type=comment.';
