# Jarvis 2.0 — GitHub landscape review

Checked: 20 October 2026. Scope: 14 relevant public repositories, covering personal assistants, desktop interfaces, voice, memory, workflow recovery and screen control. This is a targeted review, not an exhaustive inventory of GitHub.

## Recommendation

Evaluate **Hermes Agent first as an optional assistant runtime**, with **OpenClaw as the comparison candidate**. Use a separate test workspace and synthetic tasks. Do not replace the existing Windows Jarvis installation until its actual version has been verified.

For the phone-call behaviour in the demonstration, evaluate **LiveKit Agents** as the voice and telephony layer. Pipecat is the alternative when explicit audio pipelines and provider flexibility matter more. Neither voice framework supplies the entire business assistant.

Keep the existing Jarvis prototype as a small acceptance-test harness for task durability and approval semantics. Do not build a second general-purpose agent framework before measuring the established alternatives.

These are engineering judgments based on repository documentation and release metadata, not results of running the projects.

## Verified release and activity snapshot

“Last push” is repository activity, not proof of a feature release, test quality or readiness. Default-branch documentation can describe features absent from an older release. Dates below are UTC as returned by GitHub. GitHub's “latest” badge may refer to a component rather than the core runtime.

| Repository | Release observed | Last push | Repository licence identifier |
| --- | --- | --- | --- |
| [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis) | [desktop-v1.0.2](https://github.com/open-jarvis/OpenJarvis/releases/tag/desktop-v1.0.2) (2026-05-25) | 2026-10-20 | Apache-2.0 |
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | [v2026.10.5](https://github.com/openclaw/openclaw/releases/tag/v2026.10.5) (2026-10-18) | 2026-10-20 | MIT |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | [v0.22.2](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.2) (2026-10-15) | 2026-10-20 | MIT |
| [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) | [v2.2.2](https://github.com/iOfficeAI/AionUi/releases/tag/v2.2.2) (2026-09-09) | 2026-10-19 | Apache-2.0 |
| [leon-ai/leon](https://github.com/leon-ai/leon) | No stable release returned | 2026-10-20 | MIT |
| [livekit/agents](https://github.com/livekit/agents) | [livekit-agents@1.8.8](https://github.com/livekit/agents/releases/tag/livekit-agents%401.8.8) (2026-10-15) | 2026-10-20 | Apache-2.0 |
| [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | [v1.13.0](https://github.com/pipecat-ai/pipecat/releases/tag/v1.13.0) (2026-10-19) | 2026-10-20 | BSD-2-Clause |
| [letta-ai/letta](https://github.com/letta-ai/letta) | [0.16.8](https://github.com/letta-ai/letta/releases/tag/0.16.8) (2026-05-14) | 2026-10-18 | Apache-2.0 |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | [Python v2.2.1](https://github.com/mem0ai/mem0/releases/tag/v2.2.1), TypeScript ts-v3.3.1 (2026-09-25) | 2026-10-20 | Apache-2.0 |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | [core 1.2.16](https://github.com/langchain-ai/langgraph/releases/tag/1.2.16) (2026-10-16); latest badge is CLI 0.4.37 | 2026-10-19 | MIT |
| [microsoft/agent-framework](https://github.com/microsoft/agent-framework) | [python-1.22.0](https://github.com/microsoft/agent-framework/releases/tag/python-1.22.0) (2026-10-15) | 2026-10-19 | MIT |
| [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) | [v0.3.1](https://github.com/bytedance/UI-TARS-desktop/releases/tag/v0.3.1) (2026-10-08) | 2026-10-09 | Apache-2.0 |
| [microsoft/OmniParser](https://github.com/microsoft/OmniParser) | [v.2.0.1](https://github.com/microsoft/OmniParser/releases/tag/v.2.0.1) (2025-09-12) | 2026-07-20 | CC-BY-4.0 |
| [kawayiYokami/P-ai](https://github.com/kawayiYokami/P-ai) | [v0.97.6](https://github.com/kawayiYokami/P-ai/releases/tag/v0.97.6) (2026-10-19) | 2026-10-19 | GPL-3.0 |

Sources for each row: the linked official repository, its GitHub REST repository metadata, /releases/latest, and the three most recently returned release records. Licence identifiers are repository metadata only; bundled models and dependencies may have separate terms. No external source code has been copied into this branch.

## What is worth using

### Hermes Agent — first full-assistant evaluation

Current documentation describes persistent memory, cross-session search, reusable skills, scheduled tasks, messaging, MCP and native Windows support. These align with Jarvis's missing runtime capabilities. MIT repository licence.

Evaluate memory corrections, cron behaviour after downtime, task cancellation and approval boundaries. Generated skills are executable capability changes and must not silently acquire access. Native Windows support documented on main still needs validation against the selected release on the target PC.

Sources: [README](https://github.com/NousResearch/hermes-agent), [v0.22.2](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.2).

### OpenClaw — strongest comparison assistant

Documents a local gateway, messaging channels, replaceable model/harness plugins, and device-local actions. The README explicitly states that main-session tools run on the host unless sandboxing is configured. Review the actual tool policy before granting adapters. MIT repository licence.

The stable release observed is v2026.10.5, published 18 October; the newer v2026.10.10-beta.2 is explicitly a prerelease. Do not select the beta solely because its tag looks newer.

Sources: [README](https://github.com/openclaw/openclaw), [stable release](https://github.com/openclaw/openclaw/releases/tag/v2026.10.5), [beta](https://github.com/openclaw/openclaw/releases/tag/v2026.10.10-beta.2).

### LiveKit Agents — preferred voice and phone-call candidate

Provides real-time audio, turn detection, tool integration, MCP, and telephony through the LiveKit stack, including outbound-call examples. Version 1.8.8 was published on 15 October. Framework licence is Apache-2.0; turn-detection models have separate terms.

Start with push-to-talk and spoken task-status queries. Add outbound calling only after owner-approved destinations, trigger rules, quiet hours, duplicate suppression and measured costs are implemented.

Sources: [README](https://github.com/livekit/agents), [1.8.8 release](https://github.com/livekit/agents/releases/tag/livekit-agents%401.8.8).

### Pipecat — alternative voice pipeline

Documents many model providers, transports and telephone serializers, plus a Mem0 integration. Release v1.13.0 was published on 19 October. BSD-2-Clause repository licence. A useful comparison for audio control and provider flexibility, but adds integration work rather than replacing the assistant runtime.

Sources: [README](https://github.com/pipecat-ai/pipecat), [v1.13.0](https://github.com/pipecat-ai/pipecat/releases/tag/v1.13.0).

### AionUi — desktop interface candidate

Documents Windows support and a cowork interface for multiple agent backends, including Claude Code, Codex, Hermes and OpenClaw. Latest observed release is v2.2.2 from 9 September, despite October repository activity. Apache-2.0 repository licence.

Evaluate whether this provides the task visibility and input-needed indicators we need before writing another desktop frontend. It is an interface candidate, not proof that connected backends share memory or enforce identical approvals.

Sources: [repository](https://github.com/iOfficeAI/AionUi), [release](https://github.com/iOfficeAI/AionUi/releases/tag/v2.2.2).

### OpenJarvis — local-model and cost evaluation

Local-first agent framework with Windows installation paths, desktop packaging, scheduled monitors and local/cloud routing concepts. Apache-2.0 repository licence. The latest observed packaged desktop release is from May, while main is active in October.

Useful for testing local inference and resource use. “Runs locally” does not establish that every tool, model or speech provider stays offline. No local-model performance has been measured on the user's hardware.

Sources: [repository](https://github.com/open-jarvis/OpenJarvis), [desktop release](https://github.com/open-jarvis/OpenJarvis/releases/tag/desktop-v1.0.2).

### LangGraph and Microsoft Agent Framework — orchestration alternatives

LangGraph documents durable execution, checkpoints, human oversight and memory. Its latest core release observed is 1.2.16; the latest repository release badge points to its CLI instead. Microsoft Agent Framework supports Python and .NET orchestration; Python 1.22.0 is the observed release.

Both are MIT-licensed at repository level. Evaluate one only if the chosen assistant runtime cannot meet our recovery requirements. Neither substitutes for provider-side idempotency or reconciliation of an external action whose outcome is unknown.

Sources: [LangGraph](https://github.com/langchain-ai/langgraph), [core release](https://github.com/langchain-ai/langgraph/releases/tag/1.2.16), [Microsoft Agent Framework](https://github.com/microsoft/agent-framework).

### Mem0 and Letta — memory alternatives

Mem0 is a memory layer; Letta is a stateful-agent platform. Both repositories report Apache-2.0. Letta's observed server release is 0.16.8 from May despite more recent commits. Mem0 has separate Python and TypeScript releases.

First measure the selected runtime's built-in memory. Add another memory system only if factual correction, deletion, provenance or cross-session retrieval fails the evaluation. Conversation memory must not become permission to execute actions.

Sources: [Mem0](https://github.com/mem0ai/mem0), [Letta](https://github.com/letta-ai/letta).

### UI-TARS and OmniParser — optional screen-control research

UI-TARS documents desktop/browser control. Release v0.3.1, published 8 October, fixes Agent TARS CLI server exposure, authentication and request-handling issues. Any evaluation should use the patched release or later.

OmniParser is a screen-understanding component, not a complete assistant. Its repository metadata reports CC-BY-4.0, while the README distinguishes model-weight licences, including older AGPL detectors. Assess the exact model assets before reuse. Both projects would be tested on a disposable desktop before accessing a working PC.

Sources: [UI-TARS](https://github.com/bytedance/UI-TARS-desktop), [patched release](https://github.com/bytedance/UI-TARS-desktop/releases/tag/v0.3.1), [OmniParser](https://github.com/microsoft/OmniParser).

### Leon and P-ai — watchlist

Leon documents a major transition toward its 2.0 Developer Preview; the returned release records are component prereleases, and no stable latest response was available. Watch its architecture rather than adopting its moving development branch as our baseline.

P-ai is a smaller desktop project documenting memory, voice access, MCP and tool review. Release v0.97.6 is dated 19 October. Repository metadata reports GPL-3.0. It remains a watchlist candidate pending independent testing and a source-reuse decision.

Sources: [Leon](https://github.com/leon-ai/leon), [P-ai](https://github.com/kawayiYokami/P-ai).

## Practical integration plan

1. Verify the installed Jarvis source and shortcut target read-only when its workstation is reachable. Keep private machine inventories out of this public repository.
2. Compare Hermes and OpenClaw using the same synthetic workload: corrected preferences across restarts, interrupted tasks, cancellation, an unavailable adapter and approval expiry.
3. Use explicit read-only adapters first. Do not attach a general shell, file writer, production email sender or deployment capability.
4. Keep provider receipts and uncertain outcomes visible in the task dashboard. Reconcile before retrying an external side effect.
5. Compare LiveKit and Pipecat on push-to-talk latency and interruption handling only after text task behaviour is proven.
6. Evaluate calls to a user-approved number separately, with bounded triggers and costs. Do not infer that a video demonstration is evidence of reliable background operation.
7. Choose versions after Windows compatibility and adapter tests. Preserve licence notices for any later reuse.

## Test gates

Use the existing 12 offline prototype checks as one acceptance set, not a complete security test. Add runtime-specific tests for memory correction/deletion, injected instructions in retrieved documents, lost provider acknowledgements, tool-policy bypass, revoked credentials and offline recovery.

No installations, account connections, API spending, voice calls, deployments, existing project-file modifications or workstation changes were performed for this research.
