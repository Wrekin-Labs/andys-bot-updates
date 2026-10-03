# Project Relay 0.7.12

Project Relay 0.7.12 adds an opt-in unattended Windows recovery path for always-on workstations while preserving the existing owner and local-control boundaries.

## Unattended recovery

- Adds `scripts/install-unattended-recovery.ps1`.
- Requires one elevated local installation; Project Relay does not remotely bypass UAC.
- Uses Windows Task Scheduler S4U so no Windows password is stored in Project Relay or embedded in a task.
- Runs a temporary S4U probe before enabling the feature.
- The probe must prove that the same Windows identity can decrypt the existing DPAPI-protected Relay device credential and reach the configured cloud endpoint.
- If either probe fails, installation fails closed and the existing interactive setup is left in place.
- Adds a boot trigger plus one-minute guarded recovery checks for the outbound cloud agent.
- Keeps the existing interactive logon task. On user logon, the interactive task takes over the agent session so desktop/UI capabilities are not stranded in a non-interactive Task Scheduler session.

## Diagnostics

Recovery status now reports the cloud/MCP watchdogs and whether unattended recovery is installed.

## Version consistency

The package and runtime versions are both 0.7.12.
