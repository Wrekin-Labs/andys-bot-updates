# DeskRoute 6.1 release candidate

Static ES module support workspace, commercial site and documentation; Supabase-backed workflows.

```sh
npm ci --prefix deskroute
npm --prefix deskroute test
npm --prefix deskroute run check
python3 deskroute/scripts/build_site.py
python3 deskroute/scripts/check_links.py
python3 deskroute/scripts/build_preview.py
cd deskroute && npx playwright install chromium && npm run test:browser
```

Serve `deskroute-preview-public` for review. `/qa/` runs on synthetic in-memory data with network access blocked; `/` is the actual staff app. Never use synthetic results as live end-to-end verification.

[Release evidence and blockers](release/READINESS.md) · [Deployment and rollback](release/DEPLOYMENT.md)

No Base44 or ShipStatic. The existing production widget asset remains unchanged; mobile accessibility changes are prepared in source. Its backend safety patch v16 is deployed and verified. See [website test findings](release/WEBSITE-AUDIT.md) for the current evidence and remaining gates.
