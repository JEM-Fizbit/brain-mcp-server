import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCapabilities, operationCapability } from '../dist/services/capabilities.js';

test('endpoint support and caller grants remain separate for both owners/backends',()=>{
 for(const id of ['ai-brain-jem','ers-brain'])for(const backend of ['filesystem','postgres']){
  const brain={id,storage_backend:backend,storage_config:{}};const store={revisions:backend==='postgres'};
  const reader=describeCapabilities(brain,'reader',store);const owner=describeCapabilities(brain,'owner',store);
  for(const name of ['brain_scan_inbox','brain_semantic_search','brain_semantic_index','brain_ingest_complete']){
   assert.equal(reader.operations[name].supported,backend==='filesystem');
   assert.equal(owner.operations[name].supported,reader.operations[name].supported);
  }
  assert.equal(reader.operations.brain_semantic_index.authorization.role_allowed,false);
  assert.equal(owner.operations.brain_semantic_index.authorization.role_allowed,true);
  assert.deepEqual(reader.operations.brain_semantic_search.effects,[]);
  assert.deepEqual(owner.operations.brain_semantic_index.effects,['derived_index_write']);
  assert.equal(reader.operations.brain_prepare_ingest.supported,true);
  assert.equal(reader.variants['brain_ingest.analysis'].supported,true);
  assert.match(reader.manual_access,/Independent/);
  assert.equal(operationCapability(brain,'reader',store,'brain_lint','apply').authorization.role_allowed,false);
 }
});
