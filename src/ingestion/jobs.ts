import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {SourceReferenceManifestSchema,isSafeRelativePath,type SourceReferenceManifest} from '../source-references/schema.js';
import {compileSourceReference} from '../source-references/compiler.js';
import {persistSourceReference} from '../source-references/postgres.js';
import {PostgresRevisionStore} from '../sync/postgres-revision-store.js';
import {sha256,hashValue,extractLocalText,MAX_SOURCE_BYTES,MAX_TEXT_BYTES,IngestionError} from './local.js';

export interface OriginalAdapter {
  bucket:string;
  read(key:string):Promise<Buffer|null>;
  put(key:string,bytes:Buffer,mime:string):Promise<void>;
}
const Change=z.object({filename:z.string().refine(v=>isSafeRelativePath(v)&&v.endsWith('.md')&&!v.includes('..')),expectedRevision:z.union([z.literal('new'),z.string().uuid()]),content:z.string().max(MAX_TEXT_BYTES)}).strict();
const Actor=z.object({provider:z.literal('local_operator'),id:z.string().min(1).max(200)}).strict();
const Changes=z.array(Change).min(1).max(20);
type Change=z.infer<typeof Change>;
type Actor=z.infer<typeof Actor>;
export interface IngestionJob {
  id:string; owner_ref:string;brain_id:string;source_id:string;artifact_id:string;identity_key:string;content_sha256:string;
  stage:string;manifest:SourceReferenceManifest;original:any;extraction:any;candidate:any;approval:any;receipt:any;
  attempts:number;error_code:string|null;lease_token:string|null;lease_until:Date|null;
}

export class IngestionJobs {
  readonly revisions:PostgresRevisionStore;
  constructor(readonly pool:pg.Pool,readonly ownerRef:string,readonly brainId:string,readonly actor:Actor) {
    if(!/^[a-zA-Z0-9._-]{1,100}$/.test(ownerRef)||!/^[a-zA-Z0-9._:-]{1,200}$/.test(brainId))throw new IngestionError('invalid_owner_binding');
    Actor.parse(actor);this.revisions=new PostgresRevisionStore(pool);
  }
  private async transaction<T>(fn:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();try{await client.query('begin');await client.query("set local lock_timeout='5s'");const result=await fn(client);await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}finally{client.release();}
  }
  async get(id:string,client:pg.Pool|pg.PoolClient=this.pool,locked=false):Promise<IngestionJob>{
    z.string().uuid().parse(id);
    const result=await client.query<IngestionJob>(`select * from brain.ingestion_jobs where id=$1 and owner_ref=$2 and brain_id=$3 ${locked?'for update':''}`,[id,this.ownerRef,this.brainId]);
    if(!result.rows[0])throw new IngestionError('job_not_found_or_wrong_owner');return result.rows[0];
  }
  async prepare(input:unknown,bytes:Buffer):Promise<IngestionJob>{
    const manifest=SourceReferenceManifestSchema.parse(input),artifact=manifest.artifacts[0];
    if(manifest.brainId!==this.brainId || manifest.artifacts.length!==1 || artifact.kind!=='original' || !artifact.provider || !artifact.providerId || !artifact.relativePath || !artifact.rootAlias)throw new IngestionError('explicit_original_identity_required');
    if(!bytes.length||bytes.length>MAX_SOURCE_BYTES||manifest.contentMarkdown)throw new IngestionError('invalid_preparation');
    const hash=sha256(bytes);
    if(artifact.contentSha256 && artifact.contentSha256!==hash || artifact.byteSize!==undefined && artifact.byteSize!==bytes.length)throw new IngestionError('source_changed');
    artifact.contentSha256=hash;artifact.byteSize=bytes.length;
    const identity=sha256(JSON.stringify([artifact.provider,artifact.providerId]));
    return this.transaction(async client=>{
      // Identity remains stable across rename. Serializes competing preparations.
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`ingest:${manifest.sourceId}`]);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`ingest-identity:${this.ownerRef}:${this.brainId}:${identity}`]);
      const identities=await client.query('select source_id from brain.ingestion_jobs where owner_ref=$1 and brain_id=$2 and identity_key=$3',[this.ownerRef,this.brainId,identity]);
      if(identities.rows.some(row=>row.source_id!==manifest.sourceId))throw new IngestionError('reuse_existing_source_id');
      const sources=await client.query('select brain_id,companion_path from brain.sources where id=$1',[manifest.sourceId]);
      if(sources.rows.some(row=>row.brain_id!==this.brainId))throw new IngestionError('source_owned_elsewhere');
      if(sources.rows.some(row=>row.companion_path && row.companion_path!==manifest.companionPath))throw new IngestionError('source_companion_mismatch');
      const prior=await client.query<IngestionJob>('select * from brain.ingestion_jobs where source_id=$1',[manifest.sourceId]);
      if(prior.rows.some(row=>row.owner_ref!==this.ownerRef||row.brain_id!==this.brainId||row.identity_key!==identity))throw new IngestionError('source_identity_mismatch');
      if(prior.rows.some(row=>row.manifest.companionPath!==manifest.companionPath))throw new IngestionError('source_companion_mismatch');
      const existing=await client.query<IngestionJob>('select * from brain.ingestion_jobs where owner_ref=$1 and brain_id=$2 and identity_key=$3 and content_sha256=$4',[this.ownerRef,this.brainId,identity,hash]);
      if(existing.rows[0]){
        if(existing.rows[0].source_id!==manifest.sourceId)throw new IngestionError('reuse_existing_source_id');
        return existing.rows[0];
      }
      // One artifact UUID is immutable for one source revision; changed bytes need a new UUID.
      const owned=await client.query('select source_id,content_sha256 from brain.source_artifacts where id=$1',[artifact.id]);
      if(owned.rows.some(row=>row.source_id!==manifest.sourceId||row.content_sha256!==hash))throw new IngestionError('artifact_identity_mismatch');
      const result=await client.query<IngestionJob>(`insert into brain.ingestion_jobs(owner_ref,brain_id,source_id,artifact_id,identity_key,content_sha256,manifest) values($1,$2,$3,$4,$5,$6,$7) returning *`,[this.ownerRef,this.brainId,manifest.sourceId,artifact.id,identity,hash,manifest]);return result.rows[0];
    });
  }
  async claim(id:string):Promise<string>{
    const token=randomUUID();const result=await this.pool.query(`update brain.ingestion_jobs set lease_token=$4,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() where id=$1 and owner_ref=$2 and brain_id=$3 and (lease_until is null or lease_until<now()) returning id`,[id,this.ownerRef,this.brainId,token]);
    if(result.rowCount!==1)throw new IngestionError('job_busy_or_wrong_owner');return token;
  }
  private async leased(id:string,token:string,fn:(client:pg.PoolClient,job:IngestionJob)=>Promise<void>):Promise<void>{
    await this.transaction(async client=>{
      const job=await this.get(id,client,true);
      const valid=await client.query('select lease_token=$2::uuid and lease_until>now() as valid from brain.ingestion_jobs where id=$1',[id,token]);
      if(!valid.rows[0]?.valid)throw new IngestionError('lease_lost');
      await fn(client,job);
    });
  }
  private async release(id:string,token:string){await this.pool.query('update brain.ingestion_jobs set lease_token=null,lease_until=null where id=$1 and owner_ref=$2 and brain_id=$3 and lease_token=$4',[id,this.ownerRef,this.brainId,token]);}
  async advance(id:string,adapter:OriginalAdapter,localBytes?:Buffer):Promise<IngestionJob>{
    const token=await this.claim(id);
    try{
      let job=await this.get(id);if(['review','approved','needs_review','complete'].includes(job.stage))return job;
      const artifact=job.manifest.artifacts[0];
      const key=job.original?.key || `${this.brainId}/sources/${job.source_id}/original/${job.content_sha256}`;
      if(job.original && job.original.bucket!==adapter.bucket)throw new IngestionError('artifact_bucket_mismatch');
      if(!job.original)await this.leased(id,token,async client=>{
        await client.query('update brain.ingestion_jobs set original=$2 where id=$1',[id,{bucket:adapter.bucket,key,sha256:job.content_sha256,byteSize:artifact.byteSize,verified:false}]);
      });
      let bytes=await adapter.read(key);
      if(!bytes){
        if(job.original?.verified)throw new IngestionError('original_missing');
        if(!localBytes||sha256(localBytes)!==job.content_sha256||localBytes.length!==artifact.byteSize)throw new IngestionError('matching_source_bytes_required');
        // A lost upload response can still have created the immutable object.
        try{await adapter.put(key,localBytes,artifact.mimeType||'application/octet-stream');}catch(error){bytes=await adapter.read(key);if(!bytes)throw error;}
        bytes=await adapter.read(key);
      }
      if(!bytes||bytes.length>MAX_SOURCE_BYTES||bytes.length!==artifact.byteSize||sha256(bytes)!==job.content_sha256)throw new IngestionError('original_verification_failed');
      await this.leased(id,token,async client=>{
        await client.query("update brain.ingestion_jobs set original=$2,stage='verified',error_code=null,updated_at=now() where id=$1",[id,{bucket:adapter.bucket,key,sha256:job.content_sha256,byteSize:bytes!.length,verified:true}]);
      });
      const extraction=await extractLocalText(bytes,artifact.relativePath!);
      await this.leased(id,token,async client=>{
        await client.query("update brain.ingestion_jobs set extraction=$2,stage='review',updated_at=now() where id=$1",[id,{...extraction,sha256:sha256(extraction.content)}]);
      });
      return await this.get(id);
    }catch(error){
      const code=error instanceof IngestionError?error.message:'worker_failed';
      await this.pool.query("update brain.ingestion_jobs set stage='blocked',error_code=$5,updated_at=now() where id=$1 and owner_ref=$2 and brain_id=$3 and lease_token=$4 and lease_until>now()",[id,this.ownerRef,this.brainId,token,code]);throw error;
    }finally{await this.release(id,token);}
  }
  async review(id:string,reviewedContent:string,changes:Change[]=[]):Promise<IngestionJob>{
    return this.transaction(async client=>{
      const job=await this.get(id,client,true);
      if(!['review','needs_review'].includes(job.stage)||!job.original||!job.extraction||job.lease_token)throw new IngestionError('job_not_ready_for_review');
      if(Buffer.byteLength(reviewedContent)>MAX_TEXT_BYTES)throw new IngestionError('candidate_too_large');
      const manifest=SourceReferenceManifestSchema.parse({...job.manifest,contentMarkdown:reviewedContent,status:'processed'});
      const compiled=compileSourceReference(manifest);
      const head=await client.query('select current_revision_id from brain.brain_files where brain_id=$1 and filename=$2',[this.brainId,manifest.companionPath]);
      const all=Changes.parse([{filename:manifest.companionPath,expectedRevision:head.rows[0]?.current_revision_id||'new',content:compiled.markdown},...changes]);
      if(new Set(all.map(c=>c.filename)).size!==all.length || all.reduce((n,c)=>n+Buffer.byteLength(c.content),0)>MAX_TEXT_BYTES)throw new IngestionError('candidate_size_or_duplicate_target');
      // Bind every optional semantic edit to the exact supplied read, before approval.
      const reviewedChanges=[];
      for(const change of all){
        const result=await client.query('select f.current_revision_id,r.content,r.deleted from brain.brain_files f join brain.brain_file_revisions r on r.id=f.current_revision_id where f.brain_id=$1 and f.filename=$2',[this.brainId,change.filename]);
        if((result.rows[0]?.current_revision_id||'new')!==change.expectedRevision)throw new IngestionError('stale_review');
        reviewedChanges.push({...change,previousContent:result.rows[0]?.content??null,previousDeleted:result.rows[0]?.deleted??false});
      }
      if(reviewedChanges.reduce((n,c)=>n+Buffer.byteLength(c.previousContent||''),0)>MAX_TEXT_BYTES)throw new IngestionError('review_baseline_too_large');
      const payload={schema:'brain.ingestion-review/v1',jobId:id,ownerRef:this.ownerRef,brainId:this.brainId,sourceSha256:job.content_sha256,manifest,changes:reviewedChanges};
      const candidate={...payload,digest:hashValue(payload)};
      await client.query("update brain.ingestion_jobs set candidate=$2,approval=null,stage='review',error_code=null,updated_at=now() where id=$1",[id,candidate]);return this.get(id,client);
    });
  }
  async approve(id:string,digest:string):Promise<IngestionJob>{
    return this.transaction(async client=>{
      const job=await this.get(id,client,true);
      if(job.stage!=='review'||!job.candidate||job.candidate.digest!==digest||job.lease_token)throw new IngestionError('exact_review_approval_required');
      await client.query("update brain.ingestion_jobs set stage='approved',approval=$2,updated_at=now() where id=$1",[id,{digest,actor:this.actor,approvedAt:new Date().toISOString()}]);return this.get(id,client);
    });
  }
  async apply(id:string,adapter:OriginalAdapter):Promise<IngestionJob>{
    const token=await this.claim(id);
    try{
      const job=await this.get(id);if(job.stage==='complete')return job;
      if(job.stage!=='approved'||!job.candidate||job.candidate.digest!==job.approval?.digest)throw new IngestionError('exact_review_approval_required');
      if(job.original?.bucket!==adapter.bucket)throw new IngestionError('artifact_bucket_mismatch');
      const bytes=await adapter.read(job.original.key);
      if(!bytes||bytes.length!==job.original.byteSize||sha256(bytes)!==job.content_sha256)throw new IngestionError('original_verification_failed');
      await this.leased(id,token,async(client,current)=>{
        if(current.stage!=='approved'||current.candidate.digest!==current.approval?.digest)throw new IngestionError('exact_review_approval_required');
        const {digest,...payload}=current.candidate;
        if(hashValue(payload)!==digest)throw new IngestionError('candidate_corrupt');
        const changes=Changes.parse(current.candidate.changes.map(({previousContent,previousDeleted,...change}:any)=>change)).sort((a,b)=>a.filename.localeCompare(b.filename));
        // Lock every destination before checking any head, then commit all writes,
        // source metadata and the receipt together. Crashes cannot split them.
        for(const change of changes){
          await client.query('select pg_advisory_xact_lock(hashtextextended($1 || \'/\' || $2,0))',[this.brainId,change.filename]);
          const head=await client.query('select current_revision_id from brain.brain_files where brain_id=$1 and filename=$2',[this.brainId,change.filename]);
          if((head.rows[0]?.current_revision_id||'new')!==change.expectedRevision){
            await client.query("update brain.ingestion_jobs set stage='needs_review',approval=null,error_code='stale_review',updated_at=now() where id=$1",[id]);return;
          }
        }
        const persisted=await persistSourceReference(client,current.candidate.manifest);
        await client.query("update brain.source_artifacts set storage_bucket=$2,storage_path=$3,retention_status='active' where id=$1",[current.artifact_id,current.original.bucket,current.original.key]);
        await client.query(`insert into brain.source_artifact_text(artifact_id,text_format,content,content_sha256) values($1,$2,$3,$4) on conflict(artifact_id) do nothing`,[current.artifact_id,current.extraction.format,current.extraction.content,current.extraction.sha256]);
        const revisions=[];
        for(const change of changes){
          const result=await this.revisions.proposeRevisionInTransaction(client,{brainId:this.brainId,filename:change.filename,baseRevisionId:change.expectedRevision==='new'?null:change.expectedRevision,content:change.content,origin:'import',actor:current.approval.actor});
          if(!result.ok)throw new IngestionError('write_conflict');
          revisions.push({filename:change.filename,revisionId:result.revision.revisionId,sha256:result.revision.contentHash});
        }
        const receipt={schema:'brain.ingestion-receipt/v1',jobId:id,ownerRef:this.ownerRef,brainId:this.brainId,sourceId:current.source_id,original:current.original,reviewDigest:digest,approvedBy:current.approval.actor,appliedBy:this.actor,completedAt:new Date().toISOString(),revisions,persisted};
        await client.query("update brain.ingestion_jobs set stage='complete',receipt=$2,error_code=null,updated_at=now() where id=$1",[id,receipt]);
      });return await this.get(id);
    }finally{await this.release(id,token);}
  }
}
