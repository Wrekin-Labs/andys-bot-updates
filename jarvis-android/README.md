# Jarvis Android 0.1.0 preview

Continues the recovered `feature/jarvis-2-research` commit
`e06928abe181d8138760aca99669df59eaa20571`. Existing Python ledger and its approval
rules are preserved. New native Android companion, package `uk.wrekinlabs.jarvis`.

## Available in this preview

- Typed notes with local persistence, up to 200 notes; confirmed deletion.
- Tap-to-talk through the installed Android speech provider. Recognition fills a
  draft; it never automatically saves or performs an action. Provider may use cloud processing.
- Explicit read-aloud and stop controls.
- Read-only JSON task snapshot import, with size/state validation and data minimisation.
- Clear disconnected status. No simulated AI answers or claims of PC execution.

## Build

JDK 17, Gradle 8.11.1, Android SDK platform 35. Open this directory in Android Studio
or run `gradle assembleDebug lintDebug`. The dedicated GitHub workflow builds a
**debug-signed test APK**, not a production release. No production signing keys are used.

Generate a compatible task snapshot from the existing prototype:

```sh
cd research/jarvis-2/prototype
python mobile_export.py --demo --output sample-tasks.json
# Or use --database path/to/demo.sqlite3 instead of --demo.
```

Transfer JSON to the phone and select Tasks → Import task snapshot. It contains
only task IDs and states. It is not a live feed. Never use real private data in
the existing prototype ledger until its documented storage limitations are addressed.

## Limits and next integration

No model, Relay authentication, PC execution, screen capture, camera, background
microphone, internet permission, or automatic message sending is implemented.
Local notes are sandboxed app preferences, not application-level encrypted storage.
Backups are disabled; uninstalling loses notes. No ChatGPT history sync.

The existing ledger is a trusted-local-code demo, not an authenticated API. Do not
expose its approval methods to a mobile client. Verify the live workstation source
and implement a separate authenticated read-only adapter before adding remote
status. Then add server-held model credentials and explicit, scoped action approval.

Device acceptance: install APK on Andrew's Samsung; verify large text, rotation,
keyboard/insets, speech cancellation/unavailable provider, note persistence after
restart, JSON import errors, and spoken output stopping when app is backgrounded.
These physical-device checks are not replaced by CI lint or Python tests.
