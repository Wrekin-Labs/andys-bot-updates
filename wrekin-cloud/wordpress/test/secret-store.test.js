const test = require('node:test');
const assert = require('node:assert/strict');
const { WordPressSecretStore } = require('../secret-store');

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, async text(){ return JSON.stringify(data); } };
}

test('secret store refuses unconfigured access', async () => {
  const store = new WordPressSecretStore({ supabaseUrl:'', supabaseAnonKey:'', registryToken:'' });
  await assert.rejects(() => store.get('wrekin/wp/site'), /secret_store_not_configured/);
});

test('secret store sends secret only in protected rpc body', async () => {
  let seen;
  const store = new WordPressSecretStore({
    supabaseUrl:'https://example.supabase.co',
    supabaseAnonKey:'anon',
    registryToken:'registry-token',
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return response(200, { ok:true, name:'wrekin/wp/site' });
    }
  });
  await store.set('wrekin/wp/site','connector-secret-1234567890');
  const body = JSON.parse(seen.options.body);
  assert.equal(body.p_action,'set_secret');
  assert.equal(body.p_secret,'connector-secret-1234567890');
  assert.equal(seen.options.headers.apikey,'anon');
});

test('secret store returns decrypted secret server-side', async () => {
  const store = new WordPressSecretStore({
    supabaseUrl:'https://example.supabase.co',
    supabaseAnonKey:'anon',
    registryToken:'registry-token',
    fetchImpl: async () => response(200, { secret:'connector-secret' })
  });
  assert.equal(await store.get('wrekin/wp/site'),'connector-secret');
});
