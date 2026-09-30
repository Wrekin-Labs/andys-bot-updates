# KeepGoing — Plugin Directory submission kit

Version: **1.2.0-beta.24**
Prepared: **30 September 2026**

## Package

Submission source:

`keepgoing_mcp_render/plugin/`

Build/validate:

```bash
npm run plugin:validate
npm run plugin:zip
```

CI also uploads the exact ZIP as the `keepgoing-plugin-submission` artifact.

## Listing

**Display name:** KeepGoing
**Category:** Productivity
**Subtitle:** Finish long AI work

**Listing description**

KeepGoing turns substantial supported work into one durable job that can continue across model turns instead of repeatedly starting over. It preserves a stable job ID, safely continues PARTIAL work within hard limits, recovers missed progress with server-side watchdog and webhook logic, and lets users list, inspect, resume or cancel the same job later.

Jobs can use explicitly approved public-web or MCP tool profiles when configured. KeepGoing does not inherit every connector from the foreground chat, bypass ChatGPT/OpenAI safeguards, or force a new ChatGPT message after a chat turn has ended. If a job genuinely needs authorization, approval, a private-account action or a missing fact, it stops in `input_required` and waits for the user.

## Public URLs

Current beta URLs:

- Website: https://keepgoing-mcp.onrender.com/plugin
- Support: https://keepgoing-mcp.onrender.com/support
- Privacy: https://keepgoing-mcp.onrender.com/privacy
- Terms: https://keepgoing-mcp.onrender.com/terms
- Security: https://keepgoing-mcp.onrender.com/security
- MCP: https://keepgoing-mcp.onrender.com/mcp
- Protected resource metadata: https://keepgoing-mcp.onrender.com/.well-known/oauth-protected-resource
- Authorization server metadata: https://keepgoing-mcp.onrender.com/.well-known/oauth-authorization-server

Replace the temporary Render hostname with the final branded domain before public launch if possible. Update the package and `KEEPGOING_PUBLIC_BASE_URL` together.

## Current plugin commerce rule

KeepGoing’s Plugin Directory surface is **commerce-neutral**.

The current OpenAI plugin rules do not permit selling or promoting digital subscriptions inside a plugin. Therefore:

- plugin metadata contains no prices;
- plugin tools do not initiate checkout;
- plugin pages do not promote upgrades;
- `review.commerce` is false;
- the listing website is the neutral `/plugin` page;
- users may authenticate an existing KeepGoing account and use its existing entitlement;
- the separate developer-operated commercial website is not the plugin checkout flow.

Recheck the live OpenAI rule immediately before submission.

## Authentication

OAuth authorization-code flow with PKCE S256.

Scope:

`keepgoing.jobs`

ChatGPT connects to the universal `/mcp` endpoint. Existing KeepGoing accounts authenticate on KeepGoing’s OAuth page using their private activation credential. The activation credential is not embedded in the MCP URL or plugin ZIP.

The plugin exposes `get_profile` with `_meta["openai/profile"] = true` so connected accounts can be distinguished.

## Main tools

### continue_until_done
Primary entry point when the user explicitly asks KeepGoing to continue or finish substantial work. Generic continuation phrases apply only to authenticated owner mode when advertised by the server.

### start_persistent_job
Starts or idempotently reuses one durable job.

### get_persistent_job
Reads status and latest available output for one owned job.

### wait_for_persistent_job
Waits for a bounded interval on the same job.

### list_persistent_jobs
Lists safe metadata for the authenticated account’s own jobs.

### resume_persistent_job
Supplies missing user input to the same `input_required` job.

### cancel_persistent_job
Cancels the same durable job.

### list_tool_profiles
Lists tool profiles visible to the current account without revealing credentials.

Owner-only profiles may include GitHub and Project Relay tools. They are not expected to be visible to an ordinary reviewer/customer account.

## Tool annotation justifications

These justifications describe the ordinary reviewer/customer profile. Owner-only write-capable profiles are separately permission-gated and are not part of the public reviewer flow.


### get_profile
- readOnlyHint: true — resolves only the already-authenticated KeepGoing account identity.
- openWorldHint: false — accesses only the bounded authenticated KeepGoing account.
- destructiveHint: false — does not create, update, delete, send, or cancel anything.
- idempotentHint: true — repeated reads have no additional effect.

### list_tool_profiles
- readOnlyHint: true — returns only the tool-profile metadata visible to the authenticated account.
- openWorldHint: false — reads KeepGoing's bounded server-side profile catalogue and does not itself contact the external tool providers.
- destructiveHint: false — no external tool is executed and no data is changed.
- idempotentHint: true — repeated listing has no additional effect.
- Privacy/security note: secret authorization values, vault credentials and raw tool arguments are not returned.

### start_persistent_job
- readOnlyHint: false — creates/reserves a durable job and starts provider work.
- openWorldHint: true — the job may access the public web when `allowWeb=true`.
- destructiveHint: false — starts bounded work but does not delete/overwrite user data or complete an irreversible external transaction.
- idempotentHint: false — a stable client request ID enables deduplication, but arbitrary repeated calls can represent separate jobs.

### continue_until_done
- readOnlyHint: false — creates or recovers a durable job and may advance provider work.
- openWorldHint: true — the job may access the public web when allowed.
- destructiveHint: false — does not delete/overwrite user data or complete an irreversible external transaction.
- idempotentHint: false — recovery is idempotent with a stable request ID, but arbitrary repeated calls are not guaranteed to be the same request.

### get_persistent_job
- readOnlyHint: true — reads one authenticated account's durable job state/result.
- openWorldHint: false — reads only bounded private KeepGoing/provider state.
- destructiveHint: false — no state-changing action is performed.
- idempotentHint: true — repeated reads are safe.

### wait_for_persistent_job
- readOnlyHint: true — waits and polls the same durable job; it does not create a replacement or initiate a continuation itself.
- openWorldHint: false — reads only bounded private job/provider state.
- destructiveHint: false — no state-changing action is performed.
- idempotentHint: true — repeated waits are safe.

### list_persistent_jobs
- readOnlyHint: true — lists minimal metadata for the authenticated account's jobs.
- openWorldHint: false — accesses only the bounded authenticated account.
- destructiveHint: false — no state-changing action is performed.
- idempotentHint: true — repeated listing is safe.

### resume_persistent_job
- readOnlyHint: false — sends user-supplied missing information into the same provider session and resumes work.
- openWorldHint: true — resumed work may access the public web if that job was allowed to do so.
- destructiveHint: false — input delivery is idempotency-protected and does not delete/overwrite user data or complete an irreversible external transaction.
- idempotentHint: true — exact repeated input reuses a deterministic provider idempotency key.

### cancel_persistent_job
- readOnlyHint: false — cancels the active durable job/provider turn.
- openWorldHint: false — operates only on the bounded authenticated KeepGoing job.
- destructiveHint: true — cancellation ends the current job and cannot restore that same running provider turn.
- idempotentHint: true — repeated cancellation has no additional destructive effect.

## Durable semantics

Stable states:

- `queued`
- `working`
- `continuing`
- `input_required`
- `completed`
- `failed`
- `cancelled`
- `budget_exhausted`

Each root turn is instructed to end with exactly one marker:

- `STATUS: COMPLETED`
- `STATUS: NEEDS_USER`
- `STATUS: PARTIAL`

KeepGoing verifies provider turn state and tool failures as well as the text marker. An idle session by itself is not considered proof of success.

The server can advance PARTIAL work after the foreground ChatGPT tool call has returned. It cannot independently force a new ChatGPT message to appear; users later retrieve the durable result.

## Package review cases

The exact five positive and three negative cases submitted to OpenAI are stored in:

`plugin/plugin.json`

They are intentionally package-managed so the dashboard and source control stay aligned.

### Positive coverage

1. Start one durable job through `continue_until_done`.
2. Recover an active job in a later chat.
3. Read latest status/result.
4. Resume an `input_required` job.
5. Cancel a durable job.

### Negative coverage

1. Unknown/unowned job ID.
2. Missing authorization/private-account access.
3. Existing running job must not be duplicated.

Run every case against the exact release commit and dedicated reviewer account before submission.

## Reviewer account

Create a dedicated sample account for OpenAI review.

Requirements:

- works immediately;
- sufficient entitlement/quota for all test cases and retries;
- sample/non-sensitive data only;
- no MFA, SMS code, email code, magic-link or private-network dependency unless OpenAI explicitly supports it for review;
- no owner-only GitHub/Relay profile exposure unless that capability is intentionally part of the submitted reviewer flow.

Reviewer credentials and sign-in instructions must be entered in the secure OpenAI review dashboard, **not committed in the ZIP or repository**.

## Demo recording

A reviewer-accessible recording is required before MCP review submission.

Show:

1. Connect KeepGoing through OAuth.
2. Run `continue_until_done`.
3. Show the stable KeepGoing job ID.
4. Demonstrate PARTIAL -> server-side continuation.
5. Open a fresh chat and recover the job with `list_persistent_jobs`.
6. Show completed output.
7. Demonstrate `input_required` -> `resume_persistent_job`.
8. Demonstrate cancellation.
9. Briefly show the neutral plugin page plus Privacy/Terms/Support/Security.
10. Do not show live activation credentials, OAuth tokens, API keys, GitHub tokens, Relay credentials or payment credentials.

## Tool profiles / background tooling

Commercial beta may include owner-only background tooling.

### GitHub worker
- exact repository allowlist;
- read/search/diff;
- safe KeepGoing branch creation;
- conflict-protected file writes;
- pull-request creation;
- no merge/delete/settings/secrets tools.

### Project Relay
- `relay-read`
- `relay-developer`
- optional `relay-admin`, disabled by default.

Project Relay’s OAuth role, approved-root and locally revocable Owner Full Control safeguards still apply.

Ordinary reviewer/customer accounts should see only profiles allowed to them.

## Domain verification

Publish the exact OpenAI challenge token at:

`https://<plugin-domain>/.well-known/openai-apps-challenge`

Return only the exact token as plain text.

## Upload workflow

1. Select the verified OpenAI organization/project and publisher identity.
2. Download the CI `keepgoing-plugin-submission` artifact.
3. Upload the ZIP to the Plugins dashboard.
4. Resolve metadata/skill findings.
5. Connect the declared MCP server.
6. Complete domain verification.
7. Authenticate the MCP connection.
8. Run/inspect the automated MCP tool scan.
9. Fix/rescan any blocking findings.
10. Enter reviewer credentials securely.
11. Add the demo recording URL.
12. Confirm country availability.
13. Submit policy attestations.
14. Submit for review.
15. Publish only after approval.

## Release notes

KeepGoing 1.2 introduces a KeepGoing-owned durable job model on top of OpenAI Agent sessions, automatic multi-turn PARTIAL continuation, watchdog/webhook recovery, cross-chat job recovery, race-safe user-input resume, hard usage budgets, permission-scoped tool profiles, owner-only GitHub/Project Relay background tooling, tool-call audit metadata, live readiness/preflight checks and a portable Plugin Directory package.

## Remaining external gates

- Final publisher/business identity verification.
- Final production domain decision.
- Exact-release authenticated canary and reviewer validation (the durable migration/security checks were completed; see `COMMERCIAL_RELEASE_STATUS.md`).
- OpenAI webhook secret/event registration and real signed delivery proof if enabling the optional webhook path; watchdog continuation remains available without it.
- Least-privilege optional GitHub/Relay credentials.
- Independent website payment-provider live authorization and account-activation testing.
- Dedicated reviewer account.
- Demo recording URL.
- OpenAI domain challenge.
- Plugin ZIP upload and automated findings.
- MCP tool scan/rescan.
- OpenAI review approval.

Repository code can prepare the technical package, but publisher verification, live credentials, payment authorization and OpenAI review require owner/external action.
