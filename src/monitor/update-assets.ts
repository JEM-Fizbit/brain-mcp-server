import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';

// Optional, explicitly published application assets; never reads Brain originals.
export class MonitorUpdateAssets {
  private active=0;
  constructor(readonly directory:string) {}
  async handle(req:IncomingMessage,res:ServerResponse,url:URL) {
    const send=(status:number,message:string)=>{res.writeHead(status,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(message);};
    if(!['GET','HEAD'].includes(req.method || '')){send(405,'method_not_allowed');return;}
    const filename=url.pathname.slice('/monitor/updates/'.length);
    if(!/^(appcast\.xml|Brain-Monitor-[1-9][0-9]{0,15}-(arm64|x64)\.zip)$/.test(filename) || url.search){send(404,'not_found');return;}
    if(this.active>=4){send(503,'try_later');return;}
    this.active++;
    try {
      const root=await fs.realpath(this.directory),target=await fs.realpath(path.join(root,filename));
      if(path.dirname(target)!==root){send(404,'not_found');return;}
      const stat=await fs.stat(target);
      if(!stat.isFile() || stat.size>200*1024*1024 || filename==='appcast.xml' && stat.size>1024*1024){send(404,'not_found');return;}
      res.writeHead(200,{'Content-Type':filename.endsWith('.xml')?'application/xml':'application/zip','Content-Length':stat.size,
        'Cache-Control':filename==='appcast.xml'?'no-store':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",'Referrer-Policy':'no-referrer'});
      if(req.method==='HEAD')res.end();else await pipeline(createReadStream(target),res);
    } catch {if(!res.headersSent)send(404,'not_found');else res.destroy();}
    finally {this.active--;}
  }
}
