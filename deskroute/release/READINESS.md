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
- Existing production widget JavaScript matched the original repository snapshot before this pass. Mobile accessibility improvements to the widget source are pending deployment.
- Confirmed zero regression fixture workspaces remain in the database.

## 3 October website and browser test pass

- **41 browser checks passed** on the synthetic preview: replies, private notes, conversation chronology, incoming messages without lost drafts/focus, all navigation pages, fact approval/creation, help publication, automation creation/enabling, notification read/open, preference saves, staged scan proposals, unsupported-channel restriction, mobile menu/back navigation, and widget send/receive/close/reopen.
- App widths checked: 360, 390, 768, 1024 and 1440 pixels. Widget widths: 360, 390 and 1440. Desktop/mobile screenshots reviewed. This is not a full accessibility certification or physical-device install test.
- **22 API/handler tests passed**: ten session/API cases, seven answer-policy cases, five actual Edge-handler cases using in-memory database/provider adapters.
- Replaced broken HTML error pages saved as SVG navigation assets with licensed Lucide icons. Included Inter and Lucide licenses. Asset checks now validate SVG/font content.
- Fixed incoming-message refresh to preserve drafts, selection and composer focus. Added keyboard focus containment/return for the mobile navigation. Upcoming fact start dates are visible in Business Brain.
- Live Smash Room test used the explicitly named **DeskRoute release QA** visitor. Chat opening, sending, receiving and close/reopen passed. Initial pricing and unknown-access questions exposed unsafe top-fact fallback replies.
- **Deployed `cxroute-widget-chat` v16** with the reviewed safety patch. Retrieval rank alone can no longer authorize automatic replies. When grounded AI is unavailable, drafts require a human and the handler records a gap/assignment/notification. JWT verification setting is unchanged; the existing public widget authentication/origin/rate checks remain.
- Retested both failure questions through the live website. Both returned a review holding message. Database confirmation: assigned human, `ai-needs-human` tag, two matching knowledge gaps, two notifications. No booking, payment or customer email was created.
- The current live audit reports `grounding_not_available`. Successful autonomous answering in production remains blocked until a grounded provider is configured and verified. The safe fallback does **not** solve future-dated knowledge retrieval; the November price fact is currently filtered out before its start date.
- ERUK and Wellbeing homepages return 200 with no DeskRoute script. ERUK remains staged/off. GigLink returned 403 to the HTTP installation check; its installation is unverified.

## Verification still required

| Flow | Evidence obtained | Remaining gate |
| --- | --- | --- |
| Sign-in/session | Ten API unit cases | Real sign-in and browser session recovery |
| Inbox and conversation | Database + synthetic browser navigation, incoming refresh and draft retention | Authenticated hosted staff/visitor round trip |
| Website reply | Atomic RPC and deduplication tested | HTTP widget receive/sync test with isolated fixtures |
| Internal note and mention | Transaction/privacy query and access tests | Browser/widget test showing note never reaches visitor |
| Known approved answer | Existing backend carried forward | Isolated live HTTP answer regression |
| Unknown question | Existing gap/assignment backend carried forward | Isolated live HTTP gap, assignment and alert regression |
| Business Brain | Synthetic create/approve and scan proposal browser tests | Edit/reject/learned FAQ live account; effective-date retrieval |
| AutoSetup | Request contract reviewed | Authorised staged website scan and returned proposals |
| Alerts | Synthetic list/read/open; live assignment + notification records | Multi-device delivery and closed-app push |
| Analytics | Scoped SQL regression passed | Browser rendering and period cross-check |
| Mobile/desktop/PWA | Screenshots and responsive browser flows passed at five widths; menu focus/escape | Physical Android/iOS install, offline/session recovery |
| Help Centre | Publication SQL regression passed | Anonymous HTTP and browser publication/search test |
| Commercial site/docs | Link/asset checks + desktop/mobile screenshots and docs access | Hosted review, commercial terms and contact confirmation |

## Current external blockers

- Cloud browser rejects the local preview with `ERR_BLOCKED_BY_CLIENT`; this is a browser access failure, not an application failure. No screenshot audit has been claimed.
- User approved the local Playwright fallback with “Run”; that gate is satisfied and the local browser audit has completed.
- Render connector has no existing-service build configuration update operation. Dashboard for the existing preview redirects to sign-in. An authenticated Render dashboard is needed to change the existing preview build configuration.
- Figma Starter quota prevented retrieving Help Centre frame `2:251`. Exact comparison for that screen remains unverified; do not bypass the quota.
- KeepGoing jobs `kgj_bf7afc6f6ccd4e13b996d50e32c8bf59` and `kgj_dae19a5fecea4f759f126328d4b58854` failed with “The model run failed.” Neither is working in the background.

## Commercial scope

Website chat is the release reply path. Do not advertise paid checkout, other provider channel delivery, time-based scheduler execution, closed-app push or app-store packages as verified. Confirm the public sales/support contact, pricing, support hours, privacy/data-processing terms and retention policy before a paid public launch. The preview contains no invented prices, testimonials or SLA.

## Production protection

The existing Smash Room widget asset and WordPress installation are unchanged; its backend now runs the verified v16 safety fix. ERUK remains staged/off. One named DeskRoute release QA conversation was created during the explicitly requested live website tests and retained as review evidence. Do not deploy the synthetic demo as the production control panel. Existing Home-PC uncommitted changes are preserved in their original checkout.
