#!/usr/bin/env python3
"""API-35 CI emulator only: deny camera, then grant in Settings and resume."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = "uk.co.wrekinlabs.senseveil"
OUT = Path("app/build/device-audit")
OUT.mkdir(parents=True, exist_ok=True)
serial = os.environ.get("ANDROID_SERIAL") or subprocess.check_output(["adb", "get-serialno"], text=True).strip()
if not serial.startswith("emulator-"):
    raise SystemExit("Permission smoke requires an explicitly selected emulator")


def adb(*args, binary=False, timeout=20):
    return subprocess.check_output(["adb", "-s", serial, *args], text=not binary, timeout=timeout)


def snapshot():
    adb("shell", "uiautomator", "dump", "/sdcard/senseveil-permission-ui.xml")
    return ET.fromstring(adb("shell", "cat", "/sdcard/senseveil-permission-ui.xml"))


def wait_for(predicate, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        root = snapshot()
        for node in root.iter("node"):
            if predicate(node):
                return node
        time.sleep(0.5)
    raise AssertionError("Expected permission-flow control did not appear")


def text_is(label):
    return lambda node: node.get("text", "").casefold() == label.casefold()


def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.attrib["bounds"]))
    adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))


def capture(name):
    (OUT / f"{name}.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    root = snapshot()
    ET.ElementTree(root).write(OUT / f"{name}.xml")


suite = ET.Element("testsuite", name="CameraPermissionSmoke", tests="2", failures="0")
failed = False
try:
    case = ET.SubElement(suite, "testcase", name="denialKeepsSavedEventsAccessible")
    # Gradle's connected-test runner may uninstall the target during cleanup.
    # Always install the exact APK built for this run before the standalone flow.
    adb("install", "-r", "app/build/outputs/apk/debug/app-debug.apk", timeout=120)
    adb("shell", "am", "force-stop", PACKAGE)
    adb("shell", "pm", "revoke", PACKAGE, "android.permission.CAMERA")
    adb("shell", "pm", "clear-permission-flags", PACKAGE, "android.permission.CAMERA", "user-set", "user-fixed")
    adb("shell", "am", "start", "-W", "-n", f"{PACKAGE}/.MainActivity")
    deny = wait_for(lambda n: n.get("resource-id", "").endswith(":id/permission_deny_button"))
    tap(deny)
    wait_for(text_is("CAMERA PERMISSION REQUIRED"))
    wait_for(text_is("CAMERA ACCESS"))
    capture("permission-denied")
    tap(wait_for(text_is("EVENTS")))
    wait_for(text_is("Events"))
    tap(wait_for(text_is("CLOSE")))

    case = ET.SubElement(suite, "testcase", name="settingsGrantResumesExistingCameraActivity")
    tap(wait_for(text_is("CAMERA ACCESS")))
    wait_for(text_is("Open settings"))
    capture("permission-recovery")
    tap(wait_for(text_is("Open settings")))
    wait_for(lambda n: n.get("package") == "com.android.settings")
    # Grant while the original app Activity is stopped, then return with Back.
    # Relaunching MainActivity here would miss the onResume regression.
    adb("shell", "pm", "grant", PACKAGE, "android.permission.CAMERA")
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    wait_for(lambda n: text_is("CAPTURE")(n) and n.get("enabled") == "true")
    capture("permission-restored")
except Exception as error:
    failed = True
    suite.set("failures", "1")
    ET.SubElement(case, "failure", message=str(error)).text = repr(error)
    if len(suite) == 1:
        suite.set("skipped", "1")
        ET.SubElement(ET.SubElement(suite, "testcase", name="settingsGrantResumesExistingCameraActivity"), "skipped")
    try:
        capture("permission-failure")
    except Exception:
        pass
finally:
    ET.ElementTree(suite).write(OUT / "permission-smoke-results.xml", encoding="utf-8", xml_declaration=True)
    try:
        adb("shell", "pm", "grant", PACKAGE, "android.permission.CAMERA")
    except subprocess.SubprocessError:
        pass  # Preserve the original failure and its JUnit/screenshot evidence.
print(json.dumps({"permission_smoke": "FAILED" if failed else "PASS", "checks": 2}))
raise SystemExit(1 if failed else 0)
