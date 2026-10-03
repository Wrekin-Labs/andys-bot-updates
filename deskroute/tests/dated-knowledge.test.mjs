import test from 'node:test';
import assert from 'node:assert/strict';
import {questionDate,datedKnowledge} from '../backend/dated-knowledge.js';
const config={organisation_id:'org-a',brand_id:'brand-a'};
const fact={id:'november',...config,review_status:'approved',fact_key:'rehearsal_price',fact_value:'From 1 November 2026 rehearsal is £16 per hour.',category:'pricing',confidence:.99,valid_from:'2026-11-01T00:00:00Z',valid_until:null};
function db(data,error=null){
  const calls=[];
  const query=new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({data,error});return (...args)=>{calls.push([key,...args]);return query;};}});
  return {calls,from:name=>{calls.push(['from',name]);return query;}};
}
test('explicit ISO and English calendar dates select the same day',()=>{
  for(const q of ['price from 1 November 2026?','price on November 1st, 2026?','price on 2026-11-01?']){
    const d=questionDate(q);assert.equal(d.date,'2026-11-01');assert.equal(d.end,'2026-11-02T00:00:00.000Z');assert.equal(d.requiresHuman,true);
  }
  assert.equal(questionDate('on 29 February 2028').date,'2028-02-29');
});
test('invalid, missing-year, relative, numeric and mixed dates never become today',()=>{
  for(const q of ['price on 31 November 2026','on 2026-02-29','on 1 November','on 1 Nov','in May','tomorrow','on 01/11/2026','on 2026-11-01 or 2026-12-01','on 1 November 2026 or today','from 1 November 2026 until 2 November']){
    const d=questionDate(q);assert.equal(d.date,null,q);assert.equal(d.requiresHuman,true,q);
  }
});
test('ordinary current questions retain current knowledge search',()=>{
  for(const q of ['What is the current rehearsal price?','May I book a room?']) assert.deepEqual(questionDate(q),{date:null,requiresHuman:false});
});
test('November retrieval uses only approved scoped facts valid that day',async()=>{
  const otherRows=[{...fact,id:'expired',fact_value:'£15',valid_from:null,valid_until:'2026-11-01T00:00:00Z'},
    {...fact,id:'too-early',valid_from:'2026-11-02T00:00:00Z'},
    {...fact,id:'draft',review_status:'pending'}, {...fact,id:'other-org',organisation_id:'org-b'},
    {...fact,id:'other-brand',brand_id:'brand-b'}, {...fact,id:'bad-date',valid_from:'broken'}];
  const admin=db([fact,...otherRows]);
  const r=await datedKnowledge(admin,config,'What is the rehearsal price on 1 November 2026?',questionDate('1 November 2026'));
  assert.deepEqual(r.data.map(x=>x.id),['november']);assert.match(r.data[0].fact_value,/£16/);
  for(const call of [['eq','organisation_id','org-a'],['eq','brand_id','brand-a'],['eq','review_status','approved'],['or','valid_from.is.null,valid_from.lt.2026-11-02T00:00:00.000Z'],['or','valid_until.is.null,valid_until.gt.2026-11-01T00:00:00.000Z']]) assert.ok(admin.calls.some(x=>JSON.stringify(x)===JSON.stringify(call)));
});
test('brandless widgets cannot read brand-specific facts',async()=>{
  const admin=db([fact,{...fact,id:'shared',brand_id:null}]);
  const r=await datedKnowledge(admin,{organisation_id:'org-a'},'rehearsal price',questionDate('2026-11-01'));
  assert.deepEqual(r.data.map(x=>x.id),['shared']);assert.ok(admin.calls.some(x=>x[0]==='is'&&x[1]==='brand_id'&&x[2]===null));
});
test('too many candidates or relevant facts cannot hide a conflicting answer',async()=>{
  for(const n of [9,201]){
    const r=await datedKnowledge(db(Array.from({length:n},(_,i)=>({...fact,id:String(i)}))),config,'rehearsal price',questionDate('2026-11-01'));
    assert.equal(r.incomplete,true);assert.deepEqual(r.data,[]);
  }
});
test('unrelated facts and empty results supply no answer',async()=>{
  const r=await datedKnowledge(db([fact]),config,'wheelchair doorway width',questionDate('2026-11-01'));
  assert.deepEqual(r.data,[]);
});
test('query errors are preserved rather than substituting current facts',async()=>{
  const error={message:'database unavailable'};
  const r=await datedKnowledge(db(null,error),config,'price',questionDate('2026-11-01'));
  assert.equal(r.error,error);
});
