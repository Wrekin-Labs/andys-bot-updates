"""Private preview bridge: authenticated text chat to loopback Ollama only.
No task dispatch, model tools, files, shell commands or conversation persistence.
"""
import argparse
import json
import os
import re
import secrets
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

MAX_BODY = 32768
SYSTEM = ('You are Jarvis, a helpful personal assistant. Use clear British English. '
          'You can only answer questions. You cannot access PCs, files, live websites, '
          'ChatGPT history or saved phone notes, send messages, or perform actions. '
          'Never claim that you performed an action. State when information is uncertain.')


def validate_message(body):
    if not isinstance(body, dict) or set(body) != {'message'}:
        raise ValueError('Expected message only')
    message = body['message']
    if not isinstance(message, str) or not message.strip() or len(message) > 4000:
        raise ValueError('Message must contain 1–4000 characters')
    return message.strip()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Ollama:
    def __init__(self, model):
        if not re.fullmatch(r'[A-Za-z0-9_.:/-]{1,120}', model):
            raise ValueError('Set an installed local Ollama model name')
        self.model = model
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def chat(self, message):
        payload = {'model': self.model, 'stream': False,
                   'messages': [{'role': 'system', 'content': SYSTEM},
                                {'role': 'user', 'content': message}],
                   'options': {'num_predict': 1024}}
        request = Request('http://127.0.0.1:11434/api/chat',
                          data=json.dumps(payload).encode(),
                          headers={'Content-Type': 'application/json'}, method='POST')
        with self.opener.open(request, timeout=60) as response:
            raw = response.read(131073)
        if len(raw) > 131072:
            raise ValueError('Provider response too large')
        result = json.loads(raw)
        if result.get('done') is not True:
            raise ValueError('Incomplete provider response')
        text = result.get('message', {}).get('content')
        if not isinstance(text, str) or not text.strip() or len(text) > 16000:
            raise ValueError('Invalid provider reply')
        return text


class Bridge(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, token, provider):
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
            raise ValueError('A random pairing token of 32–128 URL-safe characters is required')
        self.token = token
        self.provider = provider
        self.slot = threading.BoundedSemaphore(1)
        self.rate_lock = threading.Lock()
        self.requests = []
        super().__init__(address, Handler)

    def rate_allowed(self):
        with self.rate_lock:
            now = time.monotonic()
            self.requests = [t for t in self.requests if now-t < 60]
            if len(self.requests) >= 10:
                return False
            self.requests.append(now)
            return True


class Handler(BaseHTTPRequestHandler):
    server_version = 'JarvisBridge/0.2'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass  # Do not log prompts, credentials or request paths.

    def send_json(self, status, data):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def authenticated(self):
        values = self.headers.get_all('Authorization', [])
        expected = 'Bearer ' + self.server.token
        supplied = values[0] if len(values) == 1 else ''
        if not secrets.compare_digest(supplied.encode(), expected.encode()):
            self.send_json(401, {'error': 'Pairing token rejected'})
            return False
        if self.headers.get('Origin'):
            self.send_json(403, {'error': 'Browser requests are not supported'})
            return False
        return True

    def do_GET(self):
        if not self.authenticated(): return
        if self.path != '/v1/health':
            self.send_json(404, {'error': 'Unknown endpoint'})
            return
        self.send_json(200, {'service': 'jarvis-mobile-bridge', 'version': 1,
                             'capabilities': ['chat'], 'model_verified': False})

    def do_POST(self):
        if not self.authenticated(): return
        if self.path != '/v1/chat':
            self.send_json(404, {'error': 'Unknown endpoint'})
            return
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
            self.send_json(400, {'error': 'Explicit body length required'})
            return
        if self.headers.get_content_type() != 'application/json':
            self.send_json(415, {'error': 'JSON required'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= MAX_BODY: raise ValueError()
            raw = self.rfile.read(size)
            if len(raw) != size: raise ValueError()
            message = validate_message(json.loads(raw))
        except (ValueError, UnicodeDecodeError, TimeoutError):
            self.send_json(400, {'error': 'Invalid or oversized message'})
            return
        if not self.server.rate_allowed():
            self.send_json(429, {'error': 'Please wait before sending more messages'})
            return
        if not self.server.slot.acquire(blocking=False):
            self.send_json(503, {'error': 'AI is busy; please try again shortly'})
            return
        try:
            reply = self.server.provider.chat(message)
            self.send_json(200, {'reply': reply, 'actions_executed': False})
        except Exception:
            self.send_json(502, {'error': 'Local AI unavailable; check Ollama and the configured model'})
        finally:
            self.server.slot.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--cert')
    parser.add_argument('--key')
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key): parser.error('Both TLS certificate and key are required')
    if args.host != '127.0.0.1' and not args.cert: parser.error('Non-loopback binding requires TLS')
    bridge = Bridge((args.host, args.port), os.environ.get('JARVIS_PAIRING_TOKEN', ''),
                    Ollama(os.environ.get('JARVIS_OLLAMA_MODEL', '')))
    if args.cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(args.cert, args.key)
        bridge.socket = context.wrap_socket(bridge.socket, server_side=True)
    print('Jarvis chat bridge started. PC actions are disabled. Stop with Ctrl+C.')
    try: bridge.serve_forever()
    except KeyboardInterrupt: pass
    finally: bridge.server_close()


if __name__ == '__main__': main()
