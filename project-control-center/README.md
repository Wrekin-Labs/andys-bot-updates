# Project Control Center v0.1

Live owner dashboard for work running across KeepGoing, Project Relay, GitHub/CI and other Wrekin Labs projects.

## What v0.1 does
- responsive live dashboard with All / Active / Needs Andrew / Done filters;
- Server-Sent Events for near-real-time updates;
- bounded authenticated POST /api/events ingestion;
- safe project status model: status, stage, percentage, blocker, attempt counters and short operational message;
- no prompt bodies, credentials or private file contents in the event schema;
- localhost-first viewing by default;
- event history bounded to 500 records in memory;
- seeded KeepGoing, Project Relay and GitHub/CI sources.

## Run
PowerShell:
```
$env:PROJECT_CONTROL_TOKEN="use-a-random-secret"
npm start
```
Then open http://127.0.0.1:8787.

The dashboard GET view is intentionally only unauthenticated while bound to loopback. If HOST is changed away from localhost, snapshot and stream routes also require the control token.

## Send a status event
POST /api/events with either Authorization: Bearer <token> or x-project-control-token.

Example payload:
```json
{
  "project_id": "keepgoing",
  "project_name": "KeepGoing",
  "status": "working",
  "stage": "Running durable upgrade job",
  "progress": 45,
  "message": "Adding telemetry and recovery diagnostics",
  "source": "keepgoing",
  "job_id": "kgj_...",
  "attempt": 1,
  "max_attempts": 12
}
```

Allowed statuses: unknown, queued, working, healthy, blocked, needs_owner, failed, completed, paused.

## Next integration steps
1. Emit safe lifecycle events from KeepGoing job start/transition/watchdog paths.
2. Emit Relay heartbeat/health events from Project Relay.
3. Add GitHub Actions adapter for branch / CI state.
4. Replace localhost-only viewing with KeepGoing OAuth for secure remote/mobile access.
5. Move the bounded in-memory event history to Supabase and subscribe with Realtime for persistent cross-device history.

