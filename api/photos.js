import { del as blobDel, list as blobList, put as blobPut } from '@vercel/blob';

const PREFIX = 'gallery/';
const ACTIVE_SEGMENT = 'active';
const ARCHIVE_SEGMENT = 'archive';
const ACCEPT = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

function json(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sanitizePhotoId(value) {
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

function photoPrefix(photoId, segment) {
  return `${PREFIX}${photoId}/${segment}/`;
}

function inferOrientation(blob) {
  const name = String(blob.pathname || '').toLowerCase();
  if (name.includes('-portrait.')) return 'portrait';
  if (name.includes('-landscape.')) return 'landscape';
  if (name.includes('-square.')) return 'square';
  return 'landscape';
}

async function listGalleryEntries(segment) {
  const listing = await listBlobs({ prefix: PREFIX });
  return (listing.blobs || [])
    .filter((blob) => {
      const pathname = blob.pathname || '';
      const rest = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;
      const [, foundSegment] = rest.split('/');
      return foundSegment === segment;
    })
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

function mapBlob(blob) {
  return {
    id: (blob.pathname || '').slice(PREFIX.length).split('/')[0],
    u: blob.url,
    updated_at: blob.uploadedAt || null,
    pathname: blob.pathname || null,
    orientation: inferOrientation(blob),
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const active = await listGalleryEntries(ACTIVE_SEGMENT);
      const archive = await listGalleryEntries(ARCHIVE_SEGMENT);
      return json(res, 200, {
        photos: active.map(mapBlob),
        archive: archive.map(mapBlob),
      });
    } catch (error) {
      return json(res, 500, { error: 'Could not list photos.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const orientation = String(req.headers['x-photo-orientation'] || 'landscape').trim().toLowerCase();
    if (!ACCEPT.has(contentType)) return json(res, 400, { error: 'Unsupported image type.' });
    try {
      const body = await readBody(req);
      if (!body.length) return json(res, 400, { error: 'Empty upload.' });
      const photoId = `p${Date.now()}`;
      const ext = extFromType(contentType);
      const safeOrientation = ['portrait', 'landscape', 'square'].includes(orientation) ? orientation : 'landscape';
      const pathname = `${photoPrefix(photoId, ACTIVE_SEGMENT)}${Date.now()}-${safeOrientation}.${ext}`;
      const uploaded = await putPublicBlob(pathname, body, {
        addRandomSuffix: false,
        contentType,
        allowOverwrite: true,
      });
      return json(res, 200, {
        photo: {
          id: photoId,
          u: uploaded.url,
          updated_at: uploaded.uploadedAt || new Date().toISOString(),
          pathname,
          orientation: safeOrientation,
        },
      });
    } catch (error) {
      return json(res, 500, { error: 'Could not save photo.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'DELETE') {
    const photoId = sanitizePhotoId(req.headers['x-photo-id']);
    if (!photoId) return json(res, 400, { error: 'Missing or invalid x-photo-id header.' });
    try {
      const active = await listGalleryEntries(ACTIVE_SEGMENT);
      const targets = active
        .filter((blob) => (blob.pathname || '').includes(`${PREFIX}${photoId}/`))
        .map((blob) => blob.url || blob.pathname)
        .filter(Boolean);
      if (targets.length) await deleteBlob(targets);
      return json(res, 200, { ok: true, deleted: targets.length, photoId });
    } catch (error) {
      return json(res, 500, { error: 'Could not delete photo.', details: String(error?.message || error) });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return json(res, 405, { error: 'Method not allowed.' });
}
