const crypto = require('crypto');

function makeCheckpoint(snapshot) {
  const canonical = JSON.stringify(snapshot ?? null);
  return {
    id: crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24),
    createdAt: new Date().toISOString(),
    snapshot
  };
}

function rollbackPlan(checkpoint) {
  if (!checkpoint || !checkpoint.snapshot) throw new Error('checkpoint_missing');
  return {
    action: 'rollback',
    checkpointId: checkpoint.id,
    snapshot: checkpoint.snapshot
  };
}

module.exports = { makeCheckpoint, rollbackPlan };
