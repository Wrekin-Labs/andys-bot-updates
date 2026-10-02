const test = require('node:test');
const assert = require('node:assert/strict');
const { simplePerformanceAudit, pageSpeedAudit } = require('../performance');

function response(status, text) {
  return { status, ok: status >= 200 && status < 300, async text(){ return text; } };
}

test('simple performance audit counts page assets', async () => {
  const html = '<html><head><link rel="stylesheet"><script></script></head><body><img><img></body></html>';
  const out = await simplePerformanceAudit('https://example.com','/', async () => response(200, html));
  assert.equal(out.counts.scripts,1);
  assert.equal(out.counts.stylesheets,1);
  assert.equal(out.counts.images,2);
  assert.ok(out.heuristicScore <= 100);
});

test('pagespeed adapter reports unconfigured without API key', async () => {
  const out = await pageSpeedAudit('https://example.com','/',{apiKey:''});
  assert.equal(out.configured,false);
});
