---
name: keepgoing-get-started
description: Use when the user explicitly asks KeepGoing to start or finish substantial work, or to inspect, recover, resume or cancel an existing KeepGoing job.
---

# KeepGoing

Use KeepGoing for an explicitly requested durable objective. A substantial task or a generic "continue" by itself is not permission to send a new objective to KeepGoing.

## Preferred entry point

When the user explicitly asks KeepGoing to continue or finish substantial work, prefer `continue_until_done`. For example: "Use KeepGoing to finish this comparison."

Generic continuation phrases may select this tool only when the authenticated server explicitly advertises owner-mode implicit continuation. Public/reviewer connections require explicit KeepGoing intent.

Start one durable job for one objective. Preserve the returned `job_id`.

## Do not create duplicate jobs

If the current conversation already contains a KeepGoing `job_id` for the same objective, inspect or wait on that job instead of starting another.

Use:
- `get_persistent_job` for a status/result check.
- `wait_for_persistent_job` for a short bounded wait.
- `list_persistent_jobs` when the user wants to recover work from a later/new chat.
- `resume_persistent_job` only when the durable job is in `input_required` and the user has supplied the missing information.
- `cancel_persistent_job` only when the user asks to stop that job.

## Context

Before starting a durable job, include only a brief task-specific checkpoint intentionally shared for this objective, at most 4,000 characters. Never send full chat history, raw transcripts, unrelated personal data or secrets in `context`.

## Tool profiles

Use `list_tool_profiles` when a task needs background tools beyond public web research and the available profile is not already known.

Select only a profile that matches the task. Tool profiles are permission-scoped and server-configured. Never assume KeepGoing inherits all apps/connectors available to the foreground ChatGPT conversation.

Write-capable profiles may be restricted to an owner account and should be used only when the user's task actually requires those mutations.

## Genuine user stops

Do not stop for ordinary non-essential clarification when a safe, reversible assumption can complete the work.

Stop in `input_required` when an essential credential, authorization, private-account action, irreversible/destructive choice, legal acceptance, payment, or genuinely missing fact prevents safe completion.

Never ask the user to put passwords, payment credentials, API keys or 2FA codes into ordinary tool arguments.

## Commerce

KeepGoing plugin tools do not sell plans, initiate checkout, or promote upgrades. If the connected account does not include a required entitlement, explain that the capability is unavailable for the account. Do not start a transaction from the plugin.
