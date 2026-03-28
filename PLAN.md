# DrawRoom — Technical Plan (Local Development)

### Real-Time Collaborative Canvas + Chat Application

---

**Based on:** DrawRoom Design Document v1.0 (2026-03-27)
**Plan Version:** 1.1 | **Date:** 2026-03-28 | **Status:** Draft — Local Dev Focus

> **Scope of this revision:** This plan targets a **local development environment** rather than managed cloud infrastructure. All services run on the developer's machine via Docker Compose. External access (for mobile testing, stakeholder demos, or webhook callbacks) is provided via tunnels or an Addy reverse proxy.

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Local Dev Environment](#2-local-dev-environment)
3. [External Exposure](#3-external-exposure)
4. [Entity Relations](#4-entity-relations)
5. [User Flows](#5-user-flows)
6. [MVP Implementation Plan](#6-mvp-implementation-plan)

---

## 1. Tech Stack

### 1.1 Frontend

| Layer | Technology | Justification |
|---|---|---|
| **Framework** | **React 19 + Vite 6** | Fast HMR, sub-second dev builds — ideal for local iteration. |
| **Canvas Engine** | **tldraw SDK v3** | Purpose-built collaborative drawing. Ships selection, zoom, pan, and a CRDT-compatible data model. |
| **Real-Time State** | **Yjs** (CRDT library) | Industry-standard CRDT. Works offline-first; merges divergent edits deterministically. |
| **Styling** | **Tailwind CSS v4** | Utility-first, zero-runtime. |
| **Chat UI** | **Custom React components** | Simple enough to own. Add `react-virtuoso` only past 1,000+ messages. |
| **State Management** | **Zustand** | Lightweight store for local UI state. Yjs handles all shared state. |
| **Routing** | **React Router v7** | Two routes: landing (`/`) and room (`/r/:roomId`). |

### 1.2 Backend

| Layer | Technology | Justification |
|---|---|---|
| **Real-Time Server** | **y-websocket** (self-hosted Node.js) | Runs locally in Docker. Official Yjs WebSocket provider — handles document sync, awareness (cursors), and optional LevelDB persistence. |
| **REST API** | **Hono** (Node.js, standalone) | Lightweight TypeScript server for room creation, metadata, export triggers. Runs as a separate local service. |
| **Database** | **PostgreSQL 16** (Docker) | Room metadata, chat history, participant records. No external dependency. |
| **Cache / Pub-Sub** | **Redis 7** (Docker) | Session data, participant presence, chat fan-out between the Hono API and y-websocket. |
| **File Storage** | **Local filesystem** (bind-mounted volume) | Canvas exports (PNG/SVG) and uploaded images stored at `./data/exports`. No R2/S3 dependency during dev. |
| **Background Jobs** | **node-cron** inside the API process | Room cleanup (delete rooms inactive >7 days). Runs on a daily schedule inside the Hono server process. |

### 1.3 Infrastructure (Local Dev)

| Layer | Technology | Justification |
|---|---|---|
| **Orchestration** | **Docker Compose** | Single `docker compose up` starts all services. |
| **Frontend Dev Server** | **Vite** (`localhost:5173`) | HMR, instant feedback during UI development. |
| **API Server** | **Hono on Node.js** (`localhost:3000`) | Room management REST API. |
| **WebSocket Server** | **y-websocket** (`localhost:1234`) | CRDT sync and chat relay. |
| **Database** | **PostgreSQL** (`localhost:5432`) | Accessed directly by API and via `psql` for migrations. |
| **Cache** | **Redis** (`localhost:6379`) | Accessed by API and WebSocket server. |
| **External Access** | **ngrok / Cloudflare Tunnel / Addy** | Punch through to local services — see [Section 3](#3-external-exposure). |

### 1.4 Stack Decision: Why y-websocket Over PartyKit Locally

The original cloud plan used PartyKit (managed Durable Objects). For local dev this is impractical: PartyKit has no local emulator and requires a live cloud deployment.

| Concern | PartyKit (cloud) | y-websocket (local) |
|---|---|---|
| Local dev support | ❌ No emulator | ✅ Runs in Docker |
| Room isolation | Automatic (Durable Objects) | Process-level partitioning via room IDs |
| Persistence | Built-in | LevelDB adapter (drop-in) |
| Ops burden | Near-zero (cloud) | Low (Docker Compose) |
| Cost during dev | Free tier, but requires internet | Zero |
| **Verdict** | Best for production | **Best for local dev** |

Production migration path: swap `y-websocket` for PartyKit + `y-partykit` provider. The Yjs document model is identical — no frontend changes required.

---

## 2. Local Dev Environment

### 2.1 Service Map

```
localhost:5173  ←  Vite dev server (React frontend)
localhost:3000  ←  Hono REST API
localhost:1234  ←  y-websocket (CRDT sync + chat)
localhost:5432  ←  PostgreSQL
localhost:6379  ←  Redis
```

### 2.2 docker-compose.yml (Canonical)

```yaml
# docker-compose.yml — DrawRoom local dev
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: drawroom
      POSTGRES_USER: drawroom
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d  # auto-run on first boot

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  yws:
    build: ./packages/yws          # thin Dockerfile wrapping y-websocket
    environment:
      PORT: 1234
      REDIS_URL: redis://redis:6379
      PERSISTENCE: leveldb
      PERSISTENCE_DIR: /data/yjs
    ports:
      - "1234:1234"
    volumes:
      - yjs_data:/data/yjs
    depends_on:
      - redis

  api:
    build: ./packages/api
    environment:
      PORT: 3000
      DATABASE_URL: postgresql://drawroom:devpassword@postgres:5432/drawroom
      REDIS_URL: redis://redis:6379
      EXPORT_DIR: /data/exports
    ports:
      - "3000:3000"
    volumes:
      - export_data:/data/exports
    depends_on:
      - postgres
      - redis

volumes:
  postgres_data:
  yjs_data:
  export_data:
```

The frontend (`packages/web`) runs outside Docker via `pnpm dev` for the fastest HMR experience.

### 2.3 Environment Variables (`.env.local`)

```bash
# packages/web/.env.local
VITE_API_URL=http://localhost:3000
VITE_YWS_URL=ws://localhost:1234

# packages/api/.env
DATABASE_URL=postgresql://drawroom:devpassword@localhost:5432/drawroom
REDIS_URL=redis://localhost:6379
EXPORT_DIR=./data/exports
PORT=3000
```

When using external exposure (tunnel or Addy), update `VITE_API_URL` and `VITE_YWS_URL` to the public URLs so that remote clients can connect.

### 2.4 Running Locally

```bash
# 1. Start infrastructure (Postgres, Redis, y-websocket, API)
docker compose up -d

# 2. Run DB migrations
pnpm --filter api db:migrate

# 3. Start frontend dev server
pnpm --filter web dev

# App is now accessible at http://localhost:5173
```

---

## 3. External Exposure

Local services are not accessible outside the developer's machine by default. Two options are supported depending on use case.

### 3.1 Option A — Tunneling (ngrok / Cloudflare Tunnel)

Best for: quick demos, webhook testing, one-off mobile device testing.

**ngrok:**
```bash
# Install: https://ngrok.com/download
# ngrok.yml
version: "2"
tunnels:
  web:
    proto: http
    addr: 5173
  api:
    proto: http
    addr: 3000
  yws:
    proto: http
    addr: 1234

ngrok start --all --config ngrok.yml
```

ngrok assigns public URLs like `https://abc123.ngrok.io`. Update `.env.local` with those URLs, then restart Vite.

**Cloudflare Tunnel (persistent, free):**
```bash
# Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
cloudflared tunnel create drawroom-dev
cloudflared tunnel route dns drawroom-dev dev.yourdomain.com

# config.yml
tunnel: <TUNNEL_ID>
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: drawroom.yourdomain.com
    service: http://localhost:5173
  - hostname: api.drawroom.yourdomain.com
    service: http://localhost:3000
  - hostname: yws.drawroom.yourdomain.com
    service: http://localhost:1234
  - service: http_status:404

cloudflared tunnel run drawroom-dev
```

Cloudflare Tunnel gives stable URLs tied to your domain — good for ongoing dev with external collaborators.

**Tradeoffs:**

| | ngrok | Cloudflare Tunnel |
|---|---|---|
| Setup time | 2 min | 15 min |
| URL stability | Ephemeral (free tier) | Stable (your domain) |
| Cost | Free (limited) / Paid | Free |
| 3rd-party dependency | Yes (ngrok.com) | Yes (Cloudflare) |
| WebSocket support | ✅ | ✅ |

---

### 3.2 Option B — Addy Reverse Proxy (Preferred for Ongoing Dev)

Best for: stable local domains, multiple services, SSL, no third-party dependency, team-wide consistency.

**Addy** acts as a local reverse proxy with automatic TLS certificate generation via mkcert. All services get stable `*.local.dev` domains pointing to `127.0.0.1`.

#### Setup

```bash
# 1. Install Addy (https://github.com/addy-dev/addy or your internal distribution)
brew install addy       # macOS
# or: curl -fsSL https://addy.dev/install.sh | sh

# 2. Trust the local CA (one-time)
addy trust

# 3. Define proxy rules in addy.yml (project root)
```

**addy.yml:**
```yaml
version: "1"
proxies:
  - domain: drawroom.local.dev
    target: http://localhost:5173
    tls: true

  - domain: api.drawroom.local.dev
    target: http://localhost:3000
    tls: true

  - domain: yws.drawroom.local.dev
    target: http://localhost:1234
    tls: true
    websocket: true       # ensures Upgrade headers are forwarded
```

```bash
# 4. Start Addy
addy up
```

Addy handles `/etc/hosts` entries and certificate management automatically. Services are then reachable at:

```
https://drawroom.local.dev         ← frontend
https://api.drawroom.local.dev     ← REST API
wss://yws.drawroom.local.dev       ← WebSocket (y-websocket)
```

Update `.env.local`:
```bash
VITE_API_URL=https://api.drawroom.local.dev
VITE_YWS_URL=wss://yws.drawroom.local.dev
```

#### Exposing Addy Domains to External Devices

For access from mobile devices on the same network, point the device's DNS to the developer machine's LAN IP. For external internet access, combine Addy with a Cloudflare Tunnel forwarding to Addy's HTTPS port.

**Tradeoffs vs. tunneling:**

| | Tunnel (ngrok/CF) | Addy |
|---|---|---|
| External internet access | ✅ | ❌ (LAN only unless combined with tunnel) |
| Stable URLs | ✅ CF / ❌ ngrok | ✅ Always |
| HTTPS/WSS | ✅ | ✅ (mkcert CA) |
| Zero third-party dependency | ❌ | ✅ |
| Multi-service management | Manual | Single config file |
| Setup complexity | Low–Medium | Low (after one-time CA trust) |

**Recommendation:** Use **Addy** as the default daily-driver for local dev. Add a **Cloudflare Tunnel** when you specifically need external internet access (stakeholder review, mobile testing on cellular).

---

## 4. Entity Relations

*(Schema is backend-agnostic and identical to the production plan.)*

### 4.1 Core Entities

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
│  │CanvasState  │──1:1── Room  (Yjs document binary, managed by     │
│  └─────────────┘               y-websocket + LevelDB, not in SQL)   │
│                                                                      │
│  ┌─────────────┐                                                    │
│  │  Export      │──N:1── Room  (file on local volume)              │
│  └─────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Entity Definitions

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
| `owner_id` | `UUID` | FK → `User.id`, NULLABLE | NULL for anonymous rooms |
| `max_participants` | `INT` | DEFAULT `5` | Tier-based limit |
| `status` | `ENUM('active','archived','deleted')` | DEFAULT `'active'` | Room lifecycle state |

#### `Participant`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Unique participant identifier |
| `room_id` | `UUID` | FK → `Room.id`, NOT NULL | Room this participant belongs to |
| `display_name` | `VARCHAR(30)` | NOT NULL | User-chosen name for this session |
| `color` | `VARCHAR(7)` | NOT NULL | Hex color for cursor/chat |
| `session_token` | `VARCHAR(64)` | UNIQUE, NOT NULL | Stored in localStorage; identifies returning participants |
| `joined_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | When they first joined |
| `last_seen_at` | `TIMESTAMPTZ` | NOT NULL | Updated on heartbeat |
| `user_id` | `UUID` | FK → `User.id`, NULLABLE | Linked account if logged in (Phase 2) |

**Index:** `(room_id, session_token)` — fast participant lookup on rejoin.

#### `ChatMessage`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Message identifier |
| `room_id` | `UUID` | FK → `Room.id`, NOT NULL | Room this message belongs to |
| `participant_id` | `UUID` | FK → `Participant.id`, NOT NULL | Sender |
| `content` | `TEXT` | NOT NULL, max 2000 chars | Message text |
| `type` | `ENUM('message','comment','system')` | DEFAULT `'message'` | Message category |
| `canvas_x` | `FLOAT` | NULLABLE | X coordinate if type = `comment` |
| `canvas_y` | `FLOAT` | NULLABLE | Y coordinate if type = `comment` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | When sent |

**Index:** `(room_id, created_at)` — chronological retrieval.

#### `Export`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Export identifier |
| `room_id` | `UUID` | FK → `Room.id`, NOT NULL | Source room |
| `format` | `ENUM('png','svg')` | NOT NULL | Export format |
| `file_path` | `TEXT` | NOT NULL | Path relative to `EXPORT_DIR` volume mount |
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

### 4.3 Canvas State (Non-Relational)

Canvas state is **not stored in PostgreSQL**. It lives as a Yjs CRDT document managed by y-websocket:

- **In-memory:** Active rooms hold the Yjs document in the y-websocket process.
- **Persisted:** y-websocket writes Yjs document binary to LevelDB (Docker volume: `yjs_data`). Survives container restarts.
- **Format:** Binary Yjs update log (~50KB–2MB per typical session).

---

## 5. User Flows

*(Flows are structurally identical to the cloud plan. URL scheme is the same; only the backing infrastructure differs.)*

### 5.1 Create a Room

```
1. User visits http://localhost:5173 (or https://drawroom.local.dev via Addy)
2. Clicks "Create a Room"
3. Frontend sends POST /api/rooms → Hono API (localhost:3000)
4. API generates slug, creates Room record in local PostgreSQL
5. Returns { slug, roomUrl }
6. Frontend redirects to /r/bright-owl-742
7. "Enter your name" modal
8. User enters name → session_token generated → stored in localStorage
9. Frontend opens WebSocket to ws://localhost:1234/r/bright-owl-742
10. y-websocket creates/loads Yjs document for this room ID
11. Participant record created via REST call to Hono API
12. Canvas renders; user sees empty canvas with their cursor
```

### 5.2 Join an Existing Room

```
1. Guest receives link (local URL or tunnel/Addy public URL)
2. Frontend extracts slug
3. Checks localStorage for existing session_token
   - Found → auto-rejoin with previous name and color
   - Not found → show display name modal
4. Same WebSocket join flow as Create
5. Canvas populates with existing Yjs state (full sync from y-websocket)
6. Chat history loaded via GET /api/rooms/:slug/messages (last 100)
7. Live cursors visible via Yjs awareness protocol
```

### 5.3 Real-Time Drawing Collaboration

```
1. User A draws → tldraw captures shape → Yjs CRDT applies locally (instant)
2. Yjs sends binary update via WebSocket to y-websocket
3. y-websocket broadcasts update to all other connected clients
4. User B and C see stroke appear (<100ms on localhost; ~150ms over tunnel)
5. y-websocket persists Yjs doc to LevelDB every 5s

Conflict: A and B draw simultaneously → Yjs CRDT merges both (no last-write-wins)
Undo: Ctrl+Z → tldraw reverts User A's last stroke only → Yjs propagates deletion
```

### 5.4 Canvas-Anchored Comment

```
1. User selects "Comment" tool → clicks canvas at (450, 320)
2. Comment popover appears at that canvas position
3. User types and submits → Frontend sends:
   { type: 'comment', canvas_x: 450, canvas_y: 320, content: '...' }
4. y-websocket broadcasts to room; Hono API persists to ChatMessage table (async)
5. Pin rendered as a tldraw shape at (450, 320) on all clients
6. Clicking pin opens thread view in chat panel
```

### 5.5 Export Canvas

```
1. User clicks "Export" → selects PNG or SVG
2. tldraw exportToBlob / getSvgString generates Blob client-side
3. Blob POSTed to POST /api/exports
4. Hono API writes file to local EXPORT_DIR volume, creates Export record
5. API returns { id, downloadUrl }
6. Browser triggers file download via GET /api/exports/:id/download
```

### 5.6 Room Expiry & Cleanup

```
1. node-cron job runs daily at 03:00 local time (inside Hono process)
2. Queries: SELECT slug FROM rooms WHERE expires_at < now() AND is_persistent = false
3. For each expired room:
   a. Remove Yjs document from LevelDB
   b. Delete ChatMessages from PostgreSQL
   c. Delete export files from local EXPORT_DIR volume
   d. Mark room status = 'deleted' (soft delete, 30-day recovery window)
4. Log summary to stdout (visible via `docker compose logs api`)
```

---

## 6. MVP Implementation Plan

### 6.1 MVP Scope

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

### 6.2 Phased Implementation

#### [DONE] Phase 0: Project Scaffolding (Days 1–2)

**Goal:** Repo, tooling, all local services running with `docker compose up`.

- [x] Initialize monorepo with `pnpm` workspaces
  - `packages/web` — React + Vite frontend ✅
  - `packages/api` — Hono REST server (Node.js) ✅
  - `packages/yws` — y-websocket wrapper with LevelDB + Redis ✅
  - `packages/shared` — Shared types and constants ✅
- [x] Configure TypeScript, ESLint, Prettier across all packages
- [x] Set up Tailwind CSS v4 in `packages/web`
- [x] Remove legacy scaffolding (`packages/party`, `supabase/`) from old plan
- [x] Create `packages/api` — Hono REST server (Node.js)
- [x] Create `packages/yws` — y-websocket wrapper with LevelDB + Redis
- [x] Write `docker-compose.yml` (PostgreSQL, Redis, y-websocket, API)
- [x] Run `docker compose up -d` — verify all containers healthy
- [x] Write and run initial SQL migrations (Room, Participant tables)
- [x] Verify WebSocket connectivity: browser → `ws://localhost:1234` → y-websocket ping
- [x] GitHub Actions: lint + type-check on PR

**Deliverable:** `docker compose up && pnpm --filter web dev` starts the full stack. WebSocket connects. Migrations applied.

---

#### Phase 1: Core Canvas + Real-Time Sync (Days 3–7)

**Goal:** Two browser tabs draw on the same canvas in real time via local y-websocket.

- [x] Integrate tldraw React component into `packages/web`
- [x] Configure tldraw with custom toolbar (pen, shapes, text, eraser, color picker)
- [x] Set up Yjs document in `packages/yws` (y-websocket with LevelDB persistence)
- [x] Connect frontend Yjs provider (`y-websocket` client) to local WS server
- [x] Verify: two browser tabs sync drawing strokes in real time
- [x] Implement Yjs awareness for live cursors (position + name tag + color)
- [x] Infinite canvas: pan/zoom (tldraw built-in)
- [x] Undo/redo (tldraw built-in, per-user)
- [x] Confirm Yjs LevelDB persistence: restart y-websocket container, verify strokes reload

**Deliverable:** Real-time collaborative drawing with live cursors between multiple local clients.

---

#### Phase 2: Room Management (Days 8–10)

**Goal:** Rooms can be created, joined via URL, and persist in local PostgreSQL.

- [ ] Room creation: `POST /api/rooms` in Hono → generates slug → inserts Room row
- [ ] Slug generation: `human-id` library (e.g., `cheerful-panda-491`)
- [ ] Landing page: "Create a Room" + "Join with Code" input
- [ ] Room page `/r/:slug`: display name modal, session token, localStorage persistence
- [ ] Reconnection: if session token in localStorage, auto-rejoin with same identity
- [ ] Participant tracking: create on join, heartbeat every 30s, broadcast list changes
- [ ] Update `last_active_at` on drawing and chat activity
- [ ] Presence indicator (green = online, gray = away >2min)

**Deliverable:** Full room lifecycle works locally. Users can create, share (local URL or tunnel URL), join, and rejoin rooms.

---

#### Phase 3: Integrated Chat (Days 11–14)

**Goal:** Chat panel with real-time messaging alongside the canvas.

- [ ] Chat panel UI (right sidebar, collapsible):
  - Message list with name, color indicator, timestamp
  - Enter-to-send text input
  - Emoji picker (`emoji-mart`, lazy-loaded)
  - Auto-scroll; "X is typing..." via Yjs awareness
- [ ] Chat transport via y-websocket (same WS connection as canvas):
  - `CHAT_SEND` event from client
  - y-websocket broadcasts to room; Hono API persists to PostgreSQL (async, non-blocking)
- [ ] Chat history on join: `GET /api/rooms/:slug/messages` (last 100, paginated)
- [ ] Canvas-anchored comments: Comment tool → click → capture position → pin rendered on canvas → thread in chat panel
- [ ] System messages: join/leave events

**Deliverable:** Chat and canvas-anchored comments work in real time locally.

---

#### Phase 4: Export & Polish (Days 15–18)

**Goal:** Canvas export to local filesystem, UI polish, stability.

- [ ] PNG export via tldraw `exportToBlob` → `POST /api/exports` → write to volume
- [ ] SVG export via tldraw `getSvgString` → same pipeline
- [ ] `GET /api/exports/:id/download` — streams file from local volume to browser
- [ ] Room cleanup cron: `node-cron` inside Hono, runs daily at 03:00
- [ ] UI polish: responsive layout, dark mode (`dark:` classes), loading states, error boundaries, toast notifications
- [ ] Performance: lazy-load emoji picker, 5s Yjs persistence debounce
- [ ] Security: rate limiting on room creation (10/hour per IP), message length validation (max 2,000 chars), input sanitization, CSP headers

**Deliverable:** Export works end-to-end. App is stable for daily local use.

---

#### Phase 5: External Exposure & Integration Testing (Days 19–21)

**Goal:** Validate app works from external clients; integration and load tests pass.

- [ ] Stand up Addy (`addy up`) — verify HTTPS on all local domains
- [ ] Test from a second device on the same LAN via Addy URLs
- [ ] Stand up Cloudflare Tunnel for internet-accessible URLs; verify WS upgrade over tunnel
- [ ] Update `.env.local` to public URLs; confirm remote clients can draw and chat
- [ ] Integration tests (Playwright):
  - Room creation and join flow
  - Two-tab drawing sync
  - Chat send/receive
  - Export download
- [ ] Load test (k6): 20 concurrent users in one local room
  - Target: WebSocket message latency <100ms P95 on localhost; <200ms over tunnel
  - Target: Room load time <2s

**Deliverable:** DrawRoom is fully functional locally and accessible externally.

---

### 6.3 Post-MVP Roadmap

| Phase | Features | Notes |
|---|---|---|
| **Cloud Migration** | Swap y-websocket → PartyKit, local PG → Supabase, local FS → R2 | No frontend changes needed; env vars only |
| **Post-MVP A** | Sticky notes, image upload, room templates | |
| **Post-MVP B** | User accounts (Supabase Auth), permanent persistence, room roles | |
| **Post-MVP C** | Voice chat (WebRTC via LiveKit), room password protection | |
| **Post-MVP D** | Team workspaces, Slack integration, educator analytics, billing (Stripe) | |

### 6.4 Key Risks & Mitigations (Local Dev Context)

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **y-websocket single-process bottleneck** | Low for local dev | Low | Acceptable during dev. Production uses PartyKit. |
| **Yjs document grows unbounded** | Medium | Medium | Periodic `Y.gc` garbage collection; warn at 5MB. |
| **Canvas perf with many objects** | Medium | Medium | tldraw handles culling; warn at 5,000 objects. |
| **Tunnel latency skews perf expectations** | Low | High | Always benchmark primary flows on `localhost`; use tunnel only for external access scenarios. |
| **Docker volume data loss** | High | Low | Named volumes survive restarts. Run `docker compose down` (not `down -v`) to preserve data. |
| **WebSocket disconnection** | Medium | High | Yjs reconnects natively (syncs missed updates). Add exponential backoff and "Reconnecting..." banner. |

### 6.5 API Surface (MVP)

```
REST Endpoints (Hono — localhost:3000)
──────────────────────────────────────────────────────

POST   /api/rooms                    → Create room, returns { slug, roomUrl }
GET    /api/rooms/:slug              → Room metadata (title, participant count, created_at)
PATCH  /api/rooms/:slug              → Update room title
GET    /api/rooms/:slug/messages     → Chat history (paginated, ?cursor=&limit=50)
POST   /api/rooms/:slug/messages     → Send message (WebSocket fallback)
POST   /api/exports                  → Save export file, returns { id, downloadUrl }
GET    /api/exports/:id/download     → Stream export file from local volume
GET    /api/health                   → Health check

WebSocket Events (y-websocket — localhost:1234)
──────────────────────────────────────────────────────

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

Yjs Sync (y-websocket protocol, separate from app events):
  Yjs document updates    (binary, automatic)
  Yjs awareness updates   (cursor positions, typing state)
```

### 6.6 Project Structure

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
│   │   │   │   └── ui/               # Button, Modal, Toast primitives
│   │   │   ├── hooks/
│   │   │   │   ├── useYjsProvider.ts     # Yjs + y-websocket connection
│   │   │   │   ├── useRoom.ts            # Room state and participant management
│   │   │   │   ├── useChat.ts            # Chat messages and sending
│   │   │   │   └── useExport.ts          # Canvas export logic
│   │   │   ├── stores/
│   │   │   │   └── uiStore.ts            # Zustand: tool selection, panel state
│   │   │   ├── lib/
│   │   │   │   ├── api.ts                # REST API client
│   │   │   │   ├── colors.ts             # Participant color assignment
│   │   │   │   └── slugs.ts              # Slug validation
│   │   │   ├── pages/
│   │   │   │   ├── LandingPage.tsx
│   │   │   │   └── RoomPage.tsx
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── tailwind.config.ts
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── api/                          # Hono REST server
│   │   ├── src/
│   │   │   ├── index.ts              # Server entry point
│   │   │   ├── routes/
│   │   │   │   ├── rooms.ts          # Room CRUD
│   │   │   │   ├── messages.ts       # Chat history
│   │   │   │   └── exports.ts        # Export upload/download
│   │   │   ├── db/
│   │   │   │   ├── client.ts         # PostgreSQL connection
│   │   │   │   └── queries.ts        # SQL query functions
│   │   │   ├── jobs/
│   │   │   │   └── cleanup.ts        # node-cron room expiry job
│   │   │   └── lib/
│   │   │       ├── slugs.ts          # Slug generation (human-id)
│   │   │       └── redis.ts          # Redis client
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── yws/                          # y-websocket server wrapper
│   │   ├── src/
│   │   │   └── index.ts              # y-websocket with LevelDB + Redis pub-sub
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── shared/                       # Shared types and constants
│       ├── src/
│       │   ├── types.ts              # Room, Participant, ChatMessage types
│       │   ├── events.ts             # WebSocket event type definitions
│       │   └── constants.ts          # Limits, defaults, enums
│       └── package.json
│
├── migrations/                       # SQL migration files (psql-compatible, mounted into PG)
│   ├── 001_create_rooms.sql
│   ├── 002_create_participants.sql
│   ├── 003_create_chat_messages.sql
│   └── 004_create_exports.sql
│
├── e2e/                              # Playwright tests
│   ├── room-creation.spec.ts
│   ├── drawing-sync.spec.ts
│   └── chat.spec.ts
│
├── .github/
│   └── workflows/
│       └── ci.yml                    # Lint, type-check, test on PR
│
├── docker-compose.yml                # Local service orchestration
├── addy.yml                          # Addy reverse proxy config
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

---

*This plan targets a 3-week MVP timeline for a solo developer. The local dev stack (y-websocket + PostgreSQL + Redis in Docker) mirrors the production architecture structurally, so the eventual cloud migration is an environment variable swap — not a rewrite.*
