import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStripeSignature,constantTimeHexEqual,hmacSha256Hex,verifyStripeSignature,isUuid,stripeTimestamp,invoiceSubscriptionId,mapStripeSubscriptionStatus} from '../backend/stripe-webhook.js';

test('parses Stripe v1 signatures',()=>{
  const p=parseStripeSignature('t=123,v1='+'a'.repeat(64)+',v0=ignore,v1='+'b'.repeat(64));
  assert.equal(p.timestamp,123); assert.equal(p.signatures.length,2);
});
test('constant time hex compare handles equal and unequal values',()=>{
  assert.equal(constantTimeHexEqual('aa','aa'),true);
  assert.equal(constantTimeHexEqual('aa','ab'),false);
  assert.equal(constantTimeHexEqual('aa','a'),false);
});
test('valid webhook signature verifies and stale signature fails',async()=>{
  const raw='{"id":"evt_test"}', secret='whsec_test_secret', t=2000;
  const sig=await hmacSha256Hex(secret,t+'.'+raw);
  assert.equal(await verifyStripeSignature(raw,`t=${t},v1=${sig}`,secret,t+5),true);
  assert.equal(await verifyStripeSignature(raw,`t=${t},v1=${sig}`,secret,t+1000),false);
});
test('billing helpers validate ids and timestamps',()=>{
  assert.equal(isUuid('4f71f52a-e0cd-4316-979c-437ef8ba5374'),true);
  assert.equal(isUuid('not-an-id'),false);
  assert.equal(stripeTimestamp(0),null);
  assert.equal(invoiceSubscriptionId({subscription:'sub_1'}),'sub_1');
  assert.equal(invoiceSubscriptionId({parent:{subscription_details:{subscription:'sub_2'}}}),'sub_2');
});

test('Stripe subscription statuses map into DeskRoute billing states',()=>{assert.equal(mapStripeSubscriptionStatus('active'),'active');assert.equal(mapStripeSubscriptionStatus('trialing'),'trialing');assert.equal(mapStripeSubscriptionStatus('canceled'),'cancelled');assert.equal(mapStripeSubscriptionStatus('incomplete'),'past_due');assert.equal(mapStripeSubscriptionStatus('unpaid'),'past_due');});
