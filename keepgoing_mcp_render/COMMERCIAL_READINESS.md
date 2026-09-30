# KeepGoing commercial readiness — 30 September 2026

## Target product

KeepGoing is a ChatGPT/Codex Plugin Directory product backed by a durable MCP service.

The product has two deliberately separate surfaces:

1. **Plugin surface** — commerce-neutral. Users connect an existing KeepGoing account and use durable jobs. No plan prices, checkout, upgrade prompts or subscription initiation are exposed through plugin metadata/tools.
2. **Independent commercial website** — the developer-operated website may sell KeepGoing access outside the plugin experience, subject to applicable law and payment-provider rules.

This split follows the current OpenAI plugin commerce policy for digital subscriptions: published plugins may let users sign in to an existing paid account, but must not sell or promote digital subscriptions inside the plugin.

## Current code status

Version: **1.2.0-beta.2**

Branch: `keepgoing-v1.2-durable-agent`

### Durable engine — implemented
- Stable KeepGoing-owned `kgj_...` job IDs.
- OpenAI Agents session backend.
- Multi-turn PARTIAL continuation.
- COMPLETED / NEEDS_USER / PARTIAL validation.
- Durable Supabase state with optimistic versioning.
- Duplicate-start protection.
- Idempotent continuation delivery.
- Race-safe user-input resume.
- Token/tool/attempt/wall-clock budgets.
- Repeated-output loop protection.
- Signed OpenAI webhook processing.
- Webhook event deduplication.
- Watchdog recovery after missed events.
- Lost initial-session acknowledgement recovery.
- Long-session latest-turn paging.
- Owner-scoped job reads/list/cancel/resume.
- Bounded retention cleanup.
- Live durable-store readiness probe.

### Background tools — implemented
- Per-job tool profile selection.
- Public web-only default profile.
- Explicit MCP `allowed_tools` allowlists.
- Tool-policy hash persisted with each durable job.
- Write-capable profiles restricted to owner accounts.
- Safe tool-call audit metadata; arguments/results are not deliberately stored.

#### Built-in private GitHub worker
- Separate server-side bearer secret from customer OAuth.
- Exact repository allowlist.
- Read/list/search/diff tools.
- Safe branch creation under configurable `keepgoing/` prefix.
- UTF-8 file writes with expected-SHA conflict protection.
- Pull-request creation.
- No merge-PR, repository-delete, repository-settings or secret-management tool.

#### Built-in Project Relay profiles
- `relay-read` — diagnostics/files/search/process/window/status reads.
- `relay-developer` — approved-root edits, preview/apply transactions, bounded commands/sandbox/terminal/supervised-app actions.
- `relay-admin` — destructive Windows/software/power actions; **disabled unless explicitly enabled**.
- Project Relay keeps its own OAuth owner routing and locally revocable Owner Full Control boundary.

### Staged rollout — implemented
- `KEEPGOING_V12_ENABLED`
- `KEEPGOING_V12_CANARY_ONLY`
- Owner account can exercise v1.2 while ordinary subscribers remain on v1.1.
- Legacy v1.1 quota charging remains correct during canary mode.

## Plugin Directory package — implemented

Package location:

`keepgoing_mcp_render/plugin/`

Included:
- portable `plugin.json`;
- one remote MCP in `mcp.json`;
- onboarding skill;
- light/dark listing logo;
- light/dark composer icon;
- exactly five positive review cases;
- exactly three negative review cases;
- UK initial publication targeting;
- release notes;
- commerce=false declaration.

Listing:
- **Display name:** KeepGoing
- **Subtitle:** Finish long AI work
- **Category:** Productivity
- **Website:** `/plugin` commerce-neutral product page
- Support / Privacy / Terms / Security pages linked separately.

The package intentionally contains:
- no checkout URL;
- no price;
- no upgrade prompt;
- no reviewer credentials;
- no API keys/tokens.

## Branding/product design — implemented

Brand direction:
- dark productivity/engineering aesthetic;
- primary violet `#5F50E6`;
- dark-theme violet `#A99FFF`;
- mint motion accent;
- continuous-loop + forward-motion mark.

Product promise:
**Long AI work, without the constant “continue”.**

Commercial website now presents:
- clear hero/value proposition;
- durable-job lifecycle;
- reliability/security proof;
- tool-profile boundary;
- pricing/checkout on the independent website;
- separate “already have access” route into the commerce-neutral plugin surface.

## Automated release gates — implemented

`npm run verify` covers:
- syntax;
- state machine;
- Agents API integration;
- long-turn paging;
- durable orchestration;
- duplicate/race protection;
- tool profiles;
- private GitHub worker;
- tool audit;
- Supabase durable store;
- webhook processor;
- watchdog;
- server-side continuation without foreground polling;
- service API;
- source/security guards;
- SQL RLS/grants/functions;
- deployment preflight;
- plugin package validation.

Plugin package:
- `npm run plugin:validate`
- `npm run plugin:zip`

GitHub Actions:
- validates code and plugin package;
- builds a reproducible `keepgoing-plugin-<version>.zip`;
- uploads the ZIP as a CI artifact.

## Production environment for v1.2

Core:
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `KEEPGOING_AUTH_URL`
- `KEEPGOING_CLAIM_URL`
- `KEEPGOING_BILLING_INGEST_URL`
- `KEEPGOING_BILLING_INGEST_TOKEN`
- `KEEPGOING_CONFIG_URL`
- `KEEPGOING_OWNER_TOKEN_HASH`
- `KEEPGOING_OAUTH_SECRET`
- `KEEPGOING_OAUTH_CODE_URL`
- `KEEPGOING_PUBLIC_BASE_URL`

Durability:
- `KEEPGOING_V12_ENABLED=true`
- `KEEPGOING_V12_CANARY_ONLY=true` for owner canary
- durable Supabase direct credentials **or** durable-store proxy credentials
- `OPENAI_WEBHOOK_SECRET`

Private GitHub worker, optional:
- `KEEPGOING_WORKER_MCP_SECRET`
- `KEEPGOING_GITHUB_TOKEN`
- `KEEPGOING_GITHUB_REPOS=owner/repo,...`
- optional `KEEPGOING_GITHUB_BRANCH_PREFIX=keepgoing/`

Project Relay, optional:
- `KEEPGOING_RELAY_MCP_URL`
- one of:
  - `KEEPGOING_RELAY_MCP_CREDENTIAL_ID`
  - `KEEPGOING_RELAY_MCP_AUTHORIZATION`
- optional destructive admin profile:
  - `KEEPGOING_ENABLE_RELAY_ADMIN_PROFILE=true`

## Required live canary

Run with:
- v1.2 enabled;
- canary-only enabled;
- owner account;
- ordinary subscriber test account still on v1.1.

Must verify:

1. Single-turn completion.
2. PARTIAL -> exactly one continuation -> completion.
3. Duplicate reconciliation does not duplicate a turn.
4. Lost continuation acknowledgement reuses the same idempotency key.
5. Duplicate start consumes one allowance.
6. Missed webhook repaired by watchdog.
7. NEEDS_USER -> same-job resume.
8. Cross-account job access returns not found.
9. Active token/tool/wall-clock budget enforcement.
10. Process restart while job active.
11. `list_persistent_jobs` recovers work in a fresh chat.
12. GitHub-read profile reads only allowlisted repos.
13. GitHub-write profile can create safe branch/edit/open PR, but cannot merge or write to default branch.
14. Relay-read works against linked owner workstation.
15. Relay-developer respects Relay local Owner Full Control and approved-root boundaries.
16. Relay-admin remains absent unless explicitly enabled.
17. Tool audit contains tool name/server/status only, not arguments/results.
18. Plugin MCP tool scan shows correct annotations and OAuth security schemes.

## Current OpenAI Plugin Directory rules that affect launch

At submission time:
- portable `plugin.json` and remote `mcp.json` are supported;
- public MCP must be stable HTTPS;
- OAuth is expected for user-specific/private actions;
- listing requires product/support/privacy/terms HTTPS URLs;
- logo/icon required for submission;
- initial MCP review requires five positive and three negative test cases;
- reviewer credentials are entered separately in the dashboard;
- demo recording is required for MCP review;
- digital subscriptions may **not** be sold or promoted inside the plugin;
- existing paid users may authenticate and use existing entitlements.

Recheck these rules immediately before submission because platform policy can change.

## External launch gates still open

These cannot be completed purely by repository code:

1. **Production domain**
   - Recommended: branded KeepGoing domain instead of temporary Render hostname.
   - Update `KEEPGOING_PUBLIC_BASE_URL`, PayPal webhook, plugin package URLs and OAuth/domain verification together.

2. **OpenAI publisher identity**
   - Verify the organization/business identity intended to appear in the directory.
   - Submission requires appropriate Apps/Plugins write permission.

3. **Production durable database**
   - Apply/review the durable schema.
   - Run database/security advisors.
   - Verify RLS and service-role-only access.

4. **OpenAI webhook**
   - Create the production webhook.
   - Store `OPENAI_WEBHOOK_SECRET`.
   - Verify signed real events.

5. **Tool credentials**
   - Create least-privilege GitHub token for only the intended repositories.
   - Prefer Agents Vault credential for Relay where appropriate.
   - Never commit either credential.

6. **Payments**
   - Finish live payment-provider credentials and end-to-end account activation on the independent website.
   - Do not expose the subscription purchase flow in the ChatGPT plugin.

7. **Reviewer account**
   - Dedicated sample account with enough entitlement for all cases.
   - No MFA/SMS/email-code/private-network dependency.
   - Enter credentials only in the secure review dashboard.

8. **Demo recording**
   - Record all important reviewer flows.
   - Do not expose tokens/secrets.
   - Provide accessible recording URL.

9. **Domain verification**
   - Publish the exact OpenAI challenge token at `/.well-known/openai-apps-challenge`.

10. **Upload / scan / review**
    - Upload the CI-built plugin ZIP.
    - Connect the MCP server.
    - Resolve metadata and tool scan findings.
    - Run all reviewer cases against the exact release.
    - Submit policy attestations.
    - Publish only after approval.

## Commercial definition of done

KeepGoing is commercially launch-ready when:
- the exact release commit is green in CI;
- the CI-built plugin ZIP passes OpenAI package checks;
- v1.2 canary/live durability tests pass;
- plugin tool scan has no blocking findings;
- publisher/domain identity is verified;
- reviewer account/video are accepted;
- independent billing is live and tested;
- plugin remains commerce-neutral;
- OpenAI review is approved.

Code can prepare every technical part, but OpenAI review, publisher verification, payment authorization and final live credentials require owner/external approval.
