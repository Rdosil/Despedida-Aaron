import { upload } from '@vercel/blob/client';
const $ = id => document.getElementById(id);
const start=$('live-record-btn'), stop=$('live-record-stop'), status=$('live-record-status');
const preview=$('live-record-preview'), playback=$('live-record-playback');
const save=$('live-record-save'), discard=$('live-record-discard'), consent=$('live-record-consent');
const download=$('live-record-download'), video=$('live-video');
const inlineRecord=$('live-inline-record-btn'), inlineStop=$('live-inline-record-stop');
const drafts=$('live-record-drafts');
const MAX_BYTES=50*1024*1024;
const mime=typeof MediaRecorder!=='undefined' && ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/mp4','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
const supported=Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && mime && HTMLCanvasElement.prototype.captureStream);
let active=null, generation=0, frame, clips=[], selected=null, uploading=false, restoring=true, storing=false, storageSafe=false, focusAfterClose=false;
const current=()=>clips.find(c=>c.id===selected);
const blob=()=>current()?.blob||null;
const message=text=>{const clip=current();status.textContent=text+(clip?.blob?.size>MAX_BYTES?' O vídeo supera 50 MB: non se pode publicar; descarga a copia completa.':'');};
function controls(){
 const busy=Boolean(active);
 const clip=current();
 start.disabled=!supported || restoring || busy || uploading || !window.liveSimulator.isLive;
 stop.disabled=!busy;
 inlineRecord.hidden=!window.liveSimulator.isLive || busy || !supported;
 inlineRecord.disabled=start.disabled;
 inlineStop.hidden=!busy;
 save.disabled=!clip || clip.blob.size>MAX_BYTES || !consent.checked || uploading || clip.published || storing;
 discard.disabled=uploading || restoring || storing || !clip;consent.disabled=uploading || !clip;
 $('live-start-btn').disabled=window.liveSimulator.isLive;
 $('live-camera-toggle').disabled=window.liveSimulator.isLive;
}
const STORAGE_TIMEOUT=2000;
function database(){return new Promise((resolve,reject)=>{
 let settled=false;
 const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error || Error('Draft storage unavailable'));};
 const timer=setTimeout(()=>fail(Error('Draft storage timeout')),STORAGE_TIMEOUT);
 try{
  const r=indexedDB.open('aaron-live-drafts',1);
  r.onupgradeneeded=()=>{if(settled){r.transaction.abort();return;}if(!r.result.objectStoreNames.contains('drafts'))r.result.createObjectStore('drafts');};
  r.onblocked=()=>fail(Error('Draft storage blocked'));
  r.onerror=()=>fail(r.error);
  r.onsuccess=()=>{if(settled){r.result.close();return;}settled=true;clearTimeout(timer);r.result.onversionchange=()=>r.result.close();resolve(r.result);};
 }catch(error){fail(error);}
});}
async function draft(action,value){
 const db=await database();
 try{return await new Promise((resolve,reject)=>{
  let tx, settled=false;
  const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{done(Error('Draft transaction timeout'));try{tx?.abort();}catch{}},STORAGE_TIMEOUT);
  try{
   tx=db.transaction('drafts',action==='get'?'readonly':'readwrite');
   const store=tx.objectStore('drafts');const r=action==='put'?store.put(value,'current'):action==='delete'?store.delete('current'):store.get('current');
   tx.oncomplete=()=>done(null,r.result);tx.onerror=()=>done(tx.error || Error('Draft transaction failed'));tx.onabort=()=>done(tx.error || Error('Draft transaction aborted'));
  }catch(error){try{tx?.abort();}catch{}done(error);}
 });}finally{db.close();}
}
function extFor(clip){return clip.blob.type==='video/mp4'?'mp4':'webm';}
function showSelected(){
 const clip=current();
 if(!clip){
  playback.pause();playback.removeAttribute('src');playback.load();
  if(download.href)URL.revokeObjectURL(download.href);
  download.removeAttribute('href');preview.hidden=true;consent.checked=false;renderList();controls();return;
 }
 if(clip.url)URL.revokeObjectURL(clip.url);
 clip.url=URL.createObjectURL(clip.blob);
 playback.src=clip.url;preview.hidden=false;consent.checked=false;
 download.href=clip.url;download.download='directo-aaron-'+clip.id.slice(0,8)+'.'+extFor(clip);
 renderList();controls();
}
function focusPreview(){
 preview.hidden=false;
 preview.scrollIntoView({block:'center', behavior:'auto'});
 try{playback.focus({preventScroll:true});}catch{}
}
function renderList(){
 if(!drafts)return;
 drafts.replaceChildren();
 if(clips.length<2){drafts.hidden=true;return;}
 drafts.hidden=false;
 clips.forEach((clip,i)=>{
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='live-draft-card'+(clip.id===selected?' is-current':'');
  btn.textContent=(clip.published?'Publicado':'Borrador')+' '+(i+1)+' · '+Math.max(1,Math.round(clip.duration||1))+'s';
  btn.addEventListener('click',()=>{selected=clip.id;showSelected();});
  drafts.append(btn);
 });
}
let persistTail=Promise.resolve();
function persist(){
 const snapshot=clips.map(c=>({id:c.id,blob:c.blob,duration:c.duration,published:c.published}));
 persistTail=persistTail.catch(()=>{}).then(()=>persistNow(snapshot));
 return persistTail;
}
async function persistNow(snapshot){
 storing=true;controls();
 try{
  if(!storageSafe)throw Error('Unresolved durable draft');
  if(snapshot.length)await draft('put',{clips:snapshot});
  else await draft('delete');
  if(snapshot.length!==clips.length)return;
  message(clips.length>1?`${clips.length} vídeos gardados neste navegador. Non se perde ningún ao gravar outro.`:'Borrador gardado neste navegador. Non é público. Descárgao para conservar unha copia segura.');
 }catch(error){if(snapshot.length===clips.length)message('Só vista previa temporal: non se puido gardar no navegador. Descarga o vídeo antes de pechar.');throw error;}
 finally{storing=false;controls();}
}
function release(run){
 clearInterval(run.timer);if(active===run)cancelAnimationFrame(frame);
 run.mic?.getTracks().forEach(t=>t.stop());run.composite?.getTracks().forEach(t=>t.stop());
 run.cameraTrack?.removeEventListener('ended',finish);
}
function finish(){
 generation++;
 const run=active;if(!run)return;
 if(run.recorder && run.recorder.state!=='inactive'){
  if(!run.stopping){run.stopping=true;clearInterval(run.timer);run.recorder.stop();}
 }else if(!run.recorder){release(run);active=null;message('Gravación cancelada. O simulador segue dispoñible.');}
 controls();
}
function render(ctx, canvas, run) {
  if(active!==run) return;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#171322'; ctx.fillRect(0,0,w,h);
  if (video.videoWidth) {
    const scale = Math.max(w/video.videoWidth,h/video.videoHeight);
    ctx.save();
    ctx.translate(w,0); ctx.scale(-1,1);
    ctx.drawImage(video,(w-video.videoWidth*scale)/2,(h-video.videoHeight*scale)/2,video.videoWidth*scale,video.videoHeight*scale); ctx.restore();
  }
  const gradient = ctx.createLinearGradient(0,0,0,h); gradient.addColorStop(0,'#0009'); gradient.addColorStop(.35,'#0000'); gradient.addColorStop(1,'#000d'); ctx.fillStyle=gradient; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 27px sans-serif'; ctx.fillText($('live-handle-display').textContent,30,55,460);
  ctx.font = '22px sans-serif'; ctx.fillText($('live-title-display').textContent,30,92,650);
  ctx.fillStyle='#ff3377'; ctx.fillRect(505,22,185,43); ctx.fillStyle='#fff'; ctx.fillText('EN VIVO · '+$('live-viewers-display').textContent,515,51,165);
  ctx.font='22px sans-serif'; [...$('live-toast-stack').children].slice(-3).forEach((node,i)=>ctx.fillText(node.textContent,30,170+i*38,650));
  const comments = [...$('live-comments').querySelectorAll('.bubble')].slice(-5);
  ctx.font = 'bold 23px sans-serif';
  comments.forEach((node,i)=>{const text=node.textContent;const lines=[];let line='';for(const word of text.split(/\s+/)){if(ctx.measureText(line+' '+word).width>550){lines.push(line);line=word;}else line+=(line?' ':'')+word;}lines.push(line);lines.slice(0,2).forEach((l,j)=>ctx.fillText(l,28,850+i*66+j*27,550));});
  ctx.font='20px sans-serif'; ctx.fillText($('live-pinned-text').textContent,28,1230,645);
  ctx.fillStyle='#ff3c83';ctx.font='52px sans-serif';ctx.fillText('♥',630,1190);
  const hearts=[...$('live-floating-hearts').children];
  hearts.forEach((node,i)=>{ctx.globalAlpha=.8;ctx.fillText('♥',620+Math.sin(i)*30,1100-((performance.now()/4+i*100)%600));});ctx.globalAlpha=1;
  frame=requestAnimationFrame(()=>render(ctx,canvas,run));
}
start.addEventListener('click',async()=>{
 if(start.disabled)return;
 const run={id:++generation,chunks:[],bytes:0};active=run;controls();message(clips.length?'Gravando outro. Os anteriores quedan neste navegador.':'Preparando cámara e pedindo permiso de micrófono…');
 const valid=()=>active===run && run.id===generation && window.liveSimulator.isLive;
 try{
  const camera=await window.liveSimulator.camera();
  if(!valid()){if(active===run){release(run);active=null;controls();}return;}
  if(!camera?.getVideoTracks().some(t=>t.readyState==='live'))throw Error('camera');
  run.mic=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
  if(!valid()){release(run);if(active===run)active=null;controls();return;}
  if(!run.mic.getAudioTracks().length)throw Error('microphone');
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
  render(canvas.getContext('2d'),canvas,run);run.composite=canvas.captureStream(24);
  run.mic.getAudioTracks().forEach(t=>run.composite.addTrack(t));
  const recorder=run.recorder=new MediaRecorder(run.composite,{mimeType:mime,videoBitsPerSecond:2500000,audioBitsPerSecond:128000});
  recorder.ondataavailable=e=>{if(e.data.size){run.bytes+=e.data.size;run.chunks.push(e.data);if(run.bytes>=MAX_BYTES)finish();}};
  recorder.onerror=()=>{message('Fallou a gravación. Tentaremos conservar os datos dispoñibles.');finish();};
  recorder.onstop=async()=>{
   const duration=Math.min(60,(performance.now()-run.at)/1000);
   release(run);if(active===run)active=null;
   if(run.bytes){
    const clip={id:crypto.randomUUID(),blob:new Blob(run.chunks,{type:recorder.mimeType.split(';')[0]}),duration,published:false,url:null};
    clips.push(clip);selected=clip.id;showSelected();if(focusAfterClose){focusAfterClose=false;focusPreview();}void persist().catch(()=>{});
   }else if(clips.length){showSelected();message('Non se gravaron datos novos. Os vídeos anteriores seguen neste navegador.');}
   else message('Non se gravaron datos. Proba de novo.');
   run.chunks=[];controls();
  };
  run.cameraTrack=camera.getVideoTracks()[0];run.cameraTrack.addEventListener('ended',finish,{once:true});
  run.mic.getTracks().forEach(t=>t.addEventListener('ended',finish,{once:true}));
  run.at=performance.now();recorder.start(250);controls();message('Gravando · 0 / 60 s');
  run.timer=setInterval(()=>{const seconds=(performance.now()-run.at)/1000;if(seconds>=60)finish();else message(`Gravando · ${Math.floor(seconds)} / 60 s`);},200);
 }catch(error){
  release(run);if(active!==run)return;active=null;controls();
  message(error.name==='NotAllowedError'?'Permiso denegado. Activa o micrófono e proba de novo.':'Non se puido gravar. Activa a cámara ao iniciar o simulador e comproba os permisos.');
 }
});
stop.addEventListener('click',finish);
inlineRecord.addEventListener('click',()=>start.click());inlineStop.addEventListener('click',finish);
consent.addEventListener('change',controls);
discard.addEventListener('click',async()=>{
 const clip=current();
 if(uploading || restoring || storing || !clip || !window.confirm('Descartar este vídeo deste navegador? Descárgao primeiro se queres conservalo. Os outros non se tocan.'))return;
 restoring=true;controls();
 const wasPublished=clip.published;
 clips=clips.filter(c=>c.id!==clip.id);
 if(clip.url)URL.revokeObjectURL(clip.url);
 selected=clips.at(-1)?.id||null;
 let deleteFailed=false;
 try{await persist();storageSafe=true;}catch{deleteFailed=true;storageSafe=false;}
 showSelected();restoring=false;controls();
 message(deleteFailed?'Copia temporal descartada. O borrador gardado pode seguir neste navegador e reaparecer ao recargar; non se puido actualizar o arquivo.':wasPublished?'Copia local deste vídeo descartada. Se o publicaches, segue na galería.':'Este vídeo descartouse. Os outros seguen neste navegador.');
});
window.addEventListener('live-simulator-reset',()=>{if(active)focusAfterClose=true;finish();});
window.addEventListener('live-state-change',controls);
window.liveRecorderState=()=>Boolean(active);
window.addEventListener('pagehide',finish);
window.addEventListener('beforeunload',e=>{if(active || clips.some(c=>!c.published)){e.preventDefault();e.returnValue='';}});
(async()=>{try{
 const saved=await draft('get');storageSafe=true;
 const recovered=Array.isArray(saved?.clips)?saved.clips.filter(c=>c?.blob):saved?.blob?[{id:'legacy',blob:saved.blob,duration:saved.duration,published:Boolean(saved.published),url:null}]:[];
 if(recovered.length){clips=recovered.map(c=>({id:c.id||crypto.randomUUID(),blob:c.blob,duration:c.duration,published:Boolean(c.published),url:null}));selected=clips.at(-1).id;showSelected();message(clips.length>1?`${clips.length} vídeos recuperados neste navegador. Non se publica sen autorización.`:'Borrador recuperado deste navegador. Non se publica sen autorización.');}
}catch{message('O almacenamento local non está dispoñible. Descarga as gravacións antes de pechar.');}finally{restoring=false;controls();}})();
save.addEventListener('click',async()=>{
  const clip=current();
  if(save.disabled||!clip)return;
  uploading=true;controls();message('Publicando vídeo… Non peches esta páxina.');
  try {
    const pathname=`live-videos/${crypto.randomUUID()}.${extFor(clip)}`;
    await upload(pathname,clip.blob,{access:'public',handleUploadUrl:'/api/videos',multipart:false,contentType:clip.blob.type,clientPayload:JSON.stringify({consent:true,size:clip.blob.size,duration:clip.duration,contentType:clip.blob.type}),onUploadProgress:({percentage})=>message(`Publicando vídeo… ${Math.round(percentage)} %`)});
    clip.published=true;
    try{await persist();}catch{}
    message('Vídeo publicado. Os outros borradores seguen neste navegador; podes gravar outro sen perder nada.');
    renderList();
    await loadGallery(true);
  } catch {message('Non se puido publicar. Conservamos a gravación: podes descargar o vídeo ou volver tentar.');}
  finally{uploading=false;controls();}
});
let cursor=null, loading=false;const seen=new Set(), more=$('live-video-more'), galleryStatus=$('live-video-gallery-status');
function safeURL(value){try{const u=new URL(value);return u.protocol==='https:' && u.hostname.endsWith('.public.blob.vercel-storage.com')?u.href:null;}catch{return null;}}
async function loadGallery(reset=false){
  if(loading)return;loading=true;more.disabled=true;galleryStatus.textContent='Cargando vídeos…';
  try{
    const response=await fetch('/api/videos'+(!reset&&cursor?'?cursor='+encodeURIComponent(cursor):''),{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.videos))throw Error();
    if(reset){$('live-video-gallery').replaceChildren();seen.clear();}
    for(const item of data.videos){const url=safeURL(item.url);if(!url||seen.has(item.pathname))continue;seen.add(item.pathname);const card=document.createElement('article');card.className='card';const v=document.createElement('video');v.controls=true;v.playsInline=true;v.preload='metadata';v.src=url;const a=document.createElement('a');a.textContent='Abrir / descargar vídeo';a.href=safeURL(item.downloadUrl)||url;a.target='_blank';a.rel='noopener';card.append(v,a);$('live-video-gallery').append(card);}
    cursor=data.hasMore&&data.cursor?data.cursor:null;more.hidden=!cursor;galleryStatus.textContent=seen.size?'':'Aínda non hai vídeos publicados. Ti podes gravar o primeiro.';
  }catch{galleryStatus.textContent='Non se puideron cargar os vídeos. Volve tentar.';more.hidden=false;}
  finally{loading=false;more.disabled=false;}
}
more.addEventListener('click',()=>loadGallery());
controls();if(!supported)message('Este navegador non permite gravar cámara e micrófono. Abre a páxina por HTTPS nun navegador actualizado. O simulador segue dispoñible.');
loadGallery();
