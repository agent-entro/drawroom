// Application-wide limits, defaults, and enums

/** Maximum number of characters in a chat message */
export const MAX_MESSAGE_LENGTH = 2_000;

/** Maximum display name length */
export const MAX_DISPLAY_NAME_LENGTH = 30;

/** Room slug length constraints */
export const SLUG_MIN_LENGTH = 5;
export const SLUG_MAX_LENGTH = 20;

/** Default max participants for anonymous (free) rooms */
export const DEFAULT_MAX_PARTICIPANTS = 5;

/** Days before an inactive anonymous room is deleted */
export const ROOM_TTL_DAYS = 7;

/** Heartbeat interval in milliseconds */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** A participant is considered "away" after this many milliseconds without a heartbeat */
export const PRESENCE_AWAY_THRESHOLD_MS = 120_000;

/** Yjs persistence debounce interval */
export const YJS_PERSIST_DEBOUNCE_MS = 5_000;

/** Maximum Yjs document size in bytes (5 MB) */
export const MAX_YJS_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum number of shapes on the canvas before warning */
export const MAX_CANVAS_SHAPES = 5_000;

/** Rate limit: max room creations per IP per hour */
export const ROOM_CREATE_RATE_LIMIT = 10;

/** How many chat messages to load on join */
export const CHAT_HISTORY_PAGE_SIZE = 100;

/** Participant cursor colors — one assigned per participant in order */
export const PARTICIPANT_COLORS: readonly string[] = [
  '#4A90D9', // blue
  '#E67E22', // orange
  '#2ECC71', // green
  '#E74C3C', // red
  '#9B59B6', // purple
  '#1ABC9C', // teal
  '#F39C12', // yellow
  '#E91E63', // pink
  '#00BCD4', // cyan
  '#8BC34A', // light green
] as const;
