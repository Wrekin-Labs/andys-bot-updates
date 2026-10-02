const test = require('node:test');
const assert = require('node:assert/strict');
const { WrekinWordPressManager, classifyAction, assertAllowed, makeCheckpoint, rollbackPlan } = require('../manager');

test('read actions are safe without approval', () => {
  assert.equal(classifyAction('site.inspect').risk, 'read');
  assert.doesNotThrow(() => assertAllowed('site.inspect'));
});

test('core updates require explicit approval', () => {
  assert.throws(() => assertAllowed('core.update'), /approval_required/);
  assert.doesNotThrow(() => assertAllowed('core.update', {}, true));
});

test('license bypasses remain blocked', () => {
  assert.throws(() => assertAllowed('license.bypass', {}, true), /human_or_license_required/);
});

test('secrets are rejected by default', () => {
  assert.throws(() => assertAllowed('content.edit.page', { password: 'x' }), /secret_handling_forbidden/);
});

test('checkpoint can generate rollback plan', () => {
  const checkpoint = makeCheckpoint({ id: 7, value: 'before' });
  const rollback = rollbackPlan(checkpoint);
  assert.equal(rollback.checkpointId, checkpoint.id);
  assert.deepEqual(rollback.snapshot, { id: 7, value: 'before' });
});

test('page edit captures checkpoint before write', async () => {
  const audit = [];
  const manager = new WrekinWordPressManager({
    auditSink: async event => audit.push(event),
    clientFactory: () => ({
      page: async () => ({ title: { rendered: 'Old' }, content: { rendered: 'A' }, status: 'publish' }),
      updatePage: async (id, patch) => ({ id, ...patch })
    })
  });
  const result = await manager.editPage({ baseUrl: 'https://example.test' }, 7, { title: 'New' });
  assert.equal(result.after.id, 7);
  assert.ok(result.checkpoint.id);
  assert.equal(result.rollback.action, 'rollback');
  assert.equal(audit.length, 1);
});

test('capabilities advertise safety gates', () => {
  const manager = new WrekinWordPressManager();
  const caps = manager.capabilities();
  assert.ok(caps.gated.includes('core_update'));
  assert.ok(caps.blocked.includes('paid_license_bypass'));
});
