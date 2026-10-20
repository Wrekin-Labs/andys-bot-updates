# Jarvis 2.0 upgrade preparation

Status: research preparation only. No application upgrade or deployment has been performed.

## Verified baseline — 20 October 2026

- Repository: Wrekin-Labs/andys-bot-updates.
- Research branch: feature/jarvis-2-research, created from main at 0f5f6a6a6a85d306b8251480deb9d593d28c2042.
- Original write failure: GitHub returned 403 Resource not accessible by integration on reference creation.
- Cause: ChatGPT Codex Connector was installed on chipblock2 but absent from the repository owner organisation Wrekin-Labs. The personal installation included other public repositories as read-only.
- Owner approved an organisation installation restricted to this repository. Installation 173283767 uses selected-repository access. Branch creation then succeeded through the same integration.
- The App requests read/write access to code, actions, workflows, issues and pull requests; read access to checks, commit statuses and metadata. These are App-requested capabilities, broader than the code-write permission needed for branch creation.
- A comparison immediately after branch creation showed identical history to main and zero changed files.

## Existing assets inspected

The main branch contains a Project Relay public MCP gateway, trading research modules, Ask Shropshire assets and release archives. Its complete recursive tree contained no path matching Jarvis, Mark-LI or Devlin, and no AGENTS.md file.

project-relay-gateway/README.md describes a Render-compatible HTTP proxy to a broker. Its presence does not establish that the Windows Jarvis application or its current configuration is available in this repository. The live gateway and broker were not contacted or changed.

The recovered jarvis2_research_starter.zip contains a blueprint, policy.py and four policy checks. Those checks passed locally. It also contains Python and pytest caches, which should be excluded from future source imports. This starter is not a working Jarvis application.

Inspected repository workflows:
- build-r531-release.yml runs on changes to its own path or a particular release payload, plus manual dispatch.
- r76-research-tests.yml runs on pull requests touching its listed trading research paths, plus manual dispatch.
- This new research document touches none of those paths. No workflow, release payload or deployment configuration is being modified.

## Upgrade direction

Preserve and integrate the existing Windows Jarvis, KeepGoing and Project Relay components after locating and identifying their actual installed versions.

Proposed flow:
voice or text input -> intent router -> durable task registry -> action policy and owner approval -> narrowly scoped adapter -> result verification -> audit record.

Start with text and read-only adapters. Voice and outbound calling remain disabled until the underlying task and approval flow is proven.

## Gaps to close before implementation

1. Locate the authoritative Windows Jarvis / Mark-LI source and installed configuration. Confirm the executable, shortcut target, version, configuration paths and data store on Home PC using read-only inspection. Do not assume remembered paths are current.
2. Identify current KeepGoing and Project Relay versions and supported interfaces; do not replace them using older repository snapshots.
3. Inventory authentication requirements without copying credentials, tokens or private messages into this public repository.
4. Confirm adapter contracts, runtime versions and recovery behaviour using isolated tests before choosing an orchestration framework.
5. Record provider, licence, release and maintenance evidence for any proposed dependency before adoption. No framework selection is final in this preparation.

## First implementation milestone

Build an isolated local prototype with fake adapters and no production credentials.

- Durable task registry: task identity, state, checkpoints, timestamps and adapter operation identifiers.
- Approval records: bind approval to owner identity, exact action, destination, payload digest, expiry and one-time consumption.
- Treat the starter's approved=True argument as a demonstration only. It is not an authentication boundary and must never be controlled by an LLM or untrusted tool input.
- Separate task scheduling permission from permission to send messages or modify remote resources.
- Idempotency: persist intent before dispatch; record provider receipts; reconcile uncertain outcomes after a crash. Do not automatically retry an external send when completion is unknown.
- Cancellation: check immediately before each side effect and prevent cancelled tasks from resuming.
- Verification: a tool call returning successfully is not enough; inspect a receipt or authoritative resulting state.
- Audit: keep operation metadata locally with retention controls and redact sensitive payloads.
- Restrict GitHub writes initially to the research branch. Keep deployment actions disabled.

## Acceptance checks

- Restart before dispatch: task resumes once without duplicate execution.
- Crash after external success but before local acknowledgement: state becomes unknown and requires reconciliation, without blindly sending again.
- Expired, altered, reused or wrong-owner approval: action is denied.
- Prompt injection in an email, webpage or repository file cannot grant approval or widen scope.
- Unknown action, revoked adapter access and missing credentials fail closed with a useful status.
- Cancellation before a side effect prevents it.
- Read-only adapters cannot call mutation methods.
- Task and audit outputs contain no secrets.
- Only after fake-adapter checks pass: individually authorised integration checks on Home PC, with Studio bookings and live deployments untouched.

## Boundaries for this research branch

Do not alter existing project files, main, release assets, trading controls, studio bookings, gateway configuration, DNS or live deployments. Add new research material only. Do not publish private workstation inventories in this public repository.

Next concrete deliverable: a verified inventory of the existing Jarvis installation and a minimal adapter specification grounded in that source.
