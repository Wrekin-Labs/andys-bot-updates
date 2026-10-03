# v1.0.0-rc2 UI and functionality audit

3 October 2026. Current application source `fa14d06343976cf6226481bd5f7da9e7afa6b783`.

The [RC2 field audit](RC2_FIELD_AUDIT.md) covers the five-step scan/capture/history/review/Tools flow, fixes based on owner phone screenshots, final emulator screenshots, and remaining physical-device checks.

All 33 tests pass (23 JVM, five Python, five Android). [Final CI build and device jobs are green](https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/37114880198). Lint has zero errors and 112 warnings. The user’s real photos are not published.

---

# Historical RC1 UI and functionality audit

3 October 2026. Final application source: `a976c34`. Android API 35, emulated rear camera, portrait and landscape. Screenshots and test reports are in [the passing CI run](https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/37111281645).

| Area | Result |
| --- | --- |
| Launch | AppCompat theme corrected; successful Activity launch and recreation. |
| Portrait scanner | Header, live preview, status, radar and four primary controls visible and readable. Camera and rolling buffer active. |
| Landscape scanner | Radar moved alongside status; it no longer sits behind the bottom controls. |
| Tools | Full list scrolls. Quick Start is reachable; Back returns to the scrolled Tools list, then scanner. Buttons use 48 dp touch targets. |
| Rotation | ML Kit callbacks cannot target a terminated worker. Retired screens discard late analysis results. |
| Capture | Real emulator image capture followed by rotation completes the post-window and produces a valid signed bundle. Video completion and telemetry completion precede sealing. |
| Integrity and vault | Android Keystore signing and AES-GCM round trip pass. Modified evidence/tag is rejected. Unauthenticated plaintext is not published. |
| Diagnostics | Diagnostics ZIP is created successfully. Evidence media is excluded. |
| Large histories | Event/session summaries stream input; evidence review and replay verification run off the UI thread. |
| External sensors / AR | SV1 protocol, adapter interfaces, replay protection and ARCore capability probing retained. Vendor transports and live depth capture were not present in the supplied baseline. |

## Automated verification

- 19 JVM tests: pass.
- 5 independent desktop verifier tests: pass.
- 3 Android instrumentation tests: pass on Andy Home and CI.
- Gradle compile, debug/instrumentation APK assembly and lint: pass, no errors.
- 110 non-blocking lint warnings remain (predominantly localisation, style suggestions and dependency notices); no checks disabled or errors baselined.

## Physical-device follow-up

Validate real-world camera/ML accuracy, dark/moving scenes, microphone opt-in and denial, haptics, thermal/battery behaviour, long recording/low-storage behaviour, physical radar/thermal adapters and supported/unsupported ARCore phones. Emulator results do not establish measurement accuracy. This is a testable release candidate, not a production store release.
