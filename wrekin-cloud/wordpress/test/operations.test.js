const test = require('node:test');
const assert = require('node:assert/strict');
const { versionPlan, approvedExecutionPlan, verifyVersion } = require('../operations');

test('plugin update plan defaults to dry-run and approval gate', () => {
  const plan = versionPlan('plugin', 'wordfence', '1.0', '1.1');
  assert.equal(plan.dryRun, true);
  assert.equal(plan.requiresApproval, true);
});

test('approved execution creates checkpoint', () => {
  const plan = versionPlan('theme', 'my-theme', '1.0', '2.0');
  const exec = approvedExecutionPlan(plan, true);
  assert.equal(exec.dryRun, false);
  assert.ok(exec.checkpoint.id);
});

test('version verification detects mismatch', () => {
  const plan = versionPlan('core', 'wordpress', '7.1', '7.1.2');
  assert.equal(verifyVersion(plan, '7.1.2').ok, true);
  assert.equal(verifyVersion(plan, '7.1.1').ok, false);
});
