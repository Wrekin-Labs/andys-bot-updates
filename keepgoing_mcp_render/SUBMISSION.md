# KeepGoing — Public Plugin Submission Kit

Version: 1.6.0-beta.2
Updated: 5 October 2026

This is a submission/reviewer worksheet. It contains no passwords, activation tokens, API keys, PayPal credentials, or reviewer secrets.

## Listing

**Plugin name:** KeepGoing

**Package name:** `keepgoing`

**Category:** Productivity

**Short description:** Finish long AI work

**Long description:** KeepGoing preserves substantial AI work as a durable job so ChatGPT can continue, check, resume, and recover the same objective without repeatedly restarting it.

**Developer name:** Use the exact verified individual/business identity selected in the OpenAI Platform submission portal. The manifest currently uses `KeepGoing`; change it before submission if the verified publisher identity differs.

**Website:** https://keepgoing-mcp.onrender.com/plugin  
**Support:** https://keepgoing-mcp.onrender.com/support  
**Privacy:** https://keepgoing-mcp.onrender.com/privacy  
**Terms:** https://keepgoing-mcp.onrender.com/terms  
**Security:** https://keepgoing-mcp.onrender.com/security  
**MCP server:** https://keepgoing-mcp.onrender.com/mcp

**MCP URL type:** Universal

**Authentication:** OAuth 2.1 authorization-code flow with PKCE S256.

**Custom ChatGPT UI:** none. Do not submit starter-prompt screenshots unless a future tool scan reports a UI output template.

## Starter prompts

1. `Use KeepGoing to finish this substantial job until it is complete.`
2. `Use KeepGoing to continue this objective without restarting completed work.`

Both are one-line prompts below the final-submission length limit and contain no MCP @mention.

## Authentication

Protected resource metadata:
https://keepgoing-mcp.onrender.com/.well-known/oauth-protected-resource

Authorization-server metadata:
https://keepgoing-mcp.onrender.com/.well-known/oauth-authorization-server

Scope:
`keepgoing.jobs`

Existing KeepGoing account holders authenticate with a private activation token on KeepGoing's OAuth page. ChatGPT receives short-lived OAuth credentials; the activation token is not embedded in the MCP endpoint URL.

## Public-directory commerce boundary

The submitted ChatGPT plugin is for existing KeepGoing accounts. The plugin listing and plugin-facing website do not:

- display subscription-plan cards or prices;
- initiate a new digital-service subscription;
- link to a transactional checkout route;
- promote an upgrade inside ChatGPT.

KeepGoing may explain that a requested feature is unavailable under the user's existing entitlement. The separately hosted `/subscribe` route is an off-plugin direct web route; it is intentionally excluded from the plugin website navigation, install page, FAQ/status navigation, sitemap, and plugin metadata, and is marked noindex/no-store.

## Coding workspace boundary

Beta.23 adds an opt-in coding workspace for code tasks.

When `codingWorkspace=true`, KeepGoing creates an isolated OpenAI-hosted sandbox. If a public GitHub `repositoryUrl` and optional `repositoryRef` are provided, the repository is cloned into `/workspace/project` before provider work begins.

Reviewer expectations:
- public `https://github.com/owner/repo` repositories only;
- repository locator/ref validation happens before session creation;
- this release does not support private-repository access or remote repository writes;
- edits and tests happen inside the isolated workspace;
- outbound sandbox networking is restricted to common source/package hosts;
- local Bash/apply-patch operations do not consume the 3/5 external web/MCP/function-call allowance;
- failed shell work still prevents false completion;
- coding sandbox wall limits are Pro 30 minutes and Business/owner 60 minutes.

### Selected-file handoff

Beta.24 can accept an explicitly selected set of task-relevant UTF-8 text files through `workspaceFiles` when `codingWorkspace=true`.

Review boundary:
- maximum 8 files;
- maximum 32 KB per file and 128 KB total;
- safe relative paths only;
- selected files are copied into `/workspace/project` after any public-repository checkout;
- high-risk key/config filename patterns are rejected;
- validation happens before quota reservation;
- KeepGoing durable job storage remains metadata-only; selected file bodies are not stored there;
- this does not grant arbitrary desktop/filesystem access.

## Tool annotation justifications

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

### list_job_artifacts
- readOnlyHint: true — lists immutable metadata for published output files belonging to the authenticated job.
- openWorldHint: false — reads only bounded provider state for that owned KeepGoing job.
- destructiveHint: false — does not modify or delete artifacts.
- idempotentHint: true — repeated listings have no additional effect.

### read_job_artifact
- readOnlyHint: true — retrieves a bounded text artifact already published by the authenticated job.
- openWorldHint: false — reads only bounded provider state for that owned KeepGoing job.
- destructiveHint: false — does not modify or delete the artifact.
- idempotentHint: true — repeated reads have no additional effect.

### get_job_report
- readOnlyHint: true — returns a deterministic summary of the authenticated account's own job (status, progress, budget diagnostics, checksummed result excerpt, artifact manifest, next step).
- openWorldHint: false — reads only KeepGoing durable state and bounded provider state for that owned job.
- destructiveHint: false — never starts, changes, cancels or deletes anything.
- idempotentHint: true — repeated calls against an unchanged job return identical output.

### resume_persistent_job
- readOnlyHint: false — sends user-supplied missing information into the same provider session and resumes work.
- openWorldHint: true — resumed work may access the public web if that job was allowed to do so.
- destructiveHint: false — input delivery is idempotency-protected and does not delete/overwrite user data or complete an irreversible external transaction.
- idempotentHint: true — exact repeated input reuses a deterministic provider idempotency key.

### cancel_persistent_job
- readOnlyHint: false — cancels the active durable job/provider turn.
- openWorldHint: false — operates only on the bounded authenticated KeepGoing job.
- destructiveHint: true — cancellation ends the current job (including one waiting for input) and cannot restore that same running provider turn; a cancelled job can never be resumed or continued.
- idempotentHint: true — repeated cancellation has no additional destructive effect.

## Exactly five positive review cases

### Positive 1 — start a durable job

Prompt:
`Use KeepGoing to research three documented ways to reduce cold-start latency in a Node web service and finish with a short comparison.`

Expected:
- selects `continue_until_done` or `start_persistent_job`;
- returns one stable `job_id`;
- the job enters a valid durable state;
- a retry with the same stable request identity reuses the same reservation/provider start.

Expected start result:
`{ job_id, status, duplicate?, message }`

### Positive 2 — check one job

Prompt:
`Check the KeepGoing job <review fixture job id>.`

Expected:
- calls `get_persistent_job`;
- returns only the authenticated review account's fixture job;
- returns `job_id`, `status`, `output`, `error`, and bounded progress metadata.

### Positive 3 — coding workspace against a public GitHub fixture

Prompt:
`Use KeepGoing to inspect the public GitHub repository chipblock2/project-relay on branch main, make one small code-quality improvement locally, run an appropriate test, and report the result. Use the coding workspace.`

Expected:
- calls `continue_until_done` or `start_persistent_job` with `codingWorkspace: true`;
- passes the public GitHub repository URL and safe ref;
- the hosted sandbox clones the repo into `/workspace/project`;
- the Agent may read/edit/test the real files locally;
- no private-repository or push capability is used;
- local shell commands do not consume the external web/MCP/function-call allowance.

### Positive 4 — recover in a new chat

Prompt:
`Use KeepGoing to list my active jobs so I can recover the one I started earlier.`

Expected:
- calls `list_persistent_jobs`;
- returns only the authenticated review account's minimal job metadata;
- does not return raw prompts or another user's jobs.

### Positive 5 — required input and resume

Fixture:
Start a review job whose explicit definition of done requires one harmless user-supplied code word before it can finish.

Prompt after the job reaches `input_required`:
`Resume job <fixture job id> with the code word ORANGE.`

Expected:
- calls `resume_persistent_job`;
- resumes exactly the same job ID;
- repeated identical delivery is idempotency-protected;
- a different input while an earlier delivery is unresolved is rejected safely.

## Exactly three negative review cases

### Negative 1 — no generic public hijack

Prompt:
`Continue.`

Expected on a normal public/reviewer account:
- KeepGoing should not be selected solely from the generic phrase unless the conversation already clearly invokes KeepGoing.
- It must not hijack unrelated continuation requests.

### Negative 2 — cross-account job access

Prompt:
`Get job <fixture belonging to another test account>.`

Expected:
- returns a not-found style error;
- does not reveal whether another account/job exists;
- returns no metadata or output from another account.

### Negative 3 — unsupported connected-account action

Prompt:
`Use KeepGoing to read my Gmail and send a reply for me.`

Expected:
- KeepGoing must not claim it directly controls Gmail or another ChatGPT connector;
- the durable engine must only use capabilities actually exposed to that job;
- if the required private account action is unavailable, it reports the limitation or requests the appropriate host-side action rather than inventing access.

## Release notes

Initial public-directory submission candidate.

KeepGoing provides durable AI jobs that can continue bounded multi-turn work, survive chat changes, recover by job ID, pause for genuine user input, and resume the same job without repeatedly restarting completed work.

1.5.0-beta.1 adds, on top of beta.24:

- owner binding for legacy-engine jobs (cross-account read/cancel is refused);
- race-safe cancellation that also stops in-flight continuations, and no resurrection of finished jobs;
- argument-bound start idempotency when no client request id is supplied;
- deterministic, checksummed artifact manifests and the read-only `get_job_report` tool;
- client-safe error messages with support references, structured logs, rate limits and active-job caps.

Beta.24 includes:

- opt-in coding workspace for public GitHub repositories, with local file inspection/edit/test support;
- bounded selected-file handoff for task-relevant local/uncommitted text files;
- restricted sandbox networking and strict repository URL/ref validation;
- watchdog recovery;
- deterministic/idempotent initial-session startup;
- retry and metadata recovery for transient provider-start failures;
- duplicate suppression and compare-and-set continuation claims;
- bounded attempt/token/tool/wall-clock budgets;
- OAuth/PKCE and owner-scoped durable storage;
- minimal tool result shapes;
- full regression tests before production startup;
- plugin-facing commerce-boundary hardening;
- final-directory metadata fixes including support URL, short-description length, and accessible light/dark brand colors.

## Reviewer demo recording plan

Record one short end-to-end demo after reviewer credentials and the submission draft are ready:

1. Connect KeepGoing in ChatGPT through OAuth using the dedicated reviewer account.
2. Start one substantial durable job.
3. Show the stable KeepGoing job ID.
4. Show the same job progressing without duplicate creation.
5. Open a fresh chat and use `list_persistent_jobs` to recover it.
6. Show completed output with `get_persistent_job`.
7. Demonstrate an `input_required` fixture and `resume_persistent_job`.
8. Start a disposable active job and demonstrate `cancel_persistent_job`.
9. Briefly show the public Privacy, Terms, Support, Security, and service-status pages.

Never expose an activation token, OAuth token, API key, durable-store service key, or live payment credential in the recording.

## Reviewer account

Create a dedicated pre-provisioned reviewer account before submission. Reviewers must not need to purchase anything through ChatGPT.

Requirements:
- no MFA, SMS, email-confirmation, or private-network dependency;
- a reviewer credential that is already provisioned and ready to use;
- enough quota for all submitted tests plus reasonable retries;
- access limited to that review account's own jobs;
- rotate/revoke the reviewer credential after review if no longer required.

Do not commit the reviewer credential to this repository.

## Domain verification

When the OpenAI submission portal provides the challenge token, publish that exact token as plain text at:

`https://keepgoing-mcp.onrender.com/.well-known/openai-apps-challenge`

The endpoint is already implemented and uses `OPENAI_APPS_CHALLENGE`. The challenge value must come from the submission portal and should be set in production environment configuration, not committed to source.

## Availability

Initial commercial-beta submission: United Kingdom only unless support, legal, payment/tax, and operational readiness are confirmed for additional regions.

## External submission gates

The following require the OpenAI submission portal or a user-controlled identity/reviewer workflow and cannot be truthfully marked complete from the source repository alone:

1. Use an eligible OpenAI Platform organization/project with global data residency.
2. Confirm the submitter has Apps Management write permission.
3. Complete individual or business verification for the exact publisher identity.
4. Create a `With MCP` plugin draft and select the Universal MCP URL type.
5. Supply dedicated reviewer credentials that work without MFA/SMS/email confirmation/additional setup.
6. Select Scan Tools against the production MCP endpoint and verify the 1.5.0-beta.1 metadata (eleven tools for durable accounts, including `get_job_report`).
7. Paste the annotation justifications above into the submission form.
8. Complete the generated domain-verification challenge.
9. Provide the required demo-recording URL.
10. Enter exactly the five positive and three negative tests above, replacing fixture placeholders with reviewer fixture IDs.
11. Choose the intended countries/regions.
12. Complete policy attestations only after the scanned production build and review materials match.
13. Submit for review. Submission begins review; public publication is a separate post-approval action.

## Production release evidence required for beta.23

Before submission, capture fresh evidence from the exact beta.23 production commit:

This evidence predates 1.5.0-beta.1. Re-run these checks (and `npm run preflight -- --v12 --release=1.5.0-beta.1`) on the 1.5 deployment before using this kit for submission.
