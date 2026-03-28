# DrawRoom

A real-time collaborative drawing and chat app. Multiple people can draw on a shared canvas at the same time, with a side panel for text chat.

## What's inside

| Package | Role |
|---|---|
| `packages/web` | React frontend — canvas (tldraw) + chat UI |
| `packages/api` | REST API — room management, chat history, exports |
| `packages/yws` | WebSocket server — syncs canvas state between clients in real time |
| `packages/shared` | Shared TypeScript types |

## Running locally

**Requirements:** Node ≥ 20, pnpm ≥ 9, Docker

```bash
# 1. Install dependencies
pnpm install

# 2. Start backend services (Postgres, Redis, API, WebSocket server)
docker compose up -d

# 3. Start the frontend
pnpm --filter web dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. Create a room and share the URL to collaborate.

## Other commands

```bash
pnpm build          # build all packages
pnpm test           # run all tests
pnpm lint           # lint all packages
pnpm type-check     # TypeScript check across the monorepo
```

## Ports

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| API | http://localhost:3000 |
| WebSocket (canvas sync) | ws://localhost:1234 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |
