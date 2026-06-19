import { del as blobDel, list as blobList, put as blobPut } from '@vercel/blob';

const PREFIX = 'image-slots/';
const ACCEPT = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

function json(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function getAdminToken(req) {
  return req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
}

function isAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return getAdminToken(req) === expected;
}

function sanitizeSlotId(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return '';
  return id;
}

function extFromType(type) {
  switch (type) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/avif': return 'avif';
    default: return 'bin';
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function listBlobs(options) {
  if (globalThis.__blobMock?.list) return globalThis.__blobMock.list(options);
  return blobList(options);
}

async function putBlob(pathname, body, options) {
  if (globalThis.__blobMock?.put) return globalThis.__blobMock.put(pathname, body, options);
  return blobPut(pathname, body, options);
}

async function deleteBlob(url) {
  if (globalThis.__blobMock?.del) return globalThis.__blobMock.del(url);
  return blobDel(url);
}

async function listSlotEntries() {
  const listing = await listBlobs({ prefix: PREFIX });
  const latestBySlot = new Map();
  for (const blob of listing.blobs || []) {
    const name = blob.pathname || '';
    const rest = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
    const slotId = rest.split('/')[0];
    if (!slotId) continue;
    const prev = latestBySlot.get(slotId);
    if (!prev || new Date(blob.uploadedAt || 0) > new Date(prev.uploadedAt || 0)) {
      latestBySlot.set(slotId, blob);
    }
  }
  return latestBySlot;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const entries = await listSlotEntries();
      const slots = {};
      for (const [slotId, blob] of entries.entries()) {
        slots[slotId] = {
          u: blob.url,
          updated_at: blob.uploadedAt || null,
          pathname: blob.pathname || null,
          s: 1,
          x: 0,
          y: 0,
        };
      }
      return json(res, 200, { slots });
    } catch (error) {
      return json(res, 500, { error: 'Could not list photos.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'POST') {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
    const slotId = sanitizeSlotId(req.headers['x-slot-id']);
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!slotId) return json(res, 400, { error: 'Missing or invalid x-slot-id header.' });
    if (!ACCEPT.has(contentType)) return json(res, 400, { error: 'Unsupported image type.' });
    try {
      const body = await readBody(req);
      if (!body.length) return json(res, 400, { error: 'Empty upload.' });
      const ext = extFromType(contentType);
      const pathname = `${PREFIX}${slotId}/${Date.now()}.${ext}`;
      const uploaded = await putBlob(pathname, body, {
        access: 'public',
        addRandomSuffix: false,
        contentType,
      });
      const entries = await listBlobs({ prefix: `${PREFIX}${slotId}/` });
      await Promise.all((entries.blobs || [])
        .filter((blob) => blob.pathname !== pathname)
        .map((blob) => deleteBlob(blob.url)));
      return json(res, 200, {
        slot: {
          id: slotId,
          u: uploaded.url,
          updated_at: new Date().toISOString(),
          pathname,
          s: 1,
          x: 0,
          y: 0,
        },
      });
    } catch (error) {
      return json(res, 500, { error: 'Could not save photo.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'DELETE') {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
    const slotId = sanitizeSlotId(req.headers['x-slot-id']);
    if (!slotId) return json(res, 400, { error: 'Missing or invalid x-slot-id header.' });
    try {
      const entries = await listBlobs({ prefix: `${PREFIX}${slotId}/` });
      await Promise.all((entries.blobs || []).map((blob) => deleteBlob(blob.url)));
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 500, { error: 'Could not remove photo.', details: String(error?.message || error) });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return json(res, 405, { error: 'Method not allowed.' });
}
