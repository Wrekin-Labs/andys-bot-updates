import test from 'node:test';
import assert from 'node:assert/strict';
import {literalGroundingCheck} from '../backend/literal-grounding.js';

test('literal grounding accepts prices, times and days present in approved facts',()=>{
  const facts=[{fact_value:'The Smash Room is open Monday to Friday from 4pm to 10pm. Rehearsals cost £15 per hour.'}];
  const r=literalGroundingCheck('We are open Monday to Friday, 4pm to 10pm, and rehearsal is £15 per hour.',facts);
  assert.equal(r.ok,true);
  assert.deepEqual(r.missing,[]);
});

test('literal grounding rejects a fabricated price',()=>{
  const facts=[{fact_value:'Rehearsals cost £15 per hour.'}];
  const r=literalGroundingCheck('Rehearsals are £20 per hour.',facts);
  assert.equal(r.ok,false);
  assert.deepEqual(r.missing,['£20']);
});

test('literal grounding rejects a fabricated contact detail',()=>{
  const facts=[{fact_value:'Email info@example.com or call 01952 123456.'}];
  assert.equal(literalGroundingCheck('Email sales@example.com.',facts).ok,false);
  assert.equal(literalGroundingCheck('Call 01952 123456.',facts).ok,true);
});

test('literal grounding ignores ordinary prose with no sensitive literals',()=>{
  const facts=[{fact_value:'Recording studio bookings are currently paused.'}];
  const r=literalGroundingCheck('Recording bookings are currently paused.',facts);
  assert.equal(r.ok,true);
  assert.deepEqual(r.claims,[]);
});
