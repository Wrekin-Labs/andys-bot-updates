const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPS,
  validateApp,
  buildManifest,
  buildInstallConfig,
  createServer
} = require('./server');

test('ships two demo tenants', () => {
  assert.equal(APPS.length, 2);
  assert.equal(APPS[0].slug, 'smashroom');
  assert.equal(APPS[1].slug, 'electronic-repairs-uk');
});

test('demo tenants validate', () => {
  for (const app of APPS) assert.deepEqual(validateApp(app), []);
});

test('manifest is installable shaped', () => {
  const manifest = buildManifest(APPS[0]);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.equal(manifest.icons.length, 2);
});

test('install config keeps live providers gated', () => {
  const install = buildInstallConfig(APPS[1]);
  assert.equal(install.integration.mode, 'website-embed');
  assert.ok(install.integration.requires_owner_action.includes('configure live providers'));
  assert.ok(install.modules.some(x => x.key === 'repair_jobs' && x.state === 'connector-required'));
});

test('preview rejects malformed app config', () => {
  const errors = validateApp({ slug: 'Bad Slug', name: '', domain: 'https://bad', startUrl: 'home', theme: {}, modules: ['nope'] });
  assert.ok(errors.length >= 5);
});

test('http endpoints respond', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const health = await fetch(`http://127.0.0.1:${address.port}/health`).then(r => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.tenant_count, 2);

    const apps = await fetch(`http://127.0.0.1:${address.port}/api/apps`).then(r => r.json());
    assert.equal(apps.apps.length, 2);

    const manifest = await fetch(`http://127.0.0.1:${address.port}/api/apps/smashroom/manifest.webmanifest`).then(r => r.json());
    assert.equal(manifest.name, 'The Smashroom');

    const builderResponse = await fetch(`http://127.0.0.1:${address.port}/builder`);
    const builder = await builderResponse.text();
    assert.equal(builderResponse.status, 200);
    assert.match(builder, /Create a branded app/);
    assert.match(builder, /Generate app preview/);

    const previewResponse = await fetch(`http://127.0.0.1:${address.port}/preview/smashroom`);
    const preview = await previewResponse.text();
    assert.equal(previewResponse.status, 200);
    assert.match(preview, /The Smashroom/);
    assert.match(preview, /Book rehearsal/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
