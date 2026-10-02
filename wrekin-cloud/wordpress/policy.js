const WRITE_ACTIONS = new Set([
  'core.update',
  'plugin.update',
  'theme.update',
  'plugin.delete',
  'theme.delete',
  'content.publish',
  'content.delete',
  'backup.restore'
]);

const BLOCKED_ACTIONS = new Set([
  'plugin.update.paid',
  'theme.update.paid',
  'license.bypass',
  'payment.accept',
  'legal.accept',
  'twofactor.bypass'
]);

function classifyAction(action, payload = {}) {
  if (!action || typeof action !== 'string') throw new Error('action_required');
  if (BLOCKED_ACTIONS.has(action)) {
    return { risk: 'blocked', requiresApproval: true, reason: 'human_or_license_required' };
  }
  if (WRITE_ACTIONS.has(action)) {
    return { risk: 'write', requiresApproval: true, reason: 'state_change' };
  }
  if (action.startsWith('content.edit')) {
    return { risk: 'write', requiresApproval: false, reason: 'reversible_content_edit' };
  }
  if (action.startsWith('cache.') || action.startsWith('cron.')) {
    return { risk: 'operational', requiresApproval: false, reason: 'reversible_operational_action' };
  }
  return { risk: 'read', requiresApproval: false, reason: 'read_only' };
}

function assertAllowed(action, payload = {}, approval = false) {
  const classification = classifyAction(action, payload);
  if (classification.risk === 'blocked') throw new Error(classification.reason);
  if (classification.requiresApproval && approval !== true) throw new Error('approval_required');
  if ((payload.password || payload.totp || payload.secret || payload.apiKey) && payload.allowSecret !== true) {
    throw new Error('secret_handling_forbidden');
  }
  return classification;
}

module.exports = { classifyAction, assertAllowed };
