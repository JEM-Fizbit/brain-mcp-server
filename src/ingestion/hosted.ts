import pg from 'pg';
import { z } from 'zod';
import { IngestionJobs, type IngestionJob } from './jobs.js';
import { SupabaseIngestionAdapter } from './supabase.js';
import { IngestionError, sha256, MAX_SOURCE_BYTES } from './local.js';
import { SourceReferenceManifestSchema, type SourceReferenceManifest } from '../source-references/schema.js';
import type { BrainDefinition } from '../services/registry.js';
import { type ToolBrainContext, revisionActor } from '../services/request-context.js';
import { assertToolRole } from '../services/tool-authority.js';
import { assertBrainVaultPath } from '../services/brain-path.js';
import { assertStructuralWriteAllowed } from '../services/brain-store.js';
import { assertKnowledgeWrite, type BrainWriteContext } from '../services/write-policy.js';
import { writePolicyForBrain } from '../services/write-policy-runtime.js';
import { postgresPoolOptions } from '../sync/postgres-revision-store.js';
import { attachPoolErrorLogger } from '../services/pg-pool.js';
import { instrumentPostgresPool } from '../services/operation-telemetry.js';

export const MAX_SESSION_TEXT_BYTES = 256 * 1024;
export const SourceChangeSchema = z.object({filename:z.string().min(1).max(500),expectedRevision:z.union([z.literal('new'),z.string().uuid()]),content:z.string().max(MAX_SESSION_TEXT_BYTES)}).strict();
export type SourceChange = z.infer<typeof SourceChangeSchema>;
export interface UploadAdapter {
  bucket:string;
  read(key:string):Promise<Buffer|null>;
  put(key:string,bytes:Buffer,mime:string):Promise<void>;
  uploadGrant(key:string):Promise<string>;
}
export { hostedIngestionAvailable } from "./hosted-config.js";
import { hostedIngestionAvailable } from "./hosted-config.js";

export function sessionOwner(ctx:ToolBrainContext):string {
  return 'mcp_'+sha256(JSON.stringify([ctx.principal.provider,ctx.principal.providerTenantId||'',ctx.principal.providerUserId]));
}
export function sourceObjectKey(job:IngestionJob):string {
  return `${job.brain_id}/sources/${job.source_id}/original/${job.content_sha256}`;
}
export function validateSessionManifest(ctx:ToolBrainContext,input:unknown):SourceReferenceManifest {
  const m=SourceReferenceManifestSchema.parse(input);
  if(m.brainId!==ctx.brainId || !/^[a-z][a-z0-9_-]*$/.test(m.category) || !ctx.brain.source_categories?.includes(m.category) ||
    !new RegExp('^sources/'+m.category+'/[0-9]{4}-[0-9]{2}-[0-9]{2}_[A-Za-z0-9_-]+\\.md$').test(m.companionPath) ||
    m.companionPath.length>500 || m.artifacts.length!==1 || m.artifacts[0].kind!=='original' || m.status!=='pending' || m.contentMarkdown)
    throw new IngestionError('invalid_session_manifest');
  const original=m.artifacts[0];
  if((original.relativePath?.length||0)>500 || !original.contentSha256 || !original.byteSize || original.byteSize>MAX_SOURCE_BYTES)throw new IngestionError('original_hash_and_size_required');
  // Artifact paths are metadata only. No server path or URL is fetched.
  for(const link of m.brainLinks)assertBrainVaultPath(link.filename);
  return m;
}
function textBound(content:string):void {
  if(!content.trim()||content.includes('\0')||Buffer.byteLength(content)>MAX_SESSION_TEXT_BYTES)throw new IngestionError('session_text_bounds');
}
export class HostedIngestion {
  constructor(readonly ctx:ToolBrainContext,readonly jobs:IngestionJobs,readonly adapter:UploadAdapter){}
  async guard(context:BrainWriteContext):Promise<void>{
    assertToolRole(this.ctx,'brain_source_prepare');
    const policy=await writePolicyForBrain(this.ctx.brainId);
    // Validate authority/evidence even during custody; original content itself is data.
    assertKnowledgeWrite(this.ctx.brainId,policy,'source-authority.md','','Selected source ingestion',context);
  }
  private async targets(changes:SourceChange[],context:BrainWriteContext){
    const policy=await writePolicyForBrain(this.ctx.brainId);
    for(const change of changes){
      SourceChangeSchema.parse(change);textBound(change.content);
      assertBrainVaultPath(change.filename);
      if(change.filename.toLowerCase()==='log.md')throw new IngestionError('receipt_is_generated');
      assertStructuralWriteAllowed(change.filename,this.ctx.role);
      const head=await this.jobs.revisions.getHead(this.ctx.brainId,change.filename);
      if((head?.revisionId||'new')!==change.expectedRevision)throw new IngestionError('stale_review');
      const previous=head ? (await this.jobs.revisions.readFile(this.ctx.brainId,change.filename)).content : '';
      assertKnowledgeWrite(this.ctx.brainId,policy,change.filename,previous,change.content,context);
    }
  }
  async prepare(input:unknown,context:BrainWriteContext,originalText?:string){
    await this.guard(context);
    const manifest=validateSessionManifest(this.ctx,input);
    let bytes:Buffer|undefined;
    if(originalText!==undefined){
      textBound(originalText);bytes=Buffer.from(originalText,'utf8');
      if(!/\.(md|txt|csv|json|html|xml|ya?ml)$/i.test(manifest.artifacts[0].relativePath||''))throw new IngestionError('inline_original_requires_text');
      if(bytes.length!==manifest.artifacts[0].byteSize||sha256(bytes)!==manifest.artifacts[0].contentSha256)throw new IngestionError('source_changed');
    }
    const job=await this.jobs.reserve(manifest);
    if(job.stage==='complete'||job.original?.verified)return this.status(job);
    if(bytes){const ready=await this.jobs.advance(job.id,this.adapter,bytes);return this.status(ready);}
    // A renewed grant is always for this same immutable reserved object.
    return {...this.status(job),upload:{url:await this.adapter.uploadGrant(sourceObjectKey(job)),method:'PUT',headers:{'Content-Type':manifest.artifacts[0].mimeType||'application/octet-stream'},expires_in_seconds:7200,scope:'upload-only; exact original object; no replacement; custody not yet verified'}};
  }
  async review(id:string,content:string,changes:SourceChange[],context:BrainWriteContext,companionExpectedRevision:string='new'){
    await this.guard(context);textBound(content);
    if(changes.reduce((n,c)=>n+Buffer.byteLength(c.content),Buffer.byteLength(content))>MAX_SESSION_TEXT_BYTES)throw new IngestionError('session_text_bounds');
    const job=await this.jobs.get(id);validateSessionManifest(this.ctx,job.manifest);
    if(job.stage==='complete')return this.status(job);
    // Mechanical provenance is part of the exact review bundle, not a second write.
    if(!changes.some(c=>c.filename==='SOURCES.md')){
      const head=await this.jobs.revisions.getHead(this.ctx.brainId,'SOURCES.md');
      const previous=head ? (await this.jobs.revisions.readFile(this.ctx.brainId,'SOURCES.md')).content : '# Source registry\n\n';
      const label=job.manifest.label.replace(/[\r\n|]/g,' ').slice(0,300);
      const row=`- ${label}: [reviewed source](../${job.manifest.companionPath}); source ${job.source_id}; original SHA-256 ${job.content_sha256}.`;
      changes=[...changes,{filename:'SOURCES.md',expectedRevision:head?.revisionId||'new',content:previous+'\n'+row+'\n'}];
    }
    await this.targets(changes,context);
    if(changes.reduce((n,c)=>n+Buffer.byteLength(c.content),Buffer.byteLength(content))>MAX_SESSION_TEXT_BYTES)throw new IngestionError('session_text_bounds');
    await this.jobs.advance(id,this.adapter,undefined,content);
    const reviewed=await this.jobs.review(id,content,changes,companionExpectedRevision);
    return {...this.status(reviewed),review:reviewed.candidate,approval:'The session reviews this exact candidate under existing user/task authority. No additional human approval is required for authorised source-backed curation.'};
  }
  async apply(id:string,digest:string,context:BrainWriteContext){
    await this.guard(context);
    let job=await this.jobs.get(id);validateSessionManifest(this.ctx,job.manifest);
    if(job.stage==='complete'){
      if(job.receipt.reviewDigest!==digest)throw new IngestionError('review_digest_mismatch');
      await this.verifyRetainedRevisions(job);
      return this.status(job);
    }
    if(!job.candidate || job.candidate.digest!==digest)throw new IngestionError('review_digest_mismatch');
    await this.targets(job.candidate.changes.filter((c:SourceChange)=>c.filename!==job.manifest.companionPath).map(({filename,expectedRevision,content}:SourceChange)=>({filename,expectedRevision,content})),context);
    if(job.stage==='review')job=await this.jobs.approve(id,digest);
    const applied=await this.jobs.apply(id,this.adapter,context);
    if(applied.stage==='complete')await this.verifyRetainedRevisions(applied);
    return this.status(applied);
  }
  private async verifyRetainedRevisions(job:IngestionJob){
    for(const retained of job.receipt.revisions){
      // Read the committed revision, not a possibly newer head. This attests the
      // server's persisted bytes; the caller still verifies its own hosted read.
      const revision=await this.jobs.revisions.readRevision(this.ctx.brainId,retained.revisionId);
      const expected=job.candidate.changes.find((c:SourceChange)=>c.filename===retained.filename);
      const verified=Boolean(revision && expected && revision.content===expected.content && sha256(Buffer.from(revision.content))===retained.sha256);
      await this.jobs.revisions.setWriteVerification(this.ctx.brainId,retained.revisionId,verified?'verified':'verification_failed');
      if(!verified)throw new IngestionError('source_revision_readback_failed');
    }
  }
  status(job:IngestionJob){
    return {job_id:job.id,brain_id:job.brain_id,source_id:job.source_id,stage:job.stage,original_verified:job.original?.verified===true,
      original_sha256:job.content_sha256,companion_path:job.manifest.companionPath,review_digest:job.candidate?.digest,error_code:job.error_code,
      receipt:job.receipt,local_inbox:'unobserved; no cleanup performed',next:job.stage==='needs_review'?'Stale review: read the current companion baseline and each changed Brain file, reconsider and review again; never just replace revision tokens.':job.stage==='complete'?'Read back the exact companion with brain_read_file(scope="sources") and every changed Brain file; then run brain_lint.':'Complete this job directly; use Capture only if work must be deferred or this session cannot finish.'};
  }
}
let poolCache:{key:string,pool:pg.Pool}|undefined;
export function hostedIngestion(ctx:ToolBrainContext):HostedIngestion {
  assertToolRole(ctx,'brain_source_prepare');
  if(!hostedIngestionAvailable(ctx.brain))throw new IngestionError('hosted_ingestion_not_enabled');
  const env=process.env,ref=env.BRAIN_EXPECTED_SUPABASE_PROJECT_REF!;
  if(!/^[a-z0-9]{10,40}$/.test(ref)||env.BRAIN_SUPABASE_URL!.replace(/\/$/,'')!==`https://${ref}.supabase.co`)throw new IngestionError('artifact_project_mismatch');
  const db=new URL(env.BRAIN_REVISION_DATABASE_URL!);
  if(!(db.hostname===`db.${ref}.supabase.co` || db.username.endsWith('.'+ref)&&db.hostname.endsWith('.pooler.supabase.com')))throw new IngestionError('database_project_mismatch');
  const key=env.BRAIN_SUPABASE_SERVICE_ROLE_KEY!;
  if(key.split('.').length===3){let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw new IngestionError('invalid_artifact_key');}if(claims.ref!==ref||claims.role!=='service_role')throw new IngestionError('artifact_key_project_mismatch');}
  if(poolCache?.key!==env.BRAIN_REVISION_DATABASE_URL){
    void poolCache?.pool.end().catch(()=>undefined);
    poolCache={key:env.BRAIN_REVISION_DATABASE_URL!,pool:instrumentPostgresPool(attachPoolErrorLogger(new pg.Pool({...postgresPoolOptions(env.BRAIN_REVISION_DATABASE_URL!),max:2}),'hosted_ingestion'),'hosted_ingestion')};
  }
  const actor=revisionActor(ctx)!;
  return new HostedIngestion(ctx,new IngestionJobs(poolCache!.pool,sessionOwner(ctx),ctx.brainId,{...actor,provider:z.enum(['github','entra','stdio']).parse(ctx.principal.provider)}),
    new SupabaseIngestionAdapter(env.BRAIN_SUPABASE_URL!,key,env.BRAIN_SUPABASE_STORAGE_BUCKET));
}
