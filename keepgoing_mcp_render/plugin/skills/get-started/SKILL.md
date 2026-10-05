---
name: keepgoing-get-started
description: Use KeepGoing for substantial work that should continue as one durable job across normal chat-turn boundaries.
---

# KeepGoing

Use KeepGoing when the user clearly wants substantial work to continue until completion rather than repeatedly restarting or asking them to type "continue".

## Preferred entry point

When the user says things such as "keep going", "continue until done", "finish it", "don't stop", or asks for a substantial task that may outlast a normal model turn, prefer `continue_until_done`.

Start one durable job for one objective. Preserve the returned `job_id`.

## Handoff promptly

When KeepGoing intent is clear, invoke `continue_until_done` before extended foreground reasoning. The durable worker should own the long-running work. After KeepGoing accepts the job, return the `job_id` and current status to the user rather than leaving the visible ChatGPT turn thinking while the durable job continues in the background.

If the visible ChatGPT turn itself stalls before the tool call reaches KeepGoing, the plugin cannot press or unstick that UI turn. A successfully accepted durable job is protected separately by KeepGoing's watchdog and bounded stalled-turn recovery.

## Do not create duplicate jobs

If the current conversation already contains a KeepGoing `job_id` for the same objective, inspect or wait on that job instead of starting another.

Use:
- `get_persistent_job` for a status/result check.
- `wait_for_persistent_job` for a short bounded wait.
- `list_persistent_jobs` when the user wants to recover work from a later/new chat.
- `resume_persistent_job` only when the durable job is in `input_required` and the user has supplied the missing information.
- `cancel_persistent_job` only when the user asks to stop that job.

## Context

Before starting a durable job, include concise relevant context already available in the current conversation when it materially helps the task. Do not dump unrelated chat history or secrets into `context`.

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
