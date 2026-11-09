# Jarvis Android 0.2.0 preview

Continues the existing Jarvis research branch and preserves its Python task ledger.
Native Java app with typed/voice notes, speech playback, note export, individual
note deletion, read-only task snapshots and an optional authenticated AI connection.

## Preview identity and signing

This development app is **Jarvis Dev**, application ID `uk.wrekinlabs.jarvis.dev`.
It installs alongside 0.1.0 (`uk.wrekinlabs.jarvis`) so existing notes are preserved.
The original CI-generated debug signing key was ephemeral and is unavailable;
this is deliberately not an in-place update. Do not uninstall 0.1.0 to install it.
Data is not automatically migrated between these two app IDs.

CI produces an unsigned release APK. The delivered APK is signed outside GitHub
with a retained private development key. Future `.dev` builds must use that same
key. No signing key or pairing credential belongs in the repository or CI artifact.
Production package identity and signing remain a separate release decision.

## Phone use

Local notes and snapshot import work without an AI server. Tap-to-talk uses the
phone's installed speech provider, which may process audio online. Review its
transcription before saving or sending. Read-aloud is explicit; speech stops when
the app leaves the foreground. Export saves a plain JSON file to a location chosen
by the user; keep this private. Uninstalling removes app notes and pairing data.

Connection accepts an HTTPS origin and private pairing token. Tokens are encrypted
with an Android Keystore AES-GCM key and bound to the saved origin. Cleartext HTTP,
URL credentials, paths, queries and redirects are rejected. Normal platform TLS
validation remains enabled. No certificate bypass or embedded AI API keys.

Ask Jarvis sends only the current question. Each question is independent; no saved
notes, previous chat, task ledger or ChatGPT history are automatically uploaded.
See `bridge/README.md` for the matching private local-Ollama bridge. The bridge has
not been installed or tested against Andy Home. Test Connection verifies bridge
identity, not whether the model is loaded. AI output is labelled as text, and no
model output is interpreted as an action or command.

## Build and validate

JDK 17, Gradle 8.11.1, SDK 35:
`gradle --no-daemon assembleRelease testDebugUnitTest lintRelease`

Python: `python -m unittest discover -s bridge -v`, plus the existing tests under
`research/jarvis-2/prototype`. Android unit tests cover endpoint/token validation.
Python HTTP integration uses loopback and a fake provider; no paid/model requests.

Task snapshots retain the existing command:
`python mobile_export.py --demo --output sample-tasks.json` in the prototype folder.

## Remaining work

Live HTTPS bridge setup, installed-model selection, phone-to-PC testing, physical
Samsung UI/voice/Keystore checks, multi-turn chat, optional memory attachment,
and a separately authenticated Relay read-only adapter. PC execution and approvals
are not available. Do not expose the trusted-local prototype TaskStore over HTTP.
Target SDK remains 35 for this preview; newer Android compatibility must be tested
before a store release. No Play Store release or production deployment is implied.
