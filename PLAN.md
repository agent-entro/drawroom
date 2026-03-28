# DrawRoom — Technical Plan

### Real-Time Collaborative Canvas + Chat Application

---

**Based on:** DrawRoom Design Document v1.0 (2026-03-27)
**Plan Version:** 1.0 | **Date:** 2026-03-28 | **Status:** Draft

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Entity Relations](#2-entity-relations)
3. [User Flows](#3-user-flows)
4. [MVP Implementation Plan](#4-mvp-implementation-plan)

---

## 1. Tech Stack

### 1.1 Frontend

| Layer | Technology | Justification |
|---|---|---|
| **Framework** | **React 19 + Vite 6** | Mature ecosystem, fast HMR, broad hiring pool. Vite gives sub-second dev builds. |
| **Canvas Engine** | **tldraw SDK v3** | Purpose-built for collaborative drawing. Ships with shapes, selection, zoom, pan, and a CRDT-compatible data model. Eliminates months of custom canvas work. |
| **Real-Time State** | **Yjs** (CRDT library) | Industry-standard CRDT for conflict-free collaboration. Works offline-first; merges divergent edits deterministically. Pairs natively with tldraw via `y-tldraw`. |
| **Styling** | **Tailwind CSS v4** | Utility-first, zero-runtime, small bundle. Ideal for rapid UI iteration on chat panel and toolbar. |
| **Chat UI** | **Custom React components** | Chat is simple enough (message list + input) that a library adds unnecessary weight. Use `react-virtuoso` only if message lists exceed 1,000+ items. |
| **State Management** | **Zustand** | Lightweight store for local UI state (tool selection, panel visibility, user preferences). Yjs handles all shared/collaborative state. |
| **Routing** | **React Router v7** | Minimal routing: landing page (`/`), room (`/r/:roomId`). No need for a full framework like Next.js since there's no SEO-critical content beyond the landing page. |

### 1.2 Backend

| Layer | Technology | Justification |
|---|---|---|
| **Real-Time Server** | **PartyKit** | Managed Durable Objects infrastructure. Each room = one PartyKit "party" with isolated state, built-in WebSocket handling, and auto-hibernation. Dramatically reduces ops burden vs. self-hosting y-websocket. |
| **CRDT Sync** | **y-partykit** | Official Yjs provider for PartyKit. Handles document sync, awareness (cursors), and persistence out of the box. |
| **REST API** | **Hono** (on PartyKit or Cloudflare Workers) | Ultra-lightweight (14KB), TypeScript-native, runs on edge. Handles room creation, metadata, export triggers. |
| **Database** | **PostgreSQL** (via **Supabase**) | Room metadata, chat history, user accounts (Phase 2). Supabase provides hosted Postgres + auto-generated REST API + auth (later). |
| **File Storage** | **Cloudflare R2** | S3-compatible, zero egress fees. Stores canvas exports (PNG/SVG) and uploaded images (Phase 2). |
| **Background Jobs** | **Supabase Edge Functions** or **Cloudflare Workers (Cron Triggers)** | Room cleanup (delete rooms inactive >7 days), export generation. |

### 1.3 Infrastructure & DevOps

| Layer | Technology | Justification |
|---|---|---|
| **Frontend Hosting** | **Cloudflare Pages** | Global CDN, instant deploys from Git, free tier generous. |
| **Real-Time Hosting** | **PartyKit (managed)** | Handles WebSocket scaling, room isolation, and state persistence. No infra to manage. |
| **CI/CD** | **GitHub Actions** | Lint, type-check, test, deploy on push. Simple 2-stage pipeline (staging → production). |
| **Monitoring** | **Sentry** (errors) + **PostHog** (analytics) | Sentry for real-time error tracking with source maps. PostHog for product analytics (room creation, session length, feature usage). |
| **DNS / Domain** | **Cloudflare** | Unified with Pages and R2. Single dashboard for DNS, caching, security. |

### 1.4 Stack Decision: Why PartyKit Over Self-Hosted

| Concern | Self-Hosted (y-websocket + Node.js) | PartyKit |
|---|---|---|
| Room isolation | Manual process management | Automatic (Durable Objects) |
| Scaling | Requires sticky sessions, load balancer config | Auto-scales per room |
| Persistence | Custom Yjs storage adapter | Built-in with y-partykit |
| Cold start | Always-on servers (cost) | Hibernates idle rooms (free) |
| Ops burden | High (Docker, health checks, restarts) | Near-zero |
| **Verdict** | Good for >100K concurrent rooms | **Best for MVP through 50K rooms** |

---

## 2. Entity Relations

### 2.1 Core Entities

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ENTITY RELATIONSHIP DIAGRAM                 │
│                                                                      │
│  ┌─────────────┐       ┌─────────────────┐       ┌───────────────┐  │
│  │    Room      │──1:N──│   Participant    │──N:1──│  User (Ph.2)  │  │
│  └──────┬──────┘       └────────┬────────┘       └───────────────┘  │
│         │                       │                                    │
│         │ 1:N                   │                                    │
│         │                       │                                    │
│  ┌──────▼──────┐               │                                    │
│  │ ChatMessage  │───────────────┘ (sent_by)                         │
│  └──────┬──────┘                                                    │
│         │                                                            │
│         │ 0..1                                                       │
│         │                                                            │
│  ┌──────▼──────┐                                                    │
│  │ CanvasPin   │  (optional anchor for comment-type messages)       │
│  └─────────────┘                                                    │
│                                                                      │
│  ┌─────────────┐                                                    │
│  │CanvasState  │──1:1── Room  (Yjs document blob, managed by       │
│  └─────────────┘               PartyKit, not in SQL)                │
│                                                                      │
│  ┌─────────────┐                                                    │
│  │  Export      │──N:1── Room                                       │
│  └─────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Entity Definitions

#### `Room`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Unique room identifier |
| `slug` | `VARCHAR(20)` | UNIQUE, NOT NULL, indexed | Human-friendly URL slug (e.g., `abc-xyz-123`) |
| `title` | `VARCHAR(100)` | DEFAULT `'Untitled Room'` | Optional room name |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Creation timestamp |
| `last_active_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Updated on any activity; used for 7-day cleanup |
| `expires_at` | `TIMESTAMPTZ` | GENERATED (`last_active_at + interval '7 days'`) | Computed expiry for cleanup job |
| `is_persistent` | `BOOLEAN` | DEFAULT `false` | True if owned by a registered user (Phase 2) |
| `owner_id` | `UUID` | FK → `User.id`, NULLABLE | NULL for anonymous rooms (Phase 2) |
| `max_participants` | `INT` | DEFAULT `5` | Tier-based limit |
| `status` | `ENUM('active','archived','deleted')` | DEFAULT `'active'` | Room lifecycle state |

#### `Participant`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Unique participant identifier |
| `room_id` | `UUID` | FK → `Room.id`, NOT NULL | Room this participant belongs to |
| `display_name` | `VARCHAR(30)` | NOT NULL | User-chosen name for this session |
| `color` | `VARCHAR(7)` | NOT NULL | Hex color assigned for cursor/chat (e.g., `#4A90D9`) |
| `session_token` | `VARCHAR(64)` | UNIQUE, NOT NULL | Stored in localStorage; identifies returning participants |
| `joined_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | When they first joined |
| `last_seen_at` | `TIMESTAMPTZ` | NOT NULL | Updated on heartbeat; used for presence |
| `user_id` | `UUID` | FK → `User.id`, NULLABLE | Linked account if logged in (Phase 2) |

**Index:** `(room_id, session_token)` — fast participant lookup on rejoin.

#### `ChatMessage`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Message identifier |
| `room_id` | `UUID` | FK → `Room.id`, NOT NULL | Room this message belongs to |
| `participant_id` | `UUID` | FK → `Participant.id`, NOT NULL | Who sent it |
| `content` | `TEXT` | NOT NULL, max 2000 chars | Message text |
| `type` | `ENUM('message','comment','system')` | DEFAULT `'message'` | Regular chat, canvas-anchored comment, or system event |
| `canvas_x` | `FLOAT` | NULLABLE | X coordinate if type = `comment` |
| `canvas_y` | `FLOAT` | NULLABLE | Y coordinate if type = `comment` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | When sent |

**Index:** `(room_id, created_at)` — chronological message retrieval.

#### `Export` (Phase 1)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Export identifier |
| `room_id` | `UUID` | FK → `Room.id`, NOT NULL | Source room |
| `format` | `ENUM('png','svg')` | NOT NULL | Export format |
| `file_url` | `TEXT` | NOT NULL | R2 object URL |
| `file_size_bytes` | `INT` | NOT NULL | Size for quota tracking |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | When generated |
| `requested_by` | `UUID` | FK → `Participant.id` | Who triggered the export |

#### `User` (Phase 2 — deferred)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | User identifier |
| `email` | `VARCHAR(255)` | UNIQUE, NOT NULL | Login email |
| `display_name` | `VARCHAR(30)` | NOT NULL | Default display name |
| `avatar_url` | `TEXT` | NULLABLE | Profile image |
| `tier` | `ENUM('free','pro','team')` | DEFAULT `'free'` | Subscription tier |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | Registration date |

### 2.3 Canvas State (Non-Relational)

The canvas state is **not stored in PostgreSQL**. It lives as a Yjs CRDT document managed by PartyKit:

- **In-memory:** Active rooms hold the Yjs document in the PartyKit Durable Object.
- **Persisted:** On room hibernation or periodic snapshots, the Yjs document binary is written to PartyKit's built-in storage (backed by Cloudflare Durable Object storage).
- **Format:** Binary Yjs update log (compact, incrementally appendable).
- **Size estimate:** ~50KB–2MB per room for typical whiteboard sessions.

---

## 3. User Flows

### 3.1 Flow: Create a Room

```
Actor: Creator (anonymous user)

1. Creator visits drawroom.app
2. Landing page loads (<2s target)
3. Creator clicks "Create a Room"
4. Frontend sends POST /api/rooms → Backend
5. Backend generates:
   - UUID for room ID
   - Human-readable slug (adjective-noun-number pattern, e.g., "bright-owl-742")
   - Room record in PostgreSQL
   - PartyKit room instance (lazy — created on first WebSocket connection)
6. Backend returns { slug, roomUrl }
7. Frontend redirects to /r/bright-owl-742
8. "Enter your name" modal appears
9. Creator types display name, clicks "Join"
10. Frontend:
    - Generates session_token, stores in localStorage
    - Opens WebSocket to PartyKit room
    - Sends JOIN event with display_name + session_token
11. PartyKit:
    - Creates Participant record (via REST call to Supabase)
    - Assigns cursor color
    - Broadcasts PARTICIPANT_JOINED to all connections
    - Sends full Yjs document state to new client
12. Canvas and chat panel render. Creator sees empty canvas with their cursor.
```

### 3.2 Flow: Join an Existing Room

```
Actor: Guest (anonymous user with a shared link)

1. Guest receives link: drawroom.app/r/bright-owl-742
2. Guest clicks link → Frontend loads
3. Frontend extracts slug from URL
4. Frontend checks localStorage for existing session_token for this slug
   - If found: auto-rejoin with previous display_name and color
   - If not found: show "Enter your name" modal
5. Guest enters display name → same steps as Create flow (step 10+)
6. Guest's canvas populates with existing strokes (Yjs sync)
7. Guest sees chat history (last 100 messages loaded via REST)
8. Guest sees other participants' live cursors via Yjs awareness protocol
```

### 3.3 Flow: Real-Time Drawing Collaboration

```
Actors: Multiple participants in the same room

1. User A selects the Pen tool from the toolbar
2. User A draws a stroke on the canvas
3. tldraw captures the stroke as a shape object
4. Yjs CRDT applies the shape locally (instant feedback)
5. Yjs broadcasts the update via WebSocket to PartyKit
6. PartyKit relays the Yjs update to all other connected clients
7. User B and C see the stroke appear on their canvas (<100ms P95)
8. PartyKit debounces and persists the Yjs document to storage (every 5s)

Conflict scenario:
- User A and User B draw on overlapping areas simultaneously
- Yjs CRDT merges both strokes without conflict (both are preserved)
- No "last write wins" — all strokes coexist

Undo:
- User A presses Ctrl+Z
- tldraw reverts User A's last stroke only (per-user undo stack)
- Yjs propagates the deletion to all clients
- User B's strokes are unaffected
```

### 3.4 Flow: Canvas-Anchored Comment

```
Actor: Any participant

1. User clicks the "Comment" tool in the toolbar
2. User clicks a point on the canvas (x: 450, y: 320)
3. A comment input popover appears at that canvas position
4. User types comment text and presses Enter
5. Frontend sends chat message with type='comment', canvas_x=450, canvas_y=320
6. Message is broadcast via WebSocket and persisted to ChatMessage table
7. A pin icon appears at (450, 320) on all participants' canvases
8. Clicking the pin opens a thread view showing the comment and any replies
9. Pin is rendered as a tldraw shape (non-drawing layer) so it doesn't interfere with strokes
```

### 3.5 Flow: Export Canvas

```
Actor: Any participant

1. User clicks "Export" button in toolbar
2. Dropdown shows: [PNG] [SVG]
3. User selects PNG
4. Frontend renders the full canvas to an off-screen <canvas> element via tldraw's export API
5. Client-side export generates a Blob
6. Blob is uploaded to R2 via a presigned URL (obtained from POST /api/exports/presign)
7. Export record is written to the Export table
8. Browser triggers download of the file
9. Optional: toast notification shows "Canvas exported successfully"
```

### 3.6 Flow: Room Expiry & Cleanup

```
Actor: System (background job)

1. Cron job runs daily at 03:00 UTC (Cloudflare Workers Cron Trigger)
2. Queries: SELECT slug FROM rooms WHERE expires_at < now() AND is_persistent = false
3. For each expired room:
   a. Delete PartyKit room state (DELETE /parties/main/:roomId)
   b. Delete associated ChatMessages
   c. Delete associated Exports from R2
   d. Mark room status = 'deleted' (soft delete for 30-day recovery window)
4. Log cleanup summary to monitoring
```

---

## 4. MVP Implementation Plan

### 4.1 MVP Scope Definition

The MVP includes **Features 1–8** from the design document:

| # | Feature | Complexity | Priority |
|---|---|---|---|
| 1 | Shareable Room Link | Low | P0 |
| 2 | Real-Time Drawing Canvas | High | P0 |
| 3 | Integrated Chat Panel | Medium | P0 |
| 4 | Live Cursors | Low | P0 |
| 5 | Canvas-Anchored Comments | Medium | P1 |
| 6 | Undo / Redo | Low (tldraw built-in) | P0 |
| 7 | Export Canvas (PNG/SVG) | Medium | P1 |
| 8 | Persistent Rooms (7 days) | Medium | P0 |

### 4.2 Phased Implementation

#### Phase 0: Project Scaffolding (Days 1–2)

**Goal:** Repo setup, tooling, deploy pipeline.

- [ ] Initialize monorepo with `pnpm` workspaces
  - `packages/web` — React + Vite frontend
  - `packages/party` — PartyKit server
  - `packages/shared` — Shared types and constants
- [ ] Configure TypeScript, ESLint, Prettier
- [ ] Set up Tailwind CSS in frontend
- [ ] Create GitHub repo with branch protection on `main`
- [ ] GitHub Actions: lint + type-check on PR, deploy on merge to `main`
- [ ] Deploy empty frontend to Cloudflare Pages (verify pipeline)
- [ ] Deploy empty PartyKit server (verify WebSocket connectivity)
- [ ] Provision Supabase project (PostgreSQL + API)
- [ ] Run initial database migration (Room, Participant tables)

**Deliverable:** Empty app deploys end-to-end. WebSocket connects successfully.

---

#### Phase 1: Core Canvas + Real-Time Sync (Days 3–7)

**Goal:** Two users can draw on the same canvas in real time.

- [ ] Integrate tldraw React component into frontend
- [ ] Configure tldraw with custom toolbar (pen, shapes, text, eraser, color picker)
- [ ] Set up Yjs document in PartyKit server (`y-partykit` provider)
- [ ] Connect frontend Yjs provider to PartyKit WebSocket
- [ ] Verify: two browser tabs sync drawing strokes in real time
- [ ] Implement Yjs awareness protocol for live cursors
  - Display cursor position + name tag for each participant
  - Assign unique colors per participant
- [ ] Implement infinite canvas (pan, zoom — tldraw built-in)
- [ ] Undo/redo verification (tldraw built-in, per-user)
- [ ] PartyKit persistence: Yjs document auto-saved to Durable Object storage

**Deliverable:** Real-time collaborative drawing with live cursors works between multiple clients.

---

#### Phase 2: Room Management (Days 8–10)

**Goal:** Rooms can be created, joined via URL, and persist for 7 days.

- [ ] Room creation API: `POST /api/rooms` → generates slug, creates DB record
- [ ] Slug generation: use `human-id` library (e.g., `cheerful-panda-491`)
- [ ] Landing page UI:
  - "Create a Room" button
  - "Join with Code" input field
  - Brief hero section explaining the product
- [ ] Room join page: `/r/:slug`
  - Display name modal (if no existing session)
  - Session token generation and localStorage persistence
  - Reconnection logic (if session token exists, rejoin with same identity)
- [ ] Participant tracking:
  - Create Participant record on join
  - Update `last_seen_at` on heartbeat (every 30s)
  - Broadcast participant list changes to room
- [ ] Room `last_active_at` update on any drawing or chat activity
- [ ] Participant presence indicator (green dot = online, gray = away >2min)

**Deliverable:** Full room lifecycle works. Users can create, share, join, and rejoin rooms.

---

#### Phase 3: Integrated Chat (Days 11–14)

**Goal:** Chat panel with real-time messaging alongside the canvas.

- [ ] Chat panel UI (right sidebar, collapsible):
  - Message list with display name, color indicator, timestamp
  - Text input with Enter-to-send
  - Emoji picker (use `emoji-mart` library, lightweight)
  - Auto-scroll to latest message
  - "X is typing..." indicator (via Yjs awareness)
- [ ] Chat message transport via PartyKit (same WebSocket as canvas):
  - `CHAT_SEND` event from client
  - PartyKit broadcasts to all room participants
  - PartyKit persists message to Supabase (async, non-blocking)
- [ ] Chat history on join:
  - Load last 100 messages via REST: `GET /api/rooms/:slug/messages`
  - Paginate older messages on scroll-up
- [ ] Canvas-anchored comments:
  - "Comment" tool in toolbar
  - Click canvas → position captured → comment input appears
  - Comment saved as ChatMessage with `type='comment'` + coordinates
  - Pin rendered on canvas (tldraw bookmark shape)
  - Click pin → shows comment thread in chat panel (filtered view)
- [ ] System messages:
  - "[User] joined the room"
  - "[User] left the room"

**Deliverable:** Chat and canvas-anchored comments work in real time alongside drawing.

---

#### Phase 4: Export & Polish (Days 15–18)

**Goal:** Canvas export, UI polish, and production readiness.

- [ ] Export functionality:
  - PNG export via tldraw's `exportToBlob` API
  - SVG export via tldraw's `getSvgString` API
  - Client-side export (no server rendering needed)
  - Optional: upload to R2 for shareable link
  - Download triggers immediately via `<a download>` pattern
- [ ] Room cleanup job:
  - Cloudflare Workers Cron Trigger (daily)
  - Delete expired rooms, cascade to messages and exports
- [ ] UI polish:
  - Responsive layout (canvas full-width on mobile, chat as bottom sheet)
  - Dark mode support (Tailwind `dark:` classes)
  - Loading states and skeleton screens
  - Error boundaries and reconnection UI
  - Toast notifications (room created, export complete, connection lost)
- [ ] Performance optimization:
  - Lazy load emoji picker
  - Debounce Yjs persistence (5s interval)
  - Canvas rendering optimization (tldraw handles most of this)
- [ ] Set up Sentry for error tracking (source maps uploaded in CI)
- [ ] Set up PostHog for basic analytics events:
  - `room_created`, `room_joined`, `message_sent`, `canvas_exported`
- [ ] Security:
  - Rate limiting on room creation (10/hour per IP)
  - Message length validation (max 2,000 chars)
  - Slug collision prevention (retry with new slug)
  - CSP headers on frontend

**Deliverable:** Production-ready MVP with export, monitoring, and analytics.

---

#### Phase 5: Testing & Launch (Days 19–21)

- [ ] Integration tests:
  - Room creation and join flow (Playwright)
  - Two-user drawing sync (Playwright multi-page)
  - Chat send and receive
  - Export download
- [ ] Load testing:
  - Simulate 50 concurrent users in one room (k6 or Artillery)
  - Measure WebSocket message latency (target <100ms P95)
  - Measure room load time (target <2s)
- [ ] Landing page final copy and social meta tags (OG image, Twitter card)
- [ ] Launch checklist:
  - [ ] Custom domain configured (drawroom.app)
  - [ ] SSL certificate active
  - [ ] Sentry alerts configured
  - [ ] PostHog dashboards created
  - [ ] Backup strategy for Supabase (automatic daily backups)
  - [ ] Status page (Openstatus or similar)

**Deliverable:** DrawRoom MVP is live and publicly accessible.

---

### 4.3 Post-MVP Roadmap (Phases 2–3 from Design Doc)

| Phase | Features | Estimated Timeline |
|---|---|---|
| **Post-MVP A** (Month 2) | Sticky notes, image upload (R2), room templates | 2 weeks |
| **Post-MVP B** (Month 2–3) | User accounts (Supabase Auth), permanent room persistence, room roles (host/viewer) | 3 weeks |
| **Post-MVP C** (Month 3–4) | Voice chat (WebRTC via LiveKit or Daily.co), room password protection | 3 weeks |
| **Post-MVP D** (Month 4–6) | Team workspaces, Slack integration, educator analytics, billing (Stripe) | 6 weeks |

### 4.4 Key Technical Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **PartyKit scaling limits** | High | Low | PartyKit runs on Cloudflare; designed for millions of connections. Fallback: migrate to self-hosted y-websocket on Fly.io. |
| **Yjs document grows unbounded** | Medium | Medium | Implement periodic Yjs `gc` (garbage collection). Compact document on room hibernation. Set max document size (5MB) and warn users. |
| **Canvas performance with many objects** | Medium | Medium | tldraw handles culling (only renders visible shapes). Add shape count warning at 5,000 objects. Implement "flatten" option to merge older strokes. |
| **Chat message volume in large rooms** | Low | Low | Paginate aggressively. Only load last 100 on join. Archive messages older than 7 days with the room. |
| **WebSocket disconnection/reconnection** | Medium | High | Yjs handles reconnection natively (syncs missed updates). Add exponential backoff. Show "Reconnecting..." banner in UI. |

### 4.5 API Surface (MVP)

```
REST Endpoints (Hono on PartyKit or Cloudflare Workers)
────────────────────────────────────────────────────────

POST   /api/rooms                    → Create room, returns { slug, roomUrl }
GET    /api/rooms/:slug              → Room metadata (title, participant count, created_at)
PATCH  /api/rooms/:slug              → Update room title
GET    /api/rooms/:slug/messages     → Chat history (paginated, ?cursor=&limit=50)
POST   /api/rooms/:slug/messages     → Send message (fallback if WebSocket unavailable)
POST   /api/exports/presign          → Get presigned R2 upload URL for export
GET    /api/health                   → Health check

WebSocket Events (PartyKit)
────────────────────────────────────────────────────────

Client → Server:
  JOIN           { displayName, sessionToken }
  CHAT_SEND      { content, type, canvasX?, canvasY? }
  HEARTBEAT      {}
  LEAVE          {}

Server → Client:
  PARTICIPANT_JOINED    { participant }
  PARTICIPANT_LEFT      { participantId }
  PARTICIPANT_LIST      { participants[] }
  CHAT_MESSAGE          { message }
  CHAT_HISTORY          { messages[], hasMore }
  ERROR                 { code, message }

Yjs Sync (handled by y-partykit, separate from app events):
  Yjs document updates    (binary, automatic)
  Yjs awareness updates   (cursor positions, user state)
```

### 4.6 Project Structure

```
drawroom/
├── packages/
│   ├── web/                          # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Canvas/           # tldraw wrapper, custom tools
│   │   │   │   ├── Chat/             # ChatPanel, MessageList, CommentPin
│   │   │   │   ├── Room/             # RoomLayout, ParticipantList, Toolbar
│   │   │   │   ├── Landing/          # LandingPage, CreateRoomButton
│   │   │   │   └── ui/               # Shared UI primitives (Button, Modal, Toast)
│   │   │   ├── hooks/
│   │   │   │   ├── useYjsProvider.ts     # Yjs + PartyKit connection
│   │   │   │   ├── useRoom.ts            # Room state and participant management
│   │   │   │   ├── useChat.ts            # Chat messages and sending
│   │   │   │   └── useExport.ts          # Canvas export logic
│   │   │   ├── stores/
│   │   │   │   └── uiStore.ts            # Zustand store for UI state
│   │   │   ├── lib/
│   │   │   │   ├── api.ts                # REST API client
│   │   │   │   ├── colors.ts             # Participant color assignment
│   │   │   │   └── slugs.ts              # Slug validation
│   │   │   ├── pages/
│   │   │   │   ├── LandingPage.tsx
│   │   │   │   └── RoomPage.tsx
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── index.html
│   │   ├── tailwind.config.ts
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── party/                        # PartyKit server
│   │   ├── src/
│   │   │   ├── room.ts               # Main PartyKit server (WebSocket handler)
│   │   │   ├── chat.ts               # Chat message handling and persistence
│   │   │   ├── participants.ts       # Participant management
│   │   │   └── api.ts                # Hono REST routes (mounted on PartyKit)
│   │   ├── partykit.json
│   │   └── package.json
│   │
│   └── shared/                       # Shared types and constants
│       ├── src/
│       │   ├── types.ts              # Room, Participant, ChatMessage types
│       │   ├── events.ts             # WebSocket event type definitions
│       │   └── constants.ts          # Limits, defaults, enums
│       └── package.json
│
├── supabase/
│   └── migrations/                   # SQL migration files
│       ├── 001_create_rooms.sql
│       ├── 002_create_participants.sql
│       ├── 003_create_chat_messages.sql
│       └── 004_create_exports.sql
│
├── e2e/                              # Playwright tests
│   ├── room-creation.spec.ts
│   ├── drawing-sync.spec.ts
│   └── chat.spec.ts
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint, type-check, test
│       └── deploy.yml                # Deploy to Cloudflare + PartyKit
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

---

*This technical plan targets a 3-week MVP timeline for a solo developer or small team (1–2 engineers). The PartyKit + tldraw + Yjs combination is specifically chosen to minimize custom infrastructure and maximize iteration speed on the product experience.*
