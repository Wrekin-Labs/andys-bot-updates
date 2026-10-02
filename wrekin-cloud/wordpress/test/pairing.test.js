const test = require('node:test');
const assert = require('node:assert/strict');
const { WordPressPairingStore } = require('../pairing');

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, async text(){ return JSON.stringify(data); } };
}

test('pairing store requires config', async () => {
  const store = new WordPressPairingStore({ supabaseUrl:'', supabaseAnonKey:'', registryToken:'' });
  await assert.rejects(() => store.create({baseUrl:'https://example.com',name:'Example'}), /pairing_store_not_configured/);
});

test('pairing create uses protected rpc', async () => {
  let seen;
  const store = new WordPressPairingStore({
    supabaseUrl:'https://example.supabase.co',
    supabaseAnonKey:'anon',
    registryToken:'reg-token',
    fetchImpl: async (url, options) => {
      seen = {url,options};
      return response(200,{code:'AB12CD34'});
    }
  });
  const out = await store.create({baseUrl:'https://example.com',name:'Example'});
  assert.equal(out.code,'AB12CD34');
  const body=JSON.parse(seen.options.body);
  assert.equal(body.p_action,'create');
  assert.equal(body.p_payload.baseUrl,'https://example.com');
});

test('pairing consume sends code and site only', async () => {
  let body;
  const store = new WordPressPairingStore({
    supabaseUrl:'https://example.supabase.co',
    supabaseAnonKey:'anon',
    registryToken:'reg-token',
    fetchImpl: async (_url, options) => {
      body=JSON.parse(options.body);
      return response(200,{ok:true});
    }
  });
  await store.consume({code:'AB12CD34',baseUrl:'https://example.com'});
  assert.deepEqual(body.p_payload,{code:'AB12CD34',baseUrl:'https://example.com'});
});
