# KeepGoing Plugin Directory package

This directory is the portable Agent Plugins submission package for KeepGoing 1.2 beta.

## Included

- `plugin.json` — portable manifest and OpenAI listing/review metadata.
- `mcp.json` — one hosted streamable-HTTP MCP server.
- `skills/get-started/SKILL.md` — onboarding/instruction skill.
- `assets/` — square listing and composer icons.

The public listing website is `/plugin`, not the separate commercial checkout page. The plugin package intentionally contains no prices, checkout links, upgrade prompts or reviewer credentials.

Reviewer credentials, sign-in instructions and the demo recording URL are supplied through the OpenAI submission dashboard rather than committed to this public package.

Run `npm run plugin:validate` before creating a submission ZIP.
