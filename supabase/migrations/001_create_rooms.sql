-- Migration 001: Create the rooms table
-- Rooms are the top-level container for a collaborative session.

CREATE TYPE room_status AS ENUM ('active', 'archived', 'deleted');

CREATE TABLE rooms (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             VARCHAR(20)   NOT NULL UNIQUE,
  title            VARCHAR(100)  NOT NULL DEFAULT 'Untitled Room',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_active_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- expires_at is computed; kept as a plain column updated alongside last_active_at
  -- so it can be indexed and queried efficiently without a computed-column workaround.
  expires_at       TIMESTAMPTZ   NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  is_persistent    BOOLEAN       NOT NULL DEFAULT false,
  owner_id         UUID          NULL,      -- FK to users.id added in Phase 2 migration
  max_participants INT           NOT NULL DEFAULT 5,
  status           room_status   NOT NULL DEFAULT 'active'
);

CREATE INDEX idx_rooms_slug       ON rooms (slug);
CREATE INDEX idx_rooms_expires_at ON rooms (expires_at) WHERE status = 'active';
CREATE INDEX idx_rooms_status     ON rooms (status);

COMMENT ON TABLE  rooms                IS 'Top-level room entities. Indexed by slug for URL lookups.';
COMMENT ON COLUMN rooms.expires_at     IS 'Set to last_active_at + 7 days on every activity update. Used by daily cleanup job.';
COMMENT ON COLUMN rooms.is_persistent  IS 'True for rooms owned by registered users (Phase 2). Persistent rooms are never auto-deleted.';
