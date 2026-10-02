const { classifyAction, assertAllowed } = require('./policy');
const { makeCheckpoint } = require('./checkpoint');

function versionPlan(kind, slug, fromVersion, toVersion) {
  const action = kind + '.update';
  const classification = classifyAction(action);
  return {
    action,
    target: slug || kind,
    fromVersion: fromVersion || null,
    toVersion: toVersion || null,
    dryRun: true,
    verify: {
      type: 'version_equals',
      expected: toVersion || null
    },
    ...classification
  };
}

function approvedExecutionPlan(plan, approval) {
  assertAllowed(plan.action, {}, approval === true);
  return {
    ...plan,
    dryRun: false,
    checkpoint: makeCheckpoint({
      target: plan.target,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion
    })
  };
}

function verifyVersion(plan, actualVersion) {
  if (!plan || !plan.verify) throw new Error('verification_plan_missing');
  return {
    ok: String(actualVersion || '') === String(plan.verify.expected || ''),
    expected: plan.verify.expected || null,
    actual: actualVersion || null
  };
}

module.exports = { versionPlan, approvedExecutionPlan, verifyVersion };
