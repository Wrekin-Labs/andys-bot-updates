# DeskRoute 6.1 release candidate

Static ES module support workspace, commercial site and documentation; Supabase-backed workflows.

```sh
npm --prefix deskroute test
npm --prefix deskroute run check
python3 deskroute/scripts/build_site.py
python3 deskroute/scripts/check_links.py
python3 deskroute/scripts/build_preview.py
```

Serve `deskroute-preview-public` for review. `/qa/` runs on synthetic in-memory data with network access blocked; `/` is the actual staff app. Never use synthetic results as live end-to-end verification.

[Release evidence and blockers](release/READINESS.md) · [Deployment and rollback](release/DEPLOYMENT.md)

No Base44 or ShipStatic. Existing production widget source is retained unchanged.
