# Project Relay architecture v0.7

## Production path

`ChatGPT -> public HTTPS MCP gateway -> OAuth account -> linked workstation task queue -> outbound Windows Relay Agent -> named local capability -> Windows / file / hardware adapter`

The Windows workstation remains the final policy authority.

## Trust boundaries

### 1. Hosted MCP gateway

The hosted catalog:

- authenticates the Project Relay OAuth account
- limits access to explicitly linked workstations
- requires `role=owner` for owner-routed actions
- queues only named allowlisted actions
- does not receive a universal workstation shell token

### 2. Device broker

Each enrolled device uses its own stored device credential and outbound polling. The device endpoint:

- authenticates the device
- allows only known action names
- expires queued tasks
- bounds result size
- records task lifecycle audit events

### 3. Local Relay agent

The local agent advertises only its registered bridge actions and executes the named function. High-impact owner actions still call `require_enabled()`, which reads the workstation-local Owner Full Control switch.

This provides two independent owner checks:

1. cloud account/device owner relationship
2. local workstation owner-control switch

Neither check replaces the other.

### 4. Normal approval mode

Normal mutations follow:

`prepare -> exact local approval -> action/argument digest validation -> one-time execution`

Approvals are expiring and single-use. They cannot be repurposed with different arguments.

### 5. Filesystem boundary

Normal file operations are restricted to:

- the signed-in user's home directory
- explicitly configured environment roots
- extra roots added **locally** through Relay GUI/CLI

Root expansion is intentionally not a remote owner action.

The resolver rejects symlink/reparse-point traversal before resolving the target. Search walkers do not follow links.

Owner Full Control filesystem administration is broader by design and is separately protected by the local owner switch.

### 6. Sensitive file and document reads

Hosted multi-file content, Office/PDF reads, terminal output and similar sensitive inspection are owner-routed.

Format-aware adapters are used for XLSX/PDF/DOCX. Generic text write tools do not mutate binary document formats.

### 7. Terminal and code execution

Owner terminal sessions are:

- bounded in count
- bounded in input and retained output
- locally revocable through Owner Full Control
- not persisted across agent restart
- not claimed to be sandboxed

Optional Docker code execution is a separate mode. It uses fixed already-installed images and runs with no network, no host mounts, read-only root, dropped capabilities and explicit resource limits.

SSH sessions disable password and keyboard-interactive authentication and rely on existing keys/agent state.

### 8. Network reads

The public URL reader:

- permits only HTTP/HTTPS
- rejects credentials and credential-shaped query keys
- rejects localhost/private/link-local/reserved destinations
- validates DNS results
- connects to a validated pinned address
- preserves HTTPS SNI/hostname verification
- revalidates redirects and rejects HTTPS downgrade

### 9. Desktop/UI automation

Normal click/type/scroll/tab mutations use exact local approval.

Owner UI Automation is limited to exact visible enabled controls. Password controls are rejected. Generic hosted screenshot capture and remote free-form password-field text setting remain unpublished.

### 10. Hardware and capability packs

Printers, scanners, serial, USB, audio/MIDI and local-network neighbours are discovered through narrow adapters. Serial reads require exact approval. Physical print and scan execution remain product-gated pending validated hardware adapters.

Capability packs such as CADBridge expose declared read/write/physical risks; only explicitly curated read actions are executable through the generic bridge.

## State

Windows state defaults to:

`%LOCALAPPDATA%\ProjectRelay`

It contains enrollment metadata, approvals, audit history, owner-control state, runtime preferences, root policy, edit/document checkpoints and bounded tool history.

Secrets use the existing protected credential path; tool history stores argument shapes rather than argument values.

## Release/update boundary

Published updates require a release manifest and SHA-256 checksum. The updater validates the archive, creates backup/rollback state, replaces application code and restarts Relay services.

A development branch is not a published release and should not be pushed to user workstations.

## Failure model

Unknown capabilities fail closed. Ambiguous desktop input timeouts are not automatically replayed. Concurrent edit operations use expected hashes/checkpoints to avoid silently overwriting changed files.

The v0.7 hosted/device/bridge/SQL catalogs are cross-checked in CI so a published hosted tool cannot exist without a dispatch route and broker allowlist entry.

## Unattended Windows recovery (v0.7.12)

Always-on Windows workstations may opt into a separate Task Scheduler S4U cloud-recovery task. Installation requires local elevation and first executes a temporary S4U probe. The feature is enabled only when that identity can decrypt the existing user-scoped DPAPI device credential and reach the configured cloud endpoint. No Windows password is stored by Project Relay. Interactive logon remains the preferred desktop session and takes over the cloud agent so UI automation is not left in a non-interactive session.

