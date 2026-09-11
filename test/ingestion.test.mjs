import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readLocalSource,extractLocalText,sha256,hashValue,MAX_SOURCE_BYTES} from '../dist/ingestion/local.js';
import {SupabaseIngestionAdapter} from '../dist/ingestion/supabase.js';

test('explicit local originals reject symlinks, traversal, changed hashes, oversized and invalid text',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ingest-local-')));
 try{
  await fs.writeFile(path.join(root,'note.md'),'An original.\n');const bytes=await readLocalSource(root,'note.md');assert.equal(bytes.toString(),'An original.\n');
  await fs.symlink(path.join(root,'note.md'),path.join(root,'alias.md'));await assert.rejects(readLocalSource(root,'alias.md'),/symlink/);
  await assert.rejects(readLocalSource(root,'../note.md'),/unsafe/);
  const open=fs.open;
  fs.open=async(...args)=>{const h=await open(...args);const read=h.read.bind(h);h.read=async(...params)=>{const result=await read(...params);await fs.appendFile(path.join(root,'note.md'),'Concurrent save');return result;};return h;};
  try{await assert.rejects(readLocalSource(root,'note.md'),/source_changed/);}finally{fs.open=open;}
  await fs.writeFile(path.join(root,'large.txt'),'');await fs.truncate(path.join(root,'large.txt'),MAX_SOURCE_BYTES+1);await assert.rejects(readLocalSource(root,'large.txt'),/size/);
  assert.equal((await extractLocalText(bytes,'note.md')).format,'markdown');
  await assert.rejects(extractLocalText(Buffer.from([255]),'bad.txt'),/encoding/);
  await assert.rejects(extractLocalText(bytes,'slide.pptx'),/unsupported/);
  await assert.rejects(extractLocalText(Buffer.from('  '),'blank.txt'),/empty/);
  assert.equal(hashValue({b:1,a:{d:2,c:3}}),hashValue({a:{c:3,d:2},b:1}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('bounded PDF converter extracts a synthetic one-page original',async t=>{
 if((await import('node:child_process')).spawnSync('pdftotext',['-v']).error?.code==='ENOENT')return t.skip('operator pdftotext is not installed');
 const stream='BT /F1 12 Tf 30 100 Td (Synthetic original) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 assert.match((await extractLocalText(Buffer.from(pdf),'source.pdf')).content,/Synthetic original/);
});

test('Supabase ingestion adapter streams bounded bytes and never requests upsert',async()=>{
 const requests=[],prior=globalThis.fetch;let mode='missing';
 globalThis.fetch=async(input,init)=>{
  requests.push({url:String(input),method:init.method,headers:init.headers});
  if(init.method==='POST')return new Response(JSON.stringify({Key:'original',Id:randomUUID()}),{status:200});
  if(mode==='missing')return new Response(JSON.stringify({message:'Object not found',statusCode:'404'}),{status:400});
  if(mode==='denied')return new Response(JSON.stringify({message:'PRIVATE provider failure'}),{status:403});
  if(mode==='oversized')return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_SOURCE_BYTES+1));controller.close();}}));
  return new Response(Buffer.from('Original bytes'));
 };
 try{
  const adapter=new SupabaseIngestionAdapter('https://test.supabase.co','fixture-key');
  assert.equal(await adapter.read('brain/source/original'),null);
  await adapter.put('brain/source/original',Buffer.from('Original bytes'),'text/plain');
  assert.equal(new Headers(requests.at(-1).headers).get('x-upsert'),'false');
  mode='ok';assert.equal((await adapter.read('brain/source/original')).toString(),'Original bytes');
  mode='denied';await assert.rejects(adapter.read('brain/source/original'),error=>error.message==='artifact_read_failed');
  mode='oversized';await assert.rejects(adapter.read('brain/source/original'),/too_large/);
 }finally{globalThis.fetch=prior;}
});
