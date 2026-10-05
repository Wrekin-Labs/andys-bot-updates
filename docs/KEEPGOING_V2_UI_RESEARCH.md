# KeepGoing v2 Command Center - Product Research and UI Decisions

Date: 5 October 2026

## Scope

Research current public Devin product surfaces and use the strongest interaction patterns as input to an original KeepGoing interface. This is not a pixel clone and does not reuse Devin code, assets, branding or proprietary implementation.

## Current Devin patterns worth adopting

### 1. Agent Command Center first

Devin Desktop describes its Agent Command Center as the front-and-centre surface for managing local and cloud agents, with a Kanban view, Spaces and multi-agent management. The product message is "plan, delegate, review, and ship" from one surface.

KeepGoing decision:
- Default to a command-centre board.
- Group durable jobs by action state: Working, Needs input, Attention, Done.
- Keep New Development Task visible from anywhere.

Official source:
- https://devin.ai/desktop

### 2. Spaces as the project-level container

Current Devin Desktop groups agent sessions, PRs, files and shared context around a task/project in Spaces. New sessions can inherit shared context.

KeepGoing decision:
- Add a Spaces surface to the navigation now.
- Milestone 1 derives simple Development and General spaces from durable jobs.
- Milestone 2 will persist named Spaces and shared project context server-side.

Official source:
- https://devin.ai/desktop

### 3. Session status and interruption control

Devin’s current experience exposes clear session state and allows users to interrupt or redirect active work.

KeepGoing decision:
- Session header always shows durable state.
- Stop is available while a session is active.
- Resume composer activates only for `input_required`.
- Worklog shows the latest structured checkpoint and raw agent output without pretending a model claim is verified.

Official source:
- https://devin.ai/desktop

### 4. Artifacts and diffs are first-class review surfaces

Current Devin product surfaces emphasize reviewing agent changes and artifacts before shipping.

KeepGoing decision:
- Dedicated Artifacts tab backed by existing KeepGoing session artifacts.
- Dedicated Diff tab opens the real published `changes.patch` artifact for review.
- Preview text artifacts inside the Command Center.
- Keep patches and handoff reports visible alongside acceptance evidence.

Official source:
- https://devin.ai/desktop

### 5. Long sessions need progressive rendering

Devin reports that sessions can contain hundreds of thousands of events. Its newer renderer fetches recent events first, progressively loads older areas and virtualizes visible rows to avoid rendering the entire history.

KeepGoing decision:
- Milestone 1 renders only the latest durable checkpoint because that is what our current store exposes.
- When event history is added, implement cursor pagination and virtualized worklog rows rather than loading an entire session.

Official source:
- https://devin.ai/blog/rebuilding-devins-chat-renderer

### 6. IDE/workspace views are useful only when they expose evidence

Devin Desktop combines agent management with a full IDE and explicitly emphasizes reviewing agent diffs before push.

KeepGoing decision:
- Workspace tab starts with the actual capabilities available to the task: files, shell, tests, artifacts, git diff and research.
- Avoid a fake IDE. Add terminal/editor/browser panels only when backed by real workspace APIs.
- Project Relay remains the bridge when a task needs an authorised local workstation or Android tooling.

Official source:
- https://devin.ai/desktop

### 7. Parallel work is a separate orchestration mode

Devin Code Scans uses an Agentic MapReduce design to break broad investigations into focused batches, distribute work across agents, and synthesize findings.

KeepGoing decision:
- Keep the single-agent development loop as the reliable default.
- Add parallel specialist workers later for scan/refactor/migration tasks with explicit shard/reduce state.

Official source:
- https://devin.ai/blog/introducing-code-scans

### 8. Local agent controls matter

Devin CLI exposes explicit planning and agent-control concepts, model choice, context tooling and terminal-first operation.

KeepGoing decision:
- Preserve explicit autonomy mode.
- Add playbook presets to task creation.
- Keep destructive/external operations approval-gated.
- Plan Only is implemented as an enforced read-only workflow with a clean-worktree verification check.
- Future controls: Review Loop, Fork, Revert checkpoint, Context inspector and explicit handoff to Project Relay.

Official source:
- https://devin.ai/cli

### 9. Governed skills and plugins

Devin Plugins bundle skills, rules, MCP servers, hooks and subagents so teams can standardise agent capabilities across local and cloud work.

KeepGoing decision:
- Add a dedicated Skills surface beside Playbooks and Knowledge.
- Skills are server-enforced task modifiers, not decorative UI labels.
- Selected skills add explicit completion criteria and guidance to the durable task contract.
- Initial skills: deep code review, test hardening, security review, Android release, web release readiness, and documentation/handoff.
- Keep external MCP/server permissions separately approval-scoped; a Skill never silently grants credentials or production access.

Official source:
- https://devin.ai/blog/governing-ai-agents-at-scale-with-blackrock

## KeepGoing visual direction

The interface is deliberately KeepGoing-branded:
- graphite workspace
- cyan/violet action accent
- compact technical typography
- dense but readable panels
- command-centre board as the primary screen
- session detail as a split worklog/evidence view
- no borrowed Devin logos, screenshots, wording or proprietary UI assets

## Milestone 1 implemented

- `/dev` Command Center route.
- Activation-token login kept in sessionStorage.
- Agent fleet Kanban.
- Sessions list.
- Spaces, Knowledge, Playbooks, Skills and Integrations navigation.
- New autonomous development-task form.
- Enforced Plan Only mode: read-only repository analysis, `plan.md` output and `test -z "$(git status --porcelain=v1 --untracked-files=all)"` proof before completion.
- Server-enforced Playbook presets for bug fixes, features, audits, refactors, CI repair and dependency updates.
- Server-enforced Skills that compose review/release capabilities into task acceptance criteria.
- Live job detail.
- Stop and resume controls.
- Structured plan/edit/build/test/review progress.
- Acceptance criteria and verification evidence.
- Dedicated Review tab backed by the required `review.md` artifact plus reported risks.
- Dedicated verified diff/plan view.
- Session artifacts list and text preview.
- Workspace capability panel.
- Authenticated REST endpoints over the existing durable runtime.
- CSP/no-store/noindex protection.
- Responsive desktop/mobile layout.
- Deterministic npm CI using the committed lockfile and `npm ci`.

## Next milestones

1. Persist named Spaces and repository metadata.
2. Server-backed Knowledge plus team-managed custom Playbooks and Skills.
3. Paginated durable event/worklog history with virtualized rendering.
4. GitHub App writer: branch, draft PR, CI inspection and repair loop.
5. Real workspace files/terminal/browser viewers backed by sandbox APIs.
6. Review Loop and independent reviewer agent.
7. Parallel scan mode using Plan → Shard → Map → Reduce.
8. Project Relay live workstation/app preview where explicitly authorised.
