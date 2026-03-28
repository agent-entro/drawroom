-- Migration 004: Create the exports table
-- Tracks canvas export jobs (PNG/SVG) and their R2 storage URLs.

CREATE TYPE export_format AS ENUM ('png', 'svg');

CREATE TABLE exports (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID           NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  format           export_format  NOT NULL,
  file_url         TEXT           NOT NULL,
  file_size_bytes  INT            NOT NULL CHECK (file_size_bytes > 0),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  requested_by     UUID           NOT NULL REFERENCES participants (id) ON DELETE CASCADE
);

CREATE INDEX idx_exports_room_id    ON exports (room_id);
CREATE INDEX idx_exports_created_at ON exports (created_at DESC);

COMMENT ON TABLE  exports          IS 'Records of canvas exports stored in Cloudflare R2.';
COMMENT ON COLUMN exports.file_url IS 'Public or pre-signed R2 URL for the exported file.';
