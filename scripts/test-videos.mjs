import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.ok(fs.existsSync(new URL('../api/videos.js', import.meta.url)), 'video endpoint must exist');
const { createHandler, uploadPolicy, MAX_BYTES } = await import('../api/videos.js');
const path = 'live-videos/12345678-1234-4234-8234-123456789abc.webm';
const payload = JSON.stringify({ consent: true, size: 123, duration: 3, contentType: 'video/webm' });
const policy = uploadPolicy(path, payload, false);
assert.equal(policy.maximumSizeInBytes, 50 * 1024 * 1024);
assert.equal(policy.allowOverwrite, false);
assert.deepEqual(policy.allowedContentTypes, ['video/webm']);
assert.ok(policy.validUntil > Date.now() && policy.validUntil <= Date.now() + 300001);
assert.throws(() => uploadPolicy([path], payload, false));
for (const [p, data, multipart] of [
 ['gallery/evil.webm', payload, false], [path, '{}', false], [path, payload, true],
 [path, JSON.stringify({ consent:true,size:MAX_BYTES+1,duration:2,contentType:'video/webm' }),false],
 [path, JSON.stringify({ consent:true,size:1,duration:61,contentType:'video/webm' }),false],
 [path, JSON.stringify({ consent:true,size:1,duration:2,contentType:'video/mp4' }),false],
 [path, JSON.stringify({ consent:'true',size:1,duration:2,contentType:'video/webm' }),false],
]) assert.throws(() => uploadPolicy(p, data, multipart));
let listOptions, tokenCalls = 0;
const handler = createHandler({ list: async options => { listOptions=options; return {blobs:[{pathname:path,url:'https://store.public.blob.vercel-storage.com/'+path,size:123,uploadedAt:new Date()}],hasMore:true,cursor:'next'}; }, handleUpload: async options => { tokenCalls++; assert.equal(options.body.payload.callbackUrl,'https://example.test/api/videos'); options.onBeforeGenerateToken(options.body.payload.pathname, options.body.payload.clientPayload, false); return {type:'blob.generate-client-token',clientToken:'test-only'}; } });
async function request(method, body, headers={}, url='/api/videos') {
 const res={headers:{}, status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;},end(text){this.data=JSON.parse(text);}};
 await handler({method,body,headers:{host:'example.test',...headers},url},res); return res;
}
assert.equal((await request('DELETE')).code,405);
assert.equal((await request('GET',null,{},'/api/videos?cursor=abc')).code,200);
assert.equal(listOptions.prefix,'live-videos/'); assert.equal(listOptions.cursor,'abc'); assert.equal(listOptions.limit,12);
const body={type:'blob.generate-client-token',payload:{pathname:path,clientPayload:payload,multipart:false,callbackUrl:'https://attacker.invalid/callback'}};
assert.equal((await request('POST',body,{origin:'https://evil.test','content-type':'application/json'})).code,403);
assert.equal((await request('POST',body,{'content-type':'application/json'})).code,403);
assert.equal(tokenCalls,0);
assert.equal((await request('POST',body,{origin:'https://example.test','content-type':'application/json'})).code,200);
assert.equal(tokenCalls,1);
assert.equal((await request('POST',{type:'bad'},{origin:'https://example.test','content-type':'application/json'})).code,400);
assert.equal((await request('POST','{',{origin:'https://example.test','content-type':'application/json'})).code,400);
assert.equal((await request('GET',null,{},'/api/videos?cursor='+ 'a'.repeat(2049))).code,400);
console.log('video backend ok: policy limits, consent, namespace, MIME, expiry, origin, methods, malformed requests and pagination');
