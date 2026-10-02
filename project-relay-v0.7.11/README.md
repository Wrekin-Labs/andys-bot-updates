# Project Relay v0.7.0 beta

Project Relay is a Windows-first workstation, hardware and desktop capability layer for ChatGPT/MCP.

It is designed around two security modes:

- **Normal/customer mode** — mutations use exact, expiring, single-use local approvals.
- **Owner Full Control** — broader administration is available only when the signed-in OAuth account has `role=owner` for the selected workstation **and** Owner Full Control is enabled locally on that PC. It can be revoked locally at any time.

The cloud does not get a universal bypass. Extra approved filesystem roots are also local-only configuration.

## v0.7 workstation suite

The v0.7 beta adds the main workstation-management capabilities expected from a mature desktop connector while keeping Project Relay's multi-PC, hardware and local-control model.

### Files, search and editing

- recursive approved-root listing and filename search
- bounded UTF-8 reads, multi-file reads and negative offsets
- SHA-256 hashing
- literal and regex content search with bounded context
- exact/regex replacement with unified-diff preview
- optimistic SHA-256 conflict detection
- edit checkpoints and rollback
- atomic multi-file edit transactions
- owner create/copy/move/delete operations
- ZIP list/create/extract with path, symlink, size and compression-ratio protections
- symlink/reparse-point traversal rejection for normal approved-root tools

### Terminal and processes

Owner mode supports bounded interactive/background sessions using:

- PowerShell
- cmd
- WSL
- Python
- Node
- R
- SSH using key/agent authentication only; password and keyboard-interactive authentication are disabled

Session output is bounded and paginated. Project Relay also includes explicit process start/termination, Windows service administration, scheduled-task controls and supervised-app duplicate protection.

### Documents and data

Format-aware tools cover:

- CSV / TSV
- JSON
- XLSX / XLSM
- PDF
- DOCX
- image preview reads

The owner document suite supports structured creation/update operations and rollback checkpoints. Generic text tools are not used to mutate binary Office/PDF formats.

### Windows administration

Owner mode includes:

- process start/terminate
- service start/stop/restart
- Winget list/search/install/uninstall/upgrade
- scheduled-task inspection and action
- system snapshot
- network summary
- bounded Windows Event Log queries
- UI Automation targeting of exact visible enabled non-password controls

### Network and isolation

- public URL reads use scheme checks, credential-query rejection, public-IP validation, address pinning and redirect validation
- optional Docker Python/Node execution uses already-installed fixed images with no network, no host mounts, read-only root, dropped Linux capabilities and CPU/memory/PID limits
- ordinary terminal sessions are **not** described as sandboxed

### Hardware and specialist bridges

Project Relay keeps the capabilities that distinguish it from generic desktop connectors:

- printer discovery and print preflight
- scanner discovery
- serial/COM inspection and approved bounded serial reads
- USB storage, audio/MIDI and useful USB peripheral discovery
- local-network neighbour inspection without port scanning
- capability-pack / CADBridge integration

Physical printing and scanner acquisition remain disabled until their hardware adapters are validated.

## Local controls

The Windows GUI includes:

- Devices
- Approvals
- Audit
- Local settings
- local Owner Full Control enable/revoke
- local extra approved-root management

The same owner/root controls are also available from the local CLI:

```powershell
relay owner-status
relay owner-enable
relay owner-disable
relay roots-list
relay roots-add "D:\Projects"
relay roots-remove "D:\Projects"
```

These commands operate locally on the workstation. There is no remote action to enable Owner Full Control or broaden normal-mode approved roots.

## Update safety

Project Relay self-update uses a published release manifest, SHA-256 verification, ZIP path/symlink validation, local backup, rollback attempt, runtime restart and GUI relaunch.

Unpublished branch builds should not be installed on production workstations.

## Local MCP

The local MCP service binds to loopback only by default.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mcp.ps1
```

Startup scripts install guarded scheduled tasks for the local MCP service and outbound cloud agent. The v0.6+ runtime includes single-instance and startup-recovery protections.

## Hosted MCP

Production traffic follows:

`ChatGPT -> public HTTPS MCP gateway -> authenticated Project Relay account -> outbound paired workstation agent -> named capability`

The hosted catalog requires OAuth account linking. Owner tools require both account ownership and the workstation-local Owner Full Control switch.

Generic hosted desktop screenshot capture and remote password-field/text-setting are intentionally unpublished.

## Commercial beta status

v0.7.0 is a beta release candidate until cross-platform CI, hosted catalog checks and Windows live validation are complete.

See:

- `docs/DESKTOP_COMMANDER_PARITY_2026-09-29.md`
- `ARCHITECTURE.md`
- `MCP_TOOL_CONTRACT.json`
- `RELEASE_NOTES_v0.7.0-beta.md`
