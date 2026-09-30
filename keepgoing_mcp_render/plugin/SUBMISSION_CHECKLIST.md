# KeepGoing Plugin Directory submission checklist

## Package
- [x] Portable `plugin.json` using Agent Plugins 1.0 schema.
- [x] One remote streamable-HTTP MCP server in `mcp.json`.
- [x] Listing logo and composer icon, including dark variants.
- [x] Onboarding skill with valid front matter.
- [x] Exactly five positive and three negative MCP review cases.
- [x] Commerce declared false.
- [x] United Kingdom initial publication target.
- [x] No reviewer credentials or secrets in the package.
- [x] Automated package validator.
- [x] Reproducible ZIP builder.

## Plugin commerce policy
- [x] Plugin listing contains no prices, subscription offers, upgrade prompts or checkout links.
- [x] Plugin website URL points to `/plugin`, a commerce-neutral product page.
- [x] Existing entitled accounts can authenticate through OAuth.
- [x] Entitlement failures explain unavailability without initiating a purchase.
- [ ] Recheck the current OpenAI plugin monetization policy immediately before submission.

## MCP/review
- [ ] Deploy the exact release commit.
- [ ] Run production `/readiness` and `npm run preflight -- https://keepgoing-mcp.onrender.com --v12 --commit=<final-full-SHA>`.
- [ ] Connect `https://keepgoing-mcp.onrender.com/mcp` in ChatGPT Developer Mode.
- [ ] Run every advertised tool with valid and invalid inputs.
- [ ] Run all five positive review cases with the dedicated reviewer account.
- [ ] Run all three negative review cases.
- [ ] Verify owner-only tool profiles are not visible to ordinary reviewer/customer accounts.
- [ ] Confirm external tool calls use explicit allowlists and budget limits.
- [ ] Request/inspect OpenAI MCP tool scan findings and fix required issues.

## Submission dashboard
- [ ] Use the verified developer/business identity intended for publication.
- [ ] Upload the CI-built ZIP.
- [ ] Complete MCP connection and domain verification.
- [ ] Enter reviewer credentials in the secure dashboard form (not the ZIP).
- [ ] Provide a reviewer-accessible demo recording URL.
- [ ] Confirm support/privacy/terms URLs are public and accurate.
- [ ] Confirm `GB` availability (or deliberately update countries).
- [ ] Submit policy attestations.
- [ ] Publish only after approval.

## Branding
- [x] KeepGoing visual identity uses a continuous-loop/forward-motion mark.
- [x] Primary brand violet `#5F50E6`; dark-theme accent `#A99FFF`.
- [x] Listing assets are square SVGs >= 48×48.
- [ ] Replace assets only if a later brand review selects a different final mark; re-run package validation after any change.
