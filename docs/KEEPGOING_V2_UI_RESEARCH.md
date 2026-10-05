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

Devin's current Code Channel experience exposes a status chip, a stop control, a context bar and expandable working messages.

KeepGoing decision:
- Session header always shows durable state.
- Stop is available while a session is active.
- Resume composer activates only for input_required.
- Worklog shows the latest structured checkpoint and raw agent output without pretending a model claim is verified.

Official source:
- https://devin.ai/blog/devins-slack-etiquette

### 4. Artifacts are first-class

Devin aggregates code diffs, plans, videos and screenshots into a session artifacts tab.

KeepGoing decision:
- Dedicated Artifacts tab backed by existing KeepGoing session artifacts.
- Dedicated Diff tab opens the real published `changes.patch` artifact for review.
- Preview text artifacts inside the Command Center.
- Keep patches and handoff reports visible alongside acceptance evidence.

Official source:
- https://devin.ai/blog/devins-slack-etiquette

### 5. Long sessions need progressive rendering

Devin reports that sessions can contain hundreds of thousands of events. Its newer renderer fetches recent events first, progressively loads older areas and virtualizes visible rows to avoid rendering the entire history.

KeepGoing decision:
- Milestone 1 renders only the latest durable checkpoint because that is what our current store exposes.
- When event history is added, implement cursor pagination and virtualized worklog rows rather than loading an entire session.

Official source:
- https://devin.ai/blog/rebuilding-devins-chat-renderer

### 6. IDE/workspace views are useful only when they expose evidence

Devin Desktop combines agent management with a full IDE. Devin Cloud also exposes live machine/simulator views for validation. The useful product principle is not "show a terminal"; it is "show the environment and evidence needed to review the agent."

KeepGoing decision:
- Workspace tab starts with the actual capabilities available to the task: files, shell, tests, artifacts, git diff and research.
- Avoid a fake IDE. Add terminal/editor/browser panels only when backed by real workspace APIs.
- Project Relay remains the bridge when a task needs an authorised local workstation or Android tooling.

Official sources:
- https://devin.ai/desktop
- https://devin.ai/blog/devin-gets-a-mac

### 7. Parallel work is a separate orchestration mode

Devin Code Scans uses a Plan -> Shard -> Map -> Reduce architecture for broad codebase investigations.

KeepGoing decision:
- Keep the single-agent development loop as the reliable default.
- Add parallel specialist workers later for scan/refactor/migration tasks with explicit shard/reduce state.

Official source:
- https://devin.ai/blog/introducing-code-scans

### 8. Local agent controls matter

Devin CLI exposes plan, ask, loop, fork, revert, recap, resume, sandbox modes, permission rules, hooks, subagents, MCP and cloud handoff.

KeepGoing decision:
- Preserve explicit autonomy mode.
- Add playbook presets to task creation.
- Keep destructive/external operations approval-gated.
- Future controls: Plan Only, Review Loop, Fork, Revert checkpoint, Context inspector and handoff to Project Relay.

Official source:
- https://devin.ai/cli

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

- /dev Command Center route.
- Activation-token login kept in sessionStorage.
- Agent fleet Kanban.
- Sessions list.
- Spaces, Knowledge, Playbooks and Integrations navigation.
- New autonomous development-task form.
- Playbook presets.
- Live job detail.
- Stop and resume controls.
- Structured plan/edit/build/test/review progress.
- Acceptance criteria and verification evidence.
- Session artifacts list and text preview.
- Workspace capability panel.
- Authenticated REST endpoints over the existing durable runtime.
- CSP/no-store/noindex protection.
- Responsive desktop/mobile layout.

## Next milestones

1. Persist named Spaces and repository metadata.
2. Server-backed Knowledge, Playbooks and Skills.
3. Paginated durable event/worklog history with virtualized rendering.
4. GitHub App writer: branch, draft PR, CI inspection and repair loop.
5. Real workspace files/diff/terminal viewers backed by sandbox APIs.
6. Review Loop and independent reviewer agent.
7. Parallel scan mode using Plan -> Shard -> Map -> Reduce.
8. Project Relay live workstation/app preview where explicitly authorised.
