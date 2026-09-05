import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve('.');
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify({videos:[],photos:[],archive:[],quotes:[],challenges:[]}));return;}
 try{const p=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!p.startsWith(root+'/'))throw Error();res.setHeader('content-type',extname(p)==='.js'?'text/javascript':'text/html');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
try{
 for(const mode of ['blocked','silent','unavailable','transaction','quota','oversize']){
  const p=await browser.newPage();p.on('dialog',d=>d.accept());
  await p.addInitScript(mode=>{
   window.puts=0;window.aborts=0;window.lateClosed=false;
   const open=indexedDB.open.bind(indexedDB);
   indexedDB.open=(...args)=>{
    if(mode==='unavailable')throw new DOMException('Unavailable','SecurityError');
    if(mode==='silent'||mode==='blocked'){
     const r={};if(mode==='blocked')setTimeout(()=>r.onblocked?.(),0);
     window.lateOpen=()=>{r.result={close(){window.lateClosed=true;}};r.onsuccess?.();};return r;
    }
    const r=open(...args);r.addEventListener('success',()=>{
     const db=r.result,tx=db.transaction.bind(db);
     db.transaction=(...args)=>{
      if(args[1]==='readwrite'){
       puts++;
       if(mode==='quota')throw new DOMException('Full','QuotaExceededError');
       if(mode==='transaction')return {objectStore(){return {put(){return {};},delete(){return {};}};},abort(){aborts++;}};
      }
      return tx(...args);
     };
    });return r;
   };
   if(mode==='oversize'){
    const Native=MediaRecorder;
    window.MediaRecorder=class extends Native{
     set ondataavailable(fn){
      super.ondataavailable=function(e){
       Object.defineProperty(e,'data',{configurable:true,value:new Blob([new Uint8Array(50*1024*1024+1)],{type:'video/webm'})});
       fn.call(this,e);
      };
     }
     get ondataavailable(){return super.ondataavailable;}
    };
   }
  },mode);
  await p.goto(`http://127.0.0.1:${server.address().port}`);await p.click('#live-start-btn');
  await p.waitForFunction(()=>!document.querySelector('#live-record-btn').disabled,null,{timeout:6500});
  if(mode==='silent'||mode==='blocked'){await p.evaluate(()=>lateOpen());assert.ok(await p.evaluate(()=>lateClosed),'late opened database must close');}
  await p.click('#live-inline-record-btn');await p.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Gravando'));
  await p.waitForTimeout(500);await p.click('#live-close-btn');
  await p.waitForFunction(()=>!document.querySelector('#live-record-preview').hidden);
  assert.equal(await p.evaluate(()=>window.liveRecorderState()),false,'storage cannot keep active run alive');
  await p.waitForFunction(()=>!document.querySelector('#live-record-discard').disabled,null,{timeout:6500});
  assert.ok(await p.locator('#live-record-download').getAttribute('href'));
  await p.check('#live-record-consent');
  if(mode==='oversize'){
   assert.ok(await p.locator('#live-record-save').isDisabled(),'oversize clip must not upload');
   assert.match(await p.locator('#live-record-status').textContent(),/50 MB/);
  }
  if(mode==='transaction')assert.ok(await p.evaluate(()=>aborts>0),'timed out transactions abort');
  if(['blocked','silent','unavailable'].includes(mode))assert.equal(await p.evaluate(()=>puts),0,'unread durable draft must not be overwritten');
  await p.click('#live-record-discard');await p.waitForFunction(()=>document.querySelector('#live-record-preview').hidden,null,{timeout:6500});
  if(mode!=='oversize')assert.match(await p.locator('#live-record-status').textContent(),/borrador.*(seguir|permane)/i,'failed deletion must warn durable draft may remain');
  console.log('draft storage passed:',mode);await p.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
