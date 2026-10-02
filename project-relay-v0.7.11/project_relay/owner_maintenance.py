from __future__ import annotations

import os
import subprocess
from typing import Any

from .approvals import ApprovalStore
from .audit import AuditLog
from .state import state_dir

OWNER_DEVICE = "owner:maintenance"
POWER_ACTIONS = {"shutdown", "restart", "sleep"}
SERVICE_ACTIONS = {"start", "stop", "restart"}

def _windows() -> None:
    if os.name != "nt":
        raise RuntimeError("Owner maintenance controls require Windows")

def _audit(event: str, data: dict[str, Any]) -> None:
    AuditLog(state_dir() / "audit.jsonl").append(event, data)

def commandport_list_process_details(limit: int = 250) -> dict[str, Any]:
    """Bounded process identity/status for owner diagnostics; never returns environment variables."""
    _windows()
    limit = max(1, min(int(limit), 500))
    script = (
        "Get-CimInstance Win32_Process | Select-Object -First " + str(limit) +
        " ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
    )
    result = subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script],
                            text=True,capture_output=True,timeout=15,check=False)
    if result.returncode:
        raise RuntimeError("Process inspection failed")
    import json
    rows = json.loads(result.stdout or "[]")
    if isinstance(rows, dict):
        rows = [rows]
    # Command lines can contain credentials. Redact arguments and expose only executable/module identity.
    safe = []
    for row in rows[:limit]:
        command = str(row.get("CommandLine") or "")
        first = command.strip().split(" ", 1)[0] if command else ""
        safe.append({"pid":row.get("ProcessId"),"name":row.get("Name"),
                     "path":row.get("ExecutablePath"),"command":first})
    return {"count":len(safe),"processes":safe}

def commandport_prepare_power(action: str) -> dict[str, Any]:
    _windows()
    action = str(action).lower().strip()
    if action not in POWER_ACTIONS:
        raise ValueError("action must be shutdown, restart or sleep")
    args = {"action":action}
    rec = ApprovalStore().create("commandport_power", OWNER_DEVICE, args,
        f"Owner maintenance: {action} this workstation", ttl_seconds=120)
    return {"approval":rec.to_dict()}

def commandport_power(approval_id: str, action: str) -> dict[str, Any]:
    _windows()
    action = str(action).lower().strip()
    args = {"action":action}
    ApprovalStore().consume(approval_id,action="commandport_power",device_id=OWNER_DEVICE,arguments=args)
    _audit("owner.power",{"action":action})
    if action == "shutdown":
        subprocess.Popen(["shutdown.exe","/s","/t","0"],close_fds=True)
    elif action == "restart":
        subprocess.Popen(["shutdown.exe","/r","/t","0"],close_fds=True)
    elif action == "sleep":
        subprocess.Popen(["rundll32.exe","powrprof.dll,SetSuspendState","0,1,0"],close_fds=True)
    else:
        raise ValueError("action must be shutdown, restart or sleep")
    return {"accepted":True,"action":action}

def commandport_list_services(limit: int = 250) -> dict[str, Any]:
    _windows()
    limit=max(1,min(int(limit),500))
    script=("Get-Service | Select-Object -First "+str(limit)+
            " Name,DisplayName,Status,StartType | ConvertTo-Json -Compress")
    r=subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script],
                     text=True,capture_output=True,timeout=15,check=False)
    if r.returncode: raise RuntimeError("Service inspection failed")
    import json
    rows=json.loads(r.stdout or "[]")
    if isinstance(rows,dict): rows=[rows]
    return {"count":len(rows),"services":rows}

def commandport_prepare_service(service: str, action: str) -> dict[str, Any]:
    _windows()
    service=str(service).strip()
    action=str(action).lower().strip()
    if not service or len(service)>128: raise ValueError("invalid service name")
    if action not in SERVICE_ACTIONS: raise ValueError("action must be start, stop or restart")
    args={"service":service,"action":action}
    rec=ApprovalStore().create("commandport_service",OWNER_DEVICE,args,
        f"Owner maintenance: {action} Windows service {service}",ttl_seconds=120)
    return {"approval":rec.to_dict()}

def commandport_service(approval_id: str, service: str, action: str) -> dict[str, Any]:
    _windows()
    service=str(service).strip(); action=str(action).lower().strip()
    args={"service":service,"action":action}
    ApprovalStore().consume(approval_id,action="commandport_service",device_id=OWNER_DEVICE,arguments=args)
    verb={"start":"Start-Service","stop":"Stop-Service","restart":"Restart-Service"}[action]
    r=subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",
                      f"{verb} -Name $args[0] -ErrorAction Stop",service],
                     text=True,capture_output=True,timeout=30,check=False)
    if r.returncode: raise RuntimeError("Service control failed")
    _audit("owner.service",args)
    return {"completed":True,**args}
