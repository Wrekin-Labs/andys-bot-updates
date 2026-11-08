# Project Relay release-readiness review — 8 November 2026

Status: NOT READY for production release or plugin resubmission.

## Follow-up fixes and validation

The follow-up retains the production hold. Candidate source now consistently reports 0.7.12 in MCP initialization, hosted status and version-comparison logic. This is source preparation only: the live service still requires an approved deployment.

The validator now recognizes the recovered hosted/ layout while preferring the canonical supabase/functions/ layout when present, and rejects a hosted/package version mismatch. Missing plugin files still block submission.

Public-page GET checks return permanent HTTP failures immediately, including 403. Both public-page and JSON GET checks retry 502/503/504 within the existing attempt limit. JSON POST HTTP failures are not replayed. No WAF settings changed.

Added 13 tests, including actual temporary-state update backoff/recovery, successful post-update confirmation, wrong-version rejection and expired health windows. Combined result: **32 tests passed on Linux Python**, supplementing the previous 19-test Windows result. Physical reboot/recovery is still untested. The review branch is now included in the Windows CI trigger; no deployment job was added.

The named project-relay repository was checked again and still returns 404. Workflow #295 and the missing plugin bundle remain unresolved. GitHub Windows CI run 42486915554 passed both jobs for code commit a7d7ba7174c22cb00f249cc728181ca4075d2158: Python regression tests/compilation and PowerShell parsing.

A further release blocker is confirmed: the recovered hosted PUBLIC_TOOLS catalogue contains 128 names, while the live service advertises 150 tools. This recovery snapshot must not replace production merely because its version fields now match. Recover and reconcile the newer hosted source first.

The earlier findings below describe the first review; the hosted path limitation and source version mismatch are repaired by this follow-up.

## Recovery and scope
Recovered commit 2f6de5aa0b3b38e9d0695162f6822219bc206865 (Project Relay 0.7.12 unattended recovery), originally on project-relay-v0.7.12-unattended-recovery in Wrekin-Labs/andys-bot-updates.
Created isolated branch repair/relay-0712-readiness-20261108 and worktree C:\Users\andye\ProjectRelayReview20261108 on Andy Home. Original checkout C:\Users\andye\ProjectRelay0712Work was clean and preserved.

The requested Wrekin-Labs/project-relay repository and Actions endpoint returned HTTP 404 through the connected GitHub account. Installed repository search returned no match; Andy Home GitHub CLI is not authenticated. This does not establish that the repository does not exist.
Workflow #295 has NOT been inspected, rerun, or fixed. No claim is made that the defects below caused that run.

Render service project-relay-mcp-gateway (srv-darubf3bc2fs738j1r8g) is configured to track main in Wrekin-Labs/andys-bot-updates, with automatic deployment enabled. This review branch is not that production branch. No production deployment, merge, service setting change, stable release update, workstation installation, credential modification, approval change, or restart was performed.

## Verified fix
The recovered pyproject.toml starts with a UTF-8 BOM. The submission validator read it using utf-8 and failed immediately with "Invalid statement (at line 1, column 1)".
Updated the validator's text reads to utf-8-sig, accepting ordinary UTF-8 and BOM-prefixed UTF-8 without changing validation requirements.
After the fix, validation reaches the next real blocker: missing plugins/project-relay/plugin.json. The recovered package lacks the plugin bundle. Its validator also expects supabase/functions/project-relay-mcp/index.ts, while this recovery snapshot stores hosted code under hosted/project-relay-mcp/index.ts. The snapshot is not a complete submission checkout; do not fabricate missing release metadata or disable checks to pass it.

Added 14 regression/security tests using temporary files, never live approval or owner settings:
- BOM JSON and TOML handling, rejection of non-object manifests.
- Pending, unknown and expired approvals denied.
- Exact approvals usable once only; changed action/device/arguments denied.
- Rejected argument mismatch does not consume the valid approval.
- Corrupt approval store fails closed.
- Missing/malformed/false/string-valued owner settings deny access.
- Malformed allowed-root settings grant no roots.

## Results
| Check | Result | Scope |
|---|---|---|
| Existing unattended recovery tests | 5 passed | Static assertions about scripts, not a boot exercise |
| Added regression/security tests | 14 passed | Windows Python 3.12, isolated temporary state |
| Combined unittest discovery | 19 passed in 0.422 seconds | Recovered package only |
| Python package compilation | COMPILE_OK=True | project_relay directory |
| Submission validator, before fix | Failed on BOM | Reproduced |
| Submission validator, after fix | Blocked by missing plugin.json | Fail-closed behavior retained |
| Public /, /plans, /account, /support, /privacy, /terms | All HTTP 200 | Availability and HTML content type only |
| OAuth discovery and protected-resource metadata | Both HTTP 200 | Availability and JSON content type |
| Unauthenticated MCP initialize | HTTP 200, Project Relay 0.7.11 | Protocol 2025-11-25 request |
| Public tools/list | HTTP 200, 150 tools | Names not compared with inaccessible current repository |
| Unauthenticated list_workstations call | isError=true, OAuth challenge present | No workstation data granted |
| Authenticated live Relay inspection | Successful | Status, workstation list and bounded owner reads/terminal actions |
| Render recent events / filtered error logs | No matching entries returned | Does not disprove edge WAF errors |

Two multi-command terminal requests were rejected at the Render edge with HTTP 403 WAF pages. Request IDs: a574e78f8a8790b8 and a574fecbbf6fb77a. The first blocked request was confirmed absent from terminal output. Other normal MCP calls succeeded, so this is not evidence of a total outage. No firewall rule was disabled or changed. The available Render log results did not identify the rule or cause. These observed errors cannot be attributed to workflow #295 without its actual logs.

## Live version inventory
| Component | Version | State |
|---|---|---|
| Hosted MCP | 0.7.11 | Responding |
| Advertised stable release | 0.7.11 | Reported by get_relay_status |
| Andy Home | 0.7.12 | Online, Owner Full Control enabled |
| Smashroom Studio | 0.7.12 | Online, Owner Full Control enabled |
| DESKTOP-3HOO86A | 0.7.11 | Offline |

Version alignment is NOT complete. Equal version strings alone would not establish equal code. Preserve the installed working applications and reconcile source/build hashes before upgrading hosted metadata or distributing installers.

## Required before release
1. Restore connected access to Wrekin-Labs/project-relay and retrieve the exact workflow #295 URL, run ID, attempt, commit and job logs.
2. Compare that current checkout and its plugin bundle with the recovered 0.7.12 source and the November 7 listener/reliability ZIPs. The ZIPs were located but their contents were not recovered in this review.
3. Reconcile the hosted deployment source, MCP code, manifests and release artifacts against one reviewed commit. Apply this BOM patch only where still needed.
4. Identify why legitimate terminal requests match the edge WAF; obtain rule/log evidence and test a narrowly scoped remedy in staging without weakening authentication or approval gates.
5. Run complete canonical repository tests, dependency vulnerability checks, package/installer validation, and exact live catalogue comparisons.
6. Exercise reboot/reconnect, duplicate-process prevention, watchdog takeover and rollback on a disposable or explicitly scheduled test workstation. Existing recovery tests only assert script contents.
7. Test authenticated non-owner restrictions and owner-role/local-toggle combinations in a separate test account. This review tests local approval behavior and unauthenticated remote rejection, not full tenant isolation.
8. Obtain Andrew's approval for the concrete production deployment, then verify hosted and workstation code/version alignment.

No dependency vulnerability audit, signing verification, destructive recovery test, production upgrade, or complete commercial/security certification is claimed.
