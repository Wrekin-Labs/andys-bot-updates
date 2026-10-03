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

Save the current service configuration and last successful deployment ID before changing it. After the source is pushed and the configuration is updated, deploy that exact commit. Verify the returned deployment is live, the expected version is served, all assets return successfully and the browser flows pass.

Production panel `srv-db01no1srm7s73dopngg` and production widget `srv-db02b0p42hec73ekr4cg` are separate and must stay unchanged while the preview is tested.

To roll back the preview, redeploy its prior successful deployment and restore the saved prior configuration. The additive database functions can remain in place for an interface rollback; do not drop schema/functions during an incident. Restoring the old panel does not require deleting customer data.

Before public release: complete READINESS.md gates, confirm commercial terms/contact, verify staff/visitor flows with isolated test data, record the release commit and keep the last working panel/widget URLs available. Publish the production panel from `deskroute/control-panel`, not the synthetic preview directory.
