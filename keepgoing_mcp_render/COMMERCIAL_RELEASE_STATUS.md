# KeepGoing v1.2 commercial release status

Status date: 1 October 2026 (UTC)
Release candidate: **1.2.0-beta.24**
Branch: `keepgoing-v1.2-durable-agent`; draft PR: **#49**

## Verified in this continuation

- Reconciled the divergent durable-agent and production beta.23 code without rebasing, force-pushing, or dropping either history. Preserved beta.23 startup recovery, privacy/commerce boundaries, billing safeguards and permission-scoped tools, plus the feature branch's stricter Plugin Directory validator. Remote merge commit `fef8d65a27ab120e265969f12206c9850f398eeb` retains original feature head `9000a39bcc60717f35d4c000e3846a43c2026335` and production head `db12f9fa219d3b626d40f74bebd62edc0a9e633e` as parents; PR #49 was observed mergeable and remains draft.
- Repaired the malformed/duplicated durable SQL and the merge's duplicate engine test. Added an executed PostgreSQL test (PGlite) for fresh install, reapplication, upgrade with existing rows, reservation idempotency, optimistic locking and denied anon/authenticated CRUD/RPC access.
- Applied Supabase migration `20260930225422_keepgoing_durable_tool_policy_beta24` in the existing KeepGoing project `dbhwjzznwhukoogjewfl`. Added the three tool-policy columns and the extended reservation RPC. Retained the legacy reservation overload for the running service.
- Verified both RPC overloads remain inaccessible to anon/authenticated, all seven KeepGoing tables have RLS and no anon/authenticated table grants, and live service-role reservation/duplicate recovery succeeds in a rolled-back transaction.
- Post-migration advisors report only expected INFO-level no-policy findings for KeepGoing's service-only tables. Unrelated shared-project warnings were not changed.
- Pinned the npm dependency tree in a lockfile and changed CI to `npm ci`.
- Added deterministic ZIP entry timestamps/permissions, package validation before building, SHA-256 checksum and commit provenance alongside the ZIP.
- Added release commit reporting to health/readiness and `preflight --commit=<full SHA>` so a version string cannot substitute for exact-commit deployment proof.
- Readiness now verifies the new database columns. Preflight distinguishes watchdog continuation from the optional webhook path; `--webhook` explicitly requires webhook configuration.
- Added real official-SDK webhook signature, tamper, timestamp expiry and deduplication checks without making paid API calls.
- Aligned public onboarding, starter prompts and reviewer examples with the server's explicit KeepGoing opt-in and 4,000-character minimal-context rule. Preserved annotation justifications from production.
- CI explicitly checks out the PR head SHA, so tests and artifact provenance cover that exact commit rather than GitHub's synthetic merge commit.

## Current live observations

Production is the existing Render service `srv-daru043bc2fs738hn8l0`, URL `https://keepgoing-mcp.onrender.com`, branch `keepgoing-render`.
A beta.23 deployment from `db12f9fa219d3b626d40f74bebd62edc0a9e633e` became live during this task. This is separate from the beta.24 candidate in PR #49.

Post-migration production readiness was rechecked: `version=1.2.0-beta.23`, `ok=true`, `sell_ready=true`, `commercial_durable_ready=true`, `durable_store_ready=true`, `watchdog_ready=true`, `continuation_mode=watchdog`, PayPal live checkout configured, and `openai_webhook_ready=false`. Configuration booleans are not a completed payment test or signed webhook-delivery proof. No purchase or payment was made in this task.

## Release validation evidence

- Full local regression suite: `npm run verify` passed all 17 test groups and package validation.
- Actual PostgreSQL migration/access tests: `npm run test:db` passed.
- Production-dependency audit: `npm audit --omit=dev` reported zero vulnerabilities at all severities.
- ZIP byte reproducibility was checked after changing input file modification times.
- First reconciled CI: https://github.com/chipblock2/andys-bot-updates/actions/runs/36788601180 — passed on `fef8d65a27ab120e265969f12206c9850f398eeb` before the final exact-head checkout/prompt updates.
- **Final exact-commit evidence is recorded in the PR #49 description after this status commit is pushed:** final head SHA, passing CI run, matching canary deployment and artifact provenance. This document cannot embed its own commit SHA. Do not substitute the earlier green run for the final check.

## Beta.24 canary

Created the separate free-plan Frankfurt service `srv-daup8md9fdbs739qsqp0` on the requested branch, with auto-deploy enabled:
- URL: https://keepgoing-v12-canary.onrender.com
- Dashboard: https://dashboard.render.com/web/srv-daup8md9fdbs739qsqp0
- 1 October: configured the existing narrow durable-store URL and OAuth-code ledger URL on the canary; no secret or billing configuration copied. Environment-only redeploy `dep-dauvu60473hc73cth8hg` is live at `8cc5c0a52c9a91826571d75fd733f2e1e8b25d47`.
- Initial successful deploy: `dep-daup8n59fdbs739qsrtg`, exact commit `fef8d65a27ab120e265969f12206c9850f398eeb`.
- Build runs `npm ci --ignore-scripts`, the full regression suite and SQL execution tests; startup also runs verification.
- Node 24.19.0, v1.2 enabled, owner-canary-only enabled, Relay admin disabled, PayPal sandbox selected. No live payment or production credential was copied.
- Live preflight verified matching health commit/version, canary-origin OAuth metadata, PKCE S256, unauthenticated MCP denial, and public privacy/terms/support/security endpoints.
- **Readiness fails as expected because runtime credentials are absent.** The service is deployed but not a functional authenticated canary. No real job, restart recovery, cross-account reviewer isolation, or signed live webhook-delivery success is claimed.

After secure credential setup, run `npm run preflight -- https://keepgoing-v12-canary.onrender.com --v12 --commit=<final-full-SHA>` (add `--webhook` when webhook registration/signing is configured), then the live drills in `V1_2_ROLLOUT.md`. Verify the exact runtime SHA again after any restart.

## Credentials and publisher gates

- The Render connector supports secret updates but no safe secret-copy/read operation. Configure the canary securely in Render: `OPENAI_API_KEY`, `KEEPGOING_OWNER_TOKEN_HASH`, `KEEPGOING_DURABLE_STORE_URL` plus `KEEPGOING_DURABLE_STORE_TOKEN` (prefer the existing narrow proxy), `KEEPGOING_OAUTH_SECRET`, `KEEPGOING_OAUTH_CODE_URL`, and that ledger's required backend authorization. Configure subscriber auth/billing endpoints only for reviewer/customer validation; keep canary checkout sandboxed. Do not paste secrets into chat or commit them.
- For webhook proof, register the canary `/openai/webhook` endpoint with the Agents-session event stream and set `OPENAI_WEBHOOK_SECRET` in Render. Verify a real signed event and replay rejection. Current local signature tests do not constitute live delivery evidence.
- On 1 October, OpenAI Platform target lookup succeeded for the connected Personal organization / Default project. New-key creation was authorized in chat, but secure local-destination confirmation twice returned `not_approved`; no new key was created or written.
- Publisher sign-in is now successful. The existing KeepGoing entry uses identity `app-6abc15dcb6688191bc5156ae089435dc` and shows Individual — ANDREW ROBERT EASTMENT. No legal attestation was accepted.
- The first CI ZIP upload was rejected because its portable name `keepgoing` did not match this existing identity. Corrected both manifests and the package identity regression check; preserve the existing listing rather than create a duplicate. Portal validation and subsequent exact-commit evidence are recorded in PR #49 as observed.
- Create/select a dedicated reviewer account and enter its credentials only in the secure review form.
- Provide a reviewer-accessible recording of the real authenticated flow. No demo URL is fabricated in the package.
- Complete the portal's actual domain challenge, MCP/skill scan and five positive/three negative cases against the reviewer account.
- Complete identity verification and policy attestations personally. Submit/publish only after all live gates and OpenAI review are complete.

## Submission package

Canonical ZIP source: `keepgoing_mcp_render/plugin/`.
Run `npm run verify`, `npm run test:db`, then `npm run plugin:zip`.
CI uploads the ZIP, checksum and provenance as `keepgoing-plugin-submission`.
ZIP SHA-256: `f1181d6fbe407189e2ac82292c3dec7dab9b142321d87d916090a51167840ab4` (nine entries; 8,403 bytes). Commit provenance is emitted separately as `*.provenance.json`; it must match the final PR head and passing CI artifact.

The nine-file package contains portable manifests, onboarding skill, listing/checklist and four SVG assets. It contains no reviewer or runtime secrets. Listing/OAuth surfaces remain commerce-neutral and `review.commerce=false`. Initial country: GB.

Current official requirements rechecked:
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/app-review
- https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks

## Merge, publication and rollback

Keep PR #49 draft until exact-commit CI and authenticated canary/reviewer drills pass. Do not claim v1.2 is publicly approved or commercially launched.
Production was not redeployed by this task. Preserve durable data and the legacy reservation RPC. A canary can be disabled without rolling back or deleting live job data.
