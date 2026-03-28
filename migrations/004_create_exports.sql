-- Migration 004: Create the exports table
-- Tracks canvas export jobs (PNG/SVG) and their local file paths.

CREATE TYPE export_format AS ENUM ('png', 'svg');

CREATE TABLE exports (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID           NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  format           export_format  NOT NULL,
  file_path        TEXT           NOT NULL,  -- relative path within EXPORT_DIR volume
  file_size_bytes  INT            NOT NULL CHECK (file_size_bytes > 0),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  requested_by     UUID           NOT NULL REFERENCES participants (id) ON DELETE CASCADE
);

CREATE INDEX idx_exports_room_id    ON exports (room_id);
CREATE INDEX idx_exports_created_at ON exports (created_at DESC);

COMMENT ON TABLE  exports           IS 'Records of canvas exports stored on the local filesystem volume.';
COMMENT ON COLUMN exports.file_path IS 'Path relative to EXPORT_DIR bind-mount (e.g. <room_id>/<export_id>.png).';
