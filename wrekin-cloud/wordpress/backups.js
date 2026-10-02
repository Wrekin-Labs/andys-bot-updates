const PROVIDERS = {
  'UpdraftPlus': {
    create: 'provider_adapter_required',
    restore: 'provider_adapter_required'
  },
  'All-in-One WP Migration': {
    create: 'provider_adapter_required',
    restore: 'provider_adapter_required'
  },
  'BackWPup': {
    create: 'provider_adapter_required',
    restore: 'provider_adapter_required'
  },
  'Duplicator': {
    create: 'provider_adapter_required',
    restore: 'provider_adapter_required'
  }
};

function backupPlan(capabilities, action = 'create') {
  const providers = Array.isArray(capabilities && capabilities.providers) ? capabilities.providers : [];
  const active = providers.filter(p => p.active);
  return {
    action: 'backup.' + action,
    requiresApproval: action === 'restore',
    availableProviders: active,
    selectedProvider: active.length ? active[0].provider : null,
    executable: false,
    reason: active.length ? 'provider_adapter_required' : 'no_supported_backup_provider'
  };
}

function restoreGuard({ approved, checkpointId, provider }) {
  if (!approved) throw new Error('approval_required');
  if (!checkpointId) throw new Error('checkpoint_required');
  if (!provider || !PROVIDERS[provider]) throw new Error('unsupported_backup_provider');
  return { ok: true, provider, checkpointId };
}

module.exports = { PROVIDERS, backupPlan, restoreGuard };
