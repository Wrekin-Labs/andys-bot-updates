# KeepGoing v2 — Autonomous Development Agent

## Purpose

KeepGoing v2 turns the existing durable-job engine into a bounded software-engineering agent that can take a repository task from inspection through implementation, verification and handoff without needing repeated “continue” prompts.

It is an independent implementation, not a copy of Devin internals or branding.

## Milestone 1 product contract

A development task contains:

- public GitHub repository URL and base ref
- engineering goal
- explicit acceptance criteria
- optional verification commands
- autonomy mode
- task-specific context
- optional selected workspace files
- optional reusable playbook
- up to four composable skills that add server-enforced guidance and acceptance criteria
- optional enforced plan-only mode

The task is complete only after every required acceptance criterion is reported as passed with evidence, required verification commands exit successfully, the final review is complete, and output artifacts are produced.

Plan-only tasks use the same durable engine but forbid edits under `/workspace/project`, require `/workspace/outputs/plan.md`, and inject `test -z "$(git status --porcelain=v1 --untracked-files=all)"` as a mandatory verification command so the server can reject a false read-only claim.

## State model

Primary flow:

`queued -> inspecting -> planning -> implementing -> verifying -> reviewing -> completed`

Side states:

- `input_required`
- `blocked`
- `failed`
- `budget_exhausted`
- `cancelled`

The durable KeepGoing job remains the source of truth for liveness and recovery. The development stage is domain-level progress reported by the coding agent.

Completion is also server-gated. Each development job stores a compact task fingerprint in its durable engine tag (criterion IDs, explicit verification commands, patch requirement, and plan-only mode). A model-emitted `STATUS: COMPLETED` is downgraded to `STATUS: PARTIAL` when the structured evidence does not match that fingerprint, so the model cannot complete a job merely by claiming success.

## Execution loop

1. Inspect repository structure and project instructions.
2. Map a short plan to acceptance criteria.
3. Implement the smallest coherent change, or remain read-only in Plan Only mode.
4. Run the relevant syntax/lint/unit/build/integration checks.
5. If a check fails, inspect the actual failure, repair it and re-run it.
6. Repeat until the verification gate passes.
7. Review the final diff or final plan for correctness, security, regressions and scope creep.
8. Write progress plus patch/plan, `review.md`, and handoff artifacts under `/workspace/outputs`.
9. Return `STATUS: COMPLETED` only after the verification gate passes.

## Default safety policy

Allowed inside the isolated workspace:

- repository read/search
- local file edits for implementation tasks
- dependency install from the sandbox allowlist
- local builds/tests/linters
- local git status/diff/branch operations
- patch/report artifact creation

Plan Only mode restricts project-file changes and requires a clean-worktree proof before completion.

Approval-gated or unavailable by default:

- remote push
- remote branch creation
- pull-request creation
- PR merge
- production deployment
- production database writes
- DNS changes
- external messages
- payment/billing changes
- secret read/write/rotation
- destructive repository or data actions

The first milestone intentionally does not inject repository write credentials into the coding sandbox.

## Playbooks and skills

Playbooks define a primary engineering procedure. Current server-enforced presets are:

- bug fix + regression
- feature + tests
- security/quality audit
- safe refactor
- CI repair
- dependency update

Skills are composable task modifiers. Up to four may be selected, and each selected skill adds explicit guidance and acceptance criteria to the durable task contract:

- deep code review
- test hardening
- security review
- Android release
- web release readiness
- documentation + handoff

Playbooks and Skills do not grant external permissions. GitHub writes, production access, secrets, payments and other external side effects remain separately approval-scoped.

## Structured progress

The agent publishes `/workspace/outputs/dev-progress.json` and includes a compact single-line checkpoint using the prefix `DEV_PROGRESS_JSON:`.

Example:

```json
{
  "stage": "verifying",
  "summary": "Implemented retry-safe CI repair loop",
  "criteria": [
    {"id": "AC1", "status": "pass", "evidence": "npm test"},
    {"id": "AC2", "status": "pending", "evidence": null}
  ],
  "checks": [
    {"command": "npm test", "exitCode": 0, "required": true}
  ],
  "risks": [],
  "artifacts": [
    "/workspace/outputs/changes.patch",
    "/workspace/outputs/handoff.md"
  ],
  "next": "Run final diff review"
}
```

## Verification gate

The milestone-1 core implements a deterministic verification gate. It rejects completion when:

- a required criterion is missing, pending, blocked or failed
- a criterion has no evidence
- a required verification command is missing or non-zero
- auto-detected verification reports no required check
- final completed stage is missing
- required patch/plan, review, or handoff artifacts are missing
- the reported criterion IDs or explicit verification commands do not match the task fingerprint
- Plan Only mode does not prove the worktree remained clean

This protects the product from treating “the model said it finished” as proof of completion.

## Architecture

1. **Durable orchestration** — existing KeepGoing leases, retries, budgets, watchdog and session recovery.
2. **Development task contract** — `dev_agent.js` normalises repo/ref, criteria, verification, playbooks, skills and approval policy.
3. **Task adapter** — `dev_task_adapter.js` converts a development task into existing `start_persistent_job` arguments with `codingWorkspace=true`.
4. **Agent runtime** — existing isolated OpenAI-hosted coding workspace at `/workspace/project`.
5. **Artifacts** — existing KeepGoing artifact list/read tools, restricted to `/workspace/outputs`.
6. **Command Center** — authenticated `/dev` interface with task creation, fleet view, session evidence, diff/artifact review, Spaces, Knowledge, Playbooks, Skills and Integrations.
7. **GitHub writer (later milestone)** — separately-scoped GitHub App integration for branch/PR operations after explicit policy checks.

## Research grounding

High-signal patterns used in this design:

- OpenHands V1 separates agent core, tools, workspace and agent server, and keeps a single mutable conversation state for replay/persistence.
- SWE-agent shows that a concise agent-computer interface and immediate syntax/lint feedback can outperform dumping large raw shell/file context into the model.
- Vercel Agent runs generated code in isolated microVM sandboxes and scopes external permissions separately from code execution.
- GitHub recommends least-privilege workflow permissions.
- Devin’s current public product puts an Agent Command Center with Spaces, Kanban and multi-agent management front and centre, while retaining a full IDE for direct review.
- Devin CLI exposes explicit planning, looping, sandbox, permission, subagent and MCP concepts.
- Devin Code Scans uses an agentic Plan → Shard → Map → Reduce pattern for broad investigations.
- Devin Plugins bundle skills, rules, MCP servers, hooks and subagents for governed reuse across agents.

## Milestone 1 files

- `dev_agent.js`
- `dev_playbooks.js`
- `dev_skills.js`
- `dev_task_adapter.js`
- `dev_dashboard.js`
- associated dev-agent/dashboard/service tests
- `KEEPGOING_V2_DEV_AGENT.md`
- `KEEPGOING_V2_UI_RESEARCH.md`

## Next milestones

1. GitHub App writer with repository-scoped installation tokens.
2. Branch-per-task and draft PR creation.
3. CI run inspection, failure classification and retry/fix loop.
4. Independent reviewer agent before merge.
5. Persistent named Spaces and project Knowledge.
6. Team-managed custom Playbooks and Skills.
7. Parallel specialist workers for large tasks.
8. Paginated/virtualized event history and real workspace file/terminal/browser views.
9. Project Relay live workstation/app preview where explicitly authorised.
10. Evaluation harness using representative real repository tasks.
