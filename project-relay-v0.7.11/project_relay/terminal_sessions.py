from __future__ import annotations

import ipaddress
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TextIO

from .commandport import _resolve
from .owner_full_control import require_enabled
from .runtime_config import command_is_blocked, load_runtime_config

MAX_SESSIONS = 8
MAX_BUFFER_CHARS = 1_000_000
MAX_WRITE_CHARS = 8_000
MAX_READ_CHARS = 64_000
MAX_COMMAND_CHARS = 12_000


@dataclass
class _Session:
    session_id: str
    shell: str
    process: subprocess.Popen[str]
    cwd: str
    created_at: float
    output: str = ""
    base_offset: int = 0
    lock: threading.RLock = field(default_factory=threading.RLock)

    def append(self, text: str) -> None:
        if not text:
            return
        with self.lock:
            self.output += text
            limit = min(MAX_BUFFER_CHARS, int(load_runtime_config()["max_output_chars"]))
            if len(self.output) > limit:
                trim = len(self.output) - limit
                self.output = self.output[trim:]
                self.base_offset += trim


_SESSIONS: dict[str, _Session] = {}
_LOCK = threading.RLock()


def _resolve_executable(name: str) -> str:
    value = shutil.which(name)
    if not value:
        raise RuntimeError(f"required executable is unavailable: {name}")
    return value


def _shell_argv(shell: str, command: str) -> list[str]:
    shell = str(shell or "default").lower().strip()
    if shell in {"", "default"}:
        shell = str(load_runtime_config()["default_shell"])
    command = str(command or "")
    if command_is_blocked(command):
        raise PermissionError("command is blocked by Project Relay runtime configuration")
    if len(command) > MAX_COMMAND_CHARS:
        raise ValueError("command exceeds session limit")
    if shell == "powershell":
        exe = _resolve_executable("powershell.exe" if os.name == "nt" else "pwsh")
        return [exe, "-NoLogo", "-NoProfile", "-NoExit", "-Command", command or "$null"]
    if shell == "cmd":
        if os.name != "nt":
            raise RuntimeError("cmd sessions require Windows")
        return [_resolve_executable("cmd.exe"), "/D", "/Q", "/K", command or "ver >nul"]
    if shell == "wsl":
        if os.name != "nt":
            raise RuntimeError("WSL sessions require Windows")
        exe = _resolve_executable("wsl.exe")
        init = command or ":"
        return [exe, "--", "bash", "-lc", f"{init}; exec bash"]
    if shell == "python":
        return [sys.executable, "-u", "-i", "-c", command]
    if shell == "node":
        return [_resolve_executable("node"), "-i", "-e", command]
    if shell == "r":
        exe = _resolve_executable("R")
        if command:
            return [exe, "--vanilla", "--quiet", "-e", command]
        return [exe, "--vanilla", "--quiet"]
    raise ValueError("shell must be powershell, cmd, wsl, python, node or r")


def _pump(session: _Session, stream: TextIO) -> None:
    try:
        while True:
            chunk = stream.readline()
            if chunk == "":
                break
            session.append(chunk)
    except (OSError, ValueError):
        return


def _prune() -> None:
    dead = [key for key, value in _SESSIONS.items() if value.process.poll() is not None]
    if len(_SESSIONS) <= MAX_SESSIONS:
        return
    for key in dead:
        if len(_SESSIONS) <= MAX_SESSIONS:
            break
        _SESSIONS.pop(key, None)


def owner_start_terminal_session(
    shell: str = "powershell",
    command: str = "",
    cwd: str | None = None,
) -> dict[str, Any]:
    require_enabled()
    with _LOCK:
        _prune()
        running = [s for s in _SESSIONS.values() if s.process.poll() is None]
        if len(running) >= MAX_SESSIONS:
            raise RuntimeError("maximum terminal session count reached")
        workdir = _resolve(cwd or str(Path.home()), must_exist=True)
        if not workdir.is_dir():
            raise NotADirectoryError(str(workdir))
        resolved_shell = str(shell or "default").lower().strip()
        if resolved_shell in {"", "default"}:
            resolved_shell = str(load_runtime_config()["default_shell"])
        argv = _shell_argv(resolved_shell, command)
        proc = subprocess.Popen(
            argv,
            cwd=str(workdir),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            close_fds=True,
        )
        session_id = "term-" + uuid.uuid4().hex
        session = _Session(
            session_id=session_id,
            shell=resolved_shell,
            process=proc,
            cwd=str(workdir),
            created_at=time.time(),
        )
        _SESSIONS[session_id] = session
        assert proc.stdout is not None
        thread = threading.Thread(target=_pump, args=(session, proc.stdout), daemon=True)
        thread.start()
        return {
            "session_id": session_id,
            "shell": session.shell,
            "pid": proc.pid,
            "cwd": session.cwd,
            "running": proc.poll() is None,
        }


def owner_list_terminal_sessions() -> dict[str, Any]:
    require_enabled()
    with _LOCK:
        rows = []
        for session in _SESSIONS.values():
            with session.lock:
                rows.append(
                    {
                        "session_id": session.session_id,
                        "shell": session.shell,
                        "pid": session.process.pid,
                        "cwd": session.cwd,
                        "running": session.process.poll() is None,
                        "returncode": session.process.poll(),
                        "created_at": session.created_at,
                        "output_base_offset": session.base_offset,
                        "output_end_offset": session.base_offset + len(session.output),
                    }
                )
        return {"count": len(rows), "sessions": rows}


def _get(session_id: str) -> _Session:
    value = str(session_id or "").strip()
    with _LOCK:
        session = _SESSIONS.get(value)
    if not session:
        raise KeyError("unknown terminal session")
    return session


def owner_read_terminal_output(
    session_id: str,
    offset: int | None = None,
    length: int = 32_000,
) -> dict[str, Any]:
    require_enabled()
    session = _get(session_id)
    length = max(1, min(int(length), MAX_READ_CHARS))
    with session.lock:
        start = session.base_offset if offset is None else int(offset)
        if start < session.base_offset:
            start = session.base_offset
        end_offset = session.base_offset + len(session.output)
        if start > end_offset:
            start = end_offset
        local = start - session.base_offset
        text = session.output[local : local + length]
        next_offset = start + len(text)
        return {
            "session_id": session.session_id,
            "running": session.process.poll() is None,
            "returncode": session.process.poll(),
            "offset": start,
            "next_offset": next_offset,
            "output_end_offset": end_offset,
            "text": text,
            "has_more": next_offset < end_offset,
        }


def owner_write_terminal_session(
    session_id: str,
    text: str,
    press_enter: bool = True,
) -> dict[str, Any]:
    require_enabled()
    session = _get(session_id)
    value = str(text)
    if len(value) > MAX_WRITE_CHARS:
        raise ValueError("terminal input exceeds limit")
    if "\x00" in value:
        raise ValueError("NUL characters are forbidden")
    if press_enter and command_is_blocked(value):
        raise PermissionError("command is blocked by Project Relay runtime configuration")
    if session.process.poll() is not None:
        raise RuntimeError("terminal session is no longer running")
    if session.process.stdin is None:
        raise RuntimeError("terminal session input is unavailable")
    payload = value + ("\n" if press_enter else "")
    session.process.stdin.write(payload)
    session.process.stdin.flush()
    return {
        "session_id": session.session_id,
        "accepted": True,
        "characters": len(value),
        "press_enter": bool(press_enter),
    }


def owner_stop_terminal_session(
    session_id: str,
    force: bool = False,
    tree: bool = True,
) -> dict[str, Any]:
    require_enabled()
    session = _get(session_id)
    proc = session.process
    if proc.poll() is not None:
        return {
            "session_id": session.session_id,
            "stopped": False,
            "reason": "already-exited",
            "returncode": proc.returncode,
        }
    if os.name == "nt" and tree:
        args = ["taskkill.exe", "/PID", str(proc.pid), "/T"]
        if force:
            args.append("/F")
        subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
    elif force:
        proc.kill()
    else:
        proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    return {
        "session_id": session.session_id,
        "stopped": True,
        "returncode": proc.poll(),
    }


def owner_start_ssh_session(
    host: str,
    user: str | None = None,
    port: int = 22,
    identity_file: str | None = None,
    cwd: str | None = None,
) -> dict[str, Any]:
    """Start key/agent-authenticated SSH without accepting passwords or keyboard-interactive auth."""
    require_enabled()
    hostname = str(host or "").strip()
    if not hostname or len(hostname) > 253 or hostname.startswith("-"):
        raise ValueError("invalid SSH host")
    try:
        ipaddress.ip_address(hostname)
        host_ok = True
    except ValueError:
        host_ok = all(
            part and len(part) <= 63
            and part[0].isalnum() and part[-1].isalnum()
            and all(ch.isalnum() or ch == "-" for ch in part)
            for part in hostname.split(".")
        )
    if not host_ok:
        raise ValueError("invalid SSH host")
    username = str(user or "").strip()
    if username:
        if (
            len(username) > 128
            or username.startswith("-")
            or not all(ch.isalnum() or ch in "._-" for ch in username)
        ):
            raise ValueError("invalid SSH user")
    selected_port = int(port)
    if selected_port < 1 or selected_port > 65535:
        raise ValueError("invalid SSH port")

    workdir = _resolve(cwd or str(Path.home()), must_exist=True)
    if not workdir.is_dir():
        raise NotADirectoryError(str(workdir))
    ssh = _resolve_executable("ssh.exe" if os.name == "nt" else "ssh")
    argv = [
        ssh,
        "-o", "BatchMode=yes",
        "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no",
        "-o", "StrictHostKeyChecking=yes",
        "-p", str(selected_port),
    ]
    if identity_file:
        identity = _resolve(identity_file, must_exist=True)
        if not identity.is_file():
            raise FileNotFoundError(str(identity))
        argv.extend(["-i", str(identity)])
    target = f"{username}@{hostname}" if username else hostname
    argv.append(target)

    with _LOCK:
        _prune()
        running = [s for s in _SESSIONS.values() if s.process.poll() is None]
        if len(running) >= MAX_SESSIONS:
            raise RuntimeError("maximum terminal session count reached")
        proc = subprocess.Popen(
            argv,
            cwd=str(workdir),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            close_fds=True,
        )
        session_id = "term-" + uuid.uuid4().hex
        session = _Session(
            session_id=session_id,
            shell="ssh",
            process=proc,
            cwd=str(workdir),
            created_at=time.time(),
        )
        _SESSIONS[session_id] = session
        assert proc.stdout is not None
        thread = threading.Thread(target=_pump, args=(session, proc.stdout), daemon=True)
        thread.start()
        return {
            "session_id": session_id,
            "shell": "ssh",
            "pid": proc.pid,
            "cwd": session.cwd,
            "running": proc.poll() is None,
            "host": hostname,
            "port": selected_port,
            "password_authentication": False,
            "strict_host_key_checking": True,
        }
