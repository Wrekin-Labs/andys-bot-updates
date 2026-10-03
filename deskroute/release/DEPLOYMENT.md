# Preview deployment and rollback

Use the existing Render static preview service. Do not create or repurpose unrelated services.

- Service: `srv-db0132h42hec73egh030`
- URL: `https://deskroute-ai-v6-preview.onrender.com`
- Repository: `Wrekin-Labs/andys-bot-updates`
- Branch: `deskroute-v6-production`
- Root directory: repository root (empty)
- Build command: `python3 deskroute/scripts/build_site.py && python3 deskroute/scripts/check_links.py && python3 deskroute/scripts/build_preview.py`
- Publish directory: `deskroute-preview-public`
- Auto deploy: off until the release gate passes

The preview root uses the real backend and requires staff sign-in. `/site/` is the commercial preview. `/qa/` is a labelled synthetic demonstration with a separate network-free API adapter. It is not evidence of live delivery.

Deployed 3 October 2026: `dep-db0did1srm7s73f4jrt0` is live on source `d188f85aaa5e30d9f2651e0e812bcb58cf3877bb`. The returned commit matches the successful CI run `37115372925`. Hosted staff shell, website, docs and synthetic reply/note/status flows were reviewed. Authenticated staff delivery is still blocked at sign-in. An additional full hosted file-hash check was prevented by the execution environment; local asset checks passed.

The previous configuration is saved in `preview-rollback.json`; previous successful deploy is `dep-db0133142hec73egh0tg`. Auto-deploy remains off.

Production panel `srv-db01no1srm7s73dopngg` and production widget `srv-db02b0p42hec73ekr4cg` are separate and must stay unchanged while the preview is tested.

## Deployed answer safety patch

On 3 October, `cxroute-widget-chat` was updated from v15 to v16 after 12 answer-policy/handler regressions passed. Live website retests confirmed the review fallback, human assignment, gaps and notifications. This is separate from the still-pending control-panel/widget-asset deployment.

Deploy files for this function must include `cxroute-widget-chat.ts` as `index.ts`, its relative `answer-policy.js`, and the existing `deno.json`. Keep the existing JWT setting and custom widget origin/rate checks. The old function source is retained in git parent `7993a80`; restoring it would reintroduce the unsafe top-fact fallback and should not be a routine rollback. Roll forward with the validated policy intact.

When no grounded provider is available, all automatic answers require human review. Do not silently restore raw search-result sending to make the bot appear autonomous. Configure and verify the provider, future-date retrieval and unknown-question handling before general release.

To roll back the preview, redeploy its prior successful deployment and restore the saved prior configuration. The additive database functions can remain in place for an interface rollback; do not drop schema/functions during an incident. Restoring the old panel does not require deleting customer data.

Before public release: complete READINESS.md gates, confirm commercial terms/contact, verify staff/visitor flows with isolated test data, record the release commit and keep the last working panel/widget URLs available. Publish the production panel from `deskroute/control-panel`, not the synthetic preview directory.

## Account recovery activation

The dedicated callback is `https://deskroute-ai-v6-preview.onrender.com/password.html`. Before requesting a real email, confirm that exact URL is in Supabase Auth's redirect allow-list and that the recovery email template uses the provider confirmation URL. Do not add a wildcard or change the shared project's Site URL without checking its other applications. Verify SMTP configuration and delivery to the existing workspace owner. The page handles the default client-only recovery fragment, validates its access token with Auth, removes it from browser history, updates only the current user's password and ends its local recovery session. It never creates accounts or grants memberships.

The account owner must choose and enter their own new password. Do not place recovery URLs, access tokens or passwords in source, reports or chat. A generic successful recovery request does not prove delivery or that an account exists. Record the real desktop/phone sign-in and staff-to-widget tests separately after recovery.

Latest preview update: `dep-db0ea6lg1s2s73dn083g`, source `d50029e`, live on 3 October after CI `37119293218` passed. The immediately prior stable preview is `dep-db0did1srm7s73f4jrt0` (`d188f85`) with the same build settings. Prefer that deployment for a preview UI rollback; the original legacy configuration remains in `preview-rollback.json`.
