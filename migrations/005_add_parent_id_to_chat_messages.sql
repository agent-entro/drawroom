-- Migration 005: Add parent_id to chat_messages for threaded comment replies.
-- Replies reference their parent comment; they inherit positioning from the parent
-- and are displayed as a thread in the pin popup rather than as new root pins.

ALTER TABLE chat_messages
  ADD COLUMN parent_id UUID NULL REFERENCES chat_messages (id) ON DELETE CASCADE;

-- Relax the coords constraint: a comment must have coords OR be a reply (parent_id set).
-- Replies are anchored to their parent pin, so canvas_x/canvas_y are optional for them.
ALTER TABLE chat_messages DROP CONSTRAINT comment_coords_consistent;

ALTER TABLE chat_messages
  ADD CONSTRAINT comment_coords_consistent CHECK (
    -- Regular comments: must have coordinates
    (type = 'comment' AND canvas_x IS NOT NULL AND canvas_y IS NOT NULL AND parent_id IS NULL)
    -- Replies: must reference a parent; coords optional (inherited from parent visually)
    OR (type = 'comment' AND parent_id IS NOT NULL)
    -- Non-comment messages: no constraint
    OR (type != 'comment')
  );

CREATE INDEX idx_chat_messages_parent ON chat_messages (parent_id) WHERE parent_id IS NOT NULL;

COMMENT ON COLUMN chat_messages.parent_id IS
  'For comment replies: references the root comment pin. NULL for root comments and regular messages.';
