# Jarvis Android 0.3.0 preview

Original native Android companion continuing the recovered Jarvis research branch.
The existing Python task ledger and Windows source remain unchanged.

## What works in this build

- Dark Jarvis HUD, animated core and explicit ready/listening/transcribing/thinking/
  speaking/error states, with reduced motion and fixed bottom navigation.
- Foreground speech recognition with live transcription. System speech may use an
  online provider; optional on-device-only mode refuses to fall back to the cloud.
- Optional automatic send after speech, off by default. Local English voice selection,
  speech speed, read/stop controls. Microphone and TTS stop when the app backgrounds.
- 200 local notes, search, individual deletion and plain-JSON export.
- Latest 20 conversation exchanges persisted on the phone. Requests include at most
  five completed AI exchanges / 12,000 characters. New conversation clears history.
- Up to five explicitly selected notes / 4,000 characters attached to the next question.
  Other notes, local commands and task snapshots are not automatically sent to AI.
- Read-only ledger-snapshot import; no task execution or mobile approval endpoints.
- HTTPS bridge pairing with Android Keystore AES-GCM encrypted, origin-bound token.
  No cleartext HTTP, redirects, URL credentials or certificate-validation bypasses.

## Local commands — no PC or model required

`time`, `date`, `battery`, `remember ...`, `show notes`, `open wifi settings`,
`open bluetooth settings`, `open calculator`, `timer 10 minutes`, `stop`.

Only exact user commands reach this deterministic parser. Model replies are never
executed. Settings and timer requests open Android's own apps; their completion is
not verified by Jarvis. General conversation needs a configured, reachable AI bridge.

## AI bridge

Use the matching `bridge/server.py` 0.3, exposing health protocol version 2 through
private HTTPS with a trusted certificate. Local Ollama must already be installed
with a model chosen by the owner. Nothing is deployed or downloaded automatically.
See bridge/README.md for setup and the bounded request contract.

Phone cancellation discards the reply but may not stop an already running server
inference. Replies do not perform PC actions. Saved memory is attached only when
selected; note exports contain private plaintext. Local note/conversation storage
uses app-private preferences, not application-level encryption. Backup and device
transfer are disabled. Uninstalling removes this app's local data.

## Identity and updates

App name: Jarvis Dev. Package: `uk.wrekinlabs.jarvis.dev`.
0.3 updates 0.2 using the same retained private development signing key and preserves
its notes, conversation and pairing preferences. CI builds an unsigned release APK;
delivery signing happens separately. Never commit signing keys or pairing tokens.

The original 0.1 app (`uk.wrekinlabs.jarvis`) used an unavailable temporary CI debug
key. It remains a separate installation. Do not uninstall it to install this app;
its data is not automatically migrated into Jarvis Dev.

## Build and validation

JDK 17, Gradle 8.11.1, SDK 35:
`gradle --no-daemon assembleRelease testDebugUnitTest lintRelease`

Python: `python -m unittest discover -s bridge -v`, plus existing tests under
`research/jarvis-2/prototype`. JVM tests cover endpoint/token policy and exact local
command routing. Android API-35 emulator tests cover note persistence/recreation,
disconnected-chat honesty, pairing encryption/origin binding and context filtering.
CI captures a real emulator screenshot and UI hierarchy. Model tests use a fake
provider; they do not prove quality, latency or hardware compatibility with Ollama.

Task snapshot generation is unchanged: run `python mobile_export.py --demo --output
sample-tasks.json` in the prototype folder, then import the JSON on the phone.

## Remaining limits

Physical Samsung microphone/language/voice checks, live HTTPS/Ollama pairing,
on-phone language-model inference, background wake word, full-duplex interruption,
Accessibility operation, live web research, camera/vision and Relay PC control are
not delivered. Target API remains 35; newer-device and store readiness are unverified.
No Play Store publication or production deployment is implied.

See GITHUB_RESEARCH_2026-11-09.md for checked upstream projects and design decisions.
