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

## Deployment result

Successfully deployed on 8 November 2026 at approximately 13:57 Europe/London. Supabase function version 66 is ACTIVE, bundle hash d67b4c73269664dc5a845b3d101ce87c0f7e150f15f178369c8039137c746340. Deployed code is committed on the separate review branch at e4e9de0c93a86524ad5fc75c5cb3a98d4febb380. No main-branch merge or Render deployment occurred.

Windows CI run https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/42487377454 passed all three jobs: 32 Python tests and compilation, 16 hosted regression tests, and PowerShell parsing.

Post-deployment verification:
- Downloaded all three deployed files and verified exact equality with the committed deployment inputs.
- Public MCP initialization reports Project Relay 0.7.12.
- Compared full tool schemas against a pre-deployment live snapshot: all 150 unchanged.
- Unauthenticated list_workstations returns isError=true and an OAuth challenge.
- Authenticated get_relay_status and list_workstations succeed.
- Live read-only hardware inventory calls succeed on Andy Home and Smashroom Studio.
- /, /plans, /account, /support, /privacy, /terms and both OAuth metadata endpoints return HTTP 200.
- No rollback was required. The exact prior function files remain preserved under hosted/recovered-live.

Hosted, Andy Home and Smashroom Studio now report 0.7.12. The offline DESKTOP-3HOO86A still reports 0.7.11, and advertised stable installer release remains 0.7.11. Consequently all_components_current correctly remains false. No unverified installer was published and no offline workstation was modified.

Workflow #295 and the canonical plugin submission package remain unverified due to repository access. This successful hosted deployment is not a claim of complete plugin submission or commercial release readiness.
