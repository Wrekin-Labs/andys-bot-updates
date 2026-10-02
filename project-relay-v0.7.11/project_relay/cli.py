from __future__ import annotations

import argparse
import json

from .approvals import ApprovalStore
from .audit import AuditLog
from .discovery import discover_devices
from .policy import plan
from .print_jobs import prepare_document_print
from .serialio import prepare_serial_read
from .root_policy import local_list_roots, local_add_root, local_remove_root
from .owner_full_control import status as owner_status, set_local as set_owner_full_control


def _dump(value) -> None:
    print(json.dumps(value, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(prog="relay")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("devices", help="Read-only device discovery")
    p = sub.add_parser("plan", help="Classify an intended action without executing it")
    p.add_argument("action")
    p.add_argument("device")
    p.add_argument("summary")

    sub.add_parser("approvals", help="List pending local approvals")
    approve = sub.add_parser("approve", help="Approve one exact pending action locally")
    approve.add_argument("approval_id")

    audit = sub.add_parser("audit-verify", help="Verify the local chained audit log")

    sub.add_parser("roots-list", help="List locally configured extra approved filesystem roots")
    roots_add = sub.add_parser("roots-add", help="Locally add an extra approved filesystem root")
    roots_add.add_argument("path")
    roots_remove = sub.add_parser("roots-remove", help="Locally remove an extra approved filesystem root")
    roots_remove.add_argument("path")

    sub.add_parser("owner-status", help="Show whether local Owner Full Control is enabled")
    sub.add_parser("owner-enable", help="Enable Owner Full Control locally on this workstation")
    sub.add_parser("owner-disable", help="Revoke Owner Full Control locally on this workstation")

    pp = sub.add_parser("prepare-print", help="Prepare a local print approval without printing")
    pp.add_argument("device_id")
    pp.add_argument("file_ref")
    pp.add_argument("--copies", type=int, default=1)

    sr = sub.add_parser("prepare-serial-read", help="Prepare a bounded serial read without opening the port")
    sr.add_argument("device_id")
    sr.add_argument("--seconds", type=float, default=2.0)
    sr.add_argument("--baudrate", type=int, default=115200)
    sr.add_argument("--max-bytes", type=int, default=4096)

    args = parser.parse_args()
    if args.command == "devices":
        _dump([d.to_dict() for d in discover_devices()])
        return 0
    if args.command == "plan":
        _dump(plan(args.action, args.device, args.summary).to_dict())
        return 0
    if args.command == "approvals":
        _dump([r.to_dict() for r in ApprovalStore().pending()])
        return 0
    if args.command == "approve":
        _dump(ApprovalStore().approve(args.approval_id).to_dict())
        return 0
    if args.command == "audit-verify":
        ok, count = AuditLog().verify()
        _dump({"ok": ok, "entries": count})
        return 0 if ok else 2
    if args.command == "roots-list":
        _dump(local_list_roots())
        return 0
    if args.command == "roots-add":
        _dump(local_add_root(args.path))
        return 0
    if args.command == "roots-remove":
        _dump(local_remove_root(args.path))
        return 0
    if args.command == "owner-status":
        _dump(owner_status())
        return 0
    if args.command == "owner-enable":
        _dump(set_owner_full_control(True))
        return 0
    if args.command == "owner-disable":
        _dump(set_owner_full_control(False))
        return 0
    if args.command == "prepare-print":
        _dump(prepare_document_print(args.device_id, args.file_ref, args.copies))
        return 0
    if args.command == "prepare-serial-read":
        _dump(prepare_serial_read(args.device_id, args.seconds, args.baudrate, args.max_bytes))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
