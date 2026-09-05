import { upload } from '@vercel/blob/client';

const $ = id => document.getElementById(id);
const start = $('live-record-btn'), stop = $('live-record-stop'), status = $('live-record-status');
const preview = $('live-record-preview'), playback = $('live-record-playback');
const save = $('live-record-save'), discard = $('live-record-discard'), consent = $('live-record-consent');
const download = $('live-record-download'), video = $('live-video');
const MAX_BYTES = 50 * 1024 * 1024;
const mime = typeof MediaRecorder !== 'undefined' && ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/mp4','video/webm'].find(t => MediaRecorder.isTypeSupported(t));
const supported = Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && mime && HTMLCanvasElement.prototype.captureStream);
let media, composite, recorder, timer, frame, generation = 0, blob, objectURL, duration = 0, recordingAt = 0, uploading = false, pending = false, published = false, leaving = false;
const message = text => { status.textContent = text; };
function controls() {
  start.disabled = !supported || pending || Boolean(recorder) || Boolean(blob) || uploading;
  stop.disabled = !pending && !recorder;
  save.disabled = !blob || !consent.checked || uploading || published;
  discard.disabled = uploading; consent.disabled = uploading;
  for (const id of ['live-start-btn','live-camera-toggle']) if ($(id)) $(id).disabled = pending || Boolean(recorder);
}
function release(stream = media, canvasStream = composite, clearPreviewSource = true) {
  clearInterval(timer); cancelAnimationFrame(frame);
  stream?.getTracks().forEach(t => t.stop()); canvasStream?.getTracks().forEach(t => t.stop());
  if (media === stream) media = null;
  if (composite === canvasStream) composite = null;
  if (clearPreviewSource && (!stream || video.srcObject === stream)) {
    video.srcObject = null; video.classList.remove('active'); $('live-placeholder').style.display = 'block';
  }
}
function clearPreview() {
  playback.pause(); playback.removeAttribute('src'); playback.load();
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = null; blob = null; published = false; preview.hidden = true; consent.checked = false; download.removeAttribute('href'); controls();
}
function finish() {
  generation++; pending = false;
  if (recorder?.state === 'recording') recorder.stop();
  else if (!recorder) release();
  controls();
}
function render(ctx, canvas) {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#171322'; ctx.fillRect(0,0,w,h);
  if (video.videoWidth) {
    const scale = Math.max(w/video.videoWidth,h/video.videoHeight);
    ctx.save(); ctx.translate(w,0); ctx.scale(-1,1);
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
  frame=requestAnimationFrame(()=>render(ctx,canvas));
}
start.addEventListener('click',async()=>{
  if (start.disabled) return;
  pending=true; const request=++generation; controls(); message('Pedindo permiso de cámara e micrófono…');
  window.liveSimulator.stopCamera();
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:1280}},audio:true});
    if(request!==generation){stream.getTracks().forEach(t=>t.stop());return;}
    media=stream;
    if(!stream.getAudioTracks().length || !stream.getVideoTracks().length) throw Error('missing tracks');
    await window.liveSimulator.start({recording:true});
    video.srcObject=stream; video.classList.add('active'); $('live-placeholder').style.display='none'; await video.play();
    if(request!==generation){release(stream, null, video.srcObject === stream);return;}
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
    render(canvas.getContext('2d'),canvas); composite=canvas.captureStream(24);
    stream.getAudioTracks().forEach(t=>composite.addTrack(t));
    recorder=new MediaRecorder(composite,{mimeType:mime,videoBitsPerSecond:2500000,audioBitsPerSecond:128000});
    let chunks=[], bytes=0, failed=false;
    recorder.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;if(bytes>MAX_BYTES){failed=true;chunks=[];message('O vídeo supera 50 MB. Proba unha gravación máis curta.');finish();}else if(!failed)chunks.push(e.data);}};
    recorder.onerror=()=>{failed=true;message('Fallou a gravación. Proba de novo noutro navegador.');finish();};
    recorder.onstop=()=>{
      duration=Math.min(60,(performance.now()-recordingAt)/1000); const type=recorder.mimeType.split(';')[0];
      recorder=null;pending=false;release();
      if(!failed && bytes>0 && !leaving){blob=new Blob(chunks,{type});objectURL=URL.createObjectURL(blob);playback.src=objectURL;preview.hidden=false;consent.checked=false;download.href=objectURL;download.download='directo-aaron.'+(type==='video/mp4'?'mp4':'webm');message('Vista previa lista. Podes descargar ou autorizar a publicación.');}
      else if(!failed)message('Non se gravaron datos. Proba de novo.');
      chunks=[];controls();
    };
    stream.getTracks().forEach(t=>t.addEventListener('ended',finish,{once:true}));
    recordingAt=performance.now();recorder.start(250);pending=false;controls();message('Gravando · 0 / 60 s');
    timer=setInterval(()=>{const seconds=(performance.now()-recordingAt)/1000;if(seconds>=60)finish();else message(`Gravando · ${Math.floor(seconds)} / 60 s`);},200);
  } catch(error) {
    if(request!==generation)return;
    recorder=null;pending=false;release();controls();
    message(error.name==='NotAllowedError'?'Permiso denegado. Activa cámara e micrófono no navegador e proba de novo.':'Non se puido iniciar a gravación. Comproba a cámara e o micrófono ou proba outro navegador.');
  }
});
stop.addEventListener('click',finish);
consent.addEventListener('change',controls);
discard.addEventListener('click',()=>{if(!uploading){const wasPublished=published;clearPreview();message(wasPublished?'Copia local descartada. O vídeo segue na galería pública.':'Gravación descartada. Non se publicou nada.');}});
window.addEventListener('live-simulator-reset',finish);
window.addEventListener('live-close-request',()=>{if(recorder || pending) finish();});
window.liveRecorderState=()=>Boolean(recorder || pending);
window.addEventListener('pageshow',()=>{leaving=false;});
window.addEventListener('pagehide',()=>{leaving=true;finish();if(objectURL)URL.revokeObjectURL(objectURL);});
document.addEventListener('visibilitychange',()=>{if(document.hidden && (pending||recorder))finish();});
save.addEventListener('click',async()=>{
  if(save.disabled)return;
  uploading=true;controls();message('Publicando vídeo… Non peches esta páxina.');
  try {
    const pathname=`live-videos/${crypto.randomUUID()}.${blob.type==='video/mp4'?'mp4':'webm'}`;
    await upload(pathname,blob,{access:'public',handleUploadUrl:'/api/videos',multipart:false,contentType:blob.type,clientPayload:JSON.stringify({consent:true,size:blob.size,duration,contentType:blob.type}),onUploadProgress:({percentage})=>message(`Publicando vídeo… ${Math.round(percentage)} %`)});
    published=true;
    message('Vídeo publicado. A copia local segue dispoñible para descargar.');
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
