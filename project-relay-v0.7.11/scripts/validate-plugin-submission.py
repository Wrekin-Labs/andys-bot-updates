from __future__ import annotations

import argparse
import json
import re
import sys
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugins" / "project-relay"
HOSTED_MCP_SOURCE = ROOT / "supabase" / "functions" / "project-relay-mcp" / "index.ts"
CANONICAL_MCP = "https://project-relay-mcp-gateway.onrender.com/mcp"
SITE = "https://project-relay-mcp-gateway.onrender.com"
OAUTH_DISCOVERY = SITE + "/.well-known/oauth-authorization-server"


class ValidationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(data, dict), f"{path} must contain a JSON object")
    return data


def validate_static() -> dict[str, Any]:
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    version = str(pyproject["project"]["version"])

    plugin_path = PLUGIN_DIR / "plugin.json"
    mcp_path = PLUGIN_DIR / "mcp.json"
    skill_path = PLUGIN_DIR / "skills" / "project-relay" / "SKILL.md"

    plugin = load_json(plugin_path)
    mcp = load_json(mcp_path)

    require(plugin.get("name") == "project-relay", "plugin name must be project-relay")
    require(
        str(plugin.get("version")) == version,
        f"plugin version {plugin.get('version')!r} does not match package {version!r}",
    )

    server = ((mcp.get("mcpServers") or {}).get("project-relay") or {})
    require(server.get("type") == "streamable-http", "MCP transport must be streamable-http")
    require(server.get("url") == CANONICAL_MCP, "plugin MCP URL is not the canonical production endpoint")

    interface = (((plugin.get("extensions") or {}).get("com.openai") or {}).get("interface") or {})
    prompts = interface.get("defaultPrompt") or []
    require(isinstance(prompts, list), "defaultPrompt must be a list")
    require(1 <= len(prompts) <= 3, "submission must contain between one and three starter prompts")

    for key in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        value = str(interface.get(key) or "")
        require(value.startswith("https://"), f"{key} must be HTTPS")

    require((PLUGIN_DIR / "assets" / "logo.svg").is_file(), "logo.svg is missing")
    require((PLUGIN_DIR / "assets" / "composer-icon.svg").is_file(), "composer-icon.svg is missing")
    require(skill_path.is_file(), "Project Relay skill is missing")

    return {
        "ok": True,
        "package_version": version,
        "mcp_url": CANONICAL_MCP,
        "starter_prompt_count": len(prompts),
    }


def local_hosted_contract() -> dict[str, Any]:
    source = HOSTED_MCP_SOURCE.read_text(encoding="utf-8")
    version_match = re.search(
        r'serverInfo:\{name:"Project Relay",version:"([^"]+)"\}',
        source,
    )
    require(version_match is not None, "hosted MCP server version metadata is missing")

    public_match = re.search(
        r"const PUBLIC_TOOLS = new Set\(\[(.*?)\]\);",
        source,
        re.S,
    )
    require(public_match is not None, "hosted MCP PUBLIC_TOOLS catalogue is missing")
    tool_names = set(re.findall(r'"([a-z0-9_]+)"', public_match.group(1)))
    require(bool(tool_names), "hosted MCP PUBLIC_TOOLS catalogue is empty")
    return {
        "version": version_match.group(1),
        "tools": tool_names,
    }


def request_status(url: str, *, timeout: float = 60.0, attempts: int = 2) -> int:
    last_error: Exception | None = None
    for attempt in range(max(1, attempts)):
        req = urllib.request.Request(url, method="GET", headers={"user-agent": "ProjectRelayCI/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return int(response.status)
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2.0)
    assert last_error is not None
    raise last_error


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    timeout: float = 45.0,
    attempts: int = 2,
) -> tuple[int, dict[str, Any]]:
    data = None
    headers = {"accept": "application/json", "user-agent": "ProjectRelayCI/1.0"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"
        headers["mcp-protocol-version"] = "2025-11-25"
    last_error: Exception | None = None
    for attempt in range(max(1, attempts)):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                text = response.read().decode("utf-8", errors="replace")
                return response.status, json.loads(text)
        except urllib.error.HTTPError as exc:
            text = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = {"raw": text}
            return exc.code, parsed
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2.0)
    assert last_error is not None
    raise last_error


def rpc(method: str, params: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    return request_json(
        CANONICAL_MCP,
        method="POST",
        body={
            "jsonrpc": "2.0",
            "id": method,
            "method": method,
            "params": params or {},
        },
    )


def validate_live_core() -> dict[str, Any]:
    # Render's free-tier gateway can cold-start after inactivity. Warm the public
    # origin first so MCP contract checks measure application health, not boot latency.
    require(request_status(SITE) == 200, "Project Relay public gateway is unavailable")

    init_status, initialized = rpc(
        "initialize",
        {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "relay-ci", "version": "1.0"},
        },
    )
    require(init_status == 200, f"MCP initialize returned HTTP {init_status}")
    server_info = ((initialized.get("result") or {}).get("serverInfo") or {})
    require(server_info.get("name") == "Project Relay", "unexpected MCP server name")
    expected = local_hosted_contract()
    require(
        server_info.get("version") == expected["version"],
        f"live MCP version {server_info.get('version')!r} does not match repository {expected['version']!r}",
    )

    tools_status, tools_result = rpc("tools/list")
    require(tools_status == 200, f"tools/list returned HTTP {tools_status}")
    tools = ((tools_result.get("result") or {}).get("tools") or [])
    require(isinstance(tools, list) and len(tools) > 0, "public MCP tool catalogue is empty")
    live_tool_names = {
        str(tool.get("name"))
        for tool in tools
        if isinstance(tool, dict) and tool.get("name")
    }
    require(
        live_tool_names == expected["tools"],
        "live MCP tool catalogue drift: "
        f"missing={sorted(expected['tools'] - live_tool_names)!r}, "
        f"unexpected={sorted(live_tool_names - expected['tools'])!r}",
    )

    call_status, unauth = rpc(
        "tools/call",
        {"name": "list_workstations", "arguments": {}},
    )
    require(call_status == 200, f"unauthenticated tools/call returned HTTP {call_status}")
    result = unauth.get("result") or {}
    require(result.get("isError") is True, "unauthenticated tool call should fail closed")
    challenges = ((result.get("_meta") or {}).get("mcp/www_authenticate") or [])
    require(bool(challenges), "unauthenticated tool call did not return an OAuth challenge")

    resource_status, resource = request_json(
        CANONICAL_MCP + "/.well-known/oauth-protected-resource"
    )
    require(resource_status == 200, "protected-resource metadata is unavailable")
    require(resource.get("resource") == CANONICAL_MCP, "protected resource URL is incorrect")

    for path in ("/plans", "/account", "/support", "/privacy", "/terms"):
        require(
            request_status(SITE + path, timeout=45.0) == 200,
            f"site path {path} is unavailable",
        )

    oauth_status, oauth_body = request_json(OAUTH_DISCOVERY)
    oauth_enabled = oauth_status == 200
    require(oauth_enabled, f"OAuth discovery returned HTTP {oauth_status}")
    scopes = oauth_body.get("scopes_supported") or []
    require("relay:inspect" in scopes, "OAuth discovery is missing relay:inspect scope")
    require("openid" in scopes and "email" in scopes, "OAuth discovery is missing openid/email scopes")
    require(
        oauth_body.get("userinfo_endpoint") == SITE + "/oauth/userinfo",
        "OAuth UserInfo endpoint is missing or incorrect",
    )
    require("S256" in (oauth_body.get("code_challenge_methods_supported") or []), "OAuth PKCE S256 is missing")

    return {
        "ok": True,
        "mcp_server": server_info,
        "tool_count": len(tools),
        "repository_tool_count": len(expected["tools"]),
        "catalog_matches_repository": True,
        "oauth_challenge": True,
        "protected_resource": True,
        "site_pages": True,
        "commercial_pages": True,
        "oauth_enabled": oauth_enabled,
        "oauth_status": oauth_status,
        "oauth_body": oauth_body,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-core", action="store_true")
    args = parser.parse_args()

    try:
        report: dict[str, Any] = {"static": validate_static()}
        if args.live_core:
            report["live_core"] = validate_live_core()
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        print(f"Project Relay submission validation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
