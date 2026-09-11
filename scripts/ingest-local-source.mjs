import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {parseArgs} from 'node:util';
import {applyBrainMonitorProfileEnv,assertHostedRuntimeBinding} from './lib/hosted-runtime-binding.mjs';
import {SourceReferenceManifestSchema} from '../dist/source-references/schema.js';
import {IngestionJobs} from '../dist/ingestion/jobs.js';
import {SupabaseIngestionAdapter} from '../dist/ingestion/supabase.js';
import {readLocalSource,sha256,IngestionError,MAX_TEXT_BYTES} from '../dist/ingestion/local.js';
import {postgresPoolOptions} from '../dist/sync/postgres-revision-store.js';
import {attachPoolErrorLogger} from '../dist/services/pg-pool.js';

// Deliberately never loads .env.local, scans a root, or starts a scheduler.
const {values,positionals}=parseArgs({allowPositionals:true,options:Object.fromEntries(['brain','profile','manifest','root','job','review-content','changes','digest','out'].map(name=>[name,{type:'string'}]))});
const command=positionals[0];
const usage='Usage: node scripts/ingest-local-source.mjs dry-run|prepare|resume|status|review|approve|apply --brain ID [--profile OWNER_CONFIG] [--manifest FILE --root ABSOLUTE_ROOT] [--job UUID] [--review-content FILE --changes JSON] [--digest REVIEW_SHA256] [--out FILE]';
let pool,lastJobId;
try{
  if(positionals.length!==1||!['dry-run','prepare','resume','status','review','approve','apply'].includes(command)||!values.brain)throw new IngestionError(usage);
  const readJson=async file=>JSON.parse((await readLocalSource(path.dirname(path.resolve(file)),path.basename(file))).toString('utf8'));
  let manifest,bytes;
  if(['dry-run','prepare'].includes(command)){
    if(!values.manifest||!values.root)throw new IngestionError('manifest_and_explicit_root_required');
    manifest=SourceReferenceManifestSchema.parse(await readJson(values.manifest));
    if(manifest.brainId!==values.brain||manifest.artifacts.length!==1)throw new IngestionError('manifest_brain_or_original_mismatch');
    bytes=await readLocalSource(values.root,manifest.artifacts[0].relativePath);
    if(manifest.artifacts[0].contentSha256 && manifest.artifacts[0].contentSha256!==sha256(bytes) || manifest.artifacts[0].byteSize!==undefined && manifest.artifacts[0].byteSize!==bytes.length)throw new IngestionError('source_changed');
    manifest.artifacts[0].contentSha256=sha256(bytes);manifest.artifacts[0].byteSize=bytes.length;
    if(command==='dry-run'){
      console.log(JSON.stringify({dryRun:true,manifest,byteSize:bytes.length,contentSha256:sha256(bytes)},null,2));process.exit(0);
    }
  }
  const env={...process.env,BRAIN_ID:values.brain,...(values.profile?{BRAIN_MONITOR_CONFIG_FILE:values.profile}:{})};
  await applyBrainMonitorProfileEnv(env);const binding=assertHostedRuntimeBinding(env,'Local source ingestion');
  if(!binding.databaseBound)throw new IngestionError('owner_bound_database_required');
  pool=attachPoolErrorLogger(new pg.Pool({...postgresPoolOptions(env.BRAIN_REVISION_DATABASE_URL),max:2}),'local_ingestion');
  const jobs=new IngestionJobs(pool,binding.expectedProjectRef,values.brain,{provider:'local_operator',id:os.userInfo().username});
  const adapter=()=>{
    if(env.BRAIN_ARTIFACT_BYTE_ACCESS!=='admin'||!env.BRAIN_SUPABASE_SERVICE_ROLE_KEY)throw new IngestionError('existing_operator_byte_access_required');
    const expected=`https://${binding.expectedProjectRef}.supabase.co`;
    if(env.BRAIN_SUPABASE_URL && env.BRAIN_SUPABASE_URL.replace(/\/$/,'')!==expected)throw new IngestionError('artifact_project_mismatch');
    // Legacy service keys embed a project ref. Refuse a wrong-project key before sending it.
    const key=env.BRAIN_SUPABASE_SERVICE_ROLE_KEY;
    if(key.split('.').length===3){let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw new IngestionError('invalid_artifact_key');}if(claims.ref!==binding.expectedProjectRef||claims.role!=='service_role')throw new IngestionError('artifact_key_project_mismatch');}
    return new SupabaseIngestionAdapter(expected,key,env.BRAIN_SUPABASE_STORAGE_BUCKET||'brain-artifacts');
  };
  let job;
  if(command==='prepare'){
    const artifacts=adapter(); // Establish byte custody before creating a durable job.
    job=await jobs.prepare(manifest,bytes);lastJobId=job.id;job=await jobs.advance(job.id,artifacts,bytes);
  }else{
    if(!values.job)throw new IngestionError('job_required');
    if(command==='resume'){
      job=await jobs.get(values.job);
      const local=values.root?await readLocalSource(values.root,job.manifest.artifacts[0].relativePath):undefined;
      job=await jobs.advance(values.job,adapter(),local);
    }else if(command==='review'){
      if(!values['review-content']||!values.out)throw new IngestionError('review_content_and_output_required');
      const file=path.resolve(values['review-content']);const content=await readLocalSource(path.dirname(file),path.basename(file));
      if(content.length>MAX_TEXT_BYTES)throw new IngestionError('candidate_too_large');
      const changes=values.changes?await readJson(values.changes):[];
      job=await jobs.review(values.job,new TextDecoder('utf8',{fatal:true}).decode(content),changes);
    }else if(command==='approve')job=await jobs.approve(values.job,values.digest);
    else if(command==='apply')job=await jobs.apply(values.job,adapter());
    else job=await jobs.get(values.job);
  }
  if(values.out){
    // Exclusive creation preserves an operator's existing review document.
    await fs.writeFile(path.resolve(values.out),JSON.stringify(job.candidate||job,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({jobId:job.id,brainId:job.brain_id,stage:job.stage,attempts:job.attempts,errorCode:job.error_code,reviewDigest:job.candidate?.digest,receipt:job.receipt,output:values.out?path.resolve(values.out):undefined},null,2));
  if(job.stage==='needs_review'||job.stage==='blocked')process.exitCode=2;
}catch(error){
  // SQL/provider errors may include content or secrets; expose stable codes only.
  const code=error instanceof IngestionError?error.message:error?.code==='42P01'?'ingestion_migration_required':'ingestion_command_failed';
  console.error(JSON.stringify({error:code,jobId:lastJobId||values.job}));process.exitCode=1;
}finally{await pool?.end();}
