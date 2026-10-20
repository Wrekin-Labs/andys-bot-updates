# Hermes versus OpenClaw — source review and evaluation status

Date: 20 October 2026. Version targets: Hermes v0.22.2 and OpenClaw v2026.10.5.

## Decision

Keep Hermes as the first runtime candidate, with OpenClaw as the comparison.
Neither has passed a full local runtime evaluation in this workspace. Do not
treat source inspection or our own prototype tests as a passing score for either
upstream project.

The projects already implement substantial memory, approval and recovery
machinery. Prefer a thin integration and acceptance tests over recreating a
general-purpose runtime in Jarvis.

## Evidence inspected at release refs

| Area | Hermes | OpenClaw | Consequence for Jarvis |
| --- | --- | --- | --- |
| Runtime | pyproject.toml accepts Python >=3.11,<3.15, but comments specify 3.14 as the supported managed interpreter and gate core dependencies on it | package.json identifies 2026.10.5 and Node >=24.16.0,<25 or >=26.1.0 | This workspace's Python 3.12 is not the intended Hermes managed environment; Node 24.19 meets OpenClaw's declared engine range, but dependencies are not installed |
| Memory | memory_tool_store.py uses bounded file-backed entries, injection scanning, unique-match guards and write refusal when existing data cannot be read | Not inspected deeply enough in this pass to score | Test correction, deletion and ambiguity; persistence alone does not prove accurate recall |
| Approvals | approval_context.py uses context-local session identity and separate interactive, cron and unattended contexts | approval-scope.ts describes message recipients, payments, publishing and standing grants; tests cover display spoofing and bounded previews | A useful preview is only one layer; verify actual authority, owner binding and policy at dispatch |
| Recovery | Tests exist for stale-running claims and losing ownership during delivery | delivery-recovery.shared.ts checks not-sent evidence, nested retry errors, backoff, claims and authoritative reloads | A transport error must not automatically mean an action failed; uncertain sends need reconciliation |
| Test evidence | Inspected memory and cron test definitions | Inspected approval-display and recovery test definitions | Presence and readability of tests are evidence of intended behaviour, not proof those suites passed here |

No upstream source was executed, installed, copied into Jarvis, or connected to a
real account during this comparison. The full dependency stacks and Windows
runtime checks remain outstanding. A temporary failure fetching recursive trees
was handled by reading bounded directories and source files.

## Source links

Hermes:
- [Runtime declaration](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/pyproject.toml)
- [Memory store](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/tools/memory_tool_store.py)
- [Approval context](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/tools/approval_context.py)
- [Memory tests](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/tests/tools/test_memory_tool.py)
- [Stale-running tests](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/tests/cron/test_stale_running_recovery.py)
- [Delivery ownership tests](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/tests/cron/test_fire_claim_lost_after_delivery.py)

OpenClaw:
- [Runtime declaration](https://github.com/openclaw/openclaw/blob/v2026.10.5/package.json)
- [Approval scope](https://github.com/openclaw/openclaw/blob/v2026.10.5/src/infra/approval-scope.ts)
- [Approval display tests](https://github.com/openclaw/openclaw/blob/v2026.10.5/src/infra/approval-scope.test.ts)
- [Delivery recovery](https://github.com/openclaw/openclaw/blob/v2026.10.5/src/infra/delivery-recovery.shared.ts)
- [Recovery tests](https://github.com/openclaw/openclaw/blob/v2026.10.5/src/infra/delivery-recovery.shared.test.ts)

Release refs provide reproducible targets but should be resolved to immutable
commit SHAs when installations are prepared. No claim is made about the entire
security posture from this bounded source review.

## Runnable progress in our own prototype

Added demo.py and test_demo.py, plus DEMO.md. The existing ledger and the new
process-level checks pass **14 tests** under Python 3.12.14 in this Linux
workspace. Windows runtime testing remains outstanding.

The integration checks launch separate Python processes and demonstrate:
1. A synthetic task waits for approval, completes once, and rejects a repeat.
2. A simulated action writes its fake-provider record, then exits before local
   completion is recorded. A fresh process recovers the task as unknown and
   refuses another dispatch. The fake-provider operation count stays at one.

These tests use only synthetic local files. They do not test a real Hermes,
OpenClaw, mail, phone, LLM or workstation adapter.

## Next runtime trial

Use evaluation-cases.json as a shared scenario list. Record each case separately
for each pinned runtime as pass, fail, blocked or not_run, with observed evidence.
No aggregate score is meaningful while the runtime cases remain not_run.

Prepare separate homes and credentials-free configurations. Enable fake adapters
only. Obtain owner identity from the trusted interface rather than a model-supplied
field. Verify the exact existing Windows Jarvis installation before integrating
any runtime, and retain its current settings and databases.
