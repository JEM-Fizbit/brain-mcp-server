import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrainIdSchema, WriteContextSchema } from '../schemas/tools.js';
import { SourceReferenceManifestSchema } from '../source-references/schema.js';
import { HostedIngestion, hostedIngestion, SourceChangeSchema, MAX_SESSION_TEXT_BYTES } from '../ingestion/hosted.js';
import { resolveToolBrain, type ToolBrainContext } from '../services/request-context.js';
import { IngestionError } from '../ingestion/local.js';
import { WritePolicyError, policyFailure } from '../services/write-policy.js';

export function registerSourceIngestionTools(server:McpServer,factory:(ctx:ToolBrainContext)=>HostedIngestion=hostedIngestion){
  const selected=BrainIdSchema.extend({write_context:WriteContextSchema});
  const safe=async(fn:()=>Promise<unknown>)=>{try{const result=await fn();return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result as Record<string,unknown>};}catch(error){
    if(error instanceof WritePolicyError)return policyFailure(error);
    const code=error instanceof IngestionError?error.message:error instanceof z.ZodError?'invalid_source_request':'source_ingestion_failed';
    return {content:[{type:'text' as const,text:JSON.stringify({error:code,effect:'No successful ingestion receipt; inspect this job before retrying.'})}],isError:true};
  }};
  server.tool("brain_source_prepare",'Direct session source ingestion; Capture is optional. Under explicit user or existing operational authority, reserve one selected original and its provenance. Supply original_text for UTF-8 text up to 256 KiB (including long essays); otherwise upload unchanged binary bytes via the returned scoped PUT URL, without redirects. Never pass binary/base64. Grant issuance is not custody: review verifies actual size/hash. Keep upload URLs private. Retain stable source/artifact IDs across retries.',
    selected.extend({manifest:SourceReferenceManifestSchema,original_text:z.string().max(MAX_SESSION_TEXT_BYTES).optional()}).shape,
    {readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},
    async({brain_id,manifest,original_text,write_context},extra)=>safe(async()=>factory(await resolveToolBrain(brain_id,extra)).prepare(manifest,write_context,original_text)));
  server.tool("brain_source_review",'Verify the uploaded original and stage exact reviewed Markdown and optional curated Brain changes in this same session. For Office/binary input provide an inspected Markdown conversion; it is attributed to this session, not server extraction. Use expectedRevision from each reviewed Brain read. Response contains exact before/after and a digest; inspect it before apply. No Capture or additional per-fact human approval is required. Original remains private; no inbox deletion.',
    selected.extend({job_id:z.string().uuid(),companion_expected_revision:z.union([z.literal('new'),z.string().uuid()]).default('new'),content:z.string().max(MAX_SESSION_TEXT_BYTES),changes:z.array(SourceChangeSchema).max(18).default([])}).shape,
    {readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    async({brain_id,job_id,content,changes,write_context,companion_expected_revision},extra)=>safe(async()=>factory(await resolveToolBrain(brain_id,extra)).review(job_id,content,changes,write_context,companion_expected_revision)));
  server.tool("brain_source_apply",'Apply the exact digest inspected by this authorised session. Rechecks current role, policy, original bytes, evidence and all target revisions; commits source metadata, companion and curated updates atomically with a readable receipt. Stale results require a fresh read and review, never blind retry. Exact completed retries return the original receipt. Verify source and changed-file read-back and run lint. Capture is only an optional deferred handoff.',
    selected.extend({job_id:z.string().uuid(),review_digest:z.string().regex(/^[a-f0-9]{64}$/)}).shape,
    {readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    async({brain_id,job_id,review_digest,write_context},extra)=>safe(async()=>factory(await resolveToolBrain(brain_id,extra)).apply(job_id,review_digest,write_context)));
  server.tool("brain_source_status",'Read the current caller-bound ingestion job and receipt; declaration, verified original custody, review and completion are distinct. Does not fetch private original bytes or clean a local inbox.',
    BrainIdSchema.extend({job_id:z.string().uuid()}).shape,
    {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    async({brain_id,job_id},extra)=>safe(async()=>{const service=factory(await resolveToolBrain(brain_id,extra));const job=await service.jobs.get(job_id);
      const head=await service.jobs.revisions.getHead(service.ctx.brainId,job.manifest.companionPath);
      const companion=head ? await service.jobs.revisions.readFile(service.ctx.brainId,job.manifest.companionPath) : null;
      return {...service.status(job),companion_baseline:companion?{revision_id:companion.revisionId,content_sha256:companion.contentHash,content:companion.content}:null};}));
}
