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
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{window.requests=[];window.tracks=[];const orig=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{requests.push(c);const s=await orig(c);tracks.push(...s.getTracks());return s;};});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.click('#live-start-btn');
 await page.waitForFunction(()=>document.querySelector('#live-video').videoWidth>0);
 await page.evaluate(()=>{window.originalCamera=document.querySelector('#live-video').srcObject;document.querySelector('#live-composer-input').value='keep-this-comment';document.querySelector('#live-send-btn').click();document.querySelector('#live-pause-btn').click();});
 const before=await page.locator('#live-video').boundingBox();
 await page.click('#live-inline-record-btn');
 await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Gravando'));
 assert.equal(await page.evaluate(()=>document.querySelector('#live-video').srcObject===originalCamera),true,'recording must reuse existing camera');
 assert.match(await page.locator('#live-comments').textContent(),/keep-this-comment/,'recording must preserve comments');
 assert.deepEqual(await page.locator('#live-video').boundingBox(),before,'recording must preserve framing');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#live-video')).objectFit),'cover','selfie preview must fill the 9:16 frame');
 assert.match(await page.evaluate(()=>getComputedStyle(document.querySelector('#live-video')).transform),/matrix\(-1/);
 assert.equal(await page.evaluate(()=>requests.filter(c=>c.video).length),1);
 assert.ok(await page.evaluate(()=>requests.some(c=>c.video && (c.video.facingMode==='user' || c.video.facingMode?.ideal==='user') && !c.video.width && !c.video.height && !c.video.aspectRatio)),'native selfie camera, no forced 720x1280 crop');
 await page.waitForTimeout(800);await page.click('#live-inline-record-stop');
 await page.waitForFunction(()=>!document.querySelector('#live-record-preview').hidden);
 assert.equal(await page.locator('#live-mode-state').textContent(),'LIVE');
 assert.equal(await page.evaluate(()=>originalCamera.getVideoTracks()[0].readyState),'live');
 await page.click('#live-close-btn');
 await page.waitForFunction(()=>!document.fullscreenElement && document.getElementById('live-shell').classList.contains('simulator-closed'));
 assert.equal(await page.evaluate(()=>tracks.every(t=>t.readyState==='ended')),true);
 assert.equal(await page.locator('#live-mode-state').textContent(),'DEMO');
 assert.ok(await page.evaluate(()=>getComputedStyle(document.querySelector('#live-stage')).display==='none'),'X must hide the live stage so the page can scroll');
 await page.waitForFunction(()=>!document.querySelector('#live-record-preview').hidden);
 await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('gardado') || document.querySelector('#live-record-status').textContent.includes('temporal'));
 assert.ok(await page.evaluate(()=>requests.filter(c=>c.video).length===1),'recording must not reopen the camera');
 assert.ok(await page.evaluate(()=>requests.some(c=>c.audio && !c.video)),'recording may only request the microphone');
 const cdp=await page.context().newCDPSession(page);
 await page.locator('#live-record-preview').scrollIntoViewIfNeeded();
 const box=await page.locator('#live-record-preview').boundingBox();
 const y=Math.min(650,box.y+Math.min(80,box.height/2)), x=box.x+box.width/2;
 const scrollBefore=await page.evaluate(()=>scrollY);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*30}]});await page.waitForTimeout(20);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(300);
 assert.ok(await page.evaluate(()=>scrollY)!==scrollBefore,'touch scroll after X');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#live-like-btn')).borderRadius),'50%');
 await page.reload();
 await page.waitForFunction(()=>!document.querySelector('#live-record-preview').hidden);
 assert.ok(await page.locator('#live-record-download').getAttribute('href'),'draft restored after reload');
 await page.click('#live-record-discard');await page.waitForFunction(()=>document.querySelector('#live-record-preview').hidden);
 // CSS immersive must fill the viewport even when the Fullscreen API rejects (Chrome after a camera+FS race).
 {
  const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  p.on('dialog',d=>d.accept());
  await p.addInitScript(()=>{
   HTMLElement.prototype.requestFullscreen=async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});};
   HTMLElement.prototype.webkitRequestFullscreen=HTMLElement.prototype.requestFullscreen;
  });
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await p.click('#live-start-btn');
  await p.waitForFunction(()=>document.querySelector('#live-frame').classList.contains('immersive'));
  assert.equal(await p.evaluate(()=>Math.round(document.querySelector('#live-frame').getBoundingClientRect().height)),844,'live must fill the screen without native fullscreen');
  assert.equal(await p.evaluate(()=>document.fullscreenElement),null);
  await p.click('#live-close-btn');
  await p.waitForFunction(()=>!document.querySelector('#live-frame').classList.contains('immersive') && document.getElementById('live-shell').classList.contains('simulator-closed'));
  assert.equal(await p.evaluate(()=>getComputedStyle(document.body).overflow!=='hidden' || document.body.classList.contains('live-immersive')===false),true);
  await p.click('#live-fullscreen-btn');
  await p.waitForFunction(()=>document.querySelector('#live-frame').classList.contains('immersive') && !document.getElementById('live-shell').classList.contains('simulator-closed'));
  assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('#live-stage')).display!=='none'),true,'fullscreen must unhide the stage after X');
  await p.click('#live-close-btn');
  await p.close();
 }
 // Repeated immersive sessions; X while recording, not only after stopping.
 for(let i=0;i<2;i++){
  await page.click('#live-start-btn');await page.waitForFunction(()=>document.querySelector('#live-frame').classList.contains('immersive'));
  assert.equal(await page.evaluate(()=>Math.round(document.querySelector('#live-frame').getBoundingClientRect().height)),await page.evaluate(()=>innerHeight),'immersive fills mobile viewport');
  await page.click('#live-inline-record-btn');await page.waitForFunction(()=>document.querySelector('#live-record-status').textContent.includes('Gravando'));
  await page.waitForTimeout(600);await page.click('#live-close-btn');
  await page.waitForFunction(()=>!document.fullscreenElement && !document.querySelector('#live-record-preview').hidden && !window.liveRecorderState());
  assert.ok(await page.evaluate(()=>tracks.every(t=>t.readyState==='ended')));
  await page.click('#live-record-discard');await page.waitForFunction(()=>document.querySelector('#live-record-preview').hidden);
 }
 console.log('mobile fullscreen, unchanged camera/comments/framing, stop-only, X, touch scrolling, durable reload, repeat sessions passed');
 // Delay real media resolution/play promises; stale completions must not mutate a new session.
 for(const phase of ['camera','play','microphone']){
  const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(phase=>{
   window.tracks=[];window.waiting=false;window.delay=true;
   const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   navigator.mediaDevices.getUserMedia=async c=>{const stream=await gum(c);tracks.push(...stream.getTracks());if(delay && ((phase==='camera'&&c.video)||(phase==='microphone'&&c.audio))){delay=false;waiting=true;await new Promise(r=>window.resume=r);}return stream;};
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=async function(){const result=await play.call(this);if(phase==='play'&&delay&&this.id==='live-video'){delay=false;waiting=true;await new Promise(r=>window.resume=r);}return result;};
  },phase);
  await p.goto(`http://127.0.0.1:${server.address().port}`);await p.click('#live-start-btn');
  if(phase==='microphone')await p.click('#live-inline-record-btn');
  await p.waitForFunction(()=>waiting);await p.click('#live-close-btn');
  await p.waitForFunction(()=>!document.fullscreenElement);
  await p.click('#live-start-btn');await p.waitForFunction(()=>document.querySelector('#live-video').videoWidth>0);
  await p.evaluate(()=>{window.fresh=document.querySelector('#live-video').srcObject;resume();});
  await p.waitForTimeout(300);
  assert.equal(await p.evaluate(()=>document.querySelector('#live-video').srcObject===fresh),true,phase+' stale callback cannot replace fresh camera');
  await p.click('#live-close-btn');await p.waitForFunction(()=>tracks.every(t=>t.readyState==='ended'));
  assert.deepEqual(errors,[]);await p.close();
 }
 console.log('deferred camera, video.play and microphone cancellation/cleanup passed');
} finally {await browser.close();await new Promise(r=>server.close(r));}
