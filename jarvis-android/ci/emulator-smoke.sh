#!/usr/bin/env bash
set -eu
mkdir -p evidence
test_exit=0
gradle --no-daemon connectedDebugAndroidTest || test_exit=$?
# The test runner removes its temporary installation after tests.
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm clear uk.wrekinlabs.jarvis.dev
adb shell am start -W -n uk.wrekinlabs.jarvis.dev/uk.wrekinlabs.jarvis.MainActivity
sleep 2
adb exec-out screencap -p > evidence/jarvis-home.png
adb shell uiautomator dump /sdcard/jarvis-window.xml
adb pull /sdcard/jarvis-window.xml evidence/jarvis-window.xml
adb logcat -d -s AndroidRuntime:E > evidence/crashes.txt
exit "$test_exit"
