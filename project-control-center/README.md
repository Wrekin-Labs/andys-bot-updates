# Project Control Center v0.3

Wrekin Labs owner dashboard and control plane for work running across KeepGoing, Project Relay, GitHub/CI and other projects.

## Autonomous engineer milestone

v0.3 adds a safe engineering-session lifecycle on top of the live project dashboard:

`planning → coding → testing → reviewing → ci → pr_ready → completed`

Sessions can also move into `blocked`, `paused` or `failed`. Invalid jumps are rejected. Each session can carry bounded build/test/review evidence and an explicit owner-approval gate.

The approval gate is deliberate: a session can request approval, becomes blocked, and cannot continue until the owner approves or rejects the request. That gives the control plane a place to stop before sensitive or irreversible actions.

## Existing operations view

- responsive project fleet dashboard;
- Server-Sent Events for near-real-time updates;
- authenticated event ingestion;
- KeepGoing, Relay and GitHub status adapters;
- bounded local persistence;
- stale-heartbeat detection;
- mobile-friendly owner view.

## Engineering API

All mutating routes require `PROJECT_CONTROL_TOKEN`.

- `GET /api/engineering/tasks`
- `POST /api/engineering/tasks`
- `GET /api/engineering/tasks/:id`
- `POST /api/engineering/tasks/:id/transition`
- `POST /api/engineering/tasks/:id/evidence`
- `POST /api/engineering/tasks/:id/approval-request`
- `POST /api/engineering/tasks/:id/approval-resolve`

The normal project event API remains `POST /api/events`.

## Run

```powershell
$env:PROJECT_CONTROL_TOKEN="use-a-random-secret"
npm start
```

Open `http://127.0.0.1:8787`.

The browser UI stores the entered control token in `sessionStorage` only, so it is cleared when that tab/session closes. Read-only localhost views work without a token.

## Verify

```powershell
npm run verify
```

The test suite checks the engineering state machine, authenticated API flow, SSE delivery and persisted state recovery.

## Safety boundary

v0.3 does **not** automatically merge protected branches, deploy production, accept legal terms, make payments, handle 2FA, or expose secrets. Those actions need an explicitly integrated tool and the appropriate owner approval.

## Next integrations

1. Bind KeepGoing durable jobs to engineering-session IDs and lifecycle events.
2. Give Project Relay isolated Git worktrees or cloud workers rather than writing directly into production folders.
3. Add GitHub check-run, review-comment and pull-request evidence to sessions.
4. Add Playwright browser QA with screenshots/video as evidence.
5. Move persistent history to Supabase for secure cross-device access.
6. Put remote/mobile access behind proper authenticated Wrekin Labs user sessions.
