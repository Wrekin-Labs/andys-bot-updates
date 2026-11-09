import http.client
import json
import threading
import unittest
from server import Bridge, validate_message, Ollama

TOKEN = 'test_' + 'a'*40

class FakeProvider:
    def __init__(self): self.calls=[]; self.fail=False
    def chat(self, message):
        self.calls.append(message)
        if self.fail: raise RuntimeError('PRIVATE provider detail')
        return 'Test reply'

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.provider=FakeProvider()
        self.server=Bridge(('127.0.0.1',0),TOKEN,self.provider)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
    def request(self,path='/v1/chat',body=None,auth=TOKEN,method='POST',extra=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        headers={'Content-Type':'application/json','Authorization':'Bearer '+auth}
        headers.update(extra or {})
        conn.request(method,path,json.dumps(body if body is not None else {'message':'Hello'}),headers)
        response=conn.getresponse(); status=response.status; data=json.loads(response.read()); conn.close()
        return status,data
    def test_chat(self):
        status,data=self.request(); self.assertEqual(status,200)
        self.assertEqual(data,{'reply':'Test reply','actions_executed':False})
        self.assertEqual(self.provider.calls,['Hello'])
    def test_wrong_token_never_calls_provider(self):
        self.assertEqual(self.request(auth='wrong')[0],401); self.assertEqual(self.provider.calls,[])
    def test_health_does_not_claim_model_ready(self):
        status,data=self.request(path='/v1/health',method='GET')
        self.assertEqual(status,200); self.assertFalse(data['model_verified'])
        self.assertEqual(self.provider.calls,[])
    def test_no_action_route(self):
        self.assertEqual(self.request(path='/v1/execute')[0],404)
    def test_prompt_cannot_add_tools(self):
        self.assertEqual(self.request(body={'message':'Hello','tools':['shell']})[0],400)
    def test_browser_origin_rejected(self):
        self.assertEqual(self.request(extra={'Origin':'https://example.com'})[0],403)
    def test_oversized_message(self):
        self.assertEqual(self.request(body={'message':'a'*4001})[0],400)
    def test_wrong_content_type(self):
        self.assertEqual(self.request(extra={'Content-Type':'text/plain'})[0],415)
    def test_provider_failure_redacted(self):
        self.provider.fail=True
        status,data=self.request(); self.assertEqual(status,502); self.assertNotIn('PRIVATE',str(data))
    def test_rate_limit(self):
        for _ in range(10): self.assertEqual(self.request()[0],200)
        self.assertEqual(self.request()[0],429)
    def test_busy(self):
        self.server.slot.acquire()
        try: self.assertEqual(self.request()[0],503)
        finally: self.server.slot.release()
    def test_utf8(self):
        self.assertEqual(self.request(body={'message':'Repair £25 – café'})[0],200)
        self.assertEqual(self.provider.calls,['Repair £25 – café'])

class ValidationTests(unittest.TestCase):
    def test_invalid_messages(self):
        for body in [None, [], {}, {'message':5}, {'message':' '}, {'message':True}]:
            with self.assertRaises(ValueError): validate_message(body)
    def test_invalid_model(self):
        with self.assertRaises(ValueError): Ollama('')
    def test_weak_token(self):
        with self.assertRaises(ValueError): Bridge(('127.0.0.1',0),'weak',FakeProvider())

if __name__ == '__main__': unittest.main()

class ProviderTests(unittest.TestCase):
    def test_ollama_request_has_no_tools_and_disables_streaming(self):
        from unittest.mock import Mock
        provider=Ollama('installed-model:tag')
        response=Mock(); response.__enter__=Mock(return_value=response); response.__exit__=Mock(return_value=False)
        response.read.return_value=b'{"done":true,"message":{"content":"Hello"}}'
        provider.opener=Mock(); provider.opener.open.return_value=response
        self.assertEqual(provider.chat('Question'),'Hello')
        request=provider.opener.open.call_args.args[0]; data=json.loads(request.data)
        self.assertEqual(request.full_url,'http://127.0.0.1:11434/api/chat')
        self.assertFalse(data['stream']); self.assertNotIn('tools',data)
        self.assertEqual(data['messages'][-1]['content'],'Question')
        self.assertEqual(provider.opener.open.call_args.kwargs['timeout'],60)
    def test_provider_timeout_propagates_to_http_error_handler(self):
        from unittest.mock import Mock
        provider=Ollama('local-model'); provider.opener=Mock(); provider.opener.open.side_effect=TimeoutError()
        with self.assertRaises(TimeoutError): provider.chat('Hello')
