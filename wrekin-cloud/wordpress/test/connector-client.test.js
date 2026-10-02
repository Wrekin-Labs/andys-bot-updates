const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { WrekinConnectorClient } = require('../connector-client');

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, async text(){ return JSON.stringify(data); } };
}

test('connector signs request exactly like WordPress plugin', async () => {
  let seen;
  const client = new WrekinConnectorClient({
    baseUrl: 'https://example.com',
    secret: 'shared-secret',
    now: () => 1700000000,
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return response(200, { ok: true });
    }
  });
  await client.pluginUpdatePlan('wordfence/wordfence.php');
  const body = JSON.stringify({ file: 'wordfence/wordfence.php' });
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = ['1700000000','POST','/wrekin/v1/plugin/update-plan',bodyHash].join('\n');
  const expected = crypto.createHmac('sha256','shared-secret').update(canonical).digest('hex');
  assert.equal(seen.options.headers['x-wrekin-signature'], expected);
});

test('connector refuses non-Wrekin REST routes', async () => {
  const client = new WrekinConnectorClient({ baseUrl:'https://example.com', secret:'x' });
  await assert.rejects(() => client.request('/wp-json/wp/v2/users'), /connector_route_forbidden/);
});
