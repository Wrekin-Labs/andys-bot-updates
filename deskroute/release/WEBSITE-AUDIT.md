# DeskRoute website and product audit — 3 October 2026

DeskRoute now shares the main support-workflow structure advertised by Pleased: inbox, live chat, knowledge, automation, collaboration and reporting. This is a comparison of implemented areas and verified flows, not a claim of equal feature depth, visual identity or commercial maturity.

Official comparison sources inspected: https://www.pleased.com/features and https://www.pleased.com/pricing . Pleased advertises a broader set of production channels, routing/reporting options and plan-dependent voice/AI capabilities. DeskRoute's verified reply path is website chat. Other-provider delivery, closed-app push, self-service billing and voice are not release-complete.

## Website results

| Website | Result |
| --- | --- |
| The Smash Room | One v6.0.1 widget script. Live chat opens, accepts a message, receives a response and retains history after close/reopen. Backend safety patch v16 deployed and retested. |
| Electronic Repairs UK | Homepage 200; no widget script or chat host in browser. Remains staged/off. |
| Smashroom Wellbeing | Homepage 200; no DeskRoute script in returned HTML. |
| GigLink | Installation HTTP check returned 403. No installation assertion made. |

## Numbered flows and evidence

1. **Staff conversation:** synthetic public reply once, status without accidental send, internal note, teammate selection, correct chronology and incoming message without losing the draft/focus. Screenshot: `screenshots/01-desktop-inbox.png`.
2. **Mobile human queue:** 360/390px layout, navigation, conversation opening and back action. Screenshot: `screenshots/02-mobile-human-queue.png`.
3. **Business operations:** fact create/approve, scan proposals pending review, help publication, automation disabled-first save/enable, notification read/open and preference save. Synthetic data only; no provider delivery assertion.
4. **Commercial website:** desktop/mobile home and docs inspected; 17 HTML pages pass local asset/link validation. Screenshots: `screenshots/03-website-desktop.png`, `screenshots/04-website-mobile.png`.
5. **Visitor widget:** isolated source test at 360/390/1440px verifies open/send/receive/close/reopen, viewport fit and Escape/focus return. Screenshot: `screenshots/06-widget-mobile.png`. These accessibility changes are in source and are not yet deployed to the existing widget host.
6. **Real website answer safety:** before patch, future-price question returned the current price, and an unknown doorway-width question returned an internal booking rule. Evidence: `screenshots/05-live-widget-defect.jpg`. After v16, both return a human-review holding message; assignment, two gaps and two notifications confirmed. Evidence: `screenshots/07-live-widget-verified.jpg`.

## Changes from this audit

- Replaced invalid SVG downloads, added licensed navigation icons and font notices, and validated asset formats.
- Added incoming-thread refresh, draft/focus preservation, mobile navigation keyboard containment and focus return.
- Made fact start dates visible, corrected synthetic chronology, and added explicit page-state waits to prevent false browser passes.
- Improved widget touch targets, mobile input size, visible focus, labels and Escape handling in the release source.
- Removed the unsafe automatic top-search-result reply path. Only a validated grounded answer can send automatically. Grounding failures now create review work.

## Release decision

**Continue controlled testing; do not advertise general commercial readiness.** Local results: 41 browser checks and 22 API/policy/handler tests passed. The live safety fallback is verified. Production autonomous answering is not currently verified: the live audit reports `grounding_not_available`, and future-dated knowledge retrieval still needs implementation. Staff authentication, true staff-to-visitor reply/private-note privacy on a hosted v6.1 panel, physical-device/PWA checks and commercial terms remain gates.

The new control panel and commercial pages are not yet deployed. Updating the existing Render preview needs an authenticated dashboard; the reviewed settings are in `DEPLOYMENT.md`. Figma Help Centre comparison remains blocked by its quota. Other Figma screens informed structure/tokens, but no pixel-perfect or complete accessibility claim is made.
