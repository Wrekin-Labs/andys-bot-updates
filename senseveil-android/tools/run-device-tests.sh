#!/usr/bin/env bash
# Keep runtime evidence even when instrumentation fails.
set -uo pipefail
mkdir -p app/build/device-audit
./gradlew connectedDebugAndroidTest --no-daemon
test_status=$?
adb logcat -d > app/build/device-audit/logcat.txt 2>&1 || true
adb pull /sdcard/Android/data/uk.co.wrekinlabs.senseveil/files/qa app/build/device-audit/ >/dev/null 2>&1 || true
exit "$test_status"
