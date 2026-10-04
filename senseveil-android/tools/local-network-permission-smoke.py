#!/usr/bin/env python3
"""API-37 CI emulator only: ACCESS_LOCAL_NETWORK revoke -> clear status, grant -> bridge connects.

Uses the synthetic mock bridge on the CI host (reachable from the emulator as 10.0.2.2, an
RFC 1918 address, so the default local-only host policy allows it). Debug build only: preferences
are seeded with run-as. Results are written as JUnit XML next to the other device-audit output.
"""
import base64
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = "uk.co.wrekinlabs.senseveil"
PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"
PAIR = "ci0123456789abcdef00"  # throwaway CI-only value, never a real device pair code
OUT = Path("app/build/device-audit")
OUT.mkdir(parents=True, exist_ok=True)
serial = os.environ.get("ANDROID_SERIAL") or subprocess.check_output(["adb", "get-serialno"], text=True).strip()
if not serial.startswith("emulator-"):
    raise SystemExit("Local-network smoke requires an explicitly selected emulator")


def adb(*args, timeout=30):
    return subprocess.check_output(["adb", "-s", serial, *args], text=True, timeout=timeout)


def sdk():
    return int(adb("shell", "getprop", "ro.build.version.sdk").strip())


def seed_preferences():
    operator = f"""<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="rf_bridge_enabled" value="true" />
    <string name="rf_bridge_host">10.0.2.2</string>
    <int name="rf_bridge_port" value="8765" />
    <string name="rf_pair_code">{PAIR}</string>
</map>"""
    first_run = """<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map><int name="guide_seen_version" value="99" /></map>"""
    adb("shell", "am", "force-stop", PACKAGE)
    for name, body in (("senseveil_operator", operator), ("senseveil_first_run", first_run)):
        encoded = base64.b64encode(body.encode()).decode()
        adb("shell", f"run-as {PACKAGE} sh -c 'mkdir -p shared_prefs && echo {encoded} | base64 -d > shared_prefs/{name}.xml'")


def screen_text():
    adb("shell", "uiautomator", "dump", "/sdcard/sv-lnp.xml")
    root = ET.fromstring(adb("shell", "cat", "/sdcard/sv-lnp.xml"))
    return "\n".join(n.get("text", "") for n in root.iter("node"))


def wait_for(pattern, timeout=40):
    deadline = time.monotonic() + timeout
    text = ""
    while time.monotonic() < deadline:
        text = screen_text()
        if re.search(pattern, text):
            return text
        time.sleep(1)
    raise AssertionError(f"'{pattern}' not shown; last screen:\n{text[-600:]}")


def launch():
    adb("shell", "am", "force-stop", PACKAGE)
    adb("shell", "am", "start", "-W", "-n", f"{PACKAGE}/.MainActivity")


suite = ET.Element("testsuite", name="LocalNetworkPermissionSmoke", tests="3", failures="0")
failures = 0
bridge = None
try:
    if sdk() < 37:
        raise SystemExit("Local-network smoke only applies to API 37+")
    adb("install", "-r", "app/build/outputs/apk/debug/app-debug.apk", timeout=120)
    adb("shell", "pm", "grant", PACKAGE, "android.permission.CAMERA")
    seed_preferences()
    bridge = subprocess.Popen([sys.executable, "tools/rf_bridge/mock_rf_bridge.py", "--pair", PAIR,
                               "--port", "8765", "--host", "0.0.0.0"], stdout=subprocess.DEVNULL)

    cases = [
        ("revokedPermissionShowsUnavailableAndNoCrash", "revoke", r"RF UNAVAILABLE"),
        ("grantedPermissionConnectsToSyntheticBridge", "grant", r"RF (CALIBRATING|READY).*SYNTHETIC"),
        # Revoking a runtime permission kills the process; the app must come back in a clear state.
        ("revokeAfterUseRelaunchesCleanly", "revoke", r"RF UNAVAILABLE"),
    ]
    for name, action, expected in cases:
        case = ET.SubElement(suite, "testcase", name=name)
        try:
            adb("shell", "pm", action, PACKAGE, PERMISSION)
            launch()
            wait_for(expected)
            if "FATAL EXCEPTION" in adb("logcat", "-d", "-b", "crash"):
                raise AssertionError("app crashed")
        except Exception as error:  # record and continue so every case reports
            failures += 1
            ET.SubElement(case, "failure", message=str(error)[:2000])
finally:
    if bridge:
        bridge.terminate()
    suite.set("failures", str(failures))
    ET.ElementTree(suite).write(OUT / "TEST-local-network-permission.xml")
sys.exit(1 if failures else 0)
