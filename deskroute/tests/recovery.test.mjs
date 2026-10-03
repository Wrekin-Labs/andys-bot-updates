import test from 'node:test';
import assert from 'node:assert/strict';
import {RecoveryAPI,recoveryToken,RECOVERY_SENT,LINK_ERROR} from '../control-panel/recovery-api.js';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const user={id:'synthetic-user',email:'owner@example.com'};
test('reset request has a fixed callback and never creates or enumerates accounts',async()=>{
 const api=new RecoveryAPI({fetcher:async(url,options)=>{assert.equal(new URL(url).pathname,'/auth/v1/recover');assert.equal(new URL(url).searchParams.get('redirect_to'),'https://deskroute.example/password.html');assert.deepEqual(JSON.parse(options.body),{email:'owner@example.com'});assert.equal(options.headers.Authorization,undefined);return response({});}});
 assert.equal(await api.requestReset(' owner@example.com ','https://deskroute.example/password.html'),RECOVERY_SENT);assert.equal(api.token,null);
});
test('malformed, errored and unrelated auth links are rejected',()=>{
 for(const hash of ['#access_token=synthetic&type=signup','#type=recovery','#error=access_denied&error_description=untrusted','#type=recovery&access_token=synthetic&error_code=otp_expired']) assert.throws(()=>recoveryToken(hash),error=>error.message===LINK_ERROR);
 assert.equal(recoveryToken(''),null);assert.equal(recoveryToken('#type=recovery&access_token=synthetic-token'),'synthetic-token');
});
test('expired recovery token cannot authorize password changes',async()=>{
 const api=new RecoveryAPI({fetcher:async()=>response({message:'expired'},401)});await assert.rejects(api.acceptToken('synthetic'),e=>e.status===401);assert.equal(api.token,null);await assert.rejects(api.setPassword('Synthetic-password-42'),e=>e.status===401);
});
test('leaving recovery while token validation runs cannot restore credentials',async()=>{
 let finish;const api=new RecoveryAPI({fetcher:()=>new Promise(resolve=>finish=resolve)});const pending=api.acceptToken('synthetic');api.clear();finish(response(user));await assert.rejects(pending,e=>e.status===401);assert.equal(api.token,null);
});
test('only a validated token authorizes updating a password; recovery session is then cleared',async()=>{
 const calls=[];const api=new RecoveryAPI({fetcher:async(url,o)=>{calls.push({url,method:o.method,body:o.body});assert.equal(o.headers.Authorization,'Bearer synthetic');return response(user);}});
 await assert.rejects(api.setPassword('Synthetic-password-42'),e=>e.status===401);assert.equal(calls.length,0);
 assert.equal(await api.acceptToken('synthetic'),user.email);await api.setPassword('Synthetic-password-42');assert.deepEqual(JSON.parse(calls[1].body),{password:'Synthetic-password-42'});assert.equal(calls[1].method,'PUT');assert.match(calls[2].url,/logout\?scope=local$/);assert.equal(api.token,null);
});
test('rejected password update cannot report success or revoke its retry session',async()=>{
 const api=new RecoveryAPI({fetcher:async(u,o)=>o.method==='PUT'?response({message:'Choose a stronger password'},422):response(user)});await api.acceptToken('synthetic');await assert.rejects(api.setPassword('Synthetic-password-42'),e=>e.status===422);assert.equal(api.token,'synthetic');
});
test('network errors and rate limits give actionable messages without sensitive input',async()=>{
 const api=new RecoveryAPI({fetcher:async()=>{throw new TypeError('Failed to fetch');}});await assert.rejects(api.requestReset('owner@example.com','https://deskroute.example/password.html'),/could not reach the sign-in service/);
 const limited=new RecoveryAPI({fetcher:async()=>response({},429)});await assert.rejects(limited.requestReset('owner@example.com','https://deskroute.example/password.html'),/Too many requests/);
});
test('password success remains distinct from a failed recovery-session logout',async()=>{
 const api=new RecoveryAPI({fetcher:async(u)=>u.includes('/logout')?response({},503):response(user)});await api.acceptToken('synthetic');assert.deepEqual(await api.setPassword('Synthetic-password-42'),{signedOut:false});assert.equal(api.token,null);
});
