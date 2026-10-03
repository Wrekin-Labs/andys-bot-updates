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
- Source pushed to GitHub release branch at `d188f85`. GitHub Actions run `37115372925` completed successfully, including all 41 browser checks, and produced the preview and browser evidence artifacts.
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
| Sign-in/session | Ten API unit cases; hosted sign-in page served | Hosted sign-in returned “Failed to fetch”; existing owner needs account access/recovery |
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
| Commercial site/docs | Link/asset checks, desktop/mobile screenshots; hosted website and docs reviewed | Commercial terms and contact confirmation |

## Current external blockers

- Local cloud-browser access returned `ERR_BLOCKED_BY_CLIENT`. User-approved local Playwright tests completed instead, and the deployed preview is now accessible and visually reviewed.
- User approved the local Playwright fallback with “Run”; that gate is satisfied and the local browser audit has completed.
- Render dashboard authentication completed; existing preview configuration updated and deployment `dep-db0did1srm7s73f4jrt0` is live on `d188f85`. Auto-deploy remains off. Root staff page, `/site/`, `/site/docs/` and `/qa/` were reviewed. Hosted synthetic reply/note/status-with-draft flows passed.
- Hosted staff authentication returned “Failed to fetch”; no successful login or staff-to-visitor round trip is claimed. An existing confirmed owner membership was found, but the user reports not having login credentials. Account recovery/setup is the immediate access gate.
- Automatic approval review rejected escalated shell networking for additional hosted file-hash and auth-preflight diagnostics. Those additional checks did not run; no hash/preflight result is claimed.
- Figma Starter quota prevented retrieving Help Centre frame `2:251`. Exact comparison for that screen remains unverified; do not bypass the quota.
- KeepGoing jobs `kgj_bf7afc6f6ccd4e13b996d50e32c8bf59` and `kgj_dae19a5fecea4f759f126328d4b58854` failed with “The model run failed.” Neither is working in the background.

## Commercial scope

Website chat is the release reply path. Do not advertise paid checkout, other provider channel delivery, time-based scheduler execution, closed-app push or app-store packages as verified. Confirm the public sales/support contact, pricing, support hours, privacy/data-processing terms and retention policy before a paid public launch. The preview contains no invented prices, testimonials or SLA.

## Production protection

The existing Smash Room widget asset and WordPress installation are unchanged; its backend now runs the verified v16 safety fix. ERUK remains staged/off. One named DeskRoute release QA conversation was created during the explicitly requested live website tests and retained as review evidence. Do not deploy the synthetic demo as the production control panel. Existing Home-PC uncommitted changes are preserved in their original checkout.

## Account access follow-up

- Built a dedicated set/reset password page for existing accounts, linked from desktop and phone sign-in. Recovery tokens are stripped from the URL before use, validated server-side, kept in memory and cleared when leaving or after a successful update. No account or membership is created.
- Added eight recovery API regressions and two sign-in error/race tests: all pass locally. The total API/policy/handler coverage is now 32 cases. CI run `37119293218` passed on source `d50029e`: 46 browser checks, including recovery at desktop/phone widths, expired links, same-tab recovery, mismatched-password prevention, successful synthetic password update, session cleanup and a working offline public shell. All 32 API/policy/handler cases also pass.
- Fixed stale service-worker references to deleted navigation assets, which prevented the public-shell cache installing. The asset checker now verifies the cache list. Recovery pages/tokens remain outside the cache.
- Deployment gate for live recovery: confirm the exact `/password.html` callback in Supabase Auth redirect settings, email-template compatibility and SMTP delivery. No recovery email has been sent, no password has been changed, and owner access is not yet restored. Browser credential protection prevented further dashboard inspection during this session.

The original 41-check local evidence remains in `browser-results.json`; the expanded 46-check run is recorded in `ci-evidence.json` and its GitHub Actions browser artifact. No real recovery email or password update occurred.

Latest preview deploy `dep-db0ea6lg1s2s73dn083g` is **live** on tested source `d50029e`. It includes account recovery and the offline-cache repair. Hosted recovery delivery and authenticated staff access are still unverified; no claim of owner access restoration is made.
