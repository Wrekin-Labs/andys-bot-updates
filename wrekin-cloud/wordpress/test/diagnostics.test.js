const test = require('node:test');
const assert = require('node:assert/strict');
const { publicSiteDiagnostic, probePath } = require('../diagnostics');

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof data === 'string' ? data : JSON.stringify(data); }
  };
}

test('public diagnostic reports WP REST metadata', async () => {
  const out = await publicSiteDiagnostic('https://example.com', async () =>
    response(200, { name: 'Example', namespaces: ['wp/v2'] })
  );
  assert.equal(out.ok, true);
  assert.equal(out.name, 'Example');
  assert.deepEqual(out.namespaces, ['wp/v2']);
});

test('path probe treats redirect as reachable', async () => {
  const out = await probePath('https://example.com', '/contact', async () => response(302, ''));
  assert.equal(out.ok, true);
  assert.equal(out.status, 302);
});
