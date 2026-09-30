# KeepGoing v1.2 commercial release status

Status date: 30 September 2026 (UTC)
Release candidate: **1.2.0-beta.24**
Branch: `keepgoing-v1.2-durable-agent`; draft PR: **#49**

## Verified in this continuation

- Reconciled the divergent durable-agent and production beta.23 code without rebasing, force-pushing, or dropping either history. Preserved beta.23 startup recovery, privacy/commerce boundaries, billing safeguards and permission-scoped tools, plus the feature branch's stricter Plugin Directory validator.
- Repaired the malformed/duplicated durable SQL and the merge's duplicate engine test. Added an executed PostgreSQL test (PGlite) for fresh install, reapplication, upgrade with existing rows, reservation idempotency, optimistic locking and denied anon/authenticated CRUD/RPC access.
- Applied Supabase migration `20260930225422_keepgoing_durable_tool_policy_beta24` in the existing KeepGoing project `dbhwjzznwhukoogjewfl`. Added the three tool-policy columns and the extended reservation RPC. Retained the legacy reservation overload for the running service.
- Verified both RPC overloads remain inaccessible to anon/authenticated, all seven KeepGoing tables have RLS and no anon/authenticated table grants, and live service-role reservation/duplicate recovery succeeds in a rolled-back transaction.
- Post-migration advisors report only expected INFO-level no-policy findings for KeepGoing's service-only tables. Unrelated shared-project warnings were not changed.
- Pinned the npm dependency tree in a lockfile and changed CI to `npm ci`.
- Added deterministic ZIP entry timestamps/permissions, package validation before building, SHA-256 checksum and commit provenance alongside the ZIP.
- Added release commit reporting to health/readiness and `preflight --commit=<full SHA>` so a version string cannot substitute for exact-commit deployment proof.
- Readiness now verifies the new database columns. Preflight distinguishes watchdog continuation from the optional webhook path; `--webhook` explicitly requires webhook configuration.
- Added real official-SDK webhook signature, tamper, timestamp expiry and deduplication checks without making paid API calls.

## Current live observations

Production is the existing Render service `srv-daru043bc2fs738hn8l0`, URL `https://keepgoing-mcp.onrender.com`, branch `keepgoing-render`.
A beta.23 deployment from `db12f9fa219d3b626d40f74bebd62edc0a9e633e` became live during this task. This is separate from the beta.24 candidate in PR #49.

The prior production readiness reported durable store/watchdog ready, PayPal live checkout configured, and `openai_webhook_ready=false`. Configuration booleans are not a completed payment test or signed webhook-delivery proof. No purchase or payment was made in this task.

## Release validation evidence

Local regression suite, actual SQL execution and plugin-package validation are required before pushing. Final CI run, artifact checksum and canary deployment IDs are recorded below once observed; do not infer success from this checklist.

## Credentials and publisher gates

- Render exposes service creation/deployment and secret updates through the installed connector, but no safe secret-copy/read operation. A separate canary must receive its own secure OpenAI API key, owner token hash, durable-store proxy token (or approved database credential), OAuth signing secret and OAuth ledger configuration before authenticated tests can run.
- OpenAI Platform rejected the connector target lookup. The Plugin Directory portal was opened and is at sign-in. No publisher account was entered and no legal attestation was accepted.
- Create/select a dedicated reviewer account and enter its credentials only in the secure review form.
- Provide a reviewer-accessible recording of the real authenticated flow. No demo URL is fabricated in the package.
- Complete the portal's actual domain challenge, MCP/skill scan and five positive/three negative cases against the reviewer account.
- Complete identity verification and policy attestations personally. Submit/publish only after all live gates and OpenAI review are complete.

## Submission package

Canonical ZIP source: `keepgoing_mcp_render/plugin/`.
Run `npm run verify`, `npm run test:db`, then `npm run plugin:zip`.
CI uploads the ZIP, checksum and provenance as `keepgoing-plugin-submission`.
The nine-file package contains portable manifests, onboarding skill, listing/checklist and four SVG assets. It contains no reviewer or runtime secrets. Listing/OAuth surfaces remain commerce-neutral and `review.commerce=false`. Initial country: GB.

Current official requirements rechecked:
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/app-review
- https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks

## Merge, publication and rollback

Keep PR #49 draft until exact-commit CI and authenticated canary/reviewer drills pass. Do not claim v1.2 is publicly approved or commercially launched.
Production was not redeployed by this task. Preserve durable data and the legacy reservation RPC. A canary can be disabled without rolling back or deleting live job data.
