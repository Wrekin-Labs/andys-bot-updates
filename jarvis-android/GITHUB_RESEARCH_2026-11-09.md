# Jarvis research and implementation decisions — 9 November 2026

Verified repository metadata, release endpoints, licensing and selected documentation.
README claims are not independently verified device behaviour.

| Project | Verified current release/source position | Relevance to this build |
|---|---|---|
| [FatihMakes/Mark-LVI](https://github.com/FatihMakes/Mark-LVI) | Source pushed 4 Nov 2026; no packaged GitHub releases; LICENSE is CC BY-NC 4.0 | Reference for clear visual state, voice configuration and memory management. No source copied because the intended Wrekin Labs reuse may become commercial. |
| [AnaaySampat/jarvis](https://github.com/AnaaySampat/jarvis) | Latest listed prerelease v2.5.6-rc.1, 6 Nov; latest stable among current releases v2.5.0, 26 Oct; MIT | Reference for native phone/PC separation and explicit feature status. Its Accessibility operator has much broader permissions than this app. Not imported wholesale. |
| [ansaribilal14/jarvis](https://github.com/ansaribilal14/jarvis) | v2.3.0 release, 20 Sep; source pushed 7 Nov; MIT | Read docs/VOICE.md and docs/LOCAL_AI.md. Shows native SpeechRecognizer/TTS and a llama.cpp JNI runtime. Adapted the architectural ideas independently; no source copied. |
| [livekit/agents](https://github.com/livekit/agents) | livekit-agents@1.8.11, 5 Nov; Apache-2.0 | Candidate for later full-duplex network voice. Adds a service dependency and is not bundled in this preview. |

## Implemented independently in 0.3

- Native animated core with explicit ready/listening/transcribing/thinking/speaking/error states.
- Foreground speech recognition with live transcription; optional strictly on-device service,
  and explicit opt-in to automatic sending. Stops on background and before speech playback.
- Local English TTS voice picker, speed control, read/stop and reduced-motion setting.
- 20-exchange local conversation ledger. Up to five completed AI exchanges / 12,000 characters
  are sent as context, with a fresh-conversation control. Local commands are excluded.
- Explicit selection of up to five notes / 4,000 characters for the next AI request.
- Exact user-command parser for time, date, battery, notes, settings, calculator and timer intent.
  It never accepts model output. Timer execution belongs to the Clock app, not verified by Jarvis.
- Searchable notes and upgraded native navigation/cards; preserves 0.2 app ID, signing and data.
- Protocol-v2 bridge supports bounded history and selected notes. Rejects client system roles,
  tool fields, malformed histories and oversized context. No PC executor.
- Android emulator tests for local note persistence/recreation, disconnected-chat honesty,
  encrypted pairing with origin binding and history filtering; screenshot capture in CI.

## Still absent — do not advertise as delivered

Always-on wake word, background listening, full-duplex interruption, Accessibility phone
operation, screen/camera vision, a bundled on-phone language model, live Relay control,
web-connected research and production hosting. General AI still needs the configured HTTPS
Ollama bridge. Current bridge tests use a fake provider, not Andy's installed model.

## On-device AI decision

The reference Android project uses llama.cpp b4458 through JNI/CMake with separate model
files. A reliable integration needs ABI/build verification, licensed model selection,
RAM/thermal tests and cancellation/UTF-8 tests on Andrew's Samsung. Adding its library or
claiming the phone has an AI brain without these checks would not deliver that feature.
The present local command layer is deterministic and is labelled as on-phone responses.

Sources checked: repository README/LICENSE/release API; Android SpeechRecognizer and
AlarmClock API references; https://docs.ollama.com/api/chat.
