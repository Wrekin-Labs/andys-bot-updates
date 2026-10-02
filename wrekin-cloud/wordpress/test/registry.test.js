const test = require('node:test');
const assert = require('node:assert/strict');
const { WordPressRegistry } = require('../registry');

function mockResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(data); }
  };
}

test('registry refuses to run without credentials', async () => {
  const r = new WordPressRegistry({ registryUrl: '', registryToken: '', supabaseUrl: '', serviceKey: '' });
  await assert.rejects(() => r.listSites(), /registry_not_configured/);
});

test('direct registry sends service credentials only as headers', async () => {
  let seen;
  const r = new WordPressRegistry({
    supabaseUrl: 'https://example.supabase.co',
    serviceKey: 'secret-key',
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return mockResponse(200, []);
    }
  });
  await r.listSites();
  assert.match(seen.url, /wrekin_wordpress_sites/);
  assert.equal(seen.options.headers.apikey, 'secret-key');
  assert.equal(seen.options.body, undefined);
});

test('gateway registry uses bearer token and action envelope', async () => {
  let seen;
  const r = new WordPressRegistry({
    registryUrl: 'https://registry.example/functions/v1/wp',
    registryToken: 'token-123',
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return mockResponse(200, { sites: [] });
    }
  });
  const out = await r.listSites();
  assert.deepEqual(out, { sites: [] });
  assert.equal(seen.options.headers.authorization, 'Bearer token-123');
  assert.equal(JSON.parse(seen.options.body).action, 'list_sites');
});
