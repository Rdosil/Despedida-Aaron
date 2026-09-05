import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
const root=resolve('.');
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify({videos:[],hasMore:false,photos:[],archive:[],quotes:[],challenges:[]}));return;}
 try {const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
try {
 const page=await browser.newPage();
 page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{window.mediaTracks=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);window.mediaTracks.push(...s.getTracks());return s;};});
 await page.addInitScript(()=>{window.drawn=[];const f=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.drawn.push(String(text));return f.call(this,text,...args);};});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.click('#live-start-btn');await page.click('#live-inline-record-btn');
 await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Gravando'));
 const chatBox=await page.locator('#live-comments').boundingBox();
 assert.ok(chatBox && chatBox.height <= 150,'comments must stay compact');
 assert.ok(await page.locator('#live-composer-input').isVisible(),'composer must remain usable');
 assert.equal(await page.locator('#live-send-btn').isEnabled(),true);
 assert.equal(await page.evaluate(()=>document.querySelector('#live-comments').scrollHeight <= 150),true);
 assert.equal(await page.evaluate(()=>mediaTracks.filter(t=>t.readyState==='live'&&t.kind==='audio').length),1);
 await page.fill('#live-composer-input','Comentario de proba');await page.click('#live-send-btn');await page.click('#live-like-btn');
 await page.waitForTimeout(1800);await page.click('#live-close-btn');
 await page.waitForFunction(()=>!document.querySelector('#live-record-preview').hidden);
 assert.equal(await page.locator('#live-mode-state').textContent(),'DEMO','closing must stop the live simulator');
 const result=await page.evaluate(async()=>{const v=document.querySelector('#live-record-playback');await v.play();return {size:(await(await fetch(v.src)).blob()).size,width:v.videoWidth,height:v.videoHeight,tracks:mediaTracks.map(t=>t.readyState)};});
 assert.ok(result.size>1000);assert.equal(result.width,720);assert.equal(result.height,1280);assert.ok(result.tracks.every(s=>s==='ended'));
 await page.click('#live-start-btn');
 assert.equal(await page.locator('#live-record-btn').isEnabled(),true,'unpublished draft must not block another recording');
 await page.click('#live-inline-record-btn');await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Gravando'));
 await page.waitForTimeout(800);await page.click('#live-close-btn');
 await page.waitForFunction(()=>!document.querySelector('#live-record-preview').hidden);
 assert.equal(await page.locator('#live-record-save').isDisabled(),true);
 await page.check('#live-record-consent');assert.equal(await page.locator('#live-record-save').isEnabled(),true);

 await page.route('**/api/videos',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'}));
 await page.click('#live-record-save');await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('descargar'));
 assert.ok(await page.locator('#live-record-download').getAttribute('href'));
 await page.unroute('**/api/videos');
 let uploadedPath, putBytes=0;
 const blobURL=p=>'https://test.public.blob.vercel-storage.com/'+p;
 await page.route('https://vercel.com/api/blob/**',async route=>{putBytes=route.request().postDataBuffer()?.length||0;await route.fulfill({json:{url:blobURL(uploadedPath),downloadUrl:blobURL(uploadedPath),pathname:uploadedPath,contentType:'video/webm',contentDisposition:'inline'}});});
 await page.route('**/api/videos*',async route=>{
  if(route.request().method()==='POST'){const body=route.request().postDataJSON();uploadedPath=body.payload.pathname;assert.equal(JSON.parse(body.payload.clientPayload).consent,true);await route.fulfill({json:{type:'blob.generate-client-token',clientToken:'vercel_blob_client_test_fake'}});}
  else {const second=route.request().url().includes('cursor=next');await route.fulfill({json:{videos:[{pathname:second?'second.webm':uploadedPath,url:blobURL(second?'second.webm':uploadedPath)}],hasMore:!second,cursor:second?null:'next'}});}
 });
 await page.click('#live-record-save');await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Vídeo publicado'));
 assert.ok(uploadedPath?.startsWith('live-videos/'),'SDK requested namespaced direct upload');
 assert.equal(await page.locator('#live-record-save').isDisabled(),true,'published recording must not be submitted twice');
 await page.click('#live-video-more');await page.waitForFunction(()=>document.querySelectorAll('#live-video-gallery article').length===2);
 assert.equal(await page.locator('#live-video-more').isHidden(),true);
 await page.click('#live-start-btn');await page.click('#live-inline-record-btn');await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Gravando'));
 await page.evaluate(()=>{if(document.fullscreenElement) return document.exitFullscreen();});
 await page.waitForTimeout(500);await page.click('#live-inline-record-stop');await page.waitForFunction(()=>!document.querySelector('#live-record-preview').hidden);
 await page.waitForFunction(()=>!document.querySelector('#live-record-discard').disabled);
 await page.evaluate(()=>{const c=window.confirm;window.confirm=()=>true;document.querySelector('#live-record-discard').click();window.confirm=c;});
 await page.waitForFunction(()=>document.querySelector('#live-record-preview').hidden);
 assert.equal(await page.locator('#live-record-btn').isEnabled(),true,'recording must restart after leaving live');
 console.log('direct SDK upload mock, duplicate prevention and gallery pagination ok');
 await page.evaluate(()=>document.querySelector('#live-record-btn').click());
 await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Gravando'));
 await page.evaluate(()=>document.querySelector('#live-reset-btn').click());
 await page.waitForFunction(()=>mediaTracks.every(t=>t.readyState==='ended'));
 assert.ok(await page.evaluate(()=>mediaTracks.every(t=>t.readyState==='ended')));
 console.log('real Chromium fake-media ok:',JSON.stringify(result),'preview, consent, upload failure/download, discard, reset cleanup');
 assert.ok(await page.evaluate(()=>drawn.some(t=>t.includes('Comentario de proba')) && drawn.includes(document.querySelector('#live-title-display').textContent) && drawn.some(t=>t.startsWith('EN VIVO')) && drawn.includes('♥')),'compositor draws comment, title, viewers and hearts');
 const denied=await browser.newPage();await denied.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});await denied.goto(`http://127.0.0.1:${server.address().port}`);await denied.click('#live-start-btn');await denied.click('#live-inline-record-btn');await denied.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Non se puido gravar'));assert.equal(await denied.locator('#live-record-btn').isEnabled(),true);assert.ok(await denied.evaluate(()=>document.querySelector('#live-video').srcObject===null));console.log('denied media cleanup and composited overlays ok');
 const unsupported=await browser.newPage();await unsupported.addInitScript(()=>{window.MediaRecorder=undefined;});await unsupported.goto(`http://127.0.0.1:${server.address().port}`);assert.equal(await unsupported.locator('#live-record-btn').isDisabled(),true);console.log('unsupported recorder fallback ok');
} finally {await browser.close();await new Promise(r=>server.close(r));}
