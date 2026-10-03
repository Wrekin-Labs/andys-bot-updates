# DeskRoute 6.1.0-rc.1

Updated 3 October 2026. **Not approved for general commercial launch.**

## Completed and verified

- New source implements the retrieved Figma designs for Inbox, Human Queue, Business Brain, Automations, Analytics, Channels, Team and Settings, with mobile navigation.
- PWA manifest, icons and public-shell-only service worker; customer/API/auth responses are excluded from the cache.
- Public Help Centre displays only published articles returned by a scoped public RPC.
- Fifteen commercial website/documentation pages; all local links and assets across 17 HTML pages pass the link checker.
- Ten API tests pass: refresh bearer retry, single concurrent refresh, sign-out during refresh, rejected refresh, empty mutation, permission error, anonymous help, stale workspace response, immediate local logout, temporary refresh failure.
- JavaScript syntax checks pass.
- Supabase migration `deskroute_v61_scoped_support_workflows` successfully applied to project `dbhwjzznwhukoogjewfl`.
- Post-migration database regression passed in a transaction that was rolled back. Synthetic tests cover reply idempotency, private notes and mentions, workspace/role boundaries, unsupported-channel rejection, cross-org message foreign keys, analytics scope, team lookup and published-only anonymous help.
- Fixed form action buttons accidentally submitting replies, added submission guards, discarded stale workspace/session responses and cleared local auth before waiting for logout.
- Built a synthetic `/qa/` demo for preview only. Its API adapter makes no network calls and CSP blocks network connections. Demo mutations remain in memory.
- Source pushed to GitHub release branch at `b07edb6`. GitHub Actions run `37112388854` completed successfully and produced the preview artifact.
- Live HTTP smoke checks passed: unknown public help key returns 200/null; anonymous website-reply RPC returns 401.
- Existing production widget JavaScript is byte-for-byte identical to the repository snapshot.
- Confirmed zero regression fixture workspaces remain in the database.

## Verification still required

| Flow | Evidence obtained | Remaining gate |
| --- | --- | --- |
| Sign-in/session | Ten API unit cases | Real sign-in and browser session recovery |
| Inbox and conversation | Implemented; mutation database tests | Browser navigation and incoming-message refresh |
| Website reply | Atomic RPC and deduplication tested | HTTP widget receive/sync test with isolated fixtures |
| Internal note and mention | Transaction/privacy query and access tests | Browser/widget test showing note never reaches visitor |
| Known approved answer | Existing backend carried forward | Isolated live HTTP answer regression |
| Unknown question | Existing gap/assignment backend carried forward | Isolated live HTTP gap, assignment and alert regression |
| Business Brain | UI and scoped DB operations implemented | Browser create/edit/approve/reject and learned FAQ tests |
| AutoSetup | Request contract reviewed | Authorised staged website scan and returned proposals |
| Alerts | API wiring implemented | List/read/open and multi-device behaviour |
| Analytics | Scoped SQL regression passed | Browser rendering and period cross-check |
| Mobile/desktop/PWA | Responsive CSS and manifest implemented | Screenshots at 360/390/768/1024/1440, install/offline/focus checks |
| Help Centre | Publication SQL regression passed | Anonymous HTTP and browser publication/search test |
| Commercial site/docs | Local link/asset checks pass | Visual, keyboard and mobile review |

## Current external blockers

- Cloud browser rejects the local preview with `ERR_BLOCKED_BY_CLIENT`; this is a browser access failure, not an application failure. No screenshot audit has been claimed.
- Product Design requires permission before using a local Playwright browser as a fallback. Cloud preview is preferred if available.
- Render connector has no existing-service build configuration update operation. Dashboard for the existing preview redirects to sign-in. An authenticated Render dashboard is needed to change the existing preview build configuration.
- Figma Starter quota prevented retrieving Help Centre frame `2:251`. Exact comparison for that screen remains unverified; do not bypass the quota.
- KeepGoing jobs `kgj_bf7afc6f6ccd4e13b996d50e32c8bf59` and `kgj_dae19a5fecea4f759f126328d4b58854` failed with “The model run failed.” Neither is working in the background.

## Commercial scope

Website chat is the release reply path. Do not advertise paid checkout, other provider channel delivery, time-based scheduler execution, closed-app push or app-store packages as verified. Confirm the public sales/support contact, pricing, support hours, privacy/data-processing terms and retention policy before a paid public launch. The preview contains no invented prices, testimonials or SLA.

## Production protection

The existing Smash Room widget and WordPress installation are unchanged. ERUK remains staged/off. No production customer test conversation was created. Do not deploy the synthetic demo as the production control panel. Existing Home-PC uncommitted changes are preserved in their original checkout.
