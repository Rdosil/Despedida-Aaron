import { del as blobDel, list as blobList, put as blobPut } from '@vercel/blob';

const PREFIX = 'image-slots/';
const ACTIVE_SEGMENT = 'active';
const ARCHIVE_SEGMENT = 'archive';
const ACCEPT = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

function json(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
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

async function putPublicBlob(pathname, body, options) {
  return putBlob(pathname, body, {
    ...options,
    access: 'public',
  });
}

async function deleteBlob(urlOrPathname, options) {
  if (globalThis.__blobMock?.del) return globalThis.__blobMock.del(urlOrPathname, options);
  return blobDel(urlOrPathname, options);
}

function slotPrefix(slotId, segment) {
  return `${PREFIX}${slotId}/${segment}/`;
}

async function listSlotEntries(slotId, segment) {
  const listing = await listBlobs({ prefix: slotPrefix(slotId, segment) });
  return (listing.blobs || []).slice().sort((a, b) => {
    return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
  });
}

async function listCurrentSlots() {
  const listing = await listBlobs({ prefix: PREFIX });
  const latestBySlot = new Map();
  for (const blob of listing.blobs || []) {
    const pathname = blob.pathname || '';
    const rest = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;
    const [slotId, segment] = rest.split('/');
    if (!slotId || segment !== ACTIVE_SEGMENT) continue;
    const prev = latestBySlot.get(slotId);
    if (!prev || new Date(blob.uploadedAt || 0) > new Date(prev.uploadedAt || 0)) {
      latestBySlot.set(slotId, blob);
    }
  }
  return latestBySlot;
}

async function listArchiveSlots() {
  const listing = await listBlobs({ prefix: PREFIX });
  const grouped = {};
  for (const blob of listing.blobs || []) {
    const pathname = blob.pathname || '';
    const rest = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;
    const [slotId, segment] = rest.split('/');
    if (!slotId || segment !== ARCHIVE_SEGMENT) continue;
    if (!grouped[slotId]) grouped[slotId] = [];
    grouped[slotId].push({
      u: blob.url,
      updated_at: blob.uploadedAt || null,
      pathname: blob.pathname || null,
    });
  }
  for (const slotId of Object.keys(grouped)) {
    grouped[slotId].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }
  return grouped;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const current = await listCurrentSlots();
      const archive = await listArchiveSlots();
      const slots = {};
      for (const [slotId, blob] of current.entries()) {
        slots[slotId] = {
          u: blob.url,
          updated_at: blob.uploadedAt || null,
          pathname: blob.pathname || null,
          s: 1,
          x: 0,
          y: 0,
        };
      }
      return json(res, 200, { slots, archive });
    } catch (error) {
      return json(res, 500, { error: 'Could not list photos.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'POST') {
    const slotId = sanitizeSlotId(req.headers['x-slot-id']);
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!slotId) return json(res, 400, { error: 'Missing or invalid x-slot-id header.' });
    if (!ACCEPT.has(contentType)) return json(res, 400, { error: 'Unsupported image type.' });
    try {
      const body = await readBody(req);
      if (!body.length) return json(res, 400, { error: 'Empty upload.' });

      const activeEntries = await listSlotEntries(slotId, ACTIVE_SEGMENT);
      const previous = activeEntries[0] || null;
      if (previous) {
        const archivedBody = await fetch(previous.url).then((r) => r.arrayBuffer());
        const archivedType = previous.contentType || contentType;
        const archivePath = `${slotPrefix(slotId, ARCHIVE_SEGMENT)}${Date.now()}.${extFromType(archivedType)}`;
        await putPublicBlob(archivePath, Buffer.from(archivedBody), {
          addRandomSuffix: false,
          contentType: archivedType,
          allowOverwrite: true,
        });
      }

      const ext = extFromType(contentType);
      const pathname = `${slotPrefix(slotId, ACTIVE_SEGMENT)}${Date.now()}.${ext}`;
      const uploaded = await putPublicBlob(pathname, body, {
        addRandomSuffix: false,
        contentType,
        allowOverwrite: true,
      });

      return json(res, 200, {
        slot: {
          id: slotId,
          u: uploaded.url,
          updated_at: uploaded.uploadedAt || new Date().toISOString(),
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
    const slotId = sanitizeSlotId(req.headers['x-slot-id']);
    if (!slotId) return json(res, 400, { error: 'Missing or invalid x-slot-id header.' });
    try {
      const activeEntries = await listSlotEntries(slotId, ACTIVE_SEGMENT);
      const targets = activeEntries.map((blob) => blob.url || blob.pathname).filter(Boolean);
      if (targets.length) {
        await deleteBlob(targets);
      }
      return json(res, 200, { ok: true, deleted: targets.length, slotId });
    } catch (error) {
      return json(res, 500, { error: 'Could not delete photo.', details: String(error?.message || error) });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return json(res, 405, { error: 'Method not allowed.' });
}
