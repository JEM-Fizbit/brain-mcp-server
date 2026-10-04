import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyAuthReasons} from '../dist/services/auth-reason-policy.js';
import {shouldRepeatAuthAlert,maybeAlertOnAuthFailure} from '../dist/services/auth-alert.js';
import {authFailureSummaryFromSyncEventRows} from '../scripts/lib/latency-summary.mjs';
const now=new Date('2026-10-04T03:00:00Z');
const ago=n=>new Date(now.getTime()-n*60000);
const thresholds={warnThreshold:3,failThreshold:10,cooldownMinutes:30,windowMinutes:60};
const classify=(total,reasons)=>classifyAuthReasons({failureCount:total,reasons,...thresholds});

test('anonymous counts remain visible, become security review at ten, never credential failure',()=>{
 for(const n of [1,3,9,10,100]){
  const s=classify(n,[{reason:'missing_bearer',n}]);
  assert.equal(s.credentialCount,0);assert.equal(s.effectiveStatus,n>=10?'warn':'info');
 }
 assert.equal(classify(0,[]).effectiveStatus,'pass');
});
test('mixed anonymous traffic cannot inflate expired-token or unknown-reason severity',()=>{
 assert.equal(classify(101,[{reason:'missing_bearer',n:100},{reason:'token_expired',n:1}]).credentialStatus,'info');
 assert.equal(classify(110,[{reason:'missing_bearer',n:100},{reason:'token_expired',n:10}]).credentialStatus,'fail');
 assert.equal(classify(10,[]).credentialStatus,'fail');
 assert.equal(classify(12,[{reason:'missing_bearer',n:2}]).credentialStatus,'fail');
});
const repeat={severity:'warn',count:10,firstFailureAt:ago(40),lastFailureAt:ago(1),now,...thresholds,
 previous:{at:ago(31),lastFailureAt:ago(31),severity:'warn',count:10,category:'anonymous',reasonCodes:'missing_bearer'}};
test('elapsed cooldown alone never repeats overlapping unchanged counts',()=>{
 assert.equal(shouldRepeatAuthAlert(repeat),false);
 assert.equal(shouldRepeatAuthAlert({...repeat,count:9}),false);
 assert.equal(shouldRepeatAuthAlert({...repeat,count:20}),true);
 assert.equal(shouldRepeatAuthAlert({...repeat,count:20,lastFailureAt:ago(32)}),false);
});
test('credentials escalate immediately, do not bounce down then page repeatedly',()=>{
 assert.equal(shouldRepeatAuthAlert({...repeat,severity:'fail'}),true);
 assert.equal(shouldRepeatAuthAlert({...repeat,count:3,previous:{...repeat.previous,severity:'fail'}}),false);
});
test('cleared incident can alert again and newly observed reason can warrant review',()=>{
 assert.equal(shouldRepeatAuthAlert({...repeat,previous:{...repeat.previous,at:ago(120),lastFailureAt:ago(120)},firstFailureAt:ago(20),episodeStartedAt:ago(20)}),true);
 assert.equal(shouldRepeatAuthAlert({...repeat,reasonCodes:'invalid_client',previous:{...repeat.previous,category:'credentials',reasonCodes:'token_expired'}}),true);
});
function fixture(brainId,reason,count,previous=[]){
 const posts=[],dispatches=[];
 return {posts,dispatches,deps:{now:()=>now,isoDate:()=> '2026-10-04',
  config:{enabled:true,botToken:'fixture-only',channel:'C-FIXTURE',dm:'U-FIXTURE',brainId,cockpitUrl:brainId==='ers-brain'?'http://127.0.0.1:8788/':'http://127.0.0.1:8787/',thresholds},
  loadState:async()=>({failureCount:count,reasons:[{reason,n:count}],httpStatus:'401',staleConnector:false,
   firstFailureAt:ago(20),lastFailureAt:ago(1),lastWarnAt:null,lastFailAt:null,recentDispatches:[...dispatches.map(d=>({...d,at:now})),...previous]}),
  postMessage:async(channel,text)=>{posts.push({channel,text});return {ok:true}},recordDispatch:async row=>dispatches.unshift(row)}};
}
test('tokenless fixture sends one labelled channel security review and no failure DM',async()=>{
 const f=fixture('ers-brain','missing_bearer',11);
 await Promise.all(Array.from({length:5},()=>maybeAlertOnAuthFailure(f.deps)));
 assert.equal(f.posts.length,1);assert.equal(f.posts[0].channel,'C-FIXTURE');
 assert.match(f.posts[0].text,/\[ers-brain\].*11 anonymous requests rejected/);
 assert.match(f.posts[0].text,/caller origin is unknown/);
 assert.equal(f.dispatches[0].category,'anonymous');
 assert.equal(f.dispatches[0].severity,'warn');
});
test('same policies preserve independent owner/category notification state',async()=>{
 const ers=fixture('ers-brain','token_expired',10);
 const jem=fixture('ai-brain-jem','token_expired',10);
 await Promise.all([maybeAlertOnAuthFailure(ers.deps),maybeAlertOnAuthFailure(jem.deps)]);
 assert.equal(ers.posts.length,1);assert.equal(jem.posts.length,1);
 assert.equal(jem.posts[0].channel,'U-FIXTURE');assert.match(jem.posts[0].text,/\[ai-brain-jem\]/);
 const cred=fixture('ai-brain-jem','token_expired',10,[{...repeat.previous,at:ago(1)}]);
 await maybeAlertOnAuthFailure(cred.deps);assert.equal(cred.posts.length,1);
});
test('failed notification does not consume dedup state; next event retries',async()=>{
 const f=fixture('ai-brain-jem','token_expired',10);
 f.deps.loadState=async()=>({failureCount:10,reasons:[{reason:'token_expired',n:10}],httpStatus:'401',recentDispatches:f.dispatches.filter(d=>d.ok).map(d=>({...d,at:now}))});
 f.deps.postMessage=async()=>({ok:false});
 await maybeAlertOnAuthFailure(f.deps);await maybeAlertOnAuthFailure(f.deps);
 assert.equal(f.dispatches.length,2);assert.equal(f.dispatches.every(d=>d.ok===false),true);
});
test('Doctor uses identical classification while preserving raw rejection history',()=>{
 const rows=Array.from({length:11},()=>({event_type:'hosted_mcp_auth',created_at:ago(1).toISOString(),metadata:{ok:false,error:'missing_bearer',httpStatus:401,name:'mcp_authorization'}}));
 const summary=authFailureSummaryFromSyncEventRows(rows,{now:now.toISOString(),...thresholds});
 assert.equal(summary.status,'fail');assert.equal(summary.failureCount,11);
 assert.equal(summary.effectiveStatus,'warn');assert.equal(summary.anonymousCount,11);assert.equal(summary.credentialCount,0);
 assert.equal(summary.recentFailures.length,11);
 rows[0].metadata.error='token_expired';
 assert.equal(authFailureSummaryFromSyncEventRows(rows,{now:now.toISOString(),...thresholds}).credentialStatus,'info');
});

test('time since last notification cannot manufacture a clear period in continuous traffic',()=>{
 assert.equal(shouldRepeatAuthAlert({...repeat,previous:{...repeat.previous,at:ago(180),lastFailureAt:ago(180)}}),false);
});
