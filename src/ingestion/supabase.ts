import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {assertStoragePath} from '../artifacts/path.js';
import {MAX_SOURCE_BYTES,IngestionError} from './local.js';
import type {OriginalAdapter} from './jobs.js';

/** Uses the existing operator Storage credential; never installed in a viewer. */
export class SupabaseIngestionAdapter implements OriginalAdapter {
  readonly client:SupabaseClient;
  constructor(url:string,key:string,readonly bucket='brain-artifacts'){
    this.client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(30_000),...(init?.signal?[init.signal]:[])])})}});
  }
  async read(key:string):Promise<Buffer|null>{
    assertStoragePath(key);
    const {data,error}=await this.client.storage.from(this.bucket).download(key).asStream();
    if(error){
      if('status' in error && error.status===404 || error.message==='Object not found')return null;
      throw new IngestionError('artifact_read_failed');
    }
    if(!data)throw new IngestionError('artifact_read_failed');
    const reader=data.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_SOURCE_BYTES)throw new IngestionError('original_too_large');chunks.push(part.value);}return Buffer.concat(chunks);}finally{await reader.cancel();reader.releaseLock();}
  }
  async put(key:string,bytes:Buffer,mime:string):Promise<void>{
    assertStoragePath(key);if(!bytes.length||bytes.length>MAX_SOURCE_BYTES)throw new IngestionError('source_size_or_type');
    const {error}=await this.client.storage.from(this.bucket).upload(key,bytes,{upsert:false,contentType:mime,cacheControl:'31536000'});
    if(error)throw new IngestionError('artifact_upload_failed');
  }
}
