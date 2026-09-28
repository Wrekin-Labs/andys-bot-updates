# KeepGoing — Public Plugin Submission Kit

Version: 1.1.0
Prepared: 28 September 2026

## Listing

**Plugin name:** KeepGoing

**Category:** Productivity

**Short description:** Run substantial AI work as a persistent background job and resume the same job without repeatedly restarting it.

**Long description:** KeepGoing helps with substantial model work and research that may outlast a normal chat response. It starts one OpenAI background response, preserves the job ID, and lets ChatGPT check, wait for, resume, or cancel that same job. KeepGoing is designed to reduce repeated “continue” prompts for work routed through its persistent-job tools. It does not control ChatGPT’s private reasoning, bypass product limits, or force a new chat turn after ChatGPT has already ended one.

**Developer name:** Use the exact verified developer/business identity selected in the OpenAI Platform submission portal.

**Website:** https://keepgoing-mcp.onrender.com/
**Support:** https://keepgoing-mcp.onrender.com/support
**Privacy:** https://keepgoing-mcp.onrender.com/privacy
**Terms:** https://keepgoing-mcp.onrender.com/terms
**Security:** https://keepgoing-mcp.onrender.com/security
**MCP server:** https://keepgoing-mcp.onrender.com/mcp

Before final public submission, replace the temporary onrender.com URLs with the final branded production domain and update KEEPGOING_PUBLIC_BASE_URL.

## Authentication

OAuth 2.1 authorization-code flow with PKCE S256.

Protected resource metadata:
https://keepgoing-mcp.onrender.com/.well-known/oauth-protected-resource

Authorization-server metadata:
https://keepgoing-mcp.onrender.com/.well-known/oauth-authorization-server

Scope:
keepgoing.jobs

Customers authenticate with a KeepGoing activation token issued after an active subscription is claimed. ChatGPT receives short-lived bearer access tokens and refresh tokens; the activation token is not embedded in the MCP URL.

## Tools

### start_persistent_job
Starts one OpenAI background response.
- readOnlyHint: false
- destructiveHint: false
- idempotentHint: false
- openWorldHint: true
- OAuth scope: keepgoing.jobs

### get_persistent_job
Reads the current state/output for an existing job.
- readOnlyHint: true
- destructiveHint: false
- idempotentHint: true
- openWorldHint: true
- OAuth scope: keepgoing.jobs

### wait_for_persistent_job
Waits/polls an existing job for a bounded interval.
- readOnlyHint: true
- destructiveHint: false
- idempotentHint: true
- openWorldHint: true
- OAuth scope: keepgoing.jobs

### cancel_persistent_job
Cancels an existing background job.
- readOnlyHint: false
- destructiveHint: true
- idempotentHint: true
- openWorldHint: true
- OAuth scope: keepgoing.jobs

## Starter prompts

1. Use KeepGoing to research this topic thoroughly and keep working on the same job until the result is complete.
2. Start a KeepGoing job for this task and wait for the same job rather than asking me to type continue.
3. Check the status of my existing KeepGoing job and return the result when it finishes.
4. Cancel my current KeepGoing job.
5. Use KeepGoing for a long research task, but stop and tell me exactly what is missing if the work needs credentials or approval.

## Exactly five positive test cases

### Positive 1 — Start a normal persistent job
Prompt: "Use KeepGoing to produce a detailed comparison of heat-pump and gas-boiler running-cost factors in the UK. Definition of done: explain the main variables and give a concise checklist."
Expected:
- Calls start_persistent_job once.
- Receives a job_id.
- Reuses that same job_id for later checks.
- Does not start duplicates simply because the job is still running.

### Positive 2 — Wait on an existing job
Prompt: "Keep waiting for KeepGoing job <valid job_id> and give me the result when it finishes."
Expected:
- Calls wait_for_persistent_job with the supplied ID.
- If should_continue_polling is true, reuses the same ID.
- Returns terminal result when available.

### Positive 3 — Read status without mutation
Prompt: "What is the current status of KeepGoing job <valid job_id>?"
Expected:
- Calls get_persistent_job only.
- Does not cancel or start a new job.
- Returns status and available output.

### Positive 4 — Cancel a running job
Prompt: "Cancel KeepGoing job <valid running job_id>."
Expected:
- Calls cancel_persistent_job for that ID.
- Returns cancelled/terminal state.
- Does not start a replacement job.

### Positive 5 — Needs-user behavior
Prompt: "Use KeepGoing to complete a task that explicitly requires a password I have not supplied."
Expected:
- Background job does not invent or claim access to the password.
- Result ends in NEEDS_USER or otherwise clearly identifies the missing approval/credential.
- No unauthorized external action is claimed.

## Exactly three negative test cases

### Negative 1 — Invalid job ID
Prompt: "Check KeepGoing job definitely-not-a-real-id."
Expected:
- Tool returns a clear error.
- ChatGPT does not fabricate job output.
- ChatGPT does not silently start a new job.

### Negative 2 — Missing/invalid authentication
Scenario: Call MCP without a valid OAuth access token.
Expected:
- HTTP 401.
- WWW-Authenticate challenge points to protected resource metadata.
- No tool executes and no quota is consumed.

### Negative 3 — Duplicate-start avoidance
Prompt: "My KeepGoing job is still running. Continue."
Context includes an existing job_id.
Expected:
- Uses get/wait on the existing ID.
- Must not create another background response merely to continue polling.

## Demo recording plan

Record one short end-to-end demo after the final production domain and paid reviewer account are ready:
1. Install/connect KeepGoing in ChatGPT.
2. Complete OAuth activation.
3. Start a substantial research job.
4. Show the job returning in-progress.
5. Show wait_for_persistent_job reusing the same job_id.
6. Show the completed result.
7. Show get_persistent_job for status.
8. Start a small disposable job and demonstrate cancel_persistent_job.
9. Briefly show Privacy, Terms, Support, and Security pages.

Do not expose a live activation token in the recording.

## Reviewer account

Create a dedicated reviewer subscription/account before submission.
Requirements:
- No MFA, SMS, email confirmation, or private-network dependency for reviewer access.
- Use a disposable reviewer activation token.
- Give the reviewer plan enough quota for all eight submitted tests plus retries.
- Rotate/revoke the reviewer credential after review if no longer required.

## Domain verification

When the OpenAI submission portal generates a challenge token, publish that exact token as plain text at:
https://<final-production-domain>/.well-known/openai-apps-challenge

The endpoint must return only the token for this plugin.

## Availability

Start with United Kingdom during paid beta unless support, tax, payment and legal readiness are confirmed for additional countries. Expand availability deliberately.

## Release notes

Initial public submission of KeepGoing 1.1.0. Adds persistent OpenAI background jobs, same-job polling, cancellation, subscription quotas, OAuth 2.1 + PKCE connection flow, short-lived access/refresh tokens, customer support/privacy/terms/security pages, and accurate MCP tool safety annotations.

## Remaining launch gates

- Authorise live PayPal developer credentials and complete an end-to-end paid subscription/claim.
- Move from the temporary Render subdomain to a branded production domain and re-test OAuth discovery.
- Complete OpenAI developer/business identity verification under the intended publisher name.
- Create reviewer credentials.
- Add OpenAI's generated domain-verification challenge token.
- Record the final demo on the production domain.
- Run Scan Tools in the submission portal and resolve any validation findings.
- Submit for review only after all above gates are green.
