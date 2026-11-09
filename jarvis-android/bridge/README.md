# Jarvis local chat bridge 0.2

Private development preview. No deployment was performed. This standard-library
service connects only to Ollama on `127.0.0.1:11434`, using an already installed
model explicitly selected by the owner. It never downloads models or invokes
PC commands, tools, files, messages, or the task ledger. No API billing is used.

Set `JARVIS_OLLAMA_MODEL` to the installed model name and `JARVIS_PAIRING_TOKEN`
to a cryptographically random URL-safe token (32–128 characters). Generate one
privately with Python `secrets.token_urlsafe(32)`. Do not commit or send it in chat.
Run `python server.py`. Default binding is loopback only, suitable for a private
HTTPS reverse proxy. Android accepts only HTTPS with a normally trusted certificate.
Direct TLS is also supported with `--cert PATH --key PATH`; non-loopback binding
requires both. No firewall, router, certificate, DNS or proxy setup is automatic.

Enter the HTTPS origin (no path) and pairing token in the app's Connection screen.
Test checks only the bridge identity and authentication, not model readiness.
Ask Jarvis sends a single question and receives text. Saved notes and earlier
questions are not automatically included. Phone cancellation discards the reply;
Ollama may continue computing until it finishes or the bridge times out.

## Protocol and restrictions

- `GET /v1/health`, bearer token required: service identity and capabilities.
- `POST /v1/chat`, same auth, JSON `{ "message": "..." }` only.
- Replies: `{ "reply": "...", "actions_executed": false }`.
- 4000 characters / 32 KB request limit, bounded provider responses, 60s provider
  timeout, one generation at a time and at most 10 authenticated requests/minute.
- Unknown routes, extra fields, browser origins and invalid credentials rejected.
- No prompt/request logging or conversation database. Restart revokes rate history;
  change the token and restart to revoke an old phone pairing.
- This Python HTTP server is for a private preview, not unrestricted public hosting.
  Use a hardened HTTPS proxy with connection/body/rate limits for any deployment.
- No live model or workstation has been verified. Fake-provider integration tests
  exercise request handling, not response quality, performance, or hardware fit.

Reference: https://docs.ollama.com/api/chat
