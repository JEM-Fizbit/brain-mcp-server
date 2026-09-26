import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSupervision} from '../scripts/lib/sync-supervision.mjs';
const now=Date.now(), opts={brainId:'fixture',supervisorPid:12,now,expected:true};
const report={brainId:'fixture',supervisorPid:12,checkedAt:new Date(now).toISOString(),state:'running'};
test('doctor distinguishes progress, recovery, exhaustion and stale/wrong supervisor observations',()=>{
 assert.equal(evaluateSupervision(report,opts).status,'pass');
 for(const state of ['starting','backoff','stopping'])assert.equal(evaluateSupervision({...report,state},opts).status,'warn');
 assert.equal(evaluateSupervision({...report,state:'needs_attention'},opts).status,'fail');
 assert.equal(evaluateSupervision({...report,supervisorPid:11},opts).state,'stale_or_mismatched');
 assert.equal(evaluateSupervision({...report,brainId:'other'},opts).status,'warn');
 assert.equal(evaluateSupervision(report,{...opts,now:now+130000}).status,'warn');
 assert.equal(evaluateSupervision(null,opts).status,'warn');
});
