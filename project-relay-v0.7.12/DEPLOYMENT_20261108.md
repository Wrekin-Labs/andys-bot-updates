# Project Relay hosted 0.7.12 deployment

User explicitly authorized fixes and production deployment on 8 November 2026.

## Candidate
Recovered Supabase function project-relay-mcp version 65 from project dbhwjzznwhukoogjewfl, including index.ts, site-auth.ts and site-config.ts. Original deployment bundle hash: 650171c495d43fd70f1f5c421d64971f4f74294ab734cbfc27303bcf67382d91. Files are preserved unchanged under hosted/recovered-live for rollback. Existing verify_jwt=false is retained because the function authenticates its own OAuth/controller/Sites requests.

The candidate under hosted/project-relay-mcp preserves all 150 advertised tool schemas exactly. Changes against the recovered live index are limited to three version values (0.7.11 to 0.7.12), rejecting malformed OAuth token expiry, and rejecting invalid/future workstation timestamps. Both authentication companion files are unchanged. No database, credential, approval, gateway/WAF, or workstation installation changes are included.

## Validation before deploy
32 Python tests pass. 16 Node-hosted tests pass, including exact equality of every advertised tool schema, authentication rejection, valid token acceptance, expired/revoked/wrong-audience/wrong-scope rejection, private Sites rejection, device freshness, and controller denial of owner operations. Both invalid-timestamp defects were reproduced against the recovered deployed source before validating the fixes. All three TypeScript files parse via Node's TypeScript stripping API; this is syntax/runtime-fixture testing, not a full Deno type check. No new dependencies installed.

## Rollback
Redeploy the three files from hosted/recovered-live as project-relay-mcp, entrypoint index.ts, verify_jwt=false. Do not substitute the older 128-tool recovery snapshot. Roll back if initialization fails, tool schemas change, unauthenticated access succeeds, or authenticated workstation inspection regresses.

## Remaining limits
The named Wrekin-Labs/project-relay repository still returns 404 to the connection. Workflow #295 and its plugin bundle remain unavailable. This deployment does not assert that submission #295 is fixed. Stable workstation installer release metadata remains separate from hosted version metadata; publishing an unverified installer is not part of this deployment. Render WAF blocks were observed earlier and are not resolved by this function change.

Deployment outcome and live verification will be recorded after the rollout.
