# KeepGoing v2 Development Agent - Staged Rollout

Date: 5 October 2026

## Purpose

KeepGoing v2 adds an autonomous software-engineering workflow and the `/dev` Agent Command Center while preserving the existing durable KeepGoing runtime.

The development-agent surface is independently feature-flagged. Shipping the code does **not** enable development tasks.

## Feature flags

Existing durable runtime:

```
KEEPGOING_V12_ENABLED=true
```

New development-agent gate:

```
KEEPGOING_DEV_AGENT_ENABLED=false
```

Keep `KEEPGOING_DEV_AGENT_ENABLED=false` until the durable-store schema accepts bounded `agents-dev:...` engine fingerprints and the canary checks below pass.

## Required database migration

The current production KeepGoing database may still constrain `keepgoing_jobs.engine` to only `agents` and `responses`.

Apply this reviewed migration before enabling the feature:

```
keepgoing_mcp_render/sql/dev_agent_engine_tags.sql
```

The migration keeps the legacy values and additionally accepts only the bounded development-agent fingerprint format used by `dev_agent.js`.

Do not loosen the column to arbitrary text.

### Verify after migration

Run a read-only constraint inspection and confirm `keepgoing_jobs_engine_check` includes both:

- legacy `agents` / `responses`
- the bounded `agents-dev:...` pattern

Then run the database/security advisors and confirm RLS/grants remain unchanged.

## Stage 1 - deploy code with feature OFF

Deploy the branch with:

```
KEEPGOING_DEV_AGENT_ENABLED=false
```

Verify:

- normal KeepGoing MCP tools still work
- `start_dev_task` is not advertised
- `/dev` can render the login shell, but authenticated dev APIs return `development_agent_not_enabled`
- `/readiness` reports `development_agent_enabled=false`
- existing durable jobs continue normally

## Stage 2 - apply database migration

With the dev-agent feature still off:

1. Apply `sql/dev_agent_engine_tags.sql`.
2. Inspect the resulting constraint.
3. Run Supabase security/performance advisors.
4. Exercise one existing legacy durable job path to confirm no regression.

## Stage 3 - owner canary

Enable:

```
KEEPGOING_DEV_AGENT_ENABLED=true
KEEPGOING_V12_CANARY_ONLY=true
```

Run:

```
npm run preflight -- https://<canary-host> --v12 --dev-agent
```

The preflight must confirm:

- durable engine/store ready
- development-agent flag enabled and runtime ready
- `/dev` Command Center renders
- unauthenticated `/dev/api/me` is rejected
- ordinary unauthenticated MCP remains rejected
- legal/security pages remain reachable

## Required development-agent canary matrix

1. Start a simple public-repository implementation task.
2. Verify the job uses an `agents-dev:...` engine fingerprint.
3. Confirm valid completion requires matching acceptance criteria and command evidence.
4. Confirm a false `STATUS: COMPLETED` is downgraded and continued.
5. Confirm `changes.patch`, `review.md`, and `handoff.md` are required.
6. Start Plan Only and confirm `plan.md`, `review.md`, and `handoff.md` are required.
7. Confirm Plan Only rejects any dirty project tree, including untracked files.
8. Confirm Plan Only rejects `workspaceFiles` and incompatible build/release skills.
9. Confirm Playbook criteria are server-added and appear in the task fingerprint.
10. Confirm selected Skills add server-enforced criteria.
11. Confirm job cancel/resume/timeout/watchdog behavior remains durable.
12. Confirm another account cannot read or control the canary job.
13. Confirm no repository credential is present in the sandbox.
14. Confirm no push, merge, deploy, production write, payment, DNS, or secret action occurs without a separately approved integration.

## Stage 4 - broader enable

Only after owner canary is green:

- set `KEEPGOING_V12_CANARY_ONLY=false` if customer access is intended
- keep `KEEPGOING_DEV_AGENT_ENABLED=true`
- rerun preflight
- run one low-risk customer test before wider rollout

## Rollback

To stop new development-agent work without disabling normal KeepGoing durable jobs:

```
KEEPGOING_DEV_AGENT_ENABLED=false
```

Existing durable v1.2 behavior remains enabled.

If a development job is already active, drain or cancel it before rolling back the underlying code. Do not remove the database constraint support while any `agents-dev:...` job rows remain.

## Production changes that require explicit approval

The following are deployment operations, not code-only work:

- applying the Supabase migration
- changing Render environment variables
- repointing a Render service branch
- triggering/restarting a deployment
- enabling development-agent access for non-owner accounts
- adding repository write credentials / GitHub App permissions
