"""Exact-label UIA targeting; no screenshots, edit values or page-text dumps.

UI Automation providers may hang, so discovery/activation runs in a bounded
subprocess. Only a supplied label is matched; unexpected element names and raw
provider exceptions are never included in results or logs.
"""
from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

from .approvals import ApprovalStore
from .desktop_controls import BROWSERS, DEVICE, assert_context, desktop_context

# Exact-label targeting is also permitted in a small set of ordinary Windows
# applications. Keep this allowlist conservative: UIA names can expose document
# content, so callers still supply the exact public label and Relay never dumps
# the accessibility tree.
WINDOWS_TARGET_APPS = BROWSERS | {"outlook.exe", "explorer.exe"}

ROLES = {"button": "Button", "link": "Hyperlink"}


def _validate(label: str, role: str) -> None:
    if not isinstance(label, str) or not 1 <= len(label) <= 160:
        raise ValueError("Use a nonempty public control label of at most 160 characters")
    if any(ord(c) < 32 or ord(c) == 127 for c in label):
        raise ValueError("Control characters are forbidden in labels")
    if role not in ROLES:
        raise ValueError("role must be button or link")


def _resolve(label: str, role: str):
    _validate(label, role)
    context = desktop_context()
    if context['application'] not in BROWSERS:
        raise PermissionError("A supported browser must be in the foreground")
    from pywinauto.uia_element_info import UIAElementInfo
    root = UIAElementInfo(context['hwnd'])
    # Provider-side exact name and role filter. No ValuePattern/LegacyIAccessible
    # value, document text, edit contents, DOM or clipboard is read.
    candidates = root.descendants(control_type=ROLES[role], title=label, cache_enable=False)
    if len(candidates) > 64:
        raise PermissionError("Too many matching controls")
    matches = []
    left, top, right, bottom = context['rect']
    for element in candidates:
        if element.element.CurrentIsPassword or not element.visible or not element.enabled:
            continue
        rect = element.rectangle
        if not (left <= rect.left < rect.right <= right and top <= rect.top < rect.bottom <= bottom):
            continue
        runtime_id = element.runtime_id
        if not runtime_id:
            continue
        matches.append((element, {
            'context': context, 'label': label, 'role': role,
            'runtime_id': list(runtime_id),
            'rect': [rect.left, rect.top, rect.right, rect.bottom],
        }))
    if len(matches) != 1:
        raise PermissionError("Target must match exactly one visible enabled control")
    assert_context(context)
    return matches[0]


def _worker(operation: str, label: str, role: str, approval_id: str | None = None) -> dict[str, Any]:
    if operation not in {'find', 'prepare', 'click'}:
        raise ValueError("Unknown target operation")
    element, args = _resolve(label, role)
    if operation == 'find':
        # Do not expose provider metadata or unexpected text.
        return {'found': True, 'role': role, 'bounds': args['rect']}
    if operation == 'prepare':
        record = ApprovalStore().create(
            'commandport_click_target', DEVICE, args,
            f'Click the {role} with exact label in the current approved application: {label}', ttl_seconds=120,
        )
        return {'approval': record.to_dict()}
    if not approval_id:
        raise ValueError("approval_id is required")
    # Re-resolve from current UI state on every execution. An expired/recreated,
    # moved or ambiguous element will not match the approved arguments.
    ApprovalStore().consume(approval_id, action='commandport_click_target', device_id=DEVICE, arguments=args)
    assert_context(args['context'])
    from pywinauto.uia_element_info import UIAElementInfo
    rect = args['rect']
    x, y = (rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2
    hit = UIAElementInfo.from_point(x, y)
    # Text children can occupy the centre; permit only ancestry to the exact
    # matched target. This prevents clicking an overlay covering the target.
    for _ in range(12):
        if hit is None:
            break
        if list(hit.runtime_id or []) == args['runtime_id']:
            from .commandport import _perform_click
            _perform_click({'x': x, 'y': y, 'button': 'left', 'clicks': 1, 'context': args['context']})
            return {'clicked': True, 'role': role}
        hit = hit.parent
    raise PermissionError("Target is obscured; prepare a fresh approval")


def _request(operation: str, label: str, role: str, approval_id: str | None = None) -> dict[str, Any]:
    _validate(label, role)
    payload = {'operation': operation, 'label': label, 'role': role, 'approval_id': approval_id}
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'project_relay.browser_targets'],
            input=json.dumps(payload), text=True, capture_output=True, timeout=12, check=False,
        )
    except subprocess.TimeoutExpired:
        # Execution may have occurred before timeout. Never retry automatically.
        raise RuntimeError('UI target request timed out; outcome unknown, do not retry automatically') from None
    if result.returncode or len(result.stdout) > 16_000:
        raise RuntimeError('UI target adapter failed; no provider details returned')
    try:
        response = json.loads(result.stdout)
    except (TypeError, ValueError):
        raise RuntimeError('Invalid UI target adapter response') from None
    if not response.get('ok'):
        raise PermissionError('UI target unavailable, ambiguous, obscured, or not locally approved')
    return response['result']


def commandport_find_target(label: str, role: str = 'button') -> dict[str, Any]:
    return _request('find', label, role)


def commandport_prepare_click_target(label: str, role: str = 'button') -> dict[str, Any]:
    return _request('prepare', label, role)


def commandport_click_target(approval_id: str, label: str, role: str = 'button') -> dict[str, Any]:
    return _request('click', label, role, approval_id)


if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.read(4096))
        result = _worker(**request)
        print(json.dumps({'ok': True, 'result': result}))
    except Exception:
        # UIA errors can contain page strings: keep them entirely local/opaque.
        print(json.dumps({'ok': False}))
