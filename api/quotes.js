import { del as blobDel, list as blobList, put as blobPut } from '@vercel/blob';

const PREFIX = 'quotes/';
const CONTENT_TYPE = 'application/json; charset=utf-8';

function json(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

function sanitizeText(value, max = 280) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeAuthor(value) {
  return sanitizeText(value, 60);
}

function defaultQuotes() {
  return [
    { id: 'q1', text: 'Se hai curva, hai interior.', author: 'Aarón', created_at: '2026-06-01T12:00:00.000Z' },
    { id: 'q2', text: 'Isto non é unha despedida, é pretemporada.', author: 'Carlos', created_at: '2026-06-01T12:01:00.000Z' },
    { id: 'q3', text: 'Outra e para casa. Mentira, outra máis.', author: 'Gelo', created_at: '2026-06-01T12:02:00.000Z' },
  ];
}

async function loadQuotesBlob() {
  const listing = await listBlobs({ prefix: PREFIX });
  const blobs = (listing.blobs || []).slice().sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  return blobs[0] || null;
}

async function readQuotes() {
  const latest = await loadQuotesBlob();
  if (!latest) return defaultQuotes();
  const text = await fetch(latest.url).then((r) => r.text());
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.quotes) ? parsed.quotes : defaultQuotes();
}

async function writeQuotes(quotes) {
  const pathname = `${PREFIX}${Date.now()}.json`;
  await putPublicBlob(pathname, JSON.stringify({ quotes }, null, 2), {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: CONTENT_TYPE,
  });
  const listing = await listBlobs({ prefix: PREFIX });
  const stale = (listing.blobs || []).filter((blob) => blob.pathname !== pathname).map((blob) => blob.url || blob.pathname).filter(Boolean);
  if (stale.length) await deleteBlob(stale);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const quotes = await readQuotes();
      return json(res, 200, { quotes });
    } catch (error) {
      return json(res, 500, { error: 'Could not list quotes.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const text = sanitizeText(payload.text, 280);
      const author = sanitizeAuthor(payload.author || 'Anónimo');
      if (!text) return json(res, 400, { error: 'Quote text is required.' });
      const quotes = await readQuotes();
      const next = [{
        id: `q${Date.now()}`,
        text,
        author: author || 'Anónimo',
        created_at: new Date().toISOString(),
      }, ...quotes].slice(0, 100);
      await writeQuotes(next);
      return json(res, 200, { quote: next[0], quotes: next });
    } catch (error) {
      return json(res, 500, { error: 'Could not save quote.', details: String(error?.message || error) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return json(res, 405, { error: 'Method not allowed.' });
}
