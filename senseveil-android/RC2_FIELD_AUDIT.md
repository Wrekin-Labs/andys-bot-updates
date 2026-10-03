# SenseVeil AI v1.0.0-rc2 — phone feedback pass

## Scope and findings

The owner successfully installed RC1 and provided two real-phone screenshots on 3 October 2026: the scanner and its manual event log. They expose a crowded overlay, a wrapped header overlapping the status panel, implausible-looking 8–10 m shoulder-size estimates for a close indoor scene, and a small-text event log that does not distinguish a logged image from completed evidence. The screenshots do not establish a ground-truth distance, camera alignment accuracy, or cryptographic validity.

Private owner photos are not committed to this public repository. Regression screenshots use the test emulator only.

| Step | Finding | RC2 change | Check |
| --- | --- | --- | --- |
| 1. Scan in Field mode | Generic furniture boxes obscure the scene; a range guess looks like a measurement. | Simple person outline; detailed boxes and skeleton remain in Lab. Field shows unmeasured range and labels the fusion score. Vision map is explicitly direction-only. | Portrait/landscape screenshots; range gate unit tests. |
| 2. Capture | Buffer updates overwrite the saving message; repeated taps create a confusing list. | Dedicated process-owned saving/sealed indicator survives rotation; 900 ms manual tap debounce. | Real emulator capture, rotation, signed bundle verification. |
| 3. Find an event | Dense 11 sp log; only the latest event can be shared. | Larger event cards, count, alert filter, refresh, per-event Review/Verify/Share, disabled unsealed actions. | Selected older capture verifies and exports while the newest is unsealed. |
| 4. Review and verify | Recorded readings are easy to confuse with verified evidence. | Photo preview and full detail view; signature/hash verdict remains a separate explicit check. Export verifies first and reports errors in a visible panel. | Device regression checks selected bundle name, verification verdict and ZIP contents. |
| 5. Use Tools | Long undifferentiated control list. | Scanning, signer trust, device/help, and evidence/session sections; all existing controls retained. Help explains saving, range and export. | Scroll, Back, diagnostics and quick-start device tests. |

## Range limits

Inspection of the pinned `pose-detection-common:18.0.0-beta5` implementation confirmed that its pose task constructs `Pose` with a null transform and does not apply the matrix supplied by CameraX. Face/object detectors do apply their transforms. RC2 adds a frame-timestamp-keyed pose projection through the sensor and actual CameraX viewport; only pose points receive this extra mapping. Regression coverage checks all four right-angle rotations plus crop/scale and rejects invalid rotation. This addresses the mixed coordinate spaces that could misplace skeletons and inflate shoulder-based distances.

The existing monocular feature is retained in Lab and recorded evidence, with stricter visibility, confidence, face association and frontal-pose gates. It remains an adult shoulder-size and fixed-lens heuristic, not AR depth, radar range or a calibrated measurement. Sideways, tiny, clipped or low-confidence shoulder spans return no estimate. An unrelated external reading is no longer used as a person's visual range fallback. The vision map no longer invents a 3 m visual range when none is known.

## Preservation and release limits

No detection model, fusion, consensus, evidence signing/encryption, custody chain, external SV1 parser, AR capability probe, replay or diagnostic feature is removed. Lab exposes detailed detection overlays. The APK keeps the application ID and increases versionCode to 11; the downloadable build uses the same local debug certificate as the working RC1 download.

Actual radar/thermal vendor transports and live AR depth capture remain outside the supplied implementation. Physical-phone validation of the updated overlay, real-world ranging limits, TalkBack, enlarged system fonts and long sessions remains necessary. Screenshots alone do not establish accessibility compliance.

## Verified result

Application source `fa14d06343976cf6226481bd5f7da9e7afa6b783` passed [GitHub run 37114880198](https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/37114880198): 23 JVM, five Python verifier and five Android device tests (33 total), with no failures. Android lint has zero errors and 112 warnings; no error baselines or disabled checks. Both app and test APKs also built successfully on Andy Home.

The final APK is signed with the same debug key as the working RC1 download and passes 16 KB ZIP alignment. SHA-256: `b95b14c23f0fa792736566e4deabd513bb01d8d3ab9fc0bcedc33f9818f58e48`.

Visual inspection confirms separated header/status panels, readable event cards, disabled unsealed actions, clear verification verdicts, scrollable details/Tools, and reachable controls in landscape. The emulator camera uses a test pattern, so these screenshots do not validate real-person pose alignment or detection accuracy. An initial Home emulator run was obstructed by a System UI ANR; the full final CI device run passed.

### Audit screenshots

[Portrait scanner](docs/qa/rc2/scanner-portrait.png) · [Landscape scanner](docs/qa/rc2/scanner-landscape.png) · [Event cards](docs/qa/rc2/events-cards.png) · [Verification](docs/qa/rc2/event-verified.png) · [Event details](docs/qa/rc2/event-review.png) · [Tools](docs/qa/rc2/tools-bottom.png)
