import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedPushEndpoint,buildPushPayload,classifyPushResult,retryDelayMs} from '../backend/push-dispatch.js';

test('push endpoint allowlist accepts known push services only',()=>{
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/example'),true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example'),true);
  assert.equal(isAllowedPushEndpoint('https://wns.notify.windows.com/w/?token=x'),true);
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/Qx'),true);
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/x'),false);
  assert.equal(isAllowedPushEndpoint('https://example.com/push'),false);
  assert.equal(isAllowedPushEndpoint('not-a-url'),false);
});

test('push payload never exposes customer message preview',()=>{
  const payload=JSON.parse(buildPushPayload({
    notification_id:'n1',
    conversation_id:'c1',
    kind:'system',
    title:'DeskRoute needs a human reply',
    body_preview:'customer@example.com 07000111222 private customer text'
  }));
  assert.equal(payload.title,'DeskRoute needs you');
  assert.equal(payload.body,'Open DeskRoute to view the customer message.');
  assert.equal(JSON.stringify(payload).includes('customer@example.com'),false);
  assert.equal(JSON.stringify(payload).includes('07000111222'),false);
  assert.match(payload.url,/deskroute_notification=n1/);
  assert.match(payload.url,/#inbox\/c1$/);
});

test('urgent push payload is privacy-safe and renotifies',()=>{
  const payload=JSON.parse(buildPushPayload({
    notification_id:'n2',
    conversation_id:'c2',
    kind:'system',
    title:'Urgent: a customer may need support now',
    body_preview:null
  }));
  assert.equal(payload.title,'Urgent: DeskRoute needs you');
  assert.equal(payload.renotify,true);
});

test('push result classification handles success, revocation and retry',()=>{
  assert.deepEqual(classifyPushResult(201,1),{state:'delivered',terminal:true});
  assert.deepEqual(classifyPushResult(410,1),{state:'failed',terminal:true,disableDevice:true});
  assert.deepEqual(classifyPushResult(429,1),{state:'pending',terminal:false});
  assert.deepEqual(classifyPushResult(503,2),{state:'pending',terminal:false});
  assert.deepEqual(classifyPushResult(503,3),{state:'failed',terminal:true});
});

test('push retry delay backs off predictably',()=>{
  assert.equal(retryDelayMs(1),60000);
  assert.equal(retryDelayMs(2),300000);
  assert.equal(retryDelayMs(3),900000);
  assert.equal(retryDelayMs(99),900000);
});
