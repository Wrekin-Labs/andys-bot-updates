from __future__ import annotations

import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_MCP = os.environ.get(
    "UPSTREAM_MCP",
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-mcp",
).rstrip("/")
ACCOUNT_PAGE = os.environ.get(
    "PROJECT_RELAY_ACCOUNT_PAGE",
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-account",
)
SITE_PAGE = os.environ.get(
    "PROJECT_RELAY_SITE_PAGE",
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-site",
)
SUPABASE_URL = os.environ.get(
    "PROJECT_RELAY_SUPABASE_URL",
    "https://dbhwjzznwhukoogjewfl.supabase.co",
).rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.environ.get("PROJECT_RELAY_SUPABASE_PUBLISHABLE_KEY", "").strip()
OAUTH_BROKER_URL = os.environ.get(
    "PROJECT_RELAY_OAUTH_BROKER_URL",
    SUPABASE_URL + "/functions/v1/project-relay-oauth-broker",
)
OAUTH_BROKER_TOKEN = os.environ.get("PROJECT_RELAY_OAUTH_BROKER_TOKEN", "").strip()
PUBLIC_ORIGIN = os.environ.get(
    "PROJECT_RELAY_PUBLIC_ORIGIN",
    "https://project-relay-mcp-gateway.onrender.com",
).rstrip("/")
PORT = int(os.environ.get("PORT", "10000"))
CHALLENGE = os.environ.get("OPENAI_APPS_CHALLENGE", "").strip()

ISSUER = PUBLIC_ORIGIN
RESOURCE = PUBLIC_ORIGIN + "/mcp"
OAUTH_SCOPE = "relay:inspect"
OAUTH_SCOPES = (OAUTH_SCOPE, "openid", "email")
CHATGPT_CLIENT_HOST = "chatgpt.com"
CHATGPT_STABLE_CLIENT = "https://chatgpt.com/oauth/client.json"
CHATGPT_STABLE_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"


class RelayGateway(BaseHTTPRequestHandler):
    server_version = "ProjectRelayGateway/0.3"

    def _public_origin(self) -> str:
        return PUBLIC_ORIGIN

    def _public_mcp(self) -> str:
        return RESOURCE

    def _send(self, status: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.send_header("x-content-type-options", "nosniff")
        if extra:
            for key, value in extra.items():
                if key.lower() not in {"content-length", "transfer-encoding", "connection"}:
                    self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, value: object, extra: dict[str, str] | None = None) -> None:
        headers = {"cache-control": "no-store"}
        if extra:
            headers.update(extra)
        self._send(status, json.dumps(value, separators=(",", ":")).encode(), "application/json; charset=utf-8", headers)

    def _redirect(self, location: str, status: int = 302) -> None:
        self.send_response(status)
        self.send_header("location", location)
        self.send_header("cache-control", "no-store")
        self.send_header("referrer-policy", "no-referrer")
        self.send_header("content-length", "0")
        self.end_headers()

    def _oauth_return_page(self, location: str) -> None:
        # Some mobile browsers leave the consent form visible after a cross-site
        # POST redirect. Give the user a real link as well as a timed navigation.
        # The code stays in this no-store, same-origin page and is never logged.
        target = html.escape(location, quote=True)
        page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="1;url={target}">
<title>Return to ChatGPT</title>
<style>body{{font-family:system-ui;background:#101217;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}}
main{{max-width:28rem;padding:2rem;text-align:center}}a{{display:block;background:#ff6a00;color:#111;padding:1rem;border-radius:.7rem;font-weight:700;text-decoration:none}}</style>
</head><body><main><h1>Project Relay approved</h1><p>Returning to ChatGPT…</p>
<a href="{target}" rel="noreferrer">Continue to ChatGPT</a>
<p>If the page stays here, tap the button above.</p></main></body></html>"""
        self._send(200, page.encode(), "text/html; charset=utf-8", {
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        })

    def _append_query(self, url: str, params: list[tuple[str, str]]) -> str:
        parts = urllib.parse.urlsplit(url)
        current = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        current.extend(params)
        return urllib.parse.urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(current), parts.fragment)
        )

    def _read_form(self) -> dict[str, str]:
        length = int(self.headers.get("content-length", "0") or "0")
        raw = self.rfile.read(length) if length else b""
        content_type = self.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                data = json.loads(raw.decode("utf-8"))
                return {str(k): str(v) for k, v in data.items() if v is not None}
            except Exception:
                return {}
        parsed = urllib.parse.parse_qs(raw.decode("utf-8", errors="replace"), keep_blank_values=True)
        return {key: values[-1] if values else "" for key, values in parsed.items()}

    def _broker(self, action: str, payload: dict[str, object]) -> dict[str, object]:
        if not OAUTH_BROKER_TOKEN:
            raise RuntimeError("OAuth broker is not configured")
        body = json.dumps({"action": action, **payload}, separators=(",", ":")).encode()
        req = urllib.request.Request(
            OAUTH_BROKER_URL,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "accept": "application/json",
                "x-project-relay-oauth-broker": OAUTH_BROKER_TOKEN,
                "user-agent": "ProjectRelayGateway/0.3",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                data = response.read(131072)
                return json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            data = exc.read(131072)
            try:
                parsed = json.loads(data.decode("utf-8"))
            except Exception:
                parsed = {"ok": False, "error": "OAuth broker request failed"}
            parsed["_status"] = exc.code
            return parsed

    def _oauth_metadata(self) -> dict[str, object]:
        return {
            "issuer": ISSUER,
            "authorization_response_iss_parameter_supported": True,
            "authorization_endpoint": ISSUER + "/oauth/authorize",
            "token_endpoint": ISSUER + "/oauth/token",
            "userinfo_endpoint": ISSUER + "/oauth/userinfo",
            "client_id_metadata_document_supported": True,
            "token_endpoint_auth_methods_supported": ["none"],
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": list(OAUTH_SCOPES),
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
        }

    def _resource_metadata(self) -> dict[str, object]:
        return {
            "resource": RESOURCE,
            "authorization_servers": [ISSUER],
            "scopes_supported": [OAUTH_SCOPE],
            "bearer_methods_supported": ["header"],
            "resource_documentation": ISSUER + "/",
        }

    def _validate_cimd(self, client_id: str, redirect_uri: str) -> tuple[bool, str]:
        try:
            parsed = urllib.parse.urlsplit(client_id)
        except Exception:
            return False, "invalid_client"
        if parsed.scheme != "https" or parsed.hostname != CHATGPT_CLIENT_HOST:
            return False, "invalid_client"
        if parsed.query or parsed.fragment:
            return False, "invalid_client"
        if not re.fullmatch(r"/oauth/(client\.json|[A-Za-z0-9_-]{1,160}/client\.json)", parsed.path):
            return False, "invalid_client"

        req = urllib.request.Request(
            client_id,
            method="GET",
            headers={"accept": "application/json", "user-agent": "ProjectRelayGateway/0.3"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                raw = response.read(65536)
                if len(raw) >= 65536:
                    return False, "invalid_client"
                meta = json.loads(raw.decode("utf-8"))
        except Exception:
            return False, "invalid_client"

        if str(meta.get("client_id", "")) != client_id:
            return False, "invalid_client"
        redirects = meta.get("redirect_uris")
        if not isinstance(redirects, list) or redirect_uri not in [str(x) for x in redirects]:
            return False, "invalid_redirect_uri"
        grants = [str(x) for x in (meta.get("grant_types") or [])]
        responses = [str(x) for x in (meta.get("response_types") or [])]
        if "authorization_code" not in grants or "code" not in responses:
            return False, "invalid_client"
        methods = meta.get("token_endpoint_auth_methods_supported")
        if not isinstance(methods, list):
            one = meta.get("token_endpoint_auth_method")
            methods = [one] if one else []
        if "none" not in [str(x) for x in methods]:
            return False, "invalid_client"
        return True, ""

    def _oauth_authorize(self) -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query, keep_blank_values=True)
        one = lambda name: (query.get(name) or [""])[-1]
        response_type = one("response_type")
        client_id = one("client_id")
        redirect_uri = one("redirect_uri")
        code_challenge = one("code_challenge")
        code_challenge_method = one("code_challenge_method")
        resource = one("resource")
        scope = one("scope") or OAUTH_SCOPE
        state = one("state")

        if response_type != "code" or not client_id or not redirect_uri:
            self._json(400, {"error": "invalid_request"})
            return

        valid, error = self._validate_cimd(client_id, redirect_uri)
        if not valid:
            self._json(400, {"error": error})
            return

        def oauth_error(name: str, description: str = "") -> None:
            params = [("error", name), ("iss", ISSUER)]
            if description:
                params.append(("error_description", description))
            if state:
                params.append(("state", state))
            self._redirect(self._append_query(redirect_uri, params))

        if resource != RESOURCE:
            oauth_error("invalid_target", "Unexpected Project Relay resource")
            return
        if code_challenge_method != "S256" or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", code_challenge):
            oauth_error("invalid_request", "PKCE S256 is required")
            return
        scopes = [x for x in scope.split() if x]
        if not scopes:
            scopes = [OAUTH_SCOPE]
        if OAUTH_SCOPE not in scopes or any(x not in OAUTH_SCOPES for x in scopes):
            oauth_error("invalid_scope")
            return
        scope_value = " ".join(x for x in OAUTH_SCOPES if x in scopes)

        broker = self._broker(
            "create_request",
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "resource": RESOURCE,
                "scope": scope_value,
                "state": state,
            },
        )
        request_id = str(broker.get("request_id", ""))
        if not broker.get("ok") or not request_id:
            self._json(503, {"error": "temporarily_unavailable"})
            return

        supabase_url = json.dumps(SUPABASE_URL)
        publishable_key = json.dumps(SUPABASE_PUBLISHABLE_KEY)
        request_json = json.dumps(request_id)
        page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Project Relay</title>
<style>
:root{{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}}
body{{margin:0;background:#0f1115;color:#f5f7fb;min-height:100vh;display:grid;place-items:center;padding:20px}}
.card{{width:min(520px,100%);background:#171b22;border:1px solid #303846;border-radius:18px;padding:24px;box-shadow:0 20px 70px #0008}}
.brand{{display:flex;gap:12px;align-items:center;margin-bottom:20px}} .mark{{width:44px;height:44px;border-radius:12px;background:#ff6a00;display:grid;place-items:center;font-weight:800}}
h1{{font-size:24px;margin:0}} p{{color:#b8c0cc;line-height:1.5}} label{{display:block;margin-top:14px;font-size:13px;color:#cbd2dc}}
input{{box-sizing:border-box;width:100%;margin-top:6px;padding:12px;border-radius:10px;border:1px solid #3b4453;background:#0d1015;color:#fff}}
button{{width:100%;padding:12px;border:0;border-radius:10px;margin-top:12px;font-weight:750;cursor:pointer}}
.primary{{background:#ff6a00;color:#111}} .secondary{{background:#29313d;color:#fff}} .danger{{background:transparent;color:#cbd2dc;border:1px solid #3b4453}}
.status{{margin-top:12px;padding:10px;border-radius:10px;background:#10141a;color:#cbd2dc;display:none}}
.scope{{background:#10141a;border:1px solid #2b3340;padding:12px;border-radius:10px;margin:16px 0;color:#dce2ea}}
.small{{font-size:12px;color:#929cab}}
</style>
</head>
<body>
<div class="card">
  <div class="brand"><div class="mark">PR</div><div><h1>Connect Project Relay</h1><div class="small">ChatGPT is requesting access to your linked PCs.</div></div></div>
  <div class="scope"><strong>Requested access</strong><br>Inspect your linked Project Relay workstations using the published non-destructive tool catalogue.</div>
  <div id="signed" style="display:none"><p>Signed in as <strong id="who"></strong>.</p><button id="allow" class="primary">Allow Project Relay</button><button id="signout" class="secondary">Use another account</button></div>
  <div id="login">
    <label>Email<input id="email" type="email" autocomplete="email"></label>
    <label>Password<input id="password" type="password" autocomplete="current-password"></label>
    <button id="signin" class="primary">Sign in</button>
  </div>
  <button id="deny" class="danger">Cancel</button>
  <div id="status" class="status"></div>
  <p class="small">Project Relay uses OAuth 2.1 with PKCE. ChatGPT receives a scoped Project Relay token, not your password.</p>
</div>
<script type="module">
import {{ createClient }} from "https://esm.sh/@supabase/supabase-js@2";
const supabase=createClient({supabase_url},{publishable_key},{{auth:{{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}}});
const requestId={request_json};
const status=document.getElementById("status");
const login=document.getElementById("login");
const signed=document.getElementById("signed");
const who=document.getElementById("who");
function setStatus(msg){{status.style.display="block";status.textContent=msg}}
async function renderSession(){{
  const {{data}}=await supabase.auth.getSession();
  const session=data?.session;
  if(session?.user){{
    login.style.display="none";signed.style.display="block";who.textContent=session.user.email||"Project Relay account";
  }} else {{
    login.style.display="block";signed.style.display="none";
  }}
}}
let submitted=false;
function submit(decision,token=""){{
  if(submitted)return;
  submitted=true;
  for(const button of document.querySelectorAll("button"))button.disabled=true;
  setStatus("Returning to ChatGPT…");
  const form=document.createElement("form");form.method="POST";form.action="/oauth/approve";
  const values={{request_id:requestId,decision,user_access_token:token}};
  for(const [k,v] of Object.entries(values)){{const i=document.createElement("input");i.type="hidden";i.name=k;i.value=v;form.appendChild(i)}}
  document.body.appendChild(form);form.submit();
}}
document.getElementById("signin").onclick=async()=>{{
  setStatus("Signing in…");
  const email=document.getElementById("email").value.trim();
  const password=document.getElementById("password").value;
  const {{error}}=await supabase.auth.signInWithPassword({{email,password}});
  if(error){{setStatus(error.message);return}}
  status.style.display="none";await renderSession();
}};
document.getElementById("allow").onclick=async()=>{{
  const allow=document.getElementById("allow");
  if(allow.disabled)return;
  allow.disabled=true;
  const {{data}}=await supabase.auth.getSession();
  const token=data?.session?.access_token;
  if(!token){{allow.disabled=false;setStatus("Please sign in again.");await renderSession();return}}
  submit("allow",token);
}};
document.getElementById("deny").onclick=()=>submit("deny","");
document.getElementById("signout").onclick=async()=>{{await supabase.auth.signOut();await renderSession()}};
await renderSession();
</script>
</body></html>"""
        self._send(
            200,
            page.encode(),
            "text/html; charset=utf-8",
            {
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
                "content-security-policy": (
                    "default-src 'self'; "
                    "script-src 'self' https://esm.sh 'unsafe-inline'; "
                    "style-src 'self' 'unsafe-inline'; "
                    f"connect-src 'self' {SUPABASE_URL}; "
                    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
                ),
            },
        )

    def _oauth_approve(self) -> None:
        form = self._read_form()
        request_id = form.get("request_id", "")
        decision = form.get("decision", "")
        if decision == "deny":
            result = self._broker("deny_request", {"request_id": request_id})
            if not result.get("ok"):
                self._json(400, {"error": "invalid_request"})
                return
            params = [("error", "access_denied"), ("iss", ISSUER)]
            state = str(result.get("state") or "")
            if state:
                params.append(("state", state))
            self._oauth_return_page(self._append_query(str(result["redirect_uri"]), params))
            return

        if decision != "allow":
            self._json(400, {"error": "invalid_request"})
            return
        result = self._broker(
            "approve_request",
            {
                "request_id": request_id,
                "user_access_token": form.get("user_access_token", ""),
            },
        )
        if not result.get("ok"):
            self._json(int(result.get("_status", 400)), {"error": str(result.get("error", "access_denied"))})
            return
        params = [("code", str(result["code"])), ("iss", ISSUER)]
        state = str(result.get("state") or "")
        if state:
            params.append(("state", state))
        self._oauth_return_page(self._append_query(str(result["redirect_uri"]), params))

    def _oauth_token(self) -> None:
        if self.headers.get("authorization"):
            self._json(401, {"error": "invalid_client"})
            return
        form = self._read_form()
        grant_type = form.get("grant_type", "")
        client_id = form.get("client_id", "")
        resource = form.get("resource", "")

        if grant_type == "authorization_code":
            result = self._broker(
                "exchange_code",
                {
                    "code": form.get("code", ""),
                    "client_id": client_id,
                    "redirect_uri": form.get("redirect_uri", ""),
                    "resource": resource,
                    "code_verifier": form.get("code_verifier", ""),
                },
            )
        elif grant_type == "refresh_token":
            result = self._broker(
                "refresh_token",
                {
                    "refresh_token": form.get("refresh_token", ""),
                    "client_id": client_id,
                    "resource": resource,
                },
            )
        else:
            self._json(400, {"error": "unsupported_grant_type"})
            return

        if not result.get("ok", True) and "access_token" not in result:
            self._json(int(result.get("_status", 400)), {"error": str(result.get("error", "invalid_grant"))})
            return

        payload = {
            "access_token": result.get("access_token"),
            "token_type": result.get("token_type", "Bearer"),
            "expires_in": result.get("expires_in", 3600),
            "refresh_token": result.get("refresh_token"),
            "scope": result.get("scope", OAUTH_SCOPE),
        }
        self._json(200, payload, {"pragma": "no-cache"})

    def _oauth_userinfo(self) -> None:
        auth = self.headers.get("authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not token:
            self._json(401, {"error": "invalid_token"}, {"www-authenticate": 'Bearer error="invalid_token"'})
            return
        result = self._broker("userinfo", {"access_token": token})
        if not result.get("ok"):
            self._json(401, {"error": "invalid_token"}, {"www-authenticate": 'Bearer error="invalid_token"'})
            return
        profile = result.get("profile")
        if not isinstance(profile, dict):
            self._json(500, {"error": "server_error"})
            return
        self._json(200, profile, {"pragma": "no-cache"})

    def _proxy_html(self, upstream_base: str) -> None:
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        upstream = upstream_base + (("?" + query) if query else "")
        req = urllib.request.Request(
            upstream,
            method="GET",
            headers={
                "accept": "text/html",
                "user-agent": self.headers.get("user-agent", "ProjectRelayGateway/0.3"),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read()
                status = response.status
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
        except Exception as exc:
            payload = b"Project Relay page unavailable"
            status = 502
            print("gateway page upstream error:", repr(exc), flush=True)

        text = payload.decode("utf-8", errors="replace")
        text = text.replace("/functions/v1/project-relay-site/", "/")
        text = text.replace("/functions/v1/project-relay-site", "")
        payload = text.encode("utf-8")

        self._send(
            status,
            payload,
            "text/html; charset=utf-8",
            {
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
                "content-security-policy": (
                    "default-src 'self'; "
                    "script-src 'self' https://esm.sh 'unsafe-inline'; "
                    "style-src 'self' 'unsafe-inline'; "
                    f"connect-src 'self' {SUPABASE_URL}; "
                    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
                ),
            },
        )

    def _proxy_site_post(self, upstream: str) -> None:
        length = int(self.headers.get("content-length", "0") or "0")
        body = self.rfile.read(length) if length else b""
        headers = {
            "content-type": self.headers.get("content-type", "application/json"),
            "accept": "application/json",
            "user-agent": self.headers.get("user-agent", "ProjectRelayGateway/0.3"),
        }
        req = urllib.request.Request(upstream, data=body, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read()
                status = response.status
                content_type = response.headers.get("Content-Type", "application/json; charset=utf-8")
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            content_type = exc.headers.get("Content-Type", "application/json; charset=utf-8")
        except Exception as exc:
            payload = json.dumps({"ok": False, "error": "Support request unavailable"}).encode()
            status = 502
            content_type = "application/json; charset=utf-8"
            print("gateway support upstream error:", repr(exc), flush=True)
        self._send(status, payload, content_type, {"cache-control": "no-store"})

    def _proxy(self) -> None:
        suffix = self.path[len("/mcp"):] if self.path.startswith("/mcp") else self.path
        upstream = UPSTREAM_MCP + suffix
        length = int(self.headers.get("content-length", "0") or "0")
        body = self.rfile.read(length) if length else None

        headers: dict[str, str] = {}
        for name in (
            "authorization",
            "content-type",
            "accept",
            "mcp-protocol-version",
            "origin",
            "user-agent",
        ):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        headers["x-forwarded-host"] = self.headers.get("Host", "")

        req = urllib.request.Request(upstream, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                payload = response.read()
                status = response.status
                response_headers = dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            response_headers = dict(exc.headers.items())
        except Exception as exc:
            payload = json.dumps({"error": "Project Relay upstream unavailable"}).encode()
            self._send(502, payload, "application/json; charset=utf-8")
            print("gateway upstream error:", repr(exc), flush=True)
            return

        content_type = response_headers.get("Content-Type", "application/octet-stream")
        if (
            "json" in content_type.lower()
            or content_type.lower().startswith("text/")
            or UPSTREAM_MCP.encode() in payload
        ):
            text = payload.decode("utf-8", errors="replace")
            text = text.replace(UPSTREAM_MCP, self._public_mcp())
            payload = text.encode("utf-8")

        keep: dict[str, str] = {}
        for key in ("cache-control", "www-authenticate", "mcp-session-id"):
            value = response_headers.get(key) or response_headers.get(key.title())
            if value:
                keep[key] = value.replace(UPSTREAM_MCP, self._public_mcp())
        keep["access-control-allow-origin"] = "*"
        keep["access-control-allow-headers"] = "authorization,content-type,mcp-protocol-version"
        keep["access-control-allow-methods"] = "GET,POST,OPTIONS"
        self._send(status, payload, content_type, keep)

    def do_GET(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path == "/health":
            self._json(200, {
                "ok": True,
                "service": "Project Relay MCP Gateway",
                "upstream": "configured",
                "oauth": bool(OAUTH_BROKER_TOKEN and SUPABASE_PUBLISHABLE_KEY),
            })
            return
        if path in {"/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"}:
            self._json(200, self._oauth_metadata())
            return
        if path in {"/.well-known/oauth-protected-resource", "/mcp/.well-known/oauth-protected-resource"}:
            self._json(200, self._resource_metadata())
            return
        if path == "/oauth/authorize":
            self._oauth_authorize()
            return
        if path == "/oauth/userinfo":
            self._oauth_userinfo()
            return
        if path in {"/", "/support", "/privacy", "/terms"}:
            suffix = "" if path == "/" else path
            self._proxy_html(SITE_PAGE + suffix)
            return
        if path == "/account":
            self._proxy_html(ACCOUNT_PAGE)
            return
        if path == "/oauth":
            self._redirect("/account")
            return
        if path == "/.well-known/openai-apps-challenge":
            if not CHALLENGE:
                self._send(404, b"Not configured", "text/plain; charset=utf-8", {"cache-control": "no-store"})
                return
            self._send(200, CHALLENGE.encode(), "text/plain; charset=utf-8", {"cache-control": "no-store"})
            return
        if path.startswith("/mcp"):
            self._proxy()
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path == "/oauth/approve":
            self._oauth_approve()
            return
        if path == "/oauth/token":
            self._oauth_token()
            return
        if path == "/oauth/userinfo":
            self._oauth_userinfo()
            return
        if path == "/support":
            self._proxy_site_post(SITE_PAGE + "/support")
            return
        if path.startswith("/mcp"):
            self._proxy()
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_OPTIONS(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/mcp"):
            self._proxy()
            return
        self._send(204, b"", "text/plain; charset=utf-8", {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "authorization,content-type,mcp-protocol-version",
            "access-control-allow-methods": "GET,POST,OPTIONS",
        })

    def log_message(self, fmt: str, *args: object) -> None:
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), RelayGateway)
    print(f"Project Relay gateway listening on {PORT}", flush=True)
    server.serve_forever()
