import { list } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';

export const MAX_BYTES = 50 * 1024 * 1024;
const PATH = /^live-videos\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webm|mp4)$/;

// Public contribution endpoint: no account is required. Tokens cannot write outside
// this namespace, overwrite, upload arbitrary MIME types, or exceed 50 MiB.
export function uploadPolicy(pathname, clientPayload, multipart) {
  if (typeof pathname !== 'string') throw new Error('Invalid pathname');
  const match = PATH.exec(pathname);
  const data = JSON.parse(clientPayload || '{}');
  if (!match || multipart || data.consent !== true || !Number.isInteger(data.size) || data.size <= 0 || data.size > MAX_BYTES || !Number.isFinite(data.duration) || data.duration <= 0 || data.duration > 60 || data.contentType !== `video/${match[1]}`) throw new Error('Invalid recording');
  return { allowedContentTypes: [data.contentType], maximumSizeInBytes: MAX_BYTES,
    validUntil: Date.now() + 5 * 60 * 1000, addRandomSuffix: false, allowOverwrite: false,
    tokenPayload: JSON.stringify({ consent: true, duration: data.duration }) };
}
function json(res, status, data) {
  res.status(status); res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data));
}
export function createHandler(storage = { list, handleUpload }) {
  return async (req, res) => {
    if (req.method === 'GET') {
      const cursor = new URL(req.url, 'https://localhost').searchParams.get('cursor') || undefined;
      if (cursor && (cursor.length > 2048 || /[\x00-\x1f]/.test(cursor))) return json(res, 400, { error: 'Cursor non válido.' });
      try {
        const result = await storage.list({ prefix: 'live-videos/', limit: 12, cursor });
        return json(res, 200, { videos: result.blobs.filter(b => PATH.test(b.pathname)).map(b => ({ pathname: b.pathname, url: b.url, downloadUrl: b.downloadUrl || b.url, size: b.size, uploadedAt: b.uploadedAt })), hasMore: Boolean(result.hasMore), cursor: result.hasMore ? result.cursor : null });
      } catch { return json(res, 503, { error: 'Non se puideron cargar os vídeos.' }); }
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Método non permitido.' }); }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 400, { error: 'Precísase JSON.' });
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; if (!body || JSON.stringify(body).length > 8192) throw Error(); }
    catch { return json(res, 400, { error: 'Petición non válida.' }); }
    if (body.type === 'blob.generate-client-token') {
      // Host is set by Vercel's routing, not a client-supplied forwarded-host header.
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return json(res, 403, { error: 'Orixe non permitida.' }); }
      if (origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol) || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) return json(res, 403, { error: 'Orixe non permitida.' });
      body = { ...body, payload: { ...body.payload, callbackUrl: `${origin.origin}/api/videos` } };
      try { uploadPolicy(body.payload?.pathname, body.payload?.clientPayload, body.payload?.multipart); }
      catch { return json(res, 400, { error: 'Vídeo ou consentimento non válido.' }); }
    } else if (body.type !== 'blob.upload-completed') return json(res, 400, { error: 'Petición non válida.' });
    try {
      // SDK verifies the signed completion callback; never trust a browser callback.
      const result = await storage.handleUpload({ request: req, body, onBeforeGenerateToken: async (...args) => uploadPolicy(...args), onUploadCompleted: async () => {} });
      return json(res, 200, result);
    } catch { return json(res, 400, { error: 'Non se puido autorizar a subida.' }); }
  };
}
export default createHandler();
