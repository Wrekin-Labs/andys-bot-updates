const test = require('node:test');
const assert = require('node:assert/strict');
const { backupPlan, restoreGuard } = require('../backups');

test('backup plan selects active known provider', () => {
  const out = backupPlan({providers:[{provider:'UpdraftPlus',active:true}]},'create');
  assert.equal(out.selectedProvider,'UpdraftPlus');
  assert.equal(out.executable,false);
});

test('restore guard requires approval and checkpoint', () => {
  assert.throws(() => restoreGuard({approved:false,checkpointId:'x',provider:'UpdraftPlus'}),/approval_required/);
  assert.throws(() => restoreGuard({approved:true,provider:'UpdraftPlus'}),/checkpoint_required/);
  assert.doesNotThrow(() => restoreGuard({approved:true,checkpointId:'cp1',provider:'UpdraftPlus'}));
});
