# KeepGoing v1.2 commercial release status

Status date: 30 September 2026

## Autonomous build status

The v1.2 commercial-beta code and Plugin Directory package are implemented on `keepgoing-v1.2-durable-agent`.

Completed in the repository:

- Durable multi-turn KeepGoing jobs with stable job IDs.
- PARTIAL / NEEDS_USER / COMPLETED protocol with provider-state validation.
- Webhook and watchdog background continuation.
- Duplicate-start, duplicate-continuation and duplicate-resume protection.
- Latest-turn pagination for long-running sessions.
- Owner-scoped job recovery/listing across chats.
- Bounded attempt/token/tool/wall-clock budgets.
- Durable metadata retention and SQL/RLS security guards.
- Live durable-store readiness checks and owner-only canary rollout mode.
- Permission-scoped MCP tool profiles with policy hashes.
- Tool-call audit metadata without deliberate argument/output logging.
- Private owner GitHub worker with exact repository allowlisting, safe branch writes, code search, diffs and pull-request creation.
- Owner Project Relay read/developer profiles; destructive Relay admin remains explicit opt-in.
- Commerce-neutral ChatGPT plugin product page and OAuth connection copy.
- Portable Agent Plugins package (`plugin.json`, `mcp.json`, onboarding skill).
- New KeepGoing light/dark listing and composer SVG branding.
- Exactly five positive and three negative MCP review cases.
- GB initial publication target and release notes.
- Plugin package validation for final-directory limits, URL rules, icon geometry, color contrast, review materials, credential scanning and no-commerce listing copy.
- Reproducible Plugin Directory ZIP builder and CI artifact configuration.
- Fresh commercial-readiness PR #49 opened as a draft.

## Current OpenAI Plugin Directory requirements reflected in the package

The plugin listing:
- does not advertise pricing, discounts, trials or upgrades;
- does not initiate checkout;
- declares `review.commerce=false`;
- explains that it authenticates existing KeepGoing accounts;
- uses a separate commerce-neutral `/plugin` website URL;
- keeps reviewer credentials outside the ZIP.

The package intentionally omits `review.demo_recording_url` until a real reviewer-accessible recording exists. The OpenAI dashboard can store that scalar field, or a real URL can be added to the package later.

## External / owner gates still required

These are not safe to fabricate or complete without the appropriate owner account, credentials, approval or live environment.

1. **Rebase/update PR #49.** The feature branch continued after merged PR #9 and the new draft PR currently reports a merge conflict against `keepgoing-render`. Resolve with normal Git history maintenance, then rerun CI on the exact resulting head.
2. **Deploy the exact reviewed commit** to the production/staging KeepGoing service.
3. **Apply/review the durable Supabase migration** and run the database/security checks in the intended production project.
4. **Configure live secrets** for v1.2, OpenAI webhook, OAuth/billing backend and any selected GitHub/Relay tool profiles. Never commit them.
5. **Run live preflight/canary drills** including PARTIAL→continuation→COMPLETED, duplicate start, duplicate continuation, NEEDS_USER/resume, restart recovery and missed-webhook watchdog recovery.
6. **Complete OpenAI developer/business identity verification** under the publisher name intended for the directory.
7. **Upload the CI-built Plugin Directory ZIP** in the OpenAI Plugins portal.
8. **Complete the domain-verification challenge** for the production MCP server and wait for the MCP tool scan.
9. **Create a dedicated reviewer account** with sample data and no MFA/email/SMS/private-network dependency; enter those credentials only in the secure OpenAI review form.
10. **Record the reviewer demo** and provide a real accessible recording URL.
11. **Run all five positive and three negative review cases** against the exact reviewer account and deployed server.
12. **Resolve all required automated skill/MCP findings** from the OpenAI portal.
13. **Complete the policy attestations and Submit for review.**
14. **Publish only after OpenAI approval.**

## Merge/publish rule

Do not describe KeepGoing v1.2 as publicly approved or commercially published until the OpenAI review is approved and the owner explicitly publishes it.

Do not merge PR #49 merely because source tests pass. First resolve the branch-history conflict and complete the live canary/preflight matrix.

## Rollback

Keep v1.1 available while v1.2 is staged. If the v1.2 canary fails, disable v1.2 and preserve durable tables/state until active durable jobs have been reconciled.
