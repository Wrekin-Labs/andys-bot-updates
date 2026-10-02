import json
import urllib.request

from project_relay.cloud_credentials import load_cloud_secret
from project_relay.state import state_dir

state = state_dir()
cfg = json.loads((state / "cloud.json").read_text(encoding="utf-8"))
token = load_cloud_secret("controller")
url = cfg["mcp_endpoint"]

def call(message, authenticated=True):
    body = json.dumps(message).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
        "User-Agent": "ProjectRelaySelfTest/0.3.2",
    }
    if authenticated:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=70) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def get_json(target):
    req = urllib.request.Request(target, headers={"User-Agent": "ProjectRelaySelfTest/0.3.2"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))

metadata = get_json(url + "/.well-known/oauth-protected-resource")
anonymous_tools = call({"jsonrpc":"2.0","id":90,"method":"tools/list","params":{}}, authenticated=False)
anonymous_call = call({"jsonrpc":"2.0","id":91,"method":"tools/call","params":{"name":"list_workstations","arguments":{}}}, authenticated=False)

init = call({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"self-test","version":"0.3.2"}}})
tools = call({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
devices = call({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_devices","arguments":{}}})
bridges = call({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_bridges","arguments":{}}})
plan = call({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"plan_bridge_action","arguments":{"bridge_id":"cadbridge","action":"start_printer_job"}}})
cad_read = call({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"execute_bridge_read","arguments":{"bridge_id":"cadbridge","action":"list_parts","args":{}}}})

server = init["result"]["serverInfo"]
tool_rows = tools["result"]["tools"]
structured = devices["result"].get("structuredContent", {})
hardware = structured.get("devices", [])
bridge_rows = bridges["result"].get("structuredContent", {}).get("bridges", [])
plan_row = plan["result"].get("structuredContent", {}).get("plan", {})
cad_result = cad_read["result"].get("structuredContent", {}).get("result")
challenge = anonymous_call["result"].get("_meta", {}).get("mcp/www_authenticate", [])
anon_tool_rows = anonymous_tools["result"]["tools"]
assert metadata["resource"] == url
assert metadata["authorization_servers"]
assert len(anon_tool_rows) == len(tool_rows)
assert all(t.get("securitySchemes", [{}])[0].get("type") == "oauth2" for t in anon_tool_rows)
assert anonymous_call["result"].get("isError") is True
assert challenge and "resource_metadata=" in challenge[0]
tool_names = {t.get("name") for t in tool_rows}
for required in (
    "commandport_list_directory",
    "commandport_read_text_file",
    "commandport_list_processes",
    "commandport_prepare_write_file",
    "commandport_write_file",
    "commandport_prepare_run_command",
    "commandport_run_command",
):
    assert required in tool_names, f"missing hosted CommandPort tool: {required}"

print("SERVER", server["name"], server["version"])
print("PROTOCOL", init["result"]["protocolVersion"])
print("TOOLS", len(tool_rows))
print("DEVICE_COUNT", len(hardware))
print("KINDS", ",".join(sorted({d.get("kind","") for d in hardware})))
print("BRIDGES", ",".join(sorted(b.get("id","") for b in bridge_rows)))
print("CAD_PHYSICAL_EXECUTABLE", plan_row.get("executable"))
print("CAD_READ_OK", cad_result is not None)
print("OAUTH_METADATA_OK", True)
print("OAUTH_CHALLENGE_OK", True)
