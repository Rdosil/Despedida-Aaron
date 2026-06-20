import { del as blobDel, list as blobList, put as blobPut } from '@vercel/blob';

const PREFIX = 'challenges/';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_CHALLENGES = {
  r1: false,
  r2: false,
  r3: false,
  r4: false,
  r5: false,
  r6: false,
  r7: false,
  r8: false,
};

function json(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function listBlobs(options) {
  if (globalThis.__blobMock?.list) return globalThis.__blobMock.list(options);
  return blobList(options);
}

async function putPublicBlob(pathname, body, options) {
  if (globalThis.__blobMock?.put) return globalThis.__blobMock.put(pathname, body, { ...options, access: 'public' });
  return blobPut(pathname, body, { ...options, access: 'public' });
}

async function deleteBlob(urlOrPathname, options) {
  if (globalThis.__blobMock?.del) return globalThis.__blobMock.del(urlOrPathname, options);
  return blobDel(urlOrPathname, options);
}

function normalizeDoneMap(raw) {
  const next = { ...DEFAULT_CHALLENGES };
  if (!raw || typeof raw !== 'object') return next;
  for (const id of Object.keys(DEFAULT_CHALLENGES)) {
    next[id] = Boolean(raw[id]);
  }
  return next;
}

async function loadChallengesBlob() {
  const listing = await listBlobs({ prefix: PREFIX });
  const blobs = (listing.blobs || []).slice().sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  return blobs[0] || null;
}

async function readChallenges() {
  const latest = await loadChallengesBlob();
  if (!latest) return normalizeDoneMap();
  const text = await fetch(latest.url).then((r) => r.text());
  const parsed = JSON.parse(text);
  return normalizeDoneMap(parsed?.done);
}

async function writeChallenges(done) {
  const pathname = `${PREFIX}${Date.now()}.json`;
  await putPublicBlob(pathname, JSON.stringify({ done }, null, 2), {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: CONTENT_TYPE,
  });
  const listing = await listBlobs({ prefix: PREFIX });
  const stale = (listing.blobs || [])
    .filter((blob) => blob.pathname !== pathname)
    .map((blob) => blob.url || blob.pathname)
    .filter(Boolean);
  if (stale.length) await deleteBlob(stale);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const done = await readChallenges();
      return json(res, 200, { done });
    } catch (error) {
      return json(res, 500, { error: 'Could not list challenges.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const done = normalizeDoneMap(payload.done);
      await writeChallenges(done);
      return json(res, 200, { ok: true, done });
    } catch (error) {
      return json(res, 500, { error: 'Could not save challenges.', details: String(error?.message || error) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return json(res, 405, { error: 'Method not allowed.' });
}
