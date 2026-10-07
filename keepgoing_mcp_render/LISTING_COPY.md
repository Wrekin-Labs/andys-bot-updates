# KeepGoing — Final Plugin Listing Copy

Release candidate: `1.6.0-beta.1`

## Logo

Use the bundled KeepGoing package assets:

- `plugin/assets/logo.svg`
- `plugin/assets/logo-dark.svg`
- `plugin/assets/composer-icon.svg`
- `plugin/assets/composer-icon-dark.svg`

The public product page uses the same continuous-loop / forward-motion identity. The package validator checks square dimensions and required assets before CI produces the submission ZIP.

## Plugin name

KeepGoing

## Category

Productivity

## Short description

Finish long AI work

## Main listing write-up

KeepGoing is designed for substantial AI work that should not have to restart every time a normal chat turn ends.

It turns a substantial objective into one durable job with its own stable job ID. ChatGPT can start that job, check its progress, wait for it, recover it in a later chat, provide missing information when genuinely required, and continue working from the same saved state instead of repeatedly starting again.

KeepGoing is useful for longer research, comparisons, debugging, structured build work, and other multi-step tasks where continuity matters.

For coding jobs, an opt-in coding workspace can clone a **public GitHub repository** into an isolated hosted sandbox. Beta.24 can also overlay a small set of explicitly selected task-relevant text files that are not yet in the repository. The durable Agent can then inspect the real files, edit locally, run tests and produce a patch/report instead of being limited to prompt context. This first coding mode does not receive GitHub write credentials, does not access private repositories, and does not push changes.

The service includes bounded continuation limits, duplicate-job protection, recovery after transient service failures, owner-scoped job access, OAuth authentication, and a server-side watchdog that can keep supported work progressing within configured safety and cost limits.

KeepGoing does not bypass ChatGPT or OpenAI safeguards, does not gain access to other accounts or apps unless those capabilities are explicitly available to the job, and does not create new ChatGPT conversation messages on its own.

For public ChatGPT users, KeepGoing is an existing-account integration. Subscription purchasing and upgrades are kept outside the ChatGPT plugin experience.

## Shorter alternate write-up

KeepGoing gives substantial AI work a persistent job ID so ChatGPT can continue, check, recover, and resume the same objective without repeatedly restarting completed work. It is built for longer research, comparisons, debugging, and multi-step jobs, with bounded continuation, duplicate protection, recovery, OAuth authentication, and cross-chat job recovery.

## Key benefits

- Continue one substantial objective as a durable job
- Recover active jobs in a new chat
- Avoid duplicate starts and repeated work
- Pause safely when genuine user input is needed
- Resume the same job after the missing input is supplied
- Bound continuation by attempts, tokens, tool calls, and time
- Recover from transient provider/session-start failures
- Opt into a real coding workspace for public GitHub repositories
- Inspect/edit/test code locally without granting GitHub write credentials
- Keep jobs scoped to the authenticated account

## Suggested starter prompts

1. Use KeepGoing to finish this substantial job until it is complete.
2. Use KeepGoing to continue this objective without restarting completed work.

## Support and policy links

Website: https://keepgoing-mcp.onrender.com/pluginplugin
Support: https://keepgoing-mcp.onrender.com/support
Privacy: https://keepgoing-mcp.onrender.com/privacy
Terms: https://keepgoing-mcp.onrender.com/terms
Security: https://keepgoing-mcp.onrender.com/security

## MCP connection

https://keepgoing-mcp.onrender.com/mcp

OAuth scope:

`keepgoing.jobs`
