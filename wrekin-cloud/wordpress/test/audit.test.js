const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../audit');
const { planHostAction } = require('../host-plan');

test('audit redacts top-level secrets', () => {
  const out = redact({ action: 'x', token: 'abc', password: 'pw' });
  assert.equal(out.token, '[redacted]');
  assert.equal(out.password, '[redacted]');
});

test('relay host writes remain approval gated', () => {
  const plan = planHostAction('filesystem.write', { path: 'x' });
  assert.equal(plan.adapter, 'project-relay');
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.executable, false);
});
