import test from 'node:test';
import assert from 'node:assert/strict';
import {canSendAutomatically} from '../backend/answer-policy.js';
const answer={answer:'Open Monday to Friday, 4pm to 10pm.',grounded:true,needs_human:false,confidence:.99,used_fact_ids:['approved-hours']};
test('approved related facts alone never permit an automatic reply',()=>{
 for(const relevance of [.301379,1.04,1.09444]) assert.equal(canSendAutomatically('automatic',null,.9,relevance),false);
});
test('validated complete grounded answer can be automatic',()=>assert.equal(canSendAutomatically('automatic',answer,.95,.96),true));
test('a grounded model request for human review is respected',()=>assert.equal(canSendAutomatically('automatic',{...answer,needs_human:true},.9,1),false));
test('empty or ungrounded answers never send automatically',()=>{
 for(const change of [{answer:' '},{grounded:false},{used_fact_ids:[]},{confidence:NaN},{confidence:1.1}])assert.equal(canSendAutomatically('automatic',{...answer,...change},.9,1),false);
});
test('confidence cannot drop below 90 percent through old settings',()=>assert.equal(canSendAutomatically('automatic',{...answer,confidence:.89},.8,1),false));
test('workspace approval modes always require a human',()=>{
 for(const mode of ['approve','suggest','escalate'])assert.equal(canSendAutomatically(mode,answer,.9,1),false);
});
test('low relevance and a higher configured confidence gate are respected',()=>{
 assert.equal(canSendAutomatically('automatic',answer,1,1),false);
 assert.equal(canSendAutomatically('automatic',answer,.9,.001),false);
});
