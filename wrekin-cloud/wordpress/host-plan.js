const HOST_ACTIONS = new Set([
  'backup.create',
  'backup.verify',
  'wpcli.read',
  'wpcli.write',
  'filesystem.read',
  'filesystem.write',
  'cache.purge',
  'cron.test'
]);

function planHostAction(action, args = {}) {
  if (!HOST_ACTIONS.has(action)) throw new Error('unsupported_host_action');
  const write = ['wpcli.write', 'filesystem.write'].includes(action);
  return {
    adapter: 'project-relay',
    action,
    args,
    risk: write ? 'write' : 'read',
    requiresApproval: write,
    executable: false,
    reason: 'host_execution_requires_authorised_relay_adapter'
  };
}

module.exports = { planHostAction, HOST_ACTIONS };
