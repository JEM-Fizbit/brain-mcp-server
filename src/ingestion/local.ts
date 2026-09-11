import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isSafeRelativePath} from '../source-references/schema.js';

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function hashValue(value: unknown): string {
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
  return sha256(JSON.stringify(canonical(value)));
}
export class IngestionError extends Error {}

/** The root is explicit; no recursive enumeration or inbox move occurs. */
export async function readLocalSource(root: string, relativePath: string): Promise<Buffer> {
  if (!path.isAbsolute(root) || !isSafeRelativePath(relativePath)) throw new IngestionError('unsafe_source_path');
  const rootPath = path.resolve(root), target = path.join(rootPath,relativePath);
  if (await fs.realpath(rootPath) !== rootPath) throw new IngestionError('symlink_root');
  let cursor=rootPath;
  for (const part of relativePath.split('/')) {
    cursor=path.join(cursor,part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw new IngestionError('symlink_source');
  }
  const handle=await fs.open(target,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before=await handle.stat({bigint:true});
    if (!before.isFile() || before.size===0n || before.size>BigInt(MAX_SOURCE_BYTES)) throw new IngestionError('source_size_or_type');
    // Bounded reads also stop a concurrently growing file from exhausting memory.
    const bytes=Buffer.alloc(Number(before.size));let offset=0;
    while(offset<bytes.length){const result=await handle.read(bytes,offset,bytes.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
    const after=await handle.stat({bigint:true}), atPath=await fs.lstat(target,{bigint:true});
    if(offset!==bytes.length || !atPath.isFile() || ['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key as keyof typeof before]!==after[key as keyof typeof after] || before[key as keyof typeof before]!==atPath[key as keyof typeof atPath]) || await fs.realpath(target)!==target) throw new IngestionError('source_changed');
    return bytes;
  } finally {await handle.close();}
}

export async function extractLocalText(bytes: Buffer, filename: string): Promise<{content:string;format:'plain_text'|'markdown'}> {
  const extension=path.extname(filename).toLowerCase();
  let content:string;
  if(['.txt','.md','.csv','.json','.html','.xml','.yaml','.yml'].includes(extension)) {
    if(bytes.length>MAX_TEXT_BYTES)throw new IngestionError('extraction_too_large');
    try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new IngestionError('unsupported_text_encoding');}
    if(content.includes('\0'))throw new IngestionError('unsupported_text_encoding');
  } else if(extension==='.pdf') {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brain-extract-'));
    try {
      const input=path.join(dir,'source.pdf');await fs.writeFile(input,bytes,{mode:0o600});
      const output=await promisify(execFile)('pdftotext',['-layout',input,'-'],{timeout:30_000,maxBuffer:MAX_TEXT_BYTES,encoding:'utf8'});
      content=output.stdout;
    }catch{throw new IngestionError('pdf_extraction_failed');}finally{await fs.rm(dir,{recursive:true,force:true});}
  } else throw new IngestionError('unsupported_extraction');
  if(!content.trim())throw new IngestionError('empty_extraction');
  return {content,format:extension==='.md'?'markdown':'plain_text'};
}
