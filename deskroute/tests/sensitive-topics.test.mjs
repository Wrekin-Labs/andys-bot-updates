import test from 'node:test';
import assert from 'node:assert/strict';
import {SENSITIVE_TOPICS,sensitiveTopic,sensitiveTopicFromTags} from '../backend/sensitive-topics.js';
import {holdingCopy} from '../backend/holding-copy.js';

test('sensitive topic guard catches high impact requests',()=>{
  const cases=[
    ['I want to make a formal complaint','complaint'],
    ['I want to complain about this','complaint'],
    ['I want a refund for the payment','payment_dispute'],
    ['You charged me twice','payment_dispute'],
    ['That was an unauthorised payment','payment_dispute'],
    ['This is a subject access request','data_protection'],
    ['DSAR','data_protection'],
    ['Delete all my personal data','data_protection'],
    ['What data do you hold on me?','data_protection'],
    ['I am taking this to court','legal'],
    ['I am speaking to my solicitor','legal'],
    ['This is a letter before action','legal'],
    ['This is a safeguarding concern','safeguarding'],
    ['I am hurting myself','safeguarding'],
    ['I want to die','safeguarding'],
    ['I don’t want to live anymore','safeguarding']
  ];
  for(const [message,expected] of cases)assert.equal(sensitiveTopic(message),expected,message);
});

test('sensitive topic guard avoids ordinary policy and name false positives',()=>{
  for(const message of [
    'Can Sue book Saturday?',
    'What is your refund policy?',
    'Can I get a refund if I cancel?',
    'Is your chat GDPR compliant?',
    'Do lawyers get a discount?',
    'What days are rehearsal rooms open?',
    'How much is the diagnostic fee?',
    "I'm in a band called Danger Zone"
  ])assert.equal(sensitiveTopic(message),null,message);
});

test('sensitive topic remains discoverable from conversation tags',()=>{
  assert.equal(sensitiveTopicFromTags(['vip','sensitive-complaint']),'complaint');
  assert.equal(sensitiveTopicFromTags(['sensitive-not-real']),null);
});

test('safeguarding metadata suppresses notification previews and uses urgent priority',()=>{
  assert.equal(SENSITIVE_TOPICS.safeguarding.priority,'urgent');
  assert.equal(SENSITIVE_TOPICS.safeguarding.notifyPreview,false);
  assert.equal(SENSITIVE_TOPICS.complaint.priority,'high');
});

test('holding copy is static, cautious, and locale-aware for safeguarding',()=>{
  const gb=holdingCopy('safeguarding',{locale:'en-GB'});
  assert.match(gb,/999/);
  assert.match(gb,/116 123/);
  const other=holdingCopy('safeguarding',{locale:'en-US'});
  assert.doesNotMatch(other,/116 123/);
  assert.match(holdingCopy('payment_dispute'),/No changes have been made/);
});
