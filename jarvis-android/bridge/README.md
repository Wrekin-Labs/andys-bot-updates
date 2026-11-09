# Jarvis private chat bridge 0.3 — protocol v2

Development preview. No deployment was performed. Connects only to local Ollama
at `127.0.0.1:11434`, with a previously installed model explicitly chosen by the
owner. No model downloads, file access, shell, tools, messaging or PC task execution.

## Setup

Set `JARVIS_OLLAMA_MODEL` to the installed model and `JARVIS_PAIRING_TOKEN` to a
cryptographically random URL-safe token, 32–128 characters. Generate privately using
Python `secrets.token_urlsafe(32)`. Do not commit or send it in chat.

Run `python server.py`. It binds loopback by default, suitable for a private HTTPS
reverse proxy. Android accepts HTTPS with a normally trusted certificate only.
Direct TLS is available using `--cert PATH --key PATH`; non-loopback binding
requires both. No firewall, router, DNS, certificate or proxy changes are automatic.
This standard-library HTTP server is not intended for unrestricted public hosting;
a hardened private HTTPS proxy must limit concurrent connections, rates and bodies.

Enter the HTTPS origin and token in the app's Settings. Test checks service identity
and authentication, not model readiness. Send a question to check actual generation.

## Protocol

- `GET /v1/health`: bearer auth; service identity, `version: 2`, capabilities.
- `POST /v1/chat`: bearer auth; JSON `message` required, `history` and `notes` optional.
- Message: 1–4000 characters. History: at most five complete user/assistant pairs,
  12,000 characters. Notes: up to five selected strings, 4,000 characters total.
- Body limit 128 KiB. No client system/tool roles or unknown request fields.
- Response: `{ "reply": "...", "actions_executed": false }`.
- Bounded provider response; 60s timeout; one generation at a time; at most ten
  authenticated chat requests per minute. No request/prompt/conversation logging.
- Note content is reference data, not executable authority. No tools exist even if
  a note or model asks for one. `<think>`/`<analysis>` blocks are removed from visible
  text; an empty final reply fails with a generic provider error.
- Change token and restart to revoke pairing. Rate history resets on restart.
- Phone Stop discards the reply, but the model may continue until completion/timeout.

Message-only 0.2 request bodies remain accepted; old health-version checks require
updating. The Android 0.3 app requires bridge version 2 when testing the connection.

## Validation limits

Loopback HTTP integration tests use a fake provider. No live model, desktop source,
TLS deployment or physical phone-to-PC session has been verified. No API spending
was performed. Official provider contract: https://docs.ollama.com/api/chat.
